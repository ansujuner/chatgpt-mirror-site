from __future__ import annotations

import base64
import copy
import datetime as datetime_module
import hashlib
import json
import logging
import os
import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping
from urllib.parse import quote

from curl_cffi import requests


LOGGER = logging.getLogger("chatgpt_guest_bridge.auth")

CHATGPT_ORIGIN = "https://chatgpt.com"
OPENAI_AUTH_ISSUER = os.getenv(
    "CHATGPT_OAUTH_ISSUER", "https://auth.openai.com"
).strip().rstrip("/")
# This is OpenAI's public native-app client identifier used by the browser
# OAuth/PKCE flow.  It is an identifier, not a client secret.  Keeping it
# configurable lets a deployment substitute another registered public client
# without ever putting a secret in browser code.
OPENAI_OAUTH_CLIENT_ID = os.getenv(
    "CHATGPT_OAUTH_CLIENT_ID", "app_EMoamEEZ73f0CkXaXp7hrann"
).strip()
OPENAI_OAUTH_TOKEN_ENDPOINT = f"{OPENAI_AUTH_ISSUER}/oauth/token"
SESSION_ENDPOINT = f"{CHATGPT_ORIGIN}/api/auth/session"
ME_ENDPOINT = f"{CHATGPT_ORIGIN}/backend-api/me"
ACCOUNTS_ENDPOINT = (
    f"{CHATGPT_ORIGIN}/backend-api/accounts/check/v4-2023-04-27"
    "?timezone_offset_min=-480"
)
MODELS_ENDPOINT = (
    f"{CHATGPT_ORIGIN}/backend-api/models"
    "?iim=false&is_gizmo=false&supports_model_picker_upgrade_presets=true"
)
WORK_MODELS_ENDPOINT = (
    f"{CHATGPT_ORIGIN}/backend-api/tpp/models/"
    "?supports_model_picker_upgrade_presets=true"
)
CONVERSATION_INIT_ENDPOINT = f"{CHATGPT_ORIGIN}/backend-api/conversation/init"
CODEX_USAGE_ENDPOINT = f"{CHATGPT_ORIGIN}/backend-api/wham/usage"
CODEX_RESET_CREDITS_ENDPOINT = (
    f"{CHATGPT_ORIGIN}/backend-api/wham/rate-limit-reset-credits"
)
CODEX_RESET_CREDITS_CONSUME_ENDPOINT = (
    f"{CODEX_RESET_CREDITS_ENDPOINT}/consume"
)
CODEX_DAILY_USAGE_ENDPOINT = (
    f"{CHATGPT_ORIGIN}/backend-api/wham/usage/daily-token-usage-breakdown"
)
CODEX_WORKSPACE_DAILY_USAGE_ENDPOINT = (
    f"{CHATGPT_ORIGIN}/backend-api/wham/usage/"
    "daily-workspace-user-token-usage-breakdown"
)
CODEX_DAILY_WORKSPACE_USAGE_COUNTS_ENDPOINT = (
    f"{CHATGPT_ORIGIN}/backend-api/wham/analytics/"
    "daily-workspace-usage-counts"
)
# The analytics counts endpoint reports actual product credits in
# ``data[].totals.credits``.  The older personal daily-token endpoint can
# instead return ``units: percent`` while still naming its per-model values
# ``credits``.  Only values proven to be credit-denominated reach this nominal
# conversion.  It is a comparison, not an API invoice.
CODEX_API_EQUIVALENT_CREDITS_PER_USD = 25.0
CODEX_API_EQUIVALENT_PRICING_AS_OF = "2026-08-31"
OPENAI_CREDIT_RATE_CARD_URL = "https://help.openai.com/en/articles/11481834"
OPENAI_API_PRICING_URL = "https://developers.openai.com/api/docs/pricing"
OPENAI_API_MODEL_CATALOG_URL = "https://developers.openai.com/api/docs/models/all"
ACCOUNT_REMAINING_BALANCE_ENDPOINT = (
    f"{CHATGPT_ORIGIN}/backend-api/accounts/{{account_id}}/remaining_balance"
)
WORKSPACE_MONTHLY_USAGE_ENDPOINT = (
    f"{CHATGPT_ORIGIN}/backend-api/accounts/{{account_id}}/"
    "spend-controls/current-user/monthly-usage?supports_usage_limit_modes=true"
)
WORKSPACE_USER_CREDIT_LIMIT_ENDPOINT = (
    f"{CHATGPT_ORIGIN}/backend-api/accounts/{{account_id}}/users/"
    "{user_id}/credit-limit"
)
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/136.0.0.0 Safari/537.36"
)

LOCAL_SESSION_COOKIE = "replica_account_session"
MAX_LOGIN_BODY_BYTES = 65_536
MAX_SESSION_INPUT_CHARS = 60_000

# The upstream cookie name is deliberately not part of the public API and may
# change. A complete Cookie header is the most reliable input. These names only
# provide best-effort compatibility for users who paste one opaque cookie value.
SESSION_COOKIE_CANDIDATES = (
    "__Secure-next-auth.session-token",
    "__Secure-authjs.session-token",
    "next-auth.session-token",
    "authjs.session-token",
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


AUTH_SESSION_TTL_SECONDS = _bounded_env_int(
    "CHATGPT_AUTH_SESSION_TTL", 43_200, 300, 86_400
)
AUTH_SESSION_IDLE_TTL_SECONDS = _bounded_env_int(
    "CHATGPT_AUTH_SESSION_IDLE_TTL", 10_800, 300, 43_200
)
AUTH_SESSION_MAX_ENTRIES = _bounded_env_int(
    "CHATGPT_AUTH_SESSION_MAX_ENTRIES", 32, 1, 256
)
AUTH_UPSTREAM_TIMEOUT_SECONDS = _bounded_env_int(
    "CHATGPT_AUTH_UPSTREAM_TIMEOUT", 25, 5, 120
)
AUTH_UPSTREAM_NETWORK_ATTEMPTS = _bounded_env_int(
    "CHATGPT_AUTH_UPSTREAM_NETWORK_ATTEMPTS", 3, 1, 5
)
CODEX_USAGE_CACHE_TTL_SECONDS = _bounded_env_int(
    "CHATGPT_CODEX_USAGE_CACHE_TTL", 30, 0, 300
)
MAX_CODEX_RESET_CREDITS = 64
MAX_CODEX_RESET_OPERATIONS = 32
MAX_CODEX_RESET_CREDIT_ID_CHARS = 256
MAX_CODEX_RESET_TITLE_CHARS = 240
MAX_CODEX_RESET_TYPE_CHARS = 80
MAX_CODEX_RESET_TIMESTAMP_CHARS = 80
# The competition hostname terminates TLS on a sandbox-local endpoint. Its
# certificate is not guaranteed to chain to the workstation trust store.
# Set this to true when pointing the bridge at an ordinarily trusted endpoint.
AUTH_VERIFY_TLS = os.getenv("CHATGPT_AUTH_VERIFY_TLS", "false").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}


class AuthSessionError(RuntimeError):
    """A credential-safe error which may be returned by the local API."""

    def __init__(self, code: str, message: str, *, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True)
class PublicAccount:
    id: str
    user_id: str
    name: str
    email: str
    initials: str
    plan: str
    plan_label: str

    def as_dict(self) -> dict[str, str]:
        return {
            "id": self.id,
            "userId": self.user_id,
            "name": self.name,
            "email": self.email,
            "initials": self.initials,
            "plan": self.plan,
            "planLabel": self.plan_label,
        }


@dataclass(frozen=True)
class UpstreamCredential:
    kind: str
    access_token: str = field(repr=False)
    access_token_expires_at_epoch: float | None
    cookie_header: str | None = field(repr=False)
    account_id: str
    user_id: str
    # OAuth refresh tokens are server-memory-only, just like an upstream Cookie
    # header.  repr=False is a second line of defence against accidental logs.
    refresh_token: str | None = field(default=None, repr=False)


@dataclass(frozen=True)
class AuthenticatedUpstream:
    account: PublicAccount
    credential: UpstreamCredential
    expires_at_epoch: float | None


@dataclass
class ResetCreditOperation:
    """One account-bound idempotent reset attempt.

    The upstream redeem request id is deliberately kept on the exact local
    auth entry.  Concurrent browser retries can therefore never reuse another
    account's result or accidentally consume a second reset credit.
    """

    credit_id: str | None
    result: dict[str, Any] | None = None


@dataclass
class LocalAuthEntry:
    account: PublicAccount
    credential: UpstreamCredential
    created_at_epoch: float
    absolute_expires_at_epoch: float
    last_access_monotonic: float
    lock: threading.RLock
    runtime_snapshot: dict[str, Any] | None = None
    runtime_cached_at_monotonic: float = 0.0
    # Usage is cached on the exact local auth entry rather than globally.  A
    # browser handle therefore cannot observe another selected workspace's
    # quota, even when two sessions belong to the same user.
    usage_snapshot: dict[str, Any] | None = None
    usage_cached_at_monotonic: float = 0.0
    reset_credit_operations: dict[str, ResetCreditOperation] = field(
        default_factory=dict, repr=False
    )


def _json_object(response: Any, *, stage: str) -> dict[str, Any]:
    try:
        value = response.json()
    except Exception as error:
        raise AuthSessionError(
            "upstream_invalid_response",
            "上游返回了无法识别的登录响应，请稍后重试。",
            status_code=502,
        ) from error
    if not isinstance(value, dict):
        raise AuthSessionError(
            "upstream_invalid_response",
            f"上游 {stage} 响应格式异常，请稍后重试。",
            status_code=502,
        )
    return value


def _request_json(
    http: Any,
    url: str,
    *,
    headers: Mapping[str, str],
    stage: str,
    method: str = "GET",
    json_body: Mapping[str, Any] | None = None,
    preserve_forbidden: bool = False,
) -> dict[str, Any]:
    # Login validation is a chain of idempotent GETs.  The sandbox HTTPS
    # forwarder can occasionally drop a TLS handshake; forcing the user to
    # paste the same credential again is both confusing and unnecessary.  Only
    # retry safe reads here: some other callers use this helper for stateful
    # POST operations which must never be replayed implicitly.
    network_attempts = (
        AUTH_UPSTREAM_NETWORK_ATTEMPTS if method.upper() in {"GET", "HEAD"} else 1
    )
    response: Any | None = None
    last_network_error: Exception | None = None
    for attempt in range(network_attempts):
        try:
            response = http.request(
                method,
                url,
                headers=dict(headers),
                json=dict(json_body) if json_body is not None else None,
                timeout=AUTH_UPSTREAM_TIMEOUT_SECONDS,
                allow_redirects=False,
                verify=AUTH_VERIFY_TLS,
            )
            last_network_error = None
            break
        except Exception as error:
            last_network_error = error
            if attempt + 1 < network_attempts:
                LOGGER.info(
                    "Transient upstream session validation failure at %s: %s "
                    "(attempt %s/%s)",
                    stage,
                    type(error).__name__,
                    attempt + 1,
                    network_attempts,
                )
                time.sleep(min(0.2 * (2**attempt), 0.8))

    if last_network_error is not None or response is None:
        error_name = (
            type(last_network_error).__name__ if last_network_error is not None else "NoResponse"
        )
        LOGGER.info(
            "Upstream session validation failed at %s after %s attempt(s): %s",
            stage,
            network_attempts,
            error_name,
        )
        raise AuthSessionError(
            "upstream_unavailable",
            "暂时无法连接账号验证服务，请稍后重试。",
            status_code=503,
        ) from last_network_error

    status = int(response.status_code)
    preserve_usage_forbidden = preserve_forbidden and stage.startswith("codex_")
    if status == 401 or (status == 403 and not preserve_usage_forbidden):
        raise AuthSessionError(
            "invalid_session",
            "Session 无效或已过期，请重新复制后再试。",
            status_code=401,
        )
    if status == 403:
        raise AuthSessionError(
            "usage_forbidden",
            "当前账号无权访问 Codex 用量信息。",
            status_code=403,
        )
    if status == 429:
        raise AuthSessionError(
            "upstream_rate_limited",
            "账号验证请求过于频繁，请稍后重试。",
            status_code=503,
        )
    if status != 200:
        LOGGER.info("Upstream session validation returned HTTP %s at %s", status, stage)
        raise AuthSessionError(
            "upstream_rejected",
            "上游暂时无法完成账号验证，请稍后重试。",
            status_code=502,
        )
    return _json_object(response, stage=stage)


def _new_http_session() -> Any:
    return requests.Session(
        impersonate="chrome136",
        headers={
            "Accept": "application/json",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "User-Agent": USER_AGENT,
        },
    )


def _contains_control_characters(value: str) -> bool:
    return any(ord(character) < 0x20 or ord(character) == 0x7F for character in value)


def _normalize_cookie_header(value: str) -> str:
    cookie_header = value.strip()
    if cookie_header[:7].lower() == "cookie:":
        cookie_header = cookie_header[7:].strip()
    if not cookie_header or _contains_control_characters(cookie_header):
        raise AuthSessionError(
            "invalid_session_input",
            "Cookie 字符串为空或包含非法控制字符。",
            status_code=400,
        )
    if "=" not in cookie_header:
        raise AuthSessionError(
            "invalid_session_input",
            "Cookie 字符串格式不正确。",
            status_code=400,
        )
    return cookie_header


def _session_from_cookie_header(
    cookie_header: str, *, refresh: bool = False
) -> tuple[dict[str, Any], str]:
    http = _new_http_session()
    try:
        payload = _request_json(
            http,
            SESSION_ENDPOINT + ("?refresh=true" if refresh else ""),
            headers={
                "Cookie": cookie_header,
                "Referer": f"{CHATGPT_ORIGIN}/",
            },
            stage="session",
        )
        access_token = payload.get("accessToken")
        if not isinstance(access_token, str) or not access_token.strip():
            raise AuthSessionError(
                "invalid_session",
                "Session 无效、已过期，或未包含可用的登录账号。",
                status_code=401,
            )
        return payload, access_token.strip()
    finally:
        try:
            http.close()
        except Exception:
            pass


def _decode_jwt_claims(token: str) -> dict[str, Any]:
    parts = token.split(".")
    if len(parts) != 3:
        return {}
    try:
        padded = parts[1] + "=" * (-len(parts[1]) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _nested_mapping(value: Any, *path: str) -> Mapping[str, Any]:
    current = value
    for key in path:
        if not isinstance(current, Mapping):
            return {}
        current = current.get(key)
    return current if isinstance(current, Mapping) else {}


def _string_at(value: Mapping[str, Any], *keys: str) -> str:
    for key in keys:
        candidate = value.get(key)
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return ""


def _session_metadata(payload: Mapping[str, Any]) -> tuple[Mapping[str, Any], Mapping[str, Any]]:
    nested = payload.get("session")
    if isinstance(nested, Mapping):
        payload = nested
    user = payload.get("user")
    account = payload.get("account")
    return (
        user if isinstance(user, Mapping) else {},
        account if isinstance(account, Mapping) else {},
    )


def _access_token_from_payload(payload: Mapping[str, Any]) -> str:
    nested = payload.get("session")
    if isinstance(nested, Mapping):
        payload = nested
    return _string_at(payload, "accessToken", "access_token")


def _account_entry(
    accounts_payload: Mapping[str, Any], preferred_account_id: str
) -> tuple[str, Mapping[str, Any]]:
    accounts = accounts_payload.get("accounts")
    if not isinstance(accounts, Mapping):
        return preferred_account_id, {}

    # A session can contain several personal/workspace accounts.  Once the
    # upstream session selected an account, never silently bind its token to a
    # different entry merely because the selected id is absent from a drifting
    # account-check response.  Doing so would expose the wrong plan/features to
    # the local UI and send subsequent chat requests with the wrong account id.
    if preferred_account_id:
        preferred = accounts.get(preferred_account_id)
        return (
            preferred_account_id,
            preferred if isinstance(preferred, Mapping) else {},
        )

    candidate_ids: list[str] = []
    ordering = accounts_payload.get("account_ordering")
    if isinstance(ordering, list):
        candidate_ids.extend(str(item) for item in ordering if isinstance(item, str))
    candidate_ids.extend(str(key) for key in accounts.keys())

    for account_id in candidate_ids:
        entry = accounts.get(account_id)
        if isinstance(entry, Mapping):
            return account_id, entry
    return preferred_account_id, {}


def _plan_from_sources(
    session_account: Mapping[str, Any], account_entry: Mapping[str, Any]
) -> str:
    account = account_entry.get("account")
    if not isinstance(account, Mapping):
        account = {}
    entitlement = account_entry.get("entitlement")
    if not isinstance(entitlement, Mapping):
        entitlement = {}
    # `/backend-api/accounts/check` is the current entitlement source.  The
    # bootstrap session's planType is only a hint and can remain stale after an
    # upgrade/downgrade, so it must be the final fallback rather than the first.
    candidates = (
        _string_at(account, "plan_type", "planType"),
        _string_at(entitlement, "subscription_plan", "subscriptionPlan"),
        _string_at(account_entry, "plan_type", "planType"),
        _string_at(session_account, "planType", "plan_type"),
    )
    first_unrecognized = ""
    for candidate in candidates:
        if candidate:
            compact = "".join(
                character
                for character in candidate.lower()
                if character.isalnum()
            ).replace("chatgpt", "")
            if "enterprise" in compact:
                return "enterprise"
            if "business" in compact:
                return "business"
            if "team" in compact:
                return "team"
            if "education" in compact or compact == "edu":
                return "edu"
            if "plus" in compact:
                return "plus"
            if compact == "pro" or compact.startswith("proplan"):
                return "pro"
            if compact == "go" or compact.startswith("goplan"):
                return "go"
            if "free" in compact:
                return "free"
            if compact not in {"", "none", "null", "unknown"} and not first_unrecognized:
                first_unrecognized = compact
    return first_unrecognized or "unknown"


def _plan_label(plan: str) -> str:
    normalized = plan.lower()
    if normalized == "free":
        return "免费版"
    if normalized == "plus":
        return "Plus"
    if normalized == "pro":
        return "Pro"
    if normalized in {"team", "business"}:
        return "Business"
    if normalized in {"enterprise", "edu"}:
        return "Enterprise" if normalized == "enterprise" else "Edu"
    if normalized == "go":
        return "Go"
    return "已验证账号"


def _initials(name: str, email: str) -> str:
    source = name.strip() or email.split("@", 1)[0].strip()
    if not source:
        return "U"
    words = [word for word in source.replace("_", " ").split() if word]
    if len(words) >= 2 and all(word[0].isascii() for word in words[:2]):
        return (words[0][0] + words[1][0]).upper()
    return source[0].upper()


def _access_token_expiry(access_token: str) -> float | None:
    exp = _decode_jwt_claims(access_token).get("exp")
    if isinstance(exp, (int, float)) and float(exp) > time.time():
        return float(exp)
    return None


def _expiry_from_sources(
    payload: Mapping[str, Any],
    access_token: str,
    *,
    include_access_token: bool,
) -> float | None:
    candidates: list[float] = []
    nested = payload.get("session")
    if isinstance(nested, Mapping):
        payload = nested
    expires = payload.get("expires")
    if isinstance(expires, (int, float)):
        candidates.append(float(expires))
    elif isinstance(expires, str) and expires.strip():
        try:
            parsed = datetime_module.datetime.fromisoformat(expires.replace("Z", "+00:00"))
            candidates.append(parsed.timestamp())
        except ValueError:
            pass
    if include_access_token:
        token_expiry = _access_token_expiry(access_token)
        if token_expiry is not None:
            candidates.append(token_expiry)
    viable = [candidate for candidate in candidates if candidate > time.time()]
    return min(viable) if viable else None


def _verify_access_token(
    access_token: str,
    session_payload: Mapping[str, Any],
    *,
    cookie_header: str | None,
    credential_kind: str,
) -> AuthenticatedUpstream:
    session_user, session_account = _session_metadata(session_payload)
    preferred_account_id = _string_at(session_account, "id", "accountId", "account_id")

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Referer": f"{CHATGPT_ORIGIN}/",
    }
    if cookie_header:
        headers["Cookie"] = cookie_header
    if preferred_account_id:
        headers["ChatGPT-Account-ID"] = preferred_account_id

    http = _new_http_session()
    try:
        me = _request_json(http, ME_ENDPOINT, headers=headers, stage="account")
        try:
            accounts = _request_json(
                http,
                ACCOUNTS_ENDPOINT,
                headers=headers,
                stage="accounts",
            )
        except AuthSessionError as error:
            # `/me` is the decisive bearer validation. Account enumeration is
            # enrichment only and can drift independently of authentication.
            if error.code == "invalid_session":
                raise
            LOGGER.info("Account plan enrichment unavailable: %s", error.code)
            accounts = {}
    finally:
        try:
            http.close()
        except Exception:
            pass

    user_id = _string_at(me, "id", "user_id", "userId") or _string_at(
        session_user, "id", "user_id", "userId"
    )
    expected_user_id = _string_at(session_user, "id", "user_id", "userId")
    if expected_user_id and user_id and expected_user_id != user_id:
        raise AuthSessionError(
            "session_identity_mismatch",
            "Session 中的账号信息与上游验证结果不一致。",
            status_code=401,
        )
    if not user_id:
        raise AuthSessionError(
            "upstream_invalid_response",
            "上游未返回可识别的账号信息。",
            status_code=502,
        )

    account_id, account_entry = _account_entry(accounts, preferred_account_id)
    account_id = account_id or preferred_account_id or user_id
    name = _string_at(me, "name") or _string_at(session_user, "name")
    email = _string_at(me, "email") or _string_at(session_user, "email")
    if not name:
        name = email.split("@", 1)[0] if email else "ChatGPT 用户"
    plan = _plan_from_sources(session_account, account_entry)
    public_account = PublicAccount(
        id=account_id,
        user_id=user_id,
        name=name,
        email=email,
        initials=_initials(name, email),
        plan=plan,
        plan_label=_plan_label(plan),
    )
    credential = UpstreamCredential(
        kind=credential_kind,
        access_token=access_token,
        access_token_expires_at_epoch=_access_token_expiry(access_token),
        cookie_header=cookie_header,
        account_id=account_id,
        user_id=user_id,
    )
    return AuthenticatedUpstream(
        account=public_account,
        credential=credential,
        expires_at_epoch=_expiry_from_sources(
            session_payload,
            access_token,
            include_access_token=cookie_header is None,
        ),
    )


def _json_session(value: str) -> Mapping[str, Any] | None:
    if not value.lstrip().startswith("{"):
        return None
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as error:
        raise AuthSessionError(
            "invalid_session_input",
            "Session JSON 格式不正确。",
            status_code=400,
        ) from error
    if not isinstance(parsed, Mapping):
        raise AuthSessionError(
            "invalid_session_input",
            "Session JSON 必须是一个对象。",
            status_code=400,
        )
    return parsed


def authenticate_session_input(value: str | Mapping[str, Any]) -> AuthenticatedUpstream:
    """Validate a pasted upstream session without logging or persisting it."""

    if isinstance(value, Mapping):
        parsed_json: Mapping[str, Any] | None = value
        text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    elif isinstance(value, str):
        text = value.strip()
        parsed_json = _json_session(text)
    else:
        raise AuthSessionError(
            "invalid_session_input",
            "session 必须是字符串或 Session JSON 对象。",
            status_code=400,
        )
    if not text or len(text) > MAX_SESSION_INPUT_CHARS:
        raise AuthSessionError(
            "invalid_session_input",
            "Session 不能为空，且长度不能超过 60000 个字符。",
            status_code=400,
        )
    if len(text) < 16:
        raise AuthSessionError(
            "invalid_session_input",
            "Session 内容过短，请检查后重新粘贴。",
            status_code=400,
        )

    if parsed_json is not None:
        access_token = _access_token_from_payload(parsed_json)
        if not access_token:
            raise AuthSessionError(
                "invalid_session_input",
                "Session JSON 中缺少 accessToken。",
                status_code=400,
            )
        return _verify_access_token(
            access_token,
            parsed_json,
            cookie_header=None,
            credential_kind="session_json",
        )

    if _contains_control_characters(text):
        raise AuthSessionError(
            "invalid_session_input",
            "Session 包含非法控制字符。",
            status_code=400,
        )

    lower = text.lower()
    if lower.startswith("cookie:") or ("=" in text and not lower.startswith("bearer ")):
        cookie_header = _normalize_cookie_header(text)
        session_payload, access_token = _session_from_cookie_header(cookie_header)
        return _verify_access_token(
            access_token,
            session_payload,
            cookie_header=cookie_header,
            credential_kind="cookie_header",
        )

    explicit_bearer = lower.startswith("bearer ")
    token = text[7:].strip() if explicit_bearer else text
    if not token:
        raise AuthSessionError(
            "invalid_session_input",
            "Bearer Token 不能为空。",
            status_code=400,
        )

    # A bearer is verified first. For an unlabelled opaque value, fall back to
    # the common upstream session-cookie names if it is not an access token.
    try:
        return _verify_access_token(
            token,
            {},
            cookie_header=None,
            credential_kind="access_token",
        )
    except AuthSessionError as bearer_error:
        if explicit_bearer or bearer_error.code not in {"invalid_session", "upstream_rejected"}:
            raise

    last_error: AuthSessionError | None = None
    for cookie_name in SESSION_COOKIE_CANDIDATES:
        cookie_header = f"{cookie_name}={token}"
        try:
            session_payload, access_token = _session_from_cookie_header(cookie_header)
            return _verify_access_token(
                access_token,
                session_payload,
                cookie_header=cookie_header,
                credential_kind="session_cookie",
            )
        except AuthSessionError as error:
            last_error = error
            if error.code not in {"invalid_session", "upstream_rejected"}:
                raise
    raise last_error or AuthSessionError(
        "invalid_session",
        "Session 无效或已过期，请重新复制后再试。",
        status_code=401,
    )


def _oauth_token_request(fields: Mapping[str, str], *, stage: str) -> dict[str, Any]:
    """Exchange an OAuth code/refresh token without ever logging its body."""

    http = _new_http_session()
    try:
        try:
            response = http.post(
                OPENAI_OAUTH_TOKEN_ENDPOINT,
                data=dict(fields),
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                timeout=AUTH_UPSTREAM_TIMEOUT_SECONDS,
                allow_redirects=False,
                verify=AUTH_VERIFY_TLS,
            )
        except Exception as error:
            LOGGER.info(
                "OAuth token transport failed at %s: %s",
                stage,
                type(error).__name__,
            )
            raise AuthSessionError(
                "oauth_upstream_unavailable",
                "暂时无法连接官方登录服务，请稍后重试。",
                status_code=503,
            ) from error

        status = int(response.status_code)
        if status in {400, 401, 403}:
            raise AuthSessionError(
                "oauth_grant_invalid",
                "官方登录授权无效或已过期，请重新登录。",
                status_code=401,
            )
        if status == 429:
            raise AuthSessionError(
                "oauth_rate_limited",
                "官方登录请求过于频繁，请稍后重试。",
                status_code=503,
            )
        if status != 200:
            LOGGER.info("OAuth token endpoint returned HTTP %s at %s", status, stage)
            raise AuthSessionError(
                "oauth_upstream_rejected",
                "官方登录服务暂时无法完成授权，请稍后重试。",
                status_code=502,
            )
        payload = _json_object(response, stage=stage)
        access_token = payload.get("access_token")
        if not isinstance(access_token, str) or not access_token.strip():
            raise AuthSessionError(
                "oauth_invalid_response",
                "官方登录服务没有返回可用的访问令牌。",
                status_code=502,
            )
        # Apply a conservative in-memory bound before any value reaches the
        # account registry.  Tokens are opaque and are never returned to the UI.
        if len(access_token) > MAX_SESSION_INPUT_CHARS:
            raise AuthSessionError(
                "oauth_invalid_response",
                "官方登录服务返回了异常的授权数据。",
                status_code=502,
            )
        refresh_token = payload.get("refresh_token")
        if refresh_token is not None and (
            not isinstance(refresh_token, str)
            or not refresh_token.strip()
            or len(refresh_token) > MAX_SESSION_INPUT_CHARS
        ):
            raise AuthSessionError(
                "oauth_invalid_response",
                "官方登录服务返回了异常的刷新授权数据。",
                status_code=502,
            )
        id_token = payload.get("id_token")
        if id_token is not None and (
            not isinstance(id_token, str)
            or not id_token.strip()
            or len(id_token) > MAX_SESSION_INPUT_CHARS
        ):
            raise AuthSessionError(
                "oauth_invalid_response",
                "官方登录服务返回了异常的身份数据。",
                status_code=502,
            )
        return payload
    finally:
        try:
            http.close()
        except Exception:
            pass


def authenticate_oauth_tokens(
    access_token: str,
    refresh_token: str | None,
    *,
    credential_kind: str = "oauth_browser",
    id_token: str | None = None,
    preferred_account_id: str | None = None,
) -> AuthenticatedUpstream:
    """Verify OAuth output and turn it into the existing account-session type."""

    session_payload: dict[str, Any] = {}
    account_id = (preferred_account_id or "").strip()
    plan_type = ""
    # OAuth's ID/access tokens are used only as an account-selection hint.  The
    # bearer and selected account are still verified through /backend-api/me
    # and accounts/check before a local session exists.
    for token in (id_token, access_token):
        if not isinstance(token, str) or not token.strip():
            continue
        claims = _decode_jwt_claims(token.strip())
        auth_claims = _nested_mapping(claims, "https://api.openai.com/auth")
        if not account_id:
            account_id = _string_at(
                auth_claims,
                "chatgpt_account_id",
                "account_id",
                "accountId",
            ) or _string_at(
                claims,
                "chatgpt_account_id",
                "account_id",
                "accountId",
            )
        if not plan_type:
            plan_type = _string_at(
                auth_claims,
                "chatgpt_plan_type",
                "plan_type",
                "planType",
            ) or _string_at(
                claims,
                "chatgpt_plan_type",
                "plan_type",
                "planType",
            )
    if account_id:
        session_payload["account"] = {
            "id": account_id,
            "planType": plan_type,
        }
    verified = _verify_access_token(
        access_token.strip(),
        session_payload,
        cookie_header=None,
        credential_kind=credential_kind,
    )
    credential = UpstreamCredential(
        kind=credential_kind,
        access_token=verified.credential.access_token,
        access_token_expires_at_epoch=verified.credential.access_token_expires_at_epoch,
        cookie_header=None,
        account_id=verified.credential.account_id,
        user_id=verified.credential.user_id,
        refresh_token=refresh_token.strip() if refresh_token else None,
    )
    # The local login is bounded by AuthSessionRegistry's absolute and idle
    # TTLs.  Do not truncate it to the short-lived bearer when a refresh grant
    # is available; ensure_fresh_credential will rotate that bearer in memory.
    return AuthenticatedUpstream(
        account=verified.account,
        credential=credential,
        expires_at_epoch=(
            None if credential.refresh_token else verified.expires_at_epoch
        ),
    )


def exchange_oauth_authorization_code(
    authorization_code: str,
    code_verifier: str,
    *,
    redirect_uri: str,
) -> AuthenticatedUpstream:
    """Exchange a device authorization code, then verify the ChatGPT account."""

    payload = _oauth_token_request(
        {
            "grant_type": "authorization_code",
            "client_id": OPENAI_OAUTH_CLIENT_ID,
            "code": authorization_code,
            "redirect_uri": redirect_uri,
            "code_verifier": code_verifier,
        },
        stage="oauth_authorization_code",
    )
    access_token = str(payload["access_token"]).strip()
    refresh = payload.get("refresh_token")
    id_token = payload.get("id_token")
    return authenticate_oauth_tokens(
        access_token,
        refresh.strip() if isinstance(refresh, str) else None,
        id_token=id_token.strip() if isinstance(id_token, str) else None,
    )


def refresh_local_auth_entry(entry: LocalAuthEntry) -> UpstreamCredential:
    """Refresh a short-lived access token from an in-memory login grant."""

    with entry.lock:
        current = entry.credential
        if current.cookie_header:
            session_payload, access_token = _session_from_cookie_header(
                current.cookie_header,
                refresh=True,
            )
            refreshed = _verify_access_token(
                access_token,
                session_payload,
                cookie_header=current.cookie_header,
                credential_kind=current.kind,
            )
        elif current.refresh_token:
            payload = _oauth_token_request(
                {
                    "grant_type": "refresh_token",
                    "client_id": OPENAI_OAUTH_CLIENT_ID,
                    "refresh_token": current.refresh_token,
                },
                stage="oauth_refresh",
            )
            next_refresh = payload.get("refresh_token")
            refreshed = authenticate_oauth_tokens(
                str(payload["access_token"]).strip(),
                (
                    next_refresh.strip()
                    if isinstance(next_refresh, str) and next_refresh.strip()
                    else current.refresh_token
                ),
                id_token=(
                    payload["id_token"].strip()
                    if isinstance(payload.get("id_token"), str)
                    else None
                ),
                preferred_account_id=current.account_id,
            )
        else:
            raise AuthSessionError(
                "session_refresh_unavailable",
                "当前登录仅包含短期 Token，请重新输入 Session。",
                status_code=401,
            )
        if (
            refreshed.account.id != entry.account.id
            or refreshed.account.user_id != entry.account.user_id
        ):
            raise AuthSessionError(
                "session_identity_mismatch",
                "刷新后的 Session 不再属于当前账号，请重新登录。",
                status_code=401,
            )
        entry.account = refreshed.account
        entry.credential = refreshed.credential
        # Entitlements can change together with a refreshed upstream session.
        # Never serve the model/plan snapshot captured for the old credential.
        entry.runtime_snapshot = None
        entry.runtime_cached_at_monotonic = 0.0
        entry.usage_snapshot = None
        entry.usage_cached_at_monotonic = 0.0
        return entry.credential


def ensure_fresh_credential(
    entry: LocalAuthEntry, *, minimum_validity_seconds: int = 90
) -> UpstreamCredential:
    credential = entry.credential
    expiry = credential.access_token_expires_at_epoch
    if expiry is None or expiry > time.time() + minimum_validity_seconds:
        return credential
    return refresh_local_auth_entry(entry)


def _credential_headers(credential: UpstreamCredential) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {credential.access_token}",
        "Accept": "application/json",
        "Referer": f"{CHATGPT_ORIGIN}/",
    }
    if credential.account_id:
        headers["ChatGPT-Account-ID"] = credential.account_id
    if credential.cookie_header:
        headers["Cookie"] = credential.cookie_header
    return headers


def _finite_number(value: Any) -> float | None:
    """Return a finite JSON number without accepting booleans."""

    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if number != number or number in {float("inf"), float("-inf")}:
        return None
    return number


def _finite_number_like(value: Any) -> float | None:
    """Accept the number-or-decimal-string convention used by WHAM balances."""

    number = _finite_number(value)
    if number is not None:
        return number
    if not isinstance(value, str) or not value.strip() or len(value) > 64:
        return None
    try:
        number = float(value.strip())
    except ValueError:
        return None
    if number != number or number in {float("inf"), float("-inf")}:
        return None
    return number


def _is_credit_unit(units: str | None) -> bool:
    return isinstance(units, str) and units.strip().lower() == "credits"


def _api_equivalent_usd(
    credits: float | int | None, *, units: str | None
) -> float | None:
    """Return a nominal Standard-rate comparison, never an actual API bill."""

    if not _is_credit_unit(units):
        return None
    safe_credits = _finite_number(credits)
    if safe_credits is None:
        return None
    # Eight decimal places keeps tiny legitimate values useful without leaking
    # binary floating point artifacts into the public JSON contract.
    return round(max(0.0, safe_credits) / CODEX_API_EQUIVALENT_CREDITS_PER_USD, 8)


def _api_equivalent_pricing(units: str | None) -> dict[str, Any]:
    """Describe the bounded estimate and the reasons it is not invoice data."""

    return {
        "kind": "nominal_api_equivalent",
        "estimated": True,
        "creditsPerUsd": CODEX_API_EQUIVALENT_CREDITS_PER_USD,
        "currency": "USD",
        "asOf": CODEX_API_EQUIVALENT_PRICING_AS_OF,
        "source": OPENAI_CREDIT_RATE_CARD_URL,
        "apiPricingSource": OPENAI_API_PRICING_URL,
        "sourceUrls": [
            OPENAI_CREDIT_RATE_CARD_URL,
            OPENAI_API_PRICING_URL,
            OPENAI_API_MODEL_CATALOG_URL,
        ],
        "methodology": "credits / creditsPerUsd",
        "available": _is_credit_unit(units),
        "note": (
            "Nominal Standard-rate API-equivalent estimate only; "
            "this is not an actual API bill."
        ),
        "limitations": [
            (
                "Fast or priority multipliers are already reflected in "
                "totals.credits and are not applied again."
            ),
            (
                "Aggregate input, cached-input, and output token counts may be "
                "present, but are not always split by model and speed."
            ),
            "The estimate remains credits / creditsPerUsd and is not an invoice.",
            "Long-context and tool fees can differ from this nominal estimate.",
        ],
    }


def _optional_bool(value: Mapping[str, Any], *keys: str) -> bool | None:
    for key in keys:
        candidate = value.get(key)
        if isinstance(candidate, bool):
            return candidate
    return None


def _safe_rate_window(value: Any) -> dict[str, Any] | None:
    """Normalize a WHAM rate-limit window to the UI's credential-free shape."""

    if not isinstance(value, Mapping):
        return None
    used = _finite_number(value.get("used_percent"))
    if used is None:
        used = _finite_number(value.get("usedPercent"))
    remaining = _finite_number(value.get("remaining_percent"))
    if remaining is None:
        remaining = _finite_number(value.get("remainingPercent"))
    duration_seconds = _finite_number(value.get("limit_window_seconds"))
    if duration_seconds is None:
        duration_seconds = _finite_number(value.get("limitWindowSeconds"))
    if duration_seconds is None:
        duration_minutes = _finite_number(value.get("window_duration_mins"))
        if duration_minutes is None:
            duration_minutes = _finite_number(value.get("windowDurationMins"))
        if duration_minutes is not None:
            duration_seconds = duration_minutes * 60.0
    reset_after = _finite_number(value.get("reset_after_seconds"))
    if reset_after is None:
        reset_after = _finite_number(value.get("resetAfterSeconds"))
    resets_at = _finite_number(value.get("reset_at"))
    if resets_at is None:
        resets_at = _finite_number(value.get("resetAt"))

    # A window must contain at least one real percentage.  In particular, never
    # let a missing value become `0` through Python/JS truthiness and then show
    # the account as either completely unused or completely exhausted.
    if used is None and remaining is None:
        return None

    # WHAM currently reports percent values and epoch seconds. Clamp only the
    # percentage; preserve the upstream timestamps/durations exactly enough for
    # the client to label Plus' rolling 5-hour (18,000 second) window.
    if used is not None:
        used = min(100.0, max(0.0, used))
    if remaining is not None:
        remaining = min(100.0, max(0.0, remaining))
    if used is None:
        assert remaining is not None
        used = 100.0 - remaining
    if remaining is None:
        remaining = 100.0 - used
    normalized: dict[str, Any] = {
        "usedPercent": used,
        "remainingPercent": round(remaining),
        "windowDurationMins": (
            None if duration_seconds is None else round(duration_seconds / 60.0)
        ),
        "resetsAt": None if resets_at is None else round(resets_at),
    }
    if reset_after is not None:
        normalized["resetAfterSeconds"] = max(0, round(reset_after))
    return normalized


def _safe_credit_status(payload: Mapping[str, Any]) -> dict[str, Any]:
    raw = payload.get("credits")
    if not isinstance(raw, Mapping):
        raw = {}
    balance = _finite_number_like(raw.get("balance"))
    return {
        "balance": balance,
        "currency": _string_at(raw, "currency", "unit")[:16] or None,
        "unlimited": _optional_bool(raw, "unlimited"),
        "hasCredits": _optional_bool(raw, "has_credits", "hasCredits"),
        "overageLimitReached": _optional_bool(
            raw, "overage_limit_reached", "overageLimitReached"
        ),
    }


def _safe_spend_control(payload: Mapping[str, Any]) -> dict[str, Any] | None:
    raw = payload.get("spend_control")
    if not isinstance(raw, Mapping):
        raw = payload.get("spendControl")
    if not isinstance(raw, Mapping):
        return None
    individual = raw.get("individual_limit")
    if not isinstance(individual, Mapping):
        individual = raw.get("individualLimit")
    safe_individual: dict[str, Any] | None = None
    if isinstance(individual, Mapping):
        safe_individual = {
            "limit": _finite_number_like(individual.get("limit")),
            "used": _finite_number_like(individual.get("used")),
            "remaining": _finite_number_like(individual.get("remaining")),
            "resetAt": _finite_number_like(
                individual.get("reset_at", individual.get("resetAt"))
            ),
            "unit": _string_at(individual, "unit", "currency")[:16] or None,
        }
    return {
        "allowed": _optional_bool(raw, "allowed"),
        "reached": _optional_bool(raw, "reached"),
        "individualLimit": safe_individual,
    }


def _safe_remaining_balance(payload: Mapping[str, Any] | None) -> dict[str, Any]:
    if not isinstance(payload, Mapping):
        return {
            "availability": "unavailable",
            "balance": None,
            "expiringBalanceDetails": [],
        }
    balance = _finite_number_like(payload.get("balance"))
    raw_expiring = payload.get("expiring_balance_details")
    if not isinstance(raw_expiring, list):
        raw_expiring = payload.get("expiringBalanceDetails")
    details: list[dict[str, Any]] = []
    if isinstance(raw_expiring, list):
        for raw in raw_expiring[:128]:
            if not isinstance(raw, Mapping):
                continue
            amount = _finite_number_like(
                raw.get("amount_remaining", raw.get("amountRemaining"))
            )
            expiry = _string_at(raw, "expiry_date", "expiryDate")[:40]
            if amount is None or not expiry:
                continue
            details.append(
                {"amountRemaining": max(0.0, amount), "expiryDate": expiry}
            )
    return {
        "availability": (
            "available"
            if balance is not None or isinstance(raw_expiring, list)
            else "unavailable"
        ),
        "balance": balance,
        "expiringBalanceDetails": details,
    }


def _limit_amount(value: Any) -> tuple[float | None, str | None]:
    if not isinstance(value, Mapping):
        return None, None
    amount_container = value.get("limit_amount")
    if not isinstance(amount_container, Mapping):
        amount_container = value.get("limitAmount")
    if isinstance(amount_container, Mapping):
        amount = _finite_number_like(amount_container.get("amount"))
        unit = _string_at(amount_container, "unit", "currency")[:16] or None
    else:
        amount = _finite_number_like(value.get("limit"))
        unit = _string_at(value, "unit", "currency")[:16] or None
    return amount, unit


def _safe_workspace_monthly_usage(
    payload: Mapping[str, Any] | None,
    *,
    user_credit_limit_payload: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    if not isinstance(payload, Mapping):
        return {"availability": "unavailable", "kind": None}

    effective = payload.get("effective_monthly_limit")
    if not isinstance(effective, Mapping):
        effective = payload.get("effectiveMonthlyLimit")
    balance_unit = _string_at(payload, "balance_unit", "balanceUnit")[:16] or None
    # ChatGPT Web uses a user hard cap for USD-denominated workspace limits.
    if balance_unit == "usd" and isinstance(user_credit_limit_payload, Mapping):
        hard_cap = user_credit_limit_payload.get("hard_cap_credit_limit")
        if not isinstance(hard_cap, Mapping):
            hard_cap = user_credit_limit_payload.get("hardCapCreditLimit")
        if isinstance(hard_cap, Mapping):
            effective = hard_cap
    if not isinstance(effective, Mapping):
        return {
            "availability": "unavailable",
            "kind": None,
            "balanceUnit": balance_unit,
        }

    limit, amount_unit = _limit_amount(effective)
    used = _finite_number_like(
        payload.get("current_month_usage", payload.get("currentMonthUsage"))
    )
    enforcement = _string_at(effective, "enforcement_mode", "enforcementMode")
    limit_mode = _string_at(effective, "limit_mode", "limitMode")
    unit = amount_unit or balance_unit
    reset_at = _finite_number_like(payload.get("reset_at", payload.get("resetAt")))

    if limit_mode == "unlimited_platform_max" and used is not None:
        return {
            "availability": "available",
            "kind": "unlimited",
            "limit": None,
            "used": max(0.0, used),
            "remaining": None,
            "usedPercent": None,
            "remainingPercent": None,
            "reached": False,
            "resetAt": reset_at,
            "unit": unit,
            "balanceUnit": balance_unit,
        }
    if enforcement.upper() != "HARD_CAP" or limit is None or used is None:
        return {
            "availability": "unavailable",
            "kind": None,
            "balanceUnit": balance_unit,
        }

    safe_limit = max(0.0, limit)
    safe_used = max(0.0, used)
    used_percent = 100 if safe_limit == 0 else round(safe_used / safe_limit * 100)
    used_percent = min(100, max(0, used_percent))
    return {
        "availability": "available",
        "kind": "limited",
        "limit": safe_limit,
        "used": safe_used,
        "remaining": max(0.0, safe_limit - safe_used),
        "usedPercent": used_percent,
        "remainingPercent": 100 - used_percent,
        "reached": safe_used >= safe_limit,
        "resetAt": reset_at,
        "unit": unit,
        "balanceUnit": balance_unit,
    }


def _reset_credit_count(*payloads: Mapping[str, Any] | None) -> int | None:
    for payload in payloads:
        if not isinstance(payload, Mapping):
            continue
        raw = payload.get("rate_limit_reset_credits")
        if not isinstance(raw, Mapping):
            raw = payload.get("rateLimitResetCredits")
        # The dedicated endpoint returns the object itself rather than nesting
        # it under `rate_limit_reset_credits`.
        if not isinstance(raw, Mapping) and any(
            key in payload for key in ("available_count", "availableCount", "credits")
        ):
            raw = payload
        if not isinstance(raw, Mapping):
            continue
        available = _finite_number_like(
            raw.get("available_count", raw.get("availableCount"))
        )
        if available is not None:
            return max(0, int(available))
    return None


def _bounded_reset_string(
    value: Any, maximum: int, *, truncate: bool = True
) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if len(normalized) > maximum:
        return normalized[:maximum] if truncate else None
    return normalized


def _sanitize_codex_reset_credits(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Return only display/selection fields required by the reset UI."""

    raw_credits = payload.get("credits")
    if not isinstance(raw_credits, list):
        raw_credits = []
    credits: list[dict[str, Any]] = []
    for raw in raw_credits[:MAX_CODEX_RESET_CREDITS]:
        if not isinstance(raw, Mapping):
            continue
        status = _bounded_reset_string(raw.get("status"), 32)
        # ChatGPT Web only renders credits which can still be consumed.  Do not
        # expose redeemed/expired history or its account/profile metadata.
        if status != "available":
            continue
        credit_id = _bounded_reset_string(
            raw.get("id"), MAX_CODEX_RESET_CREDIT_ID_CHARS, truncate=False
        )
        if credit_id is None:
            continue
        supported = raw.get(
            "is_supported_by_plan", raw.get("isSupportedByPlan")
        )
        reset_type = _bounded_reset_string(
            raw.get("reset_type", raw.get("resetType")),
            MAX_CODEX_RESET_TYPE_CHARS,
        )
        if reset_type not in {
            "codex_five_hour",
            "codex_weekly",
            "codex_rate_limits",
        }:
            reset_type = None
        credits.append(
            {
                "id": credit_id,
                "title": _bounded_reset_string(
                    raw.get("title"), MAX_CODEX_RESET_TITLE_CHARS
                ),
                "expiresAt": _bounded_reset_string(
                    raw.get("expires_at", raw.get("expiresAt")),
                    MAX_CODEX_RESET_TIMESTAMP_CHARS,
                ),
                "isSupportedByPlan": supported if isinstance(supported, bool) else None,
                "status": "available",
                "resetType": reset_type,
            }
        )
    return {
        "ok": True,
        "authenticated": True,
        "availableCount": _reset_credit_count(payload),
        "credits": credits,
    }


_CODEX_RESET_RESULT_CODES = {
    "reset",
    "already_redeemed",
    "no_credit",
    "nothing_to_reset",
}


def _sanitize_codex_reset_result(
    payload: Mapping[str, Any], *, requested_credit_id: str | None
) -> dict[str, Any]:
    code = payload.get("code")
    if not isinstance(code, str) or code not in _CODEX_RESET_RESULT_CODES:
        raise AuthSessionError(
            "upstream_invalid_response",
            "上游返回了无法识别的用量重置响应，请稍后重试。",
            status_code=502,
        )
    result: dict[str, Any] = {
        "ok": code == "reset",
        "authenticated": True,
        "code": code,
    }
    raw_credit = payload.get("credit")
    returned_credit_id = (
        _bounded_reset_string(
            raw_credit.get("id"), MAX_CODEX_RESET_CREDIT_ID_CHARS, truncate=False
        )
        if isinstance(raw_credit, Mapping)
        else None
    )
    # An explicit selection is the browser's account-bound resource. Never let
    # a drifting/malformed upstream response replace that identifier. Automatic
    # selection has no requested id, so it may use the returned credit id.
    credit_id = requested_credit_id or returned_credit_id
    if credit_id is not None:
        result["creditId"] = credit_id
    return result


def _safe_surface_usage(value: Any) -> dict[str, float]:
    if not isinstance(value, Mapping):
        return {}
    safe: dict[str, float] = {}
    for raw_name, raw_credits in list(value.items())[:64]:
        if not isinstance(raw_name, str) or not raw_name.strip():
            continue
        credits = _finite_number_like(raw_credits)
        if credits is None:
            continue
        safe[raw_name.strip()[:80]] = max(0.0, credits)
    return safe


def _safe_usage_date(value: Any) -> str:
    """Return the date portion of a bounded ISO date/date-time value."""

    if not isinstance(value, str):
        return ""
    normalized = value.strip()
    if len(normalized) < 10 or len(normalized) > 40:
        return ""
    date_part = normalized[:10]
    try:
        datetime_module.date.fromisoformat(date_part)
    except ValueError:
        return ""
    return date_part


def _strict_usage_date(value: Any) -> str:
    if not isinstance(value, str) or len(value) != 10 or value != value.strip():
        return ""
    return _safe_usage_date(value)


def _strict_nonnegative_number(value: Any) -> float | None:
    """Accept only a real JSON number from the captured analytics schema."""

    number = _finite_number(value)
    if number is None or number < 0:
        return None
    return number


def _strict_nonnegative_integer(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


def _safe_model_usage(value: Any, *, units: str | None) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    safe: list[dict[str, Any]] = []
    for raw in value[:128]:
        if not isinstance(raw, Mapping):
            continue
        model = _string_at(raw, "model", "model_slug", "modelSlug")[:100]
        credits = _finite_number_like(raw.get("credits"))
        if not model and credits is None:
            continue
        safe.append(
            {
                "model": model or None,
                "speed": _string_at(raw, "speed", "service_tier", "serviceTier")[:40]
                or None,
                "credits": None if credits is None else max(0.0, credits),
                "apiEquivalentUsd": _api_equivalent_usd(credits, units=units),
            }
        )
    return safe


def _safe_plan_usage_percent(value: Any) -> float | None:
    number = _finite_number_like(value)
    if number is None or number < 0:
        return None
    return min(100.0, number)


def _safe_plan_usage_models(value: Any) -> list[dict[str, Any]]:
    """Sanitize the legacy percent payload without relabelling it as credits."""

    if not isinstance(value, list):
        return []
    safe: list[dict[str, Any]] = []
    for raw in value[:128]:
        if not isinstance(raw, Mapping):
            continue
        model = _string_at(raw, "model", "model_slug", "modelSlug")[:100]
        plan_percent = _safe_plan_usage_percent(
            raw.get("percent", raw.get("usage_percent", raw.get("credits")))
        )
        if not model and plan_percent is None:
            continue
        safe.append(
            {
                "model": model or None,
                "speed": _string_at(raw, "speed", "service_tier", "serviceTier")[:40]
                or None,
                "planUsagePercent": plan_percent,
            }
        )
    return safe


def _safe_plan_surface_usage(value: Any) -> dict[str, float]:
    if not isinstance(value, Mapping):
        return {}
    safe: dict[str, float] = {}
    for raw_name, raw_percent in list(value.items())[:64]:
        if not isinstance(raw_name, str) or not raw_name.strip():
            continue
        plan_percent = _safe_plan_usage_percent(raw_percent)
        if plan_percent is None:
            continue
        safe[raw_name.strip()[:80]] = plan_percent
    return safe


def _empty_daily_usage(units: str | None) -> dict[str, Any]:
    return {
        "availability": "unavailable",
        "units": units,
        "groupBy": None,
        "summary": {"rangeCredits": None, "apiEquivalentUsd": None},
        "dailyUsageBuckets": [],
        "pricing": _api_equivalent_pricing(units),
    }


def _sanitize_percent_daily_usage(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Keep Plus allowance percentages distinct from spendable credits."""

    raw_buckets: list[Any] | None = None
    for key in (
        "daily_usage_buckets",
        "dailyUsageBuckets",
        "buckets",
        "data",
        "items",
    ):
        candidate = payload.get(key)
        if isinstance(candidate, list):
            raw_buckets = candidate
            break
    if raw_buckets is None:
        nested = payload.get("usage")
        if isinstance(nested, Mapping):
            return _sanitize_percent_daily_usage(nested)
        return _empty_daily_usage("percent")

    buckets: list[dict[str, Any]] = []
    seen_dates: set[str] = set()
    for raw in raw_buckets[:366]:
        if not isinstance(raw, Mapping):
            continue
        date = _safe_usage_date(
            raw.get(
                "date",
                raw.get(
                    "day",
                    raw.get(
                        "start_date",
                        raw.get("startDate", raw.get("start_time", raw.get("startTime"))),
                    ),
                ),
            )
        )
        if not date or date in seen_dates:
            continue
        seen_dates.add(date)
        models = _safe_plan_usage_models(raw.get("models"))
        surfaces = _safe_plan_surface_usage(
            raw.get(
                "product_surface_usage_values",
                raw.get("productSurfaceUsageValues"),
            )
        )
        explicit_percent = None
        for key in ("plan_usage_percent", "planUsagePercent", "usage_percent", "percent", "credits"):
            if key in raw:
                explicit_percent = _safe_plan_usage_percent(raw.get(key))
                if explicit_percent is not None:
                    break
        if explicit_percent is not None:
            plan_percent = explicit_percent
        else:
            model_values = [
                model["planUsagePercent"]
                for model in models
                if isinstance(model.get("planUsagePercent"), (int, float))
            ]
            if model_values:
                plan_percent = min(100.0, sum(model_values))
            elif surfaces:
                plan_percent = min(100.0, sum(surfaces.values()))
            else:
                plan_percent = None
        buckets.append(
            {
                "date": date,
                # These values are allowance percentages.  Null credit fields
                # keep old clients from accidentally pricing them.
                "credits": None,
                "apiEquivalentUsd": None,
                "models": [],
                "productSurfaceUsageValues": {},
                "productSurfaceApiEquivalentUsd": {},
                "surfaces": [],
                "planUsagePercent": plan_percent,
                "planUsageModels": models,
                "productSurfaceUsagePercentValues": surfaces,
                "planUsageSurfaces": [
                    {"surface": surface, "planUsagePercent": percent}
                    for surface, percent in surfaces.items()
                ],
            }
        )
    available = not raw_buckets or bool(buckets)
    return {
        "availability": "available" if available else "unavailable",
        "units": "percent",
        "groupBy": _string_at(payload, "group_by", "groupBy")[:20] or None,
        "summary": {"rangeCredits": None, "apiEquivalentUsd": None},
        "dailyUsageBuckets": sorted(buckets, key=lambda bucket: bucket["date"]),
        "pricing": _api_equivalent_pricing("percent"),
    }


def _sanitize_daily_usage(payload: Mapping[str, Any] | None) -> dict[str, Any]:
    if not isinstance(payload, Mapping):
        return _empty_daily_usage(None)

    units = _string_at(payload, "units")[:40] or None
    if isinstance(units, str) and units.strip().lower() == "percent":
        return _sanitize_percent_daily_usage(payload)

    raw_buckets: list[Any] | None = None
    for key in (
        "daily_usage_buckets",
        "dailyUsageBuckets",
        "buckets",
        "data",
        "items",
    ):
        candidate = payload.get(key)
        if isinstance(candidate, list):
            raw_buckets = candidate
            break
    if raw_buckets is None:
        nested = payload.get("usage")
        if isinstance(nested, Mapping):
            return _sanitize_daily_usage(nested)
        return _empty_daily_usage(units)

    buckets: list[dict[str, Any]] = []
    for raw in raw_buckets[:366]:
        if not isinstance(raw, Mapping):
            continue
        date = _safe_usage_date(
            _string_at(
                raw,
                "date",
                "day",
                "start_date",
                "startDate",
                "start_time",
                "startTime",
            )
        )
        if not date:
            continue
        models = _safe_model_usage(raw.get("models"), units=units)
        surfaces = _safe_surface_usage(
            raw.get(
                "product_surface_usage_values",
                raw.get("productSurfaceUsageValues"),
            )
        )
        explicit_credits = _finite_number_like(raw.get("credits"))
        if explicit_credits is not None:
            credits: float | None = max(0.0, explicit_credits)
        else:
            model_credits = [
                model["credits"]
                for model in models
                if isinstance(model.get("credits"), (int, float))
            ]
            if model_credits:
                credits = sum(model_credits)
            elif surfaces:
                credits = sum(surfaces.values())
            else:
                credits = None
        safe_surfaces = [
            {
                "surface": surface,
                "credits": surface_credits,
                "apiEquivalentUsd": _api_equivalent_usd(
                    surface_credits, units=units
                ),
            }
            for surface, surface_credits in surfaces.items()
        ]
        buckets.append(
            {
                "date": date,
                "credits": credits,
                "apiEquivalentUsd": _api_equivalent_usd(credits, units=units),
                "models": models,
                "productSurfaceUsageValues": surfaces,
                "productSurfaceApiEquivalentUsd": {
                    surface: _api_equivalent_usd(surface_credits, units=units)
                    for surface, surface_credits in surfaces.items()
                },
                "surfaces": safe_surfaces,
            }
        )
    bucket_credits = [
        bucket["credits"]
        for bucket in buckets
        if isinstance(bucket.get("credits"), (int, float))
    ]
    available = not raw_buckets or bool(buckets)
    range_credits = (
        sum(bucket_credits)
        if available and len(bucket_credits) == len(buckets)
        else 0.0
        if available and not buckets
        else None
    )
    return {
        # An upstream empty list is a real empty result.  A non-empty list with
        # an unknown schema is unavailable, not a fabricated zero-credit range.
        "availability": "available" if available else "unavailable",
        "units": units,
        "groupBy": _string_at(payload, "group_by", "groupBy")[:20] or None,
        "summary": {
            "rangeCredits": range_credits,
            "apiEquivalentUsd": _api_equivalent_usd(range_credits, units=units),
        },
        "dailyUsageBuckets": sorted(buckets, key=lambda bucket: bucket["date"]),
        "pricing": _api_equivalent_pricing(units),
    }


_COUNT_INTEGER_FIELDS = {
    "users": "users",
    "threads": "threads",
    "turns": "turns",
    "uncached_text_input_tokens": "uncachedTextInputTokens",
    "cached_text_input_tokens": "cachedTextInputTokens",
    "text_output_tokens": "textOutputTokens",
    "text_total_tokens": "textTotalTokens",
}


def _safe_usage_count_fields(value: Mapping[str, Any]) -> dict[str, Any]:
    safe: dict[str, Any] = {}
    for upstream_key, public_key in _COUNT_INTEGER_FIELDS.items():
        safe[public_key] = _strict_nonnegative_integer(value.get(upstream_key))
    return safe


def _safe_workspace_usage_models(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    safe: list[dict[str, Any]] = []
    for raw in value[:128]:
        if not isinstance(raw, Mapping):
            continue
        model = _string_at(raw, "model")[:100]
        if not model:
            continue
        credits = _strict_nonnegative_number(raw.get("credits"))
        item = {
            "model": model,
            "speed": None,
            "credits": credits,
            "apiEquivalentUsd": _api_equivalent_usd(credits, units="credits"),
        }
        item.update(_safe_usage_count_fields(raw))
        safe.append(item)
    return safe


def _safe_workspace_usage_clients(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    safe: list[dict[str, Any]] = []
    for raw in value[:128]:
        if not isinstance(raw, Mapping):
            continue
        client_id = _string_at(raw, "client_id")[:100]
        if not client_id:
            continue
        credits = _strict_nonnegative_number(raw.get("credits"))
        item = {
            "clientId": client_id,
            "credits": credits,
            "apiEquivalentUsd": _api_equivalent_usd(credits, units="credits"),
        }
        item.update(_safe_usage_count_fields(raw))
        safe.append(item)
    return safe


def _invalidate_over_total_breakdown(
    items: list[dict[str, Any]], total_credits: float | None
) -> None:
    """Fail closed when a detail series cannot reconcile to its total."""

    if total_credits is None:
        return
    known = sum(
        item["credits"]
        for item in items
        if isinstance(item.get("credits"), (int, float))
    )
    epsilon = max(1e-6, abs(total_credits) * 1e-6)
    if known <= total_credits + epsilon:
        return
    for item in items:
        item["credits"] = None
        item["apiEquivalentUsd"] = None


def _sanitize_daily_workspace_usage_counts(
    payload: Mapping[str, Any] | None,
) -> dict[str, Any]:
    """Whitelist the captured daily-workspace-usage-counts response.

    Unlike the legacy daily-token endpoint, this endpoint has an explicit
    ``totals.credits`` field.  That exact field is authoritative for daily
    credit spend; model and client totals are details and are never re-summed
    into a second total.
    """

    if not isinstance(payload, Mapping):
        return _empty_daily_usage(None)
    group_by = _string_at(payload, "group_by")[:20] or None
    if group_by not in {None, "day"}:
        return _empty_daily_usage(None)
    raw_buckets = payload.get("data")
    if not isinstance(raw_buckets, list):
        return _empty_daily_usage(None)

    buckets: list[dict[str, Any]] = []
    seen_dates: set[str] = set()
    for raw in raw_buckets[:366]:
        if not isinstance(raw, Mapping):
            continue
        date = _strict_usage_date(raw.get("date"))
        totals = raw.get("totals")
        if not date or date in seen_dates or not isinstance(totals, Mapping):
            continue
        seen_dates.add(date)
        credits = _strict_nonnegative_number(totals.get("credits"))
        clients = _safe_workspace_usage_clients(raw.get("clients"))
        models = _safe_workspace_usage_models(raw.get("models"))
        _invalidate_over_total_breakdown(clients, credits)
        _invalidate_over_total_breakdown(models, credits)
        client_credits: dict[str, float] = {}
        for client in clients:
            client_id = client["clientId"]
            client_credit_value = client.get("credits")
            if isinstance(client_credit_value, (int, float)):
                client_credits[client_id] = (
                    client_credits.get(client_id, 0.0) + client_credit_value
                )
        safe_totals = {
            "credits": credits,
            "apiEquivalentUsd": _api_equivalent_usd(credits, units="credits"),
        }
        safe_totals.update(_safe_usage_count_fields(totals))
        buckets.append(
            {
                "date": date,
                "credits": credits,
                "apiEquivalentUsd": _api_equivalent_usd(credits, units="credits"),
                "totals": safe_totals,
                "models": models,
                "clients": clients,
                # The current UI already understands its surface shape. WHAM's
                # analytics endpoint calls the same dimension ``clients``.
                # This is a breakdown only; totals.credits remains authoritative.
                "productSurfaceUsageValues": client_credits,
                "productSurfaceApiEquivalentUsd": {
                    client_id: _api_equivalent_usd(
                        client_credit_value, units="credits"
                    )
                    for client_id, client_credit_value in client_credits.items()
                },
                "surfaces": [
                    {
                        "surface": client_id,
                        "credits": client_credit_value,
                        "apiEquivalentUsd": _api_equivalent_usd(
                            client_credit_value, units="credits"
                        ),
                    }
                    for client_id, client_credit_value in client_credits.items()
                ],
            }
        )
    available = not raw_buckets or bool(buckets)
    bucket_credits = [
        bucket["credits"]
        for bucket in buckets
        if isinstance(bucket.get("credits"), (int, float))
    ]
    range_credits = (
        sum(bucket_credits)
        if available and len(bucket_credits) == len(buckets)
        else 0.0
        if available and not buckets
        else None
    )
    return {
        "availability": "available" if available else "unavailable",
        "units": "credits" if available else None,
        "groupBy": group_by,
        "summary": {
            "rangeCredits": range_credits,
            "apiEquivalentUsd": _api_equivalent_usd(
                range_credits, units="credits" if available else None
            ),
        },
        "dailyUsageBuckets": sorted(buckets, key=lambda bucket: bucket["date"]),
        "pricing": _api_equivalent_pricing("credits" if available else None),
    }


def _merge_daily_usage(
    daily_usage_counts_payload: Mapping[str, Any] | None,
    daily_plan_usage_payload: Mapping[str, Any] | None,
) -> dict[str, Any]:
    """Join actual credit counts and plan allowance percentages by UTC date."""

    counts = _sanitize_daily_workspace_usage_counts(daily_usage_counts_payload)
    plan = _sanitize_daily_usage(daily_plan_usage_payload)
    if counts["availability"] != "available":
        return plan if plan["availability"] == "available" else counts

    merged = copy.deepcopy(counts)
    by_date = {bucket["date"]: bucket for bucket in merged["dailyUsageBuckets"]}
    plan_is_percent = plan.get("units") == "percent"
    plan_is_credits = _is_credit_unit(plan.get("units"))
    if plan["availability"] == "available":
        for plan_bucket in plan["dailyUsageBuckets"]:
            date = plan_bucket["date"]
            bucket = by_date.get(date)
            if bucket is None:
                bucket = {
                    "date": date,
                    "credits": None,
                    "apiEquivalentUsd": None,
                    "totals": None,
                    "models": [],
                    "clients": [],
                    "productSurfaceUsageValues": {},
                    "productSurfaceApiEquivalentUsd": {},
                    "surfaces": [],
                }
                by_date[date] = bucket
            if plan_is_percent:
                for key in (
                    "planUsagePercent",
                    "planUsageModels",
                    "productSurfaceUsagePercentValues",
                    "planUsageSurfaces",
                ):
                    bucket[key] = copy.deepcopy(plan_bucket.get(key))
            elif plan_is_credits:
                # The counts total remains authoritative, but the older credit
                # response can add a product-surface breakdown absent from the
                # counts schema.
                if not bucket.get("surfaces"):
                    for key in (
                        "productSurfaceUsageValues",
                        "productSurfaceApiEquivalentUsd",
                        "surfaces",
                    ):
                        bucket[key] = copy.deepcopy(plan_bucket.get(key))

    merged_buckets = sorted(by_date.values(), key=lambda bucket: bucket["date"])
    known_credits = [
        bucket["credits"]
        for bucket in merged_buckets
        if isinstance(bucket.get("credits"), (int, float))
    ]
    range_credits = (
        sum(known_credits)
        if len(known_credits) == len(merged_buckets)
        else 0.0
        if not merged_buckets
        else None
    )
    merged["dailyUsageBuckets"] = merged_buckets
    merged["summary"] = {
        "rangeCredits": range_credits,
        "apiEquivalentUsd": _api_equivalent_usd(range_credits, units="credits"),
    }
    merged["planUsage"] = {
        "availability": plan["availability"],
        "units": plan.get("units"),
        "groupBy": plan.get("groupBy"),
    }
    return merged


def _sanitize_codex_usage(
    payload: Mapping[str, Any],
    *,
    reset_credits_payload: Mapping[str, Any] | None = None,
    daily_usage_payload: Mapping[str, Any] | None = None,
    daily_usage_counts_payload: Mapping[str, Any] | None = None,
    remaining_balance_payload: Mapping[str, Any] | None = None,
    workspace_monthly_payload: Mapping[str, Any] | None = None,
    workspace_user_credit_limit_payload: Mapping[str, Any] | None = None,
    optional_errors: Mapping[str, str] | None = None,
    plan_fallback: str = "",
    daily_usage_scope: str = "personal",
) -> dict[str, Any]:
    """Whitelist the current account's live quota, workspace spend and usage."""

    rate_limit = payload.get("rate_limit")
    if not isinstance(rate_limit, Mapping):
        rate_limit = payload.get("rateLimit")
    if not isinstance(rate_limit, Mapping):
        rate_limit = {}

    primary = _safe_rate_window(
        rate_limit.get("primary_window", rate_limit.get("primaryWindow"))
    )
    secondary = _safe_rate_window(
        rate_limit.get("secondary_window", rate_limit.get("secondaryWindow"))
    )
    representative_window = primary or secondary

    plan_type = _string_at(payload, "plan_type", "planType")[:64] or plan_fallback
    allowed = _optional_bool(rate_limit, "allowed")
    limit_reached = _optional_bool(rate_limit, "limit_reached", "limitReached")
    credits = _safe_credit_status(payload)
    spend_control = _safe_spend_control(payload)
    # Match the captured ChatGPT Web predicate exactly:
    # unlimited || has_credits || Number(balance) >= 20.  The numeric threshold
    # is not an invented local quota; it is the upstream UI's minimum usable
    # credit-balance branch before it treats an included limit as exhausted.
    has_fallback_credit = (
        credits["unlimited"] is True
        or credits["hasCredits"] is True
        or (
            isinstance(credits["balance"], (int, float))
            and credits["balance"] >= 20
        )
    )
    reached_type = payload.get("rate_limit_reached_type")
    if not isinstance(reached_type, Mapping):
        reached_type = payload.get("rateLimitReachedType")
    safe_reached_type = (
        _string_at(reached_type, "type")[:100]
        if isinstance(reached_type, Mapping)
        else ""
    )
    hard_reached_types = {
        "workspace_owner_credits_depleted",
        "workspace_member_credits_depleted",
        "workspace_owner_usage_limit_reached",
        "workspace_member_usage_limit_reached",
    }
    hard_workspace_reached = (
        credits["overageLimitReached"] is True
        or (
            isinstance(spend_control, Mapping)
            and spend_control.get("reached") is True
        )
        or safe_reached_type in hard_reached_types
    )
    if hard_workspace_reached:
        effective_limit_reached: bool | None = True
    elif limit_reached is True or allowed is False:
        effective_limit_reached = not has_fallback_credit
    elif limit_reached is False or allowed is True or has_fallback_credit:
        effective_limit_reached = False
    else:
        effective_limit_reached = None
    if representative_window is not None:
        availability = "available"
    elif credits["unlimited"] is True:
        availability = "unlimited"
    else:
        availability = "unavailable"

    daily_usage_counts = _sanitize_daily_workspace_usage_counts(
        daily_usage_counts_payload
    )
    daily_usage = _merge_daily_usage(
        daily_usage_counts_payload,
        daily_usage_payload,
    )
    daily_usage["scope"] = daily_usage_scope
    is_workspace = plan_type.strip().lower() in {
        "team",
        "business",
        "enterprise",
        "edu",
    }
    monthly_usage = (
        _safe_workspace_monthly_usage(
            workspace_monthly_payload,
            user_credit_limit_payload=workspace_user_credit_limit_payload,
        )
        if is_workspace
        else {"availability": "not_applicable", "kind": None}
    )
    if monthly_usage.get("reached") is True:
        effective_limit_reached = True
    remaining_balance = _safe_remaining_balance(remaining_balance_payload)
    return {
        "ok": True,
        "live": True,
        "authenticated": True,
        "availability": availability,
        "source": "chatgpt-wham",
        "fetchedAt": datetime_module.datetime.now(datetime_module.timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
        "planType": plan_type,
        "quota": {
            "remainingPercent": (
                representative_window["remainingPercent"]
                if representative_window is not None
                else None
            ),
            "primary": primary,
            "secondary": secondary,
            "allowed": allowed,
            "limitReached": limit_reached,
            "effectiveLimitReached": effective_limit_reached,
            "resetCredits": {
                "availableCount": _reset_credit_count(
                    reset_credits_payload, payload
                )
            },
            "credits": credits,
            "spendControl": spend_control,
            "reachedType": safe_reached_type or None,
        },
        "rateLimits": {"primary": primary, "secondary": secondary},
        "usage": daily_usage,
        "workspace": {
            "scope": "workspace" if is_workspace else "personal",
            "remainingBalance": remaining_balance,
            "monthlyUsage": monthly_usage,
        },
        "upstream": {
            "usage": "available",
            "resetCredits": (
                "available"
                if _reset_credit_count(reset_credits_payload) is not None
                else "unavailable"
            ),
            "dailyUsage": daily_usage["availability"],
            "dailyUsageCounts": daily_usage_counts["availability"],
            "remainingBalance": remaining_balance["availability"],
            "workspaceMonthlyUsage": monthly_usage["availability"],
            "optionalErrors": dict(optional_errors or {}),
        },
    }


def _daily_usage_date_range() -> tuple[datetime_module.date, datetime_module.date]:
    end = datetime_module.datetime.now(datetime_module.timezone.utc).date()
    return end - datetime_module.timedelta(days=29), end


def _daily_usage_url(
    plan: str,
    *,
    date_range: tuple[datetime_module.date, datetime_module.date] | None = None,
) -> tuple[str, str]:
    normalized = plan.strip().lower()
    is_workspace = normalized in {"team", "business", "enterprise", "edu"}
    endpoint = (
        CODEX_WORKSPACE_DAILY_USAGE_ENDPOINT
        if is_workspace
        else CODEX_DAILY_USAGE_ENDPOINT
    )
    start, end = date_range or _daily_usage_date_range()
    return (
        f"{endpoint}?start_date={start.isoformat()}&end_date={end.isoformat()}"
        "&group_by=day",
        "workspace-user" if is_workspace else "personal",
    )


def _daily_workspace_usage_counts_url(
    *,
    date_range: tuple[datetime_module.date, datetime_module.date] | None = None,
) -> str:
    start, end = date_range or _daily_usage_date_range()
    return (
        f"{CODEX_DAILY_WORKSPACE_USAGE_COUNTS_ENDPOINT}"
        f"?start_date={start.isoformat()}&end_date={end.isoformat()}"
        "&group_by=day&workspace_user=true"
    )


def _bound_account_url(template: str, credential: UpstreamCredential) -> str:
    return template.format(
        account_id=quote(credential.account_id, safe=""),
        user_id=quote(credential.user_id, safe=""),
    )


def _workspace_monthly_uses_usd(payload: Mapping[str, Any] | None) -> bool:
    if not isinstance(payload, Mapping):
        return False
    if _string_at(payload, "balance_unit", "balanceUnit").lower() == "usd":
        return True
    effective = payload.get("effective_monthly_limit")
    if not isinstance(effective, Mapping):
        effective = payload.get("effectiveMonthlyLimit")
    _, unit = _limit_amount(effective)
    return unit == "usd"


def fetch_codex_usage(
    entry: LocalAuthEntry,
    *,
    cache_ttl_seconds: int = CODEX_USAGE_CACHE_TTL_SECONDS,
) -> dict[str, Any]:
    """Fetch the live Codex quota for this exact in-memory login session.

    The browser only supplies its opaque local HttpOnly session handle. The
    upstream bearer/cookie remain server-side and are never included in the
    result or log output.
    """

    with entry.lock:
        now = time.monotonic()
        if (
            cache_ttl_seconds > 0
            and entry.usage_snapshot is not None
            and now - entry.usage_cached_at_monotonic < cache_ttl_seconds
        ):
            return copy.deepcopy(entry.usage_snapshot)

        credential = ensure_fresh_credential(entry)
        headers = _credential_headers(credential)
        http = _new_http_session()
        refreshed = False

        def request(endpoint: str, stage: str) -> dict[str, Any]:
            nonlocal credential, headers, refreshed
            try:
                return _request_json(
                    http,
                    endpoint,
                    headers=headers,
                    stage=stage,
                    preserve_forbidden=True,
                )
            except AuthSessionError as error:
                if error.code != "invalid_session" or refreshed:
                    raise
                # A cookie-backed login can mint a fresh short-lived bearer.
                # Bearer-only logins fail closed and must be authorized again.
                credential = refresh_local_auth_entry(entry)
                headers = _credential_headers(credential)
                refreshed = True
                return _request_json(
                    http,
                    endpoint,
                    headers=headers,
                    stage=stage,
                    preserve_forbidden=True,
                )

        optional_errors: dict[str, str] = {}

        def optional_request(endpoint: str, stage: str) -> dict[str, Any] | None:
            try:
                return request(endpoint, stage)
            except AuthSessionError as error:
                # A second 401 means the selected login is no longer usable and
                # must invalidate the local handle.  Feature/plan/transient
                # failures on enrichment endpoints leave the live quota intact.
                if error.status_code == 401:
                    raise
                optional_errors[stage] = error.code
                return None

        try:
            payload = request(CODEX_USAGE_ENDPOINT, "codex_usage")
            reset_payload = optional_request(
                CODEX_RESET_CREDITS_ENDPOINT, "codex_reset_credits"
            )
            daily_date_range = _daily_usage_date_range()
            daily_url, daily_scope = _daily_usage_url(
                entry.account.plan,
                date_range=daily_date_range,
            )
            daily_usage_counts_payload = optional_request(
                _daily_workspace_usage_counts_url(date_range=daily_date_range),
                "codex_daily_workspace_usage_counts",
            )
            # Fetch actual credits first.  The legacy daily-token enrichment is
            # useful for plan percentages but must never gate the credit total.
            daily_payload = optional_request(daily_url, "codex_daily_usage")
            remaining_balance_payload = optional_request(
                _bound_account_url(ACCOUNT_REMAINING_BALANCE_ENDPOINT, credential),
                "codex_remaining_balance",
            )
            is_workspace = entry.account.plan.strip().lower() in {
                "team",
                "business",
                "enterprise",
                "edu",
            }
            workspace_monthly_payload = (
                optional_request(
                    _bound_account_url(WORKSPACE_MONTHLY_USAGE_ENDPOINT, credential),
                    "codex_workspace_monthly_usage",
                )
                if is_workspace
                else None
            )
            should_fetch_user_limit = is_workspace and (
                entry.account.plan.strip().lower() == "enterprise"
                or _workspace_monthly_uses_usd(workspace_monthly_payload)
            )
            workspace_user_credit_limit_payload = (
                optional_request(
                    _bound_account_url(
                        WORKSPACE_USER_CREDIT_LIMIT_ENDPOINT, credential
                    ),
                    "codex_workspace_user_credit_limit",
                )
                if should_fetch_user_limit
                else None
            )
        finally:
            try:
                http.close()
            except Exception:
                pass
        sanitized = _sanitize_codex_usage(
            payload,
            reset_credits_payload=reset_payload,
            daily_usage_payload=daily_payload,
            daily_usage_counts_payload=daily_usage_counts_payload,
            remaining_balance_payload=remaining_balance_payload,
            workspace_monthly_payload=workspace_monthly_payload,
            workspace_user_credit_limit_payload=workspace_user_credit_limit_payload,
            optional_errors=optional_errors,
            plan_fallback=entry.account.plan,
            daily_usage_scope=daily_scope,
        )
        entry.usage_snapshot = copy.deepcopy(sanitized)
        entry.usage_cached_at_monotonic = time.monotonic()
        return copy.deepcopy(sanitized)


def fetch_codex_reset_credits(entry: LocalAuthEntry) -> dict[str, Any]:
    """Fetch the consumable reset-credit cards bound to this login session."""

    with entry.lock:
        credential = ensure_fresh_credential(entry)
        headers = _credential_headers(credential)
        http = _new_http_session()
        refreshed = False
        try:
            while True:
                try:
                    payload = _request_json(
                        http,
                        CODEX_RESET_CREDITS_ENDPOINT,
                        headers=headers,
                        stage="codex_reset_credits",
                        preserve_forbidden=True,
                    )
                    break
                except AuthSessionError as error:
                    if error.code != "invalid_session" or refreshed:
                        raise
                    credential = refresh_local_auth_entry(entry)
                    headers = _credential_headers(credential)
                    refreshed = True
        finally:
            try:
                http.close()
            except Exception:
                pass
        return _sanitize_codex_reset_credits(payload)


def consume_codex_reset_credit(
    entry: LocalAuthEntry,
    *,
    credit_id: str | None,
    redeem_request_id: str,
) -> dict[str, Any]:
    """Consume one reset credit with the upstream idempotency id unchanged."""

    with entry.lock:
        operation = entry.reset_credit_operations.get(redeem_request_id)
        if operation is not None:
            if operation.credit_id != credit_id:
                raise AuthSessionError(
                    "reset_idempotency_conflict",
                    "同一重置请求编号不能用于不同的重置卡。",
                    status_code=409,
                )
            if operation.result is not None:
                return copy.deepcopy(operation.result)
        else:
            while len(entry.reset_credit_operations) >= MAX_CODEX_RESET_OPERATIONS:
                oldest = next(iter(entry.reset_credit_operations))
                entry.reset_credit_operations.pop(oldest, None)
            operation = ResetCreditOperation(credit_id=credit_id)
            entry.reset_credit_operations[redeem_request_id] = operation

        # Build this object exactly once.  Both the initial request and the one
        # permitted refresh retry must carry the identical upstream idempotency
        # identifier and selected credit.
        request_body: dict[str, Any] = {"redeem_request_id": redeem_request_id}
        if credit_id is not None:
            request_body["credit_id"] = credit_id

        credential = ensure_fresh_credential(entry)
        headers = {
            **_credential_headers(credential),
            "Content-Type": "application/json",
            "Origin": CHATGPT_ORIGIN,
        }
        http = _new_http_session()
        refreshed = False
        try:
            while True:
                try:
                    payload = _request_json(
                        http,
                        CODEX_RESET_CREDITS_CONSUME_ENDPOINT,
                        headers=headers,
                        stage="codex_reset_credit_consume",
                        method="POST",
                        json_body=request_body,
                        preserve_forbidden=True,
                    )
                    break
                except AuthSessionError as error:
                    if error.code != "invalid_session" or refreshed:
                        raise
                    credential = refresh_local_auth_entry(entry)
                    headers = {
                        **_credential_headers(credential),
                        "Content-Type": "application/json",
                        "Origin": CHATGPT_ORIGIN,
                    }
                    refreshed = True
        finally:
            try:
                http.close()
            except Exception:
                pass

        result = _sanitize_codex_reset_result(
            payload, requested_credit_id=credit_id
        )
        operation.result = copy.deepcopy(result)
        # ChatGPT Web refreshes usage after every recognized semantic result,
        # including nothing_to_reset/no_credit.  Clear only this login entry so
        # that follow-up analytics never replays its 30-second old snapshot.
        entry.usage_snapshot = None
        entry.usage_cached_at_monotonic = 0.0
        return copy.deepcopy(result)


def _string_list(value: Any, *, maximum: int = 128) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item[:200] for item in value[:maximum] if isinstance(item, str)]


def _service_tier_list(value: Any, *, maximum: int = 8) -> list[str]:
    if not isinstance(value, list):
        return []
    tiers: list[str] = []
    for item in value[:maximum]:
        if isinstance(item, str):
            tier = item.strip()[:50]
        elif isinstance(item, Mapping):
            tier = _string_at(item, "service_tier", "serviceTier")[:50]
        else:
            tier = ""
        if tier and tier not in tiers:
            tiers.append(tier)
    return tiers


def _feature_name_list(value: Any, *, maximum: int = 256) -> list[str]:
    """Normalize feature strings and current conversation-init feature objects."""

    if not isinstance(value, list):
        return []
    names: list[str] = []
    seen: set[str] = set()
    for item in value[:maximum]:
        if isinstance(item, str):
            name = item.strip()[:200]
        elif isinstance(item, Mapping):
            name = _string_at(item, "name", "feature_name", "feature", "id")[:200]
        else:
            name = ""
        if name and name not in seen:
            names.append(name)
            seen.add(name)
    return names


def _sanitize_models_payload(payload: Mapping[str, Any]) -> dict[str, Any]:
    categories: list[dict[str, Any]] = []
    raw_categories = payload.get("categories")
    if isinstance(raw_categories, list):
        for raw in raw_categories[:64]:
            if not isinstance(raw, Mapping):
                continue
            categories.append(
                {
                    "category": _string_at(raw, "category"),
                    "defaultModel": _string_at(raw, "default_model", "defaultModel"),
                    "name": _string_at(raw, "human_category_name", "name"),
                    "shortName": _string_at(raw, "human_category_short_name", "shortName"),
                    "subscriptionLevel": _string_at(raw, "subscription_level", "subscriptionLevel"),
                    "modelLane": _string_at(raw, "model_lane", "modelLane"),
                    "supportedModels": _string_list(raw.get("supported_models")),
                    "supportedFeatures": _string_list(raw.get("supported_features")),
                }
            )

    models: list[dict[str, Any]] = []
    raw_models = payload.get("models")
    if isinstance(raw_models, list):
        for raw in raw_models[:128]:
            if not isinstance(raw, Mapping):
                continue
            efforts: list[dict[str, str]] = []
            raw_efforts = raw.get("thinking_efforts")
            if isinstance(raw_efforts, list):
                for effort in raw_efforts[:16]:
                    if not isinstance(effort, Mapping):
                        continue
                    efforts.append(
                        {
                            "value": _string_at(effort, "thinking_effort", "value"),
                            "label": _string_at(effort, "short_label", "label"),
                            "fullLabel": _string_at(effort, "full_label", "fullLabel"),
                            "mobileFullLabel": _string_at(
                                effort, "mobile_full_label", "mobileFullLabel"
                            ),
                            "description": _string_at(effort, "description")[:300],
                        }
                    )
            models.append(
                {
                    "slug": _string_at(raw, "slug"),
                    "title": _string_at(raw, "title"),
                    "description": _string_at(raw, "description")[:300],
                    "reasoningType": _string_at(raw, "reasoning_type", "reasoningType"),
                    "configurableThinkingEffort": raw.get("configurable_thinking_effort") is True,
                    "thinkingEfforts": efforts,
                    "defaultServiceTier": _string_at(
                        raw, "default_service_tier", "defaultServiceTier"
                    ),
                    "serviceTierOptions": _service_tier_list(
                        raw.get("service_tier_options", raw.get("serviceTierOptions"))
                    ),
                    "enabledTools": _string_list(raw.get("enabled_tools")),
                    "tags": _string_list(raw.get("tags")),
                }
            )

    versions: list[dict[str, Any]] = []
    raw_versions = payload.get("versions")
    if isinstance(raw_versions, list):
        for raw in raw_versions[:32]:
            if not isinstance(raw, Mapping):
                continue
            presets: list[dict[str, Any]] = []
            raw_presets = raw.get("intelligence_presets")
            if isinstance(raw_presets, list):
                for preset in raw_presets[:16]:
                    if not isinstance(preset, Mapping):
                        continue
                    presets.append(
                        {
                            "id": preset.get("id") if isinstance(preset.get("id"), int) else None,
                            "title": _string_at(preset, "title"),
                            "selectedTitle": _string_at(preset, "selected_display_title"),
                            "modelSlug": _string_at(preset, "model_slug"),
                            "thinkingEffort": _string_at(preset, "thinking_effort"),
                            "lane": _string_at(preset, "lane"),
                            "presetType": _string_at(preset, "preset_type"),
                            "upgradePlanType": _string_at(preset, "upgrade_plan_type"),
                            "defaultServiceTier": _string_at(
                                preset, "default_service_tier"
                            ),
                            "serviceTierOptions": _service_tier_list(
                                preset.get("service_tier_options")
                            ),
                        }
                    )
            versions.append(
                {
                    "id": _string_at(raw, "id"),
                    "displayText": _string_at(raw, "display_text"),
                    "fullDisplayText": _string_at(raw, "display_text_full"),
                    "intelligenceDisplayText": _string_at(
                        raw, "display_text_for_intelligence"
                    ),
                    "shortIntelligenceDisplayText": _string_at(
                        raw, "short_display_text_for_intelligence"
                    ),
                    "enabled": raw.get("enabled") is not False,
                    "slugs": _string_list(raw.get("slugs")),
                    "presets": presets,
                }
            )

    return {
        "defaultModel": _string_at(payload, "default_model_slug", "defaultModel"),
        "title": _string_at(payload, "title"),
        "secondaryTitle": _string_at(payload, "secondary_title", "secondaryTitle"),
        "categories": categories,
        "models": models,
        "versions": versions,
    }


def _sanitize_init_payload(payload: Mapping[str, Any]) -> dict[str, Any]:
    limits: list[dict[str, Any]] = []
    raw_limits = payload.get("model_limits")
    if isinstance(raw_limits, list):
        for raw in raw_limits[:128]:
            if not isinstance(raw, Mapping):
                continue
            safe: dict[str, Any] = {}
            for key, value in raw.items():
                if not isinstance(key, str) or len(key) > 100:
                    continue
                if isinstance(value, (bool, int, float)) or value is None:
                    safe[key] = value
                elif isinstance(value, str):
                    safe[key] = value[:300]
            limits.append(safe)
    return {
        "defaultModel": _string_at(payload, "default_model_slug", "defaultModel"),
        "intendedDefaultModel": _string_at(
            payload, "intended_default_model_slug", "intendedDefaultModel"
        ),
        "blockedFeatures": _feature_name_list(
            payload.get("blocked_features"), maximum=256
        ),
        "modelLimits": limits,
        "atlasModeEnabled": payload.get("atlas_mode_enabled") is True,
    }


def fetch_account_runtime(
    entry: LocalAuthEntry, *, cache_ttl_seconds: int = 300
) -> dict[str, Any]:
    """Return a sanitized, dynamic model/entitlement snapshot for the UI."""

    with entry.lock:
        now = time.monotonic()
        if (
            entry.runtime_snapshot is not None
            and now - entry.runtime_cached_at_monotonic < cache_ttl_seconds
        ):
            return entry.runtime_snapshot

        credential = ensure_fresh_credential(entry)
        headers = _credential_headers(credential)
        http = _new_http_session()
        try:
            try:
                accounts_payload = _request_json(
                    http, ACCOUNTS_ENDPOINT, headers=headers, stage="accounts_runtime"
                )
            except AuthSessionError as error:
                if error.code == "invalid_session":
                    credential = refresh_local_auth_entry(entry)
                    headers = _credential_headers(credential)
                    accounts_payload = _request_json(
                        http, ACCOUNTS_ENDPOINT, headers=headers, stage="accounts_runtime"
                    )
                else:
                    accounts_payload = {}

            try:
                chat_models = _request_json(
                    http, MODELS_ENDPOINT, headers=headers, stage="models"
                )
            except AuthSessionError:
                # Model discovery is optional enrichment.  In particular a
                # plan-gated endpoint may answer 403 even though account-check
                # has just authenticated the selected account successfully.
                # Do not turn that into a destructive local logout.
                chat_models = {}

            try:
                work_models = _request_json(
                    http, WORK_MODELS_ENDPOINT, headers=headers, stage="work_models"
                )
            except AuthSessionError:
                work_models = {}

            try:
                init_payload = _request_json(
                    http,
                    CONVERSATION_INIT_ENDPOINT,
                    headers={**headers, "Content-Type": "application/json"},
                    stage="conversation_init",
                    method="POST",
                    json_body={
                        "requested_default_model": None,
                        "conversation_id": None,
                        "timezone": "Asia/Shanghai",
                        "timezone_offset_min": -480,
                        "conversation_origin": "https://chatgpt.com/",
                    },
                )
            except AuthSessionError:
                init_payload = {}
        finally:
            try:
                http.close()
            except Exception:
                pass

        _, account_entry = _account_entry(accounts_payload, entry.account.id)
        current_plan = _plan_from_sources({}, account_entry)
        if current_plan != "unknown" and current_plan != entry.account.plan:
            # The account-check response is fresher than the login bootstrap.
            # Preserve the verified identity while atomically publishing its
            # current entitlement to both `/api/auth/session` and runtime.
            entry.account = PublicAccount(
                id=entry.account.id,
                user_id=entry.account.user_id,
                name=entry.account.name,
                email=entry.account.email,
                initials=entry.account.initials,
                plan=current_plan,
                plan_label=_plan_label(current_plan),
            )
        features = _string_list(account_entry.get("features"), maximum=512)
        runtime = {
            "plan": entry.account.plan,
            "planLabel": entry.account.plan_label,
            "features": features,
            "chat": _sanitize_models_payload(chat_models),
            "work": _sanitize_models_payload(work_models),
            "conversation": _sanitize_init_payload(init_payload),
        }
        entry.runtime_snapshot = runtime
        entry.runtime_cached_at_monotonic = time.monotonic()
        return runtime


class AuthSessionRegistry:
    """In-memory storage keyed by a digest of an opaque local cookie handle."""

    def __init__(
        self,
        *,
        ttl_seconds: int = AUTH_SESSION_TTL_SECONDS,
        idle_ttl_seconds: int = AUTH_SESSION_IDLE_TTL_SECONDS,
        max_entries: int = AUTH_SESSION_MAX_ENTRIES,
        on_remove: Callable[[str], None] | None = None,
    ) -> None:
        self.ttl_seconds = ttl_seconds
        self.idle_ttl_seconds = min(idle_ttl_seconds, ttl_seconds)
        self.max_entries = max_entries
        self._entries: dict[str, LocalAuthEntry] = {}
        self._lock = threading.RLock()
        self._on_remove = on_remove

    @staticmethod
    def digest(handle: str) -> str:
        return hashlib.sha256(handle.encode("utf-8")).hexdigest()

    @staticmethod
    def owner_key(handle: str) -> str:
        return "account:" + AuthSessionRegistry.digest(handle)

    @staticmethod
    def owner_key_from_digest(digest: str) -> str:
        return "account:" + digest

    def _notify_removed(self, digests: list[str]) -> None:
        if self._on_remove is None:
            return
        for digest in dict.fromkeys(digests):
            try:
                self._on_remove(self.owner_key_from_digest(digest))
            except Exception as error:
                # The callback only receives a one-way handle digest.  Avoid
                # exception text anyway so a future callback cannot leak state.
                LOGGER.warning(
                    "Local auth cleanup callback failed (%s)", type(error).__name__
                )

    def _prune_locked(self) -> list[str]:
        now_epoch = time.time()
        now_monotonic = time.monotonic()
        expired = [
            digest
            for digest, entry in self._entries.items()
            if entry.absolute_expires_at_epoch <= now_epoch
            or now_monotonic - entry.last_access_monotonic > self.idle_ttl_seconds
        ]
        for digest in expired:
            self._entries.pop(digest, None)

        if len(self._entries) <= self.max_entries:
            return expired
        oldest = sorted(
            self._entries.items(), key=lambda item: item[1].last_access_monotonic
        )
        evicted = [
            digest for digest, _ in oldest[: len(self._entries) - self.max_entries]
        ]
        for digest in evicted:
            self._entries.pop(digest, None)
        return [*expired, *evicted]

    def create(self, upstream: AuthenticatedUpstream) -> tuple[str, LocalAuthEntry, int]:
        now = time.time()
        absolute_expiry = now + self.ttl_seconds
        if upstream.expires_at_epoch is not None:
            absolute_expiry = min(absolute_expiry, upstream.expires_at_epoch)
        max_age = int(absolute_expiry - now)
        if max_age < 30:
            raise AuthSessionError(
                "invalid_session",
                "Session 即将过期，请刷新后重新复制。",
                status_code=401,
            )

        handle = secrets.token_urlsafe(32)
        digest = self.digest(handle)
        entry = LocalAuthEntry(
            account=upstream.account,
            credential=upstream.credential,
            created_at_epoch=now,
            absolute_expires_at_epoch=absolute_expiry,
            last_access_monotonic=time.monotonic(),
            lock=threading.RLock(),
        )
        with self._lock:
            removed = self._prune_locked()
            self._entries[digest] = entry
            removed.extend(self._prune_locked())
        self._notify_removed(removed)
        return handle, entry, max_age

    def get(self, handle: str | None) -> LocalAuthEntry | None:
        if not handle:
            return None
        digest = self.digest(handle)
        with self._lock:
            removed = self._prune_locked()
            entry = self._entries.get(digest)
            if entry is not None:
                entry.last_access_monotonic = time.monotonic()
        self._notify_removed(removed)
        return entry

    def delete(self, handle: str | None) -> LocalAuthEntry | None:
        if not handle:
            return None
        digest = self.digest(handle)
        with self._lock:
            entry = self._entries.pop(digest, None)
        if entry is not None:
            self._notify_removed([digest])
        return entry

    def count(self) -> int:
        with self._lock:
            removed = self._prune_locked()
            count = len(self._entries)
        self._notify_removed(removed)
        return count

    def close_all(self) -> None:
        with self._lock:
            digests = list(self._entries)
            self._entries.clear()
        self._notify_removed(digests)
