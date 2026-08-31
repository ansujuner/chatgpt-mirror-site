"""Authenticated ChatGPT web file-upload protocol.

This module implements the production browser's legacy upload path without
exposing signed blob URLs or upstream credentials to callers::

    POST /backend-api/files
      -> upload bytes to the returned destination
      -> POST /backend-api/files/process_upload_stream (NDJSON)

The upload destination can be a single Azure/AWS blob URL, ChatGPT's Estuary
``upload_content_bytes`` endpoint, or the Azure block-blob multipart strategy.
Unknown strategies fail closed with a sanitized :class:`ProtocolError`.

The module is intentionally independent from the FastAPI layer.  A caller can
pass either an existing :class:`AuthenticatedProtocolSession` or a credential
accepted by :meth:`AuthenticatedProtocolBridge.create_session`.
"""

from __future__ import annotations

import base64
import json
import math
import os
import re
import time
from dataclasses import dataclass
from typing import Any, Iterable, Iterator, Mapping, Sequence
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

from .authenticated_protocol import (
    AuthenticatedCredential,
    AuthenticatedProtocolBridge,
    AuthenticatedProtocolError,
    AuthenticatedProtocolSession,
    CredentialLike,
    _json_response,
    _request_id,
    _require_success,
    _safe_code,
)


_ALLOWED_USE_CASES = frozenset({"multimodal", "ace_upload", "my_files"})
_PROCESS_FAILURE_SUFFIXES = frozenset({"error", "cancelled", "failed", "unknown"})
_AZURE_STORAGE_VERSION = "2020-04-08"
_ESTUARY_PATH = re.compile(
    r"^/(?:backend-)?api/estuary/(?P<operation>[^/]+)/?$", re.IGNORECASE
)
_SAFE_IDENTIFIER = re.compile(r"^[^\x00-\x1f\x7f]{1,512}$")


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
class AuthenticatedFilesConfig:
    """Resource limits for authenticated file uploads."""

    create_timeout_seconds: int = 60
    blob_timeout_seconds: int = 300
    process_timeout_seconds: int = 300
    max_file_bytes: int = 512 * 1024 * 1024
    max_process_stream_bytes: int = 4 * 1024 * 1024
    timezone_offset_min: int = -480
    entry_surface: str = "chat_composer"

    @classmethod
    def from_environment(cls) -> "AuthenticatedFilesConfig":
        return cls(
            create_timeout_seconds=_bounded_env_int(
                "CHATGPT_AUTH_FILE_CREATE_TIMEOUT", 60, 5, 180
            ),
            blob_timeout_seconds=_bounded_env_int(
                "CHATGPT_AUTH_FILE_BLOB_TIMEOUT", 300, 15, 900
            ),
            process_timeout_seconds=_bounded_env_int(
                "CHATGPT_AUTH_FILE_PROCESS_TIMEOUT", 300, 15, 900
            ),
            max_file_bytes=_bounded_env_int(
                "CHATGPT_AUTH_FILE_MAX_BYTES",
                512 * 1024 * 1024,
                1,
                1024 * 1024 * 1024,
            ),
            max_process_stream_bytes=_bounded_env_int(
                "CHATGPT_AUTH_FILE_PROCESS_MAX_BYTES",
                4 * 1024 * 1024,
                64 * 1024,
                32 * 1024 * 1024,
            ),
            timezone_offset_min=_bounded_env_int(
                "CHATGPT_AUTH_TIMEZONE_OFFSET_MIN", -480, -840, 840
            ),
            entry_surface=(
                os.getenv("CHATGPT_AUTH_FILE_ENTRY_SURFACE", "chat_composer").strip()
                or "chat_composer"
            ),
        )


@dataclass(frozen=True)
class _CreatedFile:
    file_id: str
    upload_url: str
    upload_headers: dict[str, str]
    upload_strategy: Mapping[str, Any] | None


def _validation_error(code: str, message: str) -> AuthenticatedProtocolError:
    return AuthenticatedProtocolError(
        code,
        message,
        stage="file_validation",
        retryable=False,
    )


def _strategy_error(reason: str = "unsupported") -> AuthenticatedProtocolError:
    return AuthenticatedProtocolError(
        f"authenticated_file_upload_strategy_{_safe_code(reason, 'unsupported')}",
        "The authenticated file upload strategy is unsupported or malformed.",
        stage="file_blob_upload",
        retryable=False,
    )


def _clean_file_name(value: str) -> str:
    if not isinstance(value, str):
        raise _validation_error(
            "authenticated_file_name_invalid", "The upload file name is invalid."
        )
    # Browser File.name never contains a path.  Keep the final component when a
    # native client accidentally submits one so local paths do not reach ChatGPT.
    name = re.split(r"[\\/]", value)[-1].strip()
    if (
        not name
        or name in {".", ".."}
        or len(name) > 1024
        or any(ord(character) < 0x20 or ord(character) == 0x7F for character in name)
    ):
        raise _validation_error(
            "authenticated_file_name_invalid", "The upload file name is invalid."
        )
    return name


def _clean_mime_type(value: str | None) -> str:
    mime_type = (value or "application/octet-stream").strip().lower()
    if (
        not mime_type
        or len(mime_type) > 255
        or any(ord(character) < 0x20 or ord(character) == 0x7F for character in mime_type)
        or not re.fullmatch(r"[^\s/;]+/[^\s;]+(?:\s*;[^\r\n]*)?", mime_type)
    ):
        raise _validation_error(
            "authenticated_file_mime_invalid", "The upload MIME type is invalid."
        )
    return mime_type


def _clean_optional_text(
    value: Any,
    *,
    maximum: int = 512,
) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if (
        not text
        or len(text) > maximum
        or any(ord(character) < 0x20 or ord(character) == 0x7F for character in text)
    ):
        return None
    return text


def _clean_identifier(value: Any) -> str | None:
    text = _clean_optional_text(value)
    return text if text is not None and _SAFE_IDENTIFIER.fullmatch(text) else None


def _clean_dimension(value: int | None, label: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 100_000:
        raise _validation_error(
            "authenticated_file_dimensions_invalid",
            f"The upload image {label} is invalid.",
        )
    return value


def _safe_headers(value: Any) -> dict[str, str]:
    if value is None:
        return {}
    if not isinstance(value, Mapping) or len(value) > 64:
        raise _strategy_error("headers_invalid")
    result: dict[str, str] = {}
    total = 0
    for raw_name, raw_value in value.items():
        if not isinstance(raw_name, str) or not isinstance(raw_value, str):
            raise _strategy_error("headers_invalid")
        name = raw_name.strip()
        header_value = raw_value.strip()
        total += len(name) + len(header_value)
        if (
            not name
            or not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+", name)
            or any(
                ord(character) < 0x20 or ord(character) == 0x7F
                for character in header_value
            )
            or total > 32_768
        ):
            raise _strategy_error("headers_invalid")
        result[name] = header_value
    return result


def _merge_headers_case_insensitive(
    defaults: Mapping[str, str], overrides: Mapping[str, str]
) -> dict[str, str]:
    merged = dict(defaults)
    names = {name.lower(): name for name in merged}
    for name, value in overrides.items():
        existing = names.get(name.lower())
        if existing is not None and existing != name:
            del merged[existing]
        merged[name] = value
        names[name.lower()] = name
    return merged


def _is_aws_presigned(url: str) -> bool:
    try:
        return any(
            key.lower() == "x-amz-algorithm"
            for key, _ in parse_qsl(urlsplit(url).query, keep_blank_values=True)
        )
    except ValueError:
        return False


def _single_blob_headers(
    upload_url: str,
    mime_type: str,
    upload_headers: Mapping[str, str],
) -> dict[str, str]:
    defaults = {"Content-Type": mime_type}
    if not _is_aws_presigned(upload_url):
        defaults["x-ms-blob-type"] = "BlockBlob"
        defaults["x-ms-version"] = _AZURE_STORAGE_VERSION
    return _merge_headers_case_insensitive(defaults, upload_headers)


def _block_id(index: int) -> str:
    return base64.b64encode(str(index).rjust(8, "0").encode("ascii")).decode("ascii")


def _with_block_query(url: str, *, block_id: str | None) -> str:
    try:
        parsed = urlsplit(url)
    except ValueError as error:
        raise _strategy_error("url_invalid") from error
    query = [
        (key, value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        if key.lower() not in {"comp", "blockid"}
    ]
    if block_id is None:
        query.append(("comp", "blocklist"))
    else:
        query.extend((("comp", "block"), ("blockid", block_id)))
    return urlunsplit(
        (parsed.scheme, parsed.netloc, parsed.path, urlencode(query), parsed.fragment)
    )


def _block_list_xml(block_ids: Sequence[str]) -> bytes:
    lines = [
        '<?xml version="1.0" encoding="utf-8"?>',
        "<BlockList>",
        *(f"  <Latest>{identifier}</Latest>" for identifier in block_ids),
        "</BlockList>",
    ]
    return "\n".join(lines).encode("utf-8")


def _blob_success(response: Any) -> None:
    status = int(getattr(response, "status_code", 0) or 0)
    if 200 <= status < 300:
        return
    raise AuthenticatedProtocolError(
        f"authenticated_file_blob_upload_http_{status}",
        "The authenticated file bytes could not be uploaded.",
        stage="file_blob_upload",
        retryable=status == 0 or status >= 409,
        upstream_status=status or None,
        upstream_request_id=_request_id(response),
    )


def _iter_response_lines(response: Any) -> Iterator[bytes | str]:
    iterator = getattr(response, "iter_lines", None)
    if callable(iterator):
        yield from iterator()
        return
    content = getattr(response, "content", b"")
    if isinstance(content, str):
        yield from content.splitlines()
    else:
        yield from bytes(content).splitlines()


def _iter_ndjson_objects(response: Any, maximum_bytes: int) -> Iterator[dict[str, Any]]:
    """Parse the newline-delimited JSON used by process_upload_stream.

    The production parser retains a line that is not yet valid JSON and joins
    the next line before retrying.  The same behavior is used here.  ``data:``
    is accepted as a compatibility fallback, although the captured upload
    endpoint emitted plain NDJSON rather than conversation-style SSE.
    """

    total = 0
    buffered = ""
    for raw_line in _iter_response_lines(response):
        if isinstance(raw_line, bytes):
            total += len(raw_line) + 1
            line = raw_line.decode("utf-8", "replace")
        else:
            line = str(raw_line)
            total += len(line.encode("utf-8")) + 1
        if total > maximum_bytes:
            raise AuthenticatedProtocolError(
                "authenticated_file_process_stream_too_large",
                "The authenticated file processing stream exceeded the local limit.",
                stage="file_process",
                retryable=False,
            )
        line = line.strip()
        if not line:
            continue
        if not buffered and line.startswith("data:"):
            line = line[5:].lstrip()
            if line == "[DONE]":
                continue
        candidate = f"{buffered}\n{line}" if buffered else line
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError:
            buffered = candidate
            continue
        buffered = ""
        if not isinstance(value, dict):
            raise AuthenticatedProtocolError(
                "authenticated_file_process_stream_invalid",
                "The authenticated file processing stream was invalid.",
                stage="file_process",
                retryable=True,
            )
        yield value
    if buffered:
        raise AuthenticatedProtocolError(
            "authenticated_file_process_stream_invalid",
            "The authenticated file processing stream was invalid.",
            stage="file_process",
            retryable=True,
        )


def _processing_failure(event_name: str, extra: Any) -> AuthenticatedProtocolError:
    raw_code: Any = None
    if isinstance(extra, Mapping):
        raw_code = extra.get("error_code") or extra.get("file_parse_error_code")
    code = _safe_code(raw_code, "file_processing_failed")
    return AuthenticatedProtocolError(
        f"authenticated_{code}",
        "The authenticated file could not be processed.",
        stage="file_process",
        retryable=False,
    )


def _collect_processing_metadata(
    response: Any,
    *,
    maximum_bytes: int,
) -> dict[str, Any]:
    metadata: dict[str, Any] = {}
    for payload in _iter_ndjson_objects(response, maximum_bytes):
        event = payload.get("event")
        event_name = event if isinstance(event, str) else ""
        suffix = event_name.rsplit(".", 1)[-1].lower()
        extra = payload.get("extra")
        if suffix in _PROCESS_FAILURE_SUFFIXES:
            raise _processing_failure(event_name, extra)
        if not isinstance(extra, Mapping):
            continue

        total_tokens = extra.get("total_tokens")
        if (
            isinstance(total_tokens, int)
            and not isinstance(total_tokens, bool)
            and 0 <= total_tokens <= 10**12
        ):
            metadata["file_token_size"] = total_tokens

        mime_type = _clean_optional_text(extra.get("mime_type"), maximum=255)
        if mime_type is not None:
            try:
                metadata["mime_type"] = _clean_mime_type(mime_type)
            except AuthenticatedProtocolError:
                # Processing metadata is advisory.  Retain the validated MIME
                # supplied by the caller instead of failing on malformed extras.
                pass

        if extra.get("non_library_my_files_injest_upload") is True:
            metadata["non_library_my_files_injest_upload"] = True

        library_file_id = _clean_identifier(extra.get("metadata_object_id"))
        if library_file_id is not None:
            metadata["library_file_id"] = library_file_id

        library_file_name = _clean_optional_text(
            extra.get("library_file_name"), maximum=1024
        )
        if library_file_name is not None:
            metadata["library_file_name"] = library_file_name

        persistence = extra.get("library_persistence_result")
        if persistence in {"library", "temporary"}:
            metadata["library_persistence_result"] = persistence
        reason = _clean_optional_text(
            extra.get("library_persistence_reason"), maximum=256
        )
        if reason is not None:
            metadata["library_persistence_reason"] = reason

        thumbnail = extra.get("thumbnail")
        if isinstance(thumbnail, Mapping):
            thumbnail_id = _clean_identifier(thumbnail.get("file_id"))
            thumbnail_width = thumbnail.get("width")
            thumbnail_height = thumbnail.get("height")
            thumbnail_size = thumbnail.get("size_bytes")
            if (
                thumbnail_id is not None
                and isinstance(thumbnail_width, int)
                and not isinstance(thumbnail_width, bool)
                and isinstance(thumbnail_height, int)
                and not isinstance(thumbnail_height, bool)
                and isinstance(thumbnail_size, int)
                and not isinstance(thumbnail_size, bool)
                and thumbnail_width > 0
                and thumbnail_height > 0
                and thumbnail_size >= 0
            ):
                metadata["thumbnail"] = {
                    "file_id": thumbnail_id,
                    "width": thumbnail_width,
                    "height": thumbnail_height,
                    "size_bytes": thumbnail_size,
                }
    return metadata


def _raw_file_id(value: Any) -> str:
    identifier = _clean_identifier(value)
    if identifier is None:
        raise _validation_error(
            "authenticated_file_reference_invalid",
            "The authenticated file reference is invalid.",
        )
    for prefix in ("sediment://", "file-service://"):
        if identifier.startswith(prefix):
            identifier = identifier[len(prefix) :]
            break
    if _clean_identifier(identifier) is None:
        raise _validation_error(
            "authenticated_file_reference_invalid",
            "The authenticated file reference is invalid.",
        )
    return identifier


def file_asset_pointer(file_id: str) -> str:
    """Return the official asset-pointer URI for a raw uploaded file id."""

    identifier = _raw_file_id(file_id)
    if identifier.startswith("file_"):
        return f"sediment://{identifier}"
    return f"file-service://{identifier}"


_ATTACHMENT_OPTIONAL_FIELDS = (
    "context_connector_info",
    "attachment_role",
    "library_file_id",
    "mounted_library_file_id",
    "mounted_library_mime_type",
    "library_artifact_type",
    "preview_file",
    "library_provider",
    "library_entrypoint",
    "library_persistence_result",
    "library_persistence_reason",
    "non_library_my_files_injest_upload",
)


def _attachment_from_reference(reference: Mapping[str, Any]) -> dict[str, Any]:
    identifier = _raw_file_id(reference.get("id"))
    name = _clean_file_name(str(reference.get("name", "")))
    size = reference.get("size")
    if isinstance(size, bool) or not isinstance(size, int) or size < 0:
        raise _validation_error(
            "authenticated_file_reference_invalid",
            "The authenticated file reference is invalid.",
        )
    attachment: dict[str, Any] = {
        "id": identifier,
        "size": size,
        "name": name,
        "source": _clean_optional_text(reference.get("source"), maximum=32)
        or "local",
        "is_big_paste": reference.get("is_big_paste") is True,
    }
    mime_type = _clean_optional_text(reference.get("mime_type"), maximum=255)
    if mime_type is not None:
        attachment["mime_type"] = mime_type
    for key in ("width", "height", "file_token_size"):
        value = reference.get(key)
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            attachment[key] = value
    for key in _ATTACHMENT_OPTIONAL_FIELDS:
        value = reference.get(key)
        if value is not None:
            attachment[key] = value
    return attachment


def map_file_references(
    prompt: str,
    references: Iterable[Mapping[str, Any]],
    *,
    include_attachments: bool = True,
    include_image_pointers: bool = True,
) -> dict[str, Any]:
    """Purely map sanitized refs to official message content and attachments.

    The production mapper can include both representations for an image when a
    model supports image input *and* interpreter/retrieval attachments.  The
    defaults therefore emit metadata attachments for every ref and additionally
    emit ``image_asset_pointer`` parts for refs carrying width and height.
    Callers using a model without one of those capabilities can disable the
    corresponding representation explicitly.
    """

    if not isinstance(prompt, str):
        raise _validation_error(
            "authenticated_file_prompt_invalid", "The user prompt is invalid."
        )
    attachments: list[dict[str, Any]] = []
    image_parts: list[dict[str, Any]] = []
    for reference in references:
        if not isinstance(reference, Mapping):
            raise _validation_error(
                "authenticated_file_reference_invalid",
                "The authenticated file reference is invalid.",
            )
        attachment = _attachment_from_reference(reference)
        if include_attachments:
            attachments.append(attachment)
        width = attachment.get("width")
        height = attachment.get("height")
        if (
            include_image_pointers
            and isinstance(width, int)
            and width > 0
            and isinstance(height, int)
            and height > 0
        ):
            image_parts.append(
                {
                    "content_type": "image_asset_pointer",
                    "asset_pointer": file_asset_pointer(attachment["id"]),
                    "size_bytes": attachment["size"],
                    "width": width,
                    "height": height,
                }
            )

    content: dict[str, Any]
    if image_parts:
        content = {
            "content_type": "multimodal_text",
            "parts": [*image_parts, prompt],
        }
    else:
        content = {"content_type": "text", "parts": [prompt]}
    return {"content": content, "attachments": attachments}


def build_user_message_with_file_references(
    prompt: str,
    message_id: str,
    references: Iterable[Mapping[str, Any]],
    *,
    create_time: float | None = None,
    include_attachments: bool = True,
    include_image_pointers: bool = True,
) -> dict[str, Any]:
    """Build the observed authenticated user-message envelope for file refs."""

    identifier = _clean_identifier(message_id)
    if identifier is None:
        raise _validation_error(
            "authenticated_message_id_invalid", "The user message id is invalid."
        )
    mapped = map_file_references(
        prompt,
        references,
        include_attachments=include_attachments,
        include_image_pointers=include_image_pointers,
    )
    metadata: dict[str, Any] = {
        "selected_sources": [],
        "serialization_metadata": {"custom_symbol_offsets": []},
    }
    if mapped["attachments"]:
        metadata["attachments"] = mapped["attachments"]
    return {
        "id": identifier,
        "author": {"role": "user"},
        "create_time": time.time() if create_time is None else float(create_time),
        "content": mapped["content"],
        "metadata": metadata,
    }


class AuthenticatedFilesBridge:
    """Upload authenticated ChatGPT files and return credential-safe refs."""

    def __init__(
        self,
        config: AuthenticatedFilesConfig | None = None,
        *,
        protocol_bridge: AuthenticatedProtocolBridge | None = None,
    ) -> None:
        self.config = config or AuthenticatedFilesConfig.from_environment()
        self.protocol_bridge = protocol_bridge or AuthenticatedProtocolBridge()

    def _headers(
        self,
        session: AuthenticatedProtocolSession,
        *,
        accept: str,
        json_body: bool = False,
        model_slug: str | None = None,
    ) -> dict[str, str]:
        headers = {
            **self.protocol_bridge._auth_headers(session),
            "Accept": accept,
        }
        if json_body:
            headers["Content-Type"] = "application/json"
        if model_slug:
            headers["x-oai-model-slug"] = model_slug
        return headers

    def _create_file(
        self,
        session: AuthenticatedProtocolSession,
        *,
        file_name: str,
        file_size: int,
        mime_type: str,
        use_case: str,
        entry_surface: str,
        upload_source: str | None,
        selection_method: str | None,
        store_in_library: bool | None,
        library_persistence_mode: str | None,
        model_slug: str | None,
    ) -> _CreatedFile:
        body: dict[str, Any] = {
            "file_name": file_name,
            "file_size": file_size,
            "use_case": use_case,
            "timezone_offset_min": self.config.timezone_offset_min,
            "reset_rate_limits": False,
            "supports_direct_azure_multipart": True,
            "mime_type": mime_type,
            "entry_surface": entry_surface,
        }
        if upload_source:
            body["upload_source"] = upload_source
        if selection_method:
            body["selection_method"] = selection_method
        if store_in_library is not None:
            body["store_in_library"] = store_in_library
        if library_persistence_mode:
            body["library_persistence_mode"] = library_persistence_mode

        response = self.protocol_bridge._request(
            session,
            "POST",
            "/backend-api/files",
            stage="file_create",
            timeout=self.config.create_timeout_seconds,
            headers=self._headers(
                session,
                accept="application/json",
                json_body=True,
                model_slug=model_slug,
            ),
            json=body,
        )
        payload = _json_response(response, "file_create")
        if payload.get("status") == "error":
            raw_code = payload.get("error_code")
            code = _safe_code(raw_code, "file_create_failed")
            raise AuthenticatedProtocolError(
                f"authenticated_{code}",
                "The authenticated file entry could not be created.",
                stage="file_create",
                retryable=False,
                upstream_request_id=_request_id(response),
            )
        if payload.get("status") != "success":
            raise AuthenticatedProtocolError(
                "authenticated_file_create_invalid_response",
                "The authenticated file entry response was invalid.",
                stage="file_create",
                retryable=True,
                upstream_request_id=_request_id(response),
            )
        file_id = _clean_identifier(payload.get("file_id"))
        upload_url = _clean_optional_text(payload.get("upload_url"), maximum=16_384)
        if file_id is None or upload_url is None:
            raise AuthenticatedProtocolError(
                "authenticated_file_create_invalid_response",
                "The authenticated file entry response was invalid.",
                stage="file_create",
                retryable=True,
                upstream_request_id=_request_id(response),
            )
        strategy = payload.get("direct_library_upload_strategy")
        if strategy is not None and not isinstance(strategy, Mapping):
            raise _strategy_error("invalid")
        return _CreatedFile(
            file_id=file_id,
            upload_url=upload_url,
            upload_headers=_safe_headers(payload.get("upload_headers")),
            upload_strategy=strategy,
        )

    def _destination(self, upload_url: str) -> tuple[str, str, str | None]:
        try:
            resolved = urljoin(f"{self.protocol_bridge.config.origin}/", upload_url)
            parsed = urlsplit(resolved)
        except (TypeError, ValueError) as error:
            raise _strategy_error("url_invalid") from error
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise _strategy_error("url_invalid")
        estuary = _ESTUARY_PATH.fullmatch(parsed.path)
        if estuary is None:
            return "blob", resolved, None
        operation = estuary.group("operation").lower()
        if operation != "upload_content_bytes":
            raise _strategy_error("estuary_unsupported")
        upload_target = next(
            (
                value
                for key, value in parse_qsl(parsed.query, keep_blank_values=True)
                if key == "upload_url"
            ),
            None,
        )
        return "estuary", resolved, upload_target or upload_url

    def _upload_estuary(
        self,
        session: AuthenticatedProtocolSession,
        *,
        destination: str,
        upload_target: str,
        file_bytes: bytes,
        file_name: str,
        mime_type: str,
    ) -> None:
        response = self.protocol_bridge._request(
            session,
            "POST",
            destination,
            stage="file_blob_upload",
            timeout=self.config.blob_timeout_seconds,
            headers=self._headers(session, accept="application/json"),
            files={"file": (file_name, file_bytes, mime_type)},
            data={"upload_url": upload_target},
        )
        _require_success(response, "file_blob_upload")

    def _upload_single_blob(
        self,
        session: AuthenticatedProtocolSession,
        *,
        destination: str,
        upload_headers: Mapping[str, str],
        file_bytes: bytes,
        mime_type: str,
    ) -> None:
        response = self.protocol_bridge._request(
            session,
            "PUT",
            destination,
            stage="file_blob_upload",
            timeout=self.config.blob_timeout_seconds,
            headers=_single_blob_headers(destination, mime_type, upload_headers),
            data=file_bytes,
        )
        _blob_success(response)

    @staticmethod
    def _strategy_integer(
        strategy: Mapping[str, Any], key: str, *, maximum: int
    ) -> int:
        value = strategy.get(key)
        if (
            isinstance(value, bool)
            or not isinstance(value, int)
            or not 1 <= value <= maximum
        ):
            raise _strategy_error("multipart_invalid")
        return value

    def _upload_multipart_blob(
        self,
        session: AuthenticatedProtocolSession,
        *,
        destination: str,
        strategy: Mapping[str, Any],
        file_bytes: bytes,
        mime_type: str,
    ) -> None:
        part_size = self._strategy_integer(
            strategy, "part_size_bytes", maximum=self.config.max_file_bytes
        )
        part_count = self._strategy_integer(strategy, "part_count", maximum=100_000)
        # Validate this field even though sequential server-side uploads do not
        # need to use the browser's suggested concurrency.
        self._strategy_integer(strategy, "max_part_concurrency", maximum=1_024)
        expected_count = math.ceil(len(file_bytes) / part_size)
        if expected_count < 2 or expected_count != part_count:
            raise _strategy_error("multipart_invalid")

        block_ids = [_block_id(index) for index in range(part_count)]
        part_headers = {
            "Content-Type": mime_type,
            "x-ms-version": _AZURE_STORAGE_VERSION,
        }
        for index, identifier in enumerate(block_ids):
            start = index * part_size
            part = file_bytes[start : start + part_size]
            response = self.protocol_bridge._request(
                session,
                "PUT",
                _with_block_query(destination, block_id=identifier),
                stage="file_blob_upload",
                timeout=self.config.blob_timeout_seconds,
                headers=part_headers,
                data=part,
            )
            _blob_success(response)

        commit_headers = {
            "Content-Type": "application/xml",
            "x-ms-version": _AZURE_STORAGE_VERSION,
        }
        if mime_type:
            commit_headers["x-ms-blob-content-type"] = mime_type
        response = self.protocol_bridge._request(
            session,
            "PUT",
            _with_block_query(destination, block_id=None),
            stage="file_blob_upload",
            timeout=self.config.blob_timeout_seconds,
            headers=commit_headers,
            data=_block_list_xml(block_ids),
        )
        _blob_success(response)

    def _upload_bytes(
        self,
        session: AuthenticatedProtocolSession,
        created: _CreatedFile,
        *,
        file_bytes: bytes,
        file_name: str,
        mime_type: str,
    ) -> None:
        destination_kind, destination, upload_target = self._destination(
            created.upload_url
        )
        strategy = created.upload_strategy
        if destination_kind == "estuary":
            if strategy is not None and strategy.get("kind") not in {None, ""}:
                raise _strategy_error("estuary_strategy_invalid")
            self._upload_estuary(
                session,
                destination=destination,
                upload_target=upload_target or created.upload_url,
                file_bytes=file_bytes,
                file_name=file_name,
                mime_type=mime_type,
            )
            return

        if strategy is None:
            self._upload_single_blob(
                session,
                destination=destination,
                upload_headers=created.upload_headers,
                file_bytes=file_bytes,
                mime_type=mime_type,
            )
            return
        kind = strategy.get("kind")
        if kind != "direct_azure_multipart":
            raise _strategy_error("unsupported")
        self._upload_multipart_blob(
            session,
            destination=destination,
            strategy=strategy,
            file_bytes=file_bytes,
            mime_type=mime_type,
        )

    def _process_file(
        self,
        session: AuthenticatedProtocolSession,
        *,
        file_id: str,
        file_name: str,
        use_case: str,
        index_for_retrieval: bool,
        entry_surface: str,
        upload_source: str | None,
        store_in_library: bool | None,
        library_persistence_mode: str | None,
        model_slug: str | None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "file_id": file_id,
            "use_case": use_case,
            "index_for_retrieval": index_for_retrieval,
            "file_name": file_name,
            "entry_surface": entry_surface,
        }
        if upload_source:
            body["upload_source"] = upload_source
        if library_persistence_mode:
            body["library_persistence_mode"] = library_persistence_mode
        if store_in_library is not None:
            body["metadata"] = {"store_in_library": store_in_library}

        response = self.protocol_bridge._request(
            session,
            "POST",
            "/backend-api/files/process_upload_stream",
            stage="file_process",
            timeout=self.config.process_timeout_seconds,
            headers=self._headers(
                session,
                accept="application/x-ndjson, text/event-stream, application/json",
                json_body=True,
                model_slug=model_slug,
            ),
            json=body,
            stream=True,
        )
        _require_success(response, "file_process")
        return _collect_processing_metadata(
            response,
            maximum_bytes=self.config.max_process_stream_bytes,
        )

    def upload(
        self,
        credential_or_session: (
            AuthenticatedProtocolSession
            | AuthenticatedCredential
            | CredentialLike
            | Mapping[str, Any]
        ),
        file_bytes: bytes | bytearray | memoryview,
        *,
        file_name: str,
        mime_type: str | None = None,
        width: int | None = None,
        height: int | None = None,
        use_case: str | None = None,
        index_for_retrieval: bool | None = None,
        entry_surface: str | None = None,
        upload_source: str | None = None,
        selection_method: str | None = None,
        store_in_library: bool | None = None,
        library_persistence_mode: str | None = None,
        model_slug: str | None = None,
    ) -> dict[str, Any]:
        """Upload bytes and return a sanitized reference for a user message.

        ``use_case`` defaults to ``multimodal`` for image MIME types and to
        ``ace_upload`` for other files.  A retrieval-backed model should pass
        ``use_case="my_files"`` (which also defaults
        ``index_for_retrieval=True``).
        """

        if not isinstance(file_bytes, (bytes, bytearray, memoryview)):
            raise _validation_error(
                "authenticated_file_bytes_invalid", "The upload bytes are invalid."
            )
        data = bytes(file_bytes)
        if not data or len(data) > self.config.max_file_bytes:
            raise _validation_error(
                "authenticated_file_size_invalid", "The upload file size is invalid."
            )
        name = _clean_file_name(file_name)
        normalized_mime = _clean_mime_type(mime_type)
        image_width = _clean_dimension(width, "width")
        image_height = _clean_dimension(height, "height")
        if (image_width is None) != (image_height is None):
            raise _validation_error(
                "authenticated_file_dimensions_invalid",
                "Both image dimensions must be supplied together.",
            )
        normalized_use_case = (
            use_case.strip().lower()
            if isinstance(use_case, str) and use_case.strip()
            else ("multimodal" if normalized_mime.startswith("image/") else "ace_upload")
        )
        if normalized_use_case not in _ALLOWED_USE_CASES:
            raise _validation_error(
                "authenticated_file_use_case_invalid",
                "The authenticated file use case is invalid.",
            )
        should_index = (
            normalized_use_case == "my_files"
            if index_for_retrieval is None
            else index_for_retrieval
        )
        if not isinstance(should_index, bool):
            raise _validation_error(
                "authenticated_file_index_flag_invalid",
                "The authenticated file indexing flag is invalid.",
            )
        surface = _clean_optional_text(
            entry_surface or self.config.entry_surface, maximum=128
        )
        if surface is None:
            raise _validation_error(
                "authenticated_file_entry_surface_invalid",
                "The authenticated file entry surface is invalid.",
            )
        normalized_upload_source = _clean_optional_text(upload_source, maximum=128)
        normalized_selection_method = _clean_optional_text(
            selection_method, maximum=128
        )
        normalized_persistence = _clean_optional_text(
            library_persistence_mode, maximum=64
        )
        normalized_model = _clean_optional_text(model_slug, maximum=256)
        if store_in_library is not None and not isinstance(store_in_library, bool):
            raise _validation_error(
                "authenticated_file_library_flag_invalid",
                "The authenticated file library flag is invalid.",
            )

        owns_session = not isinstance(
            credential_or_session, AuthenticatedProtocolSession
        )
        session = (
            self.protocol_bridge.create_session(credential_or_session)
            if owns_session
            else credential_or_session
        )
        try:
            with session.lock:
                if session.closed or not session.access_token:
                    raise AuthenticatedProtocolError(
                        "authenticated_session_closed",
                        "The authenticated ChatGPT session is closed.",
                        stage="file_upload",
                        retryable=False,
                    )
                created = self._create_file(
                    session,
                    file_name=name,
                    file_size=len(data),
                    mime_type=normalized_mime,
                    use_case=normalized_use_case,
                    entry_surface=surface,
                    upload_source=normalized_upload_source,
                    selection_method=normalized_selection_method,
                    store_in_library=store_in_library,
                    library_persistence_mode=normalized_persistence,
                    model_slug=normalized_model,
                )
                self._upload_bytes(
                    session,
                    created,
                    file_bytes=data,
                    file_name=name,
                    mime_type=normalized_mime,
                )
                processed = self._process_file(
                    session,
                    file_id=created.file_id,
                    file_name=name,
                    use_case=normalized_use_case,
                    index_for_retrieval=should_index,
                    entry_surface=surface,
                    upload_source=normalized_upload_source,
                    store_in_library=store_in_library,
                    library_persistence_mode=normalized_persistence,
                    model_slug=normalized_model,
                )
        finally:
            if owns_session:
                session.close()

        reference: dict[str, Any] = {
            "id": created.file_id,
            "size": len(data),
            "name": name,
            "mime_type": processed.pop("mime_type", normalized_mime),
            "source": "local",
            "is_big_paste": False,
            **processed,
        }
        if image_width is not None and image_height is not None:
            reference["width"] = image_width
            reference["height"] = image_height
        return reference


__all__ = [
    "AuthenticatedFilesBridge",
    "AuthenticatedFilesConfig",
    "build_user_message_with_file_references",
    "file_asset_pointer",
    "map_file_references",
]
