from __future__ import annotations

import os

import uvicorn


def _port_from_env() -> int:
    raw = os.getenv("CHATGPT_BRIDGE_PORT", "8787").strip()
    try:
        port = int(raw)
    except ValueError as error:
        raise ValueError("CHATGPT_BRIDGE_PORT must be an integer.") from error
    if not 1 <= port <= 65_535:
        raise ValueError("CHATGPT_BRIDGE_PORT must be between 1 and 65535.")
    return port


def uvicorn_options() -> dict[str, object]:
    """Build the single-worker ASGI deployment boundary from environment."""

    trusted_proxy_ips = os.getenv(
        "CHATGPT_BRIDGE_TRUSTED_PROXY_IPS",
        os.getenv("FORWARDED_ALLOW_IPS", "127.0.0.1"),
    ).strip()
    if not trusted_proxy_ips:
        trusted_proxy_ips = "127.0.0.1"
    return {
        "app": "server.app:app",
        "host": os.getenv("CHATGPT_BRIDGE_HOST", "127.0.0.1").strip()
        or "127.0.0.1",
        "port": _port_from_env(),
        "reload": False,
        # Uvicorn applies X-Forwarded-For/Proto only when the immediate peer is
        # in forwarded_allow_ips. The default therefore trusts a local reverse
        # proxy but not arbitrary LAN/Internet clients.
        "proxy_headers": True,
        "forwarded_allow_ips": trusted_proxy_ips,
        # Authentication and conversation registries are deliberately
        # process-local. Keep one worker unless storage/stickiness is added.
        "workers": 1,
    }


def main() -> None:
    uvicorn.run(**uvicorn_options())


if __name__ == "__main__":
    main()
