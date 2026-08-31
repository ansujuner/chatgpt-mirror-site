from __future__ import annotations

import asyncio
import base64
import json
import time
import unittest
from unittest.mock import patch

from starlette.requests import Request

from . import app as application
from .auth_session import (
    AuthSessionError,
    AuthSessionRegistry,
    AuthenticatedUpstream,
    PublicAccount,
    UpstreamCredential,
)
from .authenticated_protocol import (
    AuthenticatedChatResult,
    AuthenticatedProtocolError,
    AuthenticatedProtocolSession,
)


def _request_with_cookie(handle: str) -> Request:
    cookie = f"{application.LOCAL_SESSION_COOKIE}={handle}".encode("ascii")
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/api/chat/completions",
            "raw_path": b"/api/chat/completions",
            "query_string": b"",
            "headers": [(b"host", b"127.0.0.1:8787"), (b"cookie", cookie)],
            "client": ("127.0.0.1", 49152),
            "server": ("127.0.0.1", 8787),
        }
    )


def _usage_request(handle: str | None = None) -> Request:
    headers = [(b"host", b"127.0.0.1:8787")]
    if handle is not None:
        headers.append(
            (b"cookie", f"{application.LOCAL_SESSION_COOKIE}={handle}".encode("ascii"))
        )
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": "/api/codex/analytics",
            "raw_path": b"/api/codex/analytics",
            "query_string": b"",
            "headers": headers,
            "client": ("127.0.0.1", 49152),
            "server": ("127.0.0.1", 8787),
        }
    )


def _reset_consume_request(
    handle: str | None,
    payload: dict[str, object],
    *,
    origin: str = "http://127.0.0.1:8787",
    content_length: int | None = None,
) -> Request:
    body = json.dumps(payload).encode("utf-8")
    sent = False

    async def receive():  # type: ignore[no-untyped-def]
        nonlocal sent
        if sent:
            return {"type": "http.request", "body": b"", "more_body": False}
        sent = True
        return {"type": "http.request", "body": body, "more_body": False}

    headers = [
        (b"host", b"127.0.0.1:8787"),
        (b"content-type", b"application/json"),
        (b"content-length", str(content_length if content_length is not None else len(body)).encode("ascii")),
        (b"origin", origin.encode("ascii")),
        (b"sec-fetch-site", b"same-origin" if origin == "http://127.0.0.1:8787" else b"cross-site"),
    ]
    if handle is not None:
        headers.append(
            (b"cookie", f"{application.LOCAL_SESSION_COOKIE}={handle}".encode("ascii"))
        )
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/api/codex/reset-credits/consume",
            "raw_path": b"/api/codex/reset-credits/consume",
            "query_string": b"",
            "headers": headers,
            "client": ("127.0.0.1", 49152),
            "server": ("127.0.0.1", 8787),
        },
        receive,
    )


def _request_without_cookie() -> Request:
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/api/chat/completions",
            "raw_path": b"/api/chat/completions",
            "query_string": b"",
            "headers": [(b"host", b"127.0.0.1:8787")],
            "client": ("127.0.0.1", 49152),
            "server": ("127.0.0.1", 8787),
        }
    )


def _data_url(mime_type: str, payload: bytes) -> str:
    return f"data:{mime_type};base64,{base64.b64encode(payload).decode('ascii')}"


def _streaming_request(chunks: list[bytes]) -> Request:
    pending = list(chunks)

    async def receive():  # type: ignore[no-untyped-def]
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
            "method": "POST",
            "scheme": "http",
            "path": "/api/auth/session-login",
            "raw_path": b"/api/auth/session-login",
            "query_string": b"",
            "headers": [(b"host", b"127.0.0.1:8787"), (b"content-type", b"application/json")],
            "client": ("127.0.0.1", 49152),
            "server": ("127.0.0.1", 8787),
        },
        receive,
    )


def _session_login_request(
    payload: object,
    *,
    origin: str = "http://127.0.0.1:8787",
    content_type: str = "application/json",
    cookie: str | None = None,
) -> Request:
    body = json.dumps(payload).encode("utf-8")
    sent = False

    async def receive():  # type: ignore[no-untyped-def]
        nonlocal sent
        if sent:
            return {"type": "http.request", "body": b"", "more_body": False}
        sent = True
        return {"type": "http.request", "body": body, "more_body": False}

    headers = [
        (b"host", b"127.0.0.1:8787"),
        (b"content-type", content_type.encode("ascii")),
        (b"content-length", str(len(body)).encode("ascii")),
        (b"origin", origin.encode("ascii")),
        (
            b"sec-fetch-site",
            b"same-origin" if origin == "http://127.0.0.1:8787" else b"cross-site",
        ),
    ]
    if cookie:
        headers.append((b"cookie", cookie.encode("ascii")))
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/api/auth/session-login",
            "raw_path": b"/api/auth/session-login",
            "query_string": b"",
            "headers": headers,
            "client": ("127.0.0.1", 49152),
            "server": ("127.0.0.1", 8787),
        },
        receive,
    )


def _session_login_upstream() -> AuthenticatedUpstream:
    return AuthenticatedUpstream(
        account=PublicAccount(
            id="acct-session-plus",
            user_id="user-session",
            name="Session User",
            email="session@example.test",
            initials="SU",
            plan="plus",
            plan_label="Plus",
        ),
        credential=UpstreamCredential(
            kind="access_token",
            access_token="verified-access-secret",
            access_token_expires_at_epoch=None,
            cookie_header=None,
            account_id="acct-session-plus",
            user_id="user-session",
        ),
        expires_at_epoch=None,
    )


class LoginPayloadLimitTests(unittest.TestCase):
    def test_streamed_login_body_is_rejected_at_hard_limit(self) -> None:
        request = _streaming_request([b"x" * 40_000, b"y" * 30_000])
        with self.assertRaises(AuthSessionError) as caught:
            asyncio.run(application._login_payload(request))
        self.assertEqual(caught.exception.code, "session_input_too_large")
        self.assertEqual(caught.exception.status_code, 413)


class SessionLoginApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.registry = AuthSessionRegistry(ttl_seconds=600, idle_ttl_seconds=600)
        self.registry_patch = patch.object(application, "AUTH_REGISTRY", self.registry)
        self.registry_patch.start()

    def tearDown(self) -> None:
        self.registry_patch.stop()
        self.registry.close_all()

    def test_verified_session_sets_only_opaque_http_only_cookie_and_hydrates(self) -> None:
        raw_session = "Bearer pasted-session-secret-value"
        with patch.object(
            application,
            "authenticate_session_input",
            return_value=_session_login_upstream(),
        ) as authenticate:
            response = asyncio.run(
                application.session_login(
                    _session_login_request({"session": raw_session})
                )
            )

        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.body)
        self.assertTrue(payload["authenticated"])
        self.assertEqual(payload["user"]["plan"], "plus")
        cookie = response.headers.get("set-cookie", "")
        self.assertIn(f"{application.LOCAL_SESSION_COOKIE}=", cookie)
        self.assertIn("HttpOnly", cookie)
        self.assertIn("Path=/api", cookie)
        self.assertIn("SameSite=strict", cookie)
        self.assertNotIn(raw_session, cookie)
        self.assertNotIn(raw_session, response.body.decode("utf-8"))
        authenticate.assert_called_once_with(raw_session)

        handle = cookie.split(";", 1)[0].split("=", 1)[1]
        hydrated = asyncio.run(application.local_auth_session(_request_with_cookie(handle)))
        hydrated_payload = json.loads(hydrated.body)
        self.assertTrue(hydrated_payload["authenticated"])
        self.assertEqual(hydrated_payload["user"]["id"], "acct-session-plus")

    def test_cross_origin_session_login_is_rejected_before_validation(self) -> None:
        with patch.object(application, "authenticate_session_input") as authenticate:
            response = asyncio.run(
                application.session_login(
                    _session_login_request(
                        {"session": "Bearer never-validate-this-secret"},
                        origin="https://attacker.example",
                    )
                )
            )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(json.loads(response.body)["error"]["code"], "origin_not_allowed")
        authenticate.assert_not_called()

    def test_session_login_rejects_wrong_content_type_and_extra_fields(self) -> None:
        cases = (
            (
                _session_login_request(
                    {"session": "Bearer ignored-secret-value"},
                    content_type="text/plain",
                ),
                415,
                "content_type_required",
            ),
            (
                _session_login_request(
                    {"session": "Bearer ignored-secret-value", "extra": True}
                ),
                400,
                "invalid_session_input",
            ),
        )
        with patch.object(application, "authenticate_session_input") as authenticate:
            for request, expected_status, expected_code in cases:
                with self.subTest(expected_code):
                    response = asyncio.run(application.session_login(request))
                    self.assertEqual(response.status_code, expected_status)
                    self.assertEqual(
                        json.loads(response.body)["error"]["code"], expected_code
                    )
            authenticate.assert_not_called()


class AttachmentBoundaryTests(unittest.TestCase):
    def test_chat_body_limit_rejects_content_length_before_routing(self) -> None:
        request = Request(
            {
                "type": "http",
                "http_version": "1.1",
                "method": "POST",
                "scheme": "http",
                "path": "/api/chat/completions",
                "raw_path": b"/api/chat/completions",
                "query_string": b"",
                "headers": [(b"host", b"127.0.0.1"), (b"content-length", b"999")],
                "client": ("127.0.0.1", 1),
                "server": ("127.0.0.1", 8787),
            }
        )
        called = False

        async def call_next(_: Request):
            nonlocal called
            called = True
            raise AssertionError("router must not receive an oversized request")

        with patch.object(application, "MAX_CHAT_REQUEST_BYTES", 10):
            response = asyncio.run(application._limit_chat_request_body(request, call_next))
        self.assertEqual(response.status_code, 413)
        self.assertFalse(called)
        self.assertEqual(json.loads(response.body)["error"]["code"], "chat_request_too_large")

    def test_image_and_regular_file_parts_are_strictly_decoded(self) -> None:
        request = application.ChatCompletionRequest(
            messages=[
                application.ChatMessage(
                    role="user",
                    content=[
                        {"type": "text", "text": "inspect"},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": _data_url("image/png", b"png-bytes"),
                                "filename": "photo.png",
                                "width": 640,
                                "height": 480,
                            },
                        },
                        {
                            "type": "file",
                            "file": {
                                "filename": "notes.txt",
                                "file_data": _data_url("text/plain", b"notes"),
                            },
                        },
                    ],
                )
            ]
        )
        parsed = application._latest_user_input(request)
        self.assertEqual(parsed.prompt, "inspect")
        self.assertEqual(len(parsed.attachments), 2)
        self.assertEqual(parsed.attachments[0].file_name, "photo.png")
        self.assertEqual(parsed.attachments[0].file_bytes, b"png-bytes")
        self.assertEqual((parsed.attachments[0].width, parsed.attachments[0].height), (640, 480))
        self.assertEqual(parsed.attachments[1].mime_type, "text/plain")
        self.assertEqual(parsed.attachments[1].file_bytes, b"notes")

    def test_non_data_url_and_missing_image_dimensions_are_rejected(self) -> None:
        for image_payload in (
            {"url": "https://example.test/private.png", "filename": "x.png", "width": 1, "height": 1},
            {"url": _data_url("image/png", b"x"), "filename": "x.png"},
        ):
            request = application.ChatCompletionRequest(
                messages=[
                    application.ChatMessage(
                        role="user",
                        content=[{"type": "image_url", "image_url": image_payload}],
                    )
                ]
            )
            with self.assertRaises(application.ProtocolError) as caught:
                application._latest_user_input(request)
            self.assertEqual(caught.exception.stage, "validation")

    def test_per_file_and_total_decoded_size_limits_are_enforced(self) -> None:
        single = application.ChatCompletionRequest(
            messages=[
                application.ChatMessage(
                    role="user",
                    content=[{
                        "type": "file",
                        "file": {"filename": "x.bin", "file_data": _data_url("application/octet-stream", b"abc")},
                    }],
                )
            ]
        )
        with patch.object(application, "MAX_ATTACHMENT_FILE_BYTES", 2):
            with self.assertRaises(application.ProtocolError) as caught:
                application._latest_user_input(single)
        self.assertEqual(caught.exception.code, "attachment_file_too_large")

        combined = application.ChatCompletionRequest(
            messages=[
                application.ChatMessage(
                    role="user",
                    content=[
                        {"type": "file", "file": {"filename": "a.bin", "file_data": _data_url("application/octet-stream", b"ab")}},
                        {"type": "file", "file": {"filename": "b.bin", "file_data": _data_url("application/octet-stream", b"cd")}},
                    ],
                )
            ]
        )
        with patch.object(application, "MAX_ATTACHMENT_TOTAL_BYTES", 3):
            with self.assertRaises(application.ProtocolError) as caught:
                application._latest_user_input(combined)
        self.assertEqual(caught.exception.code, "attachments_too_large")

    def test_guest_attachment_is_rejected_without_guest_execution(self) -> None:
        request = application.ChatCompletionRequest(
            messages=[
                application.ChatMessage(
                    role="user",
                    content=[{
                        "type": "file",
                        "file": {"filename": "x.txt", "file_data": _data_url("text/plain", b"x")},
                    }],
                )
            ],
            stream=False,
        )
        with patch.object(application, "_execute_chat") as guest_execute:
            response = asyncio.run(
                application.chat_completions(_request_without_cookie(), request, None, None)
            )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(
            json.loads(response.body)["error"]["code"],
            "attachments_require_authentication",
        )
        guest_execute.assert_not_called()

    def test_attachment_only_authenticated_input_is_allowed(self) -> None:
        request = application.ChatCompletionRequest(
            messages=[
                application.ChatMessage(
                    role="user",
                    content=[{
                        "type": "file",
                        "file": {"filename": "x.txt", "file_data": _data_url("text/plain", b"x")},
                    }],
                )
            ]
        )
        parsed = application._latest_user_input(request)
        self.assertEqual(parsed.prompt, "")
        self.assertEqual(len(parsed.attachments), 1)


class AuthenticatedApplicationTests(unittest.TestCase):
    def setUp(self) -> None:
        expires = time.time() + 3600
        upstream = AuthenticatedUpstream(
            account=PublicAccount(
                id="account-pro",
                user_id="user-pro",
                name="Pro Tester",
                email="pro@example.test",
                initials="PT",
                plan="pro",
                plan_label="Pro",
            ),
            credential=UpstreamCredential(
                kind="access_token",
                access_token="test-access-token",
                access_token_expires_at_epoch=expires,
                cookie_header=None,
                account_id="account-pro",
                user_id="user-pro",
            ),
            expires_at_epoch=expires,
        )
        self.handle, self.entry, _ = application.AUTH_REGISTRY.create(upstream)

    def tearDown(self) -> None:
        application._remove_account_state(self.handle)

    def test_authenticated_chat_forwards_plan_controls_and_hides_upstream_id(self) -> None:
        result = AuthenticatedChatResult(
            answer="authenticated answer",
            conversation_id="upstream-conversation-secret",
            conversation_state={},
            parent_message_id="upstream-parent",
            assistant_message_id="upstream-message",
            upstream_request_id="upstream-request",
            attempts=1,
            model="gpt-5-6-pro",
        )
        request = application.ChatCompletionRequest(
            model="gpt-5-6-pro",
            messages=[application.ChatMessage(role="user", content="hello")],
            reasoning_effort="standard",
            service_tier="priority",
            stream=False,
        )

        with patch.object(
            application,
            "_execute_authenticated_chat",
            return_value=("authconv-local-handle", object(), result),
        ) as execute:
            response = asyncio.run(
                application.chat_completions(
                    _request_with_cookie(self.handle), request, None, None
                )
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["X-Conversation-Id"], "authconv-local-handle")
        self.assertEqual(response.headers["X-ChatGPT-Identity-Mode"], "verified-session")
        self.assertNotIn("upstream-conversation-secret", response.headers.values())
        self.assertNotIn("X-ChatGPT-Upstream-Request-Id", response.headers)
        self.assertEqual(execute.call_args.args[1], ())
        self.assertEqual(execute.call_args.kwargs["model"], "gpt-5-6-pro")
        self.assertEqual(execute.call_args.kwargs["reasoning_effort"], "standard")
        self.assertEqual(execute.call_args.kwargs["service_tier"], "priority")

    def test_authenticated_upload_refs_are_forwarded_in_official_user_message(self) -> None:
        class HTTP:
            def close(self) -> None:
                pass

        owner = application.AUTH_REGISTRY.owner_key(self.handle)
        protocol_session = AuthenticatedProtocolSession(
            http=HTTP(),
            access_token="test-access-token",
            account_id="account-pro",
            user_id="user-pro",
        )
        attachment = application.IncomingAttachment(
            file_name="photo.png",
            mime_type="image/png",
            file_bytes=b"png",
            width=320,
            height=200,
        )
        result = AuthenticatedChatResult(
            answer="saw the image",
            conversation_id="upstream-secret",
            conversation_state={},
            parent_message_id="assistant-1",
            assistant_message_id="assistant-1",
            upstream_request_id=None,
            attempts=1,
            model="gpt-5-6",
        )
        reference = {
            "id": "file_upstream_secret",
            "size": 3,
            "name": "photo.png",
            "mime_type": "image/png",
            "width": 320,
            "height": 200,
            "source": "local",
            "is_big_paste": False,
        }
        with (
            patch.object(application.AUTH_BRIDGE, "create_session", return_value=protocol_session),
            patch.object(application.AUTH_FILES, "upload", return_value=reference) as upload,
            patch.object(application.AUTH_BRIDGE, "run_turn", return_value=result) as run_turn,
        ):
            local_id, returned_session, returned_result = application._execute_authenticated_chat(
                "describe this",
                (attachment,),
                None,
                owner,
                self.entry,
                model="gpt-5-6",
                reasoning_effort=None,
                service_tier=None,
            )

        self.assertTrue(local_id.startswith("authconv-"))
        self.assertIs(returned_session, protocol_session)
        self.assertIs(returned_result, result)
        self.assertIs(upload.call_args.args[0], protocol_session)
        self.assertEqual(upload.call_args.kwargs["width"], 320)
        message = run_turn.call_args.kwargs["user_message"]
        self.assertEqual(
            message["content"]["parts"][0]["asset_pointer"],
            "sediment://file_upstream_secret",
        )
        self.assertEqual(message["content"]["parts"][-1], "describe this")
        self.assertEqual(message["metadata"]["attachments"][0]["id"], "file_upstream_secret")

    def test_authenticated_text_only_chat_skips_upload_and_prebuilt_message(self) -> None:
        class HTTP:
            def close(self) -> None:
                pass

        owner = application.AUTH_REGISTRY.owner_key(self.handle)
        protocol_session = AuthenticatedProtocolSession(
            http=HTTP(),
            access_token="test-access-token",
            account_id="account-pro",
            user_id="user-pro",
        )
        result = AuthenticatedChatResult(
            answer="plain answer",
            conversation_id="upstream-secret",
            conversation_state={},
            parent_message_id="assistant-1",
            assistant_message_id="assistant-1",
            upstream_request_id=None,
            attempts=1,
            model="auto",
        )
        with (
            patch.object(application.AUTH_BRIDGE, "create_session", return_value=protocol_session),
            patch.object(application.AUTH_FILES, "upload") as upload,
            patch.object(application.AUTH_BRIDGE, "run_turn", return_value=result) as run_turn,
        ):
            application._execute_authenticated_chat(
                "hello",
                (),
                None,
                owner,
                self.entry,
                model="auto",
                reasoning_effort=None,
                service_tier=None,
            )
        upload.assert_not_called()
        self.assertIsNone(run_turn.call_args.kwargs["user_message"])

    def test_file_upload_retries_once_only_after_upstream_401(self) -> None:
        class HTTP:
            def close(self) -> None:
                pass

        session = AuthenticatedProtocolSession(
            http=HTTP(), access_token="old", account_id="account-pro"
        )
        attachment = application.IncomingAttachment(
            file_name="x.txt", mime_type="text/plain", file_bytes=b"x"
        )
        unauthorized = AuthenticatedProtocolError(
            "authenticated_session_expired",
            "expired",
            stage="file_create",
            retryable=True,
            upstream_status=401,
        )
        reference = {"id": "file_x", "size": 1, "name": "x.txt"}
        with (
            patch.object(application.AUTH_FILES, "upload", side_effect=[unauthorized, reference]) as upload,
            patch.object(application, "_bind_authenticated_credential") as bind,
        ):
            returned = application._upload_authenticated_attachment(
                session, self.entry, attachment, model="auto"
            )
        self.assertEqual(returned, reference)
        self.assertEqual(upload.call_count, 2)
        bind.assert_called_once_with(session, self.entry, force_refresh=True)

    def test_file_upload_does_not_refresh_or_retry_plan_forbidden(self) -> None:
        class HTTP:
            def close(self) -> None:
                pass

        session = AuthenticatedProtocolSession(
            http=HTTP(), access_token="current", account_id="account-pro"
        )
        attachment = application.IncomingAttachment(
            file_name="x.txt", mime_type="text/plain", file_bytes=b"x"
        )
        forbidden = AuthenticatedProtocolError(
            "authenticated_file_forbidden",
            "forbidden",
            stage="file_create",
            retryable=False,
            upstream_status=403,
        )
        with (
            patch.object(application.AUTH_FILES, "upload", side_effect=forbidden) as upload,
            patch.object(application, "_bind_authenticated_credential") as bind,
            self.assertRaises(AuthenticatedProtocolError),
        ):
            application._upload_authenticated_attachment(
                session, self.entry, attachment, model="auto"
            )
        upload.assert_called_once()
        bind.assert_not_called()

    def test_reset_credit_list_uses_current_session_and_exact_contract(self) -> None:
        payload = {
            "ok": True,
            "authenticated": True,
            "availableCount": 1,
            "credits": [
                {
                    "id": "credit-one",
                    "title": "Usage reset",
                    "expiresAt": None,
                    "isSupportedByPlan": True,
                    "status": "available",
                    "resetType": "codex_rate_limits",
                }
            ],
        }
        with patch.object(
            application, "fetch_codex_reset_credits", return_value=payload
        ) as fetch:
            response = asyncio.run(
                application.codex_reset_credits(_usage_request(self.handle))
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(json.loads(response.body), payload)
        fetch.assert_called_once_with(self.entry)

    def test_reset_credit_consume_validates_and_forwards_current_session(self) -> None:
        redeem_request_id = "11111111-2222-4333-8444-555555555555"
        upstream_result = {
            "ok": True,
            "authenticated": True,
            "code": "reset",
            "creditId": "credit-one",
        }
        request = _reset_consume_request(
            self.handle,
            {"creditId": "credit-one", "redeemRequestId": redeem_request_id},
        )
        with patch.object(
            application, "consume_codex_reset_credit", return_value=upstream_result
        ) as consume:
            response = asyncio.run(application.codex_reset_credit_consume(request))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(json.loads(response.body), upstream_result)
        consume.assert_called_once_with(
            self.entry,
            credit_id="credit-one",
            redeem_request_id=redeem_request_id,
        )

    def test_reset_credit_consume_rejects_cross_origin_before_upstream(self) -> None:
        request = _reset_consume_request(
            self.handle,
            {"redeemRequestId": "11111111-2222-4333-8444-555555555555"},
            origin="https://evil.example",
        )
        with patch.object(application, "consume_codex_reset_credit") as consume:
            response = asyncio.run(application.codex_reset_credit_consume(request))

        self.assertEqual(response.status_code, 403)
        self.assertEqual(json.loads(response.body)["error"]["code"], "origin_not_allowed")
        consume.assert_not_called()
        self.assertIs(application.AUTH_REGISTRY.get(self.handle), self.entry)

    def test_reset_credit_consume_rejects_large_or_invalid_json_before_upstream(self) -> None:
        oversized = _reset_consume_request(
            self.handle,
            {"redeemRequestId": "11111111-2222-4333-8444-555555555555"},
            content_length=application.MAX_CODEX_RESET_CONSUME_BODY_BYTES + 1,
        )
        extra = _reset_consume_request(
            self.handle,
            {
                "redeemRequestId": "11111111-2222-4333-8444-555555555555",
                "unexpected": True,
            },
        )
        malformed_uuid = _reset_consume_request(
            self.handle, {"redeemRequestId": "not-a-uuid"}
        )
        with patch.object(application, "consume_codex_reset_credit") as consume:
            large_response = asyncio.run(
                application.codex_reset_credit_consume(oversized)
            )
            extra_response = asyncio.run(application.codex_reset_credit_consume(extra))
            uuid_response = asyncio.run(
                application.codex_reset_credit_consume(malformed_uuid)
            )

        self.assertEqual(large_response.status_code, 413)
        self.assertEqual(extra_response.status_code, 400)
        self.assertEqual(uuid_response.status_code, 400)
        consume.assert_not_called()

    def test_reset_credit_consume_requires_session_without_upstream_fallback(self) -> None:
        request = _reset_consume_request(
            None,
            {"redeemRequestId": "11111111-2222-4333-8444-555555555555"},
        )
        with patch.object(application, "consume_codex_reset_credit") as consume:
            response = asyncio.run(application.codex_reset_credit_consume(request))
        self.assertEqual(response.status_code, 401)
        consume.assert_not_called()

    def test_reset_credit_consume_forbidden_preserves_session(self) -> None:
        request = _reset_consume_request(
            self.handle,
            {"redeemRequestId": "11111111-2222-4333-8444-555555555555"},
        )
        with patch.object(
            application,
            "consume_codex_reset_credit",
            side_effect=AuthSessionError(
                "usage_forbidden", "not entitled", status_code=403
            ),
        ):
            response = asyncio.run(application.codex_reset_credit_consume(request))

        body = json.loads(response.body)
        self.assertEqual(response.status_code, 403)
        self.assertIs(body["authenticated"], True)
        self.assertEqual(body["error"]["code"], "usage_forbidden")
        self.assertNotIn("set-cookie", response.headers)
        self.assertIs(application.AUTH_REGISTRY.get(self.handle), self.entry)

    def test_reset_credit_consume_unauthorized_expires_session(self) -> None:
        request = _reset_consume_request(
            self.handle,
            {"redeemRequestId": "11111111-2222-4333-8444-555555555555"},
        )
        with patch.object(
            application,
            "consume_codex_reset_credit",
            side_effect=AuthSessionError(
                "invalid_session", "expired", status_code=401
            ),
        ):
            response = asyncio.run(application.codex_reset_credit_consume(request))

        self.assertEqual(response.status_code, 401)
        self.assertIn("Max-Age=0", response.headers.get("set-cookie", ""))
        self.assertIsNone(application.AUTH_REGISTRY.get(self.handle))

    def test_codex_analytics_uses_current_local_auth_entry(self) -> None:
        payload = {
            "ok": True,
            "live": True,
            "source": "chatgpt-wham",
            "planType": "plus",
            "quota": {
                "primary": {
                    "usedPercent": 25,
                    "remainingPercent": 75,
                    "windowDurationMins": 300,
                    "resetsAt": 2_000_000_000,
                }
            },
        }
        with patch.object(application, "fetch_codex_usage", return_value=payload) as fetch:
            response = asyncio.run(application.codex_analytics(_usage_request(self.handle)))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "no-store")
        fetch.assert_called_once_with(self.entry)

    def test_codex_analytics_handles_are_isolated_by_registry_entry(self) -> None:
        expires = time.time() + 3600
        other_upstream = AuthenticatedUpstream(
            account=PublicAccount(
                id="account-other",
                user_id="user-other",
                name="Other Tester",
                email="other@example.test",
                initials="OT",
                plan="plus",
                plan_label="Plus",
            ),
            credential=UpstreamCredential(
                kind="access_token",
                access_token="other-test-access-token",
                access_token_expires_at_epoch=expires,
                cookie_header=None,
                account_id="account-other",
                user_id="user-other",
            ),
            expires_at_epoch=expires,
        )
        other_handle, other_entry, _ = application.AUTH_REGISTRY.create(other_upstream)

        def usage_for(entry):  # type: ignore[no-untyped-def]
            remaining = 71 if entry is self.entry else 19 if entry is other_entry else -1
            return {
                "ok": True,
                "authenticated": True,
                "quota": {"primary": {"remainingPercent": remaining}},
            }

        try:
            with patch.object(application, "fetch_codex_usage", side_effect=usage_for) as fetch:
                first = asyncio.run(application.codex_analytics(_usage_request(self.handle)))
                second = asyncio.run(application.codex_analytics(_usage_request(other_handle)))

            first_body = json.loads(first.body)
            second_body = json.loads(second.body)
            self.assertEqual(first_body["quota"]["primary"]["remainingPercent"], 71)
            self.assertEqual(second_body["quota"]["primary"]["remainingPercent"], 19)
            self.assertEqual(
                [call.args[0] for call in fetch.call_args_list],
                [self.entry, other_entry],
            )
        finally:
            application._remove_account_state(other_handle)

    def test_codex_analytics_requires_local_http_only_session(self) -> None:
        with patch.object(application, "fetch_codex_usage") as fetch:
            response = asyncio.run(application.codex_analytics(_usage_request()))
        self.assertEqual(response.status_code, 401)
        fetch.assert_not_called()

    def test_codex_analytics_expired_session_clears_local_cookie(self) -> None:
        with patch.object(
            application,
            "fetch_codex_usage",
            side_effect=AuthSessionError("invalid_session", "expired", status_code=401),
        ):
            response = asyncio.run(application.codex_analytics(_usage_request(self.handle)))
        self.assertEqual(response.status_code, 401)
        self.assertIn("Max-Age=0", response.headers.get("set-cookie", ""))
        self.assertIsNone(application.AUTH_REGISTRY.get(self.handle))

    def test_codex_analytics_forbidden_preserves_local_session(self) -> None:
        with patch.object(
            application,
            "fetch_codex_usage",
            side_effect=AuthSessionError(
                "usage_forbidden", "not entitled", status_code=403
            ),
        ):
            response = asyncio.run(application.codex_analytics(_usage_request(self.handle)))

        body = json.loads(response.body)
        self.assertEqual(response.status_code, 403)
        self.assertIs(body["authenticated"], True)
        self.assertIs(body["ok"], False)
        self.assertIs(body["live"], False)
        self.assertEqual(body["availability"], "unavailable")
        self.assertEqual(body["error"]["code"], "usage_forbidden")
        self.assertNotIn("user", body)
        self.assertNotIn("set-cookie", response.headers)
        self.assertIs(application.AUTH_REGISTRY.get(self.handle), self.entry)

    def test_codex_analytics_transient_failure_preserves_local_session(self) -> None:
        with patch.object(
            application,
            "fetch_codex_usage",
            side_effect=AuthSessionError(
                "upstream_unavailable", "temporary", status_code=503
            ),
        ):
            response = asyncio.run(application.codex_analytics(_usage_request(self.handle)))

        body = json.loads(response.body)
        self.assertEqual(response.status_code, 503)
        self.assertIs(body["authenticated"], True)
        self.assertEqual(body["availability"], "unavailable")
        self.assertNotIn("user", body)
        self.assertNotIn("set-cookie", response.headers)
        self.assertIs(application.AUTH_REGISTRY.get(self.handle), self.entry)

    def test_stale_local_cookie_never_falls_back_to_guest(self) -> None:
        application._remove_account_state(self.handle)
        request = application.ChatCompletionRequest(
            messages=[application.ChatMessage(role="user", content="hello")],
            stream=False,
        )
        with patch.object(application, "_execute_chat") as guest_execute:
            response = asyncio.run(
                application.chat_completions(
                    _request_with_cookie(self.handle), request, None, None
                )
            )

        self.assertEqual(response.status_code, 401)
        self.assertIn("Max-Age=0", response.headers.get("set-cookie", ""))
        guest_execute.assert_not_called()

    def test_transient_upstream_auth_helper_error_does_not_log_account_out(self) -> None:
        request = application.ChatCompletionRequest(
            messages=[application.ChatMessage(role="user", content="hello")],
            stream=False,
        )
        with patch.object(
            application,
            "_execute_authenticated_chat",
            side_effect=AuthSessionError(
                "upstream_unavailable", "temporary failure", status_code=503
            ),
        ):
            response = asyncio.run(
                application.chat_completions(
                    _request_with_cookie(self.handle), request, None, None
                )
            )

        self.assertEqual(response.status_code, 503)
        self.assertNotIn("Max-Age=0", response.headers.get("set-cookie", ""))
        self.assertIs(application.AUTH_REGISTRY.get(self.handle), self.entry)

    def test_plan_forbidden_response_is_403_and_does_not_destroy_login(self) -> None:
        request = application.ChatCompletionRequest(
            model="plan-gated-model",
            messages=[application.ChatMessage(role="user", content="hello")],
            stream=False,
        )
        with patch.object(
            application,
            "_execute_authenticated_chat",
            side_effect=AuthenticatedProtocolError(
                "authenticated_session_expired",
                "forbidden upstream",
                stage="conversation_prepare",
                retryable=False,
                upstream_status=403,
            ),
        ):
            response = asyncio.run(
                application.chat_completions(
                    _request_with_cookie(self.handle), request, None, None
                )
            )

        self.assertEqual(response.status_code, 403)
        self.assertNotIn("Max-Age=0", response.headers.get("set-cookie", ""))
        self.assertIs(application.AUTH_REGISTRY.get(self.handle), self.entry)

    def test_upstream_unauthorized_response_expires_local_login(self) -> None:
        request = application.ChatCompletionRequest(
            messages=[application.ChatMessage(role="user", content="hello")],
            stream=False,
        )
        with patch.object(
            application,
            "_execute_authenticated_chat",
            side_effect=AuthenticatedProtocolError(
                "authenticated_session_expired",
                "unauthorized upstream",
                stage="conversation_prepare",
                retryable=False,
                upstream_status=401,
            ),
        ):
            response = asyncio.run(
                application.chat_completions(
                    _request_with_cookie(self.handle), request, None, None
                )
            )

        self.assertEqual(response.status_code, 401)
        self.assertIn("Max-Age=0", response.headers.get("set-cookie", ""))
        self.assertIsNone(application.AUTH_REGISTRY.get(self.handle))

    def test_automatic_auth_eviction_immediately_closes_bound_conversations(self) -> None:
        class Session:
            def __init__(self) -> None:
                self.closed = False

            def close(self) -> None:
                self.closed = True

        owner = application.AUTH_REGISTRY.owner_key(self.handle)
        protocol_session = Session()
        local_id = application.AUTH_CONVERSATIONS.put(
            protocol_session, owner=owner  # type: ignore[arg-type]
        )
        self.entry.last_access_monotonic = (
            time.monotonic() - application.AUTH_REGISTRY.idle_ttl_seconds - 1
        )

        application.AUTH_REGISTRY.count()

        self.assertTrue(protocol_session.closed)
        self.assertIsNone(application.AUTH_CONVERSATIONS.get(local_id, owner=owner))
        self.assertIsNone(application.AUTH_REGISTRY.get(self.handle))


class AuthenticatedConversationRegistryTests(unittest.TestCase):
    class Session:
        def __init__(self) -> None:
            self.closed = False

        def close(self) -> None:
            self.closed = True

    def test_local_handles_are_owner_scoped_and_cleanup_closes_session(self) -> None:
        registry = application.AuthenticatedConversationRegistry(300, 4)
        session = self.Session()
        local_id = registry.put(session, owner="account:a")  # type: ignore[arg-type]

        self.assertTrue(local_id.startswith("authconv-"))
        self.assertIs(registry.get(local_id, owner="account:a"), session)
        self.assertIsNone(registry.get(local_id, owner="account:b"))
        registry.remove_owner("account:a")
        self.assertTrue(session.closed)
        self.assertEqual(registry.count(), 0)


class GuestConversationRegistryLifecycleTests(unittest.TestCase):
    class Session:
        def __init__(self, conversation_id: str) -> None:
            self.conversation_id = conversation_id
            self.closed = False

        def close(self) -> None:
            self.closed = True

    def test_health_and_lifespan_registry_methods_exist_and_close_sessions(self) -> None:
        registry = application.ConversationRegistry(300, 4)
        session = self.Session("guest-conversation")
        registry.put(session, owner="guest")  # type: ignore[arg-type]
        self.assertEqual(registry.count(), 1)
        registry.close_all()
        self.assertTrue(session.closed)
        self.assertEqual(registry.count(), 0)


if __name__ == "__main__":
    unittest.main()
