from __future__ import annotations

import asyncio
import base64
import hashlib
import http.client
import json
import threading
import time
import unittest
from dataclasses import replace
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from starlette.requests import Request

from . import app as application
from .auth_session import (
    AuthSessionError,
    AuthSessionRegistry,
    AuthenticatedUpstream,
    LocalAuthEntry,
    PublicAccount,
    UpstreamCredential,
)
from .provider_auth import ProviderLoginRegistry, login_flow_cookie_name


def _jwt(payload: dict[str, object]) -> str:
    encoded = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode("utf-8")
    ).rstrip(b"=")
    return f"header.{encoded.decode('ascii')}.signature"


def _request(
    *,
    method: str = "POST",
    origin: str = "http://127.0.0.1:5173",
    cookie: str | None = None,
) -> Request:
    headers: list[tuple[bytes, bytes]] = [
        (b"host", b"127.0.0.1:5173"),
        (b"origin", origin.encode("ascii")),
        (b"sec-fetch-site", b"same-origin"),
        (b"content-type", b"application/json"),
    ]
    if cookie:
        headers.append((b"cookie", cookie.encode("ascii")))
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": method,
            "scheme": "http",
            "path": "/api/auth/login/test/complete",
            "raw_path": b"/api/auth/login/test/complete",
            "query_string": b"",
            "headers": headers,
            "client": ("127.0.0.1", 49152),
            "server": ("127.0.0.1", 5173),
        }
    )


def _bound_request(started: object, *, method: str = "POST") -> Request:
    flow_id = getattr(started, "flow_id")
    binding = getattr(started, "binding")
    return _request(
        method=method,
        cookie=f"{login_flow_cookie_name(flow_id)}={binding}",
    )


def _upstream(*, account_id: str = "acct-plus") -> AuthenticatedUpstream:
    return AuthenticatedUpstream(
        account=PublicAccount(
            id=account_id,
            user_id="user-1",
            name="OAuth User",
            email="oauth@example.test",
            initials="OU",
            plan="plus",
            plan_label="Plus",
        ),
        credential=UpstreamCredential(
            kind="oauth_browser",
            access_token="access-secret",
            access_token_expires_at_epoch=None,
            cookie_header=None,
            account_id=account_id,
            user_id="user-1",
            refresh_token="refresh-secret",
        ),
        expires_at_epoch=None,
    )


class ProviderLoginRegistryTests(unittest.TestCase):
    def _registry(self, **kwargs: object) -> ProviderLoginRegistry:
        registry = ProviderLoginRegistry(**kwargs)
        registry.ensure_redirector = lambda: None  # type: ignore[method-assign]
        return registry

    def test_four_providers_build_real_pkce_authorization_urls(self) -> None:
        registry = self._registry()
        cases = (
            ("google", None, {"connection": ["google-oauth2"]}),
            ("apple", None, {"connection": ["apple"]}),
            ("email", "person@example.test", {"login_hint": ["person@example.test"]}),
            ("phone", "+12025550123", {"login_hint": ["+12025550123"]}),
        )
        challenges: set[str] = set()
        states: set[str] = set()
        for provider, hint, expected in cases:
            started = registry.start(
                provider,  # type: ignore[arg-type]
                callback_path="/",
                login_hint=hint,
                app_origin="http://127.0.0.1:5173",
            )
            parsed = urlsplit(started.authorization_url)
            query = parse_qs(parsed.query)
            self.assertEqual(parsed.scheme, "https")
            self.assertEqual(parsed.netloc, "auth.openai.com")
            self.assertEqual(parsed.path, "/oauth/authorize")
            self.assertEqual(query["client_id"], ["app_EMoamEEZ73f0CkXaXp7hrann"])
            self.assertEqual(query["redirect_uri"], ["http://localhost:1455/auth/callback"])
            self.assertEqual(query["code_challenge_method"], ["S256"])
            self.assertNotIn("code_verifier", query)
            self.assertNotIn(started.binding, started.authorization_url)
            self.assertNotIn(started.binding, repr(started))
            self.assertNotIn(started.binding, json.dumps(started.as_dict()))
            for key, value in expected.items():
                self.assertEqual(query[key], value)
            if provider == "phone":
                self.assertEqual(query["ext-login-allow-phone"], ["true"])
            challenges.add(query["code_challenge"][0])
            states.add(query["state"][0])
            flow_key = hashlib.sha256(started.flow_id.encode("utf-8")).hexdigest()
            flow = registry._flows[flow_key]
            expected_challenge = base64.urlsafe_b64encode(
                hashlib.sha256(flow.code_verifier.encode("ascii")).digest()
            ).rstrip(b"=").decode("ascii")
            self.assertEqual(query["code_challenge"], [expected_challenge])
        self.assertEqual(len(challenges), 4)
        self.assertEqual(len(states), 4)

    def test_email_and_phone_hints_are_provider_validated(self) -> None:
        registry = self._registry()
        invalid = (
            ("email", None),
            ("email", "not-an-email"),
            ("phone", "13800138000"),
            ("phone", "+0123"),
        )
        for provider, hint in invalid:
            with self.subTest(provider=provider, hint=hint):
                with self.assertRaises(AuthSessionError) as caught:
                    registry.start(
                        provider,  # type: ignore[arg-type]
                        callback_path="/",
                        login_hint=hint,
                    )
                self.assertEqual(caught.exception.code, "oauth_login_hint_invalid")

    def test_callback_code_is_one_time_and_never_appears_in_repr(self) -> None:
        registry = self._registry()
        started = registry.start("google", callback_path="/")
        state = parse_qs(urlsplit(started.authorization_url).query)["state"][0]
        registry.receive_callback(state, "one-time-code-secret")
        with self.assertRaises(AuthSessionError) as replayed:
            registry.receive_callback(state, "replay-code")
        self.assertEqual(replayed.exception.code, "oauth_state_invalid")

        first = registry.claim_callback(started.flow_id)
        second = registry.claim_callback(started.flow_id)
        self.assertIsNotNone(first)
        self.assertIsNone(second)
        assert first is not None
        self.assertEqual(first.authorization_code, "one-time-code-secret")
        rendered = repr(first)
        self.assertNotIn("one-time-code-secret", rendered)
        self.assertNotIn(first.grant.code_verifier, rendered)

    def test_concurrent_complete_claims_exchange_only_once(self) -> None:
        registry = self._registry()
        started = registry.start("google", callback_path="/")
        state = parse_qs(urlsplit(started.authorization_url).query)["state"][0]
        registry.receive_callback(state, "concurrent-secret")
        barrier = threading.Barrier(3)
        claims: list[object] = []

        def claim() -> None:
            barrier.wait()
            claims.append(registry.claim_callback(started.flow_id))

        threads = [threading.Thread(target=claim), threading.Thread(target=claim)]
        for thread in threads:
            thread.start()
        barrier.wait()
        for thread in threads:
            thread.join()
        self.assertEqual(sum(item is not None for item in claims), 1)

    def test_cancelled_and_expired_states_reject_callback(self) -> None:
        registry = self._registry(ttl_seconds=10)
        cancelled = registry.start("google", callback_path="/")
        cancelled_state = parse_qs(urlsplit(cancelled.authorization_url).query)["state"][0]
        registry.cancel(cancelled.flow_id)
        with self.assertRaises(AuthSessionError):
            registry.receive_callback(cancelled_state, "code")

        with patch("server.provider_auth.time.time", return_value=100.0):
            expired = registry.start("google", callback_path="/")
        expired_state = parse_qs(urlsplit(expired.authorization_url).query)["state"][0]
        with patch("server.provider_auth.time.time", return_value=111.0):
            with self.assertRaises(AuthSessionError):
                registry.receive_callback(expired_state, "code")

    def test_registry_evicts_oldest_flow_at_fixed_bound(self) -> None:
        registry = self._registry(max_entries=2)
        first = registry.start("google", callback_path="/")
        registry.start("apple", callback_path="/")
        registry.start("google", callback_path="/")
        self.assertEqual(registry.count(), 2)
        with self.assertRaises(AuthSessionError) as caught:
            registry.status(first.flow_id)
        self.assertEqual(caught.exception.code, "oauth_flow_not_found")

    def test_exchanging_flow_can_be_cancelled_and_cannot_finish(self) -> None:
        registry = self._registry()
        started = registry.start("google", callback_path="/")
        state = parse_qs(urlsplit(started.authorization_url).query)["state"][0]
        registry.receive_callback(state, "code")
        claim = registry.claim_callback(started.flow_id)
        self.assertIsNotNone(claim)
        self.assertIsNone(registry.cancel(started.flow_id))
        assert claim is not None
        with self.assertRaises(AuthSessionError) as caught:
            registry.finish_success(
                claim.grant,
                application.ProviderLoginCompletion(
                    handle="opaque-handle",
                    provider="google",
                    user={},
                    max_age=60,
                    callback_path="/",
                ),
            )
        self.assertEqual(caught.exception.code, "oauth_flow_expired")


class LoopbackRedirectorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.registry = ProviderLoginRegistry(
            redirect_port=0,
            forward_origin="http://localhost:5173",
        )
        self.registry.ensure_redirector()
        server = self.registry._redirect_server
        assert server is not None
        self.port = int(server.server_address[1])

    def tearDown(self) -> None:
        self.registry.close()

    def _get(self, path: str, *, host: str | None = None) -> tuple[int, dict[str, str]]:
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        connection.request(
            "GET",
            path,
            headers={"Host": host or f"localhost:{self.port}"},
        )
        response = connection.getresponse()
        response.read()
        headers = {key.lower(): value for key, value in response.getheaders()}
        status = response.status
        connection.close()
        return status, headers

    def test_host_path_query_and_replay_are_restricted_without_code_forwarding(self) -> None:
        self.assertEqual(self._get("/wrong")[0], 404)
        self.assertEqual(
            self._get("/auth/callback?state=x&code=y", host="evil.example")[0],
            404,
        )
        oversized = "/auth/callback?state=x&code=" + ("a" * 17_000)
        self.assertEqual(self._get(oversized)[0], 404)

        started = self.registry.start(
            "google",
            callback_path="/plugins?view=all",
            app_origin="http://127.0.0.1:5173",
        )
        state = parse_qs(urlsplit(started.authorization_url).query)["state"][0]
        secret_code = "callback-code-must-not-be-forwarded"
        status, headers = self._get(
            f"/auth/callback?state={state}&code={secret_code}"
        )
        self.assertEqual(status, 302)
        location = headers["location"]
        self.assertTrue(location.startswith("http://127.0.0.1:5173/plugins?"))
        self.assertIn("auth=processing", location)
        self.assertNotIn(secret_code, location)
        self.assertNotIn(state, location)

        replay_status, replay_headers = self._get(
            f"/auth/callback?state={state}&code=replay"
        )
        self.assertEqual(replay_status, 302)
        self.assertIn("code=oauth_state_invalid", replay_headers["location"])

        denied = self.registry.start("apple", callback_path="/")
        denied_state = parse_qs(urlsplit(denied.authorization_url).query)["state"][0]
        description = "sensitive-provider-description"
        denied_status, denied_headers = self._get(
            f"/auth/callback?state={denied_state}&error=access_denied"
            f"&error_description={description}"
        )
        self.assertEqual(denied_status, 302)
        self.assertIn("code=oauth_access_denied", denied_headers["location"])
        self.assertNotIn(description, denied_headers["location"])


class ProviderLoginApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.registry = ProviderLoginRegistry()
        self.registry.ensure_redirector = lambda: None  # type: ignore[method-assign]
        self.auth_registry = AuthSessionRegistry(ttl_seconds=600, idle_ttl_seconds=600)
        self.patches = (
            patch.object(application, "PROVIDER_LOGINS", self.registry),
            patch.object(application, "AUTH_REGISTRY", self.auth_registry),
        )
        for active in self.patches:
            active.start()

    def tearDown(self) -> None:
        for active in reversed(self.patches):
            active.stop()
        self.auth_registry.close_all()

    def test_complete_sets_only_opaque_http_only_local_cookie(self) -> None:
        started = self.registry.start(
            "email",
            callback_path="/images",
            login_hint="person@example.test",
            app_origin="http://127.0.0.1:5173",
        )
        state = parse_qs(urlsplit(started.authorization_url).query)["state"][0]
        self.registry.receive_callback(state, "authorization-code-secret")
        with patch.object(
            application,
            "exchange_oauth_authorization_code",
            return_value=_upstream(),
        ) as exchange:
            response = asyncio.run(
                application.provider_login_complete(
                    _bound_request(started),
                    started.flow_id,
                    application.ProviderLoginCompleteRequest(),
                )
            )
        self.assertEqual(response.status_code, 200)
        body = json.loads(response.body)
        self.assertEqual(body["status"], "authenticated")
        self.assertEqual(body["provider"], "email")
        self.assertEqual(body["callbackPath"], "/images")
        cookie = response.headers.get("set-cookie", "")
        self.assertIn("replica_account_session=", cookie)
        self.assertIn("HttpOnly", cookie)
        self.assertIn("Path=/api", cookie)
        self.assertNotIn("authorization-code-secret", cookie)
        self.assertNotIn("access-secret", response.body.decode("utf-8"))
        self.assertNotIn("refresh-secret", repr(_upstream().credential))
        exchange.assert_called_once()

    def test_start_and_cancel_enforce_origin(self) -> None:
        start_request = application.ProviderLoginStartRequest(
            provider="google",
            callbackPath="/",
        )
        rejected = asyncio.run(
            application.provider_login_start(
                _request(origin="https://evil.example"),
                start_request,
            )
        )
        self.assertEqual(rejected.status_code, 403)
        self.assertEqual(self.registry.count(), 0)

        accepted = asyncio.run(
            application.provider_login_start(_request(), start_request)
        )
        self.assertEqual(accepted.status_code, 201)
        flow_id = json.loads(accepted.body)["flowId"]
        flow_cookie_header = accepted.headers["set-cookie"]
        flow_cookie_pair = flow_cookie_header.split(";", 1)[0]
        self.assertIn(login_flow_cookie_name(flow_id), flow_cookie_header)
        self.assertIn("HttpOnly", flow_cookie_header)
        self.assertIn(f"Path=/api/auth/login/{flow_id}", flow_cookie_header)
        missing_status = asyncio.run(
            application.provider_login_status(_request(method="GET"), flow_id)
        )
        self.assertEqual(missing_status.status_code, 403)
        rejected_cancel = asyncio.run(
            application.provider_login_cancel(
                _request(method="DELETE", origin="https://evil.example"),
                flow_id,
            )
        )
        self.assertEqual(rejected_cancel.status_code, 403)
        self.assertEqual(self.registry.count(), 1)
        missing_cancel = asyncio.run(
            application.provider_login_cancel(_request(method="DELETE"), flow_id)
        )
        self.assertEqual(missing_cancel.status_code, 403)
        cancelled = asyncio.run(
            application.provider_login_cancel(
                _request(method="DELETE", cookie=flow_cookie_pair), flow_id
            )
        )
        self.assertEqual(cancelled.status_code, 200)
        self.assertIn("Max-Age=0", cancelled.headers.get("set-cookie", ""))

    def test_success_consumes_flow_and_replay_cannot_recover_account_handle(self) -> None:
        started = self.registry.start("google", callback_path="/")
        state = parse_qs(urlsplit(started.authorization_url).query)["state"][0]
        self.registry.receive_callback(state, "code")
        with patch.object(
            application,
            "exchange_oauth_authorization_code",
            return_value=_upstream(),
        ) as exchange:
            first = asyncio.run(
                application.provider_login_complete(
                    _bound_request(started),
                    started.flow_id,
                    application.ProviderLoginCompleteRequest(),
                )
            )
            second = asyncio.run(
                application.provider_login_complete(
                    _bound_request(started),
                    started.flow_id,
                    application.ProviderLoginCompleteRequest(),
                )
            )
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 404)
        self.assertNotIn("set-cookie", second.headers)
        self.assertEqual(self.auth_registry.count(), 1)
        exchange.assert_called_once()

    def test_exchange_failure_is_terminal_and_never_sets_cookie(self) -> None:
        started = self.registry.start("google", callback_path="/")
        state = parse_qs(urlsplit(started.authorization_url).query)["state"][0]
        self.registry.receive_callback(state, "bad-code")
        failure = AuthSessionError(
            "oauth_grant_invalid",
            "官方登录授权无效或已过期，请重新登录。",
            status_code=401,
        )
        with patch.object(
            application,
            "exchange_oauth_authorization_code",
            side_effect=failure,
        ) as exchange:
            first = asyncio.run(
                application.provider_login_complete(
                    _bound_request(started),
                    started.flow_id,
                    application.ProviderLoginCompleteRequest(),
                )
            )
            second = asyncio.run(
                application.provider_login_complete(
                    _bound_request(started),
                    started.flow_id,
                    application.ProviderLoginCompleteRequest(),
                )
            )
        self.assertEqual(first.status_code, 401)
        self.assertEqual(second.status_code, 400)
        self.assertNotIn("set-cookie", first.headers)
        self.assertEqual(json.loads(second.body)["status"], "failed")
        exchange.assert_called_once()

    def test_pending_complete_does_not_set_cookie_or_exchange(self) -> None:
        started = self.registry.start("google", callback_path="/")
        with patch.object(application, "exchange_oauth_authorization_code") as exchange:
            response = asyncio.run(
                application.provider_login_complete(
                    _bound_request(started),
                    started.flow_id,
                    application.ProviderLoginCompleteRequest(),
                )
            )
        self.assertEqual(response.status_code, 202)
        self.assertNotIn("set-cookie", response.headers)
        exchange.assert_not_called()

    def test_cross_origin_complete_is_rejected_before_exchange(self) -> None:
        started = self.registry.start("google", callback_path="/")
        with patch.object(application, "exchange_oauth_authorization_code") as exchange:
            response = asyncio.run(
                application.provider_login_complete(
                    _request(origin="https://evil.example"),
                    started.flow_id,
                    application.ProviderLoginCompleteRequest(),
                )
            )
        self.assertEqual(response.status_code, 403)
        exchange.assert_not_called()

    def test_missing_or_wrong_flow_binding_rejects_status_complete_and_cancel(self) -> None:
        started = self.registry.start("google", callback_path="/")
        wrong_cookie = (
            f"{login_flow_cookie_name(started.flow_id)}=wrong-browser-binding"
        )
        for cookie in (None, wrong_cookie):
            with self.subTest(cookie=bool(cookie)):
                request = _request(cookie=cookie)
                status = asyncio.run(
                    application.provider_login_status(request, started.flow_id)
                )
                self.assertEqual(status.status_code, 403)
                with patch.object(
                    application, "exchange_oauth_authorization_code"
                ) as exchange:
                    complete = asyncio.run(
                        application.provider_login_complete(
                            _request(cookie=cookie),
                            started.flow_id,
                            application.ProviderLoginCompleteRequest(),
                        )
                    )
                self.assertEqual(complete.status_code, 403)
                exchange.assert_not_called()
                cancel = asyncio.run(
                    application.provider_login_cancel(
                        _request(method="DELETE", cookie=cookie),
                        started.flow_id,
                    )
                )
                self.assertEqual(cancel.status_code, 403)
        self.assertEqual(self.registry.count(), 1)

    def test_cancel_during_exchange_rolls_back_handle_and_never_sets_cookie(self) -> None:
        started = self.registry.start("google", callback_path="/")
        state = parse_qs(urlsplit(started.authorization_url).query)["state"][0]
        self.registry.receive_callback(state, "race-code")
        entered = threading.Event()
        release = threading.Event()
        responses: list[object] = []

        def exchange(*_args: object, **_kwargs: object) -> AuthenticatedUpstream:
            entered.set()
            self.assertTrue(release.wait(timeout=3))
            return _upstream()

        def complete() -> None:
            responses.append(
                asyncio.run(
                    application.provider_login_complete(
                        _bound_request(started),
                        started.flow_id,
                        application.ProviderLoginCompleteRequest(),
                    )
                )
            )

        with patch.object(
            application, "exchange_oauth_authorization_code", side_effect=exchange
        ):
            thread = threading.Thread(target=complete)
            thread.start()
            self.assertTrue(entered.wait(timeout=3))
            cancelled = asyncio.run(
                application.provider_login_cancel(
                    _bound_request(started, method="DELETE"), started.flow_id
                )
            )
            release.set()
            thread.join(timeout=3)

        self.assertEqual(cancelled.status_code, 200)
        self.assertEqual(len(responses), 1)
        response = responses[0]
        self.assertNotEqual(response.status_code, 200)  # type: ignore[attr-defined]
        self.assertNotIn("set-cookie", response.headers)  # type: ignore[attr-defined]
        self.assertEqual(self.auth_registry.count(), 0)

    def test_success_sets_account_cookie_and_expires_only_its_flow_binding(self) -> None:
        started = self.registry.start("google", callback_path="/")
        state = parse_qs(urlsplit(started.authorization_url).query)["state"][0]
        self.registry.receive_callback(state, "code")
        with patch.object(
            application,
            "exchange_oauth_authorization_code",
            return_value=_upstream(),
        ):
            completed = asyncio.run(
                application.provider_login_complete(
                    _bound_request(started),
                    started.flow_id,
                    application.ProviderLoginCompleteRequest(),
                )
            )
        cookies = [
            value.decode("latin-1")
            for key, value in completed.raw_headers
            if key.lower() == b"set-cookie"
        ]
        self.assertTrue(any("replica_account_session=" in item for item in cookies))
        flow_name = login_flow_cookie_name(started.flow_id)
        self.assertTrue(
            any(flow_name in item and "Max-Age=0" in item for item in cookies)
        )
        self.assertEqual(self.auth_registry.count(), 1)
        replay_cancel = asyncio.run(
            application.provider_login_cancel(
                _bound_request(started, method="DELETE"), started.flow_id
            )
        )
        self.assertEqual(replay_cancel.status_code, 404)

    def test_two_flows_use_independent_binding_cookies(self) -> None:
        first = self.registry.start("google", callback_path="/")
        second = self.registry.start("apple", callback_path="/")
        self.registry.verify_binding(first.flow_id, first.binding)
        self.registry.verify_binding(second.flow_id, second.binding)
        first_state = parse_qs(urlsplit(first.authorization_url).query)["state"][0]
        self.registry.receive_callback(first_state, "first-code")
        with patch.object(
            application,
            "exchange_oauth_authorization_code",
            return_value=_upstream(),
        ):
            completed = asyncio.run(
                application.provider_login_complete(
                    _bound_request(first),
                    first.flow_id,
                    application.ProviderLoginCompleteRequest(),
                )
            )
        self.assertEqual(completed.status_code, 200)
        pending = asyncio.run(
            application.provider_login_complete(
                _bound_request(second),
                second.flow_id,
                application.ProviderLoginCompleteRequest(),
            )
        )
        self.assertEqual(pending.status_code, 202)


class OAuthAccountSelectionTests(unittest.TestCase):
    def test_id_token_selected_account_is_passed_to_strict_upstream_verification(self) -> None:
        from . import auth_session

        selected = "acct-selected"
        id_token = _jwt(
            {
                "https://api.openai.com/auth": {
                    "chatgpt_account_id": selected,
                    "chatgpt_plan_type": "pro",
                }
            }
        )
        verified = _upstream(account_id=selected)
        with patch.object(
            auth_session, "_verify_access_token", return_value=verified
        ) as verify:
            result = auth_session.authenticate_oauth_tokens(
                "access-token",
                "refresh-token",
                id_token=id_token,
            )
        session_payload = verify.call_args.args[1]
        self.assertEqual(session_payload["account"]["id"], selected)
        self.assertEqual(session_payload["account"]["planType"], "pro")
        self.assertEqual(result.account.id, selected)
        self.assertEqual(result.credential.kind, "oauth_browser")
        self.assertIsNone(result.expires_at_epoch)

    def test_oauth_refresh_preserves_selected_account_when_id_token_is_absent(self) -> None:
        from . import auth_session

        selected = "acct-workspace-selected"
        current = _upstream(account_id=selected)
        entry = LocalAuthEntry(
            account=current.account,
            credential=replace(
                current.credential,
                access_token="expired-access",
                refresh_token="current-refresh",
            ),
            created_at_epoch=time.time(),
            absolute_expires_at_epoch=time.time() + 600,
            last_access_monotonic=time.monotonic(),
            lock=threading.RLock(),
        )
        refreshed = _upstream(account_id=selected)
        with (
            patch.object(
                auth_session,
                "_oauth_token_request",
                return_value={
                    "access_token": "new-access",
                    "refresh_token": "new-refresh",
                },
            ),
            patch.object(
                auth_session,
                "authenticate_oauth_tokens",
                return_value=refreshed,
            ) as authenticate,
        ):
            credential = auth_session.refresh_local_auth_entry(entry)
        self.assertEqual(credential.account_id, selected)
        self.assertEqual(
            authenticate.call_args.kwargs["preferred_account_id"], selected
        )


if __name__ == "__main__":
    unittest.main()
