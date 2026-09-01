"""API-contract tests for authenticated image generation and asset proxying."""

from __future__ import annotations

import asyncio
import json
import time
import unittest
from unittest.mock import patch

from starlette.requests import Request

from . import app as application
from .auth_session import AuthenticatedUpstream, PublicAccount, UpstreamCredential
from .authenticated_images import DownloadedImage
from .authenticated_protocol import AuthenticatedChatResult, AuthenticatedImageAsset


def _request(path: str, *, method: str, handle: str | None = None) -> Request:
    headers = [(b"host", b"127.0.0.1:8787")]
    if method == "POST":
        headers.extend(
            [
                (b"origin", b"http://127.0.0.1:8787"),
                (b"sec-fetch-site", b"same-origin"),
            ]
        )
    if handle is not None:
        headers.append(
            (
                b"cookie",
                f"{application.LOCAL_SESSION_COOKIE}={handle}".encode("ascii"),
            )
        )
    raw_path = path.encode("ascii")
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": method,
            "scheme": "http",
            "path": path,
            "raw_path": raw_path,
            "query_string": b"",
            "headers": headers,
            "client": ("127.0.0.1", 49152),
            "server": ("127.0.0.1", 8787),
        }
    )


def _chat_request() -> application.ChatCompletionRequest:
    return application.ChatCompletionRequest(
        model="gpt-5-6-pro",
        messages=[
            application.ChatMessage(
                role="user",
                content=[{"type": "text", "text": "draw a tiny red circle"}],
            )
        ],
        stream=False,
    )


def _reference_only_request() -> application.ChatCompletionRequest:
    return application.ChatCompletionRequest(
        model="auto",
        messages=[
            application.ChatMessage(
                role="user",
                content=[
                    {"type": "text", "text": ""},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": "data:image/png;base64,cG5n",
                            "filename": "reference.png",
                            "width": 1,
                            "height": 1,
                        },
                    },
                ],
            )
        ],
        stream=False,
    )


def _upstream() -> AuthenticatedUpstream:
    expires = time.time() + 3_600
    return AuthenticatedUpstream(
        account=PublicAccount(
            id="account-image-pro",
            user_id="user-image-pro",
            name="Image Tester",
            email="image@example.test",
            initials="IT",
            plan="pro",
            plan_label="Pro",
        ),
        credential=UpstreamCredential(
            kind="access_token",
            access_token="private-test-token",
            access_token_expires_at_epoch=expires,
            cookie_header=None,
            account_id="account-image-pro",
            user_id="user-image-pro",
        ),
        expires_at_epoch=expires,
    )


class ImageGenerationApiTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        application.AUTH_IMAGES.clear()
        self.handle, self.entry, _ = application.AUTH_REGISTRY.create(_upstream())

    async def asyncTearDown(self) -> None:
        tasks = list(application.IMAGE_TASKS)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        application.IMAGE_TASKS.clear()
        application._remove_account_state(self.handle)

    async def test_image_job_succeeds_and_only_exposes_owner_bound_handles(self) -> None:
        upstream_pointer = "sediment://file-private-generated"
        upstream_conversation = "conversation-private-upstream"
        result = AuthenticatedChatResult(
            answer="",
            conversation_id=upstream_conversation,
            conversation_state={},
            parent_message_id="tool-image-1",
            assistant_message_id="tool-image-1",
            upstream_request_id="request-private-upstream",
            attempts=1,
            model="gpt-5-6-pro",
            images=(
                AuthenticatedImageAsset(
                    asset_pointer=upstream_pointer,
                    width=1254,
                    height=1254,
                    mime_type="image/png",
                    prompt="tiny red circle",
                ),
            ),
        )
        with patch.object(
            application,
            "_execute_authenticated_chat",
            return_value=("authconv-public", object(), result),
        ) as execute:
            created = await application.create_image_generation(
                _request(
                    "/api/images/generations", method="POST", handle=self.handle
                ),
                _chat_request(),
            )
            self.assertEqual(created.status_code, 202)
            await asyncio.gather(*list(application.IMAGE_TASKS))

        create_payload = json.loads(created.body)
        self.assertTrue(create_payload["id"].startswith("imgjob-"))
        self.assertNotIn(upstream_pointer, created.body.decode("utf-8"))
        self.assertNotIn(upstream_conversation, created.body.decode("utf-8"))
        self.assertEqual(execute.call_args.kwargs["system_hints"], ("picture_v2",))
        self.assertIsNone(execute.call_args.kwargs["reasoning_effort"])
        self.assertEqual(
            execute.call_args.kwargs["attachment_entry_surface"],
            "image_gen_upload_input",
        )

        status = await application.image_generation_status(
            create_payload["id"],
            _request(
                f"/api/images/generations/{create_payload['id']}",
                method="GET",
                handle=self.handle,
            ),
        )
        self.assertEqual(status.status_code, 200)
        status_payload = json.loads(status.body)
        self.assertEqual(status_payload["status"], "succeeded")
        self.assertEqual(status_payload["conversationId"], "authconv-public")
        self.assertNotIn(upstream_pointer, status.body.decode("utf-8"))
        self.assertNotIn(upstream_conversation, status.body.decode("utf-8"))
        image = status_payload["images"][0]
        self.assertTrue(image["id"].startswith("imgasset-"))
        self.assertEqual(image["url"], f"/api/images/assets/{image['id']}")

        with patch.object(
            application,
            "_download_registered_image",
            return_value=DownloadedImage(body=b"png-bytes", mime_type="image/png"),
        ) as download:
            asset_response = await application.generated_image_asset(
                image["id"],
                _request(
                    f"/api/images/assets/{image['id']}",
                    method="GET",
                    handle=self.handle,
                ),
            )
        self.assertEqual(asset_response.status_code, 200)
        self.assertEqual(asset_response.body, b"png-bytes")
        self.assertEqual(asset_response.headers["cache-control"], "private, no-store")
        self.assertEqual(download.call_args.args[1].asset.asset_pointer, upstream_pointer)

    async def test_tool_failure_uses_fixed_message_and_never_leaks_answer(self) -> None:
        result = AuthenticatedChatResult(
            answer="private provider error detail",
            conversation_id="conversation-private-upstream",
            conversation_state={},
            parent_message_id="tool-error-1",
            assistant_message_id="tool-error-1",
            upstream_request_id=None,
            attempts=1,
            model="auto",
            image_generation_failed=True,
        )
        with patch.object(
            application,
            "_execute_authenticated_chat",
            return_value=("authconv-public", object(), result),
        ):
            created = await application.create_image_generation(
                _request(
                    "/api/images/generations", method="POST", handle=self.handle
                ),
                _chat_request(),
            )
            await asyncio.gather(*list(application.IMAGE_TASKS))

        job_id = json.loads(created.body)["id"]
        status = await application.image_generation_status(
            job_id,
            _request(
                f"/api/images/generations/{job_id}",
                method="GET",
                handle=self.handle,
            ),
        )
        payload = json.loads(status.body)
        self.assertEqual(payload["status"], "failed")
        self.assertEqual(payload["error"]["code"], "image_generation_failed")
        self.assertNotIn("private provider error", status.body.decode("utf-8"))

    async def test_pending_image_turn_resumes_before_history_polling(self) -> None:
        pending = AuthenticatedChatResult(
            answer="",
            conversation_id="conversation-private-upstream",
            conversation_state={"resumeToken": "private-resume-token"},
            parent_message_id="assistant-dispatch",
            assistant_message_id="assistant-dispatch",
            upstream_request_id=None,
            attempts=1,
            model="gpt-5-6-pro",
            image_generation_pending=True,
        )
        resumed = AuthenticatedChatResult(
            answer="",
            conversation_id="conversation-private-upstream",
            conversation_state={},
            parent_message_id="tool-image-resumed",
            assistant_message_id="tool-image-resumed",
            upstream_request_id=None,
            attempts=1,
            model="gpt-5-6-pro",
            images=(
                AuthenticatedImageAsset(
                    asset_pointer="sediment://file-resumed-private",
                    width=1024,
                    height=1024,
                    mime_type="image/png",
                ),
            ),
        )
        protocol_session = object()
        with (
            patch.object(
                application,
                "_execute_authenticated_chat",
                return_value=("authconv-public", protocol_session, pending),
            ),
            patch.object(application.AUTH_BRIDGE, "resume_turn", return_value=resumed) as resume,
            patch.object(application.AUTH_IMAGES_BRIDGE, "wait_for_images") as poll,
        ):
            created = await application.create_image_generation(
                _request(
                    "/api/images/generations", method="POST", handle=self.handle
                ),
                _chat_request(),
            )
            await asyncio.gather(*list(application.IMAGE_TASKS))

        resume.assert_called_once_with(
            protocol_session,
            conversation_id="conversation-private-upstream",
            resume_token="private-resume-token",
            offset=0,
        )
        poll.assert_not_called()
        status = await application.image_generation_status(
            json.loads(created.body)["id"],
            _request("/api/images/generations/job", method="GET", handle=self.handle),
        )
        self.assertEqual(json.loads(status.body)["status"], "succeeded")

    async def test_tokenless_handoff_pending_turn_uses_history_polling(self) -> None:
        pending = AuthenticatedChatResult(
            answer="",
            conversation_id="conversation-private-upstream",
            conversation_state={"websocketTopicId": "private-topic"},
            parent_message_id="",
            assistant_message_id="",
            upstream_request_id=None,
            attempts=1,
            model="catalog-model",
            image_generation_pending=True,
        )
        recovered = (
            AuthenticatedImageAsset(
                asset_pointer="sediment://file-history-private",
                width=1024,
                height=1024,
                mime_type="image/png",
            ),
        )
        protocol_session = object()
        with (
            patch.object(
                application,
                "_execute_authenticated_chat",
                return_value=("authconv-public", protocol_session, pending),
            ),
            patch.object(application.AUTH_BRIDGE, "resume_turn") as resume,
            patch.object(
                application.AUTH_IMAGES_BRIDGE,
                "wait_for_images",
                return_value=recovered,
            ) as poll,
        ):
            created = await application.create_image_generation(
                _request(
                    "/api/images/generations", method="POST", handle=self.handle
                ),
                _chat_request(),
            )
            await asyncio.gather(*list(application.IMAGE_TASKS))

        resume.assert_not_called()
        poll.assert_called_once()
        self.assertEqual(
            poll.call_args.args[1],
            "conversation-private-upstream",
        )
        status = await application.image_generation_status(
            json.loads(created.body)["id"],
            _request("/api/images/generations/job", method="GET", handle=self.handle),
        )
        self.assertEqual(json.loads(status.body)["status"], "succeeded")

    async def test_reference_only_turn_preserves_official_empty_prompt(self) -> None:
        result = AuthenticatedChatResult(
            answer="",
            conversation_id="conversation-private-upstream",
            conversation_state={},
            parent_message_id="tool-image",
            assistant_message_id="tool-image",
            upstream_request_id=None,
            attempts=1,
            model="auto",
            images=(
                AuthenticatedImageAsset(
                    asset_pointer="sediment://file-generated",
                    width=1024,
                    height=1024,
                    mime_type="image/png",
                ),
            ),
        )
        with patch.object(
            application,
            "_execute_authenticated_chat",
            return_value=("authconv-public", object(), result),
        ) as execute:
            created = await application.create_image_generation(
                _request(
                    "/api/images/generations", method="POST", handle=self.handle
                ),
                _reference_only_request(),
            )
            await asyncio.gather(*list(application.IMAGE_TASKS))

        self.assertEqual(created.status_code, 202)
        self.assertEqual(execute.call_args.args[0], "")
        attachments = execute.call_args.args[1]
        self.assertEqual(len(attachments), 1)
        self.assertEqual(attachments[0].file_name, "reference.png")

    async def test_authentication_and_per_owner_active_queue_are_enforced(self) -> None:
        unauthenticated = await application.create_image_generation(
            _request("/api/images/generations", method="POST"), _chat_request()
        )
        self.assertEqual(unauthenticated.status_code, 401)
        self.assertEqual(
            json.loads(unauthenticated.body)["error"]["code"],
            "authentication_required",
        )

        gate = asyncio.Event()

        async def hold_job(**_: object) -> None:
            await gate.wait()

        with (
            patch.object(application, "_run_image_generation_job", side_effect=hold_job),
            patch.object(application, "IMAGE_MAX_ACTIVE_PER_OWNER", 1),
        ):
            first = await application.create_image_generation(
                _request(
                    "/api/images/generations", method="POST", handle=self.handle
                ),
                _chat_request(),
            )
            second = await application.create_image_generation(
                _request(
                    "/api/images/generations", method="POST", handle=self.handle
                ),
                _chat_request(),
            )
            self.assertEqual(first.status_code, 202)
            self.assertEqual(second.status_code, 429)
            self.assertEqual(
                json.loads(second.body)["error"]["code"],
                "image_generation_in_progress",
            )
            gate.set()
            await asyncio.gather(*list(application.IMAGE_TASKS))


if __name__ == "__main__":
    unittest.main()
