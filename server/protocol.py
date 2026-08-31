from __future__ import annotations

import base64
import copy
import datetime as datetime_module
import html
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.parse
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping

from bs4 import BeautifulSoup
from curl_cffi import requests


LOGGER = logging.getLogger("chatgpt_guest_bridge.protocol")

CHATGPT_ORIGIN = "https://chatgpt.com"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/142.0.0.0 Safari/537.36"
)


def _bounded_env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return min(maximum, max(minimum, value))


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class ProtocolConfig:
    root_timeout_seconds: int = 30
    sentinel_timeout_seconds: int = 30
    conversation_prepare_timeout_seconds: int = 30
    conversation_update_timeout_seconds: int = 120
    turnstile_vm_timeout_seconds: int = 15
    pow_max_iterations: int = 500_000
    max_turn_attempts: int = 3
    retry_base_delay_seconds: float = 0.35
    browser_impersonate: str = "chrome142"
    user_agent: str = USER_AGENT
    verify_tls: bool = False
    node_binary: str = "node"
    turnstile_vm_path: Path = field(
        default_factory=lambda: Path(__file__).with_name("protocol_turnstile_vm.mjs")
    )

    @classmethod
    def from_environment(cls) -> "ProtocolConfig":
        return cls(
            root_timeout_seconds=_bounded_env_int(
                "CHATGPT_BRIDGE_ROOT_TIMEOUT", 30, 5, 120
            ),
            sentinel_timeout_seconds=_bounded_env_int(
                "CHATGPT_BRIDGE_SENTINEL_TIMEOUT", 30, 5, 120
            ),
            conversation_prepare_timeout_seconds=_bounded_env_int(
                "CHATGPT_BRIDGE_PREPARE_TIMEOUT", 30, 5, 120
            ),
            conversation_update_timeout_seconds=_bounded_env_int(
                "CHATGPT_BRIDGE_UPDATE_TIMEOUT", 120, 15, 300
            ),
            turnstile_vm_timeout_seconds=_bounded_env_int(
                "CHATGPT_BRIDGE_VM_TIMEOUT", 15, 3, 60
            ),
            pow_max_iterations=_bounded_env_int(
                "CHATGPT_BRIDGE_POW_MAX_ITERATIONS", 500_000, 10_000, 5_000_000
            ),
            max_turn_attempts=_bounded_env_int(
                "CHATGPT_BRIDGE_MAX_ATTEMPTS", 3, 1, 5
            ),
            browser_impersonate=(
                os.getenv("CHATGPT_BRIDGE_BROWSER_IMPERSONATE", "chrome142").strip()
                or "chrome142"
            ),
            user_agent=(
                os.getenv("CHATGPT_BRIDGE_USER_AGENT", USER_AGENT).strip()
                or USER_AGENT
            ),
            verify_tls=_env_bool("CHATGPT_BRIDGE_VERIFY_TLS", False),
            node_binary=os.getenv("CHATGPT_BRIDGE_NODE_BINARY", "node"),
        )


class ProtocolError(RuntimeError):
    """A sanitized protocol error safe to surface through the local API."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        stage: str,
        retryable: bool = True,
        upstream_status: int | None = None,
        upstream_request_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.stage = stage
        self.retryable = retryable
        self.upstream_status = upstream_status
        self.upstream_request_id = upstream_request_id

    def public_detail(self) -> dict[str, Any]:
        detail: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
            "stage": self.stage,
        }
        if self.upstream_status is not None:
            detail["upstream_status"] = self.upstream_status
        if self.upstream_request_id:
            detail["upstream_request_id"] = self.upstream_request_id
        return detail


@dataclass
class RequirementsGrant:
    token: str
    proof_token: str
    turnstile_token: str


@dataclass
class ProtocolSession:
    http: Any
    session_id: str
    document_affinity: str
    worker_version: str
    worker_override: str
    build: str
    fingerprint_session: str
    base_headers: dict[str, str]
    conversation_state: dict[str, Any] = field(
        default_factory=lambda: {
            "messages": [],
            "parentMessageId": "client-created-root",
            "userMessageCount": 0,
        }
    )
    conversation_id: str | None = None
    created_monotonic: float = field(default_factory=time.monotonic)
    last_used_monotonic: float = field(default_factory=time.monotonic)
    lock: threading.RLock = field(default_factory=threading.RLock, repr=False)
    closed: bool = False

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        try:
            self.http.close()
        except Exception:
            LOGGER.debug("Ignoring curl session close failure", exc_info=True)


@dataclass(frozen=True)
class ChatResult:
    answer: str
    conversation_id: str
    conversation_state: dict[str, Any]
    assistant_message_id: str | None
    upstream_request_id: str | None
    attempts: int


@dataclass(frozen=True)
class ParsedDpu:
    answer: str
    conversation_id: str
    conversation_state: dict[str, Any]
    assistant_message_id: str | None


def _compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _base64_json(value: Any) -> str:
    return base64.b64encode(_compact_json(value).encode("utf-8")).decode("ascii")


def _browser_config(
    build: str,
    fingerprint_session: str,
    nonce: int = 1,
    elapsed_ms: int = 1,
    source: str = f"{CHATGPT_ORIGIN}/unauth-mweb/assets/client.js",
    user_agent: str = USER_AGENT,
) -> list[Any]:
    timezone = datetime_module.timezone(datetime_module.timedelta(hours=8))
    now = datetime_module.datetime.now(timezone)
    date_string = now.strftime("%a %b %d %Y %H:%M:%S GMT+0800 (China Standard Time)")
    return [
        3000,
        date_string,
        4294705152,
        nonce,
        user_agent,
        source,
        build,
        "zh-CN",
        "zh-CN,zh",
        elapsed_ms,
        "webdriver−false",
        "location",
        "onload",
        1000.1,
        fingerprint_session,
        "",
        12,
        time.time() * 1000 - 1000,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
    ]


def _imul_32(left: int, right: int) -> int:
    return ((left & 0xFFFFFFFF) * (right & 0xFFFFFFFF)) & 0xFFFFFFFF


def _proof_hash(value: str) -> str:
    current = 2166136261
    for character in value:
        current = _imul_32(current ^ ord(character), 16777619)
    current = _imul_32(current ^ (current >> 16), 2246822507)
    current = _imul_32(current ^ (current >> 13), 3266489909)
    current ^= current >> 16
    return f"{current & 0xFFFFFFFF:08x}"


def _solve_proof_of_work(
    seed: str,
    difficulty: str,
    build: str,
    fingerprint_session: str,
    max_iterations: int,
    user_agent: str = USER_AGENT,
) -> str:
    started = time.perf_counter()
    config = _browser_config(
        build,
        fingerprint_session,
        nonce=0,
        elapsed_ms=0,
        source=f"{CHATGPT_ORIGIN}/sentinel/sdk.js",
        user_agent=user_agent,
    )
    for nonce in range(max_iterations):
        config[3] = nonce
        config[9] = round((time.perf_counter() - started) * 1000)
        encoded = _base64_json(config)
        digest = _proof_hash(seed + encoded)
        if digest[: len(difficulty)] <= difficulty:
            return f"gAAAAAB{encoded}~S"
    raise ProtocolError(
        "proof_of_work_exhausted",
        f"Proof-of-work was not solved within {max_iterations} iterations.",
        stage="sentinel_pow",
        retryable=True,
    )


def _decode_affinity_payload(token: str) -> dict[str, Any]:
    try:
        first_segment = token.split(".", 1)[0]
        padding = "=" * (-len(first_segment) % 4)
        payload = base64.urlsafe_b64decode(first_segment + padding)
        decoded = json.loads(payload)
    except (ValueError, json.JSONDecodeError) as error:
        raise ProtocolError(
            "invalid_document_affinity",
            "The guest page returned an unreadable document-affinity token.",
            stage="bootstrap",
            retryable=True,
        ) from error
    if not isinstance(decoded, dict):
        raise ProtocolError(
            "invalid_document_affinity",
            "The guest page returned an invalid document-affinity payload.",
            stage="bootstrap",
            retryable=True,
        )
    return decoded


def _response_request_id(response: Any) -> str | None:
    return response.headers.get("x-request-id") or response.headers.get("cf-ray")


def _require_http_success(response: Any, stage: str) -> None:
    if 200 <= response.status_code < 300:
        return
    raise ProtocolError(
        f"{stage}_http_{response.status_code}",
        f"Upstream {stage.replace('_', ' ')} returned HTTP {response.status_code}.",
        stage=stage,
        retryable=response.status_code >= 409 or response.status_code in {401, 403},
        upstream_status=response.status_code,
        upstream_request_id=_response_request_id(response),
    )


def _request(http: Any, method: str, url: str, *, stage: str, **kwargs: Any) -> Any:
    try:
        return http.request(method, url, **kwargs)
    except Exception as error:
        raise ProtocolError(
            f"{stage}_network_error",
            f"The upstream {stage.replace('_', ' ')} request failed.",
            stage=stage,
            retryable=True,
        ) from error


def _response_json(response: Any, stage: str) -> dict[str, Any]:
    _require_http_success(response, stage)
    try:
        payload = response.json()
    except (ValueError, json.JSONDecodeError) as error:
        raise ProtocolError(
            f"{stage}_invalid_json",
            f"Upstream {stage.replace('_', ' ')} returned invalid JSON.",
            stage=stage,
            retryable=True,
            upstream_status=response.status_code,
            upstream_request_id=_response_request_id(response),
        ) from error
    if not isinstance(payload, dict):
        raise ProtocolError(
            f"{stage}_invalid_json",
            f"Upstream {stage.replace('_', ' ')} returned an unexpected JSON value.",
            stage=stage,
            retryable=True,
            upstream_status=response.status_code,
            upstream_request_id=_response_request_id(response),
        )
    return payload


def _encode_form(values: Mapping[str, Any]) -> bytes:
    """Encode form fields as UTF-8 independent of the Windows ANSI code page."""

    normalized = {key: str(value) for key, value in values.items()}
    encoded = urllib.parse.urlencode(
        normalized,
        doseq=False,
        encoding="utf-8",
        errors="strict",
    )
    return encoded.encode("ascii")


def _parse_json_attribute(raw: str, name: str) -> dict[str, Any]:
    try:
        parsed = json.loads(html.unescape(raw))
    except (TypeError, ValueError, json.JSONDecodeError) as error:
        raise ProtocolError(
            f"invalid_{name}",
            f"The DPU stream contained an invalid {name.replace('_', ' ')} value.",
            stage="conversation_dpu",
            retryable=True,
        ) from error
    if not isinstance(parsed, dict):
        raise ProtocolError(
            f"invalid_{name}",
            f"The DPU stream contained an invalid {name.replace('_', ' ')} object.",
            stage="conversation_dpu",
            retryable=True,
        )
    return parsed


_KNOWN_DPU_FAILURES = (
    "upstream_unavailable",
    "open_timeout",
    "service_unavailable",
    "gateway_timeout",
    "rate_limit",
    "conversation_limit",
    "internal_server_error",
)


def _detect_dpu_failure_code(raw_text: str, attributes: Mapping[str, Any]) -> str:
    candidates = " ".join(str(value) for value in attributes.values()).lower()
    searchable = f"{candidates} {raw_text.lower()}"
    for code in _KNOWN_DPU_FAILURES:
        if code in searchable:
            return code
    for key in (
        "data-error-code",
        "data-failure-code",
        "data-code",
        "data-error",
        "data-reason",
    ):
        value = attributes.get(key)
        if isinstance(value, str) and value.strip():
            sanitized = re.sub(r"[^a-zA-Z0-9_.-]+", "_", value.strip())[:80]
            if sanitized:
                return sanitized.lower()
    return "conversation_failed"


def parse_dpu_response(raw_text: str) -> ParsedDpu:
    soup = BeautifulSoup(raw_text, "html.parser")
    control_nodes = soup.find_all(attrs={"data-conversation-control": True})
    failed_nodes = [
        node
        for node in control_nodes
        if node.attrs.get("data-conversation-control") == "failed"
    ]
    if failed_nodes:
        failed = failed_nodes[-1]
        code = _detect_dpu_failure_code(raw_text, failed.attrs)
        status_value = failed.attrs.get("data-status") or failed.attrs.get(
            "data-status-code"
        )
        try:
            status = int(status_value) if status_value is not None else None
        except (TypeError, ValueError):
            status = None
        raise ProtocolError(
            code,
            f"The DPU stream ended with the failed control ({code}).",
            stage="conversation_dpu",
            retryable=True,
            upstream_status=status,
        )

    complete_nodes = [
        node
        for node in control_nodes
        if node.attrs.get("data-conversation-control") == "complete"
        and node.attrs.get("data-conversation")
    ]
    if not complete_nodes:
        # A conversation update may have an outer HTTP 200 while its embedded
        # gate fails. Never treat that response as a successful empty answer.
        code = _detect_dpu_failure_code(raw_text, {})
        if code == "conversation_failed":
            code = "dpu_missing_complete"
        raise ProtocolError(
            code,
            "The DPU stream did not contain a terminal complete control.",
            stage="conversation_dpu",
            retryable=True,
        )

    complete = complete_nodes[-1]
    conversation = _parse_json_attribute(
        str(complete.attrs["data-conversation"]), "conversation"
    )

    state_raw = complete.attrs.get("data-conversation-state")
    if not state_raw:
        state_nodes = [
            node
            for node in control_nodes
            if node.attrs.get("data-conversation-state")
        ]
        state_raw = (
            state_nodes[-1].attrs.get("data-conversation-state")
            if state_nodes
            else None
        )
    if not state_raw:
        raise ProtocolError(
            "dpu_missing_conversation_state",
            "The terminal DPU control did not contain continuation state.",
            stage="conversation_dpu",
            retryable=True,
        )
    state = _parse_json_attribute(str(state_raw), "conversation_state")

    conversation_id = state.get("backendConversationId") or conversation.get(
        "backendConversationId"
    )
    if not isinstance(conversation_id, str) or not conversation_id:
        raise ProtocolError(
            "dpu_missing_conversation_id",
            "The terminal DPU control did not contain a conversation id.",
            stage="conversation_dpu",
            retryable=True,
        )

    messages = conversation.get("messages")
    if not isinstance(messages, list):
        messages = []
    assistant: dict[str, Any] | None = None
    for message in reversed(messages):
        if isinstance(message, dict) and message.get("role") == "assistant":
            assistant = message
            break
    if assistant is None:
        raise ProtocolError(
            "dpu_missing_assistant_message",
            "The completed DPU conversation did not contain an assistant message.",
            stage="conversation_dpu",
            retryable=True,
        )

    answer = assistant.get("content")
    if not isinstance(answer, str):
        raise ProtocolError(
            "dpu_invalid_assistant_message",
            "The completed DPU conversation contained a non-text assistant message.",
            stage="conversation_dpu",
            retryable=True,
        )
    message_id = assistant.get("id")
    if not isinstance(message_id, str):
        message_id = None
    return ParsedDpu(
        answer=answer,
        conversation_id=conversation_id,
        conversation_state=state,
        assistant_message_id=message_id,
    )


class GuestProtocolBridge:
    """Implements the currently observed anonymous web-mobile protocol."""

    def __init__(self, config: ProtocolConfig | None = None) -> None:
        self.config = config or ProtocolConfig.from_environment()

    def dependency_status(self) -> dict[str, Any]:
        node_path = shutil.which(self.config.node_binary)
        return {
            "node": node_path,
            "turnstile_vm": str(self.config.turnstile_vm_path),
            "turnstile_vm_exists": self.config.turnstile_vm_path.is_file(),
            "browser_impersonate": self.config.browser_impersonate,
            "ready": bool(node_path and self.config.turnstile_vm_path.is_file()),
        }

    def create_session(self) -> ProtocolSession:
        """Bootstrap a fresh anonymous session with short transient retries.

        The root endpoint is A/B served and occasionally returns the desktop
        shell without the web-mobile affinity attributes. Each retry therefore
        uses a brand-new curl Session/cookie jar rather than reusing that shell.
        """

        last_error: ProtocolError | None = None
        for attempt in range(1, self.config.max_turn_attempts + 1):
            try:
                return self._create_session_once()
            except ProtocolError as error:
                last_error = error
                LOGGER.warning(
                    "Guest bootstrap attempt %s/%s failed at %s: %s (%s)",
                    attempt,
                    self.config.max_turn_attempts,
                    error.stage,
                    error.code,
                    error.upstream_status,
                )
                if attempt >= self.config.max_turn_attempts or not error.retryable:
                    break
                time.sleep(self.config.retry_base_delay_seconds * attempt)

        assert last_error is not None
        raise ProtocolError(
            last_error.code,
            (
                f"Guest bootstrap failed after {self.config.max_turn_attempts} "
                f"attempt(s): {last_error.message}"
            ),
            stage=last_error.stage,
            retryable=False,
            upstream_status=last_error.upstream_status,
            upstream_request_id=last_error.upstream_request_id,
        ) from last_error

    def _create_session_once(self) -> ProtocolSession:
        dependency = self.dependency_status()
        if not dependency["ready"]:
            raise ProtocolError(
                "bridge_dependency_missing",
                "Node.js or the local Turnstile VM is unavailable.",
                stage="dependency",
                retryable=False,
            )

        http = requests.Session(
            impersonate=self.config.browser_impersonate,
            verify=self.config.verify_tls,
        )
        try:
            response = _request(
                http,
                "GET",
                f"{CHATGPT_ORIGIN}/",
                stage="bootstrap_root",
                headers={
                    "Accept-Language": "zh-CN,zh;q=0.9",
                    "User-Agent": self.config.user_agent,
                },
                timeout=self.config.root_timeout_seconds,
            )
            _require_http_success(response, "bootstrap_root")
            root_text = response.content.decode("utf-8", "replace")
            soup = BeautifulSoup(root_text, "html.parser")
            html_node = soup.find("html")
            if html_node is None:
                raise ProtocolError(
                    "guest_document_missing",
                    "The guest root response did not contain an HTML document.",
                    stage="bootstrap",
                    retryable=True,
                )
            attrs = html_node.attrs
            required_attributes = {
                "data-conversation-document-affinity": "document affinity",
                "data-worker-version-id": "worker version",
                "data-worker-version-override": "worker override",
                "data-build": "build id",
            }
            missing = [
                label for key, label in required_attributes.items() if not attrs.get(key)
            ]
            if missing:
                raise ProtocolError(
                    "guest_protocol_unavailable",
                    "The guest page did not expose: " + ", ".join(missing) + ".",
                    stage="bootstrap",
                    retryable=True,
                )

            affinity = str(attrs["data-conversation-document-affinity"])
            affinity_payload = _decode_affinity_payload(affinity)
            session_id = affinity_payload.get("s")
            if not isinstance(session_id, str) or not session_id:
                raise ProtocolError(
                    "guest_session_id_missing",
                    "The document-affinity payload did not contain an anonymous session id.",
                    stage="bootstrap",
                    retryable=True,
                )
            worker_version = str(attrs["data-worker-version-id"])
            worker_override = str(attrs["data-worker-version-override"])
            build = str(attrs["data-build"])
            fingerprint_session = str(uuid.uuid4())
            base_headers = {
                "User-Agent": self.config.user_agent,
                "OAI-Session-Id": session_id,
                "X-Web-Mobile-Conversation-Document-Affinity": affinity,
                "X-Web-Mobile-Document-Worker-Version": worker_version,
                "Cloudflare-Workers-Version-Overrides": worker_override,
                "Referer": f"{CHATGPT_ORIGIN}/",
            }
            return ProtocolSession(
                http=http,
                session_id=session_id,
                document_affinity=affinity,
                worker_version=worker_version,
                worker_override=worker_override,
                build=build,
                fingerprint_session=fingerprint_session,
                base_headers=base_headers,
            )
        except Exception:
            try:
                http.close()
            except Exception:
                pass
            raise

    def _run_turnstile_vm(self, payload: str, dx: str) -> str:
        descriptor, input_path = tempfile.mkstemp(
            prefix="chatgpt-turnstile-", suffix=".json"
        )
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
                json.dump({"p": payload, "dx": dx}, handle, ensure_ascii=False)
            try:
                process = subprocess.run(
                    [
                        self.config.node_binary,
                        str(self.config.turnstile_vm_path),
                        input_path,
                    ],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=self.config.turnstile_vm_timeout_seconds,
                    check=False,
                )
            except (OSError, subprocess.SubprocessError) as error:
                raise ProtocolError(
                    "turnstile_vm_failed",
                    "The local Turnstile VM could not be executed.",
                    stage="sentinel_turnstile",
                    retryable=True,
                ) from error
            if process.returncode != 0:
                raise ProtocolError(
                    "turnstile_vm_failed",
                    f"The local Turnstile VM exited with code {process.returncode}.",
                    stage="sentinel_turnstile",
                    retryable=True,
                )
            output_lines = [line.strip() for line in process.stdout.splitlines() if line.strip()]
            if not output_lines:
                raise ProtocolError(
                    "turnstile_vm_empty",
                    "The local Turnstile VM returned no result.",
                    stage="sentinel_turnstile",
                    retryable=True,
                )
            try:
                result = json.loads(output_lines[-1])
            except json.JSONDecodeError as error:
                raise ProtocolError(
                    "turnstile_vm_invalid_json",
                    "The local Turnstile VM returned invalid JSON.",
                    stage="sentinel_turnstile",
                    retryable=True,
                ) from error
            token = result.get("out") if isinstance(result, dict) else None
            if not isinstance(token, str) or not token:
                raise ProtocolError(
                    "turnstile_vm_missing_token",
                    "The local Turnstile VM did not produce a token.",
                    stage="sentinel_turnstile",
                    retryable=True,
                )
            return token
        finally:
            try:
                os.unlink(input_path)
            except OSError:
                pass

    def _acquire_requirements(self, session: ProtocolSession) -> RequirementsGrant:
        browser_payload = "gAAAAAC" + _base64_json(
            _browser_config(
                session.build,
                session.fingerprint_session,
                user_agent=session.base_headers["User-Agent"],
            )
        )
        headers = {
            **session.base_headers,
            "OAI-Echo-Logs": "",
            "x-web-mobile-document-renderer": "react",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        prepare_response = _request(
            session.http,
            "POST",
            f"{CHATGPT_ORIGIN}/unauth-mweb/sentinel/chat-requirements/prepare",
            stage="sentinel_prepare",
            headers=headers,
            json={"p": browser_payload},
            timeout=self.config.sentinel_timeout_seconds,
        )
        prepare = _response_json(prepare_response, "sentinel_prepare")

        proof_requirements = prepare.get("proofofwork")
        if not isinstance(proof_requirements, dict):
            raise ProtocolError(
                "sentinel_pow_missing",
                "Sentinel prepare did not return proof-of-work requirements.",
                stage="sentinel_prepare",
                retryable=True,
            )
        seed = proof_requirements.get("seed")
        difficulty = proof_requirements.get("difficulty")
        if not isinstance(seed, str) or not isinstance(difficulty, str):
            raise ProtocolError(
                "sentinel_pow_invalid",
                "Sentinel returned invalid proof-of-work requirements.",
                stage="sentinel_prepare",
                retryable=True,
            )

        turnstile_requirements = prepare.get("turnstile")
        dx = (
            turnstile_requirements.get("dx")
            if isinstance(turnstile_requirements, dict)
            else None
        )
        if not isinstance(dx, str) or not dx:
            raise ProtocolError(
                "sentinel_turnstile_missing",
                "Sentinel prepare did not return a Turnstile program.",
                stage="sentinel_prepare",
                retryable=True,
            )
        prepare_token = prepare.get("prepare_token")
        if not isinstance(prepare_token, str) or not prepare_token:
            raise ProtocolError(
                "sentinel_prepare_token_missing",
                "Sentinel prepare did not return a prepare token.",
                stage="sentinel_prepare",
                retryable=True,
            )

        turnstile_token = self._run_turnstile_vm(browser_payload, dx)
        proof_token = _solve_proof_of_work(
            seed,
            difficulty,
            session.build,
            session.fingerprint_session,
            self.config.pow_max_iterations,
            user_agent=session.base_headers["User-Agent"],
        )
        finalize_response = _request(
            session.http,
            "POST",
            f"{CHATGPT_ORIGIN}/unauth-mweb/sentinel/chat-requirements/finalize",
            stage="sentinel_finalize",
            headers=headers,
            json={
                "prepare_token": prepare_token,
                "proofofwork": proof_token,
                "turnstile": turnstile_token,
            },
            timeout=self.config.sentinel_timeout_seconds,
        )
        finalize = _response_json(finalize_response, "sentinel_finalize")
        requirements_token = finalize.get("token")
        if not isinstance(requirements_token, str) or not requirements_token:
            raise ProtocolError(
                "sentinel_token_missing",
                "Sentinel finalize did not return a chat-requirements token.",
                stage="sentinel_finalize",
                retryable=True,
            )
        return RequirementsGrant(
            token=requirements_token,
            proof_token=proof_token,
            turnstile_token=turnstile_token,
        )

    @staticmethod
    def _client_context(session: ProtocolSession) -> dict[str, Any]:
        return {
            "app_name": "chatgpt.com",
            "has_web_push_capabilities": True,
            "is_dark_mode": False,
            "web_push_notification_permission": "default",
            "page_height": 900,
            "page_width": 1440,
            "pixel_ratio": 1,
            "screen_height": 1080,
            "screen_width": 1920,
            "time_since_loaded": max(
                3, round(time.monotonic() - session.created_monotonic)
            ),
        }

    def _conversation_attempt(
        self,
        session: ProtocolSession,
        prompt: str,
        requirements: RequirementsGrant,
    ) -> tuple[ParsedDpu, str | None]:
        continuation = bool(session.conversation_id)
        state = copy.deepcopy(session.conversation_state)
        owner = {"mode": "anonymous", "sessionEpoch": None}
        context = self._client_context(session)
        trace_id = str(uuid.uuid4())
        referer = (
            f"{CHATGPT_ORIGIN}/uc/{session.conversation_id}"
            if continuation
            else f"{CHATGPT_ORIGIN}/"
        )
        prepare_headers = {
            **session.base_headers,
            "Referer": referer,
            "x-oai-turn-trace-id": trace_id,
            "x-web-mobile-prepare-state": "none" if continuation else "success",
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        }
        prepare_form = {
            "conversationRetryOwner": _compact_json(owner),
            "conversationState": _compact_json(state),
            "clientContextualInfo": _compact_json(context),
            "timezone": "Asia/Shanghai",
            "timezoneOffsetMinutes": "-480",
        }
        prepare_response = _request(
            session.http,
            "POST",
            f"{CHATGPT_ORIGIN}/unauth-mweb/conversation/prepare?lightweight_authenticated=0",
            stage="conversation_prepare",
            headers=prepare_headers,
            data=_encode_form(prepare_form),
            timeout=self.config.conversation_prepare_timeout_seconds,
        )
        prepare_payload = _response_json(prepare_response, "conversation_prepare")
        conduit_token = prepare_payload.get("conduit_token")
        if not isinstance(conduit_token, str) or not conduit_token:
            raise ProtocolError(
                "conduit_token_missing",
                "Conversation prepare did not return a conduit token.",
                stage="conversation_prepare",
                retryable=True,
                upstream_request_id=_response_request_id(prepare_response),
            )

        operation_id = str(uuid.uuid4())
        assistant_message_id = "pending-" + str(uuid.uuid4())
        user_message_id = str(uuid.uuid4())
        update_headers = {
            **prepare_headers,
            "x-web-mobile-prepare-state": "success",
            "x-conduit-token": conduit_token,
            "X-Web-Mobile-Conversation-Stream-Protocol": "1",
            "Accept": "text/vnd.openai.web-mobile-partial+html",
        }
        update_state = copy.deepcopy(state)
        update_state["safety"] = {"dismissedInterventionIds": []}
        update_form = {
            "conversationState": _compact_json(update_state),
            "messageMetadata": "{}",
            "oai-session-id": session.session_id,
            "imageAttachments": "[]",
            "pendingImageUploads": "[]",
            "prompt": prompt,
            "chatRequirementsToken": requirements.token,
            "proofToken": requirements.proof_token,
            "turnstileToken": requirements.turnstile_token,
            "telemetryToken": "",
            "timingToken": "[1,null]",
            "conversationRetryOwner": _compact_json(owner),
            "assistantMessageId": assistant_message_id,
            "userMessageId": user_message_id,
            "timezone": "Asia/Shanghai",
            "timezoneOffsetMinutes": "-480",
            "clientContextualInfo": _compact_json(context),
        }
        update_response = _request(
            session.http,
            "POST",
            f"{CHATGPT_ORIGIN}/unauth-mweb/conversation/updates"
            f"?lightweight_authenticated=0&operationId={operation_id}",
            stage="conversation_update",
            headers=update_headers,
            data=_encode_form(update_form),
            timeout=self.config.conversation_update_timeout_seconds,
        )
        _require_http_success(update_response, "conversation_update")
        raw_dpu = update_response.content.decode("utf-8", "replace")
        parsed = parse_dpu_response(raw_dpu)
        return parsed, _response_request_id(update_response)

    def run_turn(
        self,
        session: ProtocolSession,
        prompt: str,
        *,
        allow_first_turn_rebootstrap: bool = True,
    ) -> tuple[ProtocolSession, ChatResult]:
        if session.closed:
            raise ProtocolError(
                "conversation_session_closed",
                "The local conversation session has already been closed.",
                stage="local_session",
                retryable=False,
            )
        if not prompt.strip():
            raise ProtocolError(
                "empty_prompt",
                "The prompt must not be empty.",
                stage="validation",
                retryable=False,
            )

        current = session
        last_error: ProtocolError | None = None
        for attempt in range(1, self.config.max_turn_attempts + 1):
            try:
                # Requirements grants are single-use. This must run for every
                # turn and every retry, even when the previous update returned
                # an outer HTTP 200 with an embedded failed control.
                grant = self._acquire_requirements(current)
                parsed, upstream_request_id = self._conversation_attempt(
                    current, prompt, grant
                )
                current.conversation_state = parsed.conversation_state
                current.conversation_id = parsed.conversation_id
                current.last_used_monotonic = time.monotonic()
                return current, ChatResult(
                    answer=parsed.answer,
                    conversation_id=parsed.conversation_id,
                    conversation_state=parsed.conversation_state,
                    assistant_message_id=parsed.assistant_message_id,
                    upstream_request_id=upstream_request_id,
                    attempts=attempt,
                )
            except ProtocolError as error:
                last_error = error
                LOGGER.warning(
                    "Guest turn attempt %s/%s failed at %s: %s (%s)",
                    attempt,
                    self.config.max_turn_attempts,
                    error.stage,
                    error.code,
                    error.upstream_status,
                )
                if attempt >= self.config.max_turn_attempts or not error.retryable:
                    break

                # A first turn has no upstream state to preserve. On the last
                # retry, refresh root cookies, session id and affinity as well.
                # Continuations deliberately keep their bound anonymous curl
                # session and only refresh Sentinel + conduit state.
                if (
                    allow_first_turn_rebootstrap
                    and current.conversation_id is None
                    and attempt >= 2
                ):
                    replacement = self.create_session()
                    current.close()
                    current = replacement
                time.sleep(self.config.retry_base_delay_seconds * attempt)

        assert last_error is not None
        if current is not session and current.conversation_id is None:
            current.close()
        raise ProtocolError(
            last_error.code,
            (
                f"Guest conversation failed after {self.config.max_turn_attempts} "
                f"attempt(s): {last_error.message}"
            ),
            stage=last_error.stage,
            retryable=False,
            upstream_status=last_error.upstream_status,
            upstream_request_id=last_error.upstream_request_id,
        ) from last_error
