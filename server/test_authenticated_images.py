"""Offline tests for authenticated image jobs and private asset delivery."""

from __future__ import annotations

import unittest
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

from . import authenticated_images
from .auth_session import AuthSessionError
from .authenticated_images import (
    AuthenticatedImageRegistry,
    AuthenticatedImagesBridge,
    AuthenticatedImagesConfig,
)
from .authenticated_protocol import AuthenticatedImageAsset


class _FakeResponse:
    def __init__(
        self,
        *,
        status: int = 200,
        payload: Any = None,
        content: bytes = b"{}",
        headers: dict[str, str] | None = None,
        chunks: list[bytes] | None = None,
    ) -> None:
        self.status_code = status
        self._payload = payload
        self.content = content
        self.headers = headers or {}
        self._chunks = chunks

    def json(self) -> Any:
        if isinstance(self._payload, BaseException):
            raise self._payload
        return self._payload

    def iter_content(self, chunk_size: int = 64 * 1024):
        del chunk_size
        yield from self._chunks if self._chunks is not None else [self.content]


class _FakeHTTP:
    def __init__(self, responses: list[_FakeResponse | BaseException]) -> None:
        self.responses = list(responses)
        self.calls: list[dict[str, Any]] = []
        self.closed = False

    def get(self, url: str, **kwargs: Any) -> _FakeResponse:
        self.calls.append({"url": url, **kwargs})
        if not self.responses:
            raise AssertionError(f"unexpected fake GET: {url}")
        response = self.responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        return response

    def close(self) -> None:
        self.closed = True


class _BrokenStreamResponse(_FakeResponse):
    def iter_content(self, chunk_size: int = 64 * 1024):
        del chunk_size
        yield b"partial"
        raise OSError("https://files.oaiusercontent.com/image.png?private=signed")


def _credential() -> SimpleNamespace:
    return SimpleNamespace(
        access_token="access-secret",
        account_id="account-1",
        cookie_header="session=private",
    )


def _asset(
    pointer: str = "sediment://file-image",
    *,
    mime_type: str | None = None,
) -> AuthenticatedImageAsset:
    return AuthenticatedImageAsset(
        asset_pointer=pointer,
        width=1254,
        height=1254,
        mime_type=mime_type,
    )


class AuthenticatedImagesBridgeTests(unittest.TestCase):
    def _bridge(self, *, max_image_bytes: int = 1024) -> AuthenticatedImagesBridge:
        return AuthenticatedImagesBridge(
            AuthenticatedImagesConfig(
                request_timeout_seconds=1,
                poll_timeout_seconds=1,
                poll_interval_milliseconds=1,
                download_timeout_seconds=1,
                max_json_bytes=1024,
                max_image_bytes=max_image_bytes,
                verify_tls=False,
            )
        )

    def test_download_link_retries_and_resolves_relative_estuary_url(self) -> None:
        bridge = self._bridge()
        http = _FakeHTTP(
            [
                _FakeResponse(payload={"status": "retry"}),
                _FakeResponse(
                    payload={
                        "status": "success",
                        "download_url": "/backend-api/estuary/content?cid=opaque&id=opaque",
                        "mime_type": "image/png",
                    }
                ),
            ]
        )

        with patch.object(authenticated_images.time, "sleep") as sleep:
            url, mime_type = bridge._download_link(
                http,
                _credential(),
                _asset(),
                "conversation-upstream",
            )

        self.assertEqual(
            url,
            "https://chatgpt.com/backend-api/estuary/content?cid=opaque&id=opaque",
        )
        self.assertEqual(mime_type, "image/png")
        self.assertEqual(len(http.calls), 2)
        sleep.assert_called_once_with(0.25)
        for call in http.calls:
            self.assertEqual(
                call["params"],
                {
                    "conversation_id": "conversation-upstream",
                    "inline": "true",
                    "download_intent": "false",
                },
            )
            self.assertEqual(
                call["headers"]["Authorization"], "Bearer access-secret"
            )

    def test_download_link_rewrites_fragment_marker_before_path_encoding(self) -> None:
        bridge = self._bridge()
        http = _FakeHTTP(
            [
                _FakeResponse(
                    payload={
                        "status": "success",
                        "download_url": "https://files.oaiusercontent.com/image.png",
                    }
                )
            ]
        )

        bridge._download_link(
            http,
            _credential(),
            _asset("sediment://file-image#thumbnail"),
            "conversation-upstream",
        )

        self.assertEqual(
            http.calls[0]["url"],
            "https://chatgpt.com/backend-api/files/download/file-image%2Athumbnail",
        )
        self.assertNotIn("#", http.calls[0]["url"])

    def test_download_link_preserves_pointer_query_but_protects_binding(self) -> None:
        bridge = self._bridge()
        http = _FakeHTTP(
            [
                _FakeResponse(
                    payload={
                        "status": "success",
                        "download_url": "https://files.oaiusercontent.com/image.png",
                    }
                )
            ]
        )

        bridge._download_link(
            http,
            _credential(),
            _asset(
                "sediment://file-image#thumbnail?token=opaque%2Bvalue"
                "&conversation_id=attacker&inline=false&download_intent=true"
            ),
            "conversation-upstream",
        )

        self.assertEqual(
            http.calls[0]["url"],
            "https://chatgpt.com/backend-api/files/download/file-image%2Athumbnail",
        )
        self.assertEqual(http.calls[0]["params"]["token"], "opaque+value")
        self.assertEqual(
            http.calls[0]["params"]["conversation_id"], "conversation-upstream"
        )
        self.assertEqual(http.calls[0]["params"]["inline"], "true")
        self.assertEqual(http.calls[0]["params"]["download_intent"], "false")

    def test_download_image_rejects_non_display_mime_type(self) -> None:
        bridge = self._bridge()
        http = _FakeHTTP(
            [
                _FakeResponse(
                    payload={
                        "status": "success",
                        "download_url": "/backend-api/estuary/content?sig=opaque",
                    }
                ),
                _FakeResponse(
                    content=b"<svg/>",
                    headers={"content-type": "image/svg+xml"},
                    chunks=[b"<svg/>"]
                ),
            ]
        )

        with patch.object(bridge, "_new_http", return_value=http):
            with self.assertRaises(AuthSessionError) as caught:
                bridge.download_image(
                    _credential(), _asset(), "conversation-upstream"
                )

        self.assertEqual(caught.exception.code, "image_asset_mime_invalid")
        self.assertTrue(http.closed)

    def test_explicit_non_image_response_does_not_fallback_to_link_mime(self) -> None:
        bridge = self._bridge()
        http = _FakeHTTP(
            [
                _FakeResponse(
                    payload={
                        "status": "success",
                        "download_url": "/backend-api/estuary/content?sig=opaque",
                        "mime_type": "image/png",
                    }
                ),
                _FakeResponse(
                    content=b"<html>not an image</html>",
                    headers={"content-type": "text/html; charset=utf-8"},
                    chunks=[b"<html>not an image</html>"],
                ),
            ]
        )

        with patch.object(bridge, "_new_http", return_value=http):
            with self.assertRaises(AuthSessionError) as caught:
                bridge.download_image(
                    _credential(), _asset(mime_type="image/png"), "conversation-upstream"
                )

        self.assertEqual(caught.exception.code, "image_asset_mime_invalid")
        self.assertTrue(http.closed)

    def test_download_image_enforces_streamed_size_limit(self) -> None:
        bridge = self._bridge(max_image_bytes=4)
        http = _FakeHTTP(
            [
                _FakeResponse(
                    payload={
                        "status": "success",
                        "download_url": "/backend-api/estuary/content?sig=opaque",
                        "mime_type": "image/png",
                    }
                ),
                _FakeResponse(
                    content=b"",
                    headers={"content-type": "image/png"},
                    chunks=[b"123", b"45"],
                ),
            ]
        )

        with patch.object(bridge, "_new_http", return_value=http):
            with self.assertRaises(AuthSessionError) as caught:
                bridge.download_image(
                    _credential(), _asset(), "conversation-upstream"
                )

        self.assertEqual(caught.exception.code, "image_asset_too_large")
        self.assertTrue(http.closed)

    def test_download_image_rejects_declared_size_before_reading_body(self) -> None:
        bridge = self._bridge(max_image_bytes=4)
        http = _FakeHTTP(
            [
                _FakeResponse(
                    payload={
                        "status": "success",
                        "download_url": "/backend-api/estuary/content?sig=opaque",
                        "mime_type": "image/png",
                    }
                ),
                _FakeResponse(
                    content=b"",
                    headers={
                        "content-type": "image/png",
                        "content-length": "5",
                    },
                    chunks=[b"this chunk must not be consumed"],
                ),
            ]
        )

        with patch.object(bridge, "_new_http", return_value=http):
            with self.assertRaises(AuthSessionError) as caught:
                bridge.download_image(
                    _credential(), _asset(), "conversation-upstream"
                )

        self.assertEqual(caught.exception.code, "image_asset_too_large")
        self.assertTrue(http.closed)

    def test_signed_download_network_failure_is_sanitized(self) -> None:
        bridge = self._bridge()
        http = _FakeHTTP(
            [
                _FakeResponse(
                    payload={
                        "status": "success",
                        "download_url": "https://files.oaiusercontent.com/image.png?sig=private",
                        "mime_type": "image/png",
                    }
                ),
                OSError("https://files.oaiusercontent.com/image.png?sig=private"),
            ]
        )

        with patch.object(bridge, "_new_http", return_value=http):
            with self.assertRaises(AuthSessionError) as caught:
                bridge.download_image(
                    _credential(), _asset(), "conversation-upstream"
                )

        self.assertEqual(caught.exception.code, "image_asset_unavailable")
        self.assertNotIn("sig=private", str(caught.exception))
        self.assertTrue(http.closed)

    def test_signed_download_stream_failure_is_sanitized(self) -> None:
        bridge = self._bridge()
        http = _FakeHTTP(
            [
                _FakeResponse(
                    payload={
                        "status": "success",
                        "download_url": "https://files.oaiusercontent.com/image.png?sig=private",
                        "mime_type": "image/png",
                    }
                ),
                _BrokenStreamResponse(headers={"content-type": "image/png"}),
            ]
        )

        with patch.object(bridge, "_new_http", return_value=http):
            with self.assertRaises(AuthSessionError) as caught:
                bridge.download_image(
                    _credential(), _asset(), "conversation-upstream"
                )

        self.assertEqual(caught.exception.code, "image_asset_unavailable")
        self.assertNotIn("private=signed", str(caught.exception))
        self.assertTrue(http.closed)

    def test_conversation_poll_retries_brief_not_found_propagation(self) -> None:
        bridge = self._bridge()
        http = _FakeHTTP(
            [
                _FakeResponse(status=404, payload={}),
                _FakeResponse(status=404, payload={}),
                _FakeResponse(
                    payload={
                        "messages": [
                            {
                                "id": "tool-image",
                                "author": {"role": "tool", "name": "image_gen"},
                                "content": {
                                    "content_type": "multimodal_text",
                                    "parts": [
                                        {
                                            "content_type": "image_asset_pointer",
                                            "asset_pointer": "sediment://file-eventual",
                                            "width": 1024,
                                            "height": 1024,
                                        }
                                    ],
                                },
                            }
                        ]
                    }
                ),
            ]
        )

        with (
            patch.object(bridge, "_new_http", return_value=http),
            patch.object(authenticated_images.time, "sleep"),
        ):
            assets = bridge.wait_for_images(
                _credential(), "conversation-upstream"
            )

        self.assertEqual(len(assets), 1)
        self.assertEqual(assets[0].asset_pointer, "sediment://file-eventual")
        self.assertTrue(http.closed)


class AuthenticatedImageRegistryTests(unittest.TestCase):
    def test_try_create_job_enforces_active_cap_per_owner(self) -> None:
        registry = AuthenticatedImageRegistry(
            ttl_seconds=60,
            max_jobs=16,
            max_assets=8,
        )

        owner_a_first = registry.try_create_job(
            "owner-a", max_active_per_owner=2
        )
        owner_a_second = registry.try_create_job(
            "owner-a", max_active_per_owner=2
        )
        self.assertIsNotNone(owner_a_first)
        self.assertIsNotNone(owner_a_second)
        self.assertIsNone(
            registry.try_create_job("owner-a", max_active_per_owner=2)
        )

        owner_b = registry.try_create_job("owner-b", max_active_per_owner=2)
        self.assertIsNotNone(owner_b)

        assert owner_a_first is not None
        registry.fail(
            "owner-a",
            owner_a_first,
            code="fixture_failed",
            message="fixture",
        )
        replacement = registry.try_create_job(
            "owner-a", max_active_per_owner=2
        )
        self.assertIsNotNone(replacement)

    def test_jobs_and_assets_are_isolated_by_owner_and_removed_together(self) -> None:
        registry = AuthenticatedImageRegistry(
            ttl_seconds=60,
            max_jobs=8,
            max_assets=8,
        )
        job_id = registry.create_job("owner-a")

        self.assertIsNotNone(registry.get_job("owner-a", job_id))
        self.assertIsNone(registry.get_job("owner-b", job_id))
        self.assertTrue(
            registry.complete(
                "owner-a",
                job_id,
                conversation_id="authconv-public",
                upstream_conversation_id="conversation-private",
                images=(_asset(),),
                message="done",
            )
        )

        completed = registry.get_job("owner-a", job_id)
        assert completed is not None
        self.assertEqual(completed.status, "succeeded")
        self.assertEqual(len(completed.images), 1)
        public_asset = completed.images[0]
        self.assertTrue(public_asset.id.startswith("imgasset-"))
        self.assertFalse(hasattr(public_asset, "asset_pointer"))
        self.assertIsNone(registry.get_asset("owner-b", public_asset.id))

        private_asset = registry.get_asset("owner-a", public_asset.id)
        assert private_asset is not None
        self.assertEqual(
            private_asset.asset.asset_pointer, "sediment://file-image"
        )
        self.assertEqual(
            private_asset.upstream_conversation_id, "conversation-private"
        )

        registry.remove_owner("owner-a")
        self.assertIsNone(registry.get_job("owner-a", job_id))
        self.assertIsNone(registry.get_asset("owner-a", public_asset.id))


if __name__ == "__main__":
    unittest.main()
