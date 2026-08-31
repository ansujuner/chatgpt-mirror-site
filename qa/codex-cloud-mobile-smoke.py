#!/usr/bin/env python3
"""Mobile smoke/interaction QA for the local Codex Cloud settings replica."""

from __future__ import annotations

import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "qa" / "codex-cloud-mobile"
BASE_URL = os.environ.get("CODEX_SETTINGS_QA_BASE_URL", "http://127.0.0.1:5174")
ROUTES = [
    ("general", "/codex/cloud/settings/general"),
    ("environments", "/codex/cloud/settings/environments"),
    ("code-review", "/codex/cloud/settings/code-review"),
    ("connectors", "/codex/cloud/settings/connectors"),
    ("analytics", "/codex/cloud/settings/analytics"),
    ("data", "/codex/cloud/settings/data"),
    ("access-tokens", "/admin/access-tokens"),
]


def rect(locator):
    box = locator.bounding_box()
    return None if box is None else {key: round(value, 2) for key, value in box.items()}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    report: dict[str, object] = {"baseUrl": BASE_URL, "viewport": {"width": 390, "height": 844}, "routes": {}}

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=1,
            color_scheme="light",
            locale="zh-CN",
            is_mobile=True,
        )
        page = context.new_page()
        console_errors: list[str] = []
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: console_errors.append(str(error)))

        page.goto(f"{BASE_URL}/codex/cloud/settings/general", wait_until="networkidle")
        page.evaluate("localStorage.setItem('codex-cloud.github-connected', 'false')")
        page.reload(wait_until="networkidle")

        header = page.locator(".ccs-header")
        hamburger = page.locator(".ccs-mobile-nav-button")
        banner = page.locator(".ccs-github-banner")
        assert header.is_visible(), "shared header is not visible"
        assert hamburger.is_visible(), "mobile hamburger is not visible"
        assert banner.is_visible(), "disconnected GitHub banner is not visible"
        assert banner.get_by_role("button").count() == 1, "GitHub banner action missing"

        hamburger.click()
        drawer = page.locator(".ccs-mobile-sidebar")
        drawer.wait_for(state="visible")
        nav_buttons = drawer.locator("nav button")
        assert nav_buttons.count() == len(ROUTES), f"expected 7 drawer routes, got {nav_buttons.count()}"
        drawer_labels = nav_buttons.all_inner_texts()
        drawer_geometry = rect(drawer)
        page.screenshot(path=str(OUT / "drawer.png"))
        drawer.locator(".ccs-drawer-close-row button").click()
        assert drawer.count() == 0, "drawer did not close"
        hamburger.click()
        page.locator(".ccs-mobile-scrim").click(position={"x": 360, "y": 400})
        assert page.locator(".ccs-mobile-sidebar").count() == 0, "drawer did not close via scrim"

        # Verify each requested page is reachable through the actual mobile drawer.
        for index, (route, expected_path) in enumerate(ROUTES):
            hamburger.click()
            drawer = page.locator(".ccs-mobile-sidebar")
            drawer.wait_for(state="visible")
            button = drawer.locator(f'nav button[aria-current="page"]') if route == "general" else drawer.locator(f'nav button').nth(index)
            button.click()
            page.wait_for_timeout(100)
            assert page.url.endswith(expected_path), f"drawer route {route} did not navigate: {page.url}"
            page.locator(".ccs-main").wait_for(state="visible")
            page.wait_for_timeout(100)

            metrics = page.evaluate(
                """() => ({
                  href: location.pathname + location.search,
                  viewport: {width: innerWidth, height: innerHeight},
                  document: {clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth},
                  shell: (() => { const e = document.querySelector('.codex-settings-shell'); const r = e.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })(),
                  header: (() => { const e = document.querySelector('.ccs-header'); const r = e.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })(),
                  banner: (() => { const e = document.querySelector('.ccs-github-banner'); if (!e) return null; const r = e.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,text:e.innerText}; })(),
                  main: (() => { const e = document.querySelector('.ccs-main'); const r = e.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,clientWidth:e.clientWidth,scrollWidth:e.scrollWidth,clientHeight:e.clientHeight,scrollHeight:e.scrollHeight}; })(),
                  headings: [...document.querySelectorAll('.ccs-main h1, .ccs-main h2')].slice(0, 8).map(e => e.textContent.trim()),
                  buttons: [...document.querySelectorAll('.ccs-main button')].filter(e => {
                    const s = getComputedStyle(e); const r = e.getBoundingClientRect();
                    return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0;
                  }).slice(0, 30).map(e => ({text:e.innerText.trim(), aria:e.getAttribute('aria-label'), disabled:e.disabled})),
                })"""
            )
            assert metrics["href"].startswith(expected_path)
            assert metrics["document"]["scrollWidth"] <= 390, f"{route} overflows the viewport"
            assert metrics["main"]["scrollWidth"] <= metrics["main"]["clientWidth"] + 1, f"{route} main content overflows"
            page.screenshot(path=str(OUT / f"{route}.png"), full_page=False)
            report["routes"][route] = metrics

        # Banner opens a modal, cancel closes it, and completing the mock flow hides the banner.
        page.goto(f"{BASE_URL}/codex/cloud/settings/general", wait_until="networkidle")
        banner = page.locator(".ccs-github-banner")
        banner.get_by_role("button").click()
        dialog = page.locator(".ccs-connect-dialog")
        dialog.wait_for(state="visible")
        dialog.locator(".ccs-dialog-secondary").click()
        assert dialog.count() == 0, "GitHub dialog did not close via cancel"
        banner.get_by_role("button").click()
        page.locator(".ccs-dialog-primary").click()
        assert page.locator(".ccs-github-banner").count() == 0, "banner remained after GitHub connect"

        # Connector disconnect/reconnect controls propagate to shared banner state.
        page.goto(f"{BASE_URL}/codex/cloud/settings/connectors", wait_until="networkidle")
        connector_buttons = page.locator(".cssp-connectors-page button")
        disconnect = connector_buttons.filter(has_text="取消连接")
        if disconnect.count():
            disconnect.first.click()
            page.locator(".ccs-github-banner").wait_for(state="visible")
        connect = connector_buttons.filter(has_text="连接到 GitHub")
        if connect.count():
            connect.first.click()
            assert page.locator(".ccs-github-banner").count() == 0

        # Exercise representative stateful mobile controls on each remaining page.
        page.goto(f"{BASE_URL}/codex/cloud/settings/general", wait_until="networkidle")
        diff_trigger = page.get_by_role("button", name="打开差异视图显示格式菜单")
        diff_trigger.click()
        page.get_by_role("option", name="Split").click()
        assert "Split" in diff_trigger.inner_text()
        instructions = page.get_by_label("自定义指令")
        instructions.fill("移动端 QA")
        page.locator(".csp-instructions-section").get_by_role("button", name="保存").click()

        page.goto(f"{BASE_URL}/codex/cloud/settings/environments", wait_until="networkidle")
        page.get_by_role("button", name="用于创建新环境的链接").click()
        page.wait_for_url("**/codex/cloud/settings/environment/create")
        page.locator(".csp-environment-editor").wait_for(state="visible")
        nested = page.evaluate("() => { const e = document.querySelector('.ccs-main'); return {clientWidth:e.clientWidth, scrollWidth:e.scrollWidth} }")
        assert nested["scrollWidth"] <= nested["clientWidth"] + 1, "environment editor overflows on mobile"
        page.locator(".csp-breadcrumb").get_by_role("button", name="环境").click()
        page.wait_for_url("**/codex/cloud/settings/environments")

        page.goto(f"{BASE_URL}/codex/cloud/settings/code-review", wait_until="networkidle")
        repo_cards = page.locator(".cssp-repo-mobile-card")
        if repo_cards.count():
            repo_cards.first.click()
            page.locator(".cssp-repository-detail").wait_for(state="visible")
            page.locator(".cssp-back-link").click()
            page.locator(".cssp-code-review-page").wait_for(state="visible")

        page.goto(f"{BASE_URL}/codex/cloud/settings/data", wait_until="networkidle")
        data_switches = page.locator('.cssp-data-page [role="switch"]:not([disabled])')
        if data_switches.count():
            before = data_switches.first.get_attribute("aria-checked")
            data_switches.first.click()
            assert data_switches.first.get_attribute("aria-checked") != before

        page.goto(f"{BASE_URL}/codex/cloud/settings/analytics", wait_until="networkidle")
        page.get_by_role("button", name="7天", exact=True).click()
        assert "is-active" in (page.get_by_role("button", name="7天", exact=True).get_attribute("class") or "")
        page.get_by_role("tab", name="代码审查").click()
        assert page.get_by_role("tab", name="代码审查").get_attribute("aria-selected") == "true"

        page.goto(f"{BASE_URL}/codex/cloud/settings/access-tokens", wait_until="networkidle")
        token_cards = page.locator(".cssp-token-mobile-card")
        if token_cards.count():
            token_cards.first.click()
            page.locator(".cssp-token-drawer").wait_for(state="visible")
            page.locator(".cssp-token-drawer").get_by_role("button", name="关闭").click()
        initial_token_count = page.locator(".cssp-token-mobile-card").count()
        page.get_by_role("button", name="创建", exact=True).first.click()
        token_modal = page.locator(".cssp-modal-layer")
        token_modal.wait_for(state="visible")
        token_modal.locator('input[placeholder="访问令牌"]').fill("移动端 QA")
        token_modal.get_by_role("button", name="创建", exact=True).click()
        token_modal.get_by_role("heading", name="复制访问令牌").wait_for(state="visible")
        token_modal.get_by_role("button", name="完成", exact=True).click()
        assert page.locator(".cssp-token-mobile-card").count() == initial_token_count + 1

        report["drawer"] = {"labels": drawer_labels, "geometry": drawer_geometry}
        report["consoleErrors"] = console_errors
        context.close()
        browser.close()

    (OUT / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    assert not console_errors, f"browser console errors: {console_errors}"
    print(json.dumps({"status": "passed", "routes": [slug for slug, _ in ROUTES], "drawer": report["drawer"], "output": str(OUT)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
