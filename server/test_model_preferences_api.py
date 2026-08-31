from __future__ import annotations

import asyncio
import unittest
from unittest.mock import patch

from fastapi.responses import JSONResponse

from . import app as application
from .auth_session import AuthSessionError, AuthSessionRegistry
from .test_account_settings_api import _body, _http_request, _upstream_identity


class ChatModelPreferenceApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.registry = AuthSessionRegistry(ttl_seconds=3_600, idle_ttl_seconds=3_600)
        self.registry_patch = patch.object(application, "AUTH_REGISTRY", self.registry)
        self.registry_patch.start()
        self.handle, self.entry, _ = self.registry.create(
            _upstream_identity(suffix="-model-pref")
        )

    def tearDown(self) -> None:
        self.registry.close_all()
        self.registry_patch.stop()

    def test_get_returns_only_sanitized_preference(self) -> None:
        preference = {
            "modelSlug": "gpt-5-6-thinking",
            "thinkingEffort": "extended",
        }
        with patch.object(
            application, "read_chat_model_preference", return_value=preference
        ) as read:
            response = asyncio.run(
                application.account_model_preference(
                    _http_request(
                        "GET", "/api/account/model-preference", handle=self.handle
                    )
                )
            )
        body = _body(response)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(body["preference"], preference)
        self.assertNotIn("token", response.body.decode().lower())
        read.assert_called_once_with(self.entry)

    def test_patch_is_same_origin_and_uses_normal_chat_contract(self) -> None:
        payload = application.ChatModelPreferencePatchRequest(
            modelSlug="gpt-5-6-thinking", thinkingEffort="xhigh"
        )
        with patch.object(
            application,
            "write_chat_model_preference",
            return_value={"modelSlug": "gpt-5-6-thinking", "thinkingEffort": "xhigh"},
        ) as write:
            denied = asyncio.run(
                application.patch_account_model_preference(
                    _http_request(
                        "PATCH",
                        "/api/account/model-preference",
                        handle=self.handle,
                        headers={"sec-fetch-site": "cross-site"},
                    ),
                    payload,
                )
            )
            allowed = asyncio.run(
                application.patch_account_model_preference(
                    _http_request(
                        "PATCH",
                        "/api/account/model-preference",
                        handle=self.handle,
                        headers={"origin": "http://127.0.0.1:8787"},
                    ),
                    payload,
                )
            )
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(allowed.status_code, 200)
        write.assert_called_once_with(self.entry, "gpt-5-6-thinking", "xhigh")

    def test_401_expires_session_but_403_does_not(self) -> None:
        request = _http_request(
            "GET", "/api/account/model-preference", handle=self.handle
        )
        with patch.object(
            application,
            "read_chat_model_preference",
            side_effect=AuthSessionError("setting_forbidden", "locked", status_code=403),
        ):
            forbidden = asyncio.run(application.account_model_preference(request))
        self.assertEqual(forbidden.status_code, 403)
        self.assertIs(self.registry.get(self.handle), self.entry)

        with patch.object(
            application,
            "read_chat_model_preference",
            side_effect=AuthSessionError("invalid_session", "expired", status_code=401),
        ):
            expired = asyncio.run(
                application.account_model_preference(
                    _http_request(
                        "GET", "/api/account/model-preference", handle=self.handle
                    )
                )
            )
        self.assertEqual(expired.status_code, 401)
        self.assertIsNone(self.registry.get(self.handle))
        self.assertIn("Max-Age=0", expired.headers.get("set-cookie", ""))

    def test_model_patch_requires_json_at_request_boundary(self) -> None:
        request = _http_request(
            "PATCH",
            "/api/account/model-preference",
            headers={"content-type": "text/plain"},
            chunks=[b"{}"],
        )
        called = False

        async def call_next(_: object) -> JSONResponse:
            nonlocal called
            called = True
            return JSONResponse({"unexpected": True})

        response = asyncio.run(application._limit_chat_request_body(request, call_next))
        self.assertEqual(response.status_code, 415)
        self.assertFalse(called)


if __name__ == "__main__":
    unittest.main()
