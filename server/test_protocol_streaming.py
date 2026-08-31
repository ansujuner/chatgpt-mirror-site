from __future__ import annotations

import html
import json
import unittest

from bs4 import BeautifulSoup

from .protocol import (
    DpuFrameDecoder,
    GuestProtocolBridge,
    GuestTurnStream,
    ProtocolError,
    ProtocolSession,
    RequirementsGrant,
    _safe_assistant_frame_delta,
    parse_dpu_response,
)


def _frame(inner: str) -> bytes:
    length = len(inner.encode("utf-16-le")) // 2
    return (
        f'<template data-web-mobile-dpu-frame="{length}">'.encode("ascii")
        + inner.encode("utf-8")
        + b"</template>"
    )


def _conversation_id_frame(conversation_id: str = "conversation-1") -> bytes:
    return _frame(
        '<template for="conversation-partial-control" '
        'data-web-mobile-dpu-apply="append">'
        '<span data-conversation-control="conversation-id" '
        f'data-conversation-id="{conversation_id}"></span></template>'
    )


def _assistant_root_frame(content_html: str) -> bytes:
    return _frame(
        '<template for="assistant-pending-turn-pending" '
        'data-web-mobile-dpu-apply="replace">'
        '<?start name="assistant-pending-turn-pending">'
        '<p data-assistant-stream-block="" data-assistant-stream-block-index="0">'
        f'{content_html}<?marker name="assistant-pending-turn-pending-tail"></p>'
        '<?end></template>'
    )


def _assistant_tail_frame(content_html: str) -> bytes:
    return _frame(
        '<template for="assistant-pending-turn-pending-tail" '
        f'data-web-mobile-dpu-apply="append">{content_html}'
        '<?marker name="assistant-pending-turn-pending-tail"></template>'
    )


def _complete_frame(answer: str, conversation_id: str = "conversation-1") -> bytes:
    state = {
        "backendConversationId": conversation_id,
        "messages": [],
        "parentMessageId": "assistant-1",
        "userMessageCount": 1,
    }
    conversation = {
        "backendConversationId": conversation_id,
        "messages": [
            {"id": "user-1", "role": "user", "content": "hello"},
            {"id": "assistant-1", "role": "assistant", "content": answer},
        ],
    }
    return _frame(
        '<template for="conversation-partial-control" '
        'data-web-mobile-dpu-apply="append">'
        '<span data-conversation-control="complete" '
        f'data-conversation="{html.escape(json.dumps(conversation), quote=True)}" '
        f'data-conversation-state="{html.escape(json.dumps(state), quote=True)}">'
        "</span></template>"
    )


def _failed_frame(code: str = "upstream_unavailable") -> bytes:
    return _frame(
        '<template for="conversation-partial-control" '
        'data-web-mobile-dpu-apply="append">'
        f'<span data-conversation-control="failed" data-error-code="{code}">'
        "</span></template>"
    )


def _representative_stream() -> bytes:
    """A credential-free DPU stream with the same incremental shape as capture."""

    answer = "我可以帮你回答问题、分析信息，并协助完成实际任务。"
    return b"".join(
        [
            _conversation_id_frame("conversation-representative"),
            _assistant_root_frame("我可以帮你回答问题"),
            _assistant_tail_frame("、分析信息"),
            _assistant_tail_frame("，并协助完成实际任务。"),
            _complete_frame(answer, "conversation-representative"),
        ]
    )


class _HTTP:
    def close(self) -> None:
        pass


class _StreamingResponse:
    status_code = 200

    def __init__(self, chunks: list[bytes]) -> None:
        self.headers = {"x-request-id": "request-1"}
        self._chunks = chunks
        self.consumed = 0
        self.closed = False

    def iter_content(self):  # type: ignore[no-untyped-def]
        for chunk in self._chunks:
            self.consumed += 1
            yield chunk

    def close(self) -> None:
        self.closed = True


class _JSONResponse:
    status_code = 200
    headers = {"x-request-id": "prepare-request"}

    def json(self) -> dict[str, str]:
        return {"conduit_token": "conduit"}


class _ConversationHTTP:
    def __init__(self, update_response: _StreamingResponse) -> None:
        self.update_response = update_response
        self.calls: list[tuple[str, str, dict[str, object]]] = []

    def request(self, method: str, url: str, **kwargs):  # type: ignore[no-untyped-def]
        self.calls.append((method, url, kwargs))
        if "/conversation/prepare" in url:
            return _JSONResponse()
        if "/conversation/updates" in url:
            return self.update_response
        raise AssertionError(url)

    def close(self) -> None:
        pass


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


class DpuFrameDecoderTests(unittest.TestCase):
    def test_arbitrary_byte_boundaries_preserve_multibyte_frames(self) -> None:
        first = _assistant_root_frame("你")
        second = _assistant_tail_frame("好")
        raw = first + second
        decoder = DpuFrameDecoder()
        frames: list[str] = []
        for byte in raw:
            frames.extend(decoder.feed(bytes([byte])))
        decoder.finish()

        self.assertEqual(len(frames), 2)
        self.assertIn("你", frames[0])
        self.assertIn("好", frames[1])
        self.assertEqual(decoder.raw_bytes, raw)

    def test_representative_dpu_decodes_at_multiple_transport_boundaries(self) -> None:
        raw = _representative_stream()
        expected = parse_dpu_response(raw.decode("utf-8"))

        for chunk_size in (1, 7, 257, len(raw)):
            with self.subTest(chunk_size=chunk_size):
                decoder = DpuFrameDecoder()
                frames: list[str] = []
                for index in range(0, len(raw), chunk_size):
                    frames.extend(decoder.feed(raw[index : index + chunk_size]))
                decoder.finish()
                deltas: list[str] = []
                blocked = False
                for frame_html in frames:
                    delta, unsafe = _safe_assistant_frame_delta(
                        BeautifulSoup(frame_html, "html.parser")
                    )
                    blocked = blocked or unsafe
                    if not blocked and delta:
                        deltas.append(delta)

                self.assertEqual(len(frames), 5)
                self.assertEqual("".join(deltas), expected.answer)
                self.assertEqual(decoder.raw_bytes, raw)

    def test_truncated_frame_is_never_accepted(self) -> None:
        decoder = DpuFrameDecoder()
        decoder.feed(_assistant_root_frame("hello")[:-1])
        with self.assertRaises(ProtocolError) as caught:
            decoder.finish()
        self.assertEqual(caught.exception.code, "dpu_truncated_frame")

    def test_zero_length_frame_is_valid(self) -> None:
        raw = b'<template data-web-mobile-dpu-frame="0"></template>'
        decoder = DpuFrameDecoder()
        self.assertEqual(decoder.feed(raw), [""])
        decoder.finish()
        self.assertEqual(decoder.raw_bytes, raw)

    def test_terminal_json_preserves_literal_html_entity_text(self) -> None:
        for answer in ("literal &amp;", "numeric &#123;", "named &copy;"):
            with self.subTest(answer=answer):
                parsed = parse_dpu_response(_complete_frame(answer).decode("utf-8"))
                self.assertEqual(parsed.answer, answer)


class GuestTurnStreamTests(unittest.TestCase):
    def test_conversation_update_is_opened_with_curl_stream_mode(self) -> None:
        update_response = _StreamingResponse(
            [_assistant_root_frame("hello"), _complete_frame("hello")]
        )
        http = _ConversationHTTP(update_response)
        session = _session()
        session.http = http
        bridge = GuestProtocolBridge()

        opened, request_id = bridge._conversation_attempt(
            session,
            "hello",
            RequirementsGrant("requirements", "proof", "turnstile"),
            stream=True,
        )

        self.assertIsInstance(opened, GuestTurnStream)
        self.assertEqual(request_id, "request-1")
        update_call = [call for call in http.calls if "/conversation/updates" in call[1]][0]
        self.assertIs(update_call[2]["stream"], True)
        assert isinstance(opened, GuestTurnStream)
        opened.close()

    def test_representative_stream_emits_before_terminal_and_commits_answer(self) -> None:
        raw = _representative_stream()
        expected = parse_dpu_response(raw.decode("utf-8"))
        chunks = [raw[index : index + 97] for index in range(0, len(raw), 97)]
        response = _StreamingResponse(chunks)
        session = _session()
        stream = GuestTurnStream(
            session,
            response,
            attempts=1,
            upstream_request_id="request-1",
        )

        stream.prime()
        self.assertLess(response.consumed, len(chunks))
        deltas = list(stream.iter_deltas())

        self.assertGreater(len(deltas), 1)
        self.assertEqual("".join(deltas), expected.answer)
        self.assertIsNotNone(stream.result)
        assert stream.result is not None
        self.assertEqual(stream.result.answer, expected.answer)
        self.assertEqual(session.conversation_state, expected.conversation_state)

    def test_prime_stops_at_first_real_delta_and_terminal_commits_state(self) -> None:
        session = _session()
        response = _StreamingResponse(
            [
                _conversation_id_frame(),
                _assistant_root_frame("你好"),
                _assistant_tail_frame("，世界"),
                _complete_frame("你好，世界"),
            ]
        )
        stream = GuestTurnStream(
            session,
            response,
            attempts=1,
            upstream_request_id="request-1",
        )

        stream.prime()
        self.assertEqual(response.consumed, 2)
        self.assertEqual(stream.next_delta(), "你好")
        self.assertEqual(stream.next_delta(), "，世界")
        self.assertIsNone(stream.next_delta())

        self.assertIsNotNone(stream.result)
        assert stream.result is not None
        self.assertEqual(stream.result.answer, "你好，世界")
        self.assertEqual(session.conversation_id, "conversation-1")
        self.assertEqual(session.conversation_state["parentMessageId"], "assistant-1")
        self.assertTrue(response.closed)

    def test_repeated_replace_snapshot_is_not_emitted_twice(self) -> None:
        session = _session()
        stream = GuestTurnStream(
            session,
            _StreamingResponse(
                [
                    _assistant_root_frame("移动测试"),
                    _assistant_root_frame("移动测试"),
                    _complete_frame("移动测试"),
                ]
            ),
            attempts=1,
            upstream_request_id="request-1",
        )

        stream.prime()
        self.assertEqual(list(stream.iter_deltas()), ["移动测试"])
        assert stream.result is not None
        self.assertEqual(stream.result.answer, "移动测试")

    def test_extended_replace_snapshot_only_emits_new_suffix(self) -> None:
        session = _session()
        stream = GuestTurnStream(
            session,
            _StreamingResponse(
                [
                    _assistant_root_frame("移动"),
                    _assistant_root_frame("移动测试"),
                    _complete_frame("移动测试"),
                ]
            ),
            attempts=1,
            upstream_request_id="request-1",
        )

        stream.prime()
        self.assertEqual(list(stream.iter_deltas()), ["移动", "测试"])
        assert stream.result is not None
        self.assertEqual(stream.result.answer, "移动测试")

    def test_append_followed_by_matching_replace_snapshot_is_not_duplicated(self) -> None:
        session = _session()
        stream = GuestTurnStream(
            session,
            _StreamingResponse(
                [
                    _assistant_root_frame("移动"),
                    _assistant_tail_frame("测试"),
                    _assistant_root_frame("移动测试"),
                    _complete_frame("移动测试"),
                ]
            ),
            attempts=1,
            upstream_request_id="request-1",
        )

        stream.prime()
        self.assertEqual(list(stream.iter_deltas()), ["移动", "测试"])
        assert stream.result is not None
        self.assertEqual(stream.result.answer, "移动测试")

    def test_rendered_semantic_markup_waits_for_terminal_markdown(self) -> None:
        session = _session()
        response = _StreamingResponse(
            [
                _assistant_root_frame("Here is <strong>bold</strong>"),
                _complete_frame("Here is **bold**"),
            ]
        )
        stream = GuestTurnStream(
            session,
            response,
            attempts=1,
            upstream_request_id="request-1",
        )

        stream.prime()
        self.assertEqual(response.consumed, 2)
        self.assertEqual(stream.next_delta(), "Here is **bold**")
        self.assertIsNone(stream.next_delta())

    def test_failure_after_delta_is_explicit_and_does_not_commit(self) -> None:
        session = _session()
        original_state = dict(session.conversation_state)
        response = _StreamingResponse(
            [_assistant_root_frame("partial"), _failed_frame()]
        )
        stream = GuestTurnStream(
            session,
            response,
            attempts=1,
            upstream_request_id="request-1",
        )

        stream.prime()
        self.assertEqual(stream.next_delta(), "partial")
        with self.assertRaises(ProtocolError) as caught:
            stream.next_delta()
        self.assertEqual(caught.exception.code, "upstream_unavailable")
        self.assertIsNone(stream.result)
        self.assertEqual(session.conversation_state, original_state)
        self.assertIsNone(session.conversation_id)
        self.assertTrue(response.closed)

    def test_closed_uncommitted_stream_fails_instead_of_spinning(self) -> None:
        stream = GuestTurnStream(
            _session(),
            _StreamingResponse([]),
            attempts=1,
            upstream_request_id="request-1",
        )
        stream.close()

        with self.assertRaises(ProtocolError) as caught:
            stream.next_delta()
        self.assertEqual(caught.exception.code, "conversation_stream_closed")

    def test_eof_without_terminal_closes_the_response(self) -> None:
        response = _StreamingResponse([_assistant_root_frame("partial")])
        stream = GuestTurnStream(
            _session(),
            response,
            attempts=1,
            upstream_request_id="request-1",
        )

        stream.prime()
        self.assertEqual(stream.next_delta(), "partial")
        with self.assertRaises(ProtocolError) as caught:
            stream.next_delta()
        self.assertEqual(caught.exception.code, "dpu_missing_complete")
        self.assertTrue(response.closed)

    def test_truncated_eof_closes_the_response(self) -> None:
        response = _StreamingResponse([_complete_frame("hello")[:-1]])
        stream = GuestTurnStream(
            _session(),
            response,
            attempts=1,
            upstream_request_id="request-1",
        )

        with self.assertRaises(ProtocolError) as caught:
            stream.prime()
        self.assertEqual(caught.exception.code, "dpu_truncated_frame")
        self.assertTrue(response.closed)

    def test_terminal_mismatch_after_delta_is_not_silent_success(self) -> None:
        session = _session()
        stream = GuestTurnStream(
            session,
            _StreamingResponse(
                [_assistant_root_frame("prefix"), _complete_frame("different")]
            ),
            attempts=1,
            upstream_request_id="request-1",
        )

        stream.prime()
        self.assertEqual(stream.next_delta(), "prefix")
        with self.assertRaises(ProtocolError) as caught:
            stream.next_delta()
        self.assertEqual(caught.exception.code, "dpu_stream_prefix_mismatch")
        self.assertIsNone(stream.result)
        self.assertIsNone(session.conversation_id)

    def test_streamed_entity_literals_match_the_terminal_source(self) -> None:
        answer = "literal &amp; numeric &#123; named &copy;"
        session = _session()
        stream = GuestTurnStream(
            session,
            _StreamingResponse(
                [
                    _assistant_root_frame(html.escape(answer)),
                    _complete_frame(answer),
                ]
            ),
            attempts=1,
            upstream_request_id="request-1",
        )

        stream.prime()
        self.assertEqual("".join(stream.iter_deltas()), answer)
        self.assertIsNotNone(stream.result)
        assert stream.result is not None
        self.assertEqual(stream.result.answer, answer)


if __name__ == "__main__":
    unittest.main()
