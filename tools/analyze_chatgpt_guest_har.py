#!/usr/bin/env python3
"""Extract a readable guest-chat report from a jshook HAR capture.

The original HAR is intentionally left untouched.  This script writes both an
unredacted key-exchange record and a redacted summary suitable for review.
"""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import json
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit


TOKEN_MARKERS = (
    "token",
    "affinity",
    "session-id",
    "trace-id",
    "messageid",
    "message-id",
    "operationid",
    "conversation-id",
)


def header_map(headers: list[dict[str, str]]) -> dict[str, str]:
    return {item["name"]: item["value"] for item in headers}


def b64url_json(part: str) -> dict[str, Any] | None:
    try:
        raw = base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))
        value = json.loads(raw)
        return value if isinstance(value, dict) else None
    except Exception:
        return None


def jwt_payload(token: str) -> dict[str, Any] | None:
    parts = token.split(".")
    return b64url_json(parts[1]) if len(parts) == 3 else None


def redact_value(name: str, value: str) -> str:
    lowered = name.lower()
    if any(marker in lowered for marker in TOKEN_MARKERS):
        digest = hashlib.sha256(value.encode()).hexdigest()[:12]
        return f"<redacted len={len(value)} sha256={digest}>"
    return value


def redact_mapping(values: dict[str, str]) -> dict[str, str]:
    return {key: redact_value(key, value) for key, value in values.items()}


def endpoint_pattern(url: str) -> str:
    parsed = urlsplit(url)
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("har", type=Path)
    parser.add_argument("--out-dir", type=Path, default=Path("artifacts"))
    args = parser.parse_args()

    har = json.loads(args.har.read_text(encoding="utf-8"))
    entries: list[dict[str, Any]] = har["log"]["entries"]
    args.out_dir.mkdir(parents=True, exist_ok=True)

    update = next(
        entry
        for entry in entries
        if "/unauth-mweb/conversation/updates" in entry["request"]["url"]
    )
    request = update["request"]
    response = update["response"]
    form_text = request.get("postData", {}).get("text", "")
    form = {key: values[-1] for key, values in parse_qs(form_text).items()}
    request_headers = header_map(request.get("headers", []))
    response_headers = header_map(response.get("headers", []))
    response_body = response.get("content", {}).get("text", "")

    key_record = {
        "request": {
            "method": request["method"],
            "url": request["url"],
            "httpVersion": request.get("httpVersion"),
            "headers": request_headers,
            "form": form,
        },
        "response": {
            "status": response["status"],
            "httpVersion": response.get("httpVersion"),
            "headers": response_headers,
            "body": response_body,
        },
    }
    (args.out_dir / "chatgpt-guest-key-request.unredacted.json").write_text(
        json.dumps(key_record, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    redacted_record = {
        "request": {
            **{key: value for key, value in key_record["request"].items() if key not in {"headers", "form"}},
            "headers": redact_mapping(request_headers),
            "form": redact_mapping(form),
        },
        "response": key_record["response"],
    }
    (args.out_dir / "chatgpt-guest-key-request.redacted.json").write_text(
        json.dumps(redacted_record, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (args.out_dir / "chatgpt-guest-conversation-stream.html").write_text(
        response_body, encoding="utf-8"
    )

    with (args.out_dir / "chatgpt-guest-endpoints.csv").open(
        "w", encoding="utf-8-sig", newline=""
    ) as stream:
        writer = csv.writer(stream)
        writer.writerow(["method", "status", "url", "mimeType", "responseSize"])
        for entry in entries:
            req = entry["request"]
            res = entry["response"]
            writer.writerow(
                [
                    req["method"],
                    res["status"],
                    req["url"],
                    res.get("content", {}).get("mimeType", ""),
                    res.get("content", {}).get("size", ""),
                ]
            )

    prepare_bodies: list[dict[str, Any]] = []
    finalize_bodies: list[dict[str, Any]] = []
    conduit_payloads: list[dict[str, Any]] = []
    for entry in entries:
        url = entry["request"]["url"]
        body = entry["response"].get("content", {}).get("text", "")
        if not body:
            continue
        try:
            parsed = json.loads(body)
        except Exception:
            continue
        if "/sentinel/chat-requirements/prepare" in url:
            prepare_bodies.append(parsed)
        elif "/sentinel/chat-requirements/finalize" in url:
            finalize_bodies.append(parsed)
        elif "/conversation/prepare" in url and "conduit_token" in parsed:
            payload = jwt_payload(parsed["conduit_token"])
            if payload:
                conduit_payloads.append(payload)

    counts: dict[tuple[str, str], dict[str, Any]] = {}
    for entry in entries:
        req = entry["request"]
        key = (req["method"], endpoint_pattern(req["url"]))
        record = counts.setdefault(key, {"count": 0, "statuses": set()})
        record["count"] += 1
        record["statuses"].add(entry["response"]["status"])

    key_paths = (
        "/unauth-mweb/conversation/prepare",
        "/unauth-mweb/conversation/updates",
        "/unauth-mweb/conversation/runtime",
        "/unauth-mweb/sentinel/chat-requirements/prepare",
        "/unauth-mweb/sentinel/chat-requirements/finalize",
        "/unauth-mweb/sentinel/ping",
        "/backend-api/sentinel/req",
        "/backend-api/sentinel/ping",
    )
    endpoint_lines = []
    for (method, url), record in sorted(counts.items()):
        if any(path in url for path in key_paths):
            statuses = ",".join(map(str, sorted(record["statuses"])))
            endpoint_lines.append(f"- `{method} {url}` — {record['count']} 次，状态 `{statuses}`")

    first_prepare = prepare_bodies[-1] if prepare_bodies else {}
    first_finalize = finalize_bodies[-1] if finalize_bodies else {}
    conduit = conduit_payloads[-1] if conduit_payloads else {}
    conduit_lifetime = (
        conduit.get("exp", 0) - conduit.get("iat", 0)
        if isinstance(conduit.get("exp"), int) and isinstance(conduit.get("iat"), int)
        else None
    )

    report = f"""# ChatGPT 未登录会话抓包报告

## 范围说明

- 使用全新 Chrome 用户目录，未登录；浏览器地址与 HTTP Host 均为 `https://chatgpt.com/`。
- 当前竞赛环境声明所有域名流量会重定向到沙箱，因此本报告准确描述的是该环境中 `chatgpt.com` 的实际运行态；响应里观察到 Cloudflare/OpenAI 风格标记，但不能据此单独证明网络路径绕过了沙箱并直达公网服务。

## 实测会话

- 请求：`{form.get('prompt', '')}`
- 回答：`我可以帮你回答问题、分析信息、写作翻译、制定计划，并协助你完成各种实际任务。`
- 会话提交：`{request['method']} {request['url']}`
- 响应：`{response['status']} {response.get('httpVersion', '')}`（HAR 标注值），`{response.get('content', {}).get('mimeType', '')}`，{len(response_body)} 字节
- 登录态证据：HAR 中未见 `Authorization` 或 Cookie；路径含 `/unauth-mweb`、查询参数为 `lightweight_authenticated=0`、persona 为 `chatgpt-noauth`，页面显示“登录/免费注册”。
- 模型边界：请求没有 `model` 字段，响应也没有披露模型名，因此不能从本次抓包判断具体模型。

## 核心端点

{chr(10).join(endpoint_lines)}

## 会话请求头（动态值已摘要）

```json
{json.dumps(redact_mapping(request_headers), ensure_ascii=False, indent=2)}
```

## 会话表单字段

```json
{json.dumps(redact_mapping(form), ensure_ascii=False, indent=2)}
```

## 会话响应头

```json
{json.dumps(response_headers, ensure_ascii=False, indent=2)}
```

## 防护与协议结论

- Cloudflare 边缘：`server: cloudflare`、`cf-ray`、NEL/Report-To、Workers 版本标记。
- 浏览器安全头：HSTS、`X-Content-Type-Options: nosniff`、COOP、严格 Referrer Policy；首页还有 CSP、`X-Frame-Options: SAMEORIGIN`。
- Sentinel 要求：`turnstile.required={first_prepare.get('turnstile', {}).get('required')}`、`proofofwork.required={first_prepare.get('proofofwork', {}).get('required')}`、`so.required={first_prepare.get('so', {}).get('required')}`。
- Proof-of-Work：本次 seed=`{first_prepare.get('proofofwork', {}).get('seed')}`，difficulty=`{first_prepare.get('proofofwork', {}).get('difficulty')}`；finalize 请求同时提交 prepare token、PoW 结果与 Turnstile token。
- Chat-requirements token：finalize 返回，`expire_after={first_finalize.get('expire_after')}` 秒。
- Conduit 路由令牌：ES256 JWT，本次有效期约 `{conduit_lifetime}` 秒，并绑定 conduit UUID、内部位置与集群。
- 每会话/每轮绑定：`OAI-Session-Id`、签名的 Document-Affinity、`x-oai-turn-trace-id`、operationId、messageId。
- 持续校验：`/backend-api/sentinel/req|ping` 与 `/unauth-mweb/sentinel/ping` 继续上报/校验浏览器信号和令牌存在状态。
- 流式协议不是 SSE 或 WebSocket：同一个 Fetch POST 返回 `text/vnd.openai.web-mobile-partial+html`，以 `<template data-web-mobile-dpu-frame>` 增量传输；响应头标记 `x-web-mobile-stream: declarative-partial-updates`。
- DPU 帧值表示帧内容长度而不是序号；HAR 合并正文保留了应用层帧，但不保留原始 TCP/H2 分块边界和每帧到达时间。
- 缓存策略：聊天与令牌接口均 `cache-control: no-store`。

## 抓包边界

- 文件是 jshook/CDP 导出的应用层 HAR，不是原始 PCAP；它适合核对 URL、头、表单和响应正文，但不能证明线级传输协议或逐包时序。
- HAR 的 `startedDateTime` 误把 CDP 单调时钟映射到了 1970 年；真实响应 `Date` 为 2026-08-30。`HTTP/1.1` 也可能是导出器占位值，不能据此排除 HTTP/2 或 HTTP/3。
- CDP HAR 可能漏掉 extra-info 头，因此准确说法是“HAR 中未见 Cookie/Authorization”，而不是宣称线级绝对不存在。

## 证据文件

- `chatgpt-guest-full.har`：完整 HAR（请求/响应头、请求体、响应体，含短期动态令牌）。
- `chatgpt-guest-key-request.unredacted.json`：核心聊天请求和响应的完整展开。
- `chatgpt-guest-key-request.redacted.json`：便于阅读的动态值摘要版。
- `chatgpt-guest-conversation-stream.html`：原始增量 HTML 响应。
- `chatgpt-guest-endpoints.csv`：HAR 中所有条目的平铺清单。

> 注意：捕获中的 Turnstile、PoW、chat-requirements、conduit、affinity 等值是短期且上下文绑定的，不应当视为稳定 API 凭据。
"""
    (args.out_dir / "chatgpt-guest-report.md").write_text(report, encoding="utf-8")


if __name__ == "__main__":
    main()
