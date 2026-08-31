from __future__ import annotations

import re
from typing import Any, Mapping

from .auth_session import AuthSessionError, LocalAuthEntry
from .upstream_settings import _request_json


_MODEL_SLUG = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,159}")
_THINKING_EFFORTS = {"min", "standard", "extended", "xhigh", "max"}


def validate_chat_model_preference(
    model_slug: Any, thinking_effort: Any = None
) -> tuple[str, str | None]:
    """Validate the small allowlisted payload accepted by the local bridge."""

    if not isinstance(model_slug, str) or _MODEL_SLUG.fullmatch(model_slug) is None:
        raise AuthSessionError(
            "model_preference_invalid",
            "The selected model is invalid.",
            status_code=400,
        )
    if thinking_effort is not None and thinking_effort not in _THINKING_EFFORTS:
        raise AuthSessionError(
            "model_preference_invalid",
            "The selected thinking effort is invalid.",
            status_code=400,
        )
    return model_slug, thinking_effort


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def read_chat_model_preference(entry: LocalAuthEntry) -> dict[str, str | None]:
    """Read ChatGPT Web's normal-chat last-used model configuration.

    This intentionally reads only the normal Chat surface.  TPP and Work have
    separate contracts and must not be silently mixed into the Chat picker.
    """

    payload = _request_json(
        entry,
        "/settings/user",
        stage="model_preference_read",
        # Match the official forced-refresh path so a local reload/recovery
        # observes the latest upstream write instead of an edge-cached value.
        bypass_server_cache=True,
    )
    settings = _mapping(payload.get("settings"))
    config = _mapping(settings.get("last_used_model_config"))
    slugs = _mapping(config.get("slugs"))
    model_slug = slugs.get("web") or slugs.get("default")
    if not isinstance(model_slug, str) or _MODEL_SLUG.fullmatch(model_slug) is None:
        return {"modelSlug": None, "thinkingEffort": None}

    juices = _mapping(config.get("juices"))
    web_juices = _mapping(juices.get("web"))
    default_juices = _mapping(juices.get("default"))
    effort = web_juices.get(model_slug, default_juices.get(model_slug))
    if effort not in _THINKING_EFFORTS:
        effort = None
    return {"modelSlug": model_slug, "thinkingEffort": effort}


def write_chat_model_preference(
    entry: LocalAuthEntry, model_slug: str, thinking_effort: str | None
) -> dict[str, str | None]:
    """Persist the active normal-chat model lane and effort upstream."""

    model_slug, thinking_effort = validate_chat_model_preference(
        model_slug, thinking_effort
    )
    # The production client passes `undefined` for a non-thinking lane. Its
    # query serializer omits that key entirely; sending an empty string is a
    # different value and is rejected by some endpoint versions.
    query: dict[str, str] = {"model_slug": model_slug}
    if thinking_effort is not None:
        query["thinking_effort"] = thinking_effort
    _request_json(
        entry,
        "/settings/user_last_used_model_config",
        stage="model_preference_write",
        method="PATCH",
        query=query,
    )
    return {"modelSlug": model_slug, "thinkingEffort": thinking_effort}
