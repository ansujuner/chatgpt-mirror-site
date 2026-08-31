from __future__ import annotations

import asyncio
import copy
import json
import tempfile
import time
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch

from fastapi.responses import JSONResponse
from starlette.requests import Request

from . import app as application
from . import upstream_settings
from .account_settings import AccountSettingsStore
from .auth_session import (
    AuthSessionError,
    AuthSessionRegistry,
    AuthenticatedUpstream,
    PublicAccount,
    UpstreamCredential,
)
from .upstream_settings import UpstreamSettingsSnapshot


def _http_request(
    method: str,
    path: str,
    *,
    handle: str | None = None,
    headers: dict[str, str] | None = None,
    chunks: list[bytes] | None = None,
) -> Request:
    request_headers = [(b"host", b"127.0.0.1:8787")]
    if handle is not None:
        request_headers.append(
            (
                b"cookie",
                f"{application.LOCAL_SESSION_COOKIE}={handle}".encode("ascii"),
            )
        )
    for key, value in (headers or {}).items():
        request_headers.append((key.lower().encode("ascii"), value.encode("latin-1")))

    pending = list(chunks if chunks is not None else [b""])

    async def receive() -> dict[str, Any]:
        body = pending.pop(0) if pending else b""
        return {
            "type": "http.request",
            "body": body,
            "more_body": bool(pending),
        }

    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": method,
            "scheme": "http",
            "path": path,
            "raw_path": path.encode("ascii"),
            "query_string": b"",
            "headers": request_headers,
            "client": ("127.0.0.1", 49152),
            "server": ("127.0.0.1", 8787),
        },
        receive,
    )


def _body(response: JSONResponse) -> dict[str, Any]:
    return json.loads(response.body)


def _upstream_identity(*, suffix: str = "") -> AuthenticatedUpstream:
    expires = time.time() + 3_600
    return AuthenticatedUpstream(
        account=PublicAccount(
            id=f"account-plus{suffix}",
            user_id=f"user-plus{suffix}",
            name="Settings Tester",
            email="settings@example.test",
            initials="ST",
            plan="plus",
            plan_label="Plus",
        ),
        credential=UpstreamCredential(
            kind="access_token",
            access_token="test-settings-token",
            access_token_expires_at_epoch=expires,
            cookie_header=None,
            account_id=f"account-plus{suffix}",
            user_id=f"user-plus{suffix}",
        ),
        expires_at_epoch=expires,
    )


class AccountSettingsRequestBoundaryTests(unittest.TestCase):
    def test_patch_requires_json_content_type_before_routing(self) -> None:
        for content_type in (None, "text/plain"):
            with self.subTest(content_type=content_type):
                headers = {} if content_type is None else {"content-type": content_type}
                request = _http_request(
                    "PATCH",
                    "/api/account/settings",
                    headers=headers,
                    chunks=[b'{}'],
                )
                called = False

                async def call_next(_: Request) -> JSONResponse:
                    nonlocal called
                    called = True
                    return JSONResponse({"unexpected": True})

                response = asyncio.run(
                    application._limit_chat_request_body(request, call_next)
                )
                self.assertEqual(response.status_code, 415)
                self.assertEqual(_body(response)["error"]["code"], "content_type_required")
                self.assertFalse(called)

    def test_invalid_and_oversized_content_length_are_rejected_before_routing(self) -> None:
        cases = [
            ("not-a-number", 400, "request_content_length_invalid"),
            ("-1", 413, "settings_request_too_large"),
            (str(32 * 1024 + 1), 413, "settings_request_too_large"),
        ]
        for content_length, status, code in cases:
            with self.subTest(content_length=content_length):
                request = _http_request(
                    "PATCH",
                    "/api/account/settings",
                    headers={
                        "content-type": "application/json; charset=utf-8",
                        "content-length": content_length,
                    },
                )
                called = False

                async def call_next(_: Request) -> JSONResponse:
                    nonlocal called
                    called = True
                    return JSONResponse({"unexpected": True})

                response = asyncio.run(
                    application._limit_chat_request_body(request, call_next)
                )
                self.assertEqual(response.status_code, status)
                self.assertEqual(_body(response)["error"]["code"], code)
                self.assertFalse(called)

    def test_chunked_body_over_32_kib_is_rejected(self) -> None:
        request = _http_request(
            "PATCH",
            "/api/account/settings",
            headers={"content-type": "application/json"},
            chunks=[b"x" * 16_384, b"y" * 16_385],
        )
        called = False

        async def call_next(_: Request) -> JSONResponse:
            nonlocal called
            called = True
            return JSONResponse({"unexpected": True})

        response = asyncio.run(application._limit_chat_request_body(request, call_next))
        self.assertEqual(response.status_code, 413)
        self.assertEqual(_body(response)["error"]["code"], "settings_request_too_large")
        self.assertFalse(called)

    def test_body_at_limit_is_cached_and_forwarded(self) -> None:
        payload = b"x" * (32 * 1024)
        request = _http_request(
            "PATCH",
            "/api/account/settings",
            headers={
                "content-type": "application/json; charset=UTF-8",
                "content-length": str(len(payload)),
            },
            chunks=[payload[:10_000], payload[10_000:]],
        )
        forwarded: list[bytes] = []

        async def call_next(next_request: Request) -> JSONResponse:
            forwarded.append(await next_request.body())
            return JSONResponse({"ok": True})

        response = asyncio.run(application._limit_chat_request_body(request, call_next))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(forwarded, [payload])


class AccountSettingsApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.store = AccountSettingsStore(Path(self.temp.name) / "settings.sqlite3")
        self.registry = AuthSessionRegistry(ttl_seconds=3_600, idle_ttl_seconds=3_600)
        self.store_patch = patch.object(application, "ACCOUNT_SETTINGS", self.store)
        self.registry_patch = patch.object(application, "AUTH_REGISTRY", self.registry)
        self.store_patch.start()
        self.registry_patch.start()
        self.handle, self.entry, _ = self.registry.create(_upstream_identity())

    def tearDown(self) -> None:
        self.registry.close_all()
        self.registry_patch.stop()
        self.store_patch.stop()
        self.temp.cleanup()

    @staticmethod
    def _patch_payload(
        changes: dict[str, Any], revision: int | None = None
    ) -> application.AccountSettingsPatchRequest:
        return application.AccountSettingsPatchRequest(
            changes=changes,
            revision=revision,
        )

    def test_get_and_patch_require_a_live_local_session(self) -> None:
        with patch.object(application, "fetch_upstream_settings") as fetch, patch.object(
            application, "apply_upstream_settings"
        ) as apply:
            get_response = asyncio.run(
                application.account_settings(
                    _http_request("GET", "/api/account/settings")
                )
            )
            patch_response = asyncio.run(
                application.patch_account_settings(
                    _http_request(
                        "PATCH",
                        "/api/account/settings",
                        headers={"origin": "http://127.0.0.1:8787"},
                    ),
                    self._patch_payload({"general": {"theme": "dark"}}, 0),
                )
            )

        for response in (get_response, patch_response):
            self.assertEqual(response.status_code, 401)
            body = _body(response)
            self.assertIs(body["authenticated"], False)
            self.assertEqual(body["error"]["code"], "authentication_required")
        fetch.assert_not_called()
        apply.assert_not_called()

    def test_stale_cookie_is_expired(self) -> None:
        stale = "stale-local-cookie"
        response = asyncio.run(
            application.account_settings(
                _http_request("GET", "/api/account/settings", handle=stale)
            )
        )
        self.assertEqual(response.status_code, 401)
        self.assertIn("Max-Age=0", response.headers.get("set-cookie", ""))

    def test_patch_rejects_cross_origin_and_cross_site_requests(self) -> None:
        requests = [
            _http_request(
                "PATCH",
                "/api/account/settings",
                handle=self.handle,
                headers={"origin": "https://attacker.example"},
            ),
            _http_request(
                "PATCH",
                "/api/account/settings",
                handle=self.handle,
                headers={"sec-fetch-site": "cross-site"},
            ),
        ]
        with patch.object(application, "apply_upstream_settings") as apply:
            for request in requests:
                response = asyncio.run(
                    application.patch_account_settings(
                        request,
                        self._patch_payload({"general": {"theme": "dark"}}, 0),
                    )
                )
                self.assertEqual(response.status_code, 403)
                self.assertEqual(_body(response)["error"]["code"], "origin_not_allowed")
        apply.assert_not_called()
        self.assertIs(self.registry.get(self.handle), self.entry)

    def test_get_returns_upstream_capabilities_and_partial_failure_warnings(self) -> None:
        capabilities = {
            "general.theme": {"source": "replica", "writable": True},
            "security.authenticatorApp": {
                "source": "flow",
                "writable": False,
                "reason": "interactive flow required",
            },
        }
        options = {
            "notifications": [{"id": "plugin:github", "label": "GitHub"}],
            "voices": [{"id": "ember", "label": "Ember"}],
        }
        warnings = [{"source": "notifications", "code": "setting_forbidden"}]

        def fetch(entry: object, base: dict[str, Any]) -> UpstreamSettingsSnapshot:
            self.assertIs(entry, self.entry)
            settings = copy.deepcopy(base)
            settings["general"]["accent"] = "blue"
            return UpstreamSettingsSnapshot(
                settings=settings,
                capabilities=capabilities,
                options=options,
                warnings=warnings,
            )

        with patch.object(application, "fetch_upstream_settings", side_effect=fetch):
            response = asyncio.run(
                application.account_settings(
                    _http_request("GET", "/api/account/settings", handle=self.handle)
                )
            )

        body = _body(response)
        self.assertEqual(response.status_code, 200)
        self.assertIs(body["authenticated"], True)
        self.assertEqual(body["user"]["id"], self.entry.account.id)
        self.assertEqual(body["settings"]["general"]["accent"], "blue")
        self.assertEqual(body["revision"], 0)
        self.assertEqual(body["capabilities"], capabilities)
        self.assertEqual(body["options"], options)
        self.assertEqual(body["warnings"], warnings)
        self.assertNotIn("test-settings-token", response.body.decode())

    def test_revision_conflict_is_reported_before_any_upstream_write(self) -> None:
        current = self.store.patch(
            self.entry.account.id,
            {"general": {"theme": "dark"}},
            expected_revision=0,
        )
        self.assertEqual(current.revision, 1)

        with patch.object(application, "apply_upstream_settings") as apply:
            response = asyncio.run(
                application.patch_account_settings(
                    _http_request(
                        "PATCH",
                        "/api/account/settings",
                        handle=self.handle,
                        headers={"origin": "http://127.0.0.1:8787"},
                    ),
                    self._patch_payload({"general": {"theme": "light"}}, 0),
                )
            )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(_body(response)["error"]["code"], "settings_revision_conflict")
        apply.assert_not_called()
        self.assertEqual(self.store.get(self.entry.account.id).revision, 1)

    def test_local_only_patch_is_persisted_without_opening_an_upstream_session(self) -> None:
        with patch.object(upstream_settings, "_new_http_session") as session_factory:
            response = asyncio.run(
                application.patch_account_settings(
                    _http_request(
                        "PATCH",
                        "/api/account/settings",
                        handle=self.handle,
                        headers={
                            "origin": "http://127.0.0.1:8787",
                            "sec-fetch-site": "same-origin",
                        },
                    ),
                    self._patch_payload({"general": {"theme": "dark"}}, 0),
                )
            )

        session_factory.assert_not_called()
        body = _body(response)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(body["settings"]["general"]["theme"], "dark")
        self.assertEqual(body["revision"], 1)
        persisted = self.store.get(self.entry.account.id)
        self.assertEqual(persisted.settings["general"]["theme"], "dark")
        self.assertEqual(persisted.revision, 1)

    def test_upstream_401_on_get_clears_registry_and_cookie(self) -> None:
        with patch.object(
            application,
            "fetch_upstream_settings",
            side_effect=AuthSessionError("invalid_session", "expired", status_code=401),
        ):
            response = asyncio.run(
                application.account_settings(
                    _http_request("GET", "/api/account/settings", handle=self.handle)
                )
            )

        body = _body(response)
        self.assertEqual(response.status_code, 401)
        self.assertIs(body["authenticated"], False)
        self.assertEqual(body["error"]["code"], "invalid_session")
        self.assertIn("Max-Age=0", response.headers.get("set-cookie", ""))
        self.assertIsNone(self.registry.get(self.handle))

    def test_upstream_401_on_patch_clears_registry_and_cookie(self) -> None:
        with patch.object(
            application,
            "apply_upstream_settings",
            side_effect=AuthSessionError("invalid_session", "expired", status_code=401),
        ):
            response = asyncio.run(
                application.patch_account_settings(
                    _http_request(
                        "PATCH",
                        "/api/account/settings",
                        handle=self.handle,
                        headers={"origin": "http://127.0.0.1:8787"},
                    ),
                    self._patch_payload({"general": {"theme": "dark"}}, 0),
                )
            )

        self.assertEqual(response.status_code, 401)
        self.assertIn("Max-Age=0", response.headers.get("set-cookie", ""))
        self.assertIsNone(self.registry.get(self.handle))

    def test_upstream_403_on_patch_preserves_registry_and_cookie(self) -> None:
        with patch.object(
            application,
            "apply_upstream_settings",
            side_effect=AuthSessionError(
                "setting_forbidden", "not entitled", status_code=403
            ),
        ):
            response = asyncio.run(
                application.patch_account_settings(
                    _http_request(
                        "PATCH",
                        "/api/account/settings",
                        handle=self.handle,
                        headers={"origin": "http://127.0.0.1:8787"},
                    ),
                    self._patch_payload({"general": {"accent": "blue"}}, 0),
                )
            )

        body = _body(response)
        self.assertEqual(response.status_code, 403)
        self.assertIs(body["authenticated"], True)
        self.assertEqual(body["error"]["code"], "setting_forbidden")
        self.assertNotIn("set-cookie", response.headers)
        self.assertIs(self.registry.get(self.handle), self.entry)


if __name__ == "__main__":
    unittest.main()
