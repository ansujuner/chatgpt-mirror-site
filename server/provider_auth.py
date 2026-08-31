from __future__ import annotations

import base64
import hashlib
import os
import re
import secrets
import threading
import time
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Literal, Mapping
from urllib.parse import parse_qs, urlencode, urlsplit

from .auth_session import (
    OPENAI_AUTH_ISSUER,
    OPENAI_OAUTH_CLIENT_ID,
    AuthSessionError,
)


ProviderName = Literal["google", "apple", "phone", "email"]
PROVIDERS: tuple[ProviderName, ...] = ("google", "apple", "phone", "email")
_EMAIL_HINT = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
_PHONE_HINT = re.compile(r"^\+[1-9][0-9]{7,14}$")
OAUTH_AUTHORIZE_ENDPOINT = f"{OPENAI_AUTH_ISSUER}/oauth/authorize"
OAUTH_REDIRECT_URI = os.getenv(
    "CHATGPT_OAUTH_REDIRECT_URI", "http://localhost:1455/auth/callback"
).strip()
OAUTH_SCOPE = "openid profile email offline_access api.connectors.read api.connectors.invoke"
CALLBACK_FORWARD_ORIGIN = os.getenv(
    "CHATGPT_OAUTH_APP_ORIGIN", "http://localhost:5173"
).strip().rstrip("/")
FLOW_TTL_SECONDS = 600
FLOW_MAX_ENTRIES = 32
MAX_CALLBACK_QUERY_CHARS = 16_384
LOCAL_LOGIN_FLOW_COOKIE_PREFIX = "replica_oauth_flow_"


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def login_flow_cookie_name(flow_id: str) -> str:
    return LOCAL_LOGIN_FLOW_COOKIE_PREFIX + _digest(flow_id)[:20]


def _base64url_sha256(value: str) -> str:
    digest = hashlib.sha256(value.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _safe_callback_path(value: str | None) -> str:
    if not isinstance(value, str):
        return "/"
    path = value.strip()
    if (
        not path.startswith("/")
        or path.startswith("//")
        or "\\" in path
        or any(ord(character) < 0x20 or ord(character) == 0x7F for character in path)
        or len(path) > 2_048
    ):
        return "/"
    return path


def _safe_loopback_origin(value: str | None) -> str:
    candidate = (value or CALLBACK_FORWARD_ORIGIN).strip().rstrip("/")
    try:
        parsed = urlsplit(candidate)
        port = parsed.port
    except ValueError as error:
        raise AuthSessionError(
            "oauth_app_origin_invalid",
            "本地登录回调来源无效。",
            status_code=400,
        ) from error
    if (
        parsed.scheme not in {"http", "https"}
        or (parsed.hostname or "").lower() not in {"localhost", "127.0.0.1", "::1"}
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise AuthSessionError(
            "oauth_app_origin_invalid",
            "浏览器 OAuth 仅支持当前设备上的 loopback 页面。",
            status_code=400,
        )
    hostname = (parsed.hostname or "").lower()
    rendered = f"[{hostname}]" if ":" in hostname else hostname
    if port is not None and port != (443 if parsed.scheme == "https" else 80):
        rendered = f"{rendered}:{port}"
    return f"{parsed.scheme}://{rendered}"


def _authorization_url(
    *,
    provider: ProviderName,
    state: str,
    code_challenge: str,
    login_hint: str | None,
) -> str:
    parameters: list[tuple[str, str]] = [
        ("response_type", "code"),
        ("client_id", OPENAI_OAUTH_CLIENT_ID),
        ("redirect_uri", OAUTH_REDIRECT_URI),
        ("scope", OAUTH_SCOPE),
        ("code_challenge", code_challenge),
        ("code_challenge_method", "S256"),
        ("state", state),
        ("id_token_add_organizations", "true"),
        ("codex_cli_simplified_flow", "true"),
        ("originator", "codex_cli_rs"),
        ("screen_hint", "login_or_signup"),
    ]
    if provider == "google":
        parameters.extend(
            [
                ("connection", "google-oauth2"),
                ("ext-web-mobile-direct-social-login", "true"),
            ]
        )
    elif provider == "apple":
        parameters.extend(
            [
                ("connection", "apple"),
                ("ext-web-mobile-direct-social-login", "true"),
            ]
        )
    elif provider == "phone":
        parameters.append(("ext-login-allow-phone", "true"))
    if login_hint:
        parameters.append(("login_hint", login_hint))
    return f"{OAUTH_AUTHORIZE_ENDPOINT}?{urlencode(parameters)}"


@dataclass(frozen=True)
class ProviderLoginStart:
    flow_id: str
    provider: ProviderName
    authorization_url: str
    callback_path: str
    binding: str = field(repr=False)
    expires_in: int
    poll_after_ms: int = 1_000

    def as_dict(self) -> dict[str, Any]:
        return {
            "flowId": self.flow_id,
            "provider": self.provider,
            "status": "pending",
            "authorizationUrl": self.authorization_url,
            "expiresIn": self.expires_in,
            "pollAfterMs": self.poll_after_ms,
        }


@dataclass(frozen=True)
class ProviderCallbackGrant:
    flow_digest: str
    provider: ProviderName
    callback_path: str
    code_verifier: str = field(repr=False)


@dataclass(frozen=True)
class ProviderCallbackClaim:
    grant: ProviderCallbackGrant
    authorization_code: str = field(repr=False)


@dataclass(frozen=True)
class ProviderLoginCompletion:
    handle: str = field(repr=False)
    provider: ProviderName
    user: Mapping[str, str]
    max_age: int
    callback_path: str


@dataclass
class _ProviderLoginFlow:
    provider: ProviderName
    callback_path: str
    app_origin: str
    state_digest: str
    binding_digest: str
    code_verifier: str = field(repr=False)
    created_at_epoch: float = field(repr=False)
    expires_at_epoch: float = field(repr=False)
    status: str = "pending"
    authorization_code: str | None = field(default=None, repr=False)
    completion: ProviderLoginCompletion | None = field(default=None, repr=False)
    error_code: str | None = None
    error_message: str | None = None
    lock: threading.RLock = field(default_factory=threading.RLock, repr=False)


class _CallbackRedirectServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self,
        address: tuple[str, int],
        forward_origin: str,
        registry: "ProviderLoginRegistry",
    ) -> None:
        self.forward_origin = forward_origin
        self.registry = registry
        super().__init__(address, _CallbackRedirectHandler)


class _CallbackRedirectHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, _format: str, *args: Any) -> None:
        # The request target contains an OAuth authorization code.  Never let
        # BaseHTTPRequestHandler copy it into stdout or an access log.
        return

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
        server = self.server
        assert isinstance(server, _CallbackRedirectServer)
        parsed = urlsplit(self.path)
        host = self.headers.get("Host", "").lower()
        callback_port = int(server.server_address[1])
        allowed_hosts = {
            f"localhost:{callback_port}",
            f"127.0.0.1:{callback_port}",
            f"[::1]:{callback_port}",
        }
        if (
            parsed.path != "/auth/callback"
            or host not in allowed_hosts
            or len(parsed.query) > MAX_CALLBACK_QUERY_CHARS
        ):
            self._send_text(404, "Not found")
            return
        try:
            query = parse_qs(parsed.query, keep_blank_values=True, max_num_fields=8)
        except ValueError:
            self._send_text(400, "Invalid callback")
            return
        permitted = ("code", "state", "error", "error_description")
        forwarded: list[tuple[str, str]] = []
        for key in permitted:
            values = query.get(key, [])
            if len(values) > 1:
                self._send_text(400, "Invalid callback")
                return
            if values:
                value = values[0]
                if len(value) > 8_192 or any(
                    ord(character) < 0x20 or ord(character) == 0x7F
                    for character in value
                ):
                    self._send_text(400, "Invalid callback")
                    return
                forwarded.append((key, value))
        if not any(key == "state" and value for key, value in forwarded):
            self._send_text(400, "Invalid callback")
            return
        values = dict(forwarded)
        state = values.get("state", "")
        try:
            if values.get("error"):
                callback_path, app_origin = server.registry.receive_failure(state)
                location = callback_redirect_path(
                    callback_path,
                    success=False,
                    error="oauth_access_denied",
                )
            else:
                callback_path, app_origin = server.registry.receive_callback(
                    state, values.get("code", "")
                )
                location = callback_processing_path(callback_path)
        except AuthSessionError as error:
            app_origin = server.forward_origin
            location = callback_redirect_path(
                "/", success=False, error=error.code
            )
        except Exception:
            # Never let an exception traceback capture the request target,
            # which contains the one-time authorization code.
            app_origin = server.forward_origin
            location = callback_redirect_path(
                "/", success=False, error="oauth_callback_failed"
            )
        # The raw authorization code and state terminate at this loopback-only
        # listener.  They are deliberately not forwarded into Vite/Uvicorn,
        # whose ordinary access log would otherwise persist the request URL.
        location = f"{app_origin}{location}"
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _send_text(self, status: int, message: str) -> None:
        payload = message.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


class ProviderLoginRegistry:
    """One-time PKCE flows and a loopback-only OAuth callback redirector."""

    def __init__(
        self,
        *,
        ttl_seconds: int = FLOW_TTL_SECONDS,
        max_entries: int = FLOW_MAX_ENTRIES,
        redirect_host: str = "127.0.0.1",
        redirect_port: int = 1455,
        forward_origin: str = CALLBACK_FORWARD_ORIGIN,
    ) -> None:
        self.ttl_seconds = ttl_seconds
        self.max_entries = max_entries
        self.redirect_host = redirect_host
        self.redirect_port = redirect_port
        self.forward_origin = forward_origin
        self._flows: dict[str, _ProviderLoginFlow] = {}
        self._states: dict[str, str] = {}
        self._lock = threading.RLock()
        self._redirect_server: _CallbackRedirectServer | None = None
        self._redirect_thread: threading.Thread | None = None
        self._redirect_error: str | None = None

    def _prune_locked(self) -> None:
        now = time.time()
        expired = [
            key for key, flow in self._flows.items() if flow.expires_at_epoch <= now
        ]
        for key in expired:
            flow = self._flows.pop(key)
            flow.authorization_code = None
            flow.code_verifier = ""
            self._states.pop(flow.state_digest, None)
        if len(self._flows) <= self.max_entries:
            return
        oldest = sorted(
            self._flows.items(), key=lambda item: item[1].created_at_epoch
        )
        for key, flow in oldest[: len(self._flows) - self.max_entries]:
            self._flows.pop(key, None)
            flow.authorization_code = None
            flow.code_verifier = ""
            self._states.pop(flow.state_digest, None)

    def ensure_redirector(self) -> None:
        with self._lock:
            if self._redirect_server is not None:
                return
            try:
                server = _CallbackRedirectServer(
                    (self.redirect_host, self.redirect_port),
                    self.forward_origin,
                    self,
                )
            except OSError as error:
                self._redirect_error = type(error).__name__
                raise AuthSessionError(
                    "oauth_callback_unavailable",
                    "本机 OAuth 回调端口 1455 当前不可用，请关闭占用该端口的程序后重试。",
                    status_code=503,
                ) from error
            thread = threading.Thread(
                target=server.serve_forever,
                name="chatgpt-oauth-loopback",
                daemon=True,
            )
            thread.start()
            self._redirect_server = server
            self._redirect_thread = thread
            self._redirect_error = None

    def close(self) -> None:
        with self._lock:
            server = self._redirect_server
            thread = self._redirect_thread
            self._redirect_server = None
            self._redirect_thread = None
            for flow in self._flows.values():
                flow.authorization_code = None
                flow.code_verifier = ""
            self._flows.clear()
            self._states.clear()
        if server is not None:
            server.shutdown()
            server.server_close()
        if thread is not None:
            thread.join(timeout=2)

    def start(
        self,
        provider: ProviderName,
        *,
        callback_path: str,
        login_hint: str | None = None,
        app_origin: str | None = None,
    ) -> ProviderLoginStart:
        if provider not in PROVIDERS:
            raise AuthSessionError(
                "oauth_provider_invalid",
                "不支持该登录方式。",
                status_code=400,
            )
        if login_hint is not None:
            login_hint = login_hint.strip()
            if (
                not login_hint
                or len(login_hint) > 320
                or any(
                    ord(character) < 0x20 or ord(character) == 0x7F
                    for character in login_hint
                )
            ):
                raise AuthSessionError(
                    "oauth_login_hint_invalid",
                    "邮箱或电话号码格式无效。",
                    status_code=400,
                )
        if provider == "email" and (
            login_hint is None or _EMAIL_HINT.fullmatch(login_hint) is None
        ):
            raise AuthSessionError(
                "oauth_login_hint_invalid",
                "请输入有效的邮箱地址后继续。",
                status_code=400,
            )
        if provider == "phone" and (
            login_hint is None or _PHONE_HINT.fullmatch(login_hint) is None
        ):
            raise AuthSessionError(
                "oauth_login_hint_invalid",
                "电话号码必须使用 E.164 格式，例如 +8613800138000。",
                status_code=400,
            )
        self.ensure_redirector()
        flow_id = "login-" + secrets.token_urlsafe(32)
        state = secrets.token_urlsafe(32)
        binding = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(64)
        now = time.time()
        flow_key = _digest(flow_id)
        state_key = _digest(state)
        callback = _safe_callback_path(callback_path)
        safe_app_origin = _safe_loopback_origin(app_origin)
        flow = _ProviderLoginFlow(
            provider=provider,
            callback_path=callback,
            app_origin=safe_app_origin,
            state_digest=state_key,
            binding_digest=_digest(binding),
            code_verifier=verifier,
            created_at_epoch=now,
            expires_at_epoch=now + self.ttl_seconds,
        )
        with self._lock:
            self._prune_locked()
            self._flows[flow_key] = flow
            self._states[state_key] = flow_key
            self._prune_locked()
        return ProviderLoginStart(
            flow_id=flow_id,
            provider=provider,
            authorization_url=_authorization_url(
                provider=provider,
                state=state,
                code_challenge=_base64url_sha256(verifier),
                login_hint=login_hint,
            ),
            callback_path=callback,
            binding=binding,
            expires_in=self.ttl_seconds,
        )

    def verify_binding(self, flow_id: str, binding: str | None) -> None:
        flow = self._flow(flow_id)
        if (
            not binding
            or len(binding) > 256
            or not secrets.compare_digest(flow.binding_digest, _digest(binding))
        ):
            raise AuthSessionError(
                "oauth_flow_binding_invalid",
                "登录流程不属于当前浏览器，请重新开始。",
                status_code=403,
            )

    def _take_state(self, state: str) -> tuple[str, _ProviderLoginFlow]:
        if not state or len(state) > 1_024:
            raise AuthSessionError(
                "oauth_state_invalid", "登录状态无效或已过期。", status_code=400
            )
        state_key = _digest(state)
        with self._lock:
            self._prune_locked()
            flow_key = self._states.pop(state_key, None)
            flow = self._flows.get(flow_key or "")
        if flow_key is None or flow is None:
            raise AuthSessionError(
                "oauth_state_invalid", "登录状态无效或已过期。", status_code=400
            )
        return flow_key, flow

    def receive_callback(
        self, state: str, authorization_code: str
    ) -> tuple[str, str]:
        if (
            not authorization_code
            or len(authorization_code) > 8_192
            or any(
                ord(character) < 0x20 or ord(character) == 0x7F
                for character in authorization_code
            )
        ):
            raise AuthSessionError(
                "oauth_code_invalid", "官方登录回调缺少授权码。", status_code=400
            )
        _flow_key, flow = self._take_state(state)
        with flow.lock:
            if flow.status != "pending" or flow.expires_at_epoch <= time.time():
                raise AuthSessionError(
                    "oauth_state_invalid", "登录状态无效或已过期。", status_code=400
                )
            flow.authorization_code = authorization_code
            flow.status = "callback_received"
            return flow.callback_path, flow.app_origin

    def receive_failure(self, state: str) -> tuple[str, str]:
        _flow_key, flow = self._take_state(state)
        with flow.lock:
            if flow.status != "pending" or flow.expires_at_epoch <= time.time():
                raise AuthSessionError(
                    "oauth_state_invalid", "登录状态无效或已过期。", status_code=400
                )
            flow.status = "failed"
            flow.error_code = "oauth_access_denied"
            flow.error_message = "登录已取消或未获授权。"
            flow.code_verifier = ""
            return flow.callback_path, flow.app_origin

    def claim_callback(self, flow_id: str) -> ProviderCallbackClaim | None:
        flow = self._flow(flow_id)
        flow_key = _digest(flow_id)
        with flow.lock:
            if flow.status in {"pending", "exchanging"}:
                return None
            if flow.status != "callback_received" or not flow.authorization_code:
                return None
            grant = ProviderCallbackGrant(
                flow_digest=flow_key,
                provider=flow.provider,
                callback_path=flow.callback_path,
                code_verifier=flow.code_verifier,
            )
            claim = ProviderCallbackClaim(
                grant=grant,
                authorization_code=flow.authorization_code,
            )
            # A provider authorization code is one-time.  Remove it from the
            # registry before any network call so concurrent polling can never
            # exchange it twice.
            flow.authorization_code = None
            flow.status = "exchanging"
            return claim

    def fail_callback(
        self,
        state: str,
        *,
        code: str = "oauth_access_denied",
        message: str = "登录已取消或未获授权。",
    ) -> str:
        try:
            callback_path, _app_origin = self.receive_failure(state)
        except AuthSessionError:
            return "/"
        return callback_path

    def finish_failure(
        self,
        grant: ProviderCallbackGrant,
        *,
        code: str,
        message: str,
    ) -> None:
        with self._lock:
            flow = self._flows.get(grant.flow_digest)
        if flow is None:
            return
        with flow.lock:
            if flow.status == "exchanging":
                flow.status = "failed"
                flow.error_code = code[:80]
                flow.error_message = message[:300]
                flow.code_verifier = ""

    def finish_success(
        self,
        grant: ProviderCallbackGrant,
        completion: ProviderLoginCompletion,
    ) -> None:
        with self._lock:
            flow = self._flows.get(grant.flow_digest)
        if flow is None:
            raise AuthSessionError(
                "oauth_flow_expired", "登录流程已过期，请重新开始。", status_code=400
            )
        with flow.lock:
            if flow.status != "exchanging":
                raise AuthSessionError(
                    "oauth_flow_consumed", "该登录流程已经完成。", status_code=409
                )
            flow.completion = completion
            flow.status = "authenticated"
            flow.code_verifier = ""

    def _flow(self, flow_id: str) -> _ProviderLoginFlow:
        if not flow_id or len(flow_id) > 256:
            raise AuthSessionError(
                "oauth_flow_not_found", "登录流程不存在或已过期。", status_code=404
            )
        with self._lock:
            self._prune_locked()
            flow = self._flows.get(_digest(flow_id))
        if flow is None:
            raise AuthSessionError(
                "oauth_flow_not_found", "登录流程不存在或已过期。", status_code=404
            )
        return flow

    def status(self, flow_id: str) -> dict[str, Any]:
        flow = self._flow(flow_id)
        with flow.lock:
            public_status = (
                "pending"
                if flow.status in {"pending", "callback_received", "exchanging"}
                else flow.status
            )
            result: dict[str, Any] = {
                "flowId": flow_id,
                "provider": flow.provider,
                "status": public_status,
                "expiresIn": max(0, int(flow.expires_at_epoch - time.time())),
                "pollAfterMs": 1_000,
            }
            if flow.status == "authenticated" and flow.completion is not None:
                result["user"] = dict(flow.completion.user)
                result["callbackPath"] = flow.completion.callback_path
            elif flow.status == "failed":
                result["error"] = {
                    "code": flow.error_code or "oauth_login_failed",
                    "message": flow.error_message or "登录未完成。",
                }
            return result

    def completion(self, flow_id: str) -> ProviderLoginCompletion | None:
        flow = self._flow(flow_id)
        with flow.lock:
            return flow.completion if flow.status == "authenticated" else None

    def consume_completion(
        self, flow_id: str, binding: str | None
    ) -> ProviderLoginCompletion:
        key = _digest(flow_id)
        with self._lock:
            self._prune_locked()
            flow = self._flows.get(key)
            if flow is None:
                raise AuthSessionError(
                    "oauth_flow_not_found",
                    "登录流程不存在或已过期。",
                    status_code=404,
                )
            with flow.lock:
                if (
                    not binding
                    or len(binding) > 256
                    or not secrets.compare_digest(
                        flow.binding_digest, _digest(binding)
                    )
                ):
                    raise AuthSessionError(
                        "oauth_flow_binding_invalid",
                        "登录流程不属于当前浏览器，请重新开始。",
                        status_code=403,
                    )
                if flow.status != "authenticated" or flow.completion is None:
                    raise AuthSessionError(
                        "oauth_flow_incomplete",
                        "登录流程尚未完成。",
                        status_code=409,
                    )
                completion = flow.completion
                self._flows.pop(key, None)
                self._states.pop(flow.state_digest, None)
                flow.authorization_code = None
                flow.code_verifier = ""
                flow.completion = None
                return completion

    def cancel(self, flow_id: str) -> ProviderLoginCompletion | None:
        key = _digest(flow_id)
        with self._lock:
            flow = self._flows.get(key)
            if flow is not None:
                with flow.lock:
                    self._flows.pop(key, None)
                    flow.authorization_code = None
                    flow.code_verifier = ""
                    completion = flow.completion
                self._states.pop(flow.state_digest, None)
            else:
                completion = None
        if flow is None:
            raise AuthSessionError(
                "oauth_flow_not_found", "登录流程不存在或已过期。", status_code=404
            )
        return completion

    def count(self) -> int:
        with self._lock:
            self._prune_locked()
            return len(self._flows)


def callback_redirect_path(callback_path: str, *, success: bool, error: str = "") -> str:
    """Append only a credential-free result marker to a local callback path."""

    safe = _safe_callback_path(callback_path)
    separator = "&" if "?" in safe else "?"
    query = urlencode(
        {"auth": "success"} if success else {"auth": "error", "code": error[:80]}
    )
    return f"{safe}{separator}{query}"


def callback_processing_path(callback_path: str) -> str:
    safe = _safe_callback_path(callback_path)
    separator = "&" if "?" in safe else "?"
    return f"{safe}{separator}{urlencode({'auth': 'processing'})}"
