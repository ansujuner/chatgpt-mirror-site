from __future__ import annotations

"""Credential-safe bridge for authenticated ChatGPT conversation history.

The upstream conversation and message identifiers are deliberately server-only.
Callers receive random local handles from :class:`AuthenticatedHistoryRegistry`.
"""

import datetime as datetime_module
import logging
import math
import os
import re
import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping, Protocol
from urllib.parse import quote

from curl_cffi import requests

from .auth_session import (
    AUTH_VERIFY_TLS,
    CHATGPT_ORIGIN,
    USER_AGENT,
    AuthSessionError,
)


LOGGER = logging.getLogger("chatgpt_account_bridge.history")


# History reads are idempotent. In practice the upstream list/message routes
# occasionally answer with a short-lived gateway response even while the
# account session itself is healthy. Retry only safe transient statuses;
# authentication, authorization, and rate-limit responses are deliberately
# left to the credential-refresh/caller logic.
_TRANSIENT_HISTORY_STATUSES = frozenset({408, 425, 500, 502, 503, 504})


def _history_retry_delay(attempt: int, response: Any | None = None) -> float:
    """Return a small bounded delay, honoring a numeric Retry-After hint."""

    fallback = min(0.2 * (2**attempt), 0.8)
    headers = getattr(response, "headers", None)
    if not isinstance(headers, Mapping):
        return fallback
    raw = headers.get("retry-after") or headers.get("Retry-After")
    try:
        requested = float(raw)
    except (TypeError, ValueError):
        return fallback
    if not math.isfinite(requested) or requested < 0:
        return fallback
    # A large upstream Retry-After must not pin the single free-tier worker.
    return min(requested, 2.0)


def _bounded_env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return min(maximum, max(minimum, value))


@dataclass(frozen=True)
class AuthenticatedHistoryConfig:
    origin: str = CHATGPT_ORIGIN
    timeout_seconds: int = 25
    network_attempts: int = 2
    verify_tls: bool = AUTH_VERIFY_TLS
    page_turns: int = 100
    max_message_pages: int = 64
    max_messages: int = 10_000
    max_response_bytes: int = 16 * 1024 * 1024

    @classmethod
    def from_environment(cls) -> "AuthenticatedHistoryConfig":
        return cls(
            timeout_seconds=_bounded_env_int(
                "CHATGPT_AUTH_HISTORY_TIMEOUT", 25, 5, 120
            ),
            network_attempts=_bounded_env_int(
                "CHATGPT_AUTH_HISTORY_NETWORK_ATTEMPTS", 2, 1, 5
            ),
            page_turns=_bounded_env_int(
                "CHATGPT_AUTH_HISTORY_PAGE_TURNS", 100, 10, 100
            ),
            max_message_pages=_bounded_env_int(
                "CHATGPT_AUTH_HISTORY_MAX_PAGES", 64, 1, 256
            ),
            max_messages=_bounded_env_int(
                "CHATGPT_AUTH_HISTORY_MAX_MESSAGES", 10_000, 100, 50_000
            ),
            max_response_bytes=_bounded_env_int(
                "CHATGPT_AUTH_HISTORY_MAX_RESPONSE_BYTES",
                16 * 1024 * 1024,
                256 * 1024,
                64 * 1024 * 1024,
            ),
        )


class CredentialLike(Protocol):
    access_token: str
    cookie_header: str | None
    account_id: str


@dataclass(frozen=True)
class HistorySummary:
    upstream_id: str = field(repr=False)
    title: str
    created_at: str | None
    updated_at: str | None
    project_id: str | None = field(default=None, repr=False)


@dataclass(frozen=True)
class HistoryMessage:
    upstream_id: str = field(repr=False)
    role: str
    content: str
    created_at: str | None


@dataclass(frozen=True)
class HistoryDetail:
    upstream_id: str = field(repr=False)
    title: str
    created_at: str | None
    updated_at: str | None
    current_node: str = field(repr=False)
    model: str
    messages: tuple[HistoryMessage, ...]


@dataclass(frozen=True)
class HistoryPage:
    items: tuple[HistorySummary, ...]
    offset: int
    limit: int
    total: int


def _safe_text(value: Any, *, maximum: int, single_line: bool = False) -> str:
    if not isinstance(value, str):
        return ""
    # C0/DEL characters can interfere with logs, headers, and rendering.  Keep
    # ordinary Unicode exactly as authored, including markdown in messages.
    cleaned = "".join(
        character
        for character in value
        if ord(character) >= 0x20 or character in {"\n", "\t"}
    ).replace("\x7f", "")
    if single_line:
        cleaned = re.sub(r"[\r\n\t]+", " ", cleaned)
        cleaned = re.sub(r" {2,}", " ", cleaned)
    cleaned = cleaned.strip()
    return cleaned[:maximum]


def _safe_upstream_id(value: Any, *, label: str) -> str:
    if not isinstance(value, str):
        return ""
    candidate = value.strip()
    if not candidate or len(candidate) > 512:
        return ""
    if any(ord(character) < 0x20 or ord(character) == 0x7F for character in candidate):
        return ""
    # Current ids are UUIDs, but accepting this conservative superset avoids a
    # needless dependency on a particular upstream identifier generation scheme.
    if not re.fullmatch(r"[A-Za-z0-9._:-]+", candidate):
        return ""
    return candidate


def _safe_cursor(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    candidate = value.strip()
    if not candidate or len(candidate) > 2048:
        return ""
    if any(ord(character) < 0x20 or ord(character) == 0x7F for character in candidate):
        return ""
    # Cursor values are opaque and may be URL-safe/base64 tokens.  They are
    # passed via the HTTP client's params encoder, never interpolated in a path.
    if not re.fullmatch(r"[A-Za-z0-9._~:+/=\-]+", candidate):
        return ""
    return candidate


def _safe_time(value: Any) -> str | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        timestamp = float(value)
        if timestamp > 10_000_000_000:
            timestamp /= 1000
        try:
            result = datetime_module.datetime.fromtimestamp(
                timestamp, tz=datetime_module.timezone.utc
            )
        except (OverflowError, OSError, ValueError):
            return None
        return result.isoformat().replace("+00:00", "Z")
    if isinstance(value, str):
        candidate = value.strip()
        if not candidate or len(candidate) > 64:
            return None
        # Only return an ISO-like timestamp, never arbitrary upstream text.
        if not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}[Tt ][0-9:.+-]+(?:[Zz])?", candidate
        ):
            return None
        return candidate
    return None


def _integer(value: Any, fallback: int) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return fallback
    if not math.isfinite(float(value)):
        return fallback
    return max(0, int(value))


def _message_role(message: Mapping[str, Any]) -> str:
    author = message.get("author")
    raw = author.get("role") if isinstance(author, Mapping) else message.get("role")
    return raw if raw in {"user", "assistant"} else ""


_VISIBLE_CONTENT_TYPES = {
    "text",
    "multimodal_text",
    "code",
    "computer_output",
}


def _message_content(message: Mapping[str, Any]) -> str:
    content = message.get("content")
    if isinstance(content, str):
        return _safe_text(content, maximum=2_000_000)
    if not isinstance(content, Mapping):
        return ""
    content_type = content.get("content_type") or content.get("type")
    if isinstance(content_type, str) and content_type not in _VISIBLE_CONTENT_TYPES:
        # In particular, do not expose hidden chain-of-thought/thoughts or
        # model-editable-context records as visible assistant history.
        return ""
    parts = content.get("parts")
    if not isinstance(parts, list):
        candidate = content.get("text")
        return _safe_text(candidate, maximum=2_000_000)
    chunks: list[str] = []
    for part in parts:
        if isinstance(part, str):
            chunks.append(part)
        elif isinstance(part, Mapping):
            # Current multimodal parts may wrap ordinary text in a typed object.
            part_type = part.get("content_type") or part.get("type")
            if part_type in {"text", "input_text", "output_text"}:
                candidate = part.get("text") or part.get("content")
                if isinstance(candidate, str):
                    chunks.append(candidate)
    return _safe_text("\n".join(chunks), maximum=2_000_000)


def _visible_message(message: Mapping[str, Any]) -> HistoryMessage | None:
    metadata = message.get("metadata")
    if isinstance(metadata, Mapping) and (
        metadata.get("is_visually_hidden_from_conversation") is True
        or metadata.get("is_user_system_message") is True
    ):
        return None
    role = _message_role(message)
    identifier = _safe_upstream_id(
        message.get("id") or message.get("message_id"), label="message"
    )
    content = _message_content(message)
    if not role or not identifier or not content:
        return None
    return HistoryMessage(
        upstream_id=identifier,
        role=role,
        content=content,
        created_at=_safe_time(message.get("create_time") or message.get("created_at")),
    )


def _mapping_branch(
    mapping: Mapping[str, Any], current_node: str
) -> tuple[list[Mapping[str, Any]], str]:
    branch: list[Mapping[str, Any]] = []
    seen: set[str] = set()
    cursor = current_node
    while cursor and cursor not in seen and len(branch) < 50_000:
        seen.add(cursor)
        node = mapping.get(cursor)
        if not isinstance(node, Mapping):
            break
        message = node.get("message")
        if isinstance(message, Mapping):
            branch.append(message)
        cursor = _safe_upstream_id(node.get("parent"), label="message")
    branch.reverse()
    return branch, current_node


def _message_branch(
    messages: list[Mapping[str, Any]], current_node: str
) -> tuple[list[Mapping[str, Any]], str]:
    """Normalize the official paginated ``messages[]`` representation.

    Unlike the legacy ``mapping`` response, the paginated endpoint is not a
    tree.  The official client treats the array order as authoritative and
    rebuilds a synthetic linear mapping from adjacent items.  Individual
    messages can still carry ``metadata.parent_id`` values, but those values
    are incomplete in real conversations (notably around reasoning/tool
    messages) and must not be used to select a branch.  Following such a
    partial chain can stop before the user prompt and leave only assistant
    messages in the rendered history.

    Pages have already been combined oldest-to-newest by
    :meth:`_fetch_paginated_detail`.  De-duplicate possible boundary overlap
    while retaining that order, preferring the newest copy of a duplicate.
    """
    by_id: dict[str, Mapping[str, Any]] = {}
    order: list[str] = []
    for message in messages:
        identifier = _safe_upstream_id(
            message.get("id") or message.get("message_id"), label="message"
        )
        if identifier:
            if identifier not in by_id:
                order.append(identifier)
            by_id[identifier] = message

    # The official client falls back to the newest returned message when the
    # server current node is absent from the current page.  Mirror that here
    # so both display order and the continuation pointer remain coherent.
    if order and current_node not in by_id:
        current_node = order[-1]
    ordered = [by_id[identifier] for identifier in order]
    return ordered, current_node


class AuthenticatedHistoryBridge:
    """Read the authenticated account's official history APIs."""

    def __init__(
        self,
        config: AuthenticatedHistoryConfig | None = None,
        *,
        http_factory: Callable[[], Any] | None = None,
    ) -> None:
        self.config = config or AuthenticatedHistoryConfig.from_environment()
        self._http_factory = http_factory or self._new_http_session

    @staticmethod
    def _new_http_session() -> Any:
        return requests.Session(
            impersonate="chrome136",
            headers={
                "Accept": "application/json",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                "User-Agent": USER_AGENT,
            },
        )

    def _headers(self, credential: CredentialLike, *, referer: str) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {credential.access_token}",
            "Accept": "application/json",
            "Origin": self.config.origin,
            "Referer": referer,
        }
        if credential.account_id:
            headers["ChatGPT-Account-ID"] = credential.account_id
        if credential.cookie_header:
            headers["Cookie"] = credential.cookie_header
        return headers

    def _request_json(
        self,
        http: Any,
        credential: CredentialLike,
        path: str,
        *,
        stage: str,
        params: Mapping[str, Any] | None = None,
        referer: str | None = None,
        additional_headers: Mapping[str, str] | None = None,
    ) -> dict[str, Any]:
        headers = self._headers(
            credential, referer=referer or f"{self.config.origin}/"
        )
        if additional_headers:
            headers.update(additional_headers)
        response: Any | None = None
        last_network_error: Exception | None = None
        for attempt in range(self.config.network_attempts):
            try:
                response = http.get(
                    f"{self.config.origin}{path}",
                    params=dict(params or {}),
                    headers=headers,
                    timeout=self.config.timeout_seconds,
                    verify=self.config.verify_tls,
                    allow_redirects=False,
                )
                last_network_error = None
            except Exception as error:
                last_network_error = error
                if attempt + 1 < self.config.network_attempts:
                    # HTTP exception strings can embed request headers; log only type.
                    LOGGER.info(
                        "Transient history network failure at %s (%s) "
                        "(attempt %s/%s)",
                        stage,
                        type(error).__name__,
                        attempt + 1,
                        self.config.network_attempts,
                    )
                    time.sleep(_history_retry_delay(attempt))
                continue

            status = int(getattr(response, "status_code", 0) or 0)
            if (
                status in _TRANSIENT_HISTORY_STATUSES
                and attempt + 1 < self.config.network_attempts
            ):
                LOGGER.info(
                    "Transient history HTTP status at %s (%s) "
                    "(attempt %s/%s)",
                    stage,
                    status,
                    attempt + 1,
                    self.config.network_attempts,
                )
                time.sleep(_history_retry_delay(attempt, response))
                continue
            break
        if last_network_error is not None or response is None:
            error_name = (
                type(last_network_error).__name__
                if last_network_error is not None
                else "NoResponse"
            )
            LOGGER.info(
                "History network failure at %s after %s attempt(s) (%s)",
                stage,
                self.config.network_attempts,
                error_name,
            )
            raise AuthSessionError(
                f"history_{stage}_network_error",
                "The upstream conversation history request failed.",
                status_code=503,
            ) from last_network_error

        status = int(getattr(response, "status_code", 0) or 0)
        if status < 200 or status >= 300:
            if status == 401:
                code, message, local_status = (
                    "history_unauthorized",
                    "The authenticated account session must be refreshed.",
                    401,
                )
            elif status == 403:
                code, message, local_status = (
                    "history_forbidden",
                    "The authenticated account cannot access this conversation.",
                    403,
                )
            elif status == 404:
                code, message, local_status = (
                    "history_not_found",
                    "The requested conversation was not found.",
                    404,
                )
            elif status == 429:
                code, message, local_status = (
                    "history_rate_limited",
                    "The upstream conversation history is currently rate limited.",
                    429,
                )
            else:
                code, message, local_status = (
                    "history_upstream_rejected",
                    "The upstream conversation history request was rejected.",
                    502,
                )
            raise AuthSessionError(code, message, status_code=local_status)

        body = getattr(response, "content", None)
        if isinstance(body, (bytes, bytearray)) and len(body) > self.config.max_response_bytes:
            raise AuthSessionError(
                "history_response_too_large",
                "The upstream conversation history response is too large.",
                status_code=502,
            )
        try:
            payload = response.json()
        except Exception as error:
            raise AuthSessionError(
                "history_invalid_response",
                "The upstream conversation history returned invalid JSON.",
                status_code=502,
            ) from error
        if not isinstance(payload, dict):
            raise AuthSessionError(
                "history_invalid_response",
                "The upstream conversation history returned an invalid object.",
                status_code=502,
            )
        return payload

    def list_conversations(
        self, credential: CredentialLike, *, offset: int = 0, limit: int = 28
    ) -> HistoryPage:
        safe_offset = min(max(0, int(offset)), 1_000_000)
        safe_limit = min(max(1, int(limit)), 50)
        http = self._http_factory()
        try:
            payload = self._request_json(
                http,
                credential,
                "/backend-api/conversations",
                stage="list",
                params={
                    "offset": safe_offset,
                    "limit": safe_limit,
                    "order": "updated",
                    "is_archived": "false",
                    "is_starred": "false",
                },
            )
        finally:
            try:
                http.close()
            except Exception:
                pass

        raw_items = payload.get("items")
        if not isinstance(raw_items, list):
            raise AuthSessionError(
                "history_invalid_response",
                "The upstream conversation list did not contain items.",
                status_code=502,
            )
        items: list[HistorySummary] = []
        for raw in raw_items[:safe_limit]:
            if not isinstance(raw, Mapping):
                continue
            upstream_id = _safe_upstream_id(raw.get("id"), label="conversation")
            if not upstream_id:
                continue
            title = _safe_text(raw.get("title"), maximum=512, single_line=True)
            candidate_project_id = _safe_upstream_id(
                raw.get("gizmo_id"), label="project"
            )
            items.append(
                HistorySummary(
                    upstream_id=upstream_id,
                    title=title or "未命名对话",
                    created_at=_safe_time(raw.get("create_time")),
                    updated_at=_safe_time(raw.get("update_time")),
                    project_id=(
                        candidate_project_id
                        if candidate_project_id.startswith("g-p-")
                        else None
                    ),
                )
            )
        actual_offset = min(
            1_000_000, _integer(payload.get("offset"), safe_offset)
        )
        actual_limit = min(
            safe_limit, _integer(payload.get("limit"), safe_limit) or safe_limit
        )
        total = min(
            100_000_000,
            _integer(payload.get("total"), actual_offset + len(items)),
        )
        return HistoryPage(
            items=tuple(items),
            offset=actual_offset,
            limit=actual_limit,
            total=max(total, actual_offset + len(items)),
        )

    @staticmethod
    def _page_cursor(payload: Mapping[str, Any]) -> str:
        page_info = payload.get("page_info")
        if not isinstance(page_info, Mapping) or page_info.get("has_previous_page") is not True:
            return ""
        return _safe_cursor(page_info.get("start_cursor"))

    def _fetch_paginated_detail(
        self,
        http: Any,
        credential: CredentialLike,
        upstream_id: str,
        *,
        project_id: str | None,
    ) -> dict[str, Any]:
        encoded = quote(upstream_id, safe="")
        referer = f"{self.config.origin}/c/{encoded}"
        project_headers = (
            {"chatgpt-project-id": project_id} if project_id is not None else None
        )
        payload = self._request_json(
            http,
            credential,
            f"/backend-api/conversations/{encoded}",
            stage="detail",
            params={
                "include_has_versions": "true",
                "num_turns": self.config.page_turns,
            },
            referer=referer,
            additional_headers=project_headers,
        )
        raw_messages = payload.get("messages")
        if not isinstance(raw_messages, list):
            raise AuthSessionError(
                "history_invalid_response",
                "The upstream conversation detail did not contain messages.",
                status_code=502,
            )
        all_messages: list[Any] = list(raw_messages)
        cursor = self._page_cursor(payload)
        if len(all_messages) > self.config.max_messages:
            all_messages = all_messages[-self.config.max_messages :]
            cursor = ""
        seen_cursors: set[str] = set()
        pages = 1
        while cursor:
            if cursor in seen_cursors:
                # The newest page is already usable.  A repeated opaque cursor
                # must stop pagination, but should not make the entire detail
                # endpoint fail and hide all recent messages.
                LOGGER.info(
                    "Stopping history pagination because the cursor did not advance"
                )
                break
            seen_cursors.add(cursor)
            if pages >= self.config.max_message_pages or len(all_messages) >= self.config.max_messages:
                LOGGER.info(
                    "Stopping history pagination at the configured page/message limit"
                )
                break
            try:
                page = self._request_json(
                    http,
                    credential,
                    f"/backend-api/conversations/{encoded}/messages",
                    stage="messages",
                    params={
                        "before": cursor,
                        "include_has_versions": "true",
                        "num_turns": self.config.page_turns,
                    },
                    referer=referer,
                    additional_headers=project_headers,
                )
            except AuthSessionError as error:
                if error.status_code not in {429, 502, 503}:
                    raise
                # Older pages are an enhancement.  Preserve the successfully
                # fetched recent branch after exhausted transient retries.
                LOGGER.info(
                    "Stopping history pagination after a transient older-page failure (%s)",
                    error.code,
                )
                break
            page_messages = page.get("messages")
            if not isinstance(page_messages, list):
                LOGGER.info(
                    "Stopping history pagination after an invalid older message page"
                )
                break
            # The official endpoint returns each page root-to-leaf while
            # `before` walks toward older turns.  Prepend older pages so the
            # no-parent fallback retains a root-to-leaf sequence even when
            # timestamps are missing.
            all_messages = [*page_messages, *all_messages]
            pages += 1
            if len(all_messages) > self.config.max_messages:
                # Keep the newest messages and a valid current-node branch.
                all_messages = all_messages[-self.config.max_messages :]
                break
            cursor = self._page_cursor(page)
        return {**payload, "messages": all_messages}

    def _fetch_legacy_detail(
        self,
        http: Any,
        credential: CredentialLike,
        upstream_id: str,
        *,
        project_id: str | None,
    ) -> dict[str, Any]:
        encoded = quote(upstream_id, safe="")
        return self._request_json(
            http,
            credential,
            f"/backend-api/conversation/{encoded}",
            stage="detail",
            params={"include_full_conversation": "true"},
            referer=f"{self.config.origin}/c/{encoded}",
            additional_headers=(
                {"chatgpt-project-id": project_id}
                if project_id is not None
                else None
            ),
        )

    def get_conversation(
        self,
        credential: CredentialLike,
        upstream_id: str,
        *,
        fallback_title: str = "",
        fallback_created_at: str | None = None,
        fallback_updated_at: str | None = None,
        project_id: str | None = None,
    ) -> HistoryDetail:
        identifier = _safe_upstream_id(upstream_id, label="conversation")
        if not identifier:
            raise AuthSessionError(
                "history_binding_invalid",
                "The local conversation binding is invalid.",
                status_code=404,
            )
        http = self._http_factory()
        try:
            try:
                payload = self._fetch_paginated_detail(
                    http, credential, identifier, project_id=project_id
                )
            except AuthSessionError as error:
                # Both forms are present in current official assets.  Some
                # accounts still use the full-conversation endpoint when the
                # paginated rollout is unavailable.
                if error.code not in {"history_not_found", "history_invalid_response"}:
                    raise
                payload = self._fetch_legacy_detail(
                    http, credential, identifier, project_id=project_id
                )
        finally:
            try:
                http.close()
            except Exception:
                pass

        current_node = _safe_upstream_id(
            payload.get("current_node") or payload.get("currentNode"), label="message"
        )
        mapping = payload.get("mapping")
        if isinstance(mapping, Mapping):
            branch, current_node = _mapping_branch(mapping, current_node)
        else:
            raw_messages = payload.get("messages")
            messages = [
                message for message in raw_messages if isinstance(message, Mapping)
            ] if isinstance(raw_messages, list) else []
            branch, current_node = _message_branch(messages, current_node)
        if not current_node:
            raise AuthSessionError(
                "history_current_node_missing",
                "The upstream conversation did not contain a continuation node.",
                status_code=502,
            )

        visible: list[HistoryMessage] = []
        for raw in branch:
            normalized = _visible_message(raw)
            if normalized is not None:
                visible.append(normalized)

        title = _safe_text(payload.get("title"), maximum=512, single_line=True)
        model = _safe_text(
            payload.get("default_model_slug") or payload.get("model"),
            maximum=160,
            single_line=True,
        )
        return HistoryDetail(
            upstream_id=identifier,
            title=title or _safe_text(fallback_title, maximum=512, single_line=True) or "未命名对话",
            created_at=_safe_time(payload.get("create_time")) or fallback_created_at,
            updated_at=_safe_time(payload.get("update_time")) or fallback_updated_at,
            current_node=current_node,
            model=model or "auto",
            messages=tuple(visible),
        )


@dataclass
class HistoryBinding:
    owner: str
    local_id: str
    upstream_id: str = field(repr=False)
    title: str
    created_at: str | None
    updated_at: str | None
    last_access_monotonic: float
    project_id: str | None = field(default=None, repr=False)


@dataclass
class HistoryCursor:
    owner: str
    token: str
    offset: int
    last_access_monotonic: float


class AuthenticatedHistoryRegistry:
    """Account-scoped opaque bindings for upstream conversations and offsets."""

    def __init__(
        self,
        *,
        ttl_seconds: int = 10_800,
        max_entries: int = 4096,
        max_cursors: int = 1024,
    ) -> None:
        self.ttl_seconds = max(60, ttl_seconds)
        self.max_entries = max(1, max_entries)
        self.max_cursors = max(1, max_cursors)
        self._entries: dict[tuple[str, str], HistoryBinding] = {}
        self._reverse: dict[tuple[str, str], str] = {}
        self._cursors: dict[tuple[str, str], HistoryCursor] = {}
        self._lock = threading.RLock()

    def _prune_locked(self) -> None:
        now = time.monotonic()
        expired = [
            key
            for key, binding in self._entries.items()
            if now - binding.last_access_monotonic > self.ttl_seconds
        ]
        for key in expired:
            binding = self._entries.pop(key)
            self._reverse.pop((binding.owner, binding.upstream_id), None)
        if len(self._entries) > self.max_entries:
            oldest = sorted(
                self._entries.items(), key=lambda item: item[1].last_access_monotonic
            )
            for key, binding in oldest[: len(self._entries) - self.max_entries]:
                self._entries.pop(key, None)
                self._reverse.pop((binding.owner, binding.upstream_id), None)

        expired_cursors = [
            key
            for key, cursor in self._cursors.items()
            if now - cursor.last_access_monotonic > self.ttl_seconds
        ]
        for key in expired_cursors:
            self._cursors.pop(key, None)
        if len(self._cursors) > self.max_cursors:
            oldest_cursors = sorted(
                self._cursors.items(), key=lambda item: item[1].last_access_monotonic
            )
            for key, _ in oldest_cursors[: len(self._cursors) - self.max_cursors]:
                self._cursors.pop(key, None)

    def bind(self, owner: str, summary: HistorySummary) -> HistoryBinding:
        with self._lock:
            self._prune_locked()
            reverse_key = (owner, summary.upstream_id)
            local_id = self._reverse.get(reverse_key)
            if not local_id:
                local_id = "hist-" + secrets.token_urlsafe(24)
            binding = HistoryBinding(
                owner=owner,
                local_id=local_id,
                upstream_id=summary.upstream_id,
                title=summary.title,
                created_at=summary.created_at,
                updated_at=summary.updated_at,
                last_access_monotonic=time.monotonic(),
                project_id=summary.project_id,
            )
            self._entries[(owner, local_id)] = binding
            self._reverse[reverse_key] = local_id
            self._prune_locked()
            return binding

    def resolve(self, owner: str, local_id: str) -> HistoryBinding | None:
        with self._lock:
            self._prune_locked()
            binding = self._entries.get((owner, local_id))
            if binding is not None:
                binding.last_access_monotonic = time.monotonic()
            return binding

    def create_cursor(self, owner: str, offset: int) -> str:
        token = "hcur-" + secrets.token_urlsafe(24)
        with self._lock:
            self._cursors[(owner, token)] = HistoryCursor(
                owner=owner,
                token=token,
                offset=max(0, int(offset)),
                last_access_monotonic=time.monotonic(),
            )
            self._prune_locked()
        return token

    def resolve_cursor(self, owner: str, token: str) -> int | None:
        with self._lock:
            self._prune_locked()
            cursor = self._cursors.get((owner, token))
            if cursor is None:
                return None
            cursor.last_access_monotonic = time.monotonic()
            return cursor.offset

    def remove_owner(self, owner: str) -> None:
        with self._lock:
            keys = [key for key in self._entries if key[0] == owner]
            for key in keys:
                binding = self._entries.pop(key)
                self._reverse.pop((binding.owner, binding.upstream_id), None)
            for key in [key for key in self._cursors if key[0] == owner]:
                self._cursors.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()
            self._reverse.clear()
            self._cursors.clear()

    def count(self) -> int:
        with self._lock:
            self._prune_locked()
            return len(self._entries)


__all__ = [
    "AuthenticatedHistoryBridge",
    "AuthenticatedHistoryConfig",
    "AuthenticatedHistoryRegistry",
    "HistoryBinding",
    "HistoryDetail",
    "HistoryMessage",
    "HistoryPage",
    "HistorySummary",
]
