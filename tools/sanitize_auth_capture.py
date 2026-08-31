"""Remove dynamic account/API values from qa/auth-capture, retaining schemas.

Static browser-delivered JS/CSS/HTML/SVG source files and all 17 tab
screenshots/DOM artifacts are retained.  Dynamic response bodies are converted
to field/type-only schemas and deleted.  The script is idempotent.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


ROOT = Path("qa/auth-capture").resolve()
BODY_ROOT = (ROOT / "network" / "bodies").resolve()

EMAIL_RE = re.compile(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b")
UUID_RE = re.compile(
    r"(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b"
)
BEARER_RE = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{12,}")
JWT_RE = re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b")
OPENAI_KEY_RE = re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b")
SECRET_VALUE_RE = re.compile(
    r'(?i)(["\'](?:access[_-]?token|refresh[_-]?token|session[_-]?token|auth[_-]?token|authorization|cookie|secret|csrf|api[_-]?key|password)["\']\s*[:=]\s*["\'])(.*?)(["\'])'
)

STATIC_MIME_MARKERS = ("javascript", "css", "html", "svg")


def assert_inside(path: Path, root: Path) -> Path:
    resolved = path.resolve()
    if root != resolved and root not in resolved.parents:
        raise RuntimeError(f"refusing operation outside {root}: {resolved}")
    return resolved


def redact_text(text: str) -> str:
    text = EMAIL_RE.sub("<redacted-email>", text)
    text = UUID_RE.sub("<redacted-uuid>", text)
    text = BEARER_RE.sub("Bearer <redacted>", text)
    text = JWT_RE.sub("<redacted-jwt>", text)
    text = OPENAI_KEY_RE.sub("<redacted-api-key>", text)
    text = SECRET_VALUE_RE.sub(r"\1<redacted>\3", text)
    return text


def redact_json(value: Any) -> Any:
    if isinstance(value, dict):
        return {redact_text(str(k)): redact_json(v) for k, v in value.items()}
    if isinstance(value, list):
        return [redact_json(v) for v in value]
    if isinstance(value, str):
        return redact_text(value)
    return value


def normalized_key(key: str) -> str:
    if EMAIL_RE.fullmatch(key):
        return "<email-key>"
    if UUID_RE.fullmatch(key):
        return "<uuid-key>"
    if re.fullmatch(r"\d{6,}", key):
        return "<numeric-id-key>"
    if re.fullmatch(r"[A-Za-z0-9_-]{32,}", key):
        return "<dynamic-id-key>"
    return redact_text(key)


def merge_schema(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    if a == b:
        return a
    ta, tb = a.get("type"), b.get("type")
    if ta != tb:
        variants = []
        for schema in (a, b):
            variants.extend(schema.get("anyOf", [schema]))
        unique = []
        seen = set()
        for schema in variants:
            marker = json.dumps(schema, sort_keys=True)
            if marker not in seen:
                seen.add(marker)
                unique.append(schema)
        return {"anyOf": unique}
    if ta == "object":
        properties = dict(a.get("properties", {}))
        for key, schema in b.get("properties", {}).items():
            properties[key] = (
                merge_schema(properties[key], schema) if key in properties else schema
            )
        return {"type": "object", "properties": properties}
    if ta == "array":
        return {
            "type": "array",
            "items": merge_schema(a.get("items", {}), b.get("items", {})),
        }
    if ta == "string":
        formats = sorted(set(a.get("formats", []) + b.get("formats", [])))
        return {"type": "string", **({"formats": formats} if formats else {})}
    return {"type": ta}


def string_format(value: str) -> str | None:
    if EMAIL_RE.fullmatch(value):
        return "email"
    if UUID_RE.fullmatch(value):
        return "uuid"
    if re.fullmatch(r"https?://.+", value):
        return "uri"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}T[^ ]+", value):
        return "date-time"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return "date"
    return None


def infer_schema(value: Any, depth: int = 0) -> dict[str, Any]:
    if depth > 30:
        return {"type": "unknown", "note": "depth-limit"}
    if value is None:
        return {"type": "null"}
    if isinstance(value, bool):
        return {"type": "boolean"}
    if isinstance(value, int):
        return {"type": "integer"}
    if isinstance(value, float):
        return {"type": "number"}
    if isinstance(value, str):
        fmt = string_format(value)
        return {"type": "string", **({"formats": [fmt]} if fmt else {})}
    if isinstance(value, list):
        if not value:
            return {"type": "array", "items": {"type": "unknown"}}
        schema = infer_schema(value[0], depth + 1)
        for item in value[1:100]:
            schema = merge_schema(schema, infer_schema(item, depth + 1))
        return {"type": "array", "items": schema}
    if isinstance(value, dict):
        properties: dict[str, Any] = {}
        for key, child in value.items():
            safe_key = normalized_key(str(key))
            child_schema = infer_schema(child, depth + 1)
            properties[safe_key] = (
                merge_schema(properties[safe_key], child_schema)
                if safe_key in properties
                else child_schema
            )
        return {"type": "object", "properties": properties}
    return {"type": type(value).__name__}


def normalize_url(url: str) -> str:
    try:
        parsed = urlsplit(redact_text(url))
        query = urlencode([(key, "<redacted>") for key, _ in parse_qsl(parsed.query)])
        path = re.sub(r"/(?:(?:[A-Za-z0-9_-]{24,})|(?:\d{8,}))(?=/|$)", "/{id}", parsed.path)
        return urlunsplit((parsed.scheme, parsed.netloc, path, query, ""))
    except Exception:
        return redact_text(url)


def is_static(entry: dict[str, Any]) -> bool:
    mime = str(entry.get("mimeType") or "").lower()
    return any(marker in mime for marker in STATIC_MIME_MARKERS)


def load_possible_json(path: Path) -> tuple[Any | None, str | None]:
    try:
        text = path.read_text("utf-8")
    except Exception as exc:
        return None, f"not-utf8: {type(exc).__name__}"
    try:
        return json.loads(text), None
    except Exception as exc:
        return None, f"not-json: {type(exc).__name__}"


def sanitize_dynamic_bodies() -> dict[str, Any]:
    manifest_path = ROOT / "network" / "body-manifest.json"
    manifest = json.loads(manifest_path.read_text("utf-8"))
    schemas = []
    deleted: set[Path] = set()
    schema_cache: dict[Path, dict[str, Any]] = {}
    for entry in manifest:
        file_ref = entry.get("file")
        if not file_ref or is_static(entry):
            if entry.get("url"):
                entry["url"] = redact_text(entry["url"])
            continue
        path = assert_inside(Path(file_ref), BODY_ROOT)
        record: dict[str, Any] = {
            "method": entry.get("method"),
            "status": entry.get("status"),
            "mimeType": entry.get("mimeType"),
            "urlPattern": normalize_url(str(entry.get("url") or "")),
        }
        if path.exists():
            raw = path.read_bytes()
            record["sourceSha256"] = hashlib.sha256(raw).hexdigest()
            record["sourceBytes"] = len(raw)
            value, error = load_possible_json(path)
            if error:
                record["schema"] = {
                    "type": "opaque",
                    "contentType": entry.get("mimeType"),
                }
                record["parseNote"] = error
            else:
                record["schema"] = infer_schema(value)
            schema_cache[path] = {
                key: value
                for key, value in record.items()
                if key in {"sourceSha256", "sourceBytes", "schema", "parseNote"}
            }
            path.unlink()
            deleted.add(path)
        elif path in schema_cache:
            record.update(schema_cache[path])
            record["sharedResponseFile"] = True
        else:
            record["schema"] = {"type": "unknown", "note": "shared/deleted body"}
        schema_index = len(schemas)
        schemas.append(record)
        entry.pop("file", None)
        entry["captured"] = False
        entry["dynamicBodyRemoved"] = True
        entry["schemaIndex"] = schema_index
        entry["url"] = record["urlPattern"]
    (ROOT / "network" / "api-response-schemas.json").write_text(
        json.dumps(schemas, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    manifest_path.write_text(
        json.dumps(redact_json(manifest), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return {"schemaCount": len(schemas), "deletedBodyFiles": len(deleted)}


def sanitize_request_bodies() -> int:
    path = ROOT / "network" / "request-bodies-sanitized.json"
    if not path.exists():
        return 0
    rows = json.loads(path.read_text("utf-8"))
    schemas = []
    for row in rows:
        raw = row.get("postData", "")
        try:
            value = json.loads(raw) if raw else None
            schema = infer_schema(value)
        except Exception:
            schema = {"type": "opaque-string"}
        schemas.append(
            {
                "urlPattern": normalize_url(str(row.get("url") or "")),
                "schema": schema,
                **({"note": row["error"]} if row.get("error") else {}),
            }
        )
    (ROOT / "network" / "request-body-schemas.json").write_text(
        json.dumps(schemas, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    path.unlink()
    return len(schemas)


def redact_retained_artifacts() -> int:
    changed = 0
    # Keep JS/CSS source byte-for-byte. Redact readable runtime/HTML/manifest
    # artifacts while retaining their structure.
    static_source_root = BODY_ROOT
    for path in ROOT.rglob("*"):
        if not path.is_file() or path.suffix.lower() in {".png", ".bin"}:
            continue
        if static_source_root in path.resolve().parents and path.suffix.lower() in {
            ".js",
            ".css",
            ".svg",
        }:
            continue
        try:
            text = path.read_text("utf-8")
        except Exception:
            continue
        redacted = redact_text(text)
        if redacted != text:
            path.write_text(redacted, encoding="utf-8")
            changed += 1
    # Normalize dynamic URLs in the request inventory without touching static
    # resource URLs needed to map bundles.
    requests_path = ROOT / "network" / "requests.json"
    if requests_path.exists():
        data = json.loads(requests_path.read_text("utf-8"))
        for row in data.get("requests", []):
            if not is_static(row):
                row["url"] = normalize_url(str(row.get("url") or ""))
            else:
                row["url"] = redact_text(str(row.get("url") or ""))
        requests_path.write_text(
            json.dumps(redact_json(data), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    return changed


SCAN_PATTERNS = {
    "email": EMAIL_RE,
    "bearer": BEARER_RE,
    "jwt": JWT_RE,
    "openaiApiKey": OPENAI_KEY_RE,
    "secretLiteral": SECRET_VALUE_RE,
}


def sensitive_scan() -> dict[str, Any]:
    counts = {name: 0 for name in SCAN_PATTERNS}
    preserved_counts = {name: 0 for name in SCAN_PATTERNS}
    findings: dict[str, dict[str, int]] = {}
    preserved_findings: dict[str, dict[str, int]] = {}
    scanned = 0
    binary = 0
    for path in ROOT.rglob("*"):
        if not path.is_file() or path.name == "sensitive-scan.json":
            continue
        if path.suffix.lower() in {".png", ".bin"}:
            binary += 1
            continue
        try:
            text = path.read_text("utf-8")
        except Exception:
            binary += 1
            continue
        scanned += 1
        local = {}
        preserved_local = {}
        is_preserved_source = (
            BODY_ROOT in path.resolve().parents
            and path.suffix.lower() in {".js", ".css", ".svg"}
        )
        for name, pattern in SCAN_PATTERNS.items():
            matches = list(pattern.finditer(text))
            if name == "secretLiteral":
                matches = [
                    match
                    for match in matches
                    if not match.group(2).startswith("<redacted")
                ]
            count = len(matches)
            if count:
                if is_preserved_source:
                    preserved_counts[name] += count
                    preserved_local[name] = count
                else:
                    counts[name] += count
                    local[name] = count
        if local:
            findings[str(path.relative_to(ROOT).as_posix())] = local
        if preserved_local:
            preserved_findings[str(path.relative_to(ROOT).as_posix())] = (
                preserved_local
            )
    return {
        "scannedTextFiles": scanned,
        "skippedBinaryFiles": binary,
        "unresolvedSensitivePatternCounts": counts,
        "filesWithUnresolvedMatches": findings,
        "preservedStaticSourcePatternCounts": preserved_counts,
        "preservedStaticSourceFilesWithMatches": preserved_findings,
        "valuesIncluded": False,
        "note": "Counts only; matched values are never written. JS/CSS/SVG source is preserved byte-for-byte, so source-code fixtures/regex examples are reported separately rather than modified.",
    }


def main() -> None:
    assert_inside(ROOT, Path.cwd().resolve())
    result = sanitize_dynamic_bodies()
    result["requestBodySchemas"] = sanitize_request_bodies()
    result["retainedArtifactsRedacted"] = redact_retained_artifacts()
    scan = sensitive_scan()
    (ROOT / "sensitive-scan.json").write_text(
        json.dumps(scan, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    result["scan"] = scan
    (ROOT / "sanitization-report.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
