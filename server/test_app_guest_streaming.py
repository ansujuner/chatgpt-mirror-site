from __future__ import annotations

import asyncio
import json
import threading
import unittest
from unittest.mock import patch

from starlette.requests import Request

from . import app as application
from .protocol import ChatResult, ProtocolError, ProtocolSession


def _request_without_cookie(
    *, origin: str | None = None, fetch_site: str | None = None
) -> Request:
    headers = [(b"host", b"127.0.0.1:8787")]
    if origin is not None:
        headers.append((b"origin", origin.encode("ascii")))
    if fetch_site is not None:
        headers.append((b"sec-fetch-site", fetch_site.encode("ascii")))
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/api/chat/completions",
            "raw_path": b"/api/chat/completions",
            "query_string": b"",
            "headers": headers,
            "client": ("127.0.0.1", 49152),
            "server": ("127.0.0.1", 8787),
        }
    )


class _HTTP:
    def __init__(self) -> None:
        self.closed = False

    def close(self) -> None:
        self.closed = True


def _session() -> ProtocolSession:
    return ProtocolSession(
        http=_HTTP(),
        session_id="session-1",
        document_affinity="affinity",
        worker_version="worker",
        worker_override="override",
        build="build",
        fingerprint_session="fingerprint",
        base_headers={"User-Agent": "test"},
    )


def _result(answer: str) -> ChatResult:
    return ChatResult(
        answer=answer,
        conversation_id="upstream-conversation-secret",
        conversation_state={"parentMessageId": "assistant-1"},
        assistant_message_id="assistant-1",
        upstream_request_id="upstream-request-secret",
        attempts=2,
    )


class _FakeGuestStream:
    def __init__(
        self,
        session: ProtocolSession,
        deltas: list[str],
        *,
        final_result: ChatResult | None,
        failure: ProtocolError | None = None,
    ) -> None:
        self.session = session
        self.attempts = 2
        self.result: ChatResult | None = None
        self._deltas = list(deltas)
        self._final_result = final_result
        self._failure = failure
        self.closed = False

    def next_delta(self) -> str | None:
        if self._deltas:
            return self._deltas.pop(0)
        if self._failure is not None:
            failure = self._failure
            self._failure = None
            raise failure
        if self._final_result is not None and self.result is None:
            self.result = self._final_result
            self.session.conversation_id = self.result.conversation_id
            self.session.conversation_state = self.result.conversation_state
        return None

    def close(self) -> None:
        self.closed = True


def _context(
    stream: _FakeGuestStream,
    *,
    public_id: str = "guestconv-opaque-local-handle",
) -> application.GuestChatStreamContext:
    stream.session.lock.acquire()
    return application.GuestChatStreamContext(
        session=stream.session,
        stream=stream,  # type: ignore[arg-type]
        owner="guest",
        public_conversation_id=public_id,
        previous_id=None,
        new_session=True,
    )


async def _call_and_collect(
    context: application.GuestChatStreamContext,
) -> tuple[application.StreamingResponse, bytes]:
    request = application.ChatCompletionRequest(
        messages=[application.ChatMessage(role="user", content="hello")],
        stream=True,
    )
    with patch.object(application, "_open_guest_chat_stream", return_value=context):
        response = await application.chat_completions(
            _request_without_cookie(), request, None, None
        )
        assert isinstance(response, application.StreamingResponse)
        chunks: list[bytes] = []
        async for chunk in response.body_iterator:
            chunks.append(chunk if isinstance(chunk, bytes) else chunk.encode("utf-8"))
        return response, b"".join(chunks)


class GuestStreamingApplicationTests(unittest.TestCase):
    def test_cross_origin_chat_is_rejected_before_guest_execution(self) -> None:
        request = application.ChatCompletionRequest(
            messages=[application.ChatMessage(role="user", content="hello")],
            stream=True,
        )

        async def exercise():  # type: ignore[no-untyped-def]
            with patch.object(application, "_open_guest_chat_stream") as open_stream:
                response = await application.chat_completions(
                    _request_without_cookie(
                        origin="https://attacker.example",
                        fetch_site="cross-site",
                    ),
                    request,
                    None,
                    None,
                )
                open_stream.assert_not_called()
                return response

        response = asyncio.run(exercise())
        self.assertEqual(response.status_code, 403)
        self.assertEqual(json.loads(response.body)["error"]["code"], "origin_not_allowed")

    def test_stream_forwards_real_deltas_then_commits_opaque_registry_handle(self) -> None:
        session = _session()
        public_id = "guestconv-opaque-local-handle"
        stream = _FakeGuestStream(
            session,
            ["alpha", " beta"],
            final_result=_result("alpha beta"),
        )
        context = _context(stream, public_id=public_id)
        before_slots = application.UPSTREAM_SEMAPHORE._value

        response, body = asyncio.run(_call_and_collect(context))

        self.assertEqual(response.headers["X-Conversation-Id"], public_id)
        self.assertEqual(response.headers["X-ChatGPT-Bridge-Attempts"], "2")
        self.assertIn(b'"content":"alpha"', body)
        self.assertIn(b'"content":" beta"', body)
        self.assertIn(b'"finish_reason":"stop"', body)
        self.assertTrue(body.endswith(b"data: [DONE]\n\n"))
        self.assertNotIn(b"upstream-conversation-secret", body)
        self.assertNotIn("upstream-conversation-secret", response.headers.values())
        self.assertIs(application.REGISTRY.get(public_id, owner="guest"), session)
        self.assertEqual(application.UPSTREAM_SEMAPHORE._value, before_slots)
        self.assertTrue(session.lock.acquire(blocking=False))
        session.lock.release()
        application.REGISTRY.remove(public_id, owner="guest", expected_session=session)

    def test_failure_after_delta_emits_error_without_stop_or_done(self) -> None:
        session = _session()
        public_id = "guestconv-failed-local-handle"
        stream = _FakeGuestStream(
            session,
            ["partial"],
            final_result=None,
            failure=ProtocolError(
                "upstream_unavailable",
                "The upstream stream failed.",
                stage="conversation_dpu",
                retryable=True,
            ),
        )
        context = _context(stream, public_id=public_id)
        before_slots = application.UPSTREAM_SEMAPHORE._value

        _, body = asyncio.run(_call_and_collect(context))

        self.assertIn(b'"content":"partial"', body)
        self.assertIn(b'"code":"upstream_unavailable"', body)
        self.assertNotIn(b'"finish_reason":"stop"', body)
        self.assertNotIn(b"data: [DONE]", body)
        self.assertIsNone(application.REGISTRY.get(public_id, owner="guest"))
        self.assertTrue(session.closed)
        self.assertTrue(stream.closed)
        self.assertEqual(application.UPSTREAM_SEMAPHORE._value, before_slots)
        self.assertTrue(session.lock.acquire(blocking=False))
        session.lock.release()

    def test_setup_failure_keeps_http_error_semantics_and_releases_slot(self) -> None:
        request = application.ChatCompletionRequest(
            messages=[application.ChatMessage(role="user", content="hello")],
            stream=True,
        )
        before_slots = application.UPSTREAM_SEMAPHORE._value

        async def exercise():  # type: ignore[no-untyped-def]
            with patch.object(
                application,
                "_open_guest_chat_stream",
                side_effect=ProtocolError(
                    "conversation_update_network_error",
                    "The upstream request failed.",
                    stage="conversation_update",
                    retryable=False,
                ),
            ):
                return await application.chat_completions(
                    _request_without_cookie(), request, None, None
                )

        response = asyncio.run(exercise())
        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            json.loads(response.body)["error"]["code"],
            "conversation_update_network_error",
        )
        self.assertEqual(application.UPSTREAM_SEMAPHORE._value, before_slots)

    def test_client_disconnect_aborts_uncommitted_stream_and_releases_lock(self) -> None:
        session = _session()
        public_id = "guestconv-disconnected-local-handle"
        stream = _FakeGuestStream(
            session,
            ["partial", "unread"],
            final_result=None,
        )
        context = _context(stream, public_id=public_id)
        request = application.ChatCompletionRequest(
            messages=[application.ChatMessage(role="user", content="hello")],
            stream=True,
        )
        before_slots = application.UPSTREAM_SEMAPHORE._value

        async def exercise() -> None:
            with patch.object(application, "_open_guest_chat_stream", return_value=context):
                response = await application.chat_completions(
                    _request_without_cookie(), request, None, None
                )
                assert isinstance(response, application.StreamingResponse)
                iterator = response.body_iterator
                await anext(iterator)  # role
                await anext(iterator)  # first assistant delta
                await iterator.aclose()

        asyncio.run(exercise())
        self.assertTrue(stream.closed)
        self.assertTrue(session.closed)
        self.assertIsNone(application.REGISTRY.get(public_id, owner="guest"))
        self.assertEqual(application.UPSTREAM_SEMAPHORE._value, before_slots)
        self.assertTrue(session.lock.acquire(blocking=False))
        session.lock.release()

    def test_disconnect_during_setup_reclaims_eventual_worker_context(self) -> None:
        session = _session()
        stream = _FakeGuestStream(session, ["never sent"], final_result=None)
        context = _context(stream, public_id="guestconv-setup-cancelled")
        started = threading.Event()
        release = threading.Event()
        request = application.ChatCompletionRequest(
            messages=[application.ChatMessage(role="user", content="hello")],
            stream=True,
        )
        before_slots = application.UPSTREAM_SEMAPHORE._value

        def delayed_setup(*_args):  # type: ignore[no-untyped-def]
            started.set()
            release.wait(timeout=2)
            return context

        async def exercise() -> None:
            with patch.object(application, "_open_guest_chat_stream", delayed_setup):
                task = asyncio.create_task(
                    application.chat_completions(
                        _request_without_cookie(), request, None, None
                    )
                )
                self.assertTrue(await asyncio.to_thread(started.wait, 1))
                task.cancel()
                release.set()
                with self.assertRaises(asyncio.CancelledError):
                    await task

        asyncio.run(exercise())
        self.assertTrue(stream.closed)
        self.assertTrue(session.closed)
        self.assertEqual(application.UPSTREAM_SEMAPHORE._value, before_slots)
        self.assertTrue(session.lock.acquire(blocking=False))
        session.lock.release()


if __name__ == "__main__":
    unittest.main()
