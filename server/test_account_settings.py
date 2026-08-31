from __future__ import annotations

import json
import sqlite3
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from .account_settings import (
    AccountSettingsError,
    AccountSettingsStore,
    validate_settings_patch,
)
from .auth_session import AuthSessionError, LocalAuthEntry, PublicAccount, UpstreamCredential
from . import upstream_settings


class AccountSettingsStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "settings.sqlite3"
        self.store = AccountSettingsStore(self.path)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_partial_patch_is_durable_and_account_scoped(self) -> None:
        original = self.store.get("account-one")
        changed = self.store.patch(
            "account-one",
            {"general": {"accent": "blue"}, "shortcuts": {"enabled": {"send": False}}},
            expected_revision=original.revision,
        )
        self.assertEqual(changed.revision, 1)
        self.assertEqual(changed.settings["general"]["accent"], "blue")
        self.assertFalse(changed.settings["shortcuts"]["enabled"]["send"])
        self.assertTrue(changed.settings["shortcuts"]["enabled"]["search"])
        self.assertEqual(AccountSettingsStore(self.path).get("account-one").settings, changed.settings)
        self.assertEqual(self.store.get("account-two").settings["general"]["accent"], "default")

    def test_raw_account_id_is_not_written_to_database(self) -> None:
        account_id = "sensitive-upstream-account-id"
        self.store.get(account_id)
        connection = sqlite3.connect(self.path)
        try:
            stored_key = connection.execute("SELECT account_id FROM account_settings").fetchone()[0]
        finally:
            connection.close()
        self.assertNotEqual(stored_key, account_id)
        self.assertEqual(len(stored_key), 64)

    def test_revision_validation_noop_and_developer_dependency(self) -> None:
        start = self.store.get("account")
        noop = self.store.patch("account", {"general": {"theme": "system"}}, expected_revision=0)
        self.assertEqual(noop.revision, 0)
        enabled = self.store.patch(
            "account",
            {"security": {"developerMode": True, "enforceCsp": True}},
            expected_revision=0,
        )
        disabled = self.store.patch(
            "account", {"security": {"developerMode": False}}, expected_revision=enabled.revision
        )
        self.assertFalse(disabled.settings["security"]["enforceCsp"])
        with self.assertRaises(AccountSettingsError) as caught:
            self.store.patch("account", {"general": {"accent": "green"}}, expected_revision=0)
        self.assertEqual(caught.exception.code, "settings_revision_conflict")

    def test_unknown_invalid_and_oversized_values_are_rejected(self) -> None:
        invalid = [
            {"unknown": {"value": True}},
            {"general": {"dictation": "yes"}},
            {"personalization": {"customInstructions": "x" * 5_001}},
            {"cloudBrowser": {"defaultPermission": "deny"}},
        ]
        for changes in invalid:
            with self.subTest(changes=changes), self.assertRaises(AccountSettingsError):
                self.store.patch("account", changes)

    def test_dynamic_notification_categories_are_validated_and_durable(self) -> None:
        changes = {
            "notifications": {
                "new_category": "both",
                "plugin:github": "push",
            }
        }
        self.assertEqual(validate_settings_patch(changes), changes)

        changed = self.store.patch("account", changes, expected_revision=0)
        self.assertEqual(changed.settings["notifications"]["new_category"], "both")
        self.assertEqual(changed.settings["notifications"]["plugin:github"], "push")
        reloaded = AccountSettingsStore(self.path).get("account")
        self.assertEqual(reloaded.settings["notifications"]["new_category"], "both")
        self.assertIn("codex", reloaded.settings["notifications"])

    def test_dynamic_notification_categories_reject_unsafe_names_and_values(self) -> None:
        invalid = [
            {"notifications": {"Uppercase": "push"}},
            {"notifications": {"contains space": "email"}},
            {"notifications": {"../escape": "both"}},
            {"notifications": {"x" * 65: "off"}},
            {"notifications": {"plugin:github": "sms"}},
        ]
        for changes in invalid:
            with self.subTest(changes=changes), self.assertRaises(AccountSettingsError):
                validate_settings_patch(changes)


class FakeResponse:
    def __init__(self, status: int, payload: dict | None = None) -> None:
        self.status_code = status
        self._payload = payload
        self.content = b"" if payload is None else json.dumps(payload).encode()

    def json(self):  # type: ignore[no-untyped-def]
        return self._payload


class FakeSession:
    def __init__(self, responses: list[FakeResponse | Exception], calls: list[dict]) -> None:
        self.responses = responses
        self.calls = calls

    def request(self, method: str, url: str, **kwargs):  # type: ignore[no-untyped-def]
        self.calls.append({"method": method, "url": url, **kwargs})
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    def close(self) -> None:
        return None


def auth_entry() -> LocalAuthEntry:
    now = time.time()
    return LocalAuthEntry(
        account=PublicAccount(
            id="account-id",
            user_id="user-id",
            name="User",
            email="user@example.test",
            initials="U",
            plan="plus",
            plan_label="Plus",
        ),
        credential=UpstreamCredential(
            kind="access_token",
            access_token="secret-token",
            access_token_expires_at_epoch=None,
            cookie_header=None,
            account_id="account-id",
            user_id="user-id",
        ),
        created_at_epoch=now,
        absolute_expires_at_epoch=now + 3600,
        last_access_monotonic=time.monotonic(),
        lock=threading.RLock(),
    )


class UpstreamSettingsTests(unittest.TestCase):
    def test_transient_network_failure_retries_safe_get(self) -> None:
        calls: list[dict] = []
        responses: list[FakeResponse | Exception] = [
            OSError("must-not-be-reflected"),
            FakeResponse(200, {"settings": {"chat_theme": "blue"}}),
        ]
        with (
            patch.object(
                upstream_settings,
                "_new_http_session",
                side_effect=lambda: FakeSession(responses, calls),
            ),
            patch.object(upstream_settings.time, "sleep") as sleep,
        ):
            payload = upstream_settings._request_json(
                auth_entry(), "/settings/user", stage="settings_user"
            )

        self.assertEqual(payload["settings"]["chat_theme"], "blue")
        self.assertEqual([call["method"] for call in calls], ["GET", "GET"])
        sleep.assert_called_once()

    def test_network_failure_does_not_replay_setting_write(self) -> None:
        calls: list[dict] = []
        responses: list[FakeResponse | Exception] = [OSError("write-outcome-unknown")]
        with patch.object(
            upstream_settings,
            "_new_http_session",
            side_effect=lambda: FakeSession(responses, calls),
        ):
            with self.assertRaises(AuthSessionError) as caught:
                upstream_settings._request_json(
                    auth_entry(),
                    "/accounts/users/locale",
                    stage="settings_locale_write",
                    method="PATCH",
                    json_body={"locale": "zh-CN"},
                )

        self.assertEqual(caught.exception.code, "settings_upstream_unavailable")
        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual([call["method"] for call in calls], ["PATCH"])
        self.assertNotIn("write-outcome-unknown", caught.exception.message)

    def test_feature_write_uses_allowlisted_endpoint_and_encoded_value(self) -> None:
        calls: list[dict] = []
        responses = [
            FakeResponse(200, {"settings": {"contrast_mode": "medium"}}),
            FakeResponse(200, {"success": True}),
        ]
        with patch.object(
            upstream_settings,
            "_new_http_session",
            side_effect=lambda: FakeSession(responses, calls),
        ):
            local = upstream_settings.apply_upstream_settings(
                auth_entry(), {"general": {"contrast": "high"}}
            )
        self.assertEqual(local, {})
        self.assertTrue(calls[0]["url"].endswith("/backend-api/settings/user"))
        self.assertEqual(calls[0]["headers"].get("Oai-Ep-Cache-Bypass"), "true")
        self.assertEqual(calls[1]["method"], "PATCH")
        self.assertIn("/backend-api/settings/account_user_setting?", calls[1]["url"])
        self.assertIn("feature=contrast_mode", calls[1]["url"])
        self.assertIn("value=high", calls[1]["url"])
        self.assertNotIn("secret-token", calls[1]["url"])

    def test_context_write_preserves_other_fields(self) -> None:
        calls: list[dict] = []
        responses = [
            FakeResponse(200, {"about_user_message": "keep", "enabled": True}),
            FakeResponse(200, {"success": True}),
        ]
        with patch.object(
            upstream_settings,
            "_new_http_session",
            side_effect=lambda: FakeSession(responses, calls),
        ):
            upstream_settings.apply_upstream_settings(
                auth_entry(), {"personalization": {"customInstructions": "new"}}
            )
        self.assertEqual(calls[1]["json"]["about_user_message"], "keep")
        self.assertEqual(calls[1]["json"]["about_model_message"], "new")

    def test_forbidden_setting_does_not_invalidate_entry(self) -> None:
        entry = auth_entry()
        calls: list[dict] = []
        responses = [FakeResponse(403, {"error": "locked"})]
        with patch.object(
            upstream_settings,
            "_new_http_session",
            side_effect=lambda: FakeSession(responses, calls),
        ):
            with self.assertRaises(Exception) as caught:
                upstream_settings.fetch_upstream_settings(entry, {"general": {}})
        self.assertEqual(getattr(caught.exception, "code", None), "setting_forbidden")
        self.assertEqual(entry.credential.access_token, "secret-token")

    def test_local_only_patch_never_calls_upstream(self) -> None:
        with patch.object(upstream_settings, "_new_http_session") as factory:
            local = upstream_settings.apply_upstream_settings(
                auth_entry(), {"general": {"theme": "dark"}}
            )
        self.assertEqual(local, {"general": {"theme": "dark"}})
        factory.assert_not_called()

    def test_automatic_locale_uses_null_upstream_and_remains_local_auto(self) -> None:
        calls: list[dict] = []
        responses = [FakeResponse(200, {"success": True})]
        with patch.object(
            upstream_settings,
            "_new_http_session",
            side_effect=lambda: FakeSession(responses, calls),
        ):
            local = upstream_settings.apply_upstream_settings(
                auth_entry(), {"general": {"language": "auto"}}
            )
        self.assertEqual(local, {"general": {"language": "auto"}})
        self.assertEqual(calls[0]["method"], "PATCH")
        self.assertTrue(calls[0]["url"].endswith("/backend-api/accounts/users/locale"))
        self.assertEqual(calls[0]["json"], {"locale": None})

    def test_notification_write_uses_fresh_catalog_and_official_update_shape(self) -> None:
        calls: list[dict] = []
        responses = [
            FakeResponse(
                200,
                {
                    "settings": [
                        {
                            "category": "tasks",
                            "name": "Tasks",
                            "description": "Task updates",
                            "options": [
                                {"name": "task_push", "channel": "push", "enabled": False},
                                {"name": "task_email", "channel": "email", "enabled": True},
                            ],
                        }
                    ]
                },
            ),
            FakeResponse(200, {"success": True}),
        ]
        with patch.object(
            upstream_settings,
            "_new_http_session",
            side_effect=lambda: FakeSession(responses, calls),
        ):
            upstream_settings.apply_upstream_settings(
                auth_entry(), {"notifications": {"tasks": "both"}}
            )
        self.assertTrue(calls[0]["url"].endswith("/backend-api/notifications/settings"))
        self.assertEqual(calls[1]["method"], "PATCH")
        self.assertEqual(
            calls[1]["json"],
            {
                "updates": {
                    "tasks": {
                        "name": "task_push",
                        "channel": "push",
                        "enabled": True,
                    }
                }
            },
        )

    def test_voice_dependencies_are_written_before_catalog_validated_voice(self) -> None:
        calls: list[dict] = []
        responses = [
            FakeResponse(
                200,
                {"settings": {"voice_mode": "advanced", "voice_name": "cove"}},
            ),
            FakeResponse(200, {"success": True}),
            FakeResponse(
                200,
                {
                    "selected": "cove",
                    "voices": [
                        {"voice": "ember", "name": "Ember", "description": "Warm"},
                    ],
                },
            ),
            FakeResponse(200, {"success": True}),
        ]
        with patch.object(
            upstream_settings,
            "_new_http_session",
            side_effect=lambda: FakeSession(responses, calls),
        ):
            upstream_settings.apply_upstream_settings(
                auth_entry(), {"voice": {"model": "standard", "name": "ember"}}
            )
        self.assertIn("feature=voice_mode", calls[1]["url"])
        self.assertIn("value=standard", calls[1]["url"])
        self.assertIn("voice_mode=standard", calls[2]["url"])
        self.assertIn("feature=voice_name", calls[3]["url"])
        self.assertIn("value=ember", calls[3]["url"])

    def test_builder_name_write_is_a_minimal_partial_profile_update(self) -> None:
        calls: list[dict] = []
        responses = [FakeResponse(200, {"success": True})]
        with patch.object(
            upstream_settings,
            "_new_http_session",
            side_effect=lambda: FakeSession(responses, calls),
        ):
            upstream_settings.apply_upstream_settings(
                auth_entry(), {"account": {"showBuilderName": False}}
            )
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["method"], "POST")
        self.assertTrue(calls[0]["url"].endswith("/backend-api/gizmo_creator_profile"))
        self.assertEqual(calls[0]["json"], {"hide_name": True})

    def test_http_200_success_false_is_not_reported_as_saved(self) -> None:
        calls: list[dict] = []
        responses = [
            FakeResponse(200, {"settings": {"contrast_mode": "medium"}}),
            FakeResponse(200, {"success": False}),
        ]
        with patch.object(
            upstream_settings,
            "_new_http_session",
            side_effect=lambda: FakeSession(responses, calls),
        ):
            with self.assertRaises(Exception) as caught:
                upstream_settings.apply_upstream_settings(
                    auth_entry(), {"general": {"contrast": "high"}}
                )
        self.assertEqual(getattr(caught.exception, "code", None), "setting_write_rejected")
