from __future__ import annotations

import unittest
from unittest.mock import ANY, patch

from .auth_session import AuthSessionError
from .model_preferences import (
    read_chat_model_preference,
    validate_chat_model_preference,
    write_chat_model_preference,
)


class ChatModelPreferenceTests(unittest.TestCase):
    def test_reads_web_slug_and_effort_from_user_settings(self) -> None:
        payload = {
            "settings": {
                "last_used_model_config": {
                    "slugs": {"default": "fallback", "web": "gpt-5-6-thinking"},
                    "juices": {
                        "default": {"gpt-5-6-thinking": "standard"},
                        "web": {"gpt-5-6-thinking": "extended"},
                    },
                }
            }
        }
        with patch("server.model_preferences._request_json", return_value=payload) as request:
            result = read_chat_model_preference(object())  # type: ignore[arg-type]
        self.assertEqual(
            result,
            {"modelSlug": "gpt-5-6-thinking", "thinkingEffort": "extended"},
        )
        request.assert_called_once_with(
            ANY,
            "/settings/user",
            stage="model_preference_read",
            bypass_server_cache=True,
        )

    def test_invalid_or_unknown_read_values_are_not_reflected(self) -> None:
        payload = {
            "settings": {
                "last_used_model_config": {
                    "slugs": {"web": "../../unsafe"},
                    "juices": {"web": {"../../unsafe": "ultra"}},
                }
            }
        }
        with patch("server.model_preferences._request_json", return_value=payload):
            result = read_chat_model_preference(object())  # type: ignore[arg-type]
        self.assertEqual(result, {"modelSlug": None, "thinkingEffort": None})

    def test_writes_exact_normal_chat_endpoint_and_query(self) -> None:
        with patch("server.model_preferences._request_json", return_value={}) as request:
            result = write_chat_model_preference(
                object(), "gpt-5-6-thinking", "xhigh"  # type: ignore[arg-type]
            )
        self.assertEqual(
            result,
            {"modelSlug": "gpt-5-6-thinking", "thinkingEffort": "xhigh"},
        )
        request.assert_called_once_with(
            ANY,
            "/settings/user_last_used_model_config",
            stage="model_preference_write",
            method="PATCH",
            query={"model_slug": "gpt-5-6-thinking", "thinking_effort": "xhigh"},
        )

    def test_non_thinking_lane_omits_effort_query(self) -> None:
        with patch("server.model_preferences._request_json", return_value={}) as request:
            write_chat_model_preference(
                object(), "gpt-5-6-instant", None  # type: ignore[arg-type]
            )
        self.assertEqual(
            request.call_args.kwargs["query"],
            {"model_slug": "gpt-5-6-instant"},
        )

    def test_rejects_unknown_effort_and_unsafe_slug_before_request(self) -> None:
        invalid = [
            ("../model", "standard"),
            ("gpt-5-6-thinking", "ultra"),
            ("", None),
        ]
        for slug, effort in invalid:
            with self.subTest(slug=slug, effort=effort):
                with self.assertRaises(AuthSessionError) as raised:
                    validate_chat_model_preference(slug, effort)
                self.assertEqual(raised.exception.code, "model_preference_invalid")


if __name__ == "__main__":
    unittest.main()
