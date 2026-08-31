"""Authoritative logged-in Plus mobile settings capture (390x844 CSS px).

Uses the loopback WebBridge controller and an existing authenticated tab.  It
does not query cookie or web-storage APIs and does not modify preferences.
"""

from __future__ import annotations

import base64
import json
import shutil
import time
from pathlib import Path
from typing import Any

import requests
from PIL import Image

from tools.build_tabs_summary import control_inventory, minimize_runtime_values, strip_nav
from tools.edge_auth_capture import (
    BASE,
    COMPUTED_STYLES,
    PAGE_SUMMARY_JS,
    TABS,
    call,
    cdp,
    click_tab,
    evaluate,
    selected_tab_state,
    wait_ready,
)
from tools.sanitize_auth_capture import redact_json


ROOT = Path("qa/auth-capture/mobile")


NAV_LAYOUT_JS = r"""
(() => {
  const rect = el => { const r=el.getBoundingClientRect(); return {
    x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,right:r.right,
    bottom:r.bottom,left:r.left}; };
  const dialog=[...document.querySelectorAll('[role=dialog]')].find(d =>
    d.querySelector('button.__menu-item'));
  const buttons=dialog?[...dialog.querySelectorAll('button.__menu-item')]:[];
  let scrollAncestor=null;
  if(buttons[0]) {
    let node=buttons[0].parentElement;
    while(node && node!==dialog) {
      if(node.scrollWidth>node.clientWidth+1 || node.scrollHeight>node.clientHeight+1) {
        scrollAncestor=node; break;
      }
      node=node.parentElement;
    }
  }
  const data=buttons.map((b,i)=>{
    const r=rect(b);
    return {i,text:(b.innerText||'').trim(),state:b.getAttribute('data-state'),
      selected:b.getAttribute('aria-selected'),rect:r,
      visible:r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight};
  });
  const sample=data.slice(0,Math.min(6,data.length));
  const ySpread=sample.length?Math.max(...sample.map(x=>x.rect.y))-Math.min(...sample.map(x=>x.rect.y)):null;
  const xSpread=sample.length?Math.max(...sample.map(x=>x.rect.x))-Math.min(...sample.map(x=>x.rect.x)):null;
  return {
    href:location.href,viewport:{innerWidth,innerHeight,devicePixelRatio},
    dialog:dialog?rect(dialog):null,
    mode:ySpread!==null&&ySpread<4&&xSpread>20?'horizontal':
      (xSpread!==null&&xSpread<4&&ySpread>20?'vertical':'mixed'),
    buttons:data,
    visibleButtonCount:data.filter(x=>x.visible).length,
    scrollAncestor:scrollAncestor?{
      tag:scrollAncestor.tagName,className:String(scrollAncestor.className||''),
      rect:rect(scrollAncestor),scrollLeft:scrollAncestor.scrollLeft,
      scrollTop:scrollAncestor.scrollTop,scrollWidth:scrollAncestor.scrollWidth,
      scrollHeight:scrollAncestor.scrollHeight,clientWidth:scrollAncestor.clientWidth,
      clientHeight:scrollAncestor.clientHeight,
      overflowX:getComputedStyle(scrollAncestor).overflowX,
      overflowY:getComputedStyle(scrollAncestor).overflowY}:null,
    backControls:dialog?[...dialog.querySelectorAll('button')]
      .filter(b=>/返回|back/i.test((b.getAttribute('aria-label')||'')+' '+(b.innerText||'')))
      .map(b=>({text:(b.innerText||'').trim(),aria:b.getAttribute('aria-label'),rect:rect(b)})):[],
    headings:dialog?[...dialog.querySelectorAll('h1,h2,h3,[role=heading]')]
      .map(x=>({text:(x.innerText||'').trim(),level:x.getAttribute('aria-level'),rect:rect(x)}))
      .filter(x=>x.text):[]
  };
})()
"""


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(redact_json(value), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def clean_output() -> None:
    workspace = Path.cwd().resolve()
    target = ROOT.resolve()
    if workspace not in target.parents:
        raise RuntimeError(f"refusing cleanup outside workspace: {target}")
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)


def screenshot(tab_id: int, path: Path) -> tuple[int, int]:
    result = call("screenshot", {"_tabId": tab_id, "format": "png"}, 180)
    path.write_bytes(base64.b64decode(result["data"]))
    return Image.open(path).size


def dom_snapshot(tab_id: int) -> dict[str, Any]:
    return cdp(
        tab_id,
        "DOMSnapshot.captureSnapshot",
        {
            "computedStyles": COMPUTED_STYLES,
            "includePaintOrder": True,
            "includeDOMRects": True,
            "includeBlendedBackgroundColors": True,
            "includeTextColorOpacities": True,
        },
    )


def capture_current(
    tab_id: int,
    slug: str,
    label: str,
    expected_hash: str,
    verified: dict[str, Any],
) -> dict[str, Any]:
    summary = evaluate(tab_id, PAGE_SUMMARY_JS)
    layout = evaluate(tab_id, NAV_LAYOUT_JS)
    if not (
        verified.get("selected") == "true"
        and verified.get("state") == "active"
        and summary.get("href", "").endswith(expected_hash)
    ):
        raise RuntimeError(
            f"refusing unverified mobile artifact {slug}: {verified}, {summary.get('href')}"
        )
    outer_html = evaluate(
        tab_id,
        "[...document.querySelectorAll('[role=dialog]')].find(d=>d.querySelector('button.__menu-item'))?.outerHTML||''",
    )
    record = {
        "slug": slug,
        "label": label,
        "expectedHash": expected_hash,
        "verifiedSelection": verified,
        "summary": summary,
        "navigationLayout": layout,
        "dialogOuterHTML": outer_html,
    }
    write_json(ROOT / f"{slug}.json", record)
    write_json(ROOT / f"{slug}.domsnapshot.json", dom_snapshot(tab_id))
    image_size = screenshot(tab_id, ROOT / f"{slug}.png")
    record["imageSize"] = image_size
    return record


def build_summary(records: list[dict[str, Any]], initial: dict[str, Any]) -> None:
    out = [
        "# 登录态 Plus 设置页：手机端权威采集",
        "",
        "> 基于已保存的 390×844、DPR 1、mobile=true CDP 运行时结果离线整理；未读取 Cookie/Storage，也未修改任何设置值。账户动态值在文本摘要中已最小化。",
        "",
        "## 响应式导航结论",
        "",
        f"- 初始 `#settings` 导航模式：**{initial['navigationLayout']['mode']}**。",
        f"- 初始对话框：`{initial['navigationLayout']['dialog']}`。",
        f"- 初始视口内可见分类数：**{initial['navigationLayout']['visibleButtonCount']} / 17**。",
        f"- 导航滚动容器：`{initial['navigationLayout']['scrollAncestor']}`。",
        "- 每次切换均通过 CDP 真实鼠标事件完成，并同时验证目标 Hash、`aria-selected=true`、`data-state=active`。",
        "",
        "## 17 个分类",
        "",
        "| # | 分类 | Hash | 导航模式 | 截图 | DOM |",
        "|---:|---|---|---|---|---|",
    ]
    for index, record in enumerate(records, 1):
        slug = record["slug"]
        out.append(
            f"| {index} | {record['label']} | `{record['expectedHash']}` | "
            f"{record['navigationLayout']['mode']} | "
            f"[`{slug}.png`](mobile/{slug}.png) | "
            f"[`摘要/HTML`](mobile/{slug}.json) · [`DOMSnapshot`](mobile/{slug}.domsnapshot.json) |"
        )
    out.extend(["", "## 分类详情", ""])
    for index, record in enumerate(records, 1):
        slug = record["slug"]
        lines = minimize_runtime_values(
            slug, strip_nav(record["summary"]["dialog"]["text"])
        )
        counts, controls = control_inventory(record["dialogOuterHTML"])
        copy = "；".join(lines[:45]) or "（无可见文案）"
        if len(lines) > 45:
            copy += f"；…（另有 {len(lines)-45} 行）"
        named = "；".join(controls[:25]) or "（无额外具名控件）"
        if len(controls) > 25:
            named += f"；…（另有 {len(controls)-25} 项）"
        types = "、".join(f"{k} {v}" for k, v in counts.items() if v) or "无"
        layout = record["navigationLayout"]
        active = next(
            x for x in layout["buttons"] if x.get("selected") == "true"
        )
        out.extend(
            [
                f"### {index}. {record['label']}",
                "",
                f"- **校验：** `{record['summary']['href']}`；`aria-selected={record['verifiedSelection']['selected']}`，`data-state={record['verifiedSelection']['state']}`。",
                f"- **布局：** dialog `{layout['dialog']}`；active nav `{active['rect']}`；模式 `{layout['mode']}`；当前可见导航 {layout['visibleButtonCount']}/17。",
                f"- **可见文案：** {copy}",
                f"- **控件：** {types}；{named}",
                f"- **截图：** [`mobile/{slug}.png`](mobile/{slug}.png)（390×844）",
                f"- **结构：** [`mobile/{slug}.json`](mobile/{slug}.json) · [`mobile/{slug}.domsnapshot.json`](mobile/{slug}.domsnapshot.json)",
                "",
            ]
        )
    (ROOT.parent / "mobile-summary.md").write_text("\n".join(out), "utf-8")


def main() -> None:
    clean_output()
    status = requests.get(f"{BASE}/status", timeout=5).json()
    if not status.get("connected"):
        raise RuntimeError(f"WebBridge is not connected: {status}")
    tab = call("find_tab", {"url": "chatgpt.com", "active": True})
    tab_id = int(tab["tabId"])
    metrics = False
    completed = False
    try:
        cdp(
            tab_id,
            "Emulation.setDeviceMetricsOverride",
            {
                "width": 390,
                "height": 844,
                "deviceScaleFactor": 1,
                "mobile": True,
                "screenWidth": 390,
                "screenHeight": 844,
            },
        )
        metrics = True
        cdp(tab_id, "Page.navigate", {"url": "https://chatgpt.com/#settings"})
        wait_ready(tab_id, 35)
        time.sleep(2)
        viewport = evaluate(
            tab_id, "({innerWidth,innerHeight,devicePixelRatio,href:location.href})"
        )
        if not (
            viewport.get("innerWidth") == 390
            and viewport.get("innerHeight") == 844
            and abs(float(viewport.get("devicePixelRatio", 0)) - 1) < 0.001
            and viewport.get("href") == "https://chatgpt.com/#settings"
        ):
            raise RuntimeError(f"unexpected mobile viewport: {viewport}")
        general = selected_tab_state(tab_id, "常规")
        if not (
            general.get("selected") == "true"
            and general.get("state") == "active"
            and general.get("hash") == "#settings"
        ):
            raise RuntimeError(f"initial #settings is not General: {general}")

        initial = capture_current(
            tab_id, "initial-settings", "初始设置", "#settings", general
        )
        records = []
        behavior = []
        for slug, label, expected_hash in TABS:
            print(f"mobile capture: {slug} / {label}", flush=True)
            before = evaluate(tab_id, NAV_LAYOUT_JS)
            verified = click_tab(tab_id, label, expected_hash)
            record = capture_current(tab_id, slug, label, expected_hash, verified)
            after = record["navigationLayout"]
            behavior.append(
                {
                    "slug": slug,
                    "label": label,
                    "expectedHash": expected_hash,
                    "before": before,
                    "after": after,
                    "verified": verified,
                }
            )
            records.append(record)
        write_json(ROOT / "navigation-behavior.json", behavior)
        build_summary(records, initial)
        write_json(
            ROOT / "capture-complete.json",
            {
                "complete": True,
                "target": tab,
                "viewport": viewport,
                "tabCount": len(records),
                "initialNavigationMode": initial["navigationLayout"]["mode"],
                "authentication": "existing browser session; cookies/storage were not read",
            },
        )
        completed = True
        print(f"mobile capture complete: {ROOT.resolve()}", flush=True)
    finally:
        mobile_restore_error: Exception | None = None
        try:
            click_tab(tab_id, "常规", "#settings")
        except Exception as exc:
            mobile_restore_error = exc
        if metrics:
            try:
                cdp(tab_id, "Emulation.clearDeviceMetricsOverride")
            except Exception:
                pass
        # The mobile tab strip has a sticky edge fade which can intercept the
        # first item's trusted click. After clearing emulation, retry against
        # the unobstructed desktop navigation before returning control.
        if mobile_restore_error is not None:
            try:
                click_tab(tab_id, "常规", "#settings")
            except Exception as exc:
                print(
                    f"warning: restore General failed in mobile and desktop: "
                    f"mobile={mobile_restore_error}; desktop={exc}",
                    flush=True,
                )
        if not completed:
            (ROOT / "capture-complete.json").unlink(missing_ok=True)


if __name__ == "__main__":
    main()
