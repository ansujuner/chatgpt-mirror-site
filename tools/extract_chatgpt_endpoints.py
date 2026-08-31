#!/usr/bin/env python3
"""Build a credential-free inventory of routes declared by captured ChatGPT JS.

The extractor records only HTTP method, route template, and source location.  It
does not read request headers, cookies, or response bodies.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections.abc import Iterable
from pathlib import Path
from urllib.parse import urlsplit


SAFE_CALL = re.compile(
    r"\.safe(Get|Post|Put|Patch|Delete)\(\s*([`\"'])(/[^`\"']+)\2"
)

MANUAL_ROUTES = (
    ("GET", "/api/auth/session", ".runtime/4813494d-pretty.js", 7918),
    (
        "GET",
        "/api/auth/session?exchange_workspace_token=true&workspace_id={workspace_id}&reason={reason}",
        ".runtime/4813494d-pretty.js",
        8257,
    ),
    ("GET", "/api/debug-refresh-token", ".runtime/4813494d-pretty.js", 8293),
    ("POST", "/api/auth/handoff/inspect", ".runtime/4813494d-pretty.js", 10814),
    ("POST", "/api/auth/signin/{provider}", ".runtime/4813494d-pretty.js", 10852),
    ("POST", "/api/auth/handoff/bind", ".runtime/4813494d-pretty.js", 10887),
    ("POST", "/account-switch/switch", ".runtime/4813494d-pretty.js", 36974),
    (
        "PATCH",
        "/settings/user_last_used_model_config",
        ".runtime/4813494d-pretty.js",
        26451,
    ),
    (
        "PATCH",
        "/settings/user_tpp_last_used_model_config",
        ".runtime/4813494d-pretty.js",
        26451,
    ),
    ("POST", "/conversation", ".runtime/8b34-pretty.js", 26798),
    ("POST", "/f/conversation", ".runtime/8b34-pretty.js", 26799),
    ("POST", "/f/conversation/resume", ".runtime/8b34-pretty.js", 26624),
    ("POST", "/f/search", ".runtime/8b34-pretty.js", 26889),
    ("POST", "/f/steer_turn", ".runtime/8b34-pretty.js", 28123),
)

CATEGORIES = (
    (
        "auth_session",
        ("/api/auth", "/auth", "/account-switch", "/logout", "/login", "/sessions", "/security", "/mfa"),
    ),
    (
        "account_identity_admin",
        (
            "/accounts",
            "/me",
            "/compliance",
            "/trusted_contact",
            "/user_information",
            "/user_granular_consent",
            "/workspaces",
            "/workspace-resources",
            "/admin",
        ),
    ),
    (
        "conversation_message",
        (
            "/conversation",
            "/conversations",
            "/f/conversation",
            "/f/search",
            "/f/steer_turn",
            "/stop_conversation",
            "/share",
            "/textdoc",
            "/message",
            "/feedback",
            "/targeted_feedback",
            "/task_suggestions",
            "/templated_prompts",
            "/prompt_library",
        ),
    ),
    (
        "model_reasoning_config",
        (
            "/models",
            "/tpp/model",
            "/wham/models",
            "/wham/config/model-policy",
            "/settings/user_last_used_model_config",
            "/settings/user_tpp_last_used_model_config",
            "/settings/user_default_model_config",
            "/settings/user_tpp_default_model_config",
            "/system_hints",
            "/personality",
            "/placeholders/composer",
        ),
    ),
    (
        "files_upload_retrieval",
        (
            "/files",
            "/file",
            "/api/library",
            "/library",
            "/estuary",
            "/transcribe",
            "/dictation",
            "/lat/retrieval",
            "/retrieval",
            "/images",
            "/image",
            "/file_search",
            "/writing-blocks",
        ),
    ),
    ("integrity_safety", ("/sentinel", "/cyber", "/aardvark", "/quorum", "/safety")),
    (
        "tools_plugins_connectors",
        (
            "/aip",
            "/plugins",
            "/plugin",
            "/ps/plugins",
            "/gizmos",
            "/gizmo",
            "/projects",
            "/pins",
            "/wham",
            "/tasks",
            "/task/",
            "/connectors",
            "/v2/connectors",
            "/v2/links",
            "/v2/workspace",
            "/apps",
            "/app",
            "/flora",
            "/bazaar",
            "/pro_mode",
            "/websites",
            "/sites",
            "/widget",
        ),
    ),
    ("realtime_voice_group", ("/realtime", "/celsius", "/calpico", "/voice", "/synthesize")),
    (
        "settings_memory_notifications_billing",
        (
            "/settings",
            "/memories",
            "/memory",
            "/notifications",
            "/subscriptions",
            "/payments",
            "/billing",
            "/checkout",
            "/gift",
            "/pageConfigs",
            "/amphora",
            "/user_system_messages",
            "/user_segments",
            "/user_surveys",
        ),
    ),
)


def category(path: str) -> str:
    for name, prefixes in CATEGORIES:
        if path.startswith(prefixes):
            return name
    return "other"


def js_files(directories: Iterable[Path]) -> Iterable[Path]:
    for directory in directories:
        if directory.is_dir():
            yield from directory.glob("*.js")


def add_ref(record: dict, file: str, line: int | None, column: int | None) -> None:
    ref = {"file": file, "line": line, "column": column}
    if ref not in record["refs"]:
        record["refs"].append(ref)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--json", type=Path)
    parser.add_argument("--csv", type=Path)
    args = parser.parse_args()

    root = args.root.resolve()
    output_json = args.json or root / "artifacts/chatgpt-full-endpoint-catalog-2026-08-31.json"
    output_csv = args.csv or root / "artifacts/chatgpt-full-endpoint-catalog-2026-08-31.csv"
    asset_dirs = (
        root / "qa/auth-capture/network/bodies",
        root / "reference-captures/free-account-2026-08-31/frontend-assets/cdn/assets",
    )

    routes: dict[tuple[str, str], dict] = {}
    for path in js_files(asset_dirs):
        try:
            source = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        relative = path.relative_to(root).as_posix()
        for match in SAFE_CALL.finditer(source):
            method, route = match.group(1).upper(), match.group(3)
            record = routes.setdefault(
                (method, route),
                {"method": method, "path": route, "refs": [], "declared_in_asset": True},
            )
            line = source.count("\n", 0, match.start()) + 1
            column = match.start() - source.rfind("\n", 0, match.start())
            add_ref(record, relative, line, column)

    for method, route, file, line in MANUAL_ROUTES:
        record = routes.setdefault(
            (method, route),
            {"method": method, "path": route, "refs": [], "declared_in_asset": True},
        )
        add_ref(record, file, line, None)

    requests_path = root / "qa/auth-capture/network/requests.json"
    observed: dict[tuple[str, str], dict] = {}
    if requests_path.is_file():
        requests = json.loads(requests_path.read_text(encoding="utf-8"))["requests"]
        for request in requests:
            parsed = urlsplit(request["url"])
            route = parsed.path
            if parsed.hostname != "chatgpt.com" or route == "/":
                continue
            if route.startswith(("/cdn/", "/ces/", "/cdn-cgi/", "/favicon")):
                continue
            if not route.startswith(("/api/", "/backend-api/", "/account-switch/", "/realtime/", "/auth/")):
                continue
            relative = route.removeprefix("/backend-api") if route.startswith("/backend-api/") else route
            key = request["method"], relative
            entry = observed.setdefault(key, {"statuses": set(), "count": 0, "paths": set()})
            entry["statuses"].add(request.get("status"))
            entry["count"] += 1
            entry["paths"].add(route)
            if key not in routes:
                routes[key] = {
                    "method": request["method"],
                    "path": relative,
                    "refs": [{"file": requests_path.relative_to(root).as_posix(), "line": None, "column": None}],
                    "declared_in_asset": False,
                }

    records = []
    for key, record in routes.items():
        capture = observed.get(key)
        record["category"] = category(record["path"])
        record["observed"] = capture is not None
        record["observed_statuses"] = (
            sorted(capture["statuses"], key=lambda item: (item is None, item)) if capture else []
        )
        record["observed_count"] = capture["count"] if capture else 0
        record["observed_paths"] = sorted(capture["paths"]) if capture else []
        records.append(record)
    records.sort(key=lambda row: (row["category"], row["path"], row["method"]))

    payload = {
        "snapshot_date": "2026-08-31",
        "scope": (
            "Method/path literals passed to the frontend safe HTTP client in captured JS, "
            "plus manually confirmed direct-fetch/streaming routes and observed API requests. "
            "Undocumented and deployment-specific."
        ),
        "route_count": len(records),
        "asset_declared_count": sum(row["declared_in_asset"] for row in records),
        "observed_count": sum(row["observed"] for row in records),
        "records": records,
    }
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    output_csv.parent.mkdir(parents=True, exist_ok=True)
    with output_csv.open("w", encoding="utf-8-sig", newline="") as handle:
        fields = (
            "category",
            "method",
            "path",
            "declared_in_asset",
            "observed",
            "observed_statuses",
            "observed_count",
            "first_source",
            "source_count",
        )
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in records:
            ref = row["refs"][0] if row["refs"] else {}
            first_source = f"{ref.get('file', '')}:{ref.get('line', '')}"
            if ref.get("column"):
                first_source += f":{ref['column']}"
            writer.writerow(
                {
                    "category": row["category"],
                    "method": row["method"],
                    "path": row["path"],
                    "declared_in_asset": row["declared_in_asset"],
                    "observed": row["observed"],
                    "observed_statuses": ",".join(map(str, row["observed_statuses"])),
                    "observed_count": row["observed_count"],
                    "first_source": first_source,
                    "source_count": len(row["refs"]),
                }
            )

    print(
        json.dumps(
            {
                "json": str(output_json),
                "csv": str(output_csv),
                "route_count": payload["route_count"],
                "asset_declared_count": payload["asset_declared_count"],
                "observed_count": payload["observed_count"],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
