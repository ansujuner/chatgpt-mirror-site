from __future__ import annotations

import asyncio
import json
import os
import threading
import unittest
from unittest.mock import patch

from starlette.requests import Request

from . import app as application
from .auth_session import (
    AuthSessionError,
    AuthenticatedUpstream,
    PublicAccount,
    UpstreamCredential,
)
from .authenticated_history import (
    AuthenticatedHistoryBridge,
    AuthenticatedHistoryConfig,
    AuthenticatedHistoryRegistry,
    HistoryDetail,
    HistoryMessage,
    HistoryPage,
    HistorySummary,
)
from .authenticated_protocol import (
    AuthenticatedChatResult,
    AuthenticatedProtocolSession,
)


class _Credential:
    access_token = "access-secret"
    cookie_header = "session=cookie-secret"
    account_id = "account-1"


class _Response:
    def __init__(
        self,
        status: int,
        payload: object,
        *,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.status_code = status
        self._payload = payload
        self.content = json.dumps(payload).encode("utf-8")
        self.headers = headers or {}

    def json(self):  # type: ignore[no-untyped-def]
        return self._payload


class _HTTP:
    def __init__(self, responses: list[_Response | Exception] | None = None) -> None:
        self.responses = list(responses or [])
        self.calls: list[dict[str, object]] = []
        self.closed = False

    def get(self, url: str, **kwargs):  # type: ignore[no-untyped-def]
        self.calls.append({"url": url, **kwargs})
        if not self.responses:
            raise AssertionError("unexpected history request")
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    def close(self) -> None:
        self.closed = True


def _config(**overrides):  # type: ignore[no-untyped-def]
    values = {
        "origin": "https://chatgpt.com",
        "timeout_seconds": 10,
        "network_attempts": 3,
        "verify_tls": False,
        "page_turns": 100,
        "max_message_pages": 8,
        "max_messages": 100,
        "max_response_bytes": 1024 * 1024,
    }
    values.update(overrides)
    return AuthenticatedHistoryConfig(**values)


def _message(
    identifier: str,
    role: str,
    text: str,
    parent: str | None,
    created: float,
    *,
    content_type: str = "text",
    hidden: bool = False,
) -> dict[str, object]:
    return {
        "id": identifier,
        "author": {"role": role},
        "content": {"content_type": content_type, "parts": [text]},
        "parent_id": parent,
        "create_time": created,
        "metadata": {"is_visually_hidden_from_conversation": hidden},
    }


class AuthenticatedHistoryBridgeTests(unittest.TestCase):
    def test_history_network_attempts_have_an_independent_default_and_override(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(
                AuthenticatedHistoryConfig.from_environment().network_attempts,
                2,
            )
        with patch.dict(
            os.environ,
            {
                "CHATGPT_AUTH_UPSTREAM_NETWORK_ATTEMPTS": "5",
                "CHATGPT_AUTH_HISTORY_NETWORK_ATTEMPTS": "4",
            },
            clear=True,
        ):
            self.assertEqual(
                AuthenticatedHistoryConfig.from_environment().network_attempts,
                4,
            )

    def test_transient_network_failure_retries_history_get(self) -> None:
        http = _HTTP(
            [
                OSError("credential-bearing-network-error"),
                _Response(200, {"items": [], "total": 0, "limit": 28, "offset": 0}),
            ]
        )
        bridge = AuthenticatedHistoryBridge(_config(), http_factory=lambda: http)

        with patch("server.authenticated_history.time.sleep") as sleep:
            page = bridge.list_conversations(_Credential())

        self.assertEqual(page.total, 0)
        self.assertEqual(len(http.calls), 2)
        sleep.assert_called_once()

    def test_persistent_network_failure_stops_after_configured_attempts(self) -> None:
        http = _HTTP([OSError("secret-one"), OSError("secret-two")])
        bridge = AuthenticatedHistoryBridge(
            _config(network_attempts=2), http_factory=lambda: http
        )

        with (
            patch("server.authenticated_history.time.sleep"),
            self.assertRaises(AuthSessionError) as caught,
        ):
            bridge.list_conversations(_Credential())

        self.assertEqual(caught.exception.code, "history_list_network_error")
        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual(len(http.calls), 2)
        self.assertNotIn("secret", caught.exception.message)

    def test_transient_http_status_retries_idempotent_history_get(self) -> None:
        http = _HTTP(
            [
                _Response(503, {"error": "temporary"}),
                _Response(200, {"items": [], "total": 0, "limit": 28, "offset": 0}),
            ]
        )
        bridge = AuthenticatedHistoryBridge(_config(), http_factory=lambda: http)

        with patch("server.authenticated_history.time.sleep") as sleep:
            page = bridge.list_conversations(_Credential())

        self.assertEqual(page.total, 0)
        self.assertEqual(len(http.calls), 2)
        sleep.assert_called_once_with(0.2)

    def test_rate_limit_is_not_automatically_retried(self) -> None:
        http = _HTTP([_Response(429, {}, headers={"Retry-After": "120"})])
        bridge = AuthenticatedHistoryBridge(_config(), http_factory=lambda: http)

        with (
            patch("server.authenticated_history.time.sleep") as sleep,
            self.assertRaises(AuthSessionError) as caught,
        ):
            bridge.list_conversations(_Credential())

        self.assertEqual(caught.exception.code, "history_rate_limited")
        self.assertEqual(caught.exception.status_code, 429)
        self.assertEqual(len(http.calls), 1)
        sleep.assert_not_called()

    def test_list_uses_official_query_and_returns_only_whitelisted_fields(self) -> None:
        http = _HTTP(
            [
                _Response(
                    200,
                    {
                        "items": [
                            {
                                "id": "upstream-conv-1",
                                "title": " First\nchat ",
                                "create_time": "2026-08-31T01:02:03Z",
                                "update_time": "2026-08-31T02:03:04Z",
                                "mapping": {"secret": "must-not-survive"},
                                "workspace_id": "private-workspace",
                                "gizmo_id": "g-p-private-project",
                            }
                        ],
                        "total": 29,
                        "limit": 28,
                        "offset": 0,
                    },
                )
            ]
        )
        bridge = AuthenticatedHistoryBridge(_config(), http_factory=lambda: http)
        page = bridge.list_conversations(_Credential())

        self.assertEqual(page.total, 29)
        self.assertEqual(page.items[0].title, "First chat")
        self.assertEqual(page.items[0].upstream_id, "upstream-conv-1")
        self.assertEqual(page.items[0].project_id, "g-p-private-project")
        call = http.calls[0]
        self.assertEqual(call["url"], "https://chatgpt.com/backend-api/conversations")
        self.assertEqual(
            call["params"],
            {
                "offset": 0,
                "limit": 28,
                "order": "updated",
                "is_archived": "false",
                "is_starred": "false",
            },
        )
        headers = call["headers"]
        self.assertEqual(headers["ChatGPT-Account-ID"], "account-1")
        self.assertEqual(headers["Authorization"], "Bearer access-secret")
        self.assertTrue(http.closed)
        self.assertNotIn("private-workspace", repr(page))
        self.assertNotIn("g-p-private-project", repr(page))

    def test_paginated_detail_reconstructs_branch_and_hides_thoughts(self) -> None:
        first = {
            "title": "Real title",
            "create_time": 1_700_000_000,
            "update_time": 1_700_000_100,
            "current_node": "a2",
            "default_model_slug": "gpt-5-6-thinking",
            "messages": [
                _message("u2", "user", "second", "a1", 4),
                _message("thought", "assistant", "private chain", "u2", 5, content_type="thoughts"),
                _message("a2", "assistant", "answer two", "thought", 6),
            ],
            "page_info": {"has_previous_page": True, "start_cursor": "cursor-1=="},
        }
        older = {
            "messages": [
                _message("u1", "user", "first", None, 1),
                _message("a1", "assistant", "answer one", "u1", 2),
            ],
            "page_info": {"has_previous_page": False, "start_cursor": None},
        }
        http = _HTTP([_Response(200, first), _Response(200, older)])
        bridge = AuthenticatedHistoryBridge(_config(), http_factory=lambda: http)
        detail = bridge.get_conversation(
            _Credential(), "conversation-1", project_id="g-p-private-project"
        )

        self.assertEqual(detail.current_node, "a2")
        self.assertEqual(detail.model, "gpt-5-6-thinking")
        self.assertEqual(
            [(message.role, message.content) for message in detail.messages],
            [
                ("user", "first"),
                ("assistant", "answer one"),
                ("user", "second"),
                ("assistant", "answer two"),
            ],
        )
        self.assertNotIn("private chain", repr(detail.messages))
        self.assertEqual(
            http.calls[1]["params"],
            {"before": "cursor-1==", "include_has_versions": "true", "num_turns": 100},
        )
        self.assertEqual(
            http.calls[0]["headers"]["chatgpt-project-id"], "g-p-private-project"
        )
        self.assertEqual(
            http.calls[1]["headers"]["chatgpt-project-id"], "g-p-private-project"
        )

    def test_paginated_messages_without_parent_fields_are_all_preserved(self) -> None:
        def no_parent(identifier: str, role: str, text: str, created: int):
            return {
                "id": identifier,
                "author": {"role": role},
                "content": {"content_type": "text", "parts": [text]},
                # Some paginated variants retain the field but set it to null
                # for every item instead of omitting it.
                "parent_id": None,
                "create_time": created,
                "metadata": {},
            }

        first = {
            "title": "No parents",
            "current_node": "a2",
            "messages": [
                no_parent("u2", "user", "second", 30),
                no_parent("a2", "assistant", "answer two", 40),
            ],
            "page_info": {"has_previous_page": True, "start_cursor": "older"},
        }
        older = {
            "messages": [
                no_parent("u1", "user", "first", 10),
                no_parent("a1", "assistant", "answer one", 20),
            ],
            "page_info": {"has_previous_page": False},
        }
        http = _HTTP([_Response(200, first), _Response(200, older)])
        bridge = AuthenticatedHistoryBridge(_config(), http_factory=lambda: http)
        detail = bridge.get_conversation(_Credential(), "conversation-no-parents")
        self.assertEqual(
            [message.content for message in detail.messages],
            ["first", "answer one", "second", "answer two"],
        )

    def test_transient_older_page_failure_keeps_recent_history(self) -> None:
        first = {
            "title": "Recent page survives",
            "current_node": "a2",
            "messages": [
                _message("u2", "user", "second", None, 30),
                _message("a2", "assistant", "answer two", "u2", 40),
            ],
            "page_info": {"has_previous_page": True, "start_cursor": "older"},
        }
        http = _HTTP(
            [
                _Response(200, first),
                _Response(503, {}),
                _Response(503, {}),
                _Response(503, {}),
            ]
        )
        bridge = AuthenticatedHistoryBridge(_config(), http_factory=lambda: http)

        with patch("server.authenticated_history.time.sleep"):
            detail = bridge.get_conversation(_Credential(), "conversation-partial")

        self.assertEqual(
            [message.content for message in detail.messages],
            ["second", "answer two"],
        )
        self.assertEqual(len(http.calls), 4)

    def test_repeated_older_page_cursor_keeps_loaded_messages(self) -> None:
        first = {
            "title": "Repeated cursor",
            "current_node": "a2",
            "messages": [_message("a2", "assistant", "newest", None, 40)],
            "page_info": {"has_previous_page": True, "start_cursor": "same"},
        }
        older = {
            "messages": [_message("u1", "user", "older", None, 10)],
            "page_info": {"has_previous_page": True, "start_cursor": "same"},
        }
        http = _HTTP([_Response(200, first), _Response(200, older)])
        bridge = AuthenticatedHistoryBridge(_config(), http_factory=lambda: http)

        detail = bridge.get_conversation(_Credential(), "conversation-loop")

        self.assertEqual(
            [message.content for message in detail.messages],
            ["older", "newest"],
        )
        self.assertEqual(len(http.calls), 2)

    def test_message_limit_truncates_to_recent_history_instead_of_failing(self) -> None:
        first = {
            "title": "Long conversation",
            "current_node": "a3",
            "messages": [
                _message("u3", "user", "recent user", None, 30),
                _message("a3", "assistant", "recent answer", "u3", 40),
            ],
            "page_info": {"has_previous_page": True, "start_cursor": "older"},
        }
        older = {
            "messages": [
                _message("u1", "user", "old user", None, 10),
                _message("a1", "assistant", "old answer", "u1", 20),
            ],
            "page_info": {"has_previous_page": False},
        }
        http = _HTTP([_Response(200, first), _Response(200, older)])
        bridge = AuthenticatedHistoryBridge(
            _config(max_messages=3), http_factory=lambda: http
        )

        detail = bridge.get_conversation(_Credential(), "conversation-long")

        self.assertEqual(
            [message.content for message in detail.messages],
            ["old answer", "recent user", "recent answer"],
        )

    def test_paginated_flat_order_ignores_partial_assistant_parent_chain(self) -> None:
        """A partial parent chain must not discard the preceding user prompt.

        The official paginated endpoint returns a linear messages array.  GPT
        conversations can nevertheless retain parent metadata on only some
        adjacent assistant/reasoning messages.  Treating that fragment as a
        complete branch reproduces the production bug where history contains
        the AI answer but none of the user's words.
        """

        user = _message("user-1", "user", "my visible prompt", None, 1)
        reasoning = _message(
            "assistant-reasoning",
            "assistant",
            "private reasoning",
            None,
            2,
            content_type="thoughts",
        )
        answer = _message(
            "assistant-final",
            "assistant",
            "visible answer",
            "assistant-reasoning",
            3,
        )
        payload = {
            "title": "Partial assistant chain",
            "current_node": "assistant-final",
            "messages": [user, reasoning, answer],
            "page_info": {"has_previous_page": False},
        }
        http = _HTTP([_Response(200, payload)])
        bridge = AuthenticatedHistoryBridge(_config(), http_factory=lambda: http)

        detail = bridge.get_conversation(_Credential(), "conversation-partial-chain")

        self.assertEqual(
            [(message.role, message.content) for message in detail.messages],
            [("user", "my visible prompt"), ("assistant", "visible answer")],
        )
        self.assertNotIn("private reasoning", repr(detail.messages))

    def test_legacy_mapping_is_used_when_paginated_endpoint_is_not_available(self) -> None:
        payload = {
            "title": "Legacy",
            "current_node": "assistant-1",
            "mapping": {
                "user-1": {
                    "parent": None,
                    "message": _message("user-1", "user", "hello", None, 1),
                },
                "assistant-1": {
                    "parent": "user-1",
                    "message": _message(
                        "assistant-1", "assistant", "world", "user-1", 2
                    ),
                },
            },
        }
        http = _HTTP([_Response(404, {}), _Response(200, payload)])
        bridge = AuthenticatedHistoryBridge(_config(), http_factory=lambda: http)
        detail = bridge.get_conversation(_Credential(), "conversation-legacy")
        self.assertEqual([message.content for message in detail.messages], ["hello", "world"])
        self.assertIn("/backend-api/conversation/conversation-legacy", http.calls[1]["url"])
        self.assertEqual(
            http.calls[1]["params"], {"include_full_conversation": "true"}
        )

    def test_legacy_mapping_recovers_from_incompatible_paginated_shape(self) -> None:
        legacy = {
            "title": "Legacy shape",
            "current_node": "assistant-1",
            "mapping": {
                "assistant-1": {
                    "parent": None,
                    "message": _message(
                        "assistant-1", "assistant", "recovered", None, 2
                    ),
                },
            },
        }
        http = _HTTP([_Response(200, {"mapping": {}}), _Response(200, legacy)])
        bridge = AuthenticatedHistoryBridge(_config(), http_factory=lambda: http)

        detail = bridge.get_conversation(_Credential(), "conversation-legacy-shape")

        self.assertEqual([message.content for message in detail.messages], ["recovered"])
        self.assertIn(
            "/backend-api/conversation/conversation-legacy-shape",
            http.calls[1]["url"],
        )

    def test_403_is_preserved_and_response_body_is_never_reflected(self) -> None:
        http = _HTTP([_Response(403, {"access_token": "leak-me"})])
        bridge = AuthenticatedHistoryBridge(_config(), http_factory=lambda: http)
        with self.assertRaises(AuthSessionError) as caught:
            bridge.list_conversations(_Credential())
        self.assertEqual(caught.exception.status_code, 403)
        self.assertEqual(caught.exception.code, "history_forbidden")
        self.assertNotIn("leak-me", caught.exception.message)


class AuthenticatedHistoryRegistryTests(unittest.TestCase):
    def test_bindings_are_stable_within_owner_and_isolated_between_accounts(self) -> None:
        registry = AuthenticatedHistoryRegistry(ttl_seconds=1000)
        summary = HistorySummary("upstream-1", "title", None, None)
        first = registry.bind("owner-a", summary)
        again = registry.bind("owner-a", summary)
        other = registry.bind("owner-b", summary)
        self.assertEqual(first.local_id, again.local_id)
        self.assertNotEqual(first.local_id, other.local_id)
        self.assertIsNone(registry.resolve("owner-b", first.local_id))
        self.assertEqual(registry.resolve("owner-a", first.local_id).upstream_id, "upstream-1")

    def test_logout_cleanup_removes_bindings_and_pagination_cursors(self) -> None:
        registry = AuthenticatedHistoryRegistry(ttl_seconds=1000)
        binding = registry.bind(
            "owner-a", HistorySummary("upstream-1", "title", None, None)
        )
        cursor = registry.create_cursor("owner-a", 28)
        registry.remove_owner("owner-a")
        self.assertIsNone(registry.resolve("owner-a", binding.local_id))
        self.assertIsNone(registry.resolve_cursor("owner-a", cursor))


class PendingAuthenticatedConversationTests(unittest.TestCase):
    class Session:
        def __init__(self) -> None:
            self.closed = False

        def close(self) -> None:
            self.closed = True

    @staticmethod
    def detail() -> HistoryDetail:
        return HistoryDetail(
            upstream_id="private-conversation",
            title="Pending",
            created_at=None,
            updated_at=None,
            current_node="private-node",
            model="gpt-5-6-thinking",
            messages=(),
        )

    def test_pending_resolution_is_owner_scoped_and_retries_after_failure(self) -> None:
        registry = application.AuthenticatedConversationRegistry(300, 4)
        local_id = registry.put_pending(self.detail(), owner="account:a")
        factory_calls = 0

        def fail_once(_detail):  # type: ignore[no-untyped-def]
            nonlocal factory_calls
            factory_calls += 1
            raise RuntimeError("bootstrap failed")

        self.assertIsNone(
            registry.get_or_resolve(
                local_id,
                owner="account:b",
                factory=lambda _: self.Session(),  # type: ignore[arg-type]
            )
        )
        with self.assertRaisesRegex(RuntimeError, "bootstrap failed"):
            registry.get_or_resolve(
                local_id,
                owner="account:a",
                factory=fail_once,
            )

        session = self.Session()
        resolved = registry.get_or_resolve(
            local_id,
            owner="account:a",
            factory=lambda _: session,  # type: ignore[arg-type]
        )
        self.assertIs(resolved, session)
        self.assertEqual(factory_calls, 1)
        registry.remove_owner("account:a")
        self.assertTrue(session.closed)
        self.assertEqual(registry.count(), 0)

    def test_concurrent_first_turn_bootstraps_pending_entry_once(self) -> None:
        registry = application.AuthenticatedConversationRegistry(300, 4)
        local_id = registry.put_pending(self.detail(), owner="account:a")
        started = threading.Event()
        release = threading.Event()
        session = self.Session()
        factory_calls = 0
        results: list[object | None] = []

        def factory(_detail):  # type: ignore[no-untyped-def]
            nonlocal factory_calls
            factory_calls += 1
            started.set()
            self.assertTrue(release.wait(timeout=2))
            return session

        def resolve() -> None:
            results.append(
                registry.get_or_resolve(
                    local_id,
                    owner="account:a",
                    factory=factory,
                )
            )

        first = threading.Thread(target=resolve)
        second = threading.Thread(target=resolve)
        first.start()
        self.assertTrue(started.wait(timeout=2))
        second.start()
        release.set()
        first.join(timeout=2)
        second.join(timeout=2)

        self.assertFalse(first.is_alive())
        self.assertFalse(second.is_alive())
        self.assertEqual(factory_calls, 1)
        self.assertEqual(results, [session, session])
        registry.close_all()

    def test_logout_during_lazy_bootstrap_closes_orphan_session(self) -> None:
        registry = application.AuthenticatedConversationRegistry(300, 4)
        local_id = registry.put_pending(self.detail(), owner="account:a")
        started = threading.Event()
        release = threading.Event()
        session = self.Session()
        results: list[object | None] = []

        def factory(_detail):  # type: ignore[no-untyped-def]
            started.set()
            self.assertTrue(release.wait(timeout=2))
            return session

        worker = threading.Thread(
            target=lambda: results.append(
                registry.get_or_resolve(
                    local_id,
                    owner="account:a",
                    factory=factory,
                )
            )
        )
        worker.start()
        self.assertTrue(started.wait(timeout=2))
        registry.remove_owner("account:a")
        release.set()
        worker.join(timeout=2)

        self.assertFalse(worker.is_alive())
        self.assertEqual(results, [None])
        self.assertTrue(session.closed)
        self.assertEqual(registry.count(), 0)


def _request(handle: str | None, path: str) -> Request:
    headers = [(b"host", b"127.0.0.1:8787")]
    if handle:
        headers.append(
            (b"cookie", f"{application.LOCAL_SESSION_COOKIE}={handle}".encode("ascii"))
        )
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": path,
            "raw_path": path.encode("ascii"),
            "query_string": b"",
            "headers": headers,
            "client": ("127.0.0.1", 1234),
            "server": ("127.0.0.1", 8787),
        }
    )


def _login() -> tuple[str, object]:
    upstream = AuthenticatedUpstream(
        account=PublicAccount(
            id="account-a",
            user_id="user-a",
            name="Test",
            email="test@example.invalid",
            initials="T",
            plan="pro",
            plan_label="Pro",
        ),
        credential=UpstreamCredential(
            kind="cookie",
            access_token="token-secret",
            access_token_expires_at_epoch=None,
            cookie_header="session=cookie-secret",
            account_id="account-a",
            user_id="user-a",
        ),
        expires_at_epoch=None,
    )
    handle, entry, _ = application.AUTH_REGISTRY.create(upstream)
    return handle, entry


class AuthenticatedHistoryAppTests(unittest.TestCase):
    def tearDown(self) -> None:
        application.AUTH_CONVERSATIONS.close_all()
        application.AUTH_HISTORY.clear()
        application.AUTH_REGISTRY.close_all()

    def test_list_and_detail_never_expose_upstream_identifiers(self) -> None:
        handle, _ = _login()
        page = HistoryPage(
            items=(
                HistorySummary(
                    "upstream-conversation-secret",
                    "A real chat",
                    "2026-08-31T01:00:00Z",
                    "2026-08-31T02:00:00Z",
                ),
            ),
            offset=0,
            limit=28,
            total=1,
        )
        with patch.object(application, "_history_read_with_refresh", return_value=page):
            response = asyncio.run(
                application.conversation_history(
                    _request(handle, "/api/conversations"), cursor=None, limit=28
                )
            )
        self.assertEqual(response.status_code, 200)
        body = json.loads(response.body)
        local_id = body["items"][0]["id"]
        self.assertTrue(local_id.startswith("hist-"))
        self.assertNotIn("upstream-conversation-secret", response.body.decode())

        detail = HistoryDetail(
            upstream_id="upstream-conversation-secret",
            title="A real chat",
            created_at=None,
            updated_at=None,
            current_node="upstream-current-node-secret",
            model="gpt-5-6-thinking",
            messages=(
                HistoryMessage("upstream-message-1", "user", "hello", None),
                HistoryMessage("upstream-message-2", "assistant", "world", None),
            ),
        )
        with (
            patch.object(application, "_history_read_with_refresh", return_value=detail),
            patch.object(application, "_create_history_continuation") as bootstrap,
        ):
            response = asyncio.run(
                application.conversation_history_detail(
                    local_id,
                    _request(handle, f"/api/conversations/{local_id}"),
                )
            )
        bootstrap.assert_not_called()
        self.assertEqual(response.status_code, 200)
        detail_body = json.loads(response.body)
        self.assertEqual(detail_body["conversation"]["id"], local_id)
        self.assertTrue(detail_body["continuationId"].startswith("authconv-"))
        self.assertTrue(all(item["id"].startswith("msg-") for item in detail_body["messages"]))
        serialized = response.body.decode()
        for secret in (
            "upstream-conversation-secret",
            "upstream-current-node-secret",
            "upstream-message-1",
            "upstream-message-2",
            "token-secret",
            "cookie-secret",
        ):
            self.assertNotIn(secret, serialized)

        protocol_session = AuthenticatedProtocolSession(
            http=_HTTP(),
            access_token="token-secret",
            cookie_header="session=cookie-secret",
            account_id="account-a",
        )
        chat_result = AuthenticatedChatResult(
            answer="continued",
            conversation_id="upstream-conversation-secret",
            conversation_state={"parentMessageId": "next-node"},
            parent_message_id="next-node",
            assistant_message_id="next-assistant",
            upstream_request_id=None,
            attempts=1,
            model="gpt-5-6-thinking",
        )
        owner = application.AUTH_REGISTRY.owner_key(handle)
        continuation_id = detail_body["continuationId"]
        with (
            patch.object(
                application,
                "_create_history_continuation",
                return_value=protocol_session,
            ) as bootstrap,
            patch.object(application.AUTH_BRIDGE, "run_turn", return_value=chat_result),
        ):
            first_id, first_session, first_result = application._execute_authenticated_chat(
                "continue",
                (),
                continuation_id,
                owner,
                application.AUTH_REGISTRY.get(handle),
                model="gpt-5-6-thinking",
                reasoning_effort="high",
                service_tier=None,
            )
            second_id, second_session, _ = application._execute_authenticated_chat(
                "continue again",
                (),
                continuation_id,
                owner,
                application.AUTH_REGISTRY.get(handle),
                model="gpt-5-6-thinking",
                reasoning_effort="high",
                service_tier=None,
            )

        bootstrap.assert_called_once_with(application.AUTH_REGISTRY.get(handle), detail)
        self.assertEqual(first_id, continuation_id)
        self.assertEqual(second_id, continuation_id)
        self.assertIs(first_session, protocol_session)
        self.assertIs(second_session, protocol_session)
        self.assertEqual(first_result.answer, "continued")

    def test_forbidden_history_does_not_destroy_healthy_login(self) -> None:
        handle, entry = _login()
        forbidden = AuthSessionError(
            "history_forbidden", "not available", status_code=403
        )
        with patch.object(
            application, "_history_read_with_refresh", side_effect=forbidden
        ):
            response = asyncio.run(
                application.conversation_history(
                    _request(handle, "/api/conversations"), cursor=None, limit=28
                )
            )
        self.assertEqual(response.status_code, 403)
        self.assertIs(application.AUTH_REGISTRY.get(handle), entry)

    def test_slow_list_cannot_reinsert_bindings_after_logout(self) -> None:
        handle, _ = _login()
        page = HistoryPage(
            items=(HistorySummary("private-upstream", "Late", None, None),),
            offset=0,
            limit=28,
            total=1,
        )

        def finish_after_logout(*_args, **_kwargs):  # type: ignore[no-untyped-def]
            application.AUTH_REGISTRY.delete(handle)
            return page

        with patch.object(
            application,
            "_history_read_with_refresh",
            side_effect=finish_after_logout,
        ):
            response = asyncio.run(
                application.conversation_history(
                    _request(handle, "/api/conversations"), cursor=None, limit=28
                )
            )

        self.assertEqual(response.status_code, 401)
        self.assertIn("Max-Age=0", response.headers.get("set-cookie", ""))
        self.assertEqual(application.AUTH_HISTORY.count(), 0)
        self.assertNotIn("private-upstream", response.body.decode())

    def test_history_read_refreshes_once_after_401(self) -> None:
        _, entry = _login()
        calls = 0

        def operation(_credential):  # type: ignore[no-untyped-def]
            nonlocal calls
            calls += 1
            if calls == 1:
                raise AuthSessionError("history_unauthorized", "refresh", status_code=401)
            return "ok"

        with patch.object(application, "refresh_local_auth_entry") as refresh:
            self.assertEqual(
                application._history_read_with_refresh(entry, operation), "ok"
            )
        refresh.assert_called_once_with(entry)
        self.assertEqual(calls, 2)


if __name__ == "__main__":
    unittest.main()
