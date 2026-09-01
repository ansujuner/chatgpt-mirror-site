"""Authenticated image-generation polling and account-bound asset delivery.

The official Images surface submits an ordinary authenticated conversation turn
with the ``picture_v2`` system hint.  The turn can complete asynchronously and
returns private ``image_asset_pointer`` values.  This module keeps those values
server-only, polls the current conversation when necessary, and resolves an
image through the official file download-link endpoint.
"""

from __future__ import annotations

import copy
import os
import re
import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping
from urllib.parse import parse_qsl, quote, urljoin, urlsplit

from curl_cffi import requests

from .auth_session import (
    AUTH_VERIFY_TLS,
    CHATGPT_ORIGIN,
    USER_AGENT,
    AuthSessionError,
)
from .authenticated_protocol import (
    AuthenticatedImageAsset,
    authenticated_image_generation_failed,
    extract_authenticated_image_assets,
)


_TRANSIENT_STATUSES = frozenset({408, 425, 429, 500, 502, 503, 504})
_SAFE_FILE_ID = re.compile(r"^[^\x00-\x20\x7f]{1,512}$")
_IMAGE_POINTER_PREFIXES = ("sediment://", "file-service://")
_DISPLAY_IMAGE_MIME_TYPES = frozenset(
    {"image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"}
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


@dataclass(frozen=True)
class AuthenticatedImagesConfig:
    origin: str = CHATGPT_ORIGIN
    request_timeout_seconds: int = 25
    poll_timeout_seconds: int = 150
    poll_interval_milliseconds: int = 5_000
    download_timeout_seconds: int = 45
    max_json_bytes: int = 16 * 1024 * 1024
    max_image_bytes: int = 32 * 1024 * 1024
    verify_tls: bool = AUTH_VERIFY_TLS

    @classmethod
    def from_environment(cls) -> "AuthenticatedImagesConfig":
        return cls(
            request_timeout_seconds=_bounded_env_int(
                "CHATGPT_IMAGE_REQUEST_TIMEOUT", 25, 5, 120
            ),
            poll_timeout_seconds=_bounded_env_int(
                "CHATGPT_IMAGE_POLL_TIMEOUT", 150, 10, 600
            ),
            poll_interval_milliseconds=_bounded_env_int(
                "CHATGPT_IMAGE_POLL_INTERVAL_MS", 5_000, 250, 10_000
            ),
            download_timeout_seconds=_bounded_env_int(
                "CHATGPT_IMAGE_DOWNLOAD_TIMEOUT", 45, 5, 180
            ),
            max_json_bytes=_bounded_env_int(
                "CHATGPT_IMAGE_MAX_JSON_BYTES",
                16 * 1024 * 1024,
                256 * 1024,
                64 * 1024 * 1024,
            ),
            max_image_bytes=_bounded_env_int(
                "CHATGPT_IMAGE_MAX_BYTES",
                32 * 1024 * 1024,
                1 * 1024 * 1024,
                100 * 1024 * 1024,
            ),
        )


class ImageGenerationCancelled(RuntimeError):
    pass


@dataclass(frozen=True)
class DownloadedImage:
    body: bytes = field(repr=False)
    mime_type: str


class AuthenticatedImagesBridge:
    def __init__(self, config: AuthenticatedImagesConfig | None = None) -> None:
        self.config = config or AuthenticatedImagesConfig.from_environment()

    @staticmethod
    def _new_http() -> Any:
        return requests.Session(
            impersonate="chrome136",
            headers={
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                "User-Agent": USER_AGENT,
            },
        )

    def _headers(self, credential: Any, *, referer: str) -> dict[str, str]:
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

    @staticmethod
    def _status_error(status: int, *, stage: str) -> AuthSessionError:
        if status == 401:
            return AuthSessionError(
                "invalid_session",
                "当前 Session 已失效，请重新登录后再试。",
                status_code=401,
            )
        if status == 403:
            return AuthSessionError(
                "image_generation_forbidden",
                "当前账号暂时无法使用图片生成。",
                status_code=403,
            )
        if status == 429:
            return AuthSessionError(
                "image_generation_rate_limited",
                "图片生成请求过于频繁，请稍后重试。",
                status_code=429,
            )
        if status == 404:
            return AuthSessionError(
                f"image_{stage}_not_found",
                "图片服务未找到对应资源。",
                status_code=404,
            )
        return AuthSessionError(
            f"image_{stage}_upstream_error",
            "图片服务暂时不可用，请稍后重试。",
            status_code=502,
        )

    def _request_json(
        self,
        http: Any,
        credential: Any,
        path: str,
        *,
        params: Mapping[str, Any] | None = None,
        referer: str,
        stage: str,
    ) -> dict[str, Any]:
        response: Any | None = None
        for attempt in range(2):
            try:
                response = http.get(
                    f"{self.config.origin}{path}",
                    params=dict(params or {}),
                    headers=self._headers(credential, referer=referer),
                    timeout=self.config.request_timeout_seconds,
                    allow_redirects=False,
                    verify=self.config.verify_tls,
                )
            except Exception as error:
                if attempt == 0:
                    time.sleep(0.2)
                    continue
                raise AuthSessionError(
                    f"image_{stage}_unavailable",
                    "图片服务暂时不可用，请稍后重试。",
                    status_code=503,
                ) from error
            status = int(getattr(response, "status_code", 0) or 0)
            if 200 <= status < 300:
                break
            if status in _TRANSIENT_STATUSES and status != 429 and attempt == 0:
                time.sleep(0.2)
                continue
            raise self._status_error(status, stage=stage)
        if response is None:
            raise self._status_error(502, stage=stage)
        content = bytes(getattr(response, "content", b""))
        if len(content) > self.config.max_json_bytes:
            raise AuthSessionError(
                "image_response_too_large",
                "图片服务返回的数据超过本地限制。",
                status_code=502,
            )
        try:
            payload = response.json()
        except Exception as error:
            raise AuthSessionError(
                "image_invalid_response",
                "图片服务返回了无效数据。",
                status_code=502,
            ) from error
        if not isinstance(payload, dict):
            raise AuthSessionError(
                "image_invalid_response",
                "图片服务返回了无效数据。",
                status_code=502,
            )
        return payload

    @staticmethod
    def _message_values(payload: Mapping[str, Any]) -> list[Mapping[str, Any]]:
        messages = payload.get("messages")
        if isinstance(messages, list):
            return [value for value in messages if isinstance(value, Mapping)]
        mapping = payload.get("mapping")
        if not isinstance(mapping, Mapping):
            return []
        result: list[Mapping[str, Any]] = []
        for node in mapping.values():
            if not isinstance(node, Mapping):
                continue
            message = node.get("message")
            if isinstance(message, Mapping):
                result.append(message)
        return result

    @classmethod
    def extract_assets(cls, payload: Mapping[str, Any]) -> tuple[AuthenticatedImageAsset, ...]:
        assets: list[AuthenticatedImageAsset] = []
        seen: set[str] = set()
        for message in cls._message_values(payload):
            author = message.get("author")
            role = author.get("role") if isinstance(author, Mapping) else message.get("role")
            # Never mistake the user's uploaded reference image for generated output.
            if role == "user":
                continue
            for asset in extract_authenticated_image_assets(message.get("content")):
                if asset.asset_pointer in seen:
                    continue
                seen.add(asset.asset_pointer)
                assets.append(asset)
        return tuple(assets[-32:])

    @classmethod
    def generation_failed(cls, payload: Mapping[str, Any]) -> bool:
        return any(
            authenticated_image_generation_failed(message)
            for message in cls._message_values(payload)
        )

    def _conversation_payload(
        self, http: Any, credential: Any, conversation_id: str
    ) -> dict[str, Any]:
        encoded = quote(conversation_id, safe="")
        referer = f"{self.config.origin}/c/{encoded}"
        try:
            return self._request_json(
                http,
                credential,
                f"/backend-api/conversations/{encoded}",
                params={"include_has_versions": "true", "num_turns": 20},
                referer=referer,
                stage="conversation_poll",
            )
        except AuthSessionError as error:
            # The legacy full-conversation form remains enabled for a subset of
            # accounts. Only fall back for an invalid/not-found-shaped response.
            if error.status_code != 404:
                raise
        return self._request_json(
            http,
            credential,
            f"/backend-api/conversation/{encoded}",
            params={"include_full_conversation": "true"},
            referer=referer,
            stage="conversation_poll",
        )

    def wait_for_images(
        self,
        credential: Any,
        conversation_id: str,
        *,
        initial: tuple[AuthenticatedImageAsset, ...] = (),
        cancelled: Callable[[], bool] | None = None,
    ) -> tuple[AuthenticatedImageAsset, ...]:
        if initial:
            return initial
        deadline = time.monotonic() + self.config.poll_timeout_seconds
        http = self._new_http()
        try:
            while time.monotonic() < deadline:
                if cancelled is not None and cancelled():
                    raise ImageGenerationCancelled()
                try:
                    payload = self._conversation_payload(http, credential, conversation_id)
                    assets = self.extract_assets(payload)
                    if assets:
                        return assets
                    if self.generation_failed(payload):
                        raise AuthSessionError(
                            "image_generation_failed",
                            "图片生成失败，请调整描述后重试。",
                            status_code=422,
                        )
                except AuthSessionError as error:
                    # A just-created conversation can briefly be absent from
                    # both history variants while storage catches up.
                    if error.status_code not in {404, 429, 502, 503}:
                        raise
                wait_seconds = self.config.poll_interval_milliseconds / 1000
                time.sleep(min(wait_seconds, max(0.0, deadline - time.monotonic())))
        finally:
            try:
                http.close()
            except Exception:
                pass
        raise AuthSessionError(
            "image_generation_timeout",
            "图片生成等待超时，请稍后重试。",
            status_code=504,
        )

    @staticmethod
    def _file_reference(asset_pointer: str) -> tuple[str, dict[str, str]]:
        identifier = asset_pointer.strip()
        matched_prefix = False
        for prefix in _IMAGE_POINTER_PREFIXES:
            if identifier.startswith(prefix):
                identifier = identifier[len(prefix) :]
                matched_prefix = True
                break
        file_id, separator, raw_query = identifier.partition("?")
        if not matched_prefix or not _SAFE_FILE_ID.fullmatch(file_id):
            raise AuthSessionError(
                "image_asset_invalid",
                "图片资源引用无效。",
                status_code=404,
            )
        pointer_params: dict[str, str] = {}
        if separator:
            if not raw_query or len(raw_query) > 8_192:
                raise AuthSessionError(
                    "image_asset_invalid",
                    "图片资源引用无效。",
                    status_code=404,
                )
            try:
                pairs = parse_qsl(
                    raw_query,
                    keep_blank_values=True,
                    strict_parsing=False,
                    max_num_fields=32,
                )
            except (TypeError, ValueError) as error:
                raise AuthSessionError(
                    "image_asset_invalid",
                    "图片资源引用无效。",
                    status_code=404,
                ) from error
            for key, value in pairs:
                if (
                    not key
                    or len(key) > 128
                    or len(value) > 4_096
                    or any(ord(character) < 0x20 or ord(character) == 0x7F for character in key)
                    or any(ord(character) < 0x20 or ord(character) == 0x7F for character in value)
                ):
                    raise AuthSessionError(
                        "image_asset_invalid",
                        "图片资源引用无效。",
                        status_code=404,
                    )
                pointer_params[key] = value
        return file_id.replace("#", "*"), pointer_params

    @classmethod
    def _file_id(cls, asset_pointer: str) -> str:
        file_id, _ = cls._file_reference(asset_pointer)
        return file_id

    def _trusted_download_url(self, value: Any) -> str:
        if not isinstance(value, str) or not value or len(value) > 16_384:
            raise AuthSessionError(
                "image_download_url_invalid",
                "图片下载地址无效。",
                status_code=502,
            )
        if value.startswith("/"):
            # The current file service returns an account-bound estuary path.
            # Reject scheme-relative/backslash variants before URL joining so
            # the trusted origin cannot be confused with an attacker host.
            if (
                value.startswith("//")
                or "\\" in value
                or urlsplit(value).path != "/backend-api/estuary/content"
            ):
                raise AuthSessionError(
                    "image_download_url_invalid",
                    "图片下载地址无效。",
                    status_code=502,
                )
            candidate = urljoin(self.config.origin + "/", value)
        else:
            # Absolute signed CDN/blob URLs are accepted only after the strict
            # scheme, host, credential and port checks below. Bare relatives
            # are intentionally rejected.
            candidate = value
        try:
            parsed = urlsplit(candidate)
            port = parsed.port
        except ValueError as error:
            raise AuthSessionError(
                "image_download_url_invalid",
                "图片下载地址无效。",
                status_code=502,
            ) from error
        host = (parsed.hostname or "").lower()
        trusted_host = (
            host == "chatgpt.com"
            or host.endswith(".chatgpt.com")
            or host == "oaiusercontent.com"
            or host.endswith(".oaiusercontent.com")
            or host == "cdn.openai.com"
            or host.endswith(".blob.core.windows.net")
        )
        if (
            parsed.scheme != "https"
            or not trusted_host
            or parsed.username is not None
            or parsed.password is not None
            or port not in {None, 443}
        ):
            raise AuthSessionError(
                "image_download_url_invalid",
                "图片下载地址无效。",
                status_code=502,
            )
        return candidate

    def _download_link(
        self, http: Any, credential: Any, asset: AuthenticatedImageAsset, conversation_id: str
    ) -> tuple[str, str | None]:
        file_id, pointer_params = self._file_reference(asset.asset_pointer)
        encoded_file = quote(file_id, safe="")
        encoded_conversation = quote(conversation_id, safe="")
        referer = f"{self.config.origin}/c/{encoded_conversation}"
        params = dict(pointer_params)
        # The local conversation binding must win over any similarly named
        # pointer query value; a private pointer must never select another chat.
        params.update(
            {
                "conversation_id": conversation_id,
                "inline": "true",
                "download_intent": "false",
            }
        )
        retry_delays = (0.25, 0.4, 0.65, 1.0, 1.5, 2.0, 2.0, 2.0, 2.0)
        for attempt in range(10):
            payload = self._request_json(
                http,
                credential,
                f"/backend-api/files/download/{encoded_file}",
                params=params,
                referer=referer,
                stage="download_link",
            )
            status = payload.get("status")
            url = payload.get("download_url")
            if status == "success" and url:
                mime_type = str(payload.get("mime_type") or "").split(";", 1)[0].strip().lower()
                return (
                    self._trusted_download_url(url),
                    mime_type if mime_type in _DISPLAY_IMAGE_MIME_TYPES else None,
                )
            if status != "retry" or attempt == 9:
                break
            time.sleep(retry_delays[attempt])
        raise AuthSessionError(
            "image_asset_not_ready",
            "图片资源尚未准备好，请稍后重试。",
            status_code=503,
        )

    def download_image(
        self, credential: Any, asset: AuthenticatedImageAsset, conversation_id: str
    ) -> DownloadedImage:
        http = self._new_http()
        try:
            url, link_mime_type = self._download_link(
                http, credential, asset, conversation_id
            )
            for _ in range(4):
                parsed = urlsplit(url)
                origin_host = (urlsplit(self.config.origin).hostname or "").lower()
                include_auth = (parsed.hostname or "").lower() == origin_host
                headers = {"Accept": "image/*", "User-Agent": USER_AGENT}
                if include_auth:
                    headers.update(
                        self._headers(
                            credential,
                            referer=f"{self.config.origin}/c/{quote(conversation_id, safe='')}",
                        )
                    )
                    headers["Accept"] = "image/*"
                try:
                    response = http.get(
                        url,
                        headers=headers,
                        timeout=self.config.download_timeout_seconds,
                        allow_redirects=False,
                        stream=True,
                        verify=self.config.verify_tls,
                    )
                except Exception as error:
                    # curl errors can contain the full signed URL. Convert them
                    # before the exception reaches the ASGI error logger.
                    raise AuthSessionError(
                        "image_asset_unavailable",
                        "图片资源暂时无法下载，请稍后重试。",
                        status_code=503,
                    ) from error
                status = int(getattr(response, "status_code", 0) or 0)
                if status in {301, 302, 303, 307, 308}:
                    location = response.headers.get("location") or response.headers.get("Location")
                    url = self._trusted_download_url(urljoin(url, str(location or "")))
                    continue
                if status != 200:
                    raise self._status_error(status, stage="asset")
                content_length = response.headers.get("content-length") or response.headers.get("Content-Length")
                try:
                    declared = int(content_length) if content_length is not None else None
                except (TypeError, ValueError):
                    declared = None
                if declared is not None and declared > self.config.max_image_bytes:
                    raise AuthSessionError(
                        "image_asset_too_large",
                        "图片资源超过本地大小限制。",
                        status_code=502,
                    )
                chunks: list[bytes] = []
                total = 0
                iterator = getattr(response, "iter_content", None)
                if callable(iterator):
                    try:
                        for chunk in iterator(chunk_size=64 * 1024):
                            if not chunk:
                                continue
                            data = bytes(chunk)
                            total += len(data)
                            if total > self.config.max_image_bytes:
                                raise AuthSessionError(
                                    "image_asset_too_large",
                                    "图片资源超过本地大小限制。",
                                    status_code=502,
                                )
                            chunks.append(data)
                    except AuthSessionError:
                        raise
                    except Exception as error:
                        raise AuthSessionError(
                            "image_asset_unavailable",
                            "图片资源下载中断，请稍后重试。",
                            status_code=503,
                        ) from error
                    body = b"".join(chunks)
                else:
                    try:
                        body = bytes(getattr(response, "content", b""))
                    except Exception as error:
                        raise AuthSessionError(
                            "image_asset_unavailable",
                            "图片资源下载中断，请稍后重试。",
                            status_code=503,
                        ) from error
                if not body or len(body) > self.config.max_image_bytes:
                    raise AuthSessionError(
                        "image_asset_invalid",
                        "图片资源无效或超过本地大小限制。",
                        status_code=502,
                    )
                response_mime_type = str(
                    response.headers.get("content-type")
                    or response.headers.get("Content-Type")
                    or ""
                ).split(";", 1)[0].strip().lower()
                if response_mime_type and response_mime_type not in _DISPLAY_IMAGE_MIME_TYPES:
                    raise AuthSessionError(
                        "image_asset_mime_invalid",
                        "上游资源不是可显示的图片。",
                        status_code=502,
                    )
                mime_type = response_mime_type or link_mime_type or (
                    asset.mime_type or ""
                ).split(";", 1)[0].strip().lower()
                if mime_type not in _DISPLAY_IMAGE_MIME_TYPES:
                    raise AuthSessionError(
                        "image_asset_mime_invalid",
                        "上游资源不是可显示的图片。",
                        status_code=502,
                    )
                return DownloadedImage(body=body, mime_type=mime_type)
            raise AuthSessionError(
                "image_asset_redirect_invalid",
                "图片下载重定向次数过多。",
                status_code=502,
            )
        finally:
            try:
                http.close()
            except Exception:
                pass


@dataclass(frozen=True)
class PublicGeneratedImage:
    id: str
    width: int | None
    height: int | None
    mime_type: str | None
    prompt: str | None


@dataclass
class ImageAssetEntry:
    owner: str
    upstream_conversation_id: str = field(repr=False)
    asset: AuthenticatedImageAsset = field(repr=False)
    created_monotonic: float = field(default_factory=time.monotonic)
    last_access_monotonic: float = field(default_factory=time.monotonic)


@dataclass
class ImageJobEntry:
    id: str
    owner: str
    status: str = "queued"
    created_monotonic: float = field(default_factory=time.monotonic)
    updated_monotonic: float = field(default_factory=time.monotonic)
    conversation_id: str | None = None
    images: tuple[PublicGeneratedImage, ...] = ()
    message: str = ""
    error_code: str | None = None


class AuthenticatedImageRegistry:
    """In-memory job and asset handles partitioned by the HttpOnly login owner."""

    def __init__(self, *, ttl_seconds: int = 7_200, max_jobs: int = 128, max_assets: int = 512) -> None:
        self.ttl_seconds = ttl_seconds
        self.max_jobs = max_jobs
        self.max_assets = max_assets
        self._jobs: dict[tuple[str, str], ImageJobEntry] = {}
        self._assets: dict[tuple[str, str], ImageAssetEntry] = {}
        self._lock = threading.RLock()

    def _prune_locked(self) -> None:
        now = time.monotonic()
        for key, job in list(self._jobs.items()):
            if now - job.updated_monotonic > self.ttl_seconds:
                self._jobs.pop(key, None)
        for key, asset in list(self._assets.items()):
            if now - asset.last_access_monotonic > self.ttl_seconds:
                self._assets.pop(key, None)
        if len(self._jobs) > self.max_jobs:
            oldest = sorted(self._jobs.items(), key=lambda item: item[1].updated_monotonic)
            for key, _ in oldest[: len(self._jobs) - self.max_jobs]:
                self._jobs.pop(key, None)
        if len(self._assets) > self.max_assets:
            oldest_assets = sorted(
                self._assets.items(), key=lambda item: item[1].last_access_monotonic
            )
            for key, _ in oldest_assets[: len(self._assets) - self.max_assets]:
                self._assets.pop(key, None)

    def create_job(self, owner: str) -> str:
        job_id = self.try_create_job(owner)
        assert job_id is not None
        return job_id

    def try_create_job(
        self, owner: str, *, max_active_per_owner: int | None = None
    ) -> str | None:
        job_id = "imgjob-" + secrets.token_urlsafe(24)
        with self._lock:
            self._prune_locked()
            if max_active_per_owner is not None:
                active = sum(
                    1
                    for (job_owner, _), job in self._jobs.items()
                    if job_owner == owner and job.status in {"queued", "running"}
                )
                if active >= max(1, max_active_per_owner):
                    return None
            self._jobs[(owner, job_id)] = ImageJobEntry(id=job_id, owner=owner)
            self._prune_locked()
        return job_id

    def mark_running(self, owner: str, job_id: str) -> bool:
        with self._lock:
            self._prune_locked()
            job = self._jobs.get((owner, job_id))
            if job is None:
                return False
            job.status = "running"
            job.updated_monotonic = time.monotonic()
            return True

    def is_cancelled(self, owner: str, job_id: str) -> bool:
        with self._lock:
            self._prune_locked()
            return (owner, job_id) not in self._jobs

    def complete(
        self,
        owner: str,
        job_id: str,
        *,
        conversation_id: str,
        upstream_conversation_id: str,
        images: tuple[AuthenticatedImageAsset, ...],
        message: str,
    ) -> bool:
        public: list[PublicGeneratedImage] = []
        new_assets: list[tuple[str, ImageAssetEntry]] = []
        for image in images:
            asset_id = "imgasset-" + secrets.token_urlsafe(24)
            public.append(
                PublicGeneratedImage(
                    id=asset_id,
                    width=image.width,
                    height=image.height,
                    mime_type=image.mime_type,
                    prompt=image.prompt,
                )
            )
            new_assets.append(
                (
                    asset_id,
                    ImageAssetEntry(
                        owner=owner,
                        upstream_conversation_id=upstream_conversation_id,
                        asset=copy.deepcopy(image),
                    ),
                )
            )
        with self._lock:
            self._prune_locked()
            job = self._jobs.get((owner, job_id))
            if job is None:
                return False
            for asset_id, entry in new_assets:
                self._assets[(owner, asset_id)] = entry
            job.status = "succeeded"
            job.conversation_id = conversation_id
            job.images = tuple(public)
            job.message = message
            job.error_code = None
            job.updated_monotonic = time.monotonic()
            self._prune_locked()
            return True

    def fail(self, owner: str, job_id: str, *, code: str, message: str) -> None:
        with self._lock:
            self._prune_locked()
            job = self._jobs.get((owner, job_id))
            if job is None:
                return
            job.status = "failed"
            job.error_code = code[:80]
            job.message = message[:1_024]
            job.updated_monotonic = time.monotonic()

    def get_job(self, owner: str, job_id: str) -> ImageJobEntry | None:
        with self._lock:
            self._prune_locked()
            job = self._jobs.get((owner, job_id))
            if job is None:
                return None
            job.updated_monotonic = time.monotonic()
            return copy.deepcopy(job)

    def get_asset(self, owner: str, asset_id: str) -> ImageAssetEntry | None:
        with self._lock:
            self._prune_locked()
            entry = self._assets.get((owner, asset_id))
            if entry is None:
                return None
            entry.last_access_monotonic = time.monotonic()
            return copy.deepcopy(entry)

    def remove_owner(self, owner: str) -> None:
        with self._lock:
            for key in [key for key in self._jobs if key[0] == owner]:
                self._jobs.pop(key, None)
            for key in [key for key in self._assets if key[0] == owner]:
                self._assets.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._jobs.clear()
            self._assets.clear()


__all__ = [
    "AuthenticatedImageRegistry",
    "AuthenticatedImagesBridge",
    "AuthenticatedImagesConfig",
    "DownloadedImage",
    "ImageAssetEntry",
    "ImageGenerationCancelled",
    "ImageJobEntry",
    "PublicGeneratedImage",
]
