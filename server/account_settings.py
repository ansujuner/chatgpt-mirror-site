from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import sqlite3
import threading
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping


SHORTCUT_DEFAULTS: dict[str, list[str]] = {
    "send": ["⏎"],
    "background": ["Ctrl", "⏎"],
    "model": ["Ctrl", "Shift", "M"],
    "dictation": ["Ctrl", "Shift", "D"],
    "upload": ["Ctrl", "U"],
    "new-chat": ["Ctrl", "Shift", "O"],
    "show-shortcuts": ["Ctrl", "/"],
    "search": ["Ctrl", "K"],
    "developer": ["Ctrl", "."],
    "sidebar": ["Ctrl", "Shift", "S"],
    "instructions": ["Ctrl", "Shift", "I"],
    "copy-code": ["Ctrl", "Shift", ";"],
    "delete-chat": ["Ctrl", "Shift", "⌫"],
}


DEFAULT_ACCOUNT_SETTINGS: dict[str, Any] = {
    "general": {
        "theme": "system",
        "contrast": "system",
        "accent": "default",
        "language": "auto",
        "smarter": True,
        "dictation": True,
    },
    "notifications": {
        "codex": "push",
        "personalization": "both",
        "tasks": "push",
        "usage": "both",
        "health": "push",
        "replies": "push",
        "group": "push",
        "marketing": "push",
        "projects": "email",
    },
    "personalization": {
        "personaStyle": "default",
        "traits": {
            "warmth": "default",
            "enthusiasm": "default",
            "headings": "default",
            "emoji": "default",
        },
        "quickAnswers": True,
        "suggestions": True,
        "customInstructions": "",
        "nickname": "",
        "occupation": "",
        "details": "",
        "memory": True,
        "recordHistory": True,
        "pet": "default",
    },
    "voice": {
        "name": "cove",
        "model": "live",
        "intelligence": "high",
        "language": "auto",
    },
    "usage": {"autoRecharge": False},
    "analytics": {
        "historyRange": "7",
        "historyMode": "product",
        "productRange": "7",
        "toolsRange": "7",
    },
    "data": {
        "improveModel": True,
        "preciseLocation": False,
        "workNetworkAccess": True,
    },
    "cloudBrowser": {"defaultPermission": "ask"},
    "safety": {"reducedSensitiveContent": False},
    "security": {
        "authenticatorApp": True,
        "textMessage": False,
        "lockdownMode": False,
        "developerMode": False,
        "enforceCsp": False,
        "deviceCodeAuth": True,
    },
    "account": {"showBuilderName": True},
    "shortcuts": {
        "enabled": {shortcut_id: True for shortcut_id in SHORTCUT_DEFAULTS},
        "keys": copy.deepcopy(SHORTCUT_DEFAULTS),
    },
}


class AccountSettingsError(RuntimeError):
    def __init__(self, code: str, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True)
class AccountSettingsSnapshot:
    settings: dict[str, Any]
    revision: int
    updated_at: str


def _enum(*values: str) -> Callable[[Any], Any]:
    allowed = set(values)

    def validate(value: Any) -> str:
        if not isinstance(value, str) or value not in allowed:
            raise ValueError(f"must be one of: {', '.join(values)}")
        return value

    return validate


def _boolean(value: Any) -> bool:
    if not isinstance(value, bool):
        raise ValueError("must be a boolean")
    return value


def _text(maximum: int) -> Callable[[Any], Any]:
    def validate(value: Any) -> str:
        if not isinstance(value, str):
            raise ValueError("must be a string")
        if len(value) > maximum:
            raise ValueError(f"must contain at most {maximum} characters")
        return value

    return validate


_VALIDATORS: dict[str, Callable[[Any], Any]] = {
    "general.theme": _enum("system", "dark", "light"),
    "general.contrast": _enum("system", "standard", "high"),
    "general.accent": _enum("default", "black", "blue", "green", "purple"),
    "general.language": _enum("auto", "zh-CN", "zh-TW", "en", "ja", "ko"),
    "general.smarter": _boolean,
    "general.dictation": _boolean,
    **{
        f"notifications.{key}": _enum("push", "email", "both", "off")
        for key in DEFAULT_ACCOUNT_SETTINGS["notifications"]
    },
    "personalization.personaStyle": _enum(
        "default", "professional", "friendly", "candid", "quirky", "efficient", "cynical"
    ),
    **{
        f"personalization.traits.{key}": _enum("default", "more", "less")
        for key in DEFAULT_ACCOUNT_SETTINGS["personalization"]["traits"]
    },
    "personalization.quickAnswers": _boolean,
    "personalization.suggestions": _boolean,
    "personalization.customInstructions": _text(5_000),
    "personalization.nickname": _text(128),
    "personalization.occupation": _text(512),
    "personalization.details": _text(5_000),
    "personalization.memory": _boolean,
    "personalization.recordHistory": _boolean,
    "personalization.pet": _text(96),
    "voice.name": _enum(
        "maple", "spruce", "vale", "cove", "juniper", "ember", "sol", "breeze", "arbor"
    ),
    "voice.model": _enum("live", "standard"),
    "voice.intelligence": _enum("high", "standard"),
    "voice.language": _enum("auto", "zh-CN", "zh-TW", "en", "ja", "ko"),
    "usage.autoRecharge": _boolean,
    "analytics.historyRange": _enum("7", "30"),
    "analytics.historyMode": _enum("product", "model"),
    "analytics.productRange": _enum("7", "30"),
    "analytics.toolsRange": _enum("7", "30"),
    "data.improveModel": _boolean,
    "data.preciseLocation": _boolean,
    "data.workNetworkAccess": _boolean,
    "cloudBrowser.defaultPermission": _enum("ask", "allow", "auto"),
    "safety.reducedSensitiveContent": _boolean,
    "security.authenticatorApp": _boolean,
    "security.textMessage": _boolean,
    "security.lockdownMode": _boolean,
    "security.developerMode": _boolean,
    "security.enforceCsp": _boolean,
    "security.deviceCodeAuth": _boolean,
    "account.showBuilderName": _boolean,
    **{f"shortcuts.enabled.{key}": _boolean for key in SHORTCUT_DEFAULTS},
}


def _shortcut_keys(value: Any) -> list[str]:
    if not isinstance(value, list) or not 1 <= len(value) <= 5:
        raise ValueError("must be an array containing 1 to 5 keys")
    normalized: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item or len(item) > 24:
            raise ValueError("contains an invalid key")
        normalized.append(item)
    return normalized


for _shortcut_id in SHORTCUT_DEFAULTS:
    _VALIDATORS[f"shortcuts.keys.{_shortcut_id}"] = _shortcut_keys


def validate_settings_patch(changes: Any) -> dict[str, Any]:
    if not isinstance(changes, Mapping) or not changes:
        raise AccountSettingsError(
            "settings_patch_empty", "changes must be a non-empty object."
        )

    def walk(value: Any, template: Any, prefix: str) -> Any:
        if isinstance(template, Mapping):
            if not isinstance(value, Mapping) or not value:
                raise AccountSettingsError(
                    "settings_value_invalid", f"{prefix or 'changes'} must be a non-empty object."
                )
            if prefix == "notifications":
                normalized: dict[str, str] = {}
                validator = _enum("push", "email", "both", "off")
                for key, nested in value.items():
                    if not isinstance(key, str) or re.fullmatch(r"[a-z0-9_:-]{1,64}", key) is None:
                        raise AccountSettingsError(
                            "settings_key_unknown", "The notification category is invalid."
                        )
                    try:
                        normalized[key] = validator(nested)
                    except ValueError as error:
                        raise AccountSettingsError(
                            "settings_value_invalid",
                            f"Invalid value for notifications.{key}: {error}.",
                        ) from error
                return normalized
            unknown = sorted(set(value) - set(template))
            if unknown:
                path = f"{prefix}.{unknown[0]}" if prefix else unknown[0]
                raise AccountSettingsError(
                    "settings_key_unknown", f"Unknown settings key: {path}."
                )
            return {
                key: walk(nested, template[key], f"{prefix}.{key}" if prefix else key)
                for key, nested in value.items()
            }

        validator = _VALIDATORS.get(prefix)
        if validator is None:
            raise AccountSettingsError(
                "settings_key_unknown", f"Unknown settings key: {prefix}."
            )
        try:
            return validator(value)
        except ValueError as error:
            raise AccountSettingsError(
                "settings_value_invalid", f"Invalid value for {prefix}: {error}."
            ) from error

    return walk(changes, DEFAULT_ACCOUNT_SETTINGS, "")


def _merge_patch(
    target: dict[str, Any], changes: Mapping[str, Any], *, enforce_dependencies: bool = True
) -> dict[str, Any]:
    result = copy.deepcopy(target)
    for key, value in changes.items():
        if isinstance(value, Mapping) and isinstance(result.get(key), Mapping):
            result[key] = _merge_patch(
                dict(result[key]), value, enforce_dependencies=False
            )
        else:
            result[key] = copy.deepcopy(value)
    if enforce_dependencies and not result["security"]["developerMode"]:
        result["security"]["enforceCsp"] = False
    return result


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class AccountSettingsStore:
    """Durable per-account settings with optimistic revision checks."""

    def __init__(self, database_path: str | Path | None = None) -> None:
        configured = database_path or os.getenv("CHATGPT_REPLICA_SETTINGS_DB")
        self.database_path = Path(configured) if configured else (
            Path(__file__).resolve().parents[1] / ".runtime" / "account-settings.sqlite3"
        )
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=5)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with closing(self._connect()) as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS account_settings (
                    account_id TEXT PRIMARY KEY,
                    revision INTEGER NOT NULL,
                    settings_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.commit()

    @staticmethod
    def _decode_row(row: sqlite3.Row) -> AccountSettingsSnapshot:
        try:
            stored = json.loads(row["settings_json"])
        except (json.JSONDecodeError, TypeError):
            stored = {}
        # Forward-fill newly added settings while retaining existing values.
        merged = _merge_patch(DEFAULT_ACCOUNT_SETTINGS, stored if isinstance(stored, Mapping) else {})
        return AccountSettingsSnapshot(
            settings=merged,
            revision=int(row["revision"]),
            updated_at=str(row["updated_at"]),
        )

    @staticmethod
    def _account_key(account_id: str) -> str:
        return hashlib.sha256(f"replica-settings-v1:{account_id}".encode("utf-8")).hexdigest()

    def get(self, account_id: str) -> AccountSettingsSnapshot:
        if not account_id or len(account_id) > 512:
            raise AccountSettingsError("account_id_invalid", "The account id is invalid.")
        account_key = self._account_key(account_id)
        with self._lock, closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT revision, settings_json, updated_at FROM account_settings WHERE account_id = ?",
                (account_key,),
            ).fetchone()
            if row is not None:
                return self._decode_row(row)
            updated_at = _utc_now()
            settings = copy.deepcopy(DEFAULT_ACCOUNT_SETTINGS)
            connection.execute(
                "INSERT INTO account_settings(account_id, revision, settings_json, updated_at) VALUES (?, 0, ?, ?)",
                (account_key, json.dumps(settings, ensure_ascii=False, separators=(",", ":")), updated_at),
            )
            connection.commit()
            return AccountSettingsSnapshot(settings=settings, revision=0, updated_at=updated_at)

    def patch(
        self,
        account_id: str,
        changes: Any,
        *,
        expected_revision: int | None = None,
    ) -> AccountSettingsSnapshot:
        validated = validate_settings_patch(changes)
        if not account_id or len(account_id) > 512:
            raise AccountSettingsError("account_id_invalid", "The account id is invalid.")
        account_key = self._account_key(account_id)
        with self._lock, closing(self._connect()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT revision, settings_json, updated_at FROM account_settings WHERE account_id = ?",
                (account_key,),
            ).fetchone()
            if row is None:
                current = AccountSettingsSnapshot(copy.deepcopy(DEFAULT_ACCOUNT_SETTINGS), 0, _utc_now())
            else:
                current = self._decode_row(row)
            if expected_revision is not None and expected_revision != current.revision:
                connection.rollback()
                raise AccountSettingsError(
                    "settings_revision_conflict",
                    "Settings changed in another window. Reload the latest settings and try again.",
                    status_code=409,
                )
            settings = _merge_patch(current.settings, validated)
            if settings == current.settings:
                connection.rollback()
                return current
            revision = current.revision + 1
            updated_at = _utc_now()
            connection.execute(
                """
                INSERT INTO account_settings(account_id, revision, settings_json, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(account_id) DO UPDATE SET
                    revision = excluded.revision,
                    settings_json = excluded.settings_json,
                    updated_at = excluded.updated_at
                """,
                (
                    account_key,
                    revision,
                    json.dumps(settings, ensure_ascii=False, separators=(",", ":")),
                    updated_at,
                ),
            )
            connection.commit()
            return AccountSettingsSnapshot(settings=settings, revision=revision, updated_at=updated_at)
