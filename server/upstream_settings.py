from __future__ import annotations

import copy
import json
import logging
import re
import threading
import time
from dataclasses import dataclass
from typing import Any, Mapping
from urllib.parse import urlencode

from .account_settings import (
    AccountSettingsError,
    validate_settings_patch,
)
from .auth_session import (
    AUTH_UPSTREAM_NETWORK_ATTEMPTS,
    AUTH_UPSTREAM_TIMEOUT_SECONDS,
    AUTH_VERIFY_TLS,
    CHATGPT_ORIGIN,
    AuthSessionError,
    LocalAuthEntry,
    _credential_headers,
    _new_http_session,
    ensure_fresh_credential,
    refresh_local_auth_entry,
)


LOGGER = logging.getLogger("chatgpt_account_bridge.settings")
BACKEND_ORIGIN = f"{CHATGPT_ORIGIN}/backend-api"

_DYNAMIC_ID = re.compile(r"[a-z0-9][a-z0-9_:-]{0,63}")
_VOICE_ID = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}")
_RESERVED_DYNAMIC_IDS = {"constructor", "prototype", "__proto__"}
_NOTIFICATION_CHANNELS = {"push", "email"}
_ACCENT_VALUES = {"default", "black", "blue", "green", "purple", "yellow", "pink", "orange"}
_PET_VALUES = {"default", "codex", "dewey", "fireball", "hoots", "rocky", "seedy", "stacky", "bsod", "null-signal"}
_VOICE_INTELLIGENCE_VALUES = {"instant", "medium", "high"}
_MAX_NOTIFICATION_CATEGORIES = 64
_MAX_NOTIFICATION_OPTIONS = 8
_MAX_VOICES = 48


FEATURE_PATHS: dict[str, tuple[str, dict[Any, Any] | None]] = {
    "general.accent": ("chat_theme", None),
    "general.contrast": (
        "contrast_mode",
        {"system": "default", "standard": "medium", "high": "high"},
    ),
    "general.dictation": ("dictation_enabled", None),
    "general.smarter": ("model_picker_prefers_auto_for_instant_preset", None),
    "personalization.quickAnswers": ("instant_answers_enabled", None),
    "personalization.suggestions": ("connector_search_enabled", None),
    "personalization.memory": ("sunshine", None),
    "personalization.recordHistory": ("record_feature_enabled", None),
    "personalization.pet": ("accessory_id", None),
    "voice.name": ("voice_name", None),
    "voice.model": ("voice_mode", {"live": "advanced", "standard": "standard"}),
    "voice.intelligence": ("wingman_thinking_effort", None),
    "voice.language": ("voice_main_language", None),
    "data.improveModel": ("training_allowed", None),
    "data.preciseLocation": ("precise_location_allowed", None),
    "data.workNetworkAccess": ("enable_flora_network_access", None),
    "security.lockdownMode": ("lockdown_mode_enabled", None),
    "security.developerMode": ("developer_mode", None),
    "security.enforceCsp": ("connector_enforce_csp_in_dev_mode", None),
    "security.deviceCodeAuth": ("enable_device_code_auth", None),
}

SYSTEM_MESSAGE_PATHS = {
    "personalization.personaStyle": "personality_type_selection",
    "personalization.customInstructions": "about_model_message",
    "personalization.nickname": "name_user_message",
    "personalization.occupation": "role_user_message",
    "personalization.details": "about_user_message",
}

LOCAL_PATHS = {
    "general.theme",
    "general.language",
    *(f"analytics.{key}" for key in ("historyRange", "historyMode", "productRange", "toolsRange")),
    *(f"shortcuts.enabled.{key}" for key in (
        "send", "background", "model", "dictation", "upload", "new-chat", "show-shortcuts",
        "search", "developer", "sidebar", "instructions", "copy-code", "delete-chat",
    )),
    *(f"shortcuts.keys.{key}" for key in (
        "send", "background", "model", "dictation", "upload", "new-chat", "show-shortcuts",
        "search", "developer", "sidebar", "instructions", "copy-code", "delete-chat",
    )),
}

FLOW_PATHS = {
    "usage.autoRecharge": "Payment setup is required for auto recharge.",
    "safety.reducedSensitiveContent": "This account does not expose a direct setting endpoint.",
    "security.authenticatorApp": "Authenticator changes require an interactive MFA flow.",
    "security.textMessage": "Text-message MFA changes require an interactive MFA flow.",
}


@dataclass(frozen=True)
class UpstreamSettingsSnapshot:
    settings: dict[str, Any]
    capabilities: dict[str, dict[str, Any]]
    options: dict[str, list[dict[str, Any]]]
    warnings: list[dict[str, str]]


_ACCOUNT_LOCKS: dict[str, threading.RLock] = {}
_ACCOUNT_LOCKS_GUARD = threading.Lock()


def _account_lock(entry: LocalAuthEntry) -> threading.RLock:
    identity = f"{entry.account.id}:{entry.account.user_id}"
    with _ACCOUNT_LOCKS_GUARD:
        return _ACCOUNT_LOCKS.setdefault(identity, threading.RLock())


def _request_json(
    entry: LocalAuthEntry,
    path: str,
    *,
    stage: str,
    method: str = "GET",
    query: Mapping[str, Any] | None = None,
    json_body: Mapping[str, Any] | None = None,
    bypass_server_cache: bool = False,
) -> dict[str, Any]:
    if not path.startswith("/") or ".." in path:
        raise RuntimeError("unsafe upstream settings path")
    query_string = urlencode(
        [(key, str(value)) for key, value in (query or {}).items() if value is not None]
    )
    url = f"{BACKEND_ORIGIN}{path}" + (f"?{query_string}" if query_string else "")

    method_upper = method.upper()
    network_attempts = (
        AUTH_UPSTREAM_NETWORK_ATTEMPTS if method_upper in {"GET", "HEAD"} else 1
    )
    for attempt in range(2):
        credential = ensure_fresh_credential(entry)
        headers = _credential_headers(credential)
        if bypass_server_cache:
            headers["Oai-Ep-Cache-Bypass"] = "true"
        if json_body is not None:
            headers["Content-Type"] = "application/json"
        http = _new_http_session()
        try:
            response: Any | None = None
            last_network_error: Exception | None = None
            for network_attempt in range(network_attempts):
                try:
                    response = http.request(
                        method,
                        url,
                        headers=headers,
                        json=dict(json_body) if json_body is not None else None,
                        timeout=AUTH_UPSTREAM_TIMEOUT_SECONDS,
                        allow_redirects=False,
                        verify=AUTH_VERIFY_TLS,
                    )
                    last_network_error = None
                    break
                except Exception as error:
                    last_network_error = error
                    if network_attempt + 1 < network_attempts:
                        LOGGER.info(
                            "Transient settings upstream network failure at %s (%s) "
                            "(attempt %s/%s)",
                            stage,
                            type(error).__name__,
                            network_attempt + 1,
                            network_attempts,
                        )
                        time.sleep(min(0.2 * (2**network_attempt), 0.8))
            if last_network_error is not None or response is None:
                error_name = (
                    type(last_network_error).__name__
                    if last_network_error is not None
                    else "NoResponse"
                )
                LOGGER.info(
                    "Settings upstream network failure at %s after %s attempt(s) (%s)",
                    stage,
                    network_attempts,
                    error_name,
                )
                raise AuthSessionError(
                    "settings_upstream_unavailable",
                    "The ChatGPT settings service is temporarily unavailable.",
                    status_code=503,
                ) from last_network_error
        finally:
            try:
                http.close()
            except Exception:
                pass

        status = int(response.status_code)
        if status == 401 and attempt == 0 and credential.cookie_header:
            refresh_local_auth_entry(entry)
            continue
        if status == 401:
            raise AuthSessionError(
                "invalid_session", "Session expired. Please sign in again.", status_code=401
            )
        if status == 403:
            raise AuthSessionError(
                "setting_forbidden",
                "This setting is locked or unavailable for the current account.",
                status_code=403,
            )
        if status in {400, 422}:
            raise AuthSessionError(
                "setting_value_rejected",
                "ChatGPT rejected this setting value.",
                status_code=400,
            )
        if status == 404:
            raise AuthSessionError(
                "setting_unavailable",
                "This setting is not available for the current account.",
                status_code=404,
            )
        if status in {409, 412}:
            raise AuthSessionError(
                "setting_conflict",
                "The upstream setting changed. Reload and try again.",
                status_code=409,
            )
        if status == 429:
            raise AuthSessionError(
                "settings_rate_limited",
                "Too many settings changes. Please try again shortly.",
                status_code=429,
            )
        if status < 200 or status >= 300:
            LOGGER.info("Settings upstream returned HTTP %s at %s", status, stage)
            raise AuthSessionError(
                "settings_upstream_error",
                "ChatGPT could not save this setting right now.",
                status_code=502,
            )
        if status == 204 or not response.content:
            return {}
        try:
            payload = response.json()
        except Exception as error:
            raise AuthSessionError(
                "settings_invalid_response",
                "ChatGPT returned an invalid settings response.",
                status_code=502,
            ) from error
        if not isinstance(payload, dict):
            raise AuthSessionError(
                "settings_invalid_response",
                "ChatGPT returned an invalid settings response.",
                status_code=502,
            )
        if method_upper != "GET" and payload.get("success") is False:
            raise AuthSessionError(
                "setting_write_rejected",
                "ChatGPT reported that the setting was not saved.",
                status_code=502,
            )
        return payload
    raise AssertionError("unreachable")


def _get_path(target: Mapping[str, Any], dotted_path: str) -> Any:
    value: Any = target
    for part in dotted_path.split("."):
        if not isinstance(value, Mapping) or part not in value:
            return None
        value = value[part]
    return value


def _set_path(target: dict[str, Any], dotted_path: str, value: Any) -> None:
    parts = dotted_path.split(".")
    cursor = target
    for part in parts[:-1]:
        nested = cursor.get(part)
        if not isinstance(nested, dict):
            nested = {}
            cursor[part] = nested
        cursor = nested
    cursor[parts[-1]] = copy.deepcopy(value)


def flatten_patch(changes: Mapping[str, Any], prefix: str = "") -> dict[str, Any]:
    flattened: dict[str, Any] = {}
    for key, value in changes.items():
        path = f"{prefix}.{key}" if prefix else key
        if isinstance(value, Mapping):
            flattened.update(flatten_patch(value, path))
        else:
            flattened[path] = value
    return flattened


def nested_patch(flattened: Mapping[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for path, value in flattened.items():
        _set_path(result, path, value)
    return result


def _safe_display_text(value: Any, maximum: int) -> str:
    """Return bounded display text without forwarding control characters."""

    if not isinstance(value, str):
        return ""
    cleaned = " ".join(
        "".join(character if ord(character) >= 0x20 and ord(character) != 0x7F else " " for character in value)
        .split()
    )
    return cleaned[:maximum]


def _safe_option_name(value: Any) -> str | None:
    """Keep the opaque option name needed by the upstream PATCH contract."""

    if not isinstance(value, str) or not value or len(value) > 128:
        return None
    if any(ord(character) < 0x20 or ord(character) == 0x7F for character in value):
        return None
    return value


def _sanitize_notification_settings(
    payload: Mapping[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    """Reduce the notification response to renderable fields and safe write metadata."""

    public_rows: list[dict[str, Any]] = []
    write_rows: dict[str, list[dict[str, Any]]] = {}
    rows = payload.get("settings")
    if not isinstance(rows, list):
        return public_rows, write_rows

    for raw_row in rows[:_MAX_NOTIFICATION_CATEGORIES]:
        if not isinstance(raw_row, Mapping):
            continue
        category = raw_row.get("category")
        if (
            not isinstance(category, str)
            or _DYNAMIC_ID.fullmatch(category) is None
            or category in _RESERVED_DYNAMIC_IDS
        ):
            continue
        if category in write_rows:
            continue

        safe_options: list[dict[str, Any]] = []
        seen_channels: set[str] = set()
        raw_options = raw_row.get("options")
        if isinstance(raw_options, list):
            for raw_option in raw_options[:_MAX_NOTIFICATION_OPTIONS]:
                if not isinstance(raw_option, Mapping):
                    continue
                channel = raw_option.get("channel")
                if not isinstance(channel, str):
                    continue
                channel = channel.lower()
                option_name = _safe_option_name(raw_option.get("name"))
                enabled = raw_option.get("enabled")
                if (
                    channel not in _NOTIFICATION_CHANNELS
                    or channel in seen_channels
                    or option_name is None
                    or not isinstance(enabled, bool)
                ):
                    continue
                seen_channels.add(channel)
                safe_options.append(
                    {"name": option_name, "channel": channel, "enabled": enabled}
                )

        if not safe_options:
            continue
        write_rows[category] = safe_options
        public_rows.append(
            {
                "id": category,
                "label": _safe_display_text(raw_row.get("name"), 120) or category,
                "description": _safe_display_text(raw_row.get("description"), 500),
                "channels": [option["channel"] for option in safe_options],
            }
        )
    return public_rows, write_rows


def _voice_query(settings: Mapping[str, Any]) -> dict[str, str]:
    language = _get_path(settings, "voice.language")
    mode = _get_path(settings, "voice.model")
    query: dict[str, str] = {}
    if isinstance(language, str) and language and language != "auto":
        query["spoken_language"] = language
    if isinstance(mode, str) and mode:
        query["voice_mode"] = {"live": "advanced", "standard": "standard"}.get(mode, mode)
    return query


def _sanitize_voices(payload: Mapping[str, Any]) -> tuple[str | None, list[dict[str, str]]]:
    public_voices: list[dict[str, str]] = []
    seen: set[str] = set()
    voices = payload.get("voices")
    if isinstance(voices, list):
        for raw_voice in voices[:_MAX_VOICES]:
            if not isinstance(raw_voice, Mapping):
                continue
            voice_id = raw_voice.get("voice")
            if (
                not isinstance(voice_id, str)
                or _VOICE_ID.fullmatch(voice_id) is None
                or voice_id in seen
            ):
                continue
            seen.add(voice_id)
            public_voices.append(
                {
                    "id": voice_id,
                    "label": _safe_display_text(raw_voice.get("name"), 120) or voice_id,
                    "description": _safe_display_text(raw_voice.get("description"), 500),
                }
            )
    selected = payload.get("selected")
    if not isinstance(selected, str) or selected not in seen:
        selected = None
    return selected, public_voices


def validate_bridge_settings_patch(changes: Any) -> dict[str, Any]:
    """Validate the static schema while allowing a catalog-verified voice id."""

    if not isinstance(changes, Mapping) or not changes:
        return validate_settings_patch(changes)
    candidate = copy.deepcopy(dict(changes))
    voice_name: str | None = None
    voice_intelligence: str | None = None
    pet: str | None = None
    accent: str | None = None
    general = candidate.get("general")
    if isinstance(general, Mapping) and "accent" in general:
        raw_accent = general.get("accent")
        if not isinstance(raw_accent, str) or raw_accent not in _ACCENT_VALUES:
            raise AccountSettingsError(
                "settings_value_invalid", "Invalid value for general.accent."
            )
        accent = raw_accent
        remaining_general = dict(general)
        remaining_general.pop("accent", None)
        if remaining_general:
            candidate["general"] = remaining_general
        else:
            candidate.pop("general", None)

    personalization = candidate.get("personalization")
    if isinstance(personalization, Mapping) and "pet" in personalization:
        raw_pet = personalization.get("pet")
        if not isinstance(raw_pet, str) or raw_pet not in _PET_VALUES:
            raise AccountSettingsError(
                "settings_value_invalid", "Invalid value for personalization.pet."
            )
        pet = raw_pet
        remaining_personalization = dict(personalization)
        remaining_personalization.pop("pet", None)
        if remaining_personalization:
            candidate["personalization"] = remaining_personalization
        else:
            candidate.pop("personalization", None)

    voice = candidate.get("voice")
    if isinstance(voice, Mapping):
        remaining_voice = dict(voice)
        if "name" in voice:
            raw_name = voice.get("name")
            if not isinstance(raw_name, str) or _VOICE_ID.fullmatch(raw_name) is None:
                raise AccountSettingsError(
                    "settings_value_invalid", "Invalid value for voice.name."
                )
            voice_name = raw_name
            remaining_voice.pop("name", None)
        if "intelligence" in voice:
            raw_intelligence = voice.get("intelligence")
            if (
                not isinstance(raw_intelligence, str)
                or raw_intelligence not in _VOICE_INTELLIGENCE_VALUES
            ):
                raise AccountSettingsError(
                    "settings_value_invalid", "Invalid value for voice.intelligence."
                )
            voice_intelligence = raw_intelligence
            remaining_voice.pop("intelligence", None)
        if remaining_voice:
            candidate["voice"] = remaining_voice
        else:
            candidate.pop("voice", None)

    validated = validate_settings_patch(candidate) if candidate else {}
    if accent is not None:
        validated.setdefault("general", {})["accent"] = accent
    if pet is not None:
        validated.setdefault("personalization", {})["pet"] = pet
    if voice_name is not None or voice_intelligence is not None:
        voice_target = validated.setdefault("voice", {})
        if voice_name is not None:
            voice_target["name"] = voice_name
        if voice_intelligence is not None:
            voice_target["intelligence"] = voice_intelligence
    return validated


def _capabilities(
    available_features: set[str],
    *,
    notification_categories: set[str],
    notifications_available: bool,
    voices_available: bool,
    context_available: bool,
    browser_available: bool,
    creator_profile_available: bool,
) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for path in LOCAL_PATHS:
        result[path] = {"source": "replica", "writable": True}
    for path, (feature, _) in FEATURE_PATHS.items():
        result[path] = {
            "source": "chatgpt",
            "writable": feature in available_features,
            **({} if feature in available_features else {"reason": "feature_unavailable"}),
        }
    result["general.language"] = {"source": "chatgpt", "writable": True}
    for path in SYSTEM_MESSAGE_PATHS:
        result[path] = {"source": "chatgpt", "writable": context_available}
    result["personalization.traits"] = {"source": "chatgpt", "writable": context_available}
    result["notifications"] = {
        "source": "chatgpt",
        "writable": notifications_available,
        **({} if notifications_available else {"reason": "catalog_unavailable"}),
    }
    for key in notification_categories:
        result[f"notifications.{key}"] = {
            "source": "chatgpt",
            "writable": True,
        }
    result["voice.name"] = {
        "source": "chatgpt",
        "writable": "voice_name" in available_features and voices_available,
        **(
            {}
            if "voice_name" in available_features and voices_available
            else {"reason": "catalog_unavailable" if not voices_available else "feature_unavailable"}
        ),
    }
    result["cloudBrowser.defaultPermission"] = {
        "source": "chatgpt",
        "writable": browser_available,
    }
    result["account.showBuilderName"] = {
        "source": "chatgpt",
        "writable": creator_profile_available,
        **({} if creator_profile_available else {"reason": "profile_unavailable"}),
    }
    for path, reason in FLOW_PATHS.items():
        result[path] = {"source": "flow", "writable": False, "reason": reason}
    return result


def _decode_feature_value(path: str, raw: Any, mapping: dict[Any, Any] | None) -> Any:
    if mapping is None:
        return raw
    reverse = {value: key for key, value in mapping.items()}
    return reverse.get(raw)


def _notification_value(options: Any) -> str | None:
    if not isinstance(options, list):
        return None
    channels: dict[str, bool] = {}
    for option in options:
        if not isinstance(option, Mapping):
            continue
        channel = option.get("channel")
        enabled = option.get("enabled")
        if isinstance(channel, str) and isinstance(enabled, bool):
            channels[channel.lower()] = enabled
    push = channels.get("push", False)
    email = channels.get("email", False)
    if push and email:
        return "both"
    if push:
        return "push"
    if email:
        return "email"
    if channels:
        return "off"
    return None


def fetch_upstream_settings(entry: LocalAuthEntry, base: Mapping[str, Any]) -> UpstreamSettingsSnapshot:
    settings = copy.deepcopy(dict(base))
    warnings: list[dict[str, str]] = []
    notification_options: list[dict[str, Any]] = []
    voice_options: list[dict[str, str]] = []
    with _account_lock(entry), entry.lock:
        user_payload = _request_json(entry, "/settings/user", stage="settings_user")
        upstream_settings = user_payload.get("settings")
        if not isinstance(upstream_settings, Mapping):
            upstream_settings = {}
        available_features = set(str(key) for key in upstream_settings)
        context_available = True
        browser_available = True
        creator_profile_available = True
        notification_categories: set[str] = set()
        for path, (feature, mapping) in FEATURE_PATHS.items():
            if feature not in upstream_settings:
                continue
            value = _decode_feature_value(path, upstream_settings.get(feature), mapping)
            expected = _get_path(base, path)
            if value is not None and isinstance(value, type(expected)):
                _set_path(settings, path, value)

        try:
            context = _request_json(entry, "/user_system_messages", stage="settings_context")
            for path, field in SYSTEM_MESSAGE_PATHS.items():
                value = context.get(field)
                expected = _get_path(base, path)
                if value is not None and isinstance(value, type(expected)):
                    _set_path(settings, path, value)
            traits = context.get("personality_traits")
            if isinstance(traits, Mapping):
                for key in ("warmth", "enthusiasm", "headings", "emoji"):
                    value = traits.get(key)
                    if value in {"default", "more", "less"}:
                        _set_path(settings, f"personalization.traits.{key}", value)
        except AuthSessionError as error:
            if error.status_code == 401:
                raise
            warnings.append({"source": "personalization", "code": error.code})
            context_available = False

        try:
            notification_payload = _request_json(entry, "/notifications/settings", stage="settings_notifications")
            notification_options, notification_write_rows = _sanitize_notification_settings(
                notification_payload
            )
            notification_categories.update(notification_write_rows)
            for category, row_options in notification_write_rows.items():
                value = _notification_value(row_options)
                if value is not None:
                    _set_path(settings, f"notifications.{category}", value)
        except AuthSessionError as error:
            if error.status_code == 401:
                raise
            warnings.append({"source": "notifications", "code": error.code})

        try:
            voice_payload = _request_json(
                entry,
                "/settings/voices",
                stage="settings_voices",
                query=_voice_query(settings),
            )
            selected_voice, voice_options = _sanitize_voices(voice_payload)
            if selected_voice is not None:
                _set_path(settings, "voice.name", selected_voice)
        except AuthSessionError as error:
            if error.status_code == 401:
                raise
            warnings.append({"source": "voices", "code": error.code})

        try:
            creator_profile = _request_json(
                entry, "/gizmo_creator_profile", stage="settings_creator_profile"
            )
            hide_name = creator_profile.get("hide_name")
            if isinstance(hide_name, bool):
                _set_path(settings, "account.showBuilderName", not hide_name)
            else:
                creator_profile_available = False
        except AuthSessionError as error:
            if error.status_code == 401:
                raise
            warnings.append({"source": "creatorProfile", "code": error.code})
            creator_profile_available = False

        try:
            browser = _request_json(entry, "/flora/browser/config", stage="settings_browser")
            approval_mode = browser.get("approval_mode")
            disable_auto_review = browser.get("disable_auto_review")
            permission = None
            if approval_mode == "never_ask" and disable_auto_review is True:
                permission = "allow"
            elif approval_mode == "always_ask" and disable_auto_review is False:
                permission = "auto"
            elif approval_mode == "always_ask" and disable_auto_review is True:
                permission = "ask"
            if permission:
                _set_path(settings, "cloudBrowser.defaultPermission", permission)
        except AuthSessionError as error:
            if error.status_code == 401:
                raise
            warnings.append({"source": "cloudBrowser", "code": error.code})
            browser_available = False

    return UpstreamSettingsSnapshot(
        settings=settings,
        capabilities=_capabilities(
            available_features,
            notification_categories=notification_categories,
            notifications_available=bool(notification_options),
            voices_available=bool(voice_options),
            context_available=context_available,
            browser_available=browser_available,
            creator_profile_available=creator_profile_available,
        ),
        options={
            "notifications": notification_options,
            "voices": voice_options,
        },
        warnings=warnings,
    )


def apply_upstream_settings(entry: LocalAuthEntry, changes: Mapping[str, Any]) -> dict[str, Any]:
    flattened = flatten_patch(changes)
    unsupported = sorted(
        path for path in flattened
        if path not in LOCAL_PATHS
        and path not in FEATURE_PATHS
        and path not in SYSTEM_MESSAGE_PATHS
        and not path.startswith("personalization.traits.")
        and not path.startswith("notifications.")
        and path != "cloudBrowser.defaultPermission"
        and path != "account.showBuilderName"
    )
    if unsupported:
        path = unsupported[0]
        reason = FLOW_PATHS.get(path, "This setting requires a dedicated interactive flow.")
        raise AuthSessionError("setting_requires_flow", reason, status_code=409)

    upstream_flat = {
        path: value
        for path, value in flattened.items()
        if path not in LOCAL_PATHS or path == "general.language"
    }
    if not upstream_flat:
        return nested_patch({path: value for path, value in flattened.items() if path in LOCAL_PATHS})

    with _account_lock(entry), entry.lock:
        feature_changes = {path: value for path, value in upstream_flat.items() if path in FEATURE_PATHS}
        if feature_changes:
            user_payload = _request_json(
                entry,
                "/settings/user",
                stage="settings_feature_check",
                bypass_server_cache=True,
            )
            available = user_payload.get("settings")
            available = available if isinstance(available, Mapping) else {}
            requested_voice = feature_changes.pop("voice.name", None)
            for path, value in feature_changes.items():
                feature, mapping = FEATURE_PATHS[path]
                if feature not in available:
                    raise AuthSessionError(
                        "setting_unavailable",
                        "This setting is not available for the current account.",
                        status_code=404,
                    )
                encoded = mapping.get(value) if mapping is not None else value
                serialized = encoded if isinstance(encoded, str) else (
                    str(encoded).lower() if isinstance(encoded, bool) else json.dumps(encoded, separators=(",", ":"))
                )
                _request_json(
                    entry,
                    "/settings/account_user_setting",
                    stage="settings_feature_write",
                    method="PATCH",
                    query={"feature": feature, "value": serialized},
                )

            if requested_voice is not None:
                if "voice_name" not in available:
                    raise AuthSessionError(
                        "setting_unavailable",
                        "Voice selection is not available for the current account.",
                        status_code=404,
                    )
                target_voice_settings = {
                    "voice": {
                        "language": upstream_flat.get(
                            "voice.language", available.get("voice_main_language", "auto")
                        ),
                        "model": upstream_flat.get(
                            "voice.model",
                            {"advanced": "live", "standard": "standard"}.get(
                                available.get("voice_mode"), "live"
                            ),
                        ),
                    }
                }
                voice_payload = _request_json(
                    entry,
                    "/settings/voices",
                    stage="settings_voice_check",
                    query=_voice_query(target_voice_settings),
                )
                _, available_voices = _sanitize_voices(voice_payload)
                if requested_voice not in {voice["id"] for voice in available_voices}:
                    raise AuthSessionError(
                        "setting_value_rejected",
                        "The selected voice is not available for this language and voice mode.",
                        status_code=400,
                    )
                _request_json(
                    entry,
                    "/settings/account_user_setting",
                    stage="settings_voice_write",
                    method="PATCH",
                    query={"feature": "voice_name", "value": requested_voice},
                )

        context_body: dict[str, Any] = {}
        for path, field in SYSTEM_MESSAGE_PATHS.items():
            if path in upstream_flat:
                context_body[field] = upstream_flat[path]
        trait_changes = {
            path.rsplit(".", 1)[-1]: value
            for path, value in upstream_flat.items()
            if path.startswith("personalization.traits.")
        }
        if trait_changes:
            current_context = _request_json(entry, "/user_system_messages", stage="settings_context_read")
            current_traits = current_context.get("personality_traits")
            current_traits = dict(current_traits) if isinstance(current_traits, Mapping) else {}
            current_traits.update(trait_changes)
            context_body["personality_traits"] = current_traits
        if context_body:
            current_context = _request_json(entry, "/user_system_messages", stage="settings_context_merge")
            safe_fields = {
                "about_user_message",
                "about_model_message",
                "name_user_message",
                "role_user_message",
                "traits_model_message",
                "other_user_message",
                "disabled_tools",
                "enabled",
                "personality_type_selection",
                "personality_traits",
                "conversation_id",
                "message_id",
            }
            merged_context = {
                key: value for key, value in current_context.items() if key in safe_fields
            }
            merged_context.update(context_body)
            merged_context["enabled"] = True
            _request_json(
                entry,
                "/user_system_messages",
                stage="settings_context_write",
                method="PATCH",
                json_body=merged_context,
            )

        notification_updates: dict[str, str] = {}
        for path, value in upstream_flat.items():
            if not path.startswith("notifications."):
                continue
            category = path.split(".", 1)[1]
            notification_updates[category] = value
        if notification_updates:
            notification_payload = _request_json(
                entry, "/notifications/settings", stage="settings_notifications_check"
            )
            _, current_notifications = _sanitize_notification_settings(notification_payload)
            for category, value in notification_updates.items():
                category_options = current_notifications.get(category)
                if not category_options:
                    raise AuthSessionError(
                        "setting_unavailable",
                        "This notification category is not available for the current account.",
                        status_code=404,
                    )
                supported = {option["channel"] for option in category_options}
                requested = (
                    {"push", "email"}
                    if value == "both"
                    else ({value} if value in _NOTIFICATION_CHANNELS else set())
                )
                if not requested.issubset(supported):
                    raise AuthSessionError(
                        "setting_value_rejected",
                        "The selected notification channel is unavailable for this category.",
                        status_code=400,
                    )
                for option in category_options:
                    enabled = option["channel"] in requested
                    if option["enabled"] is enabled:
                        continue
                    _request_json(
                        entry,
                        "/notifications/settings",
                        stage="settings_notifications_write",
                        method="PATCH",
                        json_body={
                            "updates": {
                                category: {
                                    "name": option["name"],
                                    "channel": option["channel"],
                                    "enabled": enabled,
                                }
                            }
                        },
                    )

        show_builder_name = upstream_flat.get("account.showBuilderName")
        if show_builder_name is not None:
            _request_json(
                entry,
                "/gizmo_creator_profile",
                stage="settings_creator_profile_write",
                method="POST",
                # The current web mutation is a partial update.  Forward only
                # the one field controlled here instead of replaying unrelated
                # profile data through the local bridge.
                json_body={"hide_name": not show_builder_name},
            )

        locale = upstream_flat.get("general.language")
        if locale is not None:
            _request_json(
                entry,
                "/accounts/users/locale",
                stage="settings_locale_write",
                method="PATCH",
                # The web client persists its "Automatic" option as JSON
                # null; the literal string "auto" is only the local UI value.
                json_body={"locale": None if locale == "auto" else locale},
            )

        permission = upstream_flat.get("cloudBrowser.defaultPermission")
        if permission is not None:
            browser_values = {
                "ask": {"approval_mode": "always_ask", "disable_auto_review": True},
                "allow": {"approval_mode": "never_ask", "disable_auto_review": True},
                "auto": {"approval_mode": "always_ask", "disable_auto_review": False},
            }
            _request_json(
                entry,
                "/flora/browser/config",
                stage="settings_browser_write",
                method="PATCH",
                json_body=browser_values[permission],
            )

    return nested_patch({path: value for path, value in flattened.items() if path in LOCAL_PATHS})
