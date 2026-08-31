from __future__ import annotations

import asyncio
import json
import os
import unittest
from unittest.mock import patch

from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request

from . import app as application
from . import __main__ as server_main


def _request(
    *,
    scheme: str = "http",
    host: str = "127.0.0.1:8787",
    origin: str | None = None,
    fetch_site: str | None = None,
) -> Request:
    headers: list[tuple[bytes, bytes]] = [(b"host", host.encode("ascii"))]
    if origin is not None:
        headers.append((b"origin", origin.encode("ascii")))
    if fetch_site is not None:
        headers.append((b"sec-fetch-site", fetch_site.encode("ascii")))
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": scheme,
            "path": "/api/auth/session-login",
            "raw_path": b"/api/auth/session-login",
            "query_string": b"",
            "headers": headers,
            "client": ("127.0.0.1", 49152),
            "server": ("127.0.0.1", 8787),
        }
    )


class DeploymentOriginTests(unittest.TestCase):
    def test_lan_vite_proxy_request_is_same_origin_without_allowlist(self) -> None:
        request = _request(
            host="192.168.1.25:5173",
            origin="http://192.168.1.25:5173",
            fetch_site="same-origin",
        )

        self.assertTrue(application._same_origin_write(request))

    def test_public_origin_handles_internal_reverse_proxy_host(self) -> None:
        request = _request(
            host="127.0.0.1:8787",
            origin="https://chat.example.test",
            fetch_site="same-origin",
        )

        with patch.object(
            application, "BRIDGE_PUBLIC_ORIGIN", "https://chat.example.test"
        ):
            self.assertTrue(application._same_origin_write(request))

    def test_exact_cross_origin_allowlist_can_enable_split_frontend(self) -> None:
        request = _request(
            scheme="https",
            host="api.example.test",
            origin="https://chat.example.test",
            fetch_site="same-site",
        )

        with patch.object(
            application,
            "BRIDGE_ALLOWED_ORIGIN_SET",
            frozenset({"https://chat.example.test"}),
        ):
            self.assertTrue(application._same_origin_write(request))

    def test_unlisted_cross_origin_is_rejected(self) -> None:
        request = _request(
            scheme="https",
            host="api.example.test",
            origin="https://attacker.example",
            fetch_site="cross-site",
        )

        self.assertFalse(application._same_origin_write(request))

    def test_cors_supports_credentialed_local_and_configured_origins(self) -> None:
        cors = next(
            middleware
            for middleware in application.app.user_middleware
            if middleware.cls is CORSMiddleware
        )

        self.assertTrue(cors.kwargs["allow_credentials"])
        self.assertIn("127\\.0\\.0\\.1", cors.kwargs["allow_origin_regex"])
        self.assertIn("\\[::1\\]", cors.kwargs["allow_origin_regex"])

    def test_origin_normalization_rejects_paths_and_credentials(self) -> None:
        self.assertEqual(
            application._normalize_web_origin("HTTPS://Example.TEST:443/"),
            "https://example.test",
        )
        with self.assertRaises(ValueError):
            application._normalize_web_origin("https://example.test/path")
        with self.assertRaises(ValueError):
            application._normalize_web_origin("https://user@example.test")


class DeploymentCookieTests(unittest.TestCase):
    def test_lan_http_cookie_is_usable_but_public_http_fails_closed(self) -> None:
        with patch.dict(os.environ, {"CHATGPT_AUTH_COOKIE_SECURE": "auto"}):
            self.assertFalse(
                application._cookie_secure(_request(host="192.168.1.25:5173"))
            )
            self.assertTrue(
                application._cookie_secure(_request(host="chat.example.test"))
            )

    def test_https_public_origin_forces_secure_behind_http_proxy(self) -> None:
        request = _request(host="127.0.0.1:8787")
        with (
            patch.object(
                application, "BRIDGE_PUBLIC_ORIGIN", "https://chat.example.test"
            ),
            patch.dict(os.environ, {"CHATGPT_AUTH_COOKIE_SECURE": "auto"}),
        ):
            self.assertTrue(application._cookie_secure(request))

    def test_samesite_none_always_forces_secure(self) -> None:
        request = _request(host="192.168.1.25:5173")
        with patch.dict(
            os.environ,
            {
                "CHATGPT_AUTH_COOKIE_SECURE": "auto",
                "CHATGPT_AUTH_COOKIE_SAMESITE": "none",
            },
        ):
            self.assertEqual(application._cookie_attributes(request), (True, "none"))

    def test_invalid_samesite_falls_back_to_strict(self) -> None:
        with patch.dict(os.environ, {"CHATGPT_AUTH_COOKIE_SAMESITE": "invalid"}):
            self.assertEqual(application._cookie_samesite(_request()), "strict")


class DeploymentProbeTests(unittest.TestCase):
    def test_liveness_does_not_depend_on_upstream_runtime(self) -> None:
        response = asyncio.run(application.health_live())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.body)["probe"], "liveness")
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_readiness_and_legacy_health_share_degraded_status(self) -> None:
        degraded = {"ready": False, "reason": "missing-runtime"}
        with (
            patch.object(application.BRIDGE, "dependency_status", return_value=degraded),
            patch.object(
                application.AUTH_BRIDGE, "dependency_status", return_value=degraded
            ),
        ):
            ready = asyncio.run(application.health_ready())
            legacy = asyncio.run(application.health())

        self.assertEqual(ready.status_code, 503)
        self.assertEqual(legacy.status_code, 503)
        self.assertEqual(json.loads(ready.body)["status"], "degraded")


class UvicornDeploymentConfigTests(unittest.TestCase):
    def test_defaults_bind_loopback_and_trust_only_local_proxy(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            options = server_main.uvicorn_options()

        self.assertEqual(options["host"], "127.0.0.1")
        self.assertEqual(options["port"], 8787)
        self.assertEqual(options["forwarded_allow_ips"], "127.0.0.1")
        self.assertTrue(options["proxy_headers"])
        self.assertEqual(options["workers"], 1)

    def test_lan_bind_and_trusted_reverse_proxy_are_configurable(self) -> None:
        with patch.dict(
            os.environ,
            {
                "CHATGPT_BRIDGE_HOST": "0.0.0.0",
                "CHATGPT_BRIDGE_PORT": "9876",
                "CHATGPT_BRIDGE_TRUSTED_PROXY_IPS": "10.0.0.10,10.0.0.11",
            },
            clear=True,
        ):
            options = server_main.uvicorn_options()

        self.assertEqual(options["host"], "0.0.0.0")
        self.assertEqual(options["port"], 9876)
        self.assertEqual(options["forwarded_allow_ips"], "10.0.0.10,10.0.0.11")

    def test_invalid_port_fails_fast(self) -> None:
        with patch.dict(os.environ, {"CHATGPT_BRIDGE_PORT": "70000"}):
            with self.assertRaises(ValueError):
                server_main.uvicorn_options()


if __name__ == "__main__":
    unittest.main()
