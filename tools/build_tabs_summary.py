"""Build a human-readable, PII-minimized summary from saved tab artifacts."""

from __future__ import annotations

import json
import re
from pathlib import Path

from bs4 import BeautifulSoup
from PIL import Image


ROOT = Path("qa/auth-capture")
TABS = ROOT / "tabs"
OUT = ROOT / "tabs-summary.md"

ORDER = [
    "general",
    "notifications",
    "personalization",
    "plugins",
    "voice",
    "billing",
    "usage",
    "analytics",
    "data-controls",
    "cloud-browser",
    "storage",
    "safety",
    "security",
    "parental-controls",
    "trusted-contacts",
    "account",
    "keyboard",
]

NAV = [
    "常规",
    "通知",
    "个性化",
    "插件",
    "语音",
    "账单",
    "使用情况",
    "分析",
    "数据管理",
    "云浏览器",
    "存储空间",
    "安全防护",
    "账户安全与登录",
    "家长控制",
    "受信任联系人",
    "账户",
    "快捷键",
]

EMAIL = re.compile(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b")
USERNAME = re.compile(r"^@[A-Za-z0-9_.-]{3,}$")
CARD = re.compile(r"[•*]{2,}\s*\d{2,4}")
ADDRESS_HINT = re.compile(
    r"(?i)\b(?:street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|lane|ln\.?)\b"
)


def strip_nav(text: str) -> list[str]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    expected = ["设置", *NAV]
    if lines[: len(expected)] == expected:
        return lines[len(expected) :]
    # Defensive fallback: find the complete contiguous navigation sequence.
    for index in range(max(0, len(lines) - len(NAV))):
        if lines[index : index + len(NAV)] == NAV:
            return lines[index + len(NAV) :]
    return lines


def minimize_runtime_values(slug: str, lines: list[str]) -> list[str]:
    result: list[str] = []
    redact_next_labels = {
        "account": {"姓名", "用户名", "电子邮件"},
        "personalization": {"昵称", "职业"},
    }
    redact_next = False
    active_redact_labels = redact_next_labels.get(slug, set())
    billing_value_mode = False
    billing_sections = {"账单信息", "付款方式"}
    billing_end = {"取消套餐"}
    billing_allowed = {
        "编辑",
        "账单电子邮箱",
        "名称",
        "地址",
        "付款方式",
        "添加新方式",
        "默认",
    }
    for line in lines:
        if redact_next:
            if line in active_redact_labels:
                result.append(line)
                # Empty preceding field; the new field still needs its value
                # suppressed.
                continue
            result.append("<运行时账户值>")
            redact_next = False
            continue
        if line in active_redact_labels:
            result.append(line)
            redact_next = True
            continue
        if slug == "billing" and line in billing_sections:
            billing_value_mode = True
            result.append(line)
            continue
        if slug == "billing" and line in billing_end:
            billing_value_mode = False
            result.append(line)
            continue
        if slug == "billing" and not billing_value_mode and (
            re.search(r"\d{4}[年/-]\d", line)
            or re.search(r"(?i)\b(?:PHP|USD|CNY|EUR)\b", line)
            or CARD.search(line)
        ):
            result.append("<运行时账单值>")
            continue
        if EMAIL.search(line) or USERNAME.fullmatch(line) or CARD.search(line):
            result.append("<运行时账户值>")
            continue
        if slug == "billing" and billing_value_mode:
            # Preserve labels/actions, suppress personal billing values.
            if line in billing_allowed:
                result.append(line)
            else:
                result.append("<运行时账单值>")
            continue
        if slug in {"usage", "storage"} and re.search(r"\d", line):
            result.append("<运行时用量值>")
            continue
        if slug == "security" and line.isdigit():
            result.append("<运行时会话值>")
            continue
        result.append(line)
    # Keep order while collapsing adjacent identical placeholders.
    collapsed = []
    for line in result:
        if not collapsed or line != collapsed[-1]:
            collapsed.append(line)
    return collapsed


def control_inventory(html: str) -> tuple[dict[str, int], list[str]]:
    soup = BeautifulSoup(html, "html.parser")
    counts = {
        "button": 0,
        "switch": 0,
        "combobox": 0,
        "input": 0,
        "textarea": 0,
        "link": 0,
    }
    labels: list[str] = []

    def add(label: str) -> None:
        label = " ".join(label.split())
        label = EMAIL.sub("<redacted-email>", label)
        label = re.sub(r"(?<!\w)@[A-Za-z0-9_.-]{3,}", "<redacted-username>", label)
        if label and label not in labels and label not in NAV:
            labels.append(label[:120])

    for element in soup.find_all(["button", "input", "textarea", "select", "a"]):
        classes = element.get("class") or []
        if "__menu-item" in classes:
            continue
        name = element.name
        role = element.get("role") or ""
        if role == "switch" or "radix-state-checked:bg-blue-400" in classes:
            counts["switch"] += 1
        elif role == "combobox" or name == "select":
            counts["combobox"] += 1
        elif name == "button":
            counts["button"] += 1
        elif name == "input":
            counts["input"] += 1
        elif name == "textarea":
            counts["textarea"] += 1
        elif name == "a":
            counts["link"] += 1
        label = (
            element.get("aria-label")
            or element.get("title")
            or element.get("placeholder")
            or element.get_text(" ", strip=True)
        )
        if label and label not in {"关闭", "设置"}:
            state = element.get("aria-checked") or element.get("data-state")
            add(f"{label}{f' [{state}]' if state else ''}")
    return counts, labels


def main() -> None:
    records = []
    for slug in ORDER:
        data = json.loads((TABS / f"{slug}.json").read_text("utf-8"))
        screenshot_path = TABS / f"{slug}.png"
        image_size = Image.open(screenshot_path).size
        lines = minimize_runtime_values(
            slug, strip_nav(data["summary"]["dialog"]["text"])
        )
        counts, controls = control_inventory(data["dialogOuterHTML"])
        records.append(
            {
                "slug": slug,
                "label": data["label"],
                "hash": data["expectedHash"],
                "href": data["summary"]["href"],
                "selection": data["verifiedSelection"],
                "dialog": data["summary"]["dialog"]["rect"],
                "nav": next(
                    x
                    for x in data["summary"]["navButtons"]
                    if x.get("state") == "active"
                ),
                "lines": lines,
                "counts": counts,
                "controls": controls,
                "imageSize": image_size,
            }
        )

    first = records[0]
    viewport = json.loads((ROOT / "capture-complete.json").read_text("utf-8"))[
        "viewport"
    ]
    out = [
        "# 登录态 ChatGPT 设置页：17 个分类采集摘要",
        "",
        "> 本文完全由 `qa/auth-capture` 中已保存的授权运行时 DOM、CDP DOMSnapshot 与截图离线生成；生成阶段未再次访问浏览器。账户值已最小化或替换为运行时占位符。",
        "",
        "## 采集基准",
        "",
        f"- 标准化 CSS 视口：**{viewport['innerWidth']} × {viewport['innerHeight']}**，DPR **{viewport['devicePixelRatio']}**。",
        f"- 设置对话框：**{first['dialog']['width']} × {first['dialog']['height']} CSS px**，位置 `({first['dialog']['x']}, {first['dialog']['y']})`。",
        "- 左侧导航按钮：182 × 36 CSS px；对话框左栏约 202 px，右侧内容区约 478 px。",
        f"- 每张截图：**{first['imageSize'][0]} × {first['imageSize'][1]} px**。",
        "- 每个分类均强校验 `aria-selected=true`、`data-state=active` 与目标 Hash 后才写入文件。",
        "",
        "## 快速索引",
        "",
        "| # | 分类 | Hash | 主要可见标题 | 截图 | DOM |",
        "|---:|---|---|---|---|---|",
    ]
    for index, record in enumerate(records, 1):
        title = record["lines"][0] if record["lines"] else record["label"]
        out.append(
            f"| {index} | {record['label']} | `{record['hash']}` | {title} | "
            f"[`{record['slug']}.png`](tabs/{record['slug']}.png) | "
            f"[`HTML/摘要`](tabs/{record['slug']}.json) · "
            f"[`DOMSnapshot`](tabs/{record['slug']}.domsnapshot.json) |"
        )

    out.extend(["", "## 各分类详情", ""])
    for index, record in enumerate(records, 1):
        rect = record["dialog"]
        nav = record["nav"]["rect"]
        counts = "、".join(
            f"{name} {count}"
            for name, count in record["counts"].items()
            if count
        ) or "无原生交互控件"
        copy = "；".join(record["lines"][:60]) or "（无可见文案）"
        controls = "；".join(record["controls"][:35]) or "（无额外具名控件）"
        if len(record["lines"]) > 60:
            copy += f"；…（另有 {len(record['lines']) - 60} 行）"
        if len(record["controls"]) > 35:
            controls += f"；…（另有 {len(record['controls']) - 35} 项）"
        out.extend(
            [
                f"### {index}. {record['label']}",
                "",
                f"- **路由/校验：** `{record['href']}`；选中状态 `aria-selected={record['selection']['selected']}`、`data-state={record['selection']['state']}`。",
                f"- **关键布局：** dialog `{rect['x']},{rect['y']} {rect['width']}×{rect['height']}`；选中导航 `{nav['x']},{nav['y']} {nav['width']}×{nav['height']}`。",
                f"- **可见标题与文案：** {copy}",
                f"- **控件类型：** {counts}。",
                f"- **具名控件：** {controls}",
                f"- **截图：** [`tabs/{record['slug']}.png`](tabs/{record['slug']}.png)",
                f"- **结构：** [`tabs/{record['slug']}.json`](tabs/{record['slug']}.json) · [`tabs/{record['slug']}.domsnapshot.json`](tabs/{record['slug']}.domsnapshot.json)",
                "",
            ]
        )

    OUT.write_text("\n".join(out), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
