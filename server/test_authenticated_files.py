"""Offline fixtures for the authenticated ChatGPT file protocol."""

from __future__ import annotations

import json
import unittest
from typing import Any
from urllib.parse import parse_qs, urlsplit

from .authenticated_files import (
    AuthenticatedFilesBridge,
    AuthenticatedFilesConfig,
    build_user_message_with_file_references,
    file_asset_pointer,
    map_file_references,
)
from .authenticated_protocol import (
    AuthenticatedProtocolBridge,
    AuthenticatedProtocolConfig,
    AuthenticatedProtocolError,
    AuthenticatedProtocolSession,
)


class _FakeResponse:
    def __init__(
        self,
        *,
        status: int = 200,
        payload: Any = None,
        lines: list[bytes] | None = None,
        headers: dict[str, str] | None = None,
        content: bytes | str | None = None,
    ) -> None:
        self.status_code = status
        self._payload = payload
        self._lines = lines or []
        self.headers = headers or {}
        self.content = (
            content.encode() if isinstance(content, str) else content
        ) if content is not None else b"\n".join(self._lines)

    def json(self) -> Any:
        return self._payload

    def iter_lines(self):
        yield from self._lines


def _process_lines(*events: dict[str, Any]) -> list[bytes]:
    return [json.dumps(event, separators=(",", ":")).encode() for event in events]


class _FakeHTTP:
    def __init__(
        self,
        *,
        upload_url: str,
        upload_headers: dict[str, str] | None = None,
        strategy: dict[str, Any] | None = None,
        process_lines: list[bytes] | None = None,
    ) -> None:
        self.upload_url = upload_url
        self.upload_headers = upload_headers
        self.strategy = strategy
        self.process_lines = process_lines or _process_lines(
            {"event": "file.uploaded", "progress": 60},
            {
                "event": "file.processed",
                "progress": 100,
                "extra": {"total_tokens": 17, "mime_type": "image/png"},
            },
        )
        self.calls: list[dict[str, Any]] = []
        self.closed = False

    def request(self, method: str, url: str, **kwargs: Any) -> _FakeResponse:
        self.calls.append({"method": method, "url": url, **kwargs})
        path = urlsplit(url).path
        if method == "GET" and path == "/":
            return _FakeResponse(content='<html data-build="fixture-build"></html>')
        if method == "GET" and path == "/backend-api/sentinel/sdk.js":
            return _FakeResponse(content="// fixture sentinel loader")
        if method == "POST" and path == "/backend-api/files":
            return _FakeResponse(
                payload={
                    "status": "success",
                    "file_id": "file_fixture",
                    "upload_url": self.upload_url,
                    "upload_headers": self.upload_headers,
                    "direct_library_upload_strategy": self.strategy,
                }
            )
        if method == "POST" and path == "/backend-api/files/process_upload_stream":
            return _FakeResponse(lines=self.process_lines)
        if method in {"PUT", "POST"}:
            return _FakeResponse(status=201)
        raise AssertionError(f"unexpected fake request: {method} {url}")

    def close(self) -> None:
        self.closed = True


class AuthenticatedFileBridgeTests(unittest.TestCase):
    def _bridge_and_session(
        self, fake: _FakeHTTP
    ) -> tuple[AuthenticatedFilesBridge, AuthenticatedProtocolSession]:
        protocol = AuthenticatedProtocolBridge(
            AuthenticatedProtocolConfig(
                origin="https://chatgpt.test",
                verify_tls=False,
            ),
            http_factory=lambda: fake,
        )
        bridge = AuthenticatedFilesBridge(
            AuthenticatedFilesConfig(
                max_file_bytes=1024 * 1024,
                max_process_stream_bytes=1024 * 1024,
            ),
            protocol_bridge=protocol,
        )
        session = AuthenticatedProtocolSession(
            http=fake,
            access_token="access-secret",
            cookie_header="session=private",
            account_id="account-1",
        )
        return bridge, session

    def test_single_azure_upload_processes_and_returns_sanitized_ref(self) -> None:
        fake = _FakeHTTP(
            upload_url="https://blob.test/container/object?sig=private",
            upload_headers={"content-type": "image/png", "x-ms-meta-test": "fixture"},
            process_lines=_process_lines(
                {"event": "file.uploaded", "progress": 60},
                {
                    "event": "file.processed",
                    "progress": 100,
                    "extra": {
                        "total_tokens": 23,
                        "mime_type": "image/png",
                        "metadata_object_id": "library_fixture",
                        "library_persistence_result": "library",
                    },
                },
            ),
        )
        bridge, session = self._bridge_and_session(fake)
        reference = bridge.upload(
            session,
            b"png-bytes",
            file_name=r"C:\private\photo.png",
            mime_type="image/png",
            width=640,
            height=480,
            store_in_library=True,
            model_slug="model-fixture",
        )

        self.assertEqual(
            reference,
            {
                "id": "file_fixture",
                "size": 9,
                "name": "photo.png",
                "mime_type": "image/png",
                "source": "local",
                "is_big_paste": False,
                "file_token_size": 23,
                "library_file_id": "library_fixture",
                "library_persistence_result": "library",
                "width": 640,
                "height": 480,
            },
        )
        create_call, blob_call, process_call = fake.calls
        self.assertEqual(create_call["json"]["use_case"], "multimodal")
        self.assertEqual(create_call["json"]["file_name"], "photo.png")
        self.assertEqual(create_call["headers"]["Authorization"], "Bearer access-secret")
        self.assertEqual(create_call["headers"]["x-oai-model-slug"], "model-fixture")
        self.assertEqual(blob_call["method"], "PUT")
        self.assertEqual(blob_call["data"], b"png-bytes")
        self.assertEqual(blob_call["headers"]["content-type"], "image/png")
        self.assertEqual(blob_call["headers"]["x-ms-blob-type"], "BlockBlob")
        self.assertNotIn("Authorization", blob_call["headers"])
        self.assertNotIn("Cookie", blob_call["headers"])
        self.assertFalse(process_call["json"]["index_for_retrieval"])
        self.assertEqual(
            process_call["json"]["metadata"], {"store_in_library": True}
        )

    def test_aws_single_put_does_not_add_azure_headers(self) -> None:
        fake = _FakeHTTP(
            upload_url=(
                "https://s3.test/object?X-Amz-Algorithm=AWS4-HMAC-SHA256&signature=x"
            ),
            process_lines=_process_lines({"event": "file.processed", "extra": {}}),
        )
        bridge, session = self._bridge_and_session(fake)
        bridge.upload(
            session,
            b"abc",
            file_name="notes.txt",
            mime_type="text/plain",
        )
        blob_call = fake.calls[1]
        self.assertEqual(blob_call["headers"], {"Content-Type": "text/plain"})

    def test_estuary_upload_uses_authenticated_multipart_form(self) -> None:
        fake = _FakeHTTP(
            upload_url=(
                "/backend-api/estuary/upload_content_bytes?upload_url=opaque-target"
            ),
            process_lines=_process_lines({"event": "file.processed", "extra": {}}),
        )
        bridge, session = self._bridge_and_session(fake)
        bridge.upload(
            session,
            b"document",
            file_name="doc.pdf",
            mime_type="application/pdf",
        )

        estuary_call = fake.calls[1]
        self.assertEqual(estuary_call["method"], "POST")
        self.assertEqual(
            urlsplit(estuary_call["url"]).path,
            "/backend-api/estuary/upload_content_bytes",
        )
        self.assertEqual(estuary_call["data"], {"upload_url": "opaque-target"})
        self.assertEqual(
            estuary_call["files"]["file"],
            ("doc.pdf", b"document", "application/pdf"),
        )
        self.assertEqual(
            estuary_call["headers"]["Authorization"], "Bearer access-secret"
        )

    def test_direct_azure_multipart_uploads_blocks_and_commits(self) -> None:
        fake = _FakeHTTP(
            upload_url="https://blob.test/container/object?sig=private",
            strategy={
                "kind": "direct_azure_multipart",
                "part_size_bytes": 4,
                "part_count": 3,
                "max_part_concurrency": 2,
            },
            process_lines=_process_lines({"event": "file.processed", "extra": {}}),
        )
        bridge, session = self._bridge_and_session(fake)
        bridge.upload(
            session,
            b"abcdefghij",
            file_name="archive.zip",
            mime_type="application/zip",
            use_case="my_files",
        )

        block_calls = fake.calls[1:4]
        self.assertEqual([call["data"] for call in block_calls], [b"abcd", b"efgh", b"ij"])
        block_ids = [parse_qs(urlsplit(call["url"]).query)["blockid"][0] for call in block_calls]
        self.assertEqual(block_ids, ["MDAwMDAwMDA=", "MDAwMDAwMDE=", "MDAwMDAwMDI="])
        self.assertTrue(all(parse_qs(urlsplit(call["url"]).query)["comp"] == ["block"] for call in block_calls))
        commit_call = fake.calls[4]
        self.assertEqual(parse_qs(urlsplit(commit_call["url"]).query)["comp"], ["blocklist"])
        self.assertEqual(commit_call["headers"]["Content-Type"], "application/xml")
        self.assertEqual(
            commit_call["headers"]["x-ms-blob-content-type"], "application/zip"
        )
        for block_id in block_ids:
            self.assertIn(f"<Latest>{block_id}</Latest>".encode(), commit_call["data"])
        process_call = fake.calls[5]
        self.assertTrue(process_call["json"]["index_for_retrieval"])

    def test_unknown_strategy_fails_closed_without_leaking_url(self) -> None:
        secret_url = "https://blob.test/object?sig=do-not-leak"
        fake = _FakeHTTP(
            upload_url=secret_url,
            strategy={"kind": "future_transport", "private": "secret-extra"},
        )
        bridge, session = self._bridge_and_session(fake)
        with self.assertRaises(AuthenticatedProtocolError) as caught:
            bridge.upload(
                session,
                b"abc",
                file_name="file.txt",
                mime_type="text/plain",
            )
        self.assertEqual(
            caught.exception.code, "authenticated_file_upload_strategy_unsupported"
        )
        self.assertNotIn(secret_url, str(caught.exception))
        self.assertNotIn("secret-extra", str(caught.exception))
        self.assertEqual(len(fake.calls), 1)

    def test_credential_input_creates_and_closes_an_owned_session(self) -> None:
        fake = _FakeHTTP(
            upload_url="https://blob.test/object",
            process_lines=_process_lines({"event": "file.processed", "extra": {}}),
        )
        bridge, _ = self._bridge_and_session(fake)
        reference = bridge.upload(
            {
                "access_token": "access-secret",
                "cookie_header": "session=private",
                "account_id": "account-1",
            },
            b"abc",
            file_name="file.txt",
            mime_type="text/plain",
        )
        self.assertEqual(reference["id"], "file_fixture")
        self.assertTrue(fake.closed)
        self.assertEqual(
            [urlsplit(call["url"]).path for call in fake.calls[:2]],
            ["/", "/backend-api/sentinel/sdk.js"],
        )

    def test_processing_error_code_is_sanitized(self) -> None:
        fake = _FakeHTTP(
            upload_url="https://blob.test/object",
            process_lines=_process_lines(
                {
                    "event": "file.index.failed",
                    "extra": {
                        "error_code": "parse rejected / PRIVATE VALUE",
                        "message": "do-not-leak",
                    },
                }
            ),
        )
        bridge, session = self._bridge_and_session(fake)
        with self.assertRaises(AuthenticatedProtocolError) as caught:
            bridge.upload(
                session,
                b"abc",
                file_name="file.txt",
                mime_type="text/plain",
            )
        self.assertEqual(
            caught.exception.code,
            "authenticated_parse_rejected_private_value",
        )
        self.assertNotIn("do-not-leak", str(caught.exception))


class AuthenticatedFileMessageMappingTests(unittest.TestCase):
    def test_image_reference_maps_to_attachment_and_multimodal_pointer(self) -> None:
        reference = {
            "id": "file_fixture",
            "size": 9,
            "name": "photo.png",
            "mime_type": "image/png",
            "width": 640,
            "height": 480,
            "file_token_size": 23,
            "source": "local",
            "is_big_paste": False,
        }
        mapped = map_file_references("describe", [reference])
        self.assertEqual(mapped["attachments"], [reference])
        self.assertEqual(
            mapped["content"],
            {
                "content_type": "multimodal_text",
                "parts": [
                    {
                        "content_type": "image_asset_pointer",
                        "asset_pointer": "sediment://file_fixture",
                        "size_bytes": 9,
                        "width": 640,
                        "height": 480,
                    },
                    "describe",
                ],
            },
        )

        message = build_user_message_with_file_references(
            "describe", "message-fixture", [reference], create_time=123.5
        )
        self.assertEqual(message["create_time"], 123.5)
        self.assertEqual(message["metadata"]["attachments"], [reference])
        self.assertEqual(
            message["metadata"]["serialization_metadata"],
            {"custom_symbol_offsets": []},
        )

    def test_non_image_reference_keeps_text_content_and_file_service_prefix(self) -> None:
        reference = {
            "id": "legacy-id",
            "size": 3,
            "name": "doc.txt",
            "mime_type": "text/plain",
        }
        mapped = map_file_references("read", [reference])
        self.assertEqual(
            mapped["content"], {"content_type": "text", "parts": ["read"]}
        )
        self.assertEqual(file_asset_pointer("legacy-id"), "file-service://legacy-id")
        self.assertEqual(
            file_asset_pointer("sediment://file_fixture"),
            "sediment://file_fixture",
        )


if __name__ == "__main__":
    unittest.main()
