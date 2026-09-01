"""Offline fixtures for the authenticated ChatGPT protocol bridge."""

from __future__ import annotations

import json
import unittest
from typing import Any
from unittest.mock import patch

from . import authenticated_protocol

from .authenticated_protocol import (
    AuthenticatedCredential,
    AuthenticatedProtocolBridge,
    AuthenticatedProtocolConfig,
    AuthenticatedProtocolError,
    build_conversation_body,
    parse_authenticated_sse,
)


def _sse_event(event: str | None, value: Any) -> list[bytes]:
    lines: list[bytes] = []
    if event is not None:
        lines.append(f"event: {event}".encode())
    data = value if isinstance(value, str) else json.dumps(value, separators=(",", ":"))
    lines.append(f"data: {data}".encode())
    lines.append(b"")
    return lines


def _assistant_event(answer: str, message_id: str, conversation_id: str) -> dict[str, Any]:
    return {
        "type": "message",
        "conversation_id": conversation_id,
        "message": {
            "id": message_id,
            "author": {"role": "assistant"},
            "content": {"content_type": "text", "parts": [answer]},
            "status": "finished_successfully",
            "recipient": "all",
        },
    }


def _v1_fixture(answer: str, message_id: str, conversation_id: str) -> list[bytes]:
    first = _assistant_event(answer[:2], message_id, conversation_id)
    lines = _sse_event("delta_encoding", "v1")
    lines += _sse_event("delta", {"c": 0, "p": "", "o": "add", "v": first})
    lines += _sse_event(
        "delta",
        {
            # Channel is inherited from the preceding compact delta.
            "p": "/message/content/parts/0",
            "o": "append",
            "v": answer[2:],
        },
    )
    lines += _sse_event(
        None,
        {"type": "message_stream_complete", "conversation_id": conversation_id},
    )
    lines += _sse_event(None, "[DONE]")
    return lines


class _FakeResponse:
    def __init__(
        self,
        *,
        status: int = 200,
        payload: Any = None,
        content: str | bytes = b"",
        lines: list[bytes] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.status_code = status
        self._payload = payload
        self.content = content.encode() if isinstance(content, str) else content
        self._lines = lines
        self.headers = headers or {}
        self.closed = False

    def json(self) -> Any:
        if isinstance(self._payload, BaseException):
            raise self._payload
        return self._payload

    def iter_lines(self):
        yield from self._lines or []

    def close(self) -> None:
        self.closed = True


class _FakeHTTP:
    def __init__(self, *, reject_first_token: bool = False) -> None:
        self.calls: list[dict[str, Any]] = []
        self.turn = 0
        self.reject_first_token = reject_first_token
        self.closed = False

    def request(self, method: str, url: str, **kwargs: Any) -> _FakeResponse:
        call = {"method": method, "url": url, **kwargs}
        self.calls.append(call)
        if method == "GET" and url.endswith("/"):
            return _FakeResponse(content='<html data-build="fixture-build"></html>')
        if url.endswith("/backend-api/sentinel/sdk.js"):
            return _FakeResponse(
                content='import "https://chatgpt.com/sentinel/fixture/sdk.js";'
            )
        if url.endswith("/sentinel/chat-requirements/prepare"):
            authorization = kwargs.get("headers", {}).get("Authorization")
            if self.reject_first_token and authorization == "Bearer old-token":
                return _FakeResponse(status=401, payload={"error": "expired"})
            return _FakeResponse(
                payload={
                    "prepare_token": "sentinel-prepare",
                    "proofofwork": {"required": False},
                    "turnstile": {"required": False},
                }
            )
        if url.endswith("/sentinel/chat-requirements/finalize"):
            return _FakeResponse(payload={"token": "sentinel-final", "expire_after": 60})
        if url.endswith("/f/conversation/prepare"):
            return _FakeResponse(payload={"status": "success", "conduit_token": "cnd"})
        if url.endswith("/f/conversation/resume"):
            lines = _sse_event(
                None,
                {
                    "type": "message",
                    "conversation_id": "conversation-1",
                    "message": {
                        "id": "image-tool-resumed",
                        "author": {"role": "tool", "name": "t2uay3k.sj1i4kz"},
                        "content": {
                            "content_type": "multimodal_text",
                            "parts": [
                                {
                                    "content_type": "image_asset_pointer",
                                    "asset_pointer": "sediment://file-resumed",
                                    "width": 1024,
                                    "height": 1024,
                                }
                            ],
                        },
                    },
                },
            )
            lines += _sse_event(None, "[DONE]")
            return _FakeResponse(lines=lines, headers={"x-oai-request-id": "resume-1"})
        if url.endswith("/f/conversation"):
            self.turn += 1
            return _FakeResponse(
                lines=_v1_fixture(
                    f"answer-{self.turn}", f"assistant-{self.turn}", "conversation-1"
                ),
                headers={"x-oai-request-id": f"request-{self.turn}"},
            )
        raise AssertionError(f"unexpected fake request: {method} {url}")

    def close(self) -> None:
        self.closed = True


class _FlakyHTTP(_FakeHTTP):
    def __init__(
        self,
        *,
        failure_method: str,
        failure_suffix: str,
        failures: int = 1,
    ) -> None:
        super().__init__()
        self.failure_method = failure_method
        self.failure_suffix = failure_suffix
        self.failures = failures

    def request(self, method: str, url: str, **kwargs: Any) -> _FakeResponse:
        if (
            self.failures > 0
            and method == self.failure_method
            and url.endswith(self.failure_suffix)
        ):
            self.failures -= 1
            self.calls.append({"method": method, "url": url, **kwargs})
            raise OSError("credential-bearing-network-error")
        return super().request(method, url, **kwargs)


class AuthenticatedStreamParserTests(unittest.TestCase):
    def test_forbidden_status_is_not_mislabeled_as_an_expired_session(self) -> None:
        response = _FakeResponse(status=403, payload={"error": "plan gated"})

        error = authenticated_protocol._status_error(response, "conversation_prepare")

        self.assertEqual(error.code, "authenticated_forbidden")
        self.assertEqual(error.upstream_status, 403)
        self.assertFalse(error.retryable)

    def test_v1_compact_deltas_reconstruct_answer_and_state(self) -> None:
        parsed = parse_authenticated_sse(
            _v1_fixture("Hello", "assistant-1", "conversation-1")
        )
        self.assertEqual(parsed.answer, "Hello")
        self.assertEqual(parsed.conversation_id, "conversation-1")
        self.assertEqual(parsed.parent_message_id, "assistant-1")
        self.assertTrue(parsed.state["streamComplete"])

    def test_legacy_full_message_is_still_supported(self) -> None:
        lines = _sse_event(
            None, _assistant_event("legacy", "assistant-old", "conversation-old")
        )
        lines += _sse_event(None, "[DONE]")
        parsed = parse_authenticated_sse(lines)
        self.assertEqual(parsed.answer, "legacy")
        self.assertEqual(parsed.assistant_message_id, "assistant-old")

    def test_tool_only_image_message_becomes_the_continuation_parent(self) -> None:
        lines = _sse_event(
            None,
            {
                "type": "message",
                "conversation_id": "conversation-image",
                "message": {
                    "id": "image-tool-1",
                    "author": {
                        "role": "tool",
                        "name": "t2uay3k.sj1i4kz",
                    },
                    "content": {
                        "content_type": "multimodal_text",
                        "parts": [
                            {
                                "content_type": "image_asset_pointer",
                                "asset_pointer": "sediment://file-generated",
                                "size_bytes": 123,
                                "width": 1254,
                                "height": 1254,
                            }
                        ],
                    },
                    "recipient": "assistant",
                    "status": "finished_successfully",
                },
            },
        )
        lines += _sse_event(
            None,
            {
                "type": "message_stream_complete",
                "conversation_id": "conversation-image",
            },
        )
        lines += _sse_event(None, "[DONE]")

        parsed = parse_authenticated_sse(lines)

        self.assertEqual(parsed.answer, "")
        self.assertEqual(parsed.parent_message_id, "image-tool-1")
        self.assertEqual(parsed.assistant_message_id, "image-tool-1")
        self.assertEqual(len(parsed.images), 1)
        self.assertEqual(
            parsed.images[0].asset_pointer, "sediment://file-generated"
        )
        self.assertFalse(parsed.image_generation_pending)

    def test_image_tool_error_is_terminal_not_pending(self) -> None:
        lines = _sse_event(
            None,
            {
                "type": "message",
                "conversation_id": "conversation-image-error",
                "message": {
                    "id": "image-tool-error",
                    "author": {
                        "role": "tool",
                        "name": "t2uay3k.sj1i4kz",
                    },
                    "content": {
                        "content_type": "system_error",
                        "parts": ["private upstream error detail"],
                    },
                    "recipient": "assistant",
                    "status": "finished_successfully",
                },
            },
        )
        lines += _sse_event(None, "[DONE]")

        parsed = parse_authenticated_sse(lines)

        self.assertEqual(parsed.parent_message_id, "image-tool-error")
        self.assertEqual(parsed.images, ())
        self.assertTrue(parsed.image_generation_failed)
        self.assertFalse(parsed.image_generation_pending)
        self.assertTrue(parsed.state["imageGenerationFailed"])
        self.assertFalse(parsed.state["imageGenerationPending"])
        self.assertNotIn("private upstream error detail", repr(parsed))

    def test_message_patch_recomputes_async_image_failure(self) -> None:
        lines = _sse_event(
            None,
            {
                "type": "message",
                "conversation_id": "conversation-patched-image",
                "message": {
                    "id": "assistant-patched-image",
                    "author": {"role": "assistant"},
                    "content": {"content_type": "text", "parts": ["private detail"]},
                    "metadata": {},
                    "recipient": "all",
                },
            },
        )
        lines += _sse_event(
            None,
            {
                "type": "stream-message-patch",
                "message_id": "assistant-patched-image",
                "patches": [
                    {
                        "op": "add",
                        "path": "/metadata/image_gen_task_id",
                        "value": "task-private",
                    },
                    {
                        "op": "add",
                        "path": "/metadata/is_error",
                        "value": "true",
                    },
                ],
            },
        )
        lines += _sse_event(None, "[DONE]")

        parsed = parse_authenticated_sse(lines)

        self.assertTrue(parsed.image_generation_failed)
        self.assertFalse(parsed.image_generation_pending)
        self.assertEqual(parsed.answer, "")
        self.assertNotIn("task-private", repr(parsed))

    def test_user_uploaded_image_pointer_is_not_generation_output_or_pending(self) -> None:
        lines = _sse_event(
            None,
            {
                "type": "message",
                "conversation_id": "conversation-upload",
                "message": {
                    "id": "user-upload",
                    "author": {"role": "user"},
                    "content": {
                        "content_type": "multimodal_text",
                        "parts": [
                            {
                                "content_type": "image_asset_pointer",
                                "asset_pointer": "sediment://file-user-private",
                                "size_bytes": 3,
                                "width": 2,
                                "height": 1,
                            },
                            "describe this",
                        ],
                    },
                },
            },
        )
        lines += _sse_event(
            None,
            _assistant_event(
                "ordinary text reply",
                "assistant-upload",
                "conversation-upload",
            ),
        )
        lines += _sse_event(None, "[DONE]")

        parsed = parse_authenticated_sse(lines)

        self.assertEqual(parsed.answer, "ordinary text reply")
        self.assertEqual(parsed.parent_message_id, "assistant-upload")
        self.assertEqual(parsed.images, ())
        self.assertFalse(parsed.image_generation_pending)
        self.assertFalse(parsed.image_generation_failed)

    def test_invalid_delta_is_a_sanitized_protocol_error(self) -> None:
        lines = _sse_event("delta_encoding", "v1")
        lines += _sse_event("delta", {"o": "unknown", "v": "secret-value"})
        with self.assertRaises(AuthenticatedProtocolError) as caught:
            parse_authenticated_sse(lines)
        self.assertEqual(caught.exception.code, "authenticated_stream_delta_invalid")
        self.assertNotIn("secret-value", str(caught.exception))


class AuthenticatedBridgeTests(unittest.TestCase):
    def _bridge(self, fake: _FakeHTTP, attempts: int = 1) -> AuthenticatedProtocolBridge:
        return AuthenticatedProtocolBridge(
            AuthenticatedProtocolConfig(
                max_turn_attempts=attempts,
                retry_base_delay_seconds=0,
                verify_tls=False,
            ),
            http_factory=lambda: fake,
        )

    def test_bootstrap_get_retries_transient_network_failure(self) -> None:
        fake = _FlakyHTTP(failure_method="GET", failure_suffix="/")
        bridge = self._bridge(fake)

        with patch.object(authenticated_protocol.time, "sleep") as sleep:
            session = bridge.create_session({"access_token": "valid-token"})

        root_calls = [
            call
            for call in fake.calls
            if call["method"] == "GET" and call["url"].endswith("/")
        ]
        self.assertEqual(len(root_calls), 2)
        self.assertFalse(session.closed)
        sleep.assert_called_once()

    def test_stream_read_failure_is_sanitized(self) -> None:
        class BrokenResponse:
            def iter_lines(self):
                yield b'data: {"type":"resume_conversation_token"}'
                raise OSError("Authorization: Bearer private-token")

        bridge = self._bridge(_FakeHTTP())
        with self.assertRaises(AuthenticatedProtocolError) as caught:
            list(bridge._iter_limited_lines(BrokenResponse()))

        self.assertEqual(caught.exception.code, "authenticated_stream_read_error")
        self.assertFalse(caught.exception.retryable)
        self.assertNotIn("private-token", str(caught.exception))

    def test_post_network_failure_is_not_replayed(self) -> None:
        fake = _FlakyHTTP(
            failure_method="POST",
            failure_suffix="/sentinel/chat-requirements/prepare",
        )
        bridge = self._bridge(fake, attempts=3)
        session = bridge.create_session({"access_token": "valid-token"})

        with self.assertRaises(AuthenticatedProtocolError) as caught:
            bridge.run_turn(session, "do not replay")

        prepare_calls = [
            call
            for call in fake.calls
            if call["url"].endswith("/sentinel/chat-requirements/prepare")
        ]
        self.assertEqual(len(prepare_calls), 1)
        self.assertEqual(
            caught.exception.code, "authenticated_sentinel_prepare_network_error"
        )
        self.assertNotIn("credential-bearing-network-error", caught.exception.message)

    def test_main_path_and_continuation_use_authenticated_endpoints(self) -> None:
        fake = _FakeHTTP()
        bridge = self._bridge(fake)
        session = bridge.create_session(
            AuthenticatedCredential(
                access_token="access-secret",
                cookie_header="session=private",
                account_id="account-1",
            ),
            model="model-pro",
        )

        first = bridge.run_turn(
            session,
            "first",
            reasoning_effort="extended",
            service_tier="fast",
        )
        second = bridge.run_turn(session, "second")
        self.assertEqual(first.answer, "answer-1")
        self.assertEqual(second.answer, "answer-2")
        self.assertEqual(session.conversation_id, "conversation-1")
        self.assertEqual(session.parent_message_id, "assistant-2")

        completion_calls = [
            call
            for call in fake.calls
            if call["url"].endswith("/f/conversation")
        ]
        self.assertEqual(len(completion_calls), 2)
        prepare_calls = [
            call
            for call in fake.calls
            if call["url"].endswith("/f/conversation/prepare")
        ]
        self.assertEqual(len(prepare_calls), 2)
        first_prepare_body = prepare_calls[0]["json"]
        first_body = completion_calls[0]["json"]
        second_body = completion_calls[1]["json"]
        self.assertNotIn("conversation_id", first_body)
        self.assertEqual(first_body["parent_message_id"], "client-created-root")
        self.assertEqual(second_body["conversation_id"], "conversation-1")
        self.assertEqual(second_body["parent_message_id"], "assistant-1")
        self.assertEqual(first_body["thinking_effort"], "extended")
        self.assertEqual(first_body["service_tier"], "fast")
        self.assertEqual(first_prepare_body["service_tier"], "fast")
        self.assertEqual(first_body["supported_encodings"], ["v1"])
        self.assertNotIn("client_prepare_dispatch", first_body)
        self.assertNotIn("conversation_origin", first_body)
        self.assertEqual(first_prepare_body["client_prepare_dispatch"], "debounced")
        self.assertEqual(
            first_prepare_body["model_response_contracts"][0]["id"],
            "photo_upload_action.v1",
        )
        self.assertEqual(
            first_body["messages"][0]["metadata"]["serialization_metadata"],
            {"custom_symbol_offsets": []},
        )
        self.assertEqual(
            completion_calls[0]["headers"]["Authorization"], "Bearer access-secret"
        )
        self.assertEqual(completion_calls[0]["headers"]["x-conduit-token"], "cnd")

    def test_gpt_5_6_pro_standard_reaches_prepare_and_submit_unchanged(self) -> None:
        """Lock the UI/API Pro selection to the exact upstream wire contract."""

        fake = _FakeHTTP()
        bridge = self._bridge(fake)
        session = bridge.create_session(
            AuthenticatedCredential(
                access_token="access-secret",
                account_id="account-pro",
            )
        )

        result = bridge.run_turn(
            session,
            "use the Pro lane",
            model="gpt-5-6-pro",
            reasoning_effort="standard",
        )

        self.assertEqual(result.model, "gpt-5-6-pro")
        prepare = next(
            call for call in fake.calls if call["url"].endswith("/f/conversation/prepare")
        )
        submit = next(
            call for call in fake.calls if call["url"].endswith("/f/conversation")
        )
        for call in (prepare, submit):
            self.assertEqual(call["json"]["model"], "gpt-5-6-pro")
            self.assertEqual(call["json"]["thinking_effort"], "standard")

    def test_picture_v2_hint_reaches_prepare_and_submit(self) -> None:
        fake = _FakeHTTP()
        bridge = self._bridge(fake)
        session = bridge.create_session({"access_token": "valid-token"})

        bridge.run_turn(
            session,
            "generate an image",
            system_hints=("picture_v2",),
        )

        prepare = next(
            call for call in fake.calls if call["url"].endswith("/f/conversation/prepare")
        )
        submit = next(
            call for call in fake.calls if call["url"].endswith("/f/conversation")
        )
        self.assertEqual(prepare["json"]["system_hints"], ["picture_v2"])
        self.assertEqual(submit["json"]["system_hints"], ["picture_v2"])
        self.assertNotIn("thinking_effort", prepare["json"])
        self.assertNotIn("thinking_effort", submit["json"])

    def test_resume_turn_uses_conduit_token_without_resubmitting_prompt(self) -> None:
        fake = _FakeHTTP()
        bridge = self._bridge(fake)
        session = bridge.create_session(
            AuthenticatedCredential(
                access_token="access-secret",
                cookie_header="session=private",
                account_id="account-1",
            ),
            model="gpt-5-6-pro",
        )
        session.conversation_id = "conversation-1"
        session.parent_message_id = "assistant-dispatch"
        session.turn_index = 1
        session.conversation_state = {"lastUserMessageId": "user-image"}

        resumed = bridge.resume_turn(
            session,
            conversation_id="conversation-1",
            resume_token="resume-secret",
            offset=0,
        )

        self.assertEqual(len(resumed.images), 1)
        self.assertEqual(
            resumed.images[0].asset_pointer, "sediment://file-resumed"
        )
        self.assertEqual(resumed.parent_message_id, "image-tool-resumed")
        self.assertEqual(session.turn_index, 1)
        resume = next(
            call for call in fake.calls if call["url"].endswith("/f/conversation/resume")
        )
        self.assertEqual(
            resume["json"], {"conversation_id": "conversation-1", "offset": 0}
        )
        self.assertEqual(resume["headers"]["x-conduit-token"], "resume-secret")
        self.assertFalse(
            any(call["url"].endswith("/f/conversation") for call in fake.calls)
        )

        with self.assertRaises(AuthenticatedProtocolError) as caught:
            bridge.resume_turn(
                session,
                conversation_id="conversation-1",
                resume_token="resume-secret",
                offset=1,
            )
        self.assertEqual(caught.exception.code, "authenticated_resume_invalid")

    def test_refresh_hook_rebinds_token_and_retries_without_guest_fallback(self) -> None:
        fake = _FakeHTTP(reject_first_token=True)
        bridge = self._bridge(fake, attempts=2)
        hook_calls: list[str] = []

        def refresh(session):
            hook_calls.append(session.account_id)
            return "new-token"

        session = bridge.create_session(
            {"access_token": "old-token", "account_id": "account-1"},
            token_refresh_hook=refresh,
        )
        result = bridge.run_turn(session, "retry")
        self.assertEqual(result.answer, "answer-1")
        self.assertEqual(result.attempts, 2)
        self.assertEqual(hook_calls, ["account-1"])
        self.assertEqual(session.access_token, "new-token")

    def test_prebuilt_file_message_is_forwarded_and_reuses_its_id(self) -> None:
        fake = _FakeHTTP()
        bridge = self._bridge(fake)
        session = bridge.create_session({"access_token": "valid-token"})
        message = {
            "id": "user-with-file",
            "author": {"role": "user"},
            "create_time": 123.0,
            "content": {
                "content_type": "multimodal_text",
                "parts": [
                    {
                        "content_type": "image_asset_pointer",
                        "asset_pointer": "sediment://file-private",
                        "size_bytes": 3,
                        "width": 2,
                        "height": 1,
                    },
                    "",
                ],
            },
            "metadata": {
                "selected_sources": [],
                "serialization_metadata": {"custom_symbol_offsets": []},
                "attachments": [{"id": "file-private", "name": "x.png", "size": 3}],
            },
        }
        result = bridge.run_turn(session, user_message=message)
        self.assertEqual(result.answer, "answer-1")
        completion = next(
            call for call in fake.calls if call["url"].endswith("/f/conversation")
        )
        self.assertEqual(completion["json"]["messages"], [message])
        self.assertEqual(session.conversation_state["lastUserMessageId"], "user-with-file")

    def test_body_selector_and_credential_controls_are_rejected(self) -> None:
        with self.assertRaises(AuthenticatedProtocolError):
            AuthenticatedCredential(access_token="token\r\nInjected: yes")._validate()

        fake = _FakeHTTP()
        session = self._bridge(fake).create_session({"access_token": "valid-token"})
        with self.assertRaises(AuthenticatedProtocolError) as caught:
            build_conversation_body(
                session,
                messages=[],
                model="auto",
                prepare_state="none",
                reasoning_effort="x\nmalformed",
            )
        self.assertEqual(caught.exception.stage, "validation")


if __name__ == "__main__":
    unittest.main()
