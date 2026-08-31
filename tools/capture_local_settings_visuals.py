#!/usr/bin/env python3
"""Capture local settings reference views and record exact element geometry."""

from __future__ import annotations

import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "qa" / "local-settings"
BASE_URL = os.environ.get("SETTINGS_QA_BASE_URL", "http://127.0.0.1:5173/")
TABS = [
    ("general", "#settings"),
    ("notifications", "#settings/Notifications"),
    ("personalization", "#settings/Personalization"),
    ("plugins", "#settings/Plugins"),
    ("voice", "#settings/Voice"),
]


MEASURE_SCRIPT = """() => {
  const rect = (element) => {
    const box = element.getBoundingClientRect();
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      right: box.right,
      bottom: box.bottom,
    };
  };
  const query = (selector) => document.querySelector(selector);
  const dialog = query('.ps-dialog');
  const nav = query('.ps-nav');
  const active = query('.ps-nav-item.is-active');
  return {
    dialog: rect(dialog),
    topbar: rect(query('.ps-sidebar-topbar')),
    search: rect(query('.ps-search')),
    nav: rect(nav),
    panelHeader: rect(query('.ps-content-header')),
    scroll: rect(query('.ps-content-scroll')),
    navClientWidth: nav.clientWidth,
    navScrollWidth: nav.scrollWidth,
    navScrollLeft: nav.scrollLeft,
    active: {
      text: active.innerText,
      rect: rect(active),
      offsetLeft: active.offsetLeft,
    },
    rows: [...document.querySelectorAll(
      '.ps-content-scroll .ps-row,' +
      '.ps-content-scroll .ps-detail-row,' +
      '.ps-content-scroll .ps-disclosure-row,' +
      '.ps-content-scroll .ps-plugin-row'
    )].slice(0, 14).map((element) => ({
      cls: element.className,
      rect: rect(element),
      text: element.innerText.slice(0, 100),
    })),
  };
}"""


def capture(browser: object, *, mobile: bool) -> dict[str, object]:
    measurements: dict[str, object] = {}
    width, height = (390, 844) if mobile else (1536, 744)
    prefix = "mobile" if mobile else "desktop"
    context = browser.new_context(  # type: ignore[attr-defined]
        viewport={"width": width, "height": height},
        device_scale_factor=1,
        color_scheme="light",
        locale="zh-CN",
        is_mobile=mobile,
    )
    page = context.new_page()
    page.goto(f"{BASE_URL}{TABS[0][1]}", wait_until="domcontentloaded", timeout=60_000)
    for index, (slug, fragment) in enumerate(TABS):
        if index:
            page.evaluate("fragment => { window.location.hash = fragment }", fragment)
        page.wait_for_selector(
            f'.ps-layer[data-state="open"] .ps-dialog[aria-hidden="false"] '
            f'.ps-nav-item[data-settings-tab="{slug}"].is-active',
            timeout=10_000,
        )
        page.wait_for_timeout(150)
        page.screenshot(path=str(OUT / f"current-{prefix}-{slug}.png"))
        measurements[slug] = page.evaluate(MEASURE_SCRIPT)
    context.close()
    return measurements


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        mobile_measurements = capture(browser, mobile=True)
        desktop_measurements = capture(browser, mobile=False)
        browser.close()

    for prefix, measurements in (
        ("mobile", mobile_measurements),
        ("desktop", desktop_measurements),
    ):
        path = OUT / f"current-{prefix}-first-five-measurements.json"
        path.write_text(json.dumps(measurements, ensure_ascii=False, indent=2), encoding="utf-8")
        print(path.relative_to(ROOT))
        for slug, value in measurements.items():
            assert isinstance(value, dict)
            print(prefix, slug, value["dialog"], "scrollLeft", value["navScrollLeft"])


if __name__ == "__main__":
    main()
