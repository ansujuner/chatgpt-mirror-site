from __future__ import annotations

import asyncio
import base64
import binascii
import ipaddress
import json
import logging
import os
import re
import secrets
import threading
import time
import uuid
from json import JSONDecodeError
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Callable, Literal
from urllib.parse import urlsplit

from fastapi import FastAPI, Header, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .account_settings import (
    AccountSettingsError,
    AccountSettingsSnapshot,
    AccountSettingsStore,
)
from .auth_session import (
    AUTH_SESSION_TTL_SECONDS,
    LOCAL_SESSION_COOKIE,
    MAX_LOGIN_BODY_BYTES,
    AuthSessionError,
    AuthSessionRegistry,
    LocalAuthEntry,
    authenticate_session_input,
    exchange_oauth_authorization_code,
    consume_codex_reset_credit,
    ensure_fresh_credential,
    fetch_account_runtime,
    fetch_codex_reset_credits,
    fetch_codex_usage,
    refresh_local_auth_entry,
)
from .provider_auth import (
    OAUTH_REDIRECT_URI,
    ProviderLoginCompletion,
    ProviderLoginRegistry,
    login_flow_cookie_name,
)
from .authenticated_protocol import (
    AuthenticatedChatResult,
    AuthenticatedProtocolBridge,
    AuthenticatedProtocolError,
    AuthenticatedProtocolSession,
)
from .authenticated_files import (
    AuthenticatedFilesBridge,
    build_user_message_with_file_references,
)
from .authenticated_history import (
    AuthenticatedHistoryBridge,
    AuthenticatedHistoryRegistry,
    HistoryBinding,
    HistoryDetail,
)
from .model_preferences import (
    read_chat_model_preference,
    write_chat_model_preference,
)
from .protocol import (
    ChatResult,
    GuestProtocolBridge,
    GuestTurnStream,
    ProtocolError,
    ProtocolSession,
)
from .upstream_settings import (
    apply_upstream_settings,
    fetch_upstream_settings,
    validate_bridge_settings_patch,
)


logging.basicConfig(
    level=os.getenv("CHATGPT_BRIDGE_LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
LOGGER = logging.getLogger("chatgpt_account_bridge.api")


def _bounded_env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return min(maximum, max(minimum, value))


def _csv_env(name: str) -> tuple[str, ...]:
    """Read a comma-separated deployment allowlist without accepting blanks."""

    values: list[str] = []
    for raw_value in os.getenv(name, "").split(","):
        value = raw_value.strip()
        if value and value not in values:
            values.append(value)
    return tuple(values)


def _normalize_web_origin(value: str) -> str:
    """Return the canonical scheme/authority form used by browser Origin headers."""

    candidate = value.strip()
    try:
        parsed = urlsplit(candidate)
        port = parsed.port
    except ValueError as error:
        raise ValueError(f"Invalid web origin: {value!r}") from error
    if (
        parsed.scheme.lower() not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError(f"Invalid web origin: {value!r}")

    scheme = parsed.scheme.lower()
    hostname = parsed.hostname.lower()
    rendered_host = f"[{hostname}]" if ":" in hostname else hostname
    if port is not None and port != (443 if scheme == "https" else 80):
        rendered_host = f"{rendered_host}:{port}"
    return f"{scheme}://{rendered_host}"


def _optional_origin_env(name: str) -> str | None:
    value = os.getenv(name, "").strip()
    return _normalize_web_origin(value) if value else None


def _origin_allowlist_env(name: str) -> tuple[str, ...]:
    values = _csv_env(name)
    if "*" in values:
        # Credentialed CORS and a wildcard origin are an unsafe and invalid
        # deployment combination. Exact origins are deliberately required.
        raise ValueError(f"{name} must contain exact http(s) origins, not '*'.")
    return tuple(_normalize_web_origin(value) for value in values)


BRIDGE_PUBLIC_ORIGIN = _optional_origin_env("CHATGPT_BRIDGE_PUBLIC_ORIGIN")
BRIDGE_ALLOWED_ORIGINS = _origin_allowlist_env("CHATGPT_BRIDGE_ALLOWED_ORIGINS")
BRIDGE_ALLOWED_ORIGIN_SET = frozenset(BRIDGE_ALLOWED_ORIGINS)
BRIDGE_ALLOWED_HOSTS = _csv_env("CHATGPT_BRIDGE_ALLOWED_HOSTS")
_LOOPBACK_ORIGIN = re.compile(
    r"^https?://(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$",
    re.IGNORECASE,
)


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    role: str
    content: Any


class ChatCompletionRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    model: str = "chatgpt-guest"
    messages: list[ChatMessage] = Field(min_length=1)
    reasoning_effort: Literal["min", "standard", "extended", "xhigh", "max"] | None = None
    service_tier: Literal["auto", "priority", "standard", "fast"] | None = None
    stream: bool = True


class AccountSettingsPatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    changes: dict[str, Any]
    revision: int | None = Field(default=None, ge=0)


class ChatModelPreferencePatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    modelSlug: str = Field(
        min_length=1,
        max_length=160,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
    )
    thinkingEffort: Literal["min", "standard", "extended", "xhigh", "max"] | None = None


class CodexResetCreditConsumeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    creditId: str | None = Field(
        default=None,
        min_length=1,
        max_length=256,
        pattern=r"^[^\x00-\x20\x7f]+$",
    )
    # The browser creates this once with crypto.randomUUID() and reuses it for
    # transport retries. Keep the caller's canonical spelling byte-for-byte.
    redeemRequestId: str = Field(
        min_length=36,
        max_length=36,
        pattern=(
            r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
            r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
        ),
    )


class ProviderLoginStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    provider: Literal["google", "apple", "phone", "email"]
    callbackPath: str = Field(default="/", min_length=1, max_length=2_048)
    loginHint: str | None = Field(default=None, min_length=1, max_length=320)


class ProviderLoginCompleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


MAX_CODEX_RESET_CONSUME_BODY_BYTES = 4_096


MAX_ATTACHMENT_FILES = _bounded_env_int(
    "CHATGPT_AUTH_ATTACHMENT_MAX_FILES", 10, 1, 32
)
MAX_ATTACHMENT_FILE_BYTES = _bounded_env_int(
    "CHATGPT_AUTH_ATTACHMENT_MAX_FILE_BYTES", 25 * 1024 * 1024, 1, 100 * 1024 * 1024
)
MAX_ATTACHMENT_TOTAL_BYTES = _bounded_env_int(
    "CHATGPT_AUTH_ATTACHMENT_MAX_TOTAL_BYTES", 50 * 1024 * 1024, 1, 200 * 1024 * 1024
)
# JSON/base64 adds roughly one third to the decoded bytes.  Keep a separate
# pre-Pydantic request ceiling so a client cannot make FastAPI first materialize
# an unbounded body.  The small fixed allowance covers messages and metadata.
MAX_CHAT_REQUEST_BYTES = _bounded_env_int(
    "CHATGPT_CHAT_MAX_REQUEST_BYTES",
    ((MAX_ATTACHMENT_TOTAL_BYTES + 2) // 3) * 4 + 2 * 1024 * 1024,
    64 * 1024,
    300 * 1024 * 1024,
)
_DATA_URL = re.compile(
    r"\Adata:(?P<mime>[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+);base64,(?P<data>[A-Za-z0-9+/]*={0,2})\Z"
)


@dataclass(frozen=True)
class IncomingAttachment:
    file_name: str
    mime_type: str
    file_bytes: bytes = field(repr=False)
    width: int | None = None
    height: int | None = None


@dataclass(frozen=True)
class LatestUserInput:
    prompt: str
    attachments: tuple[IncomingAttachment, ...]


def _attachment_error(code: str, message: str) -> ProtocolError:
    return ProtocolError(code, message, stage="validation", retryable=False)


def _clean_incoming_file_name(value: Any) -> str:
    if not isinstance(value, str):
        raise _attachment_error(
            "attachment_filename_invalid", "Each attachment must include a valid file name."
        )
    name = value.strip()
    if (
        not name
        or len(name) > 1024
        or any(ord(character) < 0x20 or ord(character) == 0x7F for character in name)
    ):
        raise _attachment_error(
            "attachment_filename_invalid", "Each attachment must include a valid file name."
        )
    return name


def _clean_image_dimension(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 100_000:
        raise _attachment_error(
            "attachment_dimensions_invalid",
            f"The image attachment {label} is invalid.",
        )
    return value


def _decode_attachment_data_url(value: Any, *, image: bool) -> tuple[str, bytes]:
    if not isinstance(value, str):
        raise _attachment_error(
            "attachment_data_url_invalid", "Attachment data must be a base64 data URL."
        )
    # Check encoded length before allocating decoded bytes.  Four base64
    # characters represent at most three bytes.
    maximum_encoded = ((MAX_ATTACHMENT_FILE_BYTES + 2) // 3) * 4
    if len(value) > maximum_encoded + 512:
        raise _attachment_error(
            "attachment_file_too_large",
            "An attachment exceeds the local per-file size limit.",
        )
    match = _DATA_URL.fullmatch(value)
    if match is None:
        raise _attachment_error(
            "attachment_data_url_invalid",
            "Attachment data must be a strict base64 data URL.",
        )
    mime_type = match.group("mime").lower()
    if image and not mime_type.startswith("image/"):
        raise _attachment_error(
            "attachment_mime_invalid", "An image attachment must use an image MIME type."
        )
    encoded = match.group("data")
    if not encoded or len(encoded) % 4:
        raise _attachment_error(
            "attachment_data_url_invalid", "Attachment base64 data is malformed."
        )
    try:
        decoded = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise _attachment_error(
            "attachment_data_url_invalid", "Attachment base64 data is malformed."
        ) from error
    if not decoded:
        raise _attachment_error("attachment_file_empty", "Empty attachments are not supported.")
    if len(decoded) > MAX_ATTACHMENT_FILE_BYTES:
        raise _attachment_error(
            "attachment_file_too_large",
            "An attachment exceeds the local per-file size limit.",
        )
    # Reject non-canonical encodings as well as alternate/ambiguous padding.
    if base64.b64encode(decoded).decode("ascii") != encoded:
        raise _attachment_error(
            "attachment_data_url_invalid", "Attachment base64 data is malformed."
        )
    return mime_type, decoded


def _parse_content_attachment(part: dict[str, Any]) -> IncomingAttachment | None:
    part_type = part.get("type")
    if part_type == "image_url":
        image = part.get("image_url")
        if not isinstance(image, dict):
            raise _attachment_error(
                "attachment_image_invalid", "The image attachment payload is invalid."
            )
        mime_type, decoded = _decode_attachment_data_url(image.get("url"), image=True)
        return IncomingAttachment(
            file_name=_clean_incoming_file_name(image.get("filename")),
            mime_type=mime_type,
            file_bytes=decoded,
            width=_clean_image_dimension(image.get("width"), "width"),
            height=_clean_image_dimension(image.get("height"), "height"),
        )
    if part_type == "file":
        file_payload = part.get("file")
        if not isinstance(file_payload, dict):
            raise _attachment_error(
                "attachment_file_invalid", "The file attachment payload is invalid."
            )
        mime_type, decoded = _decode_attachment_data_url(
            file_payload.get("file_data"), image=False
        )
        return IncomingAttachment(
            file_name=_clean_incoming_file_name(file_payload.get("filename")),
            mime_type=mime_type,
            file_bytes=decoded,
        )
    return None


def _content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
                continue
            if not isinstance(part, dict):
                continue
            if part.get("type") in {None, "text", "input_text"}:
                text = part.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "".join(parts)
    return ""


def _latest_user_input(request: ChatCompletionRequest) -> LatestUserInput:
    for message in reversed(request.messages):
        if message.role == "user":
            attachments: list[IncomingAttachment] = []
            if isinstance(message.content, list):
                for part in message.content:
                    if not isinstance(part, dict):
                        continue
                    attachment = _parse_content_attachment(part)
                    if attachment is not None:
                        attachments.append(attachment)
            if len(attachments) > MAX_ATTACHMENT_FILES:
                raise _attachment_error(
                    "too_many_attachments",
                    "The request contains too many attachments.",
                )
            if sum(len(item.file_bytes) for item in attachments) > MAX_ATTACHMENT_TOTAL_BYTES:
                raise _attachment_error(
                    "attachments_too_large",
                    "The combined attachments exceed the local size limit.",
                )
            prompt = _content_text(message.content).strip()
            if prompt or attachments:
                return LatestUserInput(prompt=prompt, attachments=tuple(attachments))
            break
    raise ProtocolError(
        "user_prompt_missing",
        "messages must contain text or an attachment in the latest user message.",
        stage="validation",
        retryable=False,
    )


def _latest_user_prompt(request: ChatCompletionRequest) -> str:
    """Backward-compatible text-only helper used by older unit callers."""

    latest = _latest_user_input(request)
    if not latest.prompt:
        raise ProtocolError(
            "user_prompt_missing",
            "messages must contain a non-empty user message.",
            stage="validation",
            retryable=False,
        )
    return latest.prompt


@dataclass
class RegistryEntry:
    session: ProtocolSession
    owner: str
    last_access_monotonic: float


class ConversationRegistry:
    def __init__(self, ttl_seconds: int, max_entries: int) -> None:
        self.ttl_seconds = ttl_seconds
        self.max_entries = max_entries
        self._entries: dict[tuple[str, str], RegistryEntry] = {}
        self._lock = threading.RLock()

    def _prune_locked(self) -> None:
        now = time.monotonic()
        expired = [
            key
            for key, entry in self._entries.items()
            if now - entry.last_access_monotonic > self.ttl_seconds
        ]
        for key in expired:
            entry = self._entries.pop(key)
            entry.session.close()

        if len(self._entries) <= self.max_entries:
            return
        oldest = sorted(
            self._entries.items(), key=lambda item: item[1].last_access_monotonic
        )
        for key, entry in oldest[: len(self._entries) - self.max_entries]:
            self._entries.pop(key, None)
            entry.session.close()

    def get(self, conversation_id: str, *, owner: str) -> ProtocolSession | None:
        with self._lock:
            self._prune_locked()
            entry = self._entries.get((owner, conversation_id))
            if entry is None:
                return None
            entry.last_access_monotonic = time.monotonic()
            return entry.session

    def put(
        self,
        session: ProtocolSession,
        *,
        owner: str,
        previous_id: str | None = None,
        public_id: str | None = None,
    ) -> None:
        conversation_id = public_id or session.conversation_id
        if not conversation_id:
            return
        with self._lock:
            if previous_id and previous_id != conversation_id:
                self._entries.pop((owner, previous_id), None)
            self._entries[(owner, conversation_id)] = RegistryEntry(
                session=session,
                owner=owner,
                last_access_monotonic=time.monotonic(),
            )
            self._prune_locked()

    def remove(
        self,
        conversation_id: str,
        *,
        owner: str,
        expected_session: ProtocolSession | None = None,
    ) -> None:
        entry: RegistryEntry | None = None
        with self._lock:
            key = (owner, conversation_id)
            candidate = self._entries.get(key)
            if candidate is not None and (
                expected_session is None or candidate.session is expected_session
            ):
                entry = self._entries.pop(key)
        if entry is not None:
            entry.session.close()

    def remove_owner(self, owner: str) -> None:
        with self._lock:
            keys = [key for key, entry in self._entries.items() if entry.owner == owner]
            entries = [self._entries.pop(key) for key in keys]
        for entry in entries:
            entry.session.close()

    def count(self) -> int:
        with self._lock:
            self._prune_locked()
            return len(self._entries)

    def close_all(self) -> None:
        with self._lock:
            entries = list(self._entries.values())
            self._entries.clear()
        for entry in entries:
            entry.session.close()


@dataclass
class AuthenticatedRegistryEntry:
    session: AuthenticatedProtocolSession | None
    pending_history: HistoryDetail | None = field(repr=False)
    owner: str
    local_id: str
    last_access_monotonic: float
    resolution_lock: Any = field(default_factory=threading.Lock, repr=False)


class AuthenticatedConversationRegistry:
    """Keep upstream conversation ids private behind random local handles."""

    def __init__(self, ttl_seconds: int, max_entries: int) -> None:
        self.ttl_seconds = ttl_seconds
        self.max_entries = max_entries
        self._entries: dict[tuple[str, str], AuthenticatedRegistryEntry] = {}
        self._lock = threading.RLock()

    def _prune_locked(self) -> None:
        now = time.monotonic()
        expired = [
            key
            for key, entry in self._entries.items()
            if now - entry.last_access_monotonic > self.ttl_seconds
        ]
        for key in expired:
            entry = self._entries.pop(key)
            if entry.session is not None:
                entry.session.close()

        if len(self._entries) <= self.max_entries:
            return
        oldest = sorted(
            self._entries.items(), key=lambda item: item[1].last_access_monotonic
        )
        for key, entry in oldest[: len(self._entries) - self.max_entries]:
            self._entries.pop(key, None)
            if entry.session is not None:
                entry.session.close()

    def get(
        self, local_id: str, *, owner: str
    ) -> AuthenticatedProtocolSession | None:
        with self._lock:
            self._prune_locked()
            entry = self._entries.get((owner, local_id))
            if entry is None:
                return None
            entry.last_access_monotonic = time.monotonic()
            return entry.session

    def put(self, session: AuthenticatedProtocolSession, *, owner: str) -> str:
        local_id = "authconv-" + secrets.token_urlsafe(24)
        with self._lock:
            self._entries[(owner, local_id)] = AuthenticatedRegistryEntry(
                session=session,
                pending_history=None,
                owner=owner,
                local_id=local_id,
                last_access_monotonic=time.monotonic(),
            )
            self._prune_locked()
        return local_id

    def put_pending(self, detail: HistoryDetail, *, owner: str) -> str:
        """Store private continuation pointers without bootstrapping chat."""

        local_id = "authconv-" + secrets.token_urlsafe(24)
        with self._lock:
            self._entries[(owner, local_id)] = AuthenticatedRegistryEntry(
                session=None,
                pending_history=detail,
                owner=owner,
                local_id=local_id,
                last_access_monotonic=time.monotonic(),
            )
            self._prune_locked()
        return local_id

    def get_or_resolve(
        self,
        local_id: str,
        *,
        owner: str,
        factory: Callable[[HistoryDetail], AuthenticatedProtocolSession],
    ) -> AuthenticatedProtocolSession | None:
        """Resolve one pending history continuation exactly once.

        The network-bearing factory runs outside the registry lock. A per-entry
        lock serializes concurrent first turns, while identity checks on both
        sides ensure logout/eviction cannot reinsert the newly created session.
        """

        with self._lock:
            self._prune_locked()
            entry = self._entries.get((owner, local_id))
            if entry is None:
                return None
            entry.last_access_monotonic = time.monotonic()
            if entry.session is not None:
                return entry.session
            resolution_lock = entry.resolution_lock

        with resolution_lock:
            with self._lock:
                self._prune_locked()
                current = self._entries.get((owner, local_id))
                if current is not entry:
                    return None
                current.last_access_monotonic = time.monotonic()
                if current.session is not None:
                    return current.session
                detail = current.pending_history
            if detail is None:
                return None

            session = factory(detail)
            installed = False
            existing: AuthenticatedProtocolSession | None = None
            try:
                with self._lock:
                    self._prune_locked()
                    current = self._entries.get((owner, local_id))
                    if current is entry:
                        if current.session is not None:
                            existing = current.session
                        elif current.pending_history is detail:
                            current.session = session
                            current.pending_history = None
                            current.last_access_monotonic = time.monotonic()
                            installed = True
                if installed:
                    return session
                return existing
            finally:
                if not installed:
                    session.close()

    def remove_owner(self, owner: str) -> None:
        with self._lock:
            keys = [key for key, entry in self._entries.items() if entry.owner == owner]
            entries = [self._entries.pop(key) for key in keys]
        for entry in entries:
            if entry.session is not None:
                entry.session.close()

    def count(self) -> int:
        with self._lock:
            self._prune_locked()
            return len(self._entries)

    def close_all(self) -> None:
        with self._lock:
            entries = list(self._entries.values())
            self._entries.clear()
        for entry in entries:
            if entry.session is not None:
                entry.session.close()


BRIDGE = GuestProtocolBridge()
AUTH_BRIDGE = AuthenticatedProtocolBridge()
AUTH_FILES = AuthenticatedFilesBridge(protocol_bridge=AUTH_BRIDGE)
AUTH_HISTORY_BRIDGE = AuthenticatedHistoryBridge()
REGISTRY = ConversationRegistry(
    ttl_seconds=_bounded_env_int("CHATGPT_BRIDGE_CONVERSATION_TTL", 1800, 60, 86_400),
    max_entries=_bounded_env_int("CHATGPT_BRIDGE_MAX_CONVERSATIONS", 64, 1, 512),
)
AUTH_CONVERSATIONS = AuthenticatedConversationRegistry(
    ttl_seconds=_bounded_env_int("CHATGPT_AUTH_CONVERSATION_TTL", 1800, 60, 86_400),
    max_entries=_bounded_env_int("CHATGPT_AUTH_MAX_CONVERSATIONS", 64, 1, 512),
)
AUTH_HISTORY = AuthenticatedHistoryRegistry(
    ttl_seconds=_bounded_env_int("CHATGPT_AUTH_HISTORY_BINDING_TTL", 10_800, 60, 86_400),
    max_entries=_bounded_env_int("CHATGPT_AUTH_HISTORY_MAX_BINDINGS", 4096, 28, 50_000),
    max_cursors=_bounded_env_int("CHATGPT_AUTH_HISTORY_MAX_CURSORS", 1024, 8, 10_000),
)


def _remove_owner_conversations(owner: str) -> None:
    """Immediately release protocol credentials when an auth entry is evicted."""

    REGISTRY.remove_owner(owner)
    AUTH_CONVERSATIONS.remove_owner(owner)
    AUTH_HISTORY.remove_owner(owner)


AUTH_REGISTRY = AuthSessionRegistry(on_remove=_remove_owner_conversations)
PROVIDER_LOGINS = ProviderLoginRegistry()
ACCOUNT_SETTINGS = AccountSettingsStore()
UPSTREAM_SEMAPHORE = asyncio.Semaphore(
    _bounded_env_int("CHATGPT_BRIDGE_MAX_CONCURRENCY", 1, 1, 4)
)
AUTH_UPSTREAM_SEMAPHORE = asyncio.Semaphore(
    _bounded_env_int("CHATGPT_AUTH_MAX_CONCURRENCY", 2, 1, 4)
)
AUTH_HISTORY_SEMAPHORE = asyncio.Semaphore(
    _bounded_env_int("CHATGPT_AUTH_HISTORY_MAX_CONCURRENCY", 1, 1, 4)
)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    PROVIDER_LOGINS.close()
    REGISTRY.close_all()
    AUTH_CONVERSATIONS.close_all()
    AUTH_HISTORY.clear()
    AUTH_REGISTRY.close_all()


app = FastAPI(
    title="ChatGPT 镜像站 API Bridge",
    version="2.0.0",
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    # Loopback origins remain convenient for local development. LAN/public or
    # split-origin frontends must opt in with exact entries so the HttpOnly
    # account cookie is never exposed to an arbitrary website.
    allow_origins=list(BRIDGE_ALLOWED_ORIGINS),
    allow_origin_regex=_LOOPBACK_ORIGIN.pattern,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Content-Type",
        "Accept",
        "X-Conversation-Id",
        "X-Chat-Conversation-Id",
    ],
    expose_headers=[
        "X-Conversation-Id",
        "X-Chat-Conversation-Id",
        "X-ChatGPT-Bridge-Attempts",
        "X-ChatGPT-Identity-Mode",
    ],
)
def _openai_error(
    status_code: int,
    error: ProtocolError,
) -> JSONResponse:
    public_detail = error.public_detail()
    # Request ids are useful only in server-side diagnostics; keeping them out
    # of the browser also guarantees file/chat upstream identifiers never
    # cross the local bridge boundary.
    public_detail.pop("upstream_request_id", None)
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "message": error.message,
                "type": "invalid_request_error"
                if error.stage == "validation"
                else "upstream_error",
                "param": None,
                "code": error.code,
                "detail": public_detail,
            }
        },
    )


def _protocol_error_status(error: ProtocolError) -> int:
    if error.code == "conversation_not_found":
        return 404
    if error.upstream_status == 401:
        return 401
    if error.upstream_status == 403:
        return 403
    if error.upstream_status == 429:
        return 429
    if error.code.endswith("_network_error"):
        return 503
    if error.stage in {"dependency", "local_session"}:
        return 503
    if error.stage == "validation":
        return 400
    # An HTTP-200 DPU without a terminal complete control is an upstream
    # protocol failure, never an empty successful completion.
    return 502


@app.middleware("http")
async def _limit_chat_request_body(
    request: Request, call_next: Any
) -> JSONResponse | Any:
    """Bound sensitive JSON before FastAPI/Pydantic materializes request data."""

    is_chat = request.method == "POST" and request.url.path in {
        "/api/chat/completions",
        "/api/chat/authenticated/completions",
    }
    is_settings = request.method == "PATCH" and request.url.path in {
        "/api/account/settings",
        "/api/account/model-preference",
    }
    is_provider_login = request.method == "POST" and (
        request.url.path == "/api/auth/login/start"
        or (
            request.url.path.startswith("/api/auth/login/")
            and request.url.path.endswith("/complete")
        )
    )
    if not is_chat and not is_settings and not is_provider_login:
        return await call_next(request)
    if (is_settings or is_provider_login) and request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
        return JSONResponse(
            status_code=415,
            content={"error": {"code": "content_type_required", "message": "This endpoint requires application/json."}},
            headers={"Cache-Control": "no-store"},
        )
    body_limit = (
        MAX_CHAT_REQUEST_BYTES
        if is_chat
        else (4 * 1024 if is_provider_login else 32 * 1024)
    )

    def too_large() -> JSONResponse:
        if is_chat:
            return _openai_error(
                413,
                _attachment_error(
                    "chat_request_too_large", "The chat request exceeds the local size limit."
                ),
            )
        code = "auth_request_too_large" if is_provider_login else "settings_request_too_large"
        message = (
            "The login request exceeds 4 KiB."
            if is_provider_login
            else "The settings request exceeds 32 KiB."
        )
        return JSONResponse(
            status_code=413,
            content={"error": {"code": code, "message": message}},
            headers={"Cache-Control": "no-store"},
        )

    content_length = request.headers.get("content-length")
    if content_length:
        try:
            declared = int(content_length)
        except ValueError:
            if is_settings or is_provider_login:
                return JSONResponse(
                    status_code=400,
                    content={"error": {"code": "request_content_length_invalid", "message": "The request Content-Length is invalid."}},
                    headers={"Cache-Control": "no-store"},
                )
            return _openai_error(
                400,
                _attachment_error(
                    "request_content_length_invalid", "The request Content-Length is invalid."
                ),
            )
        if declared < 0 or declared > body_limit:
            return too_large()

    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > body_limit:
            return too_large()
        chunks.append(chunk)
    # Starlette's wrapped receive replays this cached body to the router.  This
    # retains one bounded copy and also protects chunked requests without a
    # Content-Length header.
    request._body = b"".join(chunks)  # type: ignore[attr-defined]
    return await call_next(request)


if BRIDGE_ALLOWED_HOSTS:
    # Host validation is optional because development proxies vary in whether
    # they preserve or rewrite Host. Add it after the body middleware so it is
    # the outermost deployment boundary and rejects an invalid Host before any
    # potentially large body is read. Public deployments should set an exact
    # allowlist and include an internal proxy host only when necessary.
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=list(BRIDGE_ALLOWED_HOSTS),
        www_redirect=False,
    )


def _auth_error(error: AuthSessionError) -> JSONResponse:
    return JSONResponse(
        status_code=error.status_code,
        content={
            "authenticated": False,
            "user": None,
            "error": {
                "code": error.code,
                "message": error.message,
            },
        },
        headers={"Cache-Control": "no-store"},
    )


def _request_external_origin(request: Request) -> str | None:
    """Resolve the browser-visible bridge origin after a trusted proxy."""

    if BRIDGE_PUBLIC_ORIGIN is not None:
        return BRIDGE_PUBLIC_ORIGIN
    request_host = request.headers.get("host", "").strip()
    if not request_host:
        return None
    try:
        return _normalize_web_origin(f"{request.url.scheme}://{request_host}")
    except ValueError:
        return None


def _same_origin_write(request: Request) -> bool:
    """Allow CLI, same-origin, or explicitly allowlisted browser writes."""

    origin_header = request.headers.get("origin")
    fetch_site = request.headers.get("sec-fetch-site", "").strip().lower()
    if not origin_header:
        # Non-browser API/health clients usually omit both headers. A browser
        # that reports a cross-site fetch must not bypass the check by omitting
        # Origin, however.
        return fetch_site in {"", "none", "same-origin"}
    try:
        origin = _normalize_web_origin(origin_header)
    except ValueError:
        return False

    if origin == _request_external_origin(request):
        return fetch_site in {"", "none", "same-origin"}

    # Cross-origin cookie requests are permitted only for a deployment's exact
    # frontend allowlist. Loopback remains enabled for the local two-port dev
    # topology. CORSMiddleware mirrors the same trust boundary for reads.
    if origin in BRIDGE_ALLOWED_ORIGIN_SET or _LOOPBACK_ORIGIN.fullmatch(origin):
        return True
    return False


def _is_local_or_private_hostname(hostname: str) -> bool:
    normalized = hostname.strip().strip("[]").lower()
    if normalized == "localhost" or normalized.endswith(".localhost"):
        return True
    try:
        address = ipaddress.ip_address(normalized)
    except ValueError:
        return False
    return bool(address.is_loopback or address.is_private or address.is_link_local)


def _cookie_secure(request: Request) -> bool:
    configured = os.getenv("CHATGPT_AUTH_COOKIE_SECURE", "auto").strip().lower()
    if configured in {"1", "true", "yes", "on"}:
        return True
    if configured in {"0", "false", "no", "off"}:
        # Even an explicit false is fail-closed on a public hostname. Browsers
        # may use an insecure cookie only for loopback/private-network testing.
        hostname = urlsplit(_request_external_origin(request) or "").hostname or ""
        return not _is_local_or_private_hostname(hostname)

    external_origin = _request_external_origin(request)
    if external_origin is not None:
        parsed = urlsplit(external_origin)
        if parsed.scheme == "https":
            return True
        return not _is_local_or_private_hostname(parsed.hostname or "")
    return True


def _cookie_samesite(request: Request) -> Literal["strict", "lax", "none"]:
    configured = os.getenv("CHATGPT_AUTH_COOKIE_SAMESITE", "strict").strip().lower()
    if configured not in {"strict", "lax", "none"}:
        configured = "strict"
    # SameSite=None is only accepted by modern browsers together with Secure.
    # _cookie_secure independently forces Secure for public hosts.
    return configured  # type: ignore[return-value]


def _cookie_attributes(request: Request) -> tuple[bool, Literal["strict", "lax", "none"]]:
    samesite = _cookie_samesite(request)
    return (_cookie_secure(request) or samesite == "none", samesite)


def _expire_auth_cookie(response: JSONResponse, request: Request) -> None:
    secure, samesite = _cookie_attributes(request)
    response.delete_cookie(
        LOCAL_SESSION_COOKIE,
        path="/api",
        secure=secure,
        httponly=True,
        samesite=samesite,
    )


def _set_auth_cookie(
    response: JSONResponse | RedirectResponse,
    request: Request,
    handle: str,
    max_age: int,
) -> None:
    secure, samesite = _cookie_attributes(request)
    response.set_cookie(
        LOCAL_SESSION_COOKIE,
        handle,
        max_age=max_age,
        path="/api",
        secure=secure,
        httponly=True,
        samesite=samesite,
    )


def _set_login_flow_cookie(
    response: JSONResponse,
    request: Request,
    flow_id: str,
    binding: str,
    max_age: int,
) -> None:
    secure = _cookie_secure(request)
    response.set_cookie(
        login_flow_cookie_name(flow_id),
        binding,
        max_age=max_age,
        path=f"/api/auth/login/{flow_id}",
        secure=secure,
        httponly=True,
        samesite="strict",
    )


def _expire_login_flow_cookie(
    response: JSONResponse, request: Request, flow_id: str
) -> None:
    secure = _cookie_secure(request)
    response.delete_cookie(
        login_flow_cookie_name(flow_id),
        path=f"/api/auth/login/{flow_id}",
        secure=secure,
        httponly=True,
        samesite="strict",
    )


def _remove_account_state(handle: str | None) -> None:
    """Drop credentials and every conversation bound to a local login."""

    if not handle:
        return
    owner = AUTH_REGISTRY.owner_key(handle)
    AUTH_REGISTRY.delete(handle)
    REGISTRY.remove_owner(owner)
    AUTH_CONVERSATIONS.remove_owner(owner)


async def _login_payload(request: Request) -> str | dict[str, Any]:
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type != "application/json":
        raise AuthSessionError(
            "content_type_required",
            "请使用 application/json 提交 Session。",
            status_code=415,
        )
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_LOGIN_BODY_BYTES:
                raise AuthSessionError(
                    "session_input_too_large",
                    "Session 请求体不能超过 64 KiB。",
                    status_code=413,
                )
        except ValueError:
            raise AuthSessionError(
                "invalid_content_length",
                "请求长度格式不正确。",
                status_code=400,
            )
    body_parts: list[bytes] = []
    body_size = 0
    async for chunk in request.stream():
        body_size += len(chunk)
        if body_size > MAX_LOGIN_BODY_BYTES:
            raise AuthSessionError(
                "session_input_too_large",
                "Session 请求体不能超过 64 KiB。",
                status_code=413,
            )
        body_parts.append(chunk)
    body = b"".join(body_parts)
    if not body:
        raise AuthSessionError(
            "invalid_session_input",
            "Session 不能为空。",
            status_code=400,
        )
    try:
        payload = json.loads(body)
    except (JSONDecodeError, UnicodeDecodeError) as error:
        raise AuthSessionError(
            "invalid_json",
            "请求 JSON 格式不正确。",
            status_code=400,
        ) from error
    if not isinstance(payload, dict) or set(payload) != {"session"}:
        raise AuthSessionError(
            "invalid_session_input",
            "请求体必须且只能包含 session 字段。",
            status_code=400,
        )
    value = payload.get("session")
    if not isinstance(value, (str, dict)):
        raise AuthSessionError(
            "invalid_session_input",
            "session 必须是字符串或 Session JSON 对象。",
            status_code=400,
        )
    return value


@app.post("/api/auth/session-login")
async def session_login(request: Request) -> JSONResponse:
    if not _same_origin_write(request):
        return _auth_error(
            AuthSessionError(
                "origin_not_allowed",
                "仅允许从当前本地页面提交登录请求。",
                status_code=403,
            )
        )
    try:
        value = await _login_payload(request)
        async with AUTH_UPSTREAM_SEMAPHORE:
            upstream = await asyncio.to_thread(authenticate_session_input, value)
        handle, entry, max_age = AUTH_REGISTRY.create(upstream)
    except AuthSessionError as error:
        return _auth_error(error)
    except Exception:
        LOGGER.exception("Unexpected local session-login failure")
        return _auth_error(
            AuthSessionError(
                "auth_internal_error",
                "本地账号验证服务发生异常。",
                status_code=500,
            )
        )

    previous_handle = request.cookies.get(LOCAL_SESSION_COOKIE)
    if previous_handle:
        _remove_account_state(previous_handle)

    response = JSONResponse(
        status_code=200,
        content={"authenticated": True, "user": entry.account.as_dict()},
        headers={"Cache-Control": "no-store"},
    )
    _set_auth_cookie(response, request, handle, max_age)
    return response


def _provider_login_error(
    error: AuthSessionError,
    *,
    flow_id: str | None = None,
) -> JSONResponse:
    content: dict[str, Any] = {
        "status": "failed",
        "error": {"code": error.code, "message": error.message},
    }
    if flow_id:
        content["flowId"] = flow_id
    return JSONResponse(
        status_code=error.status_code,
        content=content,
        headers={"Cache-Control": "no-store"},
    )


@app.post("/api/auth/login/start")
async def provider_login_start(
    request: Request,
    login_request: ProviderLoginStartRequest,
) -> JSONResponse:
    """Create one short-lived, provider-specific browser OAuth/PKCE flow."""

    if not _same_origin_write(request):
        return _provider_login_error(
            AuthSessionError(
                "origin_not_allowed",
                "仅允许从当前本地页面发起登录。",
                status_code=403,
            )
        )
    try:
        started = await asyncio.to_thread(
            PROVIDER_LOGINS.start,
            login_request.provider,
            callback_path=login_request.callbackPath,
            login_hint=login_request.loginHint,
            app_origin=(
                request.headers.get("origin") or _request_external_origin(request)
            ),
        )
    except AuthSessionError as error:
        return _provider_login_error(error)
    except Exception:
        # Do not log the request object/body: loginHint can contain personal
        # account data.  The exception class is enough for local diagnostics.
        LOGGER.exception("Unexpected provider-login start failure")
        return _provider_login_error(
            AuthSessionError(
                "oauth_internal_error",
                "本地登录服务发生异常。",
                status_code=500,
            )
        )
    response = JSONResponse(
        status_code=201,
        content=started.as_dict(),
        headers={"Cache-Control": "no-store"},
    )
    _set_login_flow_cookie(
        response,
        request,
        started.flow_id,
        started.binding,
        started.expires_in,
    )
    return response


@app.get("/api/auth/login/{flow_id}/status")
async def provider_login_status(request: Request, flow_id: str) -> JSONResponse:
    """Read local flow state without polling or mutating the OAuth grant."""

    if not _same_origin_write(request):
        return _provider_login_error(
            AuthSessionError(
                "origin_not_allowed",
                "仅允许从当前本地页面读取登录状态。",
                status_code=403,
            ),
            flow_id=flow_id,
        )
    try:
        PROVIDER_LOGINS.verify_binding(
            flow_id, request.cookies.get(login_flow_cookie_name(flow_id))
        )
        status = PROVIDER_LOGINS.status(flow_id)
    except AuthSessionError as error:
        return _provider_login_error(error, flow_id=flow_id)
    return JSONResponse(
        status_code=200,
        content=status,
        headers={"Cache-Control": "no-store"},
    )


@app.post("/api/auth/login/{flow_id}/complete")
async def provider_login_complete(
    request: Request,
    flow_id: str,
    _complete_request: ProviderLoginCompleteRequest,
) -> JSONResponse:
    """Atomically exchange one callback code and establish the local cookie."""

    if not _same_origin_write(request):
        return _provider_login_error(
            AuthSessionError(
                "origin_not_allowed",
                "仅允许从当前本地页面完成登录。",
                status_code=403,
            ),
            flow_id=flow_id,
        )
    created_handle: str | None = None
    try:
        binding = request.cookies.get(login_flow_cookie_name(flow_id))
        PROVIDER_LOGINS.verify_binding(flow_id, binding)
        completion: ProviderLoginCompletion | None = None
        claim = PROVIDER_LOGINS.claim_callback(flow_id)
        if claim is None:
            status = PROVIDER_LOGINS.status(flow_id)
            if status.get("status") == "failed":
                return JSONResponse(
                    status_code=400,
                    content=status,
                    headers={"Cache-Control": "no-store"},
                )
            return JSONResponse(
                status_code=202,
                content=status,
                headers={"Cache-Control": "no-store", "Retry-After": "1"},
            )

        if claim is not None:
            try:
                async with AUTH_UPSTREAM_SEMAPHORE:
                    upstream = await asyncio.to_thread(
                        exchange_oauth_authorization_code,
                        claim.authorization_code,
                        claim.grant.code_verifier,
                        redirect_uri=OAUTH_REDIRECT_URI,
                    )
                handle, entry, max_age = AUTH_REGISTRY.create(upstream)
                created_handle = handle
                completion = ProviderLoginCompletion(
                    handle=handle,
                    provider=claim.grant.provider,
                    user=entry.account.as_dict(),
                    max_age=max_age,
                    callback_path=claim.grant.callback_path,
                )
                try:
                    PROVIDER_LOGINS.finish_success(claim.grant, completion)
                except Exception:
                    AUTH_REGISTRY.delete(handle)
                    raise
            except AuthSessionError as error:
                PROVIDER_LOGINS.finish_failure(
                    claim.grant,
                    code=error.code,
                    message=error.message,
                )
                return _provider_login_error(error, flow_id=flow_id)

        if completion is None:
            raise AuthSessionError(
                "oauth_internal_error",
                "本地登录流程没有生成账号会话。",
                status_code=500,
            )
    except AuthSessionError as error:
        return _provider_login_error(error, flow_id=flow_id)
    except Exception:
        # Authorization code, verifier and token values are intentionally not
        # interpolated into this diagnostic.
        LOGGER.exception("Unexpected provider-login completion failure")
        return _provider_login_error(
            AuthSessionError(
                "oauth_internal_error",
                "本地登录服务发生异常。",
                status_code=500,
            ),
            flow_id=flow_id,
        )

    try:
        completion = PROVIDER_LOGINS.consume_completion(flow_id, binding)
    except AuthSessionError as error:
        # A concurrent cancel can remove the flow after token exchange but
        # before consumption.  Never leave that new account handle usable.
        if created_handle:
            AUTH_REGISTRY.delete(created_handle)
        return _provider_login_error(error, flow_id=flow_id)

    previous_handle = request.cookies.get(LOCAL_SESSION_COOKIE)
    if previous_handle and previous_handle != completion.handle:
        _remove_account_state(previous_handle)
    content = {
        "flowId": flow_id,
        "provider": completion.provider,
        "status": "authenticated",
        "user": dict(completion.user),
        "callbackPath": completion.callback_path,
    }
    response = JSONResponse(
        status_code=200,
        content=content,
        headers={"Cache-Control": "no-store"},
    )
    _set_auth_cookie(
        response,
        request,
        completion.handle,
        completion.max_age,
    )
    _expire_login_flow_cookie(response, request, flow_id)
    return response


@app.delete("/api/auth/login/{flow_id}")
async def provider_login_cancel(request: Request, flow_id: str) -> JSONResponse:
    if not _same_origin_write(request):
        return _provider_login_error(
            AuthSessionError(
                "origin_not_allowed",
                "仅允许从当前本地页面取消登录。",
                status_code=403,
            ),
            flow_id=flow_id,
        )
    try:
        PROVIDER_LOGINS.verify_binding(
            flow_id, request.cookies.get(login_flow_cookie_name(flow_id))
        )
        completion = PROVIDER_LOGINS.cancel(flow_id)
    except AuthSessionError as error:
        return _provider_login_error(error, flow_id=flow_id)
    if completion is not None:
        _remove_account_state(completion.handle)
    response = JSONResponse(
        status_code=200,
        content={"flowId": flow_id, "status": "cancelled"},
        headers={"Cache-Control": "no-store"},
    )
    if (
        completion is not None
        and request.cookies.get(LOCAL_SESSION_COOKIE) == completion.handle
    ):
        _expire_auth_cookie(response, request)
    _expire_login_flow_cookie(response, request, flow_id)
    return response


@app.get("/api/auth/session")
async def local_auth_session(request: Request) -> JSONResponse:
    handle = request.cookies.get(LOCAL_SESSION_COOKIE)
    entry = AUTH_REGISTRY.get(handle)
    response = JSONResponse(
        status_code=200,
        content={
            "authenticated": entry is not None,
            "user": entry.account.as_dict() if entry is not None else None,
        },
        headers={"Cache-Control": "no-store"},
    )
    if handle and entry is None:
        _expire_auth_cookie(response, request)
    return response


@app.get("/api/account/runtime")
async def account_runtime(request: Request) -> JSONResponse:
    handle = request.cookies.get(LOCAL_SESSION_COOKIE)
    entry = AUTH_REGISTRY.get(handle)
    if entry is None:
        response = _auth_error(
            AuthSessionError(
                "authentication_required",
                "请先通过 Session 登录账号。",
                status_code=401,
            )
        )
        if handle:
            _expire_auth_cookie(response, request)
        return response
    try:
        async with AUTH_UPSTREAM_SEMAPHORE:
            runtime = await asyncio.to_thread(fetch_account_runtime, entry)
    except AuthSessionError as error:
        if error.status_code in {401, 403} and handle:
            _remove_account_state(handle)
        response = _auth_error(error)
        if error.status_code in {401, 403}:
            _expire_auth_cookie(response, request)
        return response
    except Exception:
        LOGGER.exception("Unexpected account-runtime failure")
        return _auth_error(
            AuthSessionError(
                "runtime_internal_error",
                "本地账号能力服务发生异常。",
                status_code=500,
            )
        )
    return JSONResponse(
        status_code=200,
        content={
            "authenticated": True,
            "user": entry.account.as_dict(),
            "runtime": runtime,
        },
        headers={"Cache-Control": "no-store"},
    )


def _account_settings_response(
    entry: LocalAuthEntry,
    snapshot: AccountSettingsSnapshot,
    *,
    capabilities: dict[str, dict[str, Any]] | None = None,
    options: dict[str, list[dict[str, Any]]] | None = None,
    warnings: list[dict[str, str]] | None = None,
) -> JSONResponse:
    content: dict[str, Any] = {
        "authenticated": True,
        "user": entry.account.as_dict(),
        "settings": snapshot.settings,
        "revision": snapshot.revision,
        "updatedAt": snapshot.updated_at,
    }
    if capabilities is not None:
        content["capabilities"] = capabilities
    if options is not None:
        content["options"] = options
    if warnings:
        content["warnings"] = warnings
    return JSONResponse(
        status_code=200,
        content=content,
        headers={"Cache-Control": "no-store"},
    )


def _account_settings_error(
    entry: LocalAuthEntry, error: AccountSettingsError
) -> JSONResponse:
    return JSONResponse(
        status_code=error.status_code,
        content={
            "authenticated": True,
            "user": entry.account.as_dict(),
            "error": {"code": error.code, "message": error.message},
        },
        headers={"Cache-Control": "no-store"},
    )


def _upstream_settings_error(
    request: Request,
    handle: str | None,
    entry: LocalAuthEntry,
    error: AuthSessionError,
) -> JSONResponse:
    if error.status_code == 401:
        if handle:
            _remove_account_state(handle)
        response = _auth_error(error)
        _expire_auth_cookie(response, request)
        return response
    return JSONResponse(
        status_code=error.status_code,
        content={
            "authenticated": True,
            "user": entry.account.as_dict(),
            "error": {"code": error.code, "message": error.message},
        },
        headers={"Cache-Control": "no-store"},
    )


@app.get("/api/account/settings")
async def account_settings(request: Request) -> JSONResponse:
    """Load durable settings for the account bound to the local HttpOnly cookie."""

    handle = request.cookies.get(LOCAL_SESSION_COOKIE)
    entry = AUTH_REGISTRY.get(handle)
    if entry is None:
        response = _auth_error(
            AuthSessionError(
                "authentication_required",
                "Please sign in with a Session before loading account settings.",
                status_code=401,
            )
        )
        if handle:
            _expire_auth_cookie(response, request)
        return response
    try:
        local_snapshot = await asyncio.to_thread(ACCOUNT_SETTINGS.get, entry.account.id)
        async with AUTH_UPSTREAM_SEMAPHORE:
            upstream = await asyncio.to_thread(
                fetch_upstream_settings, entry, local_snapshot.settings
            )
        snapshot = AccountSettingsSnapshot(
            settings=upstream.settings,
            revision=local_snapshot.revision,
            updated_at=local_snapshot.updated_at,
        )
    except AccountSettingsError as error:
        return _account_settings_error(entry, error)
    except AuthSessionError as error:
        return _upstream_settings_error(request, handle, entry, error)
    except Exception:
        LOGGER.exception("Unexpected account-settings read failure")
        return _account_settings_error(
            entry,
            AccountSettingsError(
                "settings_internal_error",
                "The local settings service encountered an unexpected error.",
                status_code=500,
            ),
        )
    return _account_settings_response(
        entry,
        snapshot,
        capabilities=upstream.capabilities,
        options=upstream.options,
        warnings=upstream.warnings,
    )


@app.patch("/api/account/settings")
async def patch_account_settings(
    request: Request, patch_request: AccountSettingsPatchRequest
) -> JSONResponse:
    """Validate and apply a partial settings tree to its registered adapter."""

    if not _same_origin_write(request):
        return _auth_error(
            AuthSessionError(
                "origin_not_allowed",
                "Settings may only be changed from the current local site.",
                status_code=403,
            )
        )
    handle = request.cookies.get(LOCAL_SESSION_COOKIE)
    entry = AUTH_REGISTRY.get(handle)
    if entry is None:
        response = _auth_error(
            AuthSessionError(
                "authentication_required",
                "Please sign in with a Session before changing account settings.",
                status_code=401,
            )
        )
        if handle:
            _expire_auth_cookie(response, request)
        return response
    try:
        validated = validate_bridge_settings_patch(patch_request.changes)
        current = await asyncio.to_thread(ACCOUNT_SETTINGS.get, entry.account.id)
        if patch_request.revision is not None and patch_request.revision != current.revision:
            raise AccountSettingsError(
                "settings_revision_conflict",
                "Settings changed in another window. Reload the latest settings and try again.",
                status_code=409,
            )
        async with AUTH_UPSTREAM_SEMAPHORE:
            local_changes = await asyncio.to_thread(
                apply_upstream_settings, entry, validated
            )
        if local_changes:
            local_snapshot = await asyncio.to_thread(
                ACCOUNT_SETTINGS.patch,
                entry.account.id,
                local_changes,
                expected_revision=current.revision,
            )
        else:
            local_snapshot = current
        merged_settings = json.loads(json.dumps(current.settings))
        # The validated patch contains only schema-approved values.  Merge it
        # for the immediate response; the next GET re-reads upstream truth.
        def merge(target: dict[str, Any], changes: dict[str, Any]) -> None:
            for key, value in changes.items():
                if isinstance(value, dict) and isinstance(target.get(key), dict):
                    merge(target[key], value)
                else:
                    target[key] = value
        merge(merged_settings, validated)
        snapshot = AccountSettingsSnapshot(
            settings=merged_settings,
            revision=local_snapshot.revision,
            updated_at=local_snapshot.updated_at,
        )
    except AccountSettingsError as error:
        return _account_settings_error(entry, error)
    except AuthSessionError as error:
        return _upstream_settings_error(request, handle, entry, error)
    except Exception:
        LOGGER.exception("Unexpected account-settings update failure")
        return _account_settings_error(
            entry,
            AccountSettingsError(
                "settings_internal_error",
                "The local settings service encountered an unexpected error.",
                status_code=500,
            ),
        )
    return _account_settings_response(entry, snapshot)


def _model_preference_response(
    entry: LocalAuthEntry, preference: dict[str, str | None]
) -> JSONResponse:
    return JSONResponse(
        status_code=200,
        content={
            "authenticated": True,
            "user": entry.account.as_dict(),
            "preference": preference,
        },
        headers={"Cache-Control": "no-store"},
    )


@app.get("/api/account/model-preference")
async def account_model_preference(request: Request) -> JSONResponse:
    """Read the normal Chat surface's last-used model/effort only."""

    handle = request.cookies.get(LOCAL_SESSION_COOKIE)
    entry = AUTH_REGISTRY.get(handle)
    if entry is None:
        response = _auth_error(
            AuthSessionError(
                "authentication_required",
                "Please sign in with a Session before loading the model preference.",
                status_code=401,
            )
        )
        if handle:
            _expire_auth_cookie(response, request)
        return response
    try:
        async with AUTH_UPSTREAM_SEMAPHORE:
            preference = await asyncio.to_thread(read_chat_model_preference, entry)
    except AuthSessionError as error:
        return _upstream_settings_error(request, handle, entry, error)
    except Exception:
        LOGGER.exception("Unexpected model-preference read failure")
        return _upstream_settings_error(
            request,
            handle,
            entry,
            AuthSessionError(
                "model_preference_internal_error",
                "The local model preference service failed.",
                status_code=500,
            ),
        )
    return _model_preference_response(entry, preference)


@app.patch("/api/account/model-preference")
async def patch_account_model_preference(
    request: Request, patch_request: ChatModelPreferencePatchRequest
) -> JSONResponse:
    """Persist Chat's last-used model without mixing in Work or TPP settings."""

    if not _same_origin_write(request):
        return _auth_error(
            AuthSessionError(
                "origin_not_allowed",
                "Model preferences may only be changed from the current local site.",
                status_code=403,
            )
        )
    handle = request.cookies.get(LOCAL_SESSION_COOKIE)
    entry = AUTH_REGISTRY.get(handle)
    if entry is None:
        response = _auth_error(
            AuthSessionError(
                "authentication_required",
                "Please sign in with a Session before changing the model preference.",
                status_code=401,
            )
        )
        if handle:
            _expire_auth_cookie(response, request)
        return response
    try:
        async with AUTH_UPSTREAM_SEMAPHORE:
            preference = await asyncio.to_thread(
                write_chat_model_preference,
                entry,
                patch_request.modelSlug,
                patch_request.thinkingEffort,
            )
    except AuthSessionError as error:
        return _upstream_settings_error(request, handle, entry, error)
    except Exception:
        LOGGER.exception("Unexpected model-preference update failure")
        return _upstream_settings_error(
            request,
            handle,
            entry,
            AuthSessionError(
                "model_preference_internal_error",
                "The local model preference service failed.",
                status_code=500,
            ),
        )
    return _model_preference_response(entry, preference)


async def _logout_response(request: Request) -> JSONResponse:
    if not _same_origin_write(request):
        return _auth_error(
            AuthSessionError(
                "origin_not_allowed",
                "仅允许从当前本地页面提交退出请求。",
                status_code=403,
            )
        )
    handle = request.cookies.get(LOCAL_SESSION_COOKIE)
    if handle:
        _remove_account_state(handle)
    response = JSONResponse(
        status_code=200,
        content={"authenticated": False, "user": None},
        headers={"Cache-Control": "no-store"},
    )
    _expire_auth_cookie(response, request)
    return response


@app.post("/api/auth/logout")
async def session_logout(request: Request) -> JSONResponse:
    return await _logout_response(request)


@app.delete("/api/auth/session")
async def delete_local_auth_session(request: Request) -> JSONResponse:
    return await _logout_response(request)


def _readiness_response() -> JSONResponse:
    guest_dependency = BRIDGE.dependency_status()
    authenticated_dependency = AUTH_BRIDGE.dependency_status()
    ready = bool(guest_dependency["ready"] and authenticated_dependency["ready"])
    return JSONResponse(
        status_code=200 if ready else 503,
        content={
            "status": "ok" if ready else "degraded",
            "service": "chatgpt-local-replica-bridge",
            "mode": "guest-and-authenticated-web-protocol",
            "first_turn": True,
            "continuations": "in-memory-via-X-Conversation-Id",
            "active_conversations": REGISTRY.count(),
            "active_authenticated_conversations": AUTH_CONVERSATIONS.count(),
            "active_authenticated_history_bindings": AUTH_HISTORY.count(),
            "active_account_sessions": AUTH_REGISTRY.count(),
            "max_attempts": BRIDGE.config.max_turn_attempts,
            "dependencies": {
                "guest": guest_dependency,
                "authenticated": authenticated_dependency,
            },
        },
        headers={"Cache-Control": "no-store"},
    )


@app.get("/api/health/live")
async def health_live() -> JSONResponse:
    """Process liveness probe; deliberately avoids all upstream checks."""

    return JSONResponse(
        status_code=200,
        content={
            "status": "ok",
            "service": "chatgpt-local-replica-bridge",
            "probe": "liveness",
        },
        headers={"Cache-Control": "no-store"},
    )


@app.get("/api/health/ready")
async def health_ready() -> JSONResponse:
    """Deployment readiness probe with local runtime dependency checks."""

    return _readiness_response()


@app.get("/api/health")
async def health() -> JSONResponse:
    """Backward-compatible alias for the readiness probe."""

    return _readiness_response()


async def _codex_reset_consume_payload(
    request: Request,
) -> CodexResetCreditConsumeRequest:
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type != "application/json":
        raise AuthSessionError(
            "content_type_required",
            "请使用 application/json 提交用量重置请求。",
            status_code=415,
        )
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            declared = int(content_length)
        except ValueError as error:
            raise AuthSessionError(
                "invalid_content_length",
                "请求长度格式不正确。",
                status_code=400,
            ) from error
        if declared < 0:
            raise AuthSessionError(
                "invalid_content_length",
                "请求长度格式不正确。",
                status_code=400,
            )
        if declared > MAX_CODEX_RESET_CONSUME_BODY_BYTES:
            raise AuthSessionError(
                "reset_request_too_large",
                "用量重置请求体不能超过 4 KiB。",
                status_code=413,
            )

    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > MAX_CODEX_RESET_CONSUME_BODY_BYTES:
            raise AuthSessionError(
                "reset_request_too_large",
                "用量重置请求体不能超过 4 KiB。",
                status_code=413,
            )
        chunks.append(chunk)
    body = b"".join(chunks)
    if not body:
        raise AuthSessionError(
            "invalid_reset_request",
            "用量重置请求不能为空。",
            status_code=400,
        )
    try:
        return CodexResetCreditConsumeRequest.model_validate_json(body)
    except ValidationError as error:
        raise AuthSessionError(
            "invalid_reset_request",
            "用量重置请求格式不正确。",
            status_code=400,
        ) from error


def _codex_reset_route_error(
    request: Request,
    handle: str | None,
    error: AuthSessionError,
) -> JSONResponse:
    if error.status_code == 401:
        if handle:
            _remove_account_state(handle)
        response = _auth_error(error)
        if handle:
            _expire_auth_cookie(response, request)
        return response
    return JSONResponse(
        status_code=error.status_code,
        content={
            "ok": False,
            "authenticated": True,
            "error": {"code": error.code, "message": error.message},
        },
        headers={"Cache-Control": "no-store"},
    )


@app.get("/api/codex/reset-credits")
async def codex_reset_credits(request: Request) -> JSONResponse:
    handle = request.cookies.get(LOCAL_SESSION_COOKIE)
    entry = AUTH_REGISTRY.get(handle)
    if entry is None:
        response = _auth_error(
            AuthSessionError(
                "authentication_required",
                "请先通过 Session 登录账号。",
                status_code=401,
            )
        )
        if handle:
            _expire_auth_cookie(response, request)
        return response
    try:
        async with AUTH_UPSTREAM_SEMAPHORE:
            payload = await asyncio.to_thread(fetch_codex_reset_credits, entry)
    except AuthSessionError as error:
        return _codex_reset_route_error(request, handle, error)
    except Exception:
        LOGGER.error("Unexpected Codex reset-credit list failure (%s)", "internal")
        return _codex_reset_route_error(
            request,
            handle,
            AuthSessionError(
                "reset_credits_internal_error",
                "本地用量重置服务发生异常。",
                status_code=500,
            ),
        )
    return JSONResponse(
        status_code=200,
        content=payload,
        headers={"Cache-Control": "no-store"},
    )


@app.post("/api/codex/reset-credits/consume")
async def codex_reset_credit_consume(request: Request) -> JSONResponse:
    if not _same_origin_write(request):
        return _auth_error(
            AuthSessionError(
                "origin_not_allowed",
                "仅允许从当前本地页面提交用量重置请求。",
                status_code=403,
            )
        )
    try:
        consume_request = await _codex_reset_consume_payload(request)
    except AuthSessionError as error:
        return _auth_error(error)

    handle = request.cookies.get(LOCAL_SESSION_COOKIE)
    entry = AUTH_REGISTRY.get(handle)
    if entry is None:
        response = _auth_error(
            AuthSessionError(
                "authentication_required",
                "请先通过 Session 登录账号。",
                status_code=401,
            )
        )
        if handle:
            _expire_auth_cookie(response, request)
        return response
    try:
        async with AUTH_UPSTREAM_SEMAPHORE:
            payload = await asyncio.to_thread(
                consume_codex_reset_credit,
                entry,
                credit_id=consume_request.creditId,
                redeem_request_id=consume_request.redeemRequestId,
            )
    except AuthSessionError as error:
        return _codex_reset_route_error(request, handle, error)
    except Exception:
        LOGGER.error("Unexpected Codex reset-credit consume failure (%s)", "internal")
        return _codex_reset_route_error(
            request,
            handle,
            AuthSessionError(
                "reset_credit_internal_error",
                "本地用量重置服务发生异常。",
                status_code=500,
            ),
        )
    return JSONResponse(
        status_code=200,
        content=payload,
        headers={"Cache-Control": "no-store"},
    )


@app.get("/api/codex/analytics")
async def codex_analytics(request: Request) -> JSONResponse:
    """Return live WHAM quota for the account bound to the local HttpOnly session."""

    handle = request.cookies.get(LOCAL_SESSION_COOKIE)
    entry = AUTH_REGISTRY.get(handle)
    if entry is None:
        response = _auth_error(
            AuthSessionError(
                "authentication_required",
                "请先通过 Session 登录账号。",
                status_code=401,
            )
        )
        if handle:
            _expire_auth_cookie(response, request)
        return response

    try:
        async with AUTH_UPSTREAM_SEMAPHORE:
            payload = await asyncio.to_thread(fetch_codex_usage, entry)
    except AuthSessionError as error:
        # A WHAM 403 can be a plan/feature denial while the upstream login is
        # still valid. Only an actual authentication failure invalidates the
        # local handle and its account-bound state.
        if error.status_code == 401 and handle:
            _remove_account_state(handle)
        if error.status_code == 403:
            return JSONResponse(
                status_code=403,
                content={
                    "ok": False,
                    "live": False,
                    "authenticated": True,
                    "availability": "unavailable",
                    "source": "chatgpt-wham",
                    "error": {"code": error.code, "message": error.message},
                },
                headers={"Cache-Control": "no-store"},
            )
        if error.status_code != 401:
            return JSONResponse(
                status_code=error.status_code,
                content={
                    "ok": False,
                    "live": False,
                    "authenticated": True,
                    "availability": "unavailable",
                    "source": "chatgpt-wham",
                    "error": {"code": error.code, "message": error.message},
                },
                headers={"Cache-Control": "no-store"},
            )
        response = _auth_error(error)
        if error.status_code == 401:
            _expire_auth_cookie(response, request)
        return response
    except Exception:
        # Deliberately omit exception text: an upstream implementation might
        # attach request headers to it, which could contain the bearer/cookie.
        LOGGER.error("Unexpected Codex usage failure (%s)", "internal")
        return JSONResponse(
            status_code=500,
            content={
                "ok": False,
                "live": False,
                "authenticated": True,
                "availability": "unavailable",
                "source": "chatgpt-wham",
                "error": {
                    "code": "usage_internal_error",
                    "message": "本地 Codex 用量服务发生异常。",
                },
            },
            headers={"Cache-Control": "no-store"},
        )

    return JSONResponse(
        status_code=200,
        content=payload,
        headers={"Cache-Control": "no-store"},
    )


def _execute_chat(
    prompt: str,
    conversation_id: str | None,
    owner: str,
) -> tuple[ProtocolSession, ChatResult]:
    if conversation_id:
        session = REGISTRY.get(conversation_id, owner=owner)
        if session is None:
            raise ProtocolError(
                "conversation_not_found",
                "The supplied conversation id header is unknown or expired.",
                stage="local_session",
                retryable=False,
            )
        with session.lock:
            active_session, result = BRIDGE.run_turn(
                session,
                prompt,
                allow_first_turn_rebootstrap=False,
            )
            REGISTRY.put(active_session, owner=owner, previous_id=conversation_id)
            return active_session, result

    session = BRIDGE.create_session()
    try:
        with session.lock:
            active_session, result = BRIDGE.run_turn(
                session,
                prompt,
                allow_first_turn_rebootstrap=True,
            )
        REGISTRY.put(active_session, owner=owner)
        return active_session, result
    except Exception:
        session.close()
        raise


@dataclass
class GuestChatStreamContext:
    session: ProtocolSession
    stream: GuestTurnStream
    owner: str
    public_conversation_id: str
    previous_id: str | None
    new_session: bool
    lock_held: bool = True
    committed: bool = False


def _open_guest_chat_stream(
    prompt: str,
    conversation_id: str | None,
    owner: str,
) -> GuestChatStreamContext:
    new_session = conversation_id is None
    if conversation_id:
        session = REGISTRY.get(conversation_id, owner=owner)
        if session is None:
            raise ProtocolError(
                "conversation_not_found",
                "The supplied conversation id header is unknown or expired.",
                stage="local_session",
                retryable=False,
            )
        public_conversation_id = conversation_id
    else:
        session = BRIDGE.create_session()
        # The browser receives only this opaque, process-local handle. The
        # upstream id is learned later from DPU state and never has to delay
        # response headers or cross the bridge boundary.
        public_conversation_id = "guestconv-" + secrets.token_urlsafe(24)

    locked_session = session
    locked_session.lock.acquire()
    try:
        active_session, stream = BRIDGE.run_turn_stream(
            session,
            prompt,
            allow_first_turn_rebootstrap=new_session,
        )
        if active_session is not locked_session:
            locked_session.lock.release()
            locked_session = active_session
            locked_session.lock.acquire()
        return GuestChatStreamContext(
            session=active_session,
            stream=stream,
            owner=owner,
            public_conversation_id=public_conversation_id,
            previous_id=conversation_id,
            new_session=new_session,
        )
    except Exception:
        locked_session.lock.release()
        if new_session:
            session.close()
        raise


def _commit_guest_chat_stream(context: GuestChatStreamContext) -> ChatResult:
    result = context.stream.result
    if result is None:
        raise ProtocolError(
            "dpu_missing_complete",
            "The DPU stream did not contain a terminal complete control.",
            stage="conversation_dpu",
            retryable=True,
        )
    if not context.committed:
        REGISTRY.put(
            context.session,
            owner=context.owner,
            previous_id=context.previous_id,
            public_id=context.public_conversation_id,
        )
        context.committed = True
    return result


def _release_guest_chat_stream(context: GuestChatStreamContext) -> None:
    if context.lock_held:
        context.session.lock.release()
        context.lock_held = False


def _abort_guest_chat_stream(context: GuestChatStreamContext) -> None:
    context.stream.close()
    if context.previous_id:
        REGISTRY.remove(
            context.previous_id,
            owner=context.owner,
            expected_session=context.session,
        )
    else:
        context.session.close()
    _release_guest_chat_stream(context)


def _refresh_authenticated_credential(
    account_entry: LocalAuthEntry,
    protocol_session: AuthenticatedProtocolSession,
) -> Any:
    """Refresh or synchronize a protocol session without exposing credentials."""

    current = ensure_fresh_credential(account_entry, minimum_validity_seconds=300)
    if current.access_token != protocol_session.access_token:
        return current
    return refresh_local_auth_entry(account_entry)


def _bind_authenticated_credential(
    session: AuthenticatedProtocolSession,
    account_entry: LocalAuthEntry,
    *,
    force_refresh: bool = False,
) -> Any:
    """Synchronize a continuation session with the account's current token."""

    credential = (
        refresh_local_auth_entry(account_entry)
        if force_refresh
        else ensure_fresh_credential(account_entry, minimum_validity_seconds=300)
    )
    if (
        session.account_id
        and credential.account_id
        and session.account_id != credential.account_id
    ):
        raise AuthSessionError(
            "session_identity_mismatch",
            "The authenticated conversation belongs to a different account.",
            status_code=401,
        )
    with session.lock:
        session.access_token = credential.access_token
        session.cookie_header = credential.cookie_header or session.cookie_header
        session.account_id = credential.account_id or session.account_id
        session.user_id = credential.user_id or session.user_id
    return credential


def _upload_authenticated_attachment(
    session: AuthenticatedProtocolSession,
    account_entry: LocalAuthEntry,
    attachment: IncomingAttachment,
    *,
    model: str,
) -> dict[str, Any]:
    """Upload one file, refreshing only after a real upstream 401."""

    for attempt in range(2):
        try:
            return AUTH_FILES.upload(
                session,
                attachment.file_bytes,
                file_name=attachment.file_name,
                mime_type=attachment.mime_type,
                width=attachment.width,
                height=attachment.height,
                model_slug=model,
            )
        except AuthenticatedProtocolError as error:
            if attempt or error.upstream_status != 401:
                raise
            _bind_authenticated_credential(
                session, account_entry, force_refresh=True
            )
    raise AssertionError("unreachable authenticated upload retry state")


def _execute_authenticated_chat(
    prompt: str,
    attachments: tuple[IncomingAttachment, ...],
    conversation_id: str | None,
    owner: str,
    account_entry: LocalAuthEntry,
    *,
    model: str,
    reasoning_effort: str | None,
    service_tier: str | None,
) -> tuple[str, AuthenticatedProtocolSession, AuthenticatedChatResult]:
    selected_model = model.strip()
    if selected_model in {"", "auto", "chatgpt-guest"}:
        selected_model = "auto"

    if conversation_id:
        session = AUTH_CONVERSATIONS.get_or_resolve(
            conversation_id,
            owner=owner,
            factory=lambda detail: _create_history_continuation(
                account_entry, detail
            ),
        )
        if session is None:
            raise AuthenticatedProtocolError(
                "conversation_not_found",
                "The supplied conversation id header is unknown or expired.",
                stage="local_session",
                retryable=False,
            )
        # Runtime/model discovery may have refreshed the account token since
        # this conversation was created.  Rebind before any file request.
        _bind_authenticated_credential(session, account_entry)
        references = [
            _upload_authenticated_attachment(
                session, account_entry, attachment, model=selected_model
            )
            for attachment in attachments
        ]
        user_message = (
            build_user_message_with_file_references(
                prompt, str(uuid.uuid4()), references
            )
            if references
            else None
        )
        result = AUTH_BRIDGE.run_turn(
            session,
            prompt,
            model=selected_model,
            reasoning_effort=reasoning_effort,
            service_tier=service_tier,
            user_message=user_message,
        )
        return conversation_id, session, result

    credential = ensure_fresh_credential(
        account_entry, minimum_validity_seconds=300
    )
    session = AUTH_BRIDGE.create_session(
        credential,
        model=selected_model,
        token_refresh_hook=lambda active: _refresh_authenticated_credential(
            account_entry, active
        ),
    )
    try:
        references = [
            _upload_authenticated_attachment(
                session, account_entry, attachment, model=selected_model
            )
            for attachment in attachments
        ]
        user_message = (
            build_user_message_with_file_references(
                prompt, str(uuid.uuid4()), references
            )
            if references
            else None
        )
        result = AUTH_BRIDGE.run_turn(
            session,
            prompt,
            model=selected_model,
            reasoning_effort=reasoning_effort,
            service_tier=service_tier,
            user_message=user_message,
        )
        local_id = AUTH_CONVERSATIONS.put(session, owner=owner)
        return local_id, session, result
    except Exception:
        session.close()
        raise


def _history_error(error: AuthSessionError) -> JSONResponse:
    """Return a credential-free history error without lying about 403 auth state."""

    return JSONResponse(
        status_code=error.status_code,
        content={"error": {"code": error.code, "message": error.message}},
        headers={"Cache-Control": "no-store"},
    )


def _history_read_with_refresh(
    account_entry: LocalAuthEntry, operation: Any
) -> Any:
    """Run one history read and refresh exactly once after an upstream 401."""

    refreshed = False
    while True:
        try:
            credential = ensure_fresh_credential(
                account_entry, minimum_validity_seconds=300
            )
            return operation(credential)
        except AuthSessionError as error:
            if error.status_code != 401 or refreshed:
                raise
            refreshed = True
            refresh_local_auth_entry(account_entry)


def _history_binding_dto(binding: HistoryBinding) -> dict[str, Any]:
    dto: dict[str, Any] = {
        "id": binding.local_id,
        "title": binding.title,
    }
    if binding.created_at is not None:
        dto["createdAt"] = binding.created_at
    if binding.updated_at is not None:
        dto["updatedAt"] = binding.updated_at
    return dto


def _create_history_continuation(
    account_entry: LocalAuthEntry, detail: HistoryDetail
) -> AuthenticatedProtocolSession:
    """Bootstrap a chat session and bind its private continuation pointers."""

    refreshed = False
    while True:
        credential = ensure_fresh_credential(
            account_entry, minimum_validity_seconds=300
        )
        try:
            session = AUTH_BRIDGE.create_session(
                credential,
                model=detail.model,
                token_refresh_hook=lambda active: _refresh_authenticated_credential(
                    account_entry, active
                ),
            )
            break
        except AuthenticatedProtocolError as error:
            if error.upstream_status != 401 or refreshed:
                raise
            refreshed = True
            refresh_local_auth_entry(account_entry)

    try:
        last_user = next(
            (
                message.upstream_id
                for message in reversed(detail.messages)
                if message.role == "user"
            ),
            None,
        )
        last_assistant = next(
            (
                message.upstream_id
                for message in reversed(detail.messages)
                if message.role == "assistant"
            ),
            None,
        )
        with session.lock:
            session.conversation_id = detail.upstream_id
            session.parent_message_id = detail.current_node
            session.model = detail.model
            session.turn_index = sum(
                1 for message in detail.messages if message.role == "user"
            )
            session.conversation_state = {
                "conversationId": detail.upstream_id,
                "parentMessageId": detail.current_node,
                "lastUserMessageId": last_user,
                "lastAssistantMessageId": last_assistant,
                "model": detail.model,
                "turnIndex": session.turn_index,
                "loadedFromHistory": True,
            }
    except Exception:
        session.close()
        raise
    return session


@app.get("/api/conversations")
async def conversation_history(
    request: Request,
    cursor: str | None = Query(default=None, max_length=128),
    limit: int = Query(default=28, ge=1, le=50),
) -> JSONResponse:
    handle = request.cookies.get(LOCAL_SESSION_COOKIE)
    account_entry = AUTH_REGISTRY.get(handle)
    if account_entry is None:
        response = _history_error(
            AuthSessionError(
                "authentication_required",
                "Please sign in with a Session before loading conversation history.",
                status_code=401,
            )
        )
        if handle:
            _expire_auth_cookie(response, request)
        return response

    owner = AUTH_REGISTRY.owner_key(handle)
    if cursor:
        offset = AUTH_HISTORY.resolve_cursor(owner, cursor)
        if offset is None:
            return _history_error(
                AuthSessionError(
                    "history_cursor_invalid",
                    "The supplied history cursor is unknown or expired.",
                    status_code=400,
                )
            )
    else:
        offset = 0

    try:
        async with AUTH_HISTORY_SEMAPHORE:
            page = await asyncio.to_thread(
                _history_read_with_refresh,
                account_entry,
                lambda credential: AUTH_HISTORY_BRIDGE.list_conversations(
                    credential, offset=offset, limit=limit
                ),
            )
        if AUTH_REGISTRY.get(handle) is not account_entry:
            raise AuthSessionError(
                "authentication_expired",
                "The local account session expired while loading conversation history.",
                status_code=401,
            )
        bindings = [AUTH_HISTORY.bind(owner, summary) for summary in page.items]
        next_offset = page.offset + page.limit
        next_cursor = (
            AUTH_HISTORY.create_cursor(owner, next_offset)
            if next_offset < page.total
            else None
        )
        if AUTH_REGISTRY.get(handle) is not account_entry:
            AUTH_HISTORY.remove_owner(owner)
            raise AuthSessionError(
                "authentication_expired",
                "The local account session expired while loading conversation history.",
                status_code=401,
            )
    except AuthSessionError as error:
        if error.status_code == 401 and handle:
            _remove_account_state(handle)
        response = _history_error(error)
        if error.status_code == 401 and handle:
            _expire_auth_cookie(response, request)
        return response
    except Exception as error:
        # Do not stringify arbitrary HTTP/runtime exceptions: implementations
        # may attach request headers or private upstream identifiers.
        LOGGER.error(
            "Unexpected conversation-history list failure (%s)",
            type(error).__name__,
        )
        return _history_error(
            AuthSessionError(
                "history_internal_error",
                "The local conversation history service failed.",
                status_code=500,
            )
        )

    return JSONResponse(
        status_code=200,
        content={
            "items": [_history_binding_dto(binding) for binding in bindings],
            "nextCursor": next_cursor,
        },
        headers={"Cache-Control": "no-store"},
    )


@app.get("/api/conversations/{conversation_id}")
async def conversation_history_detail(
    conversation_id: str, request: Request
) -> JSONResponse:
    handle = request.cookies.get(LOCAL_SESSION_COOKIE)
    account_entry = AUTH_REGISTRY.get(handle)
    if account_entry is None:
        response = _history_error(
            AuthSessionError(
                "authentication_required",
                "Please sign in with a Session before loading a conversation.",
                status_code=401,
            )
        )
        if handle:
            _expire_auth_cookie(response, request)
        return response

    owner = AUTH_REGISTRY.owner_key(handle)
    binding = AUTH_HISTORY.resolve(owner, conversation_id)
    if binding is None:
        return _history_error(
            AuthSessionError(
                "conversation_not_found",
                "The supplied local conversation id is unknown or expired.",
                status_code=404,
            )
        )

    try:
        async with AUTH_HISTORY_SEMAPHORE:
            detail = await asyncio.to_thread(
                _history_read_with_refresh,
                account_entry,
                lambda credential: AUTH_HISTORY_BRIDGE.get_conversation(
                    credential,
                    binding.upstream_id,
                    fallback_title=binding.title,
                    fallback_created_at=binding.created_at,
                    fallback_updated_at=binding.updated_at,
                    project_id=binding.project_id,
                ),
            )
        # Logout can race a slow upstream detail read. Check on both sides of
        # registry insertion so private upstream continuation pointers cannot
        # be reintroduced after the auth cleanup callback has run.
        if AUTH_REGISTRY.get(handle) is not account_entry:
            raise AuthSessionError(
                "authentication_expired",
                "The local account session expired while loading the conversation.",
                status_code=401,
            )
        continuation_id = AUTH_CONVERSATIONS.put_pending(detail, owner=owner)
        if AUTH_REGISTRY.get(handle) is not account_entry:
            AUTH_CONVERSATIONS.remove_owner(owner)
            raise AuthSessionError(
                "authentication_expired",
                "The local account session expired while loading the conversation.",
                status_code=401,
            )
    except AuthSessionError as error:
        if error.status_code == 401 and handle:
            _remove_account_state(handle)
        response = _history_error(error)
        if error.status_code == 401 and handle:
            _expire_auth_cookie(response, request)
        return response
    except Exception as error:
        LOGGER.error(
            "Unexpected conversation-history detail failure (%s)",
            type(error).__name__,
        )
        return _history_error(
            AuthSessionError(
                "history_internal_error",
                "The local conversation history service failed.",
                status_code=500,
            )
        )

    conversation_dto: dict[str, Any] = {
        "id": conversation_id,
        "title": detail.title,
    }
    if detail.created_at is not None:
        conversation_dto["createdAt"] = detail.created_at
    if detail.updated_at is not None:
        conversation_dto["updatedAt"] = detail.updated_at
    messages = []
    for message in detail.messages:
        dto: dict[str, Any] = {
            "id": "msg-" + secrets.token_urlsafe(18),
            "role": message.role,
            "content": message.content,
        }
        if message.created_at is not None:
            dto["createdAt"] = message.created_at
        messages.append(dto)
    return JSONResponse(
        status_code=200,
        content={
            "conversation": conversation_dto,
            "messages": messages,
            "continuationId": continuation_id,
        },
        headers={"Cache-Control": "no-store"},
    )


def _chunk_text(text: str, size: int = 28) -> list[str]:
    if not text:
        return []
    return [text[index : index + size] for index in range(0, len(text), size)]


def _sse_line(payload: dict[str, Any]) -> bytes:
    return (
        "data: " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n\n"
    ).encode("utf-8")


async def _completion_sse(
    result: ChatResult,
    *,
    completion_id: str,
    model: str,
    created: int,
) -> AsyncIterator[bytes]:
    yield _sse_line(
        {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "delta": {"role": "assistant"},
                    "finish_reason": None,
                }
            ],
        }
    )
    for delta in _chunk_text(result.answer):
        yield _sse_line(
            {
                "id": completion_id,
                "object": "chat.completion.chunk",
                "created": created,
                "model": model,
                "choices": [
                    {
                        "index": 0,
                        "delta": {"content": delta},
                        "finish_reason": None,
                    }
                ],
            }
        )
        await asyncio.sleep(0)
    yield _sse_line(
        {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "delta": {},
                    "finish_reason": "stop",
                }
            ],
        }
    )
    yield b"data: [DONE]\n\n"


def _stream_error_line(error: ProtocolError) -> bytes:
    detail = error.public_detail()
    detail.pop("upstream_request_id", None)
    return _sse_line(
        {
            "error": {
                "message": error.message,
                "type": "upstream_error",
                "param": None,
                "code": error.code,
                "detail": detail,
            }
        }
    )


async def _guest_completion_sse(
    context: GuestChatStreamContext,
    *,
    completion_id: str,
    model: str,
    created: int,
) -> AsyncIterator[bytes]:
    completed = False
    try:
        yield _sse_line(
            {
                "id": completion_id,
                "object": "chat.completion.chunk",
                "created": created,
                "model": model,
                "choices": [
                    {
                        "index": 0,
                        "delta": {"role": "assistant"},
                        "finish_reason": None,
                    }
                ],
            }
        )
        while True:
            delta = await asyncio.to_thread(context.stream.next_delta)
            if delta is None:
                break
            yield _sse_line(
                {
                    "id": completion_id,
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": model,
                    "choices": [
                        {
                            "index": 0,
                            "delta": {"content": delta},
                            "finish_reason": None,
                        }
                    ],
                }
            )

        _commit_guest_chat_stream(context)
        completed = True
        yield _sse_line(
            {
                "id": completion_id,
                "object": "chat.completion.chunk",
                "created": created,
                "model": model,
                "choices": [
                    {
                        "index": 0,
                        "delta": {},
                        "finish_reason": "stop",
                    }
                ],
            }
        )
        yield b"data: [DONE]\n\n"
    except ProtocolError as error:
        # HTTP status cannot change after streaming headers are sent. Emit an
        # explicit OpenAI-shaped error event and deliberately omit stop/DONE;
        # callers must never mistake a truncated upstream turn for success.
        yield _stream_error_line(error)
    except Exception:
        LOGGER.exception("Unhandled guest stream failure")
        yield _stream_error_line(
            ProtocolError(
                "bridge_stream_internal_error",
                "The local bridge stream encountered an unexpected error.",
                stage="local",
                retryable=False,
            )
        )
    finally:
        try:
            if completed or context.stream.result is not None:
                _commit_guest_chat_stream(context)
                _release_guest_chat_stream(context)
            else:
                _abort_guest_chat_stream(context)
        except Exception:
            LOGGER.exception("Guest stream cleanup failed")
            _release_guest_chat_stream(context)
        finally:
            UPSTREAM_SEMAPHORE.release()


@app.post("/api/chat/completions", response_model=None)
@app.post("/api/chat/authenticated/completions", response_model=None)
async def chat_completions(
    http_request: Request,
    request: ChatCompletionRequest,
    x_conversation_id: str | None = Header(
        default=None,
        alias="X-Conversation-Id",
    ),
    x_chat_conversation_id: str | None = Header(
        default=None,
        alias="X-Chat-Conversation-Id",
    ),
) -> JSONResponse | StreamingResponse:
    if not _same_origin_write(http_request):
        return _openai_error(
            403,
            ProtocolError(
                "origin_not_allowed",
                "Chat requests may only be submitted from this site or an explicitly allowed origin.",
                stage="authentication",
                retryable=False,
            ),
        )
    try:
        latest_user = _latest_user_input(request)
    except ProtocolError as error:
        return _openai_error(400, error)
    prompt = latest_user.prompt
    attachments = latest_user.attachments

    # `X-Conversation-Id` is the frontend contract. Keep the longer alias for
    # command-line clients built against the initial bridge prototype.
    conversation_id = (
        (x_conversation_id or "").strip()
        or (x_chat_conversation_id or "").strip()
        or None
    )
    local_handle = http_request.cookies.get(LOCAL_SESSION_COOKIE)
    local_account = AUTH_REGISTRY.get(local_handle)
    require_authenticated = (
        http_request.url.path == "/api/chat/authenticated/completions"
    )
    if local_handle and local_account is None:
        response = _openai_error(
            401,
            ProtocolError(
                "authentication_expired",
                "The local account session is unknown or expired. Please sign in again.",
                stage="authentication",
                retryable=False,
            ),
        )
        _expire_auth_cookie(response, http_request)
        return response
    if require_authenticated and local_account is None:
        return _openai_error(
            401,
            ProtocolError(
                "authentication_required",
                "A verified account session is required for this chat endpoint.",
                stage="authentication",
                retryable=False,
            ),
        )
    if attachments and local_account is None:
        return _openai_error(
            403,
            ProtocolError(
                "attachments_require_authentication",
                "File and image attachments require an authenticated account session.",
                stage="authentication",
                retryable=False,
            ),
        )
    owner = (
        AUTH_REGISTRY.owner_key(local_handle)
        if local_handle and local_account is not None
        else "guest"
    )

    if local_account is None and request.stream:
        await UPSTREAM_SEMAPHORE.acquire()
        setup_task = asyncio.create_task(
            asyncio.to_thread(
                _open_guest_chat_stream,
                prompt,
                conversation_id,
                owner,
            )
        )
        try:
            stream_context = await asyncio.shield(setup_task)
        except ProtocolError as error:
            UPSTREAM_SEMAPHORE.release()
            return _openai_error(_protocol_error_status(error), error)
        except asyncio.CancelledError:
            # Cancelling an asyncio Future cannot stop curl work already
            # running in its worker thread. Wait for setup to hand ownership
            # back, then close it, so no session lock/connection is orphaned.
            try:
                abandoned_context = await setup_task
            except Exception:
                pass
            else:
                _abort_guest_chat_stream(abandoned_context)
            finally:
                UPSTREAM_SEMAPHORE.release()
            raise
        except Exception:
            UPSTREAM_SEMAPHORE.release()
            LOGGER.exception("Unhandled guest stream setup failure")
            return _openai_error(
                500,
                ProtocolError(
                    "bridge_internal_error",
                    "The local bridge encountered an unexpected error.",
                    stage="local",
                    retryable=False,
                ),
            )

        completion_id = "chatcmpl-" + uuid.uuid4().hex
        created = int(time.time())
        response_conversation_id = stream_context.public_conversation_id
        return StreamingResponse(
            _guest_completion_sse(
                stream_context,
                completion_id=completion_id,
                model=request.model,
                created=created,
            ),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no",
                "X-Conversation-Id": response_conversation_id,
                "X-Chat-Conversation-Id": response_conversation_id,
                "X-ChatGPT-Bridge-Attempts": str(stream_context.stream.attempts),
                "X-ChatGPT-Identity-Mode": "guest",
            },
        )

    try:
        if local_account is not None:
            async with AUTH_UPSTREAM_SEMAPHORE:
                response_conversation_id, _, result = await asyncio.to_thread(
                    _execute_authenticated_chat,
                    prompt,
                    attachments,
                    conversation_id,
                    owner,
                    local_account,
                    model=request.model,
                    reasoning_effort=request.reasoning_effort,
                    service_tier=request.service_tier,
                )
        else:
            async with UPSTREAM_SEMAPHORE:
                _, result = await asyncio.to_thread(
                    _execute_chat,
                    prompt,
                    conversation_id,
                    owner,
                )
            response_conversation_id = result.conversation_id
    except AuthSessionError as error:
        # A 403 can be a plan/tool gate or an upstream challenge.  Only an
        # authoritative unauthorized result invalidates the local login.
        invalidates_login = error.status_code == 401
        if invalidates_login and local_handle:
            _remove_account_state(local_handle)
        response = _openai_error(
            error.status_code,
            ProtocolError(
                error.code,
                error.message,
                stage="authentication",
                retryable=False,
                upstream_status=error.status_code,
            ),
        )
        if invalidates_login and local_handle:
            _expire_auth_cookie(response, http_request)
        return response
    except ProtocolError as error:
        status = _protocol_error_status(error)
        response = _openai_error(status, error)
        if status == 401 and local_handle:
            _remove_account_state(local_handle)
            _expire_auth_cookie(response, http_request)
        return response
    except Exception:
        LOGGER.exception("Unhandled bridge failure")
        return _openai_error(
            500,
            ProtocolError(
                "bridge_internal_error",
                "The local bridge encountered an unexpected error.",
                stage="local",
                retryable=False,
            ),
        )

    completion_id = "chatcmpl-" + uuid.uuid4().hex
    created = int(time.time())
    headers = {
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "X-Conversation-Id": response_conversation_id,
        "X-Chat-Conversation-Id": response_conversation_id,
        "X-ChatGPT-Bridge-Attempts": str(result.attempts),
        "X-ChatGPT-Identity-Mode": "verified-session" if local_account else "guest",
    }
    if request.stream:
        return StreamingResponse(
            _completion_sse(
                result,
                completion_id=completion_id,
                model=request.model,
                created=created,
            ),
            media_type="text/event-stream",
            headers=headers,
        )

    return JSONResponse(
        status_code=200,
        headers=headers,
        content={
            "id": completion_id,
            "object": "chat.completion",
            "created": created,
            "model": request.model,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": result.answer},
                    "finish_reason": "stop",
                }
            ],
            "usage": {
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
            },
        },
    )
