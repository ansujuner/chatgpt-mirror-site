"""Authenticated ChatGPT web conversation protocol.

This module is deliberately separate from the anonymous web-mobile bridge in
``protocol.py``.  It implements the authenticated browser path observed in the
captured production client:

    Sentinel prepare/finalize
      -> /backend-api/f/conversation/prepare
      -> /backend-api/f/conversation (SSE)

The pasted upstream credential never leaves server memory and is never placed
in an exception message or log record.  There is intentionally no anonymous
fallback: an expired or unsupported authenticated flow fails explicitly.
"""

from __future__ import annotations

import copy
import json
import logging
import os
import re
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Iterator, Mapping, Protocol

from bs4 import BeautifulSoup
from curl_cffi import requests

from .protocol import (
    CHATGPT_ORIGIN,
    GuestProtocolBridge,
    ProtocolConfig,
    ProtocolError,
    _base64_json,
    _browser_config,
    _solve_proof_of_work,
)


LOGGER = logging.getLogger("chatgpt_guest_bridge.authenticated_protocol")


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
class AuthenticatedProtocolConfig:
    """Network and resource limits for the authenticated protocol."""

    origin: str = CHATGPT_ORIGIN
    bootstrap_timeout_seconds: int = 30
    sentinel_timeout_seconds: int = 30
    prepare_timeout_seconds: int = 30
    conversation_timeout_seconds: int = 180
    network_attempts: int = 3
    max_turn_attempts: int = 2
    retry_base_delay_seconds: float = 0.4
    max_stream_bytes: int = 16 * 1024 * 1024
    verify_tls: bool = False
    timezone: str = "Asia/Shanghai"
    timezone_offset_min: int = -480

    @classmethod
    def from_environment(cls) -> "AuthenticatedProtocolConfig":
        origin = os.getenv("CHATGPT_AUTH_ORIGIN", CHATGPT_ORIGIN).strip().rstrip("/")
        if not origin:
            origin = CHATGPT_ORIGIN
        return cls(
            origin=origin,
            bootstrap_timeout_seconds=_bounded_env_int(
                "CHATGPT_AUTH_BOOTSTRAP_TIMEOUT", 30, 5, 120
            ),
            sentinel_timeout_seconds=_bounded_env_int(
                "CHATGPT_AUTH_SENTINEL_TIMEOUT", 30, 5, 120
            ),
            prepare_timeout_seconds=_bounded_env_int(
                "CHATGPT_AUTH_PREPARE_TIMEOUT", 30, 5, 120
            ),
            conversation_timeout_seconds=_bounded_env_int(
                "CHATGPT_AUTH_CONVERSATION_TIMEOUT", 180, 15, 600
            ),
            network_attempts=_bounded_env_int(
                "CHATGPT_AUTH_UPSTREAM_NETWORK_ATTEMPTS", 3, 1, 5
            ),
            max_turn_attempts=_bounded_env_int(
                "CHATGPT_AUTH_CHAT_MAX_ATTEMPTS", 2, 1, 4
            ),
            max_stream_bytes=_bounded_env_int(
                "CHATGPT_AUTH_MAX_STREAM_BYTES",
                16 * 1024 * 1024,
                256 * 1024,
                64 * 1024 * 1024,
            ),
            verify_tls=_env_bool("CHATGPT_AUTH_VERIFY_TLS", False),
            timezone=os.getenv("CHATGPT_AUTH_TIMEZONE", "Asia/Shanghai").strip()
            or "Asia/Shanghai",
            timezone_offset_min=_bounded_env_int(
                "CHATGPT_AUTH_TIMEZONE_OFFSET_MIN", -480, -840, 840
            ),
        )


class CredentialLike(Protocol):
    access_token: str
    cookie_header: str | None
    account_id: str
    user_id: str


@dataclass(frozen=True)
class AuthenticatedCredential:
    """Minimal upstream credential copy kept only in server memory."""

    access_token: str = field(repr=False)
    cookie_header: str | None = field(default=None, repr=False)
    account_id: str = ""
    user_id: str = ""

    @classmethod
    def from_value(
        cls, value: "AuthenticatedCredential | CredentialLike | Mapping[str, Any]"
    ) -> "AuthenticatedCredential":
        if isinstance(value, cls):
            credential = value
        elif isinstance(value, Mapping):
            credential = cls(
                access_token=_mapping_string(value, "access_token", "accessToken"),
                cookie_header=_mapping_optional_string(
                    value, "cookie_header", "cookieHeader"
                ),
                account_id=_mapping_string(value, "account_id", "accountId"),
                user_id=_mapping_string(value, "user_id", "userId"),
            )
        else:
            credential = cls(
                access_token=str(getattr(value, "access_token", "")),
                cookie_header=_optional_text(getattr(value, "cookie_header", None)),
                account_id=str(getattr(value, "account_id", "")),
                user_id=str(getattr(value, "user_id", "")),
            )
        credential._validate()
        return credential

    def _validate(self) -> None:
        token = self.access_token.strip()
        if not token or len(token) > 65_536 or _has_header_control(token):
            raise AuthenticatedProtocolError(
                "authenticated_credential_invalid",
                "The authenticated access token is missing or malformed.",
                stage="credential",
                retryable=False,
            )
        if self.cookie_header is not None:
            cookie = self.cookie_header.strip()
            if not cookie or len(cookie) > 65_536 or _has_header_control(cookie):
                raise AuthenticatedProtocolError(
                    "authenticated_credential_invalid",
                    "The authenticated cookie header is malformed.",
                    stage="credential",
                    retryable=False,
                )
        for label, identifier in (
            ("account", self.account_id),
            ("user", self.user_id),
        ):
            if identifier and (
                len(identifier) > 256 or not re.fullmatch(r"[A-Za-z0-9._:-]+", identifier)
            ):
                raise AuthenticatedProtocolError(
                    "authenticated_credential_invalid",
                    f"The authenticated {label} identifier is malformed.",
                    stage="credential",
                    retryable=False,
                )


@dataclass(frozen=True)
class AuthenticatedRequirementsGrant:
    token: str = field(repr=False)
    proof_token: str = field(default="", repr=False)
    turnstile_token: str = field(default="", repr=False)
    so_token: str = field(default="", repr=False)
    expire_at_epoch: float | None = None


TokenRefreshHook = Callable[["AuthenticatedProtocolSession"], Any]


@dataclass
class AuthenticatedProtocolSession:
    """Bound upstream account and continuation state for one local chat."""

    http: Any = field(repr=False)
    access_token: str = field(repr=False)
    cookie_header: str | None = field(default=None, repr=False)
    account_id: str = ""
    user_id: str = ""
    build: str = ""
    sentinel_sdk_url: str = ""
    fingerprint_session: str = field(default_factory=lambda: str(uuid.uuid4()))
    model: str = "auto"
    conversation_id: str | None = None
    parent_message_id: str = "client-created-root"
    conversation_state: dict[str, Any] = field(default_factory=dict)
    turn_index: int = 0
    created_monotonic: float = field(default_factory=time.monotonic)
    last_used_monotonic: float = field(default_factory=time.monotonic)
    token_refresh_hook: TokenRefreshHook | None = field(default=None, repr=False)
    lock: threading.RLock = field(default_factory=threading.RLock, repr=False)
    closed: bool = False

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        # Remove secret references before releasing the curl session.
        self.access_token = ""
        self.cookie_header = None
        try:
            self.http.close()
        except Exception:
            LOGGER.debug("Ignoring authenticated curl session close failure")


@dataclass(frozen=True)
class AuthenticatedChatResult:
    answer: str
    conversation_id: str
    conversation_state: dict[str, Any]
    parent_message_id: str
    assistant_message_id: str
    upstream_request_id: str | None
    attempts: int
    model: str


class AuthenticatedProtocolError(ProtocolError):
    """Credential-safe error for the authenticated protocol."""


@dataclass(frozen=True)
class SSEEvent:
    data: str
    event: str | None = None
    event_id: str | None = None


@dataclass(frozen=True)
class ParsedAuthenticatedStream:
    answer: str
    conversation_id: str
    assistant_message_id: str
    parent_message_id: str
    state: dict[str, Any]


def _mapping_string(value: Mapping[str, Any], *keys: str) -> str:
    for key in keys:
        candidate = value.get(key)
        if isinstance(candidate, str):
            return candidate.strip()
    return ""


def _mapping_optional_string(value: Mapping[str, Any], *keys: str) -> str | None:
    text = _mapping_string(value, *keys)
    return text or None


def _optional_text(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _has_header_control(value: str) -> bool:
    return any(ord(character) < 0x20 or ord(character) == 0x7F for character in value)


def _request_id(response: Any) -> str | None:
    headers = getattr(response, "headers", {})
    if not isinstance(headers, Mapping):
        return None
    for key in ("x-oai-request-id", "x-request-id", "cf-ray"):
        value = headers.get(key) or headers.get(key.title())
        if isinstance(value, str) and value:
            return value[:256]
    return None


def _safe_code(value: Any, fallback: str) -> str:
    if not isinstance(value, str):
        return fallback
    normalized = re.sub(r"[^A-Za-z0-9_.-]+", "_", value.strip()).strip("_")
    return normalized.lower()[:80] or fallback


def _status_error(response: Any, stage: str) -> AuthenticatedProtocolError:
    status = int(getattr(response, "status_code", 0) or 0)
    if status in {401, 403}:
        code = "authenticated_session_expired"
        message = "The authenticated ChatGPT session expired or was rejected."
    elif status == 429:
        code = "authenticated_rate_limited"
        message = "The authenticated ChatGPT account is currently rate limited."
    else:
        code = f"authenticated_{stage}_http_{status}"
        message = f"The authenticated upstream {stage.replace('_', ' ')} request failed."
    return AuthenticatedProtocolError(
        code,
        message,
        stage=stage,
        retryable=status >= 409 or status in {401, 403},
        upstream_status=status or None,
        upstream_request_id=_request_id(response),
    )


def _require_success(response: Any, stage: str) -> None:
    status = int(getattr(response, "status_code", 0) or 0)
    if 200 <= status < 300:
        return
    raise _status_error(response, stage)


def _json_response(response: Any, stage: str) -> dict[str, Any]:
    _require_success(response, stage)
    try:
        value = response.json()
    except Exception as error:
        raise AuthenticatedProtocolError(
            f"authenticated_{stage}_invalid_json",
            f"The authenticated upstream {stage.replace('_', ' ')} response was invalid.",
            stage=stage,
            retryable=True,
            upstream_status=int(getattr(response, "status_code", 0) or 0) or None,
            upstream_request_id=_request_id(response),
        ) from error
    if not isinstance(value, dict):
        raise AuthenticatedProtocolError(
            f"authenticated_{stage}_invalid_json",
            f"The authenticated upstream {stage.replace('_', ' ')} response was invalid.",
            stage=stage,
            retryable=True,
            upstream_status=int(getattr(response, "status_code", 0) or 0) or None,
            upstream_request_id=_request_id(response),
        )
    return value


def iter_sse_events(lines: Iterable[bytes | str]) -> Iterator[SSEEvent]:
    """Parse SSE lines without retaining the whole upstream response."""

    data_lines: list[str] = []
    event_name: str | None = None
    event_id: str | None = None

    def flush() -> SSEEvent | None:
        nonlocal data_lines, event_name, event_id
        if not data_lines and event_name is None and event_id is None:
            return None
        event = SSEEvent(data="\n".join(data_lines), event=event_name, event_id=event_id)
        data_lines = []
        event_name = None
        event_id = None
        return event

    for raw_line in lines:
        if isinstance(raw_line, bytes):
            line = raw_line.decode("utf-8", "replace")
        else:
            line = str(raw_line)
        line = line.rstrip("\r\n")
        if not line:
            event = flush()
            if event is not None:
                yield event
            continue
        if line.startswith(":"):
            continue
        field, separator, value = line.partition(":")
        if separator and value.startswith(" "):
            value = value[1:]
        if field == "data":
            data_lines.append(value if separator else "")
        elif field == "event":
            event_name = value
        elif field == "id":
            event_id = value
    event = flush()
    if event is not None:
        yield event


def _json_pointer_tokens(path: str) -> list[str]:
    if path == "":
        return []
    if not path.startswith("/"):
        raise ValueError("invalid JSON pointer")
    return [part.replace("~1", "/").replace("~0", "~") for part in path[1:].split("/")]


def _apply_json_patch(document: Any, patch: Mapping[str, Any]) -> Any:
    """Apply the small RFC-6902 subset used by stream-message-patch."""

    operation = patch.get("op")
    path = patch.get("path")
    if operation not in {"add", "replace", "remove"} or not isinstance(path, str):
        return document
    try:
        tokens = _json_pointer_tokens(path)
    except ValueError:
        return document
    if not tokens:
        return None if operation == "remove" else copy.deepcopy(patch.get("value"))
    target = document
    for token in tokens[:-1]:
        if isinstance(target, list):
            try:
                target = target[int(token)]
            except (ValueError, IndexError):
                return document
        elif isinstance(target, dict):
            if token not in target:
                if operation == "add":
                    target[token] = {}
                else:
                    return document
            target = target[token]
        else:
            return document
    leaf = tokens[-1]
    if isinstance(target, list):
        if operation == "add" and leaf == "-":
            target.append(copy.deepcopy(patch.get("value")))
            return document
        try:
            index = int(leaf)
        except ValueError:
            return document
        if operation == "add" and 0 <= index <= len(target):
            target.insert(index, copy.deepcopy(patch.get("value")))
        elif operation == "replace" and 0 <= index < len(target):
            target[index] = copy.deepcopy(patch.get("value"))
        elif operation == "remove" and 0 <= index < len(target):
            target.pop(index)
    elif isinstance(target, dict):
        if operation == "remove":
            target.pop(leaf, None)
        else:
            target[leaf] = copy.deepcopy(patch.get("value"))
    return document


# The production ``v1`` stream is not an RFC-6902 stream.  Each event is a
# compact operation whose fields may inherit from the preceding event.  The
# operation is applied to a per-channel document and the resulting *complete*
# document is then passed to the normal ChatGPT event parser.
_V1_DELTA_ALIASES: tuple[tuple[str, str], ...] = (
    ("channel", "c"),
    ("path", "p"),
    ("op", "o"),
    ("value", "v"),
)
_V1_ARRAY_INDEX = re.compile(r"(?:0|[1-9][0-9]*)\Z")


def _v1_path_tokens(path: str) -> list[str | int]:
    if path == "":
        return []
    # The web decoder tolerates both JSON-pointer-looking paths and the same
    # paths without the first slash.
    if path.startswith("/"):
        path = path[1:]
    output: list[str | int] = []
    for raw in path.split("/"):
        token = raw.replace("~1", "/").replace("~0", "~")
        output.append(int(token) if _V1_ARRAY_INDEX.fullmatch(token) else token)
    return output


def _v1_expand_delta(
    value: Mapping[str, Any],
    *,
    previous: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Expand c/p/o/v aliases, matching the browser's inheritance rules."""

    expanded = copy.deepcopy(dict(value))
    for long_name, short_name in _V1_DELTA_ALIASES:
        if short_name in value:
            # A compact key wins if a producer happens to include both forms.
            expanded[long_name] = copy.deepcopy(value[short_name])
        elif long_name in value:
            expanded[long_name] = copy.deepcopy(value[long_name])
        elif long_name != "value" and previous is not None:
            # ``value`` is deliberately never inherited.
            expanded[long_name] = copy.deepcopy(previous.get(long_name))
        expanded.pop(short_name, None)

    if expanded.get("op") == "patch" and isinstance(expanded.get("value"), list):
        # Nested patch operations are alias-expanded but do not inherit fields
        # from the outer or adjacent operations in the production decoder.
        expanded["value"] = [
            _v1_expand_delta(item)
            if isinstance(item, Mapping)
            else copy.deepcopy(item)
            for item in expanded["value"]
        ]
    return expanded


def _v1_container_for(next_token: str | int) -> dict[str, Any] | list[Any]:
    return [] if isinstance(next_token, int) else {}


def _v1_parent(
    root: dict[str, Any], tokens: list[str | int]
) -> tuple[dict[str, Any] | list[Any], str | int] | None:
    """Find/create the parent used by the production permissive path setter."""

    if not tokens:
        return None
    current: Any = root
    for index, token in enumerate(tokens[:-1]):
        next_token = tokens[index + 1]
        if isinstance(current, dict):
            key = str(token) if isinstance(token, int) else token
            child = current.get(key)
            if not isinstance(child, (dict, list)):
                child = _v1_container_for(next_token)
                current[key] = child
            current = child
        elif isinstance(current, list) and isinstance(token, int) and token >= 0:
            while len(current) <= token:
                current.append(None)
            child = current[token]
            if not isinstance(child, (dict, list)):
                child = _v1_container_for(next_token)
                current[token] = child
            current = child
        else:
            return None
    return current, tokens[-1]


def _v1_get(root: dict[str, Any], tokens: list[str | int]) -> tuple[bool, Any]:
    current: Any = root
    for token in tokens:
        if isinstance(current, dict):
            key = str(token) if isinstance(token, int) else token
            if key not in current:
                return False, None
            current = current[key]
        elif (
            isinstance(current, list)
            and isinstance(token, int)
            and 0 <= token < len(current)
        ):
            current = current[token]
        else:
            return False, None
    return True, current


def _v1_set(
    root: dict[str, Any],
    tokens: list[str | int],
    value: Any,
    *,
    insert_array: bool = False,
) -> bool:
    located = _v1_parent(root, tokens)
    if located is None:
        return False
    parent, leaf = located
    copied = copy.deepcopy(value)
    if isinstance(parent, dict):
        key = str(leaf) if isinstance(leaf, int) else leaf
        parent[key] = copied
        return True
    if not isinstance(leaf, int) or leaf < 0:
        return False
    if insert_array:
        index = min(leaf, len(parent))
        parent.insert(index, copied)
    else:
        while len(parent) <= leaf:
            parent.append(None)
        parent[leaf] = copied
    return True


def _v1_remove(root: dict[str, Any], tokens: list[str | int]) -> bool:
    located = _v1_parent(root, tokens)
    if located is None:
        return False
    parent, leaf = located
    if isinstance(parent, dict):
        key = str(leaf) if isinstance(leaf, int) else leaf
        parent.pop(key, None)
        return True
    if isinstance(leaf, int) and 0 <= leaf < len(parent):
        parent.pop(leaf)
        return True
    return False


def _v1_append(current: Any, value: Any) -> Any:
    if isinstance(current, str):
        return current + (value if isinstance(value, str) else str(value))
    if isinstance(current, list):
        output = copy.deepcopy(current)
        if isinstance(value, list):
            output.extend(copy.deepcopy(value))
        else:
            output.append(copy.deepcopy(value))
        return output
    if isinstance(current, dict) and isinstance(value, Mapping):
        output = copy.deepcopy(current)
        output.update(copy.deepcopy(dict(value)))
        return output
    return copy.deepcopy(value)


def _v1_apply_operation(document: Any, delta: Mapping[str, Any]) -> Any:
    operation = delta.get("op")
    path = delta.get("path")
    if operation not in {"patch", "add", "remove", "replace", "append", "truncate"}:
        raise ValueError("invalid v1 delta operation")
    if not isinstance(path, str):
        raise ValueError("invalid v1 delta path")

    # Wrapping the document gives an ordinary parent even for a root operation.
    root: dict[str, Any] = {"__root": copy.deepcopy(document)}
    tokens: list[str | int] = ["__root", *_v1_path_tokens(path)]
    value = delta.get("value")

    if operation == "add":
        _v1_set(root, tokens, value, insert_array=True)
    elif operation == "replace":
        _v1_set(root, tokens, value)
    elif operation == "remove":
        _v1_remove(root, tokens)
    elif operation == "append":
        found, current = _v1_get(root, tokens)
        _v1_set(root, tokens, _v1_append(current if found else None, value))
    elif operation == "truncate":
        found, current = _v1_get(root, tokens)
        if found and isinstance(value, int) and value >= 0:
            if isinstance(current, str):
                _v1_set(root, tokens, current[:value])
            elif isinstance(current, list):
                _v1_set(root, tokens, current[:value])
    else:  # patch
        found, current = _v1_get(root, tokens)
        if found and isinstance(value, list):
            patched = copy.deepcopy(current)
            for nested in value:
                if isinstance(nested, Mapping):
                    patched = _v1_apply_operation(patched, nested)
            _v1_set(root, tokens, patched)
    return root.get("__root")


class _V1DeltaDecoder:
    """Stateful decoder for production ``event: delta`` frames."""

    def __init__(self) -> None:
        self._previous_delta: dict[str, Any] = {
            "channel": 0,
            "path": "",
            "op": "add",
        }
        self._documents: dict[str | int, Any] = {}

    def accept(self, value: Mapping[str, Any]) -> Any:
        delta = _v1_expand_delta(value, previous=self._previous_delta)
        channel = delta.get("channel", 0)
        if not isinstance(channel, (str, int)) or isinstance(channel, bool):
            raise ValueError("invalid v1 delta channel")
        self._previous_delta = copy.deepcopy(delta)
        document = _v1_apply_operation(self._documents.get(channel), delta)
        self._documents[channel] = document
        return copy.deepcopy(document)


def _content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, Mapping):
        return ""
    direct = content.get("text")
    if isinstance(direct, str):
        return direct
    parts = content.get("parts")
    if not isinstance(parts, list):
        return ""
    output: list[str] = []
    for part in parts:
        if isinstance(part, str):
            output.append(part)
        elif isinstance(part, Mapping):
            text = part.get("text")
            if isinstance(text, str):
                output.append(text)
            elif part.get("content_type") == "text" and isinstance(part.get("content"), str):
                output.append(str(part["content"]))
    return "".join(output)


def _assistant_message(message: Any) -> bool:
    if not isinstance(message, Mapping):
        return False
    author = message.get("author")
    if isinstance(author, Mapping):
        return author.get("role") == "assistant"
    return message.get("role") == "assistant"


def _visible_assistant_message(message: Mapping[str, Any]) -> bool:
    if not _assistant_message(message):
        return False
    recipient = message.get("recipient")
    if isinstance(recipient, str) and recipient not in {"all", "user"}:
        return False
    channel = message.get("channel")
    if isinstance(channel, str) and channel not in {"final", "commentary"}:
        return False
    content = message.get("content")
    if isinstance(content, Mapping):
        content_type = content.get("content_type")
        if isinstance(content_type, str) and content_type not in {
            "text",
            "multimodal_text",
            "output_text",
        }:
            return False
    return True


def _walk_objects(value: Any) -> Iterator[Mapping[str, Any]]:
    if isinstance(value, Mapping):
        yield value
        for child in value.values():
            yield from _walk_objects(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk_objects(child)


def _conversation_id_from(value: Any) -> str | None:
    for obj in _walk_objects(value):
        for key in ("conversation_id", "conversationId", "backendConversationId"):
            candidate = obj.get(key)
            if isinstance(candidate, str) and candidate:
                return candidate
    return None


class _StreamAccumulator:
    def __init__(self, existing_conversation_id: str | None) -> None:
        self.conversation_id = existing_conversation_id
        self.messages: dict[str, dict[str, Any]] = {}
        self.message_order: list[str] = []
        self.delta_text = ""
        self.done = False
        self.resume_token: str | None = None
        self.websocket_topic_id: str | None = None

    def _upsert_message(self, message: Any) -> None:
        if not isinstance(message, Mapping):
            return
        identifier = message.get("id") or message.get("message_id")
        if not isinstance(identifier, str) or not identifier:
            return
        normalized = copy.deepcopy(dict(message))
        if identifier not in self.messages:
            self.message_order.append(identifier)
        self.messages[identifier] = normalized

    def _apply_message_patch(self, payload: Mapping[str, Any]) -> None:
        identifier = payload.get("message_id") or payload.get("messageId")
        if not isinstance(identifier, str) or identifier not in self.messages:
            return
        patches = payload.get("patches") or payload.get("patch")
        if isinstance(patches, Mapping):
            patches = [patches]
        if not isinstance(patches, list):
            return
        document: Any = self.messages[identifier]
        for patch in patches:
            if isinstance(patch, Mapping):
                document = _apply_json_patch(document, patch)
        if isinstance(document, dict):
            self.messages[identifier] = document

    def accept(self, payload: Mapping[str, Any], event_name: str | None) -> None:
        conversation_id = _conversation_id_from(payload)
        if conversation_id:
            self.conversation_id = conversation_id

        payload_type = payload.get("type")
        if payload_type in {"done", "message_stream_complete"} or event_name == "done":
            self.done = True
        if payload_type in {
            "resume_token",
            "resume_conversation_token",
            "conversation_resume",
        }:
            token = (
                payload.get("resume_token")
                or payload.get("resumeToken")
                or payload.get("token")
            )
            if isinstance(token, str):
                self.resume_token = token
        if payload_type == "stream_handoff":
            options = payload.get("options")
            if isinstance(options, list):
                for option in options:
                    if isinstance(option, Mapping) and option.get("type") == "subscribe_ws_topic":
                        topic = option.get("topic_id")
                        if isinstance(topic, str):
                            self.websocket_topic_id = topic

        if payload_type == "stream-message-patch":
            self._apply_message_patch(payload)
        for key in ("message", "item"):
            self._upsert_message(payload.get(key))
        messages = payload.get("messages")
        if isinstance(messages, list):
            for message in messages:
                self._upsert_message(message)
        conversation = payload.get("conversation")
        if isinstance(conversation, Mapping):
            nested = conversation.get("messages")
            if isinstance(nested, list):
                for message in nested:
                    self._upsert_message(message)
        if _assistant_message(payload):
            self._upsert_message(payload)

        # Compatibility with OpenAI-style text deltas if an account is served
        # a non-ChatGPT stream variant.
        delta = payload.get("delta")
        if isinstance(delta, str):
            self.delta_text += delta
        elif isinstance(delta, Mapping) and isinstance(delta.get("content"), str):
            self.delta_text += str(delta["content"])
        choices = payload.get("choices")
        if isinstance(choices, list) and choices:
            choice = choices[0]
            if isinstance(choice, Mapping):
                choice_delta = choice.get("delta")
                if isinstance(choice_delta, Mapping) and isinstance(
                    choice_delta.get("content"), str
                ):
                    self.delta_text += str(choice_delta["content"])

    def finish(self) -> ParsedAuthenticatedStream:
        selected: dict[str, Any] | None = None
        for identifier in reversed(self.message_order):
            candidate = self.messages[identifier]
            if _visible_assistant_message(candidate) and _content_text(
                candidate.get("content")
            ):
                selected = candidate
                break
        if selected is not None:
            answer = _content_text(selected.get("content"))
            assistant_id = str(selected.get("id") or selected.get("message_id"))
        else:
            answer = self.delta_text
            assistant_id = ""

        if not self.conversation_id:
            raise AuthenticatedProtocolError(
                "authenticated_stream_missing_conversation_id",
                "The authenticated response did not contain a conversation id.",
                stage="conversation_stream",
                retryable=True,
            )
        if not answer or not assistant_id:
            raise AuthenticatedProtocolError(
                "authenticated_stream_missing_assistant_message",
                "The authenticated response did not contain a complete assistant message.",
                stage="conversation_stream",
                retryable=True,
            )
        state = {
            "conversationId": self.conversation_id,
            "parentMessageId": assistant_id,
            "lastAssistantMessageId": assistant_id,
            "resumeToken": self.resume_token,
            "websocketTopicId": self.websocket_topic_id,
            "streamComplete": self.done,
        }
        return ParsedAuthenticatedStream(
            answer=answer,
            conversation_id=self.conversation_id,
            assistant_message_id=assistant_id,
            parent_message_id=assistant_id,
            state=state,
        )


def _payload_error(payload: Mapping[str, Any]) -> AuthenticatedProtocolError | None:
    error = payload.get("error")
    if not error:
        return None
    if isinstance(error, Mapping):
        raw_code = error.get("code") or payload.get("error_code")
        status_value = error.get("status_code") or error.get("status")
    else:
        raw_code = payload.get("error_code")
        status_value = payload.get("status_code")
    try:
        status = int(status_value) if status_value is not None else None
    except (TypeError, ValueError):
        status = None
    code = _safe_code(raw_code, "authenticated_stream_error")
    return AuthenticatedProtocolError(
        code,
        "The authenticated ChatGPT conversation stream returned an error.",
        stage="conversation_stream",
        retryable=bool(payload.get("can_retry", True)),
        upstream_status=status,
    )


def parse_authenticated_sse(
    lines: Iterable[bytes | str], *, existing_conversation_id: str | None = None
) -> ParsedAuthenticatedStream:
    accumulator = _StreamAccumulator(existing_conversation_id)
    delta_decoder: _V1DeltaDecoder | None = None
    for event in iter_sse_events(lines):
        data = event.data.strip()
        if not data:
            continue
        if data == "[DONE]":
            accumulator.done = True
            continue
        if event.event == "delta_encoding":
            encoding = data.strip('"')
            if encoding == "v1":
                delta_decoder = _V1DeltaDecoder()
            elif encoding and encoding not in {"none", "identity"}:
                raise AuthenticatedProtocolError(
                    "authenticated_stream_encoding_unsupported",
                    "The authenticated stream selected an unsupported delta encoding.",
                    stage="conversation_stream",
                    retryable=False,
                )
            continue
        try:
            payload: Any = json.loads(data)
            if isinstance(payload, str) and payload.startswith("{"):
                payload = json.loads(payload)
        except json.JSONDecodeError as error:
            raise AuthenticatedProtocolError(
                "authenticated_stream_invalid_json",
                "The authenticated conversation stream contained invalid JSON.",
                stage="conversation_stream",
                retryable=True,
            ) from error
        if not isinstance(payload, Mapping):
            continue
        if event.event == "delta":
            if delta_decoder is None:
                raise AuthenticatedProtocolError(
                    "authenticated_stream_encoding_missing",
                    "The authenticated stream sent encoded deltas without a decoder.",
                    stage="conversation_stream",
                    retryable=True,
                )
            try:
                payload = delta_decoder.accept(payload)
            except (TypeError, ValueError) as error:
                raise AuthenticatedProtocolError(
                    "authenticated_stream_delta_invalid",
                    "The authenticated stream contained an invalid encoded delta.",
                    stage="conversation_stream",
                    retryable=True,
                ) from error
            if not isinstance(payload, Mapping):
                continue
        stream_error = _payload_error(payload)
        if stream_error is not None:
            raise stream_error
        accumulator.accept(payload, event.event)
    return accumulator.finish()


def _new_user_message(prompt: str, message_id: str) -> dict[str, Any]:
    return {
        "id": message_id,
        "author": {"role": "user"},
        "create_time": time.time(),
        "content": {"content_type": "text", "parts": [prompt]},
        "metadata": {
            "selected_sources": [],
            "serialization_metadata": {"custom_symbol_offsets": []},
        },
    }


def _normalize_prebuilt_user_message(value: Mapping[str, Any]) -> dict[str, Any]:
    """Validate the server-built message envelope used for uploaded refs."""

    if not isinstance(value, Mapping):
        raise AuthenticatedProtocolError(
            "authenticated_user_message_invalid",
            "The authenticated user message is invalid.",
            stage="validation",
            retryable=False,
        )
    message = copy.deepcopy(dict(value))
    message_id = message.get("id")
    author = message.get("author")
    content = message.get("content")
    metadata = message.get("metadata")
    if (
        not isinstance(message_id, str)
        or not message_id
        or len(message_id) > 512
        or _has_header_control(message_id)
        or not isinstance(author, Mapping)
        or author.get("role") != "user"
        or not isinstance(content, Mapping)
        or content.get("content_type") not in {"text", "multimodal_text"}
        or not isinstance(content.get("parts"), list)
        or len(content["parts"]) > 128
        or not isinstance(metadata, Mapping)
    ):
        raise AuthenticatedProtocolError(
            "authenticated_user_message_invalid",
            "The authenticated user message is invalid.",
            stage="validation",
            retryable=False,
        )
    try:
        encoded = json.dumps(
            message,
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        )
    except (TypeError, ValueError, OverflowError) as error:
        raise AuthenticatedProtocolError(
            "authenticated_user_message_invalid",
            "The authenticated user message is invalid.",
            stage="validation",
            retryable=False,
        ) from error
    # Bytes and signed upload destinations are never embedded in this object.
    if len(encoded.encode("utf-8")) > 1024 * 1024:
        raise AuthenticatedProtocolError(
            "authenticated_user_message_too_large",
            "The authenticated user message metadata is too large.",
            stage="validation",
            retryable=False,
        )
    return message


def _optional_body_selector(value: str | None, label: str) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if len(normalized) > 32 or _has_header_control(normalized):
        raise AuthenticatedProtocolError(
            f"authenticated_{label}_invalid",
            f"The requested authenticated {label.replace('_', ' ')} is invalid.",
            stage="validation",
            retryable=False,
        )
    return normalized


def build_conversation_body(
    session: AuthenticatedProtocolSession,
    *,
    messages: list[dict[str, Any]],
    model: str,
    prepare_state: str,
    reasoning_effort: str | None = None,
    service_tier: str | None = None,
) -> dict[str, Any]:
    """Build the observed CHt request subset shared by prepare and submit."""

    body: dict[str, Any] = {
        "action": "next",
        "parent_message_id": session.parent_message_id,
        "model": model,
        "client_prepare_state": prepare_state,
        "timezone_offset_min": -480,
        "timezone": "Asia/Shanghai",
        "conversation_mode": {"kind": "primary_assistant"},
        "system_hints": [],
        "model_response_contracts": [
            {
                "id": "photo_upload_action.v1",
                "presets": ["cap:image", "cap:file", "placement:end"],
                "protocol_version": 1,
            }
        ],
        "supports_buffering": True,
        "supported_encodings": ["v1"],
        "client_contextual_info": {
            "app_name": "chatgpt.com",
            "has_web_push_capabilities": True,
            "web_push_notification_permission": "default",
        },
        "local_function_names": ["local.continue_in_work"],
    }
    # Configurable values are patched by the bridge before transmission.  The
    # pure helper keeps stable defaults so it is convenient for fixture tests.
    if messages:
        body["messages"] = messages
        body["enable_message_followups"] = True
        body["paragen_cot_summary_display_override"] = "allow"
        body["force_parallel_switch"] = "auto"
    else:
        body["client_prepare_dispatch"] = "debounced"
        body["client_prepare_source"] = "composer_editor_state"
    if session.conversation_id:
        body["conversation_id"] = session.conversation_id
    normalized_effort = _optional_body_selector(reasoning_effort, "reasoning_effort")
    normalized_tier = _optional_body_selector(service_tier, "service_tier")
    if normalized_effort is not None:
        body["thinking_effort"] = normalized_effort
    if normalized_tier is not None:
        body["service_tier"] = normalized_tier
    return body


class AuthenticatedProtocolBridge:
    """Authenticated account conversation bridge with no guest fallback."""

    def __init__(
        self,
        config: AuthenticatedProtocolConfig | None = None,
        *,
        protocol_config: ProtocolConfig | None = None,
        http_factory: Callable[[], Any] | None = None,
    ) -> None:
        self.config = config or AuthenticatedProtocolConfig.from_environment()
        self.protocol_config = protocol_config or ProtocolConfig.from_environment()
        self._http_factory = http_factory or self._new_http_session
        # Reuse only the already-audited local Turnstile bytecode VM.  This
        # object never invokes GuestProtocolBridge network methods.
        self._turnstile_vm = GuestProtocolBridge(self.protocol_config)

    def _new_http_session(self) -> Any:
        return requests.Session(
            impersonate=self.protocol_config.browser_impersonate,
            headers={
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                "User-Agent": self.protocol_config.user_agent,
            },
        )

    def dependency_status(self) -> dict[str, Any]:
        status = self._turnstile_vm.dependency_status()
        return {
            "turnstile_vm": status["turnstile_vm"],
            "node": status["node"],
            "ready": status["ready"],
            "mode": "authenticated",
        }

    def _auth_headers(
        self,
        session: AuthenticatedProtocolSession,
        *,
        referer: str | None = None,
    ) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {session.access_token}",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "User-Agent": self.protocol_config.user_agent,
            "Origin": self.config.origin,
            "Referer": referer or f"{self.config.origin}/",
        }
        if session.cookie_header:
            headers["Cookie"] = session.cookie_header
        if session.account_id:
            headers["ChatGPT-Account-ID"] = session.account_id
        return headers

    def _request(
        self,
        session: AuthenticatedProtocolSession,
        method: str,
        path: str,
        *,
        stage: str,
        timeout: int,
        **kwargs: Any,
    ) -> Any:
        url = path if path.startswith("http") else f"{self.config.origin}{path}"
        method_upper = method.upper()
        network_attempts = self.config.network_attempts if method_upper in {"GET", "HEAD"} else 1
        last_network_error: Exception | None = None
        for attempt in range(network_attempts):
            try:
                return session.http.request(
                    method,
                    url,
                    timeout=timeout,
                    verify=self.config.verify_tls,
                    **kwargs,
                )
            except Exception as error:
                last_network_error = error
                if attempt + 1 < network_attempts:
                    # Never log the exception text: some HTTP stacks embed headers.
                    LOGGER.info(
                        "Transient authenticated upstream network failure at %s (%s) "
                        "(attempt %s/%s)",
                        stage,
                        type(error).__name__,
                        attempt + 1,
                        network_attempts,
                    )
                    time.sleep(min(0.2 * (2**attempt), 0.8))
        error_name = (
            type(last_network_error).__name__
            if last_network_error is not None
            else "NoResponse"
        )
        LOGGER.info(
            "Authenticated upstream network failure at %s after %s attempt(s) (%s)",
            stage,
            network_attempts,
            error_name,
        )
        raise AuthenticatedProtocolError(
            f"authenticated_{stage}_network_error",
            f"The authenticated upstream {stage.replace('_', ' ')} request failed.",
            stage=stage,
            # A failed GET is safe for an outer transaction to try again. A
            # failed POST may already have reached upstream and must not be
            # replayed automatically.
            retryable=method_upper in {"GET", "HEAD"},
        ) from last_network_error

    def create_session(
        self,
        credential: AuthenticatedCredential | CredentialLike | Mapping[str, Any],
        *,
        model: str = "auto",
        token_refresh_hook: TokenRefreshHook | None = None,
    ) -> AuthenticatedProtocolSession:
        normalized = AuthenticatedCredential.from_value(credential)
        http = self._http_factory()
        session = AuthenticatedProtocolSession(
            http=http,
            access_token=normalized.access_token.strip(),
            cookie_header=normalized.cookie_header,
            account_id=normalized.account_id,
            user_id=normalized.user_id,
            model=model.strip() or "auto",
            token_refresh_hook=token_refresh_hook,
        )
        try:
            root = self._request(
                session,
                "GET",
                "/",
                stage="bootstrap",
                timeout=self.config.bootstrap_timeout_seconds,
                headers=self._auth_headers(session),
                allow_redirects=False,
            )
            _require_success(root, "bootstrap")
            root_text = bytes(getattr(root, "content", b"")).decode("utf-8", "replace")
            soup = BeautifulSoup(root_text, "html.parser")
            html_node = soup.find("html")
            build = html_node.attrs.get("data-build") if html_node else None
            if not isinstance(build, str) or not build:
                raise AuthenticatedProtocolError(
                    "authenticated_build_missing",
                    "The authenticated ChatGPT page did not expose a build id.",
                    stage="bootstrap",
                    retryable=True,
                )
            session.build = build
            session.sentinel_sdk_url = self._discover_sentinel_sdk(session)
            session.conversation_state = {
                "conversationId": None,
                "parentMessageId": session.parent_message_id,
                "lastUserMessageId": None,
                "lastAssistantMessageId": None,
                "model": session.model,
                "turnIndex": 0,
            }
            return session
        except Exception:
            session.close()
            raise

    def _discover_sentinel_sdk(self, session: AuthenticatedProtocolSession) -> str:
        loader_url = f"{self.config.origin}/backend-api/sentinel/sdk.js"
        response = self._request(
            session,
            "GET",
            "/backend-api/sentinel/sdk.js",
            stage="sentinel_sdk",
            timeout=self.config.bootstrap_timeout_seconds,
            headers=self._auth_headers(session),
            allow_redirects=False,
        )
        _require_success(response, "sentinel_sdk")
        text = bytes(getattr(response, "content", b"")).decode("utf-8", "replace")
        match = re.search(r"https://chatgpt\.com/sentinel/[^\"']+/sdk\.js", text)
        return match.group(0) if match else loader_url

    def _requirements_payload(self, session: AuthenticatedProtocolSession) -> str:
        config = _browser_config(
            session.build,
            session.fingerprint_session,
            source=session.sentinel_sdk_url,
            user_agent=self.protocol_config.user_agent,
        )
        return "gAAAAAC" + _base64_json(config)

    def _acquire_requirements(
        self, session: AuthenticatedProtocolSession
    ) -> AuthenticatedRequirementsGrant:
        payload = self._requirements_payload(session)
        headers = {
            **self._auth_headers(session),
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        prepare_response = self._request(
            session,
            "POST",
            "/backend-api/sentinel/chat-requirements/prepare",
            stage="sentinel_prepare",
            timeout=self.config.sentinel_timeout_seconds,
            headers=headers,
            json={"p": payload},
        )
        prepare = _json_response(prepare_response, "sentinel_prepare")
        if prepare.get("force_login") is True:
            raise AuthenticatedProtocolError(
                "authenticated_session_expired",
                "The authenticated ChatGPT session must be refreshed.",
                stage="sentinel_prepare",
                retryable=True,
                upstream_status=401,
                upstream_request_id=_request_id(prepare_response),
            )
        prepare_token = prepare.get("prepare_token")
        if not isinstance(prepare_token, str) or not prepare_token:
            raise AuthenticatedProtocolError(
                "authenticated_sentinel_prepare_token_missing",
                "Sentinel prepare did not return a prepare token.",
                stage="sentinel_prepare",
                retryable=True,
                upstream_request_id=_request_id(prepare_response),
            )

        proof_token = ""
        proof = prepare.get("proofofwork")
        if isinstance(proof, Mapping) and proof.get("required") is True:
            seed = proof.get("seed")
            difficulty = proof.get("difficulty")
            if not isinstance(seed, str) or not isinstance(difficulty, str):
                raise AuthenticatedProtocolError(
                    "authenticated_sentinel_pow_invalid",
                    "Sentinel returned invalid proof-of-work requirements.",
                    stage="sentinel_pow",
                    retryable=True,
                )
            proof_token = _solve_proof_of_work(
                seed,
                difficulty,
                session.build,
                session.fingerprint_session,
                self.protocol_config.pow_max_iterations,
                user_agent=self.protocol_config.user_agent,
            )

        turnstile_token = ""
        turnstile = prepare.get("turnstile")
        if isinstance(turnstile, Mapping) and turnstile.get("required") is True:
            dx = turnstile.get("dx")
            if not isinstance(dx, str) or not dx:
                raise AuthenticatedProtocolError(
                    "authenticated_sentinel_turnstile_invalid",
                    "Sentinel returned invalid Turnstile requirements.",
                    stage="sentinel_turnstile",
                    retryable=True,
                )
            turnstile_token = self._turnstile_vm._run_turnstile_vm(payload, dx)

        finalize_body: dict[str, str] = {"prepare_token": prepare_token}
        if proof_token:
            finalize_body["proofofwork"] = proof_token
        if turnstile_token:
            finalize_body["turnstile"] = turnstile_token
        finalize_response = self._request(
            session,
            "POST",
            "/backend-api/sentinel/chat-requirements/finalize",
            stage="sentinel_finalize",
            timeout=self.config.sentinel_timeout_seconds,
            headers=headers,
            json=finalize_body,
        )
        finalize = _json_response(finalize_response, "sentinel_finalize")
        requirements_token = finalize.get("token")
        if not isinstance(requirements_token, str) or not requirements_token:
            raise AuthenticatedProtocolError(
                "authenticated_sentinel_token_missing",
                "Sentinel finalize did not return a chat requirements token.",
                stage="sentinel_finalize",
                retryable=True,
                upstream_request_id=_request_id(finalize_response),
            )
        expire_at = finalize.get("expire_at")
        try:
            expire_at_epoch = float(expire_at) if expire_at is not None else None
        except (TypeError, ValueError):
            expire_at_epoch = None
        # Current payloads use epoch seconds; accept epoch milliseconds too.
        if expire_at_epoch and expire_at_epoch > 10_000_000_000:
            expire_at_epoch /= 1000
        return AuthenticatedRequirementsGrant(
            token=requirements_token,
            proof_token=proof_token,
            turnstile_token=turnstile_token,
            expire_at_epoch=expire_at_epoch,
        )

    def _patch_configured_body(self, body: dict[str, Any]) -> dict[str, Any]:
        body["timezone"] = self.config.timezone
        body["timezone_offset_min"] = self.config.timezone_offset_min
        return body

    def _prepare_conduit(
        self,
        session: AuthenticatedProtocolSession,
        *,
        model: str,
        trace_id: str,
        reasoning_effort: str | None,
        service_tier: str | None,
    ) -> str:
        body = self._patch_configured_body(
            build_conversation_body(
                session,
                messages=[],
                model=model,
                prepare_state="none",
                reasoning_effort=reasoning_effort,
                service_tier=service_tier,
            )
        )
        headers = {
            **self._auth_headers(session, referer=self._conversation_referer(session)),
            "Accept": "application/json",
            "Content-Type": "application/json",
            "OAI-Echo-Logs": "",
            "x-oai-turn-trace-id": trace_id,
        }
        response = self._request(
            session,
            "POST",
            "/backend-api/f/conversation/prepare",
            stage="conversation_prepare",
            timeout=self.config.prepare_timeout_seconds,
            headers=headers,
            json=body,
        )
        payload = _json_response(response, "conversation_prepare")
        conduit = payload.get("conduit_token")
        if not isinstance(conduit, str) or not conduit:
            status = payload.get("status")
            code = _safe_code(status, "authenticated_conduit_token_missing")
            raise AuthenticatedProtocolError(
                code,
                "Authenticated conversation prepare did not return a conduit token.",
                stage="conversation_prepare",
                retryable=True,
                upstream_request_id=_request_id(response),
            )
        return conduit

    def _conversation_referer(self, session: AuthenticatedProtocolSession) -> str:
        if session.conversation_id:
            return f"{self.config.origin}/c/{session.conversation_id}"
        return f"{self.config.origin}/"

    def _conversation_headers(
        self,
        session: AuthenticatedProtocolSession,
        grant: AuthenticatedRequirementsGrant,
        *,
        conduit_token: str,
        trace_id: str,
    ) -> dict[str, str]:
        headers = {
            **self._auth_headers(session, referer=self._conversation_referer(session)),
            "Accept": "text/event-stream",
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
            "OAI-Echo-Logs": "",
            "OAI-Telemetry": "[1,null]",
            "OpenAI-Sentinel-Chat-Requirements-Token": grant.token,
            "x-conduit-token": conduit_token,
            "x-oai-turn-trace-id": trace_id,
        }
        if grant.proof_token:
            headers["OpenAI-Sentinel-Proof-Token"] = grant.proof_token
        if grant.turnstile_token:
            headers["OpenAI-Sentinel-Turnstile-Token"] = grant.turnstile_token
        return headers

    def _iter_limited_lines(self, response: Any) -> Iterator[bytes | str]:
        iterator = getattr(response, "iter_lines", None)
        if callable(iterator):
            total = 0
            for line in iterator():
                size = len(line.encode("utf-8")) if isinstance(line, str) else len(line)
                total += size + 1
                if total > self.config.max_stream_bytes:
                    raise AuthenticatedProtocolError(
                        "authenticated_stream_too_large",
                        "The authenticated conversation stream exceeded the local limit.",
                        stage="conversation_stream",
                        retryable=False,
                    )
                yield line
            return
        content = bytes(getattr(response, "content", b""))
        if len(content) > self.config.max_stream_bytes:
            raise AuthenticatedProtocolError(
                "authenticated_stream_too_large",
                "The authenticated conversation stream exceeded the local limit.",
                stage="conversation_stream",
                retryable=False,
            )
        yield from content.splitlines()

    def _submit_conversation(
        self,
        session: AuthenticatedProtocolSession,
        *,
        user_message: Mapping[str, Any],
        model: str,
        trace_id: str,
        conduit_token: str,
        grant: AuthenticatedRequirementsGrant,
        reasoning_effort: str | None,
        service_tier: str | None,
    ) -> tuple[ParsedAuthenticatedStream, str | None]:
        body = self._patch_configured_body(
            build_conversation_body(
                session,
                messages=[copy.deepcopy(dict(user_message))],
                model=model,
                prepare_state="success",
                reasoning_effort=reasoning_effort,
                service_tier=service_tier,
            )
        )
        response = self._request(
            session,
            "POST",
            "/backend-api/f/conversation",
            stage="conversation_submit",
            timeout=self.config.conversation_timeout_seconds,
            headers=self._conversation_headers(
                session,
                grant,
                conduit_token=conduit_token,
                trace_id=trace_id,
            ),
            json=body,
            stream=True,
        )
        try:
            _require_success(response, "conversation_submit")
            parsed = parse_authenticated_sse(
                self._iter_limited_lines(response),
                existing_conversation_id=session.conversation_id,
            )
            return parsed, _request_id(response)
        finally:
            close = getattr(response, "close", None)
            if callable(close):
                try:
                    close()
                except Exception:
                    pass

    def _coerce_refresh_result(
        self, session: AuthenticatedProtocolSession, result: Any
    ) -> tuple[str, str | None, str]:
        if isinstance(result, str):
            return result.strip(), session.cookie_header, session.account_id
        credential = AuthenticatedCredential.from_value(result)
        return (
            credential.access_token.strip(),
            credential.cookie_header or session.cookie_header,
            credential.account_id or session.account_id,
        )

    def _refresh_access_token(self, session: AuthenticatedProtocolSession) -> bool:
        try:
            if session.token_refresh_hook is not None:
                result = session.token_refresh_hook(session)
                token, cookie, account_id = self._coerce_refresh_result(session, result)
            elif session.cookie_header:
                response = self._request(
                    session,
                    "GET",
                    "/api/auth/session",
                    stage="token_refresh",
                    timeout=self.config.bootstrap_timeout_seconds,
                    headers={
                        "Accept": "application/json",
                        "Cookie": session.cookie_header,
                        "Referer": f"{self.config.origin}/",
                        "User-Agent": self.protocol_config.user_agent,
                    },
                    allow_redirects=False,
                )
                payload = _json_response(response, "token_refresh")
                nested = payload.get("session")
                if isinstance(nested, Mapping):
                    payload = dict(nested)
                token = _mapping_string(payload, "accessToken", "access_token")
                cookie = session.cookie_header
                account = payload.get("account")
                refreshed_account_id = (
                    _mapping_string(account, "id", "accountId", "account_id")
                    if isinstance(account, Mapping)
                    else ""
                )
                account_id = refreshed_account_id or session.account_id
            else:
                return False
        except AuthenticatedProtocolError:
            return False
        except Exception as error:
            LOGGER.info("Authenticated token refresh hook failed (%s)", type(error).__name__)
            return False

        if not token or _has_header_control(token) or len(token) > 65_536:
            return False
        if session.account_id and account_id and session.account_id != account_id:
            return False
        session.access_token = token
        session.cookie_header = cookie
        session.account_id = account_id
        return True

    def run_turn(
        self,
        session: AuthenticatedProtocolSession,
        prompt: str = "",
        *,
        model: str | None = None,
        reasoning_effort: str | None = None,
        service_tier: str | None = None,
        user_message: Mapping[str, Any] | None = None,
    ) -> AuthenticatedChatResult:
        if session.closed:
            raise AuthenticatedProtocolError(
                "authenticated_session_closed",
                "The authenticated local conversation session is closed.",
                stage="local_session",
                retryable=False,
            )
        prompt = prompt.strip()
        if user_message is None:
            if not prompt:
                raise AuthenticatedProtocolError(
                    "empty_prompt",
                    "The prompt must not be empty.",
                    stage="validation",
                    retryable=False,
                )
            message_id = str(uuid.uuid4())
            outbound_user_message = _new_user_message(prompt, message_id)
        else:
            outbound_user_message = _normalize_prebuilt_user_message(user_message)
            message_id = str(outbound_user_message["id"])
        selected_model = (model or session.model or "auto").strip()
        if not selected_model or len(selected_model) > 160 or _has_header_control(selected_model):
            raise AuthenticatedProtocolError(
                "authenticated_model_invalid",
                "The requested authenticated model identifier is invalid.",
                stage="validation",
                retryable=False,
            )
        normalized_effort = _optional_body_selector(
            reasoning_effort, "reasoning_effort"
        )
        normalized_tier = _optional_body_selector(service_tier, "service_tier")

        with session.lock:
            trace_id = str(uuid.uuid4())
            last_error: AuthenticatedProtocolError | None = None
            refreshed = False
            for attempt in range(1, self.config.max_turn_attempts + 1):
                try:
                    grant = self._acquire_requirements(session)
                    conduit = self._prepare_conduit(
                        session,
                        model=selected_model,
                        trace_id=trace_id,
                        reasoning_effort=normalized_effort,
                        service_tier=normalized_tier,
                    )
                    parsed, upstream_request_id = self._submit_conversation(
                        session,
                        user_message=outbound_user_message,
                        model=selected_model,
                        trace_id=trace_id,
                        conduit_token=conduit,
                        grant=grant,
                        reasoning_effort=normalized_effort,
                        service_tier=normalized_tier,
                    )
                    session.conversation_id = parsed.conversation_id
                    session.parent_message_id = parsed.parent_message_id
                    session.model = selected_model
                    session.turn_index += 1
                    session.last_used_monotonic = time.monotonic()
                    session.conversation_state = {
                        **parsed.state,
                        "lastUserMessageId": message_id,
                        "lastAssistantMessageId": parsed.assistant_message_id,
                        "parentMessageId": parsed.parent_message_id,
                        "model": selected_model,
                        "turnIndex": session.turn_index,
                    }
                    return AuthenticatedChatResult(
                        answer=parsed.answer,
                        conversation_id=parsed.conversation_id,
                        conversation_state=copy.deepcopy(session.conversation_state),
                        parent_message_id=parsed.parent_message_id,
                        assistant_message_id=parsed.assistant_message_id,
                        upstream_request_id=upstream_request_id,
                        attempts=attempt,
                        model=selected_model,
                    )
                except ProtocolError as error:
                    if isinstance(error, AuthenticatedProtocolError):
                        current_error = error
                    else:
                        current_error = AuthenticatedProtocolError(
                            error.code,
                            error.message,
                            stage=error.stage,
                            retryable=error.retryable,
                            upstream_status=error.upstream_status,
                            upstream_request_id=error.upstream_request_id,
                        )
                    last_error = current_error
                    is_auth_error = (
                        current_error.code == "authenticated_session_expired"
                        or current_error.upstream_status == 401
                    )
                    if is_auth_error and not refreshed:
                        refreshed = True
                        if self._refresh_access_token(session):
                            continue
                    LOGGER.warning(
                        "Authenticated turn attempt %s/%s failed at %s: %s (%s)",
                        attempt,
                        self.config.max_turn_attempts,
                        current_error.stage,
                        current_error.code,
                        current_error.upstream_status,
                    )
                    if attempt >= self.config.max_turn_attempts or not current_error.retryable:
                        break
                    time.sleep(self.config.retry_base_delay_seconds * attempt)

            assert last_error is not None
            raise AuthenticatedProtocolError(
                last_error.code,
                (
                    "The authenticated ChatGPT conversation failed after "
                    f"{self.config.max_turn_attempts} attempt(s)."
                ),
                stage=last_error.stage,
                retryable=False,
                upstream_status=last_error.upstream_status,
                upstream_request_id=last_error.upstream_request_id,
            ) from last_error


__all__ = [
    "AuthenticatedChatResult",
    "AuthenticatedCredential",
    "AuthenticatedProtocolBridge",
    "AuthenticatedProtocolConfig",
    "AuthenticatedProtocolError",
    "AuthenticatedProtocolSession",
    "AuthenticatedRequirementsGrant",
    "ParsedAuthenticatedStream",
    "SSEEvent",
    "build_conversation_body",
    "iter_sse_events",
    "parse_authenticated_sse",
]
