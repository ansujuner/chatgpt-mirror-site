from __future__ import annotations

import json
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from . import auth_session
from .auth_session import (
    AuthSessionError,
    AuthenticatedUpstream,
    LocalAuthEntry,
    PublicAccount,
    UpstreamCredential,
)


def _credential(*, cookie: bool = False) -> UpstreamCredential:
    return UpstreamCredential(
        kind="session_cookie" if cookie else "access_token",
        access_token="test-access-token",
        access_token_expires_at_epoch=time.time() + 3600,
        cookie_header="session=test-cookie" if cookie else None,
        account_id="account-selected",
        user_id="user-selected",
    )


def _account(plan: str = "free") -> PublicAccount:
    return PublicAccount(
        id="account-selected",
        user_id="user-selected",
        name="Selected User",
        email="selected@example.test",
        initials="SU",
        plan=plan,
        plan_label=plan.title(),
    )


def _entry(*, cookie: bool = False, plan: str = "free") -> LocalAuthEntry:
    now = time.time()
    return LocalAuthEntry(
        account=_account(plan),
        credential=_credential(cookie=cookie),
        created_at_epoch=now,
        absolute_expires_at_epoch=now + 3600,
        last_access_monotonic=time.monotonic(),
        lock=threading.RLock(),
    )


class _HTTP:
    def close(self) -> None:
        pass


def _fixture(name: str) -> dict[str, object]:
    path = Path(__file__).with_name("fixtures") / name
    value = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(value, dict)
    return value


class AccountBindingTests(unittest.TestCase):
    def test_credential_repr_never_contains_token_or_cookie(self) -> None:
        credential = UpstreamCredential(
            kind="session_cookie",
            access_token="secret-access-token",
            access_token_expires_at_epoch=None,
            cookie_header="session=secret-cookie",
            account_id="account-selected",
            user_id="user-selected",
        )
        rendered = repr(credential)
        self.assertNotIn("secret-access-token", rendered)
        self.assertNotIn("secret-cookie", rendered)

    def test_authoritative_account_plan_overrides_stale_session_hint(self) -> None:
        plan = auth_session._plan_from_sources(
            {"planType": "free"},
            {
                "account": {"plan_type": "pro"},
                "entitlement": {"subscription_plan": "chatgpt_plus"},
            },
        )
        self.assertEqual(plan, "pro")

    def test_placeholder_plan_does_not_hide_subscription_entitlement(self) -> None:
        plan = auth_session._plan_from_sources(
            {"planType": "free"},
            {
                "account": {"plan_type": "unknown"},
                "entitlement": {"subscription_plan": "chatgpt_plus"},
            },
        )
        self.assertEqual(plan, "plus")

    def test_missing_selected_account_never_falls_back_to_other_workspace(self) -> None:
        account_id, value = auth_session._account_entry(
            {
                "account_ordering": ["account-other"],
                "accounts": {
                    "account-other": {"account": {"plan_type": "enterprise"}}
                },
            },
            "account-selected",
        )
        self.assertEqual(account_id, "account-selected")
        self.assertEqual(value, {})

    def test_runtime_updates_plan_but_plan_gated_optional_endpoint_is_nonfatal(self) -> None:
        entry = _entry(plan="free")

        def request_json(_http, _url, *, stage, **_kwargs):  # type: ignore[no-untyped-def]
            if stage == "accounts_runtime":
                return {
                    "accounts": {
                        "account-selected": {
                            "account": {"plan_type": "pro"},
                            "features": ["feature-pro"],
                        }
                    }
                }
            if stage == "models":
                # A plan-gated discovery endpoint can reject independently of
                # the successful account authentication above.
                raise AuthSessionError("invalid_session", "forbidden", status_code=401)
            return {}

        with (
            patch.object(auth_session, "_new_http_session", return_value=_HTTP()),
            patch.object(auth_session, "_request_json", side_effect=request_json),
        ):
            runtime = auth_session.fetch_account_runtime(entry, cache_ttl_seconds=0)

        self.assertEqual(runtime["plan"], "pro")
        self.assertEqual(runtime["planLabel"], "Pro")
        self.assertEqual(runtime["features"], ["feature-pro"])
        self.assertEqual(runtime["chat"]["models"], [])
        self.assertEqual(entry.account.plan, "pro")

    def test_conversation_init_extracts_blocked_feature_object_names(self) -> None:
        sanitized = auth_session._sanitize_init_payload(
            {
                "blocked_features": [
                    {
                        "name": "deep_research",
                        "title": "Deep research",
                        "block_reason": "plan_restricted",
                    },
                    {"feature_name": "connectors"},
                    "legacy_feature",
                    {"title": "missing stable name"},
                    {"name": "deep_research"},
                ]
            }
        )
        self.assertEqual(
            sanitized["blockedFeatures"],
            ["deep_research", "connectors", "legacy_feature"],
        )

    def test_model_runtime_preserves_chat_presets_and_work_service_tiers(self) -> None:
        sanitized = auth_session._sanitize_models_payload(
            {
                "default_model_slug": "gpt-5.6-sol-wm",
                "models": [
                    {
                        "slug": "gpt-5.6-sol-wm",
                        "default_service_tier": "standard",
                        "service_tier_options": [
                            {"service_tier": "standard"},
                            {"service_tier": "fast"},
                            {"service_tier": "fast"},
                        ],
                        "thinking_efforts": [
                            {
                                "thinking_effort": "extended",
                                "short_label": "High",
                                "full_label": "High reasoning",
                                "mobile_full_label": "High",
                            }
                        ],
                    }
                ],
                "versions": [
                    {
                        "id": "gpt-5.6",
                        "display_text_for_intelligence": "GPT-5.6",
                        "short_display_text_for_intelligence": "5.6",
                        "intelligence_presets": [
                            {
                                "id": 2,
                                "title": "High",
                                "selected_display_title": "High",
                                "model_slug": "gpt-5-6-thinking",
                                "thinking_effort": "extended",
                                "lane": "thinking",
                                "preset_type": "normal",
                                "upgrade_plan_type": "pro",
                                "default_service_tier": "standard",
                                "service_tier_options": [
                                    {"service_tier": "standard"},
                                    {"service_tier": "fast"},
                                    {"service_tier": "fast"},
                                ],
                            }
                        ],
                    }
                ],
            }
        )

        effort = sanitized["models"][0]["thinkingEfforts"][0]
        self.assertEqual(effort["fullLabel"], "High reasoning")
        self.assertEqual(effort["mobileFullLabel"], "High")
        model = sanitized["models"][0]
        self.assertEqual(model["defaultServiceTier"], "standard")
        self.assertEqual(model["serviceTierOptions"], ["standard", "fast"])
        version = sanitized["versions"][0]
        self.assertEqual(version["intelligenceDisplayText"], "GPT-5.6")
        self.assertEqual(version["shortIntelligenceDisplayText"], "5.6")
        preset = version["presets"][0]
        self.assertEqual(preset["presetType"], "normal")
        self.assertEqual(preset["upgradePlanType"], "pro")
        self.assertEqual(preset["defaultServiceTier"], "standard")
        self.assertEqual(preset["serviceTierOptions"], ["standard", "fast"])

    def test_refresh_invalidates_entitlement_snapshot(self) -> None:
        entry = _entry(cookie=True, plan="free")
        entry.runtime_snapshot = {"plan": "free"}
        entry.runtime_cached_at_monotonic = time.monotonic()
        entry.usage_snapshot = {"availability": "available"}
        entry.usage_cached_at_monotonic = time.monotonic()
        refreshed = AuthenticatedUpstream(
            account=_account("plus"),
            credential=UpstreamCredential(
                kind="session_cookie",
                access_token="refreshed-token",
                access_token_expires_at_epoch=time.time() + 3600,
                cookie_header="session=test-cookie",
                account_id="account-selected",
                user_id="user-selected",
            ),
            expires_at_epoch=time.time() + 3600,
        )

        with (
            patch.object(
                auth_session,
                "_session_from_cookie_header",
                return_value=({"accessToken": "refreshed-token"}, "refreshed-token"),
            ),
            patch.object(auth_session, "_verify_access_token", return_value=refreshed),
        ):
            credential = auth_session.refresh_local_auth_entry(entry)

        self.assertEqual(credential.access_token, "refreshed-token")
        self.assertEqual(entry.account.plan, "plus")
        self.assertIsNone(entry.runtime_snapshot)
        self.assertEqual(entry.runtime_cached_at_monotonic, 0.0)
        self.assertIsNone(entry.usage_snapshot)
        self.assertEqual(entry.usage_cached_at_monotonic, 0.0)

    def test_live_codex_usage_preserves_plus_five_hour_window_and_strips_identity(self) -> None:
        entry = _entry(cookie=True, plan="plus")
        upstream = {
            "user_id": "must-not-leak-user",
            "account_id": "must-not-leak-account",
            "email": "must-not-leak@example.test",
            "plan_type": "plus",
            "rate_limit": {
                "allowed": True,
                "limit_reached": False,
                "primary_window": {
                    "used_percent": 37,
                    "limit_window_seconds": 18_000,
                    "reset_after_seconds": 1_234,
                    "reset_at": 2_000_000_000,
                },
                "secondary_window": {
                    "used_percent": 12,
                    "limit_window_seconds": 604_800,
                    "reset_after_seconds": 432_100,
                    "reset_at": 2_000_500_000,
                },
            },
            "credits": {"balance": "secret-financial-value"},
            "rate_limit_reset_credits": {"available_count": 2},
        }

        with (
            patch.object(auth_session, "_new_http_session", return_value=_HTTP()),
            patch.object(auth_session, "_request_json", return_value=upstream) as request,
        ):
            usage = auth_session.fetch_codex_usage(entry)

        self.assertEqual(request.call_count, 5)
        self.assertEqual(request.call_args_list[0].args[1], auth_session.CODEX_USAGE_ENDPOINT)
        self.assertEqual(
            request.call_args_list[1].args[1],
            auth_session.CODEX_RESET_CREDITS_ENDPOINT,
        )
        self.assertTrue(
            request.call_args_list[2].args[1].startswith(
                auth_session.CODEX_DAILY_WORKSPACE_USAGE_COUNTS_ENDPOINT + "?"
            )
        )
        self.assertIn("workspace_user=true", request.call_args_list[2].args[1])
        self.assertTrue(
            request.call_args_list[3].args[1].startswith(
                auth_session.CODEX_DAILY_USAGE_ENDPOINT + "?"
            )
        )
        self.assertEqual(
            request.call_args_list[4].args[1],
            auth_session.ACCOUNT_REMAINING_BALANCE_ENDPOINT.format(
                account_id="account-selected"
            ),
        )
        sent_headers = request.call_args_list[0].kwargs["headers"]
        self.assertEqual(sent_headers["Authorization"], "Bearer test-access-token")
        self.assertEqual(sent_headers["Cookie"], "session=test-cookie")
        self.assertEqual(sent_headers["ChatGPT-Account-ID"], "account-selected")
        self.assertEqual(usage["planType"], "plus")
        self.assertIs(usage["authenticated"], True)
        self.assertEqual(usage["quota"]["primary"]["windowDurationMins"], 300)
        self.assertEqual(usage["quota"]["primary"]["remainingPercent"], 63)
        self.assertEqual(usage["quota"]["secondary"]["windowDurationMins"], 10_080)
        self.assertEqual(usage["quota"]["resetCredits"]["availableCount"], 2)
        rendered = str(usage)
        self.assertNotIn("must-not-leak", rendered)
        self.assertNotIn("secret-financial-value", rendered)
        self.assertNotIn("test-access-token", rendered)
        self.assertNotIn("test-cookie", rendered)

    def test_codex_usage_accepts_camel_case_reset_credit_count(self) -> None:
        usage = auth_session._sanitize_codex_usage(
            {
                "planType": "plus",
                "rateLimit": {
                    "primaryWindow": {
                        "usedPercent": 20,
                        "limitWindowSeconds": 18_000,
                        "resetAt": 2_000_000_000,
                    }
                },
                "rateLimitResetCredits": {"availableCount": 3},
                "credits": {"balance": "must-not-leak"},
            }
        )
        self.assertEqual(usage["quota"]["resetCredits"]["availableCount"], 3)
        self.assertIs(usage["authenticated"], True)
        self.assertEqual(usage["quota"]["primary"]["windowDurationMins"], 300)
        self.assertNotIn("must-not-leak", str(usage))

    def test_codex_usage_keeps_missing_reset_credit_count_unknown(self) -> None:
        base_payload = {
            "plan_type": "plus",
            "rate_limit": {
                "primary_window": {
                    "used_percent": 20,
                    "limit_window_seconds": 18_000,
                }
            },
        }
        missing = auth_session._sanitize_codex_usage(base_payload)
        explicit_null = auth_session._sanitize_codex_usage(
            {**base_payload, "rate_limit_reset_credits": None}
        )

        self.assertIsNone(missing["quota"]["resetCredits"]["availableCount"])
        self.assertIsNone(explicit_null["quota"]["resetCredits"]["availableCount"])

    def test_codex_usage_accepts_a_secondary_only_window(self) -> None:
        usage = auth_session._sanitize_codex_usage(
            {
                "plan_type": "plus",
                "rate_limit": {
                    "secondary_window": {
                        "used_percent": 12,
                        "limit_window_seconds": 604_800,
                    }
                },
            }
        )

        self.assertIsNone(usage["quota"]["primary"])
        self.assertEqual(usage["quota"]["remainingPercent"], 88)
        self.assertEqual(usage["quota"]["secondary"]["windowDurationMins"], 10_080)

    def test_codex_usage_preserves_upstream_forbidden_without_refreshing(self) -> None:
        entry = _entry(cookie=True, plan="plus")
        forbidden = AuthSessionError(
            "usage_forbidden", "not entitled", status_code=403
        )
        with (
            patch.object(auth_session, "_new_http_session", return_value=_HTTP()),
            patch.object(auth_session, "_request_json", side_effect=forbidden) as request,
            patch.object(auth_session, "refresh_local_auth_entry") as refresh,
        ):
            with self.assertRaises(AuthSessionError) as caught:
                auth_session.fetch_codex_usage(entry)

        self.assertIs(caught.exception, forbidden)
        self.assertEqual(request.call_count, 1)
        self.assertIs(request.call_args.kwargs["preserve_forbidden"], True)
        refresh.assert_not_called()

    def test_request_json_can_distinguish_forbidden_from_expired_session(self) -> None:
        class ForbiddenResponse:
            status_code = 403

        class ForbiddenHTTP:
            def request(self, *_args, **_kwargs):  # type: ignore[no-untyped-def]
                return ForbiddenResponse()

        with self.assertRaises(AuthSessionError) as caught:
            auth_session._request_json(
                ForbiddenHTTP(),
                auth_session.CODEX_USAGE_ENDPOINT,
                headers={},
                stage="codex_usage",
                preserve_forbidden=True,
            )

        self.assertEqual(caught.exception.code, "usage_forbidden")
        self.assertEqual(caught.exception.status_code, 403)

    def test_request_json_keeps_non_usage_forbidden_as_invalid_session(self) -> None:
        class ForbiddenResponse:
            status_code = 403

        class ForbiddenHTTP:
            def request(self, *_args, **_kwargs):  # type: ignore[no-untyped-def]
                return ForbiddenResponse()

        with self.assertRaises(AuthSessionError) as caught:
            auth_session._request_json(
                ForbiddenHTTP(),
                auth_session.SESSION_ENDPOINT,
                headers={},
                stage="session",
                # Even an accidental opt-in must not change login semantics.
                preserve_forbidden=True,
            )

        self.assertEqual(caught.exception.code, "invalid_session")
        self.assertEqual(caught.exception.status_code, 401)

    def test_request_json_retries_transient_network_failures_for_safe_reads(self) -> None:
        class SuccessResponse:
            status_code = 200

            @staticmethod
            def json() -> dict[str, bool]:
                return {"ok": True}

        class FlakyHTTP:
            def __init__(self) -> None:
                self.calls = 0

            def request(self, *_args, **_kwargs):  # type: ignore[no-untyped-def]
                self.calls += 1
                if self.calls < 3:
                    raise RuntimeError("transient TLS handshake failure")
                return SuccessResponse()

        http = FlakyHTTP()
        with patch.object(auth_session.time, "sleep") as sleep:
            result = auth_session._request_json(
                http,
                auth_session.SESSION_ENDPOINT,
                headers={},
                stage="session",
            )

        self.assertEqual(result, {"ok": True})
        self.assertEqual(http.calls, 3)
        self.assertEqual(sleep.call_count, 2)

    def test_request_json_never_retries_stateful_post_after_network_failure(self) -> None:
        class FailingHTTP:
            def __init__(self) -> None:
                self.calls = 0

            def request(self, *_args, **_kwargs):  # type: ignore[no-untyped-def]
                self.calls += 1
                raise RuntimeError("connection dropped after dispatch")

        http = FailingHTTP()
        with (
            patch.object(auth_session.time, "sleep") as sleep,
            self.assertRaises(AuthSessionError) as caught,
        ):
            auth_session._request_json(
                http,
                auth_session.CODEX_RESET_CREDITS_CONSUME_ENDPOINT,
                headers={},
                stage="codex_reset_redeem",
                method="POST",
                json_body={"redeem_request_id": "request-id"},
            )

        self.assertEqual(caught.exception.code, "upstream_unavailable")
        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual(http.calls, 1)
        sleep.assert_not_called()

    def test_codex_usage_refreshes_cookie_backed_token_once_after_401(self) -> None:
        entry = _entry(cookie=True, plan="plus")
        payload = {
            "plan_type": "plus",
            "rate_limit": {
                "primary_window": {
                    "used_percent": 1,
                    "limit_window_seconds": 18_000,
                    "reset_at": 2_000_000_000,
                }
            },
        }
        refreshed = UpstreamCredential(
            kind="session_cookie",
            access_token="fresh-token",
            access_token_expires_at_epoch=time.time() + 3600,
            cookie_header="session=test-cookie",
            account_id="account-selected",
            user_id="user-selected",
        )
        with (
            patch.object(auth_session, "_new_http_session", return_value=_HTTP()),
            patch.object(
                auth_session,
                "_request_json",
                side_effect=[
                    AuthSessionError("invalid_session", "expired", status_code=401),
                    payload,
                    {"available_count": 1},
                    {"group_by": "day", "data": []},
                    {"units": "credits", "group_by": "day", "data": []},
                    {"balance": "5"},
                ],
            ) as request,
            patch.object(
                auth_session, "refresh_local_auth_entry", return_value=refreshed
            ) as refresh,
        ):
            usage = auth_session.fetch_codex_usage(entry)

        refresh.assert_called_once_with(entry)
        self.assertEqual(request.call_count, 6)
        self.assertEqual(
            request.call_args_list[1].kwargs["headers"]["Authorization"],
            "Bearer fresh-token",
        )
        self.assertEqual(usage["quota"]["primary"]["remainingPercent"], 99)

    def test_optional_usage_401_refreshes_once_and_rebinds_remaining_requests(self) -> None:
        entry = _entry(cookie=True, plan="pro")
        primary = {
            "rate_limit": {
                "primary_window": {
                    "used_percent": 25,
                    "limit_window_seconds": 18_000,
                }
            }
        }
        refreshed = UpstreamCredential(
            kind="session_cookie",
            access_token="fresh-token",
            access_token_expires_at_epoch=time.time() + 3600,
            cookie_header="session=test-cookie",
            account_id="account-selected",
            user_id="user-selected",
        )
        with (
            patch.object(auth_session, "_new_http_session", return_value=_HTTP()),
            patch.object(
                auth_session,
                "_request_json",
                side_effect=[
                    primary,
                    AuthSessionError("invalid_session", "expired", status_code=401),
                    {"available_count": 2},
                    {"group_by": "day", "data": []},
                    {"units": "credits", "group_by": "day", "data": []},
                    {"balance": "15"},
                ],
            ) as request,
            patch.object(
                auth_session, "refresh_local_auth_entry", return_value=refreshed
            ) as refresh,
        ):
            usage = auth_session.fetch_codex_usage(entry, cache_ttl_seconds=0)

        refresh.assert_called_once_with(entry)
        self.assertEqual(request.call_count, 6)
        self.assertEqual(
            request.call_args_list[2].kwargs["headers"]["Authorization"],
            "Bearer fresh-token",
        )
        self.assertEqual(
            request.call_args_list[3].kwargs["headers"]["Authorization"],
            "Bearer fresh-token",
        )
        self.assertEqual(
            request.call_args_list[4].kwargs["headers"]["Authorization"],
            "Bearer fresh-token",
        )
        self.assertEqual(
            request.call_args_list[5].kwargs["headers"]["Authorization"],
            "Bearer fresh-token",
        )
        self.assertEqual(usage["quota"]["resetCredits"]["availableCount"], 2)

    def test_optional_usage_failures_are_explicit_and_keep_live_quota(self) -> None:
        entry = _entry(plan="plus")
        primary = {
            "rate_limit": {
                "primary_window": {
                    "used_percent": 33,
                    "limit_window_seconds": 18_000,
                }
            }
        }
        with (
            patch.object(auth_session, "_new_http_session", return_value=_HTTP()),
            patch.object(
                auth_session,
                "_request_json",
                side_effect=[
                    primary,
                    AuthSessionError("usage_forbidden", "hidden", status_code=403),
                    AuthSessionError(
                        "upstream_unavailable", "temporary", status_code=503
                    ),
                    AuthSessionError(
                        "upstream_unavailable", "temporary", status_code=503
                    ),
                    AuthSessionError(
                        "upstream_unavailable", "temporary", status_code=503
                    ),
                ],
            ),
        ):
            usage = auth_session.fetch_codex_usage(entry, cache_ttl_seconds=0)

        self.assertEqual(usage["availability"], "available")
        self.assertEqual(usage["quota"]["remainingPercent"], 67)
        self.assertIsNone(usage["quota"]["resetCredits"]["availableCount"])
        self.assertEqual(usage["usage"]["availability"], "unavailable")
        self.assertEqual(
            usage["upstream"]["optionalErrors"],
            {
                "codex_reset_credits": "usage_forbidden",
                "codex_daily_workspace_usage_counts": "upstream_unavailable",
                "codex_daily_usage": "upstream_unavailable",
                "codex_remaining_balance": "upstream_unavailable",
            },
        )

    def test_codex_usage_never_turns_missing_upstream_percent_into_fake_full_quota(self) -> None:
        usage = auth_session._sanitize_codex_usage(
            {
                "plan_type": "plus",
                "rate_limit": {
                    "primary_window": {"limit_window_seconds": 18_000}
                },
            }
        )
        self.assertEqual(usage["availability"], "unavailable")
        self.assertIsNone(usage["quota"]["remainingPercent"])
        self.assertIsNone(usage["quota"]["primary"])

    def test_codex_usage_rejects_boolean_percent_as_invalid_data(self) -> None:
        usage = auth_session._sanitize_codex_usage(
            {
                "rate_limit": {
                    "primary_window": {
                        "used_percent": True,
                        "limit_window_seconds": 18_000,
                    }
                }
            }
        )
        self.assertEqual(usage["availability"], "unavailable")
        self.assertIsNone(usage["quota"]["remainingPercent"])

    def test_offline_wham_fixtures_preserve_real_credits_without_fake_exhaustion(self) -> None:
        usage = auth_session._sanitize_codex_usage(
            _fixture("wham_usage_pro.json"),
            reset_credits_payload=_fixture("wham_reset_credits.json"),
            daily_usage_payload=_fixture("wham_daily_usage.json"),
            plan_fallback="pro",
        )

        self.assertEqual(usage["availability"], "available")
        self.assertEqual(usage["planType"], "pro")
        self.assertEqual(usage["quota"]["remainingPercent"], 18)
        self.assertIs(usage["quota"]["limitReached"], True)
        # The captured web client treats a real credit balance/has_credits as a
        # continuation path even if the included rolling window is exhausted.
        self.assertIs(usage["quota"]["effectiveLimitReached"], False)
        self.assertEqual(usage["quota"]["credits"]["balance"], 27.5)
        self.assertEqual(
            usage["quota"]["spendControl"]["individualLimit"]["remaining"], 75
        )
        self.assertEqual(usage["quota"]["resetCredits"]["availableCount"], 2)
        self.assertEqual(usage["usage"]["summary"]["rangeCredits"], 3.75)
        self.assertEqual(usage["usage"]["summary"]["apiEquivalentUsd"], 0.15)
        self.assertEqual(
            usage["usage"]["dailyUsageBuckets"][0]["apiEquivalentUsd"], 0.07
        )
        self.assertEqual(
            usage["usage"]["dailyUsageBuckets"][0]["models"][0]["model"],
            "gpt-5.6-codex",
        )
        self.assertEqual(
            usage["usage"]["dailyUsageBuckets"][0]["models"][0][
                "apiEquivalentUsd"
            ],
            0.07,
        )
        self.assertEqual(
            usage["usage"]["dailyUsageBuckets"][0][
                "productSurfaceApiEquivalentUsd"
            ],
            {"codex_cloud": 0.05, "chatgpt_work": 0.02},
        )
        self.assertEqual(
            usage["usage"]["dailyUsageBuckets"][0]["surfaces"][0],
            {"surface": "codex_cloud", "credits": 1.25, "apiEquivalentUsd": 0.05},
        )
        pricing = usage["usage"]["pricing"]
        self.assertEqual(pricing["kind"], "nominal_api_equivalent")
        self.assertIs(pricing["estimated"], True)
        self.assertEqual(pricing["creditsPerUsd"], 25.0)
        self.assertEqual(pricing["currency"], "USD")
        self.assertEqual(pricing["asOf"], "2026-08-31")
        self.assertIs(pricing["available"], True)
        self.assertEqual(pricing["source"], auth_session.OPENAI_CREDIT_RATE_CARD_URL)
        self.assertEqual(
            pricing["apiPricingSource"], auth_session.OPENAI_API_PRICING_URL
        )
        self.assertIn(auth_session.OPENAI_CREDIT_RATE_CARD_URL, pricing["sourceUrls"])
        self.assertIn(auth_session.OPENAI_API_PRICING_URL, pricing["sourceUrls"])
        self.assertIn("not an actual API bill", pricing["note"])
        self.assertTrue(any("2.5x" in item for item in pricing["limitations"]))
        self.assertNotIn("tokens", str(usage["usage"]))
        rendered = str(usage)
        self.assertNotIn("fixture-user-must-not-leak", rendered)
        self.assertNotIn("fixture-account-must-not-leak", rendered)
        self.assertNotIn("fixture-private-email", rendered)
        self.assertNotIn("fixture-credit-id", rendered)

    def test_actual_workspace_counts_merge_plus_percent_without_pricing_percent(self) -> None:
        usage = auth_session._sanitize_codex_usage(
            {
                "plan_type": "plus",
                "rate_limit": {
                    "primary_window": {
                        "used_percent": 10,
                        "limit_window_seconds": 18_000,
                    }
                },
            },
            daily_usage_payload=_fixture("wham_daily_usage_percent.json"),
            daily_usage_counts_payload=_fixture(
                "wham_daily_workspace_usage_counts.json"
            ),
            plan_fallback="plus",
        )

        details = usage["usage"]
        self.assertEqual(details["availability"], "available")
        self.assertEqual(details["units"], "credits")
        self.assertEqual(details["summary"]["rangeCredits"], 3.75)
        self.assertEqual(details["summary"]["apiEquivalentUsd"], 0.15)
        self.assertIs(details["pricing"]["available"], True)
        self.assertEqual(
            [bucket["date"] for bucket in details["dailyUsageBuckets"]],
            ["2026-08-29", "2026-08-30"],
        )
        first = details["dailyUsageBuckets"][0]
        self.assertEqual(first["credits"], 1.75)
        self.assertEqual(first["apiEquivalentUsd"], 0.07)
        self.assertEqual(first["planUsagePercent"], 5)
        self.assertEqual(
            first["planUsageModels"],
            [
                {
                    "model": "gpt-5.6-codex",
                    "speed": None,
                    "planUsagePercent": 5,
                }
            ],
        )
        self.assertNotIn("credits", first["planUsageModels"][0])
        self.assertEqual(
            first["productSurfaceUsagePercentValues"], {"codex_cloud": 5}
        )
        self.assertEqual(first["models"][0]["credits"], 1.75)
        self.assertEqual(first["clients"][0]["clientId"], "codex_cloud")
        self.assertEqual(first["totals"]["uncachedTextInputTokens"], 1200)
        self.assertEqual(
            first["productSurfaceUsageValues"], {"codex_cloud": 1.75}
        )
        self.assertEqual(
            first["productSurfaceApiEquivalentUsd"], {"codex_cloud": 0.07}
        )
        self.assertEqual(
            first["surfaces"],
            [
                {
                    "surface": "codex_cloud",
                    "credits": 1.75,
                    "apiEquivalentUsd": 0.07,
                }
            ],
        )
        self.assertEqual(usage["upstream"]["dailyUsageCounts"], "available")
        rendered = str(details)
        self.assertNotIn("must-not-leak", rendered)
        self.assertNotIn("private-email", rendered)

    def test_percent_daily_usage_is_plan_usage_not_credit_usage(self) -> None:
        details = auth_session._sanitize_daily_usage(
            _fixture("wham_daily_usage_percent.json")
        )

        self.assertEqual(details["availability"], "available")
        self.assertEqual(details["units"], "percent")
        self.assertIsNone(details["summary"]["rangeCredits"])
        self.assertIsNone(details["summary"]["apiEquivalentUsd"])
        self.assertIs(details["pricing"]["available"], False)
        first = details["dailyUsageBuckets"][0]
        self.assertIsNone(first["credits"])
        self.assertIsNone(first["apiEquivalentUsd"])
        self.assertEqual(first["models"], [])
        self.assertEqual(first["surfaces"], [])
        self.assertEqual(first["planUsagePercent"], 5)
        self.assertEqual(
            first["productSurfaceUsagePercentValues"], {"codex_cloud": 5}
        )
        self.assertNotIn("credits", str(first["planUsageModels"]))

    def test_workspace_counts_total_is_authoritative_and_schema_is_strict(self) -> None:
        details = auth_session._sanitize_daily_workspace_usage_counts(
            {
                "group_by": "day",
                "data": [
                    {
                        "date": "2026-08-31",
                        "totals": {
                            "credits": 3,
                            "uncached_text_input_tokens": 10,
                            "cached_text_input_tokens": -1,
                        },
                        "models": [
                            {"model": "actual-model", "credits": 200},
                            {"model": "", "credits": 1},
                        ],
                        "clients": [
                            {"client_id": "cli", "credits": 100},
                            {"client_id": "bad", "credits": True},
                        ],
                        "credits": 999,
                        "email": "must-not-leak@example.test",
                    }
                ],
            }
        )

        self.assertEqual(details["summary"]["rangeCredits"], 3)
        self.assertEqual(details["summary"]["apiEquivalentUsd"], 0.12)
        bucket = details["dailyUsageBuckets"][0]
        self.assertEqual(bucket["credits"], 3)
        self.assertEqual(bucket["models"][0]["credits"], 200)
        self.assertEqual(bucket["productSurfaceUsageValues"], {"cli": 100})
        self.assertIsNone(bucket["clients"][1]["credits"])
        self.assertEqual(bucket["totals"]["uncachedTextInputTokens"], 10)
        self.assertIsNone(bucket["totals"]["cachedTextInputTokens"])
        self.assertNotIn("999", str(details["summary"]))
        self.assertNotIn("must-not-leak", str(details))

        string_credit = auth_session._sanitize_daily_workspace_usage_counts(
            {
                "data": [
                    {"date": "2026-08-31", "totals": {"credits": "3"}}
                ]
            }
        )
        self.assertEqual(string_credit["availability"], "available")
        self.assertIsNone(string_credit["dailyUsageBuckets"][0]["credits"])
        self.assertIsNone(string_credit["summary"]["rangeCredits"])
        self.assertIsNone(string_credit["summary"]["apiEquivalentUsd"])

        malformed = auth_session._sanitize_daily_workspace_usage_counts(
            {"data": [{"date": "not-a-date", "totals": {"credits": 1}}]}
        )
        self.assertEqual(malformed["availability"], "unavailable")
        self.assertIsNone(malformed["units"])
        self.assertIsNone(malformed["summary"]["rangeCredits"])

        empty = auth_session._sanitize_daily_workspace_usage_counts({"data": []})
        self.assertEqual(empty["availability"], "available")
        self.assertEqual(empty["units"], "credits")
        self.assertEqual(empty["summary"]["rangeCredits"], 0)
        self.assertEqual(empty["summary"]["apiEquivalentUsd"], 0)

    def test_percent_only_date_keeps_actual_credit_range_partial(self) -> None:
        details = auth_session._merge_daily_usage(
            {
                "group_by": "day",
                "data": [
                    {"date": "2026-08-30", "totals": {"credits": 1}}
                ],
            },
            {
                "units": "percent",
                "group_by": "day",
                "data": [
                    {"date": "2026-08-29", "models": [{"credits": 5}]},
                    {"date": "2026-08-30", "models": [{"credits": 10}]},
                ],
            },
        )

        self.assertEqual(details["units"], "credits")
        self.assertIsNone(details["summary"]["rangeCredits"])
        self.assertIsNone(details["summary"]["apiEquivalentUsd"])
        self.assertIsNone(details["dailyUsageBuckets"][0]["credits"])
        self.assertEqual(details["dailyUsageBuckets"][0]["planUsagePercent"], 5)
        self.assertEqual(details["dailyUsageBuckets"][1]["credits"], 1)
        self.assertEqual(details["dailyUsageBuckets"][1]["planUsagePercent"], 10)

    def test_api_equivalent_is_null_for_non_credit_units_at_every_level(self) -> None:
        usage = auth_session._sanitize_daily_usage(
            {
                "units": "tokens",
                "group_by": "day",
                "data": [
                    {
                        "date": "2026-08-31",
                        "credits": 25,
                        "models": [
                            {"model": "opaque-model", "speed": "fast", "credits": 50}
                        ],
                        "product_surface_usage_values": {"cli": 75},
                    }
                ],
            }
        )

        self.assertEqual(usage["summary"]["rangeCredits"], 25)
        self.assertIsNone(usage["summary"]["apiEquivalentUsd"])
        bucket = usage["dailyUsageBuckets"][0]
        self.assertIsNone(bucket["apiEquivalentUsd"])
        self.assertIsNone(bucket["models"][0]["apiEquivalentUsd"])
        self.assertEqual(bucket["productSurfaceApiEquivalentUsd"], {"cli": None})
        self.assertIsNone(bucket["surfaces"][0]["apiEquivalentUsd"])
        self.assertIs(usage["pricing"]["estimated"], True)
        self.assertIs(usage["pricing"]["available"], False)

    def test_api_equivalent_handles_empty_tiny_and_unknown_usage_safely(self) -> None:
        empty = auth_session._sanitize_daily_usage(
            {"units": " CREDITS ", "group_by": "day", "data": []}
        )
        self.assertEqual(empty["summary"]["rangeCredits"], 0.0)
        self.assertEqual(empty["summary"]["apiEquivalentUsd"], 0.0)
        self.assertIs(empty["pricing"]["available"], True)

        tiny = auth_session._sanitize_daily_usage(
            {
                "units": "credits",
                "data": [
                    {
                        "date": "2026-08-31",
                        "credits": 0.000001,
                        "models": [{"credits": -10}],
                        "product_surface_usage_values": {"cli": -20},
                    }
                ],
            }
        )
        bucket = tiny["dailyUsageBuckets"][0]
        self.assertEqual(bucket["apiEquivalentUsd"], 0.00000004)
        self.assertEqual(bucket["models"][0]["credits"], 0.0)
        self.assertEqual(bucket["models"][0]["apiEquivalentUsd"], 0.0)
        self.assertEqual(bucket["surfaces"][0]["credits"], 0.0)
        self.assertEqual(bucket["surfaces"][0]["apiEquivalentUsd"], 0.0)

        unavailable = auth_session._sanitize_daily_usage(None)
        self.assertIsNone(unavailable["summary"]["apiEquivalentUsd"])
        self.assertIs(unavailable["pricing"]["estimated"], True)
        self.assertIs(unavailable["pricing"]["available"], False)

    def test_workspace_monthly_fixture_is_live_and_identity_safe(self) -> None:
        usage = auth_session._sanitize_codex_usage(
            {
                "plan_type": "business",
                "rate_limit": {
                    "allowed": True,
                    "limit_reached": False,
                    "primary_window": {
                        "used_percent": 10,
                        "limit_window_seconds": 18_000,
                    },
                },
            },
            remaining_balance_payload={
                "balance": "140",
                "expiring_balance_details": [
                    {"amount_remaining": "25", "expiry_date": "2026-09-30"},
                    {"amount_remaining": "private-invalid", "expiry_date": "hidden"},
                ],
            },
            workspace_monthly_payload=_fixture("workspace_monthly_usage.json"),
            plan_fallback="business",
            daily_usage_scope="workspace-user",
        )

        workspace = usage["workspace"]
        self.assertEqual(workspace["scope"], "workspace")
        self.assertEqual(workspace["remainingBalance"]["balance"], 140)
        self.assertEqual(len(workspace["remainingBalance"]["expiringBalanceDetails"]), 1)
        monthly = workspace["monthlyUsage"]
        self.assertEqual(monthly["availability"], "available")
        self.assertEqual(monthly["limit"], 200)
        self.assertEqual(monthly["used"], 60)
        self.assertEqual(monthly["remaining"], 140)
        self.assertEqual(monthly["usedPercent"], 30)
        self.assertEqual(monthly["remainingPercent"], 70)
        self.assertIs(monthly["reached"], False)
        rendered = str(usage)
        self.assertNotIn("fixture-workspace-id", rendered)
        self.assertNotIn("fixture-workspace-email", rendered)

    def test_codex_usage_cache_is_per_entry_and_returns_defensive_copies(self) -> None:
        first = _entry(plan="plus")
        second = _entry(plan="plus")
        second.account = PublicAccount(
            id="account-other",
            user_id="user-other",
            name="Other",
            email="other@example.test",
            initials="O",
            plan="plus",
            plan_label="Plus",
        )
        second.credential = UpstreamCredential(
            kind="access_token",
            access_token="other-token",
            access_token_expires_at_epoch=time.time() + 3600,
            cookie_header=None,
            account_id="account-other",
            user_id="user-other",
        )
        counters = {"account-selected": 0, "account-other": 0}

        def response(_http, url, *, headers, stage, **_kwargs):  # type: ignore[no-untyped-def]
            account_id = headers["ChatGPT-Account-ID"]
            counters[account_id] += 1
            if stage == "codex_usage":
                return {
                    "rate_limit": {
                        "primary_window": {
                            "used_percent": 10 if account_id == "account-selected" else 80,
                            "limit_window_seconds": 18_000,
                        }
                    }
                }
            if stage == "codex_reset_credits":
                return {"available_count": 0}
            if stage == "codex_daily_workspace_usage_counts":
                self.assertIn("workspace_user=true", url)
                return {"group_by": "day", "data": []}
            if stage == "codex_daily_usage":
                self.assertIn("group_by=day", url)
                return {"units": "credits", "group_by": "day", "data": []}
            if stage == "codex_remaining_balance":
                return {"balance": "10"}
            self.fail(f"unexpected Codex usage request stage: {stage}")

        with (
            patch.object(auth_session, "_new_http_session", side_effect=[_HTTP(), _HTTP()]),
            patch.object(auth_session, "_request_json", side_effect=response) as request,
        ):
            first_result = auth_session.fetch_codex_usage(first)
            first_result["quota"]["primary"]["remainingPercent"] = -1
            first_cached = auth_session.fetch_codex_usage(first)
            second_result = auth_session.fetch_codex_usage(second)

        self.assertEqual(request.call_count, 10)
        self.assertEqual(first_cached["quota"]["primary"]["remainingPercent"], 90)
        self.assertEqual(second_result["quota"]["primary"]["remainingPercent"], 20)
        self.assertEqual(counters, {"account-selected": 5, "account-other": 5})

    def test_reset_credit_list_only_exposes_available_whitelisted_cards(self) -> None:
        result = auth_session._sanitize_codex_reset_credits(
            {
                "available_count": 2,
                "total_earned_count": 9,
                "history_enabled": True,
                "credits": [
                    {
                        "id": "credit-available",
                        "title": "Weekly reset",
                        "expires_at": "2026-09-30T00:00:00Z",
                        "is_supported_by_plan": False,
                        "status": "available",
                        "reset_type": "codex_weekly",
                        "profile_user_id": "must-not-leak-user",
                        "profile_image_url": "must-not-leak-image",
                        "description": "not-required-by-the-client",
                    },
                    {
                        "id": "credit-redeemed",
                        "status": "redeemed",
                        "redeemed_at": "private-history",
                    },
                    {
                        "id": "x" * (auth_session.MAX_CODEX_RESET_CREDIT_ID_CHARS + 1),
                        "status": "available",
                    },
                ],
            }
        )

        self.assertEqual(
            set(result), {"ok", "authenticated", "availableCount", "credits"}
        )
        self.assertEqual(result["availableCount"], 2)
        self.assertEqual(
            result["credits"],
            [
                {
                    "id": "credit-available",
                    "title": "Weekly reset",
                    "expiresAt": "2026-09-30T00:00:00Z",
                    "isSupportedByPlan": False,
                    "status": "available",
                    "resetType": "codex_weekly",
                }
            ],
        )
        rendered = str(result)
        self.assertNotIn("must-not-leak", rendered)
        self.assertNotIn("credit-redeemed", rendered)
        self.assertNotIn("total_earned_count", rendered)

    def test_fetch_reset_credits_refreshes_once_and_returns_safe_cards(self) -> None:
        entry = _entry(cookie=True, plan="plus")
        refreshed = UpstreamCredential(
            kind="session_cookie",
            access_token="fresh-token",
            access_token_expires_at_epoch=time.time() + 3600,
            cookie_header="session=test-cookie",
            account_id="account-selected",
            user_id="user-selected",
        )
        with (
            patch.object(auth_session, "_new_http_session", return_value=_HTTP()),
            patch.object(
                auth_session,
                "_request_json",
                side_effect=[
                    AuthSessionError("invalid_session", "expired", status_code=401),
                    {
                        "available_count": 1,
                        "credits": [
                            {"id": "credit-one", "status": "available", "title": "Reset"}
                        ],
                    },
                ],
            ) as request,
            patch.object(
                auth_session, "refresh_local_auth_entry", return_value=refreshed
            ) as refresh,
        ):
            result = auth_session.fetch_codex_reset_credits(entry)

        refresh.assert_called_once_with(entry)
        self.assertEqual(request.call_count, 2)
        self.assertEqual(
            request.call_args_list[0].args[1], auth_session.CODEX_RESET_CREDITS_ENDPOINT
        )
        self.assertEqual(
            request.call_args_list[1].kwargs["headers"]["Authorization"],
            "Bearer fresh-token",
        )
        self.assertEqual(result["credits"][0]["id"], "credit-one")

    def test_reset_credit_list_caps_array_and_display_strings(self) -> None:
        result = auth_session._sanitize_codex_reset_credits(
            {
                "available_count": 70,
                "credits": [
                    {
                        "id": f"credit-{index}",
                        "status": "available",
                        "title": "t" * (auth_session.MAX_CODEX_RESET_TITLE_CHARS + 50),
                    }
                    for index in range(70)
                ],
            }
        )
        self.assertEqual(len(result["credits"]), auth_session.MAX_CODEX_RESET_CREDITS)
        self.assertEqual(
            len(result["credits"][0]["title"]),
            auth_session.MAX_CODEX_RESET_TITLE_CHARS,
        )

    def test_consume_automatic_reset_is_idempotent_and_invalidates_usage_cache(self) -> None:
        entry = _entry(plan="plus")
        entry.usage_snapshot = {"quota": {"remainingPercent": 1}}
        entry.usage_cached_at_monotonic = time.monotonic()
        redeem_request_id = "11111111-2222-4333-8444-555555555555"
        with (
            patch.object(auth_session, "_new_http_session", return_value=_HTTP()),
            patch.object(
                auth_session,
                "_request_json",
                return_value={"code": "reset", "credit": {"id": "credit-used"}},
            ) as request,
        ):
            first = auth_session.consume_codex_reset_credit(
                entry, credit_id=None, redeem_request_id=redeem_request_id
            )
            second = auth_session.consume_codex_reset_credit(
                entry, credit_id=None, redeem_request_id=redeem_request_id
            )

        self.assertEqual(first, second)
        self.assertEqual(
            first,
            {
                "ok": True,
                "authenticated": True,
                "code": "reset",
                "creditId": "credit-used",
            },
        )
        request.assert_called_once()
        self.assertEqual(
            request.call_args.args[1], auth_session.CODEX_RESET_CREDITS_CONSUME_ENDPOINT
        )
        self.assertEqual(request.call_args.kwargs["method"], "POST")
        self.assertEqual(
            request.call_args.kwargs["json_body"],
            {"redeem_request_id": redeem_request_id},
        )
        self.assertNotIn("credit_id", request.call_args.kwargs["json_body"])
        self.assertEqual(
            request.call_args.kwargs["headers"]["Origin"], auth_session.CHATGPT_ORIGIN
        )
        self.assertIsNone(entry.usage_snapshot)
        self.assertEqual(entry.usage_cached_at_monotonic, 0.0)

    def test_consume_explicit_reset_preserves_known_code_and_rejects_uuid_rebinding(self) -> None:
        entry = _entry(plan="plus")
        entry.usage_snapshot = {"quota": {"remainingPercent": 12}}
        entry.usage_cached_at_monotonic = time.monotonic()
        redeem_request_id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
        with (
            patch.object(auth_session, "_new_http_session", return_value=_HTTP()),
            patch.object(
                auth_session, "_request_json", return_value={"code": "no_credit"}
            ) as request,
        ):
            result = auth_session.consume_codex_reset_credit(
                entry,
                credit_id="credit-explicit",
                redeem_request_id=redeem_request_id,
            )

        self.assertEqual(
            result,
            {
                "ok": False,
                "authenticated": True,
                "code": "no_credit",
                "creditId": "credit-explicit",
            },
        )
        self.assertEqual(
            request.call_args.kwargs["json_body"],
            {
                "redeem_request_id": redeem_request_id,
                "credit_id": "credit-explicit",
            },
        )
        self.assertIsNone(entry.usage_snapshot)
        self.assertEqual(entry.usage_cached_at_monotonic, 0.0)
        with self.assertRaises(AuthSessionError) as caught:
            auth_session.consume_codex_reset_credit(
                entry,
                credit_id="different-credit",
                redeem_request_id=redeem_request_id,
            )
        self.assertEqual(caught.exception.code, "reset_idempotency_conflict")
        self.assertEqual(caught.exception.status_code, 409)

    def test_nothing_to_reset_clears_only_the_current_entry_usage_cache(self) -> None:
        entry = _entry(plan="plus")
        other = _entry(plan="plus")
        entry.usage_snapshot = {"quota": {"remainingPercent": 100}}
        entry.usage_cached_at_monotonic = time.monotonic()
        other.usage_snapshot = {"quota": {"remainingPercent": 47}}
        other_cached_at = time.monotonic()
        other.usage_cached_at_monotonic = other_cached_at

        with (
            patch.object(auth_session, "_new_http_session", return_value=_HTTP()),
            patch.object(
                auth_session,
                "_request_json",
                return_value={"code": "nothing_to_reset"},
            ),
        ):
            result = auth_session.consume_codex_reset_credit(
                entry,
                credit_id=None,
                redeem_request_id="33333333-4444-4555-8666-777777777777",
            )

        self.assertEqual(result["code"], "nothing_to_reset")
        self.assertIs(result["ok"], False)
        self.assertIsNone(entry.usage_snapshot)
        self.assertEqual(entry.usage_cached_at_monotonic, 0.0)
        self.assertEqual(other.usage_snapshot, {"quota": {"remainingPercent": 47}})
        self.assertEqual(other.usage_cached_at_monotonic, other_cached_at)

    def test_consume_reset_401_retry_reuses_exact_body_and_request_id(self) -> None:
        entry = _entry(cookie=True, plan="plus")
        redeem_request_id = "01234567-89ab-4cde-8fab-0123456789ab"
        refreshed = UpstreamCredential(
            kind="session_cookie",
            access_token="fresh-token",
            access_token_expires_at_epoch=time.time() + 3600,
            cookie_header="session=test-cookie",
            account_id="account-selected",
            user_id="user-selected",
        )
        with (
            patch.object(auth_session, "_new_http_session", return_value=_HTTP()),
            patch.object(
                auth_session,
                "_request_json",
                side_effect=[
                    AuthSessionError("invalid_session", "expired", status_code=401),
                    {"code": "reset"},
                ],
            ) as request,
            patch.object(
                auth_session, "refresh_local_auth_entry", return_value=refreshed
            ) as refresh,
        ):
            result = auth_session.consume_codex_reset_credit(
                entry,
                credit_id="credit-one",
                redeem_request_id=redeem_request_id,
            )

        self.assertEqual(result["code"], "reset")
        refresh.assert_called_once_with(entry)
        self.assertEqual(request.call_count, 2)
        first_body = request.call_args_list[0].kwargs["json_body"]
        second_body = request.call_args_list[1].kwargs["json_body"]
        self.assertIs(first_body, second_body)
        self.assertEqual(
            second_body,
            {"redeem_request_id": redeem_request_id, "credit_id": "credit-one"},
        )
        self.assertEqual(
            request.call_args_list[1].kwargs["headers"]["Authorization"],
            "Bearer fresh-token",
        )

    def test_consume_reset_rejects_unknown_upstream_shape_without_passthrough(self) -> None:
        entry = _entry(plan="plus")
        with (
            patch.object(auth_session, "_new_http_session", return_value=_HTTP()),
            patch.object(
                auth_session,
                "_request_json",
                return_value={"code": "unexpected", "secret": "must-not-leak"},
            ),
            self.assertRaises(AuthSessionError) as caught,
        ):
            auth_session.consume_codex_reset_credit(
                entry,
                credit_id=None,
                redeem_request_id="99999999-8888-4777-8666-555555555555",
            )
        self.assertEqual(caught.exception.status_code, 502)
        self.assertNotIn("must-not-leak", caught.exception.message)

    def test_reset_redeem_cache_and_results_are_scoped_to_each_entry(self) -> None:
        first = _entry(plan="plus")
        second = _entry(plan="plus")
        second.account = PublicAccount(
            id="account-other",
            user_id="user-other",
            name="Other",
            email="other@example.test",
            initials="O",
            plan="plus",
            plan_label="Plus",
        )
        second.credential = UpstreamCredential(
            kind="access_token",
            access_token="other-token",
            access_token_expires_at_epoch=time.time() + 3600,
            cookie_header=None,
            account_id="account-other",
            user_id="user-other",
        )
        redeem_request_id = "77777777-6666-4555-8444-333333333333"

        def response(_http, _url, *, headers, **_kwargs):  # type: ignore[no-untyped-def]
            return {
                "code": "reset",
                "credit": {"id": "credit-" + headers["ChatGPT-Account-ID"]},
            }

        with (
            patch.object(
                auth_session, "_new_http_session", side_effect=[_HTTP(), _HTTP()]
            ),
            patch.object(auth_session, "_request_json", side_effect=response) as request,
        ):
            first_result = auth_session.consume_codex_reset_credit(
                first, credit_id=None, redeem_request_id=redeem_request_id
            )
            second_result = auth_session.consume_codex_reset_credit(
                second, credit_id=None, redeem_request_id=redeem_request_id
            )

        self.assertEqual(request.call_count, 2)
        self.assertEqual(first_result["creditId"], "credit-account-selected")
        self.assertEqual(second_result["creditId"], "credit-account-other")

    def test_already_redeemed_result_invalidates_only_current_usage_cache(self) -> None:
        entry = _entry(plan="plus")
        entry.usage_snapshot = {"quota": {"remainingPercent": 9}}
        entry.usage_cached_at_monotonic = time.monotonic()
        with (
            patch.object(auth_session, "_new_http_session", return_value=_HTTP()),
            patch.object(
                auth_session,
                "_request_json",
                return_value={"code": "already_redeemed"},
            ),
        ):
            result = auth_session.consume_codex_reset_credit(
                entry,
                credit_id=None,
                redeem_request_id="22222222-3333-4444-8555-666666666666",
            )
        self.assertIs(result["ok"], False)
        self.assertEqual(result["code"], "already_redeemed")
        self.assertIsNone(entry.usage_snapshot)
        self.assertEqual(entry.usage_cached_at_monotonic, 0.0)

    def test_daily_usage_endpoint_is_selected_from_the_bound_account_plan(self) -> None:
        personal_url, personal_scope = auth_session._daily_usage_url("pro")
        workspace_url, workspace_scope = auth_session._daily_usage_url("business")
        counts_url = auth_session._daily_workspace_usage_counts_url()

        self.assertTrue(personal_url.startswith(auth_session.CODEX_DAILY_USAGE_ENDPOINT))
        self.assertEqual(personal_scope, "personal")
        self.assertTrue(
            workspace_url.startswith(auth_session.CODEX_WORKSPACE_DAILY_USAGE_ENDPOINT)
        )
        self.assertEqual(workspace_scope, "workspace-user")
        self.assertTrue(
            counts_url.startswith(
                auth_session.CODEX_DAILY_WORKSPACE_USAGE_COUNTS_ENDPOINT
            )
        )
        self.assertIn("workspace_user=true", counts_url)
        for url in (personal_url, workspace_url, counts_url):
            self.assertIn("start_date=", url)
            self.assertIn("end_date=", url)
            self.assertIn("group_by=day", url)


if __name__ == "__main__":
    unittest.main()
