"""Convert the temporary DevTools HAR into structure-only, secret-free evidence.

No header values, cookies, body values, query values, or URL identifiers are kept.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit


RAW = Path.home() / "Downloads" / "settings-network-raw.har"
OUT = Path(__file__).with_name("settings-network-sanitized.json")
REPORT = Path(__file__).with_name("settings-network-sanitized.md")

UUID_RE = re.compile(r"(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
LONG_ID_RE = re.compile(r"^[A-Za-z0-9_-]{24,}$")
EMAIL_RE = re.compile(r"@")


def redact_segment(segment: str) -> str:
    if UUID_RE.fullmatch(segment) or LONG_ID_RE.fullmatch(segment):
        return "{id}"
    return segment


def safe_url(raw: str) -> tuple[str, list[str]]:
    parts = urlsplit(raw)
    path = "/".join(redact_segment(piece) for piece in parts.path.split("/"))
    query_names = sorted({name for name, _ in parse_qsl(parts.query, keep_blank_values=True)})
    return f"{parts.scheme}://{parts.netloc}{path}", query_names


def safe_key(key: object) -> str:
    text = str(key)
    if EMAIL_RE.search(text) or UUID_RE.fullmatch(text) or LONG_ID_RE.fullmatch(text):
        return "{dynamic-key}"
    return text[:160]


def schema(value: object, depth: int = 0) -> object:
    if depth >= 7:
        return {"type": "truncated"}
    if value is None:
        return {"type": "null"}
    if isinstance(value, bool):
        return {"type": "boolean"}
    if isinstance(value, int):
        return {"type": "integer"}
    if isinstance(value, float):
        return {"type": "number"}
    if isinstance(value, str):
        return {"type": "string"}
    if isinstance(value, list):
        samples = value[:3]
        return {
            "type": "array",
            "items": [schema(item, depth + 1) for item in samples],
        }
    if isinstance(value, dict):
        pairs = list(value.items())[:120]
        return {
            "type": "object",
            "properties": {safe_key(key): schema(item, depth + 1) for key, item in pairs},
        }
    return {"type": type(value).__name__}


def body_schema(post_data: dict | None) -> object | None:
    if not post_data:
        return None
    if post_data.get("params"):
        return {
            "type": "form",
            "fields": sorted({safe_key(param.get("name", "")) for param in post_data["params"]}),
        }
    text = post_data.get("text")
    if not isinstance(text, str) or not text:
        return None
    try:
        return schema(json.loads(text))
    except Exception:
        return {"type": "opaque", "contentType": post_data.get("mimeType", "")}


def response_schema(content: dict) -> object | None:
    text = content.get("text")
    mime = str(content.get("mimeType", ""))
    if not isinstance(text, str) or not text:
        return None
    if "json" in mime:
        try:
            return schema(json.loads(text))
        except Exception:
            return {"type": "invalid-json"}
    return {"type": "opaque", "contentType": mime}


raw = json.loads(RAW.read_text(encoding="utf-8"))
entries: list[dict] = []
for item in raw.get("log", {}).get("entries", []):
    req = item.get("request", {})
    res = item.get("response", {})
    url = str(req.get("url", ""))
    parts = urlsplit(url)
    if parts.hostname not in {"chatgpt.com", "www.chatgpt.com"}:
        continue
    resource_type = str(item.get("_resourceType", ""))
    mime = str(res.get("content", {}).get("mimeType", ""))
    method = str(req.get("method", ""))
    # Keep API/fetch traffic; omit static images, fonts, styles and bundle bodies.
    if resource_type in {"Image", "Font", "Stylesheet", "Script"} and method == "GET":
        continue
    if "/assets/" in parts.path or "/cdn-cgi/" in parts.path:
        continue
    clean_url, query_names = safe_url(url)
    entries.append(
        {
            "method": method,
            "url": clean_url,
            "queryParameterNames": query_names,
            "status": int(res.get("status", 0) or 0),
            "resourceType": resource_type,
            "mimeType": mime,
            "requestHeaderNames": sorted({str(h.get("name", "")).lower() for h in req.get("headers", [])}),
            "responseHeaderNames": sorted({str(h.get("name", "")).lower() for h in res.get("headers", [])}),
            "requestBodySchema": body_schema(req.get("postData")),
            "responseBodySchema": response_schema(res.get("content", {})),
        }
    )

artifact = {
    "provenance": "Microsoft Edge DevTools > Network > Export HAR (sanitized)",
    "captureScope": "Authenticated ChatGPT settings navigation; values removed",
    "redaction": {
        "headerValues": "removed",
        "cookies": "removed",
        "queryValues": "removed",
        "requestAndResponseValues": "replaced by recursive type schema",
        "pathIdentifiers": "replaced with {id}",
    },
    "entryCount": len(entries),
    "entries": entries,
}
OUT.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")

counts = Counter((entry["method"], entry["url"], entry["status"]) for entry in entries)
lines = [
    "# Authenticated settings network evidence (sanitized)",
    "",
    "All cookie/header/body/query **values** were removed. Only methods, redacted URLs,",
    "status codes, non-secret header names, and value-free JSON field/type schemas remain.",
    "",
    f"Captured API/fetch entries: **{len(entries)}**",
    "",
    "| Count | Method | Status | URL |",
    "|---:|---|---:|---|",
]
for (method, url, status), count in sorted(counts.items(), key=lambda row: row[0][1]):
    lines.append(f"| {count} | {method} | {status} | `{url}` |")
REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")

print(f"sanitized {len(entries)} entries -> {OUT}")
