#!/usr/bin/env python3
"""Final, reproducible QA for the local authenticated Plus settings replica.

The test opens only ``http://127.0.0.1:5173`` in a fresh headless Chromium
context. It does not read a real browser profile, cookies, storage, or any
authenticated ChatGPT state. Runtime expectations are derived from the
sanitised evidence in ``qa/auth-capture``.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit

from playwright.sync_api import Browser, Locator, Page, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "qa" / "local-settings"
BASE_URL = "http://127.0.0.1:5173"


TABS: list[dict[str, Any]] = [
    {
        "id": "general", "label": "常规", "title": "常规", "hash": "#settings", "evidence": "general",
        "keys": ["外观", "对比度", "强调色", "语言", "更强智能", "启用听写"],
    },
    {
        "id": "notifications", "label": "通知", "title": "通知", "hash": "#settings/Notifications", "evidence": "notifications",
        "keys": ["Codex", "个性化提示", "任务", "使用情况", "健康", "回复", "群聊", "营销", "项目"],
    },
    {
        "id": "personalization", "label": "个性化", "title": "个性化", "hash": "#settings/Personalization", "evidence": "personalization",
        "keys": ["基本风格和语调", "特征", "快速回答", "建议提示", "自定义指令", "宠物", "关于你", "记忆", "录音模式", "高级"],
    },
    {
        "id": "plugins", "label": "插件", "title": "插件", "hash": "#settings/Plugins", "evidence": "plugins",
        "keys": ["管理已安装的插件", "权限", "允许低风险", "Deep Research", "Default templates", "Documents", "GitHub", "PDF", "Plugin Management", "Presentations", "Spreadsheets", "Template Creator", "浏览插件", "开发者模式"],
    },
    {
        "id": "voice", "label": "语音", "title": "语音", "hash": "#settings/Voice", "evidence": "voice",
        "keys": ["Cove", "沉稳直率", "模型", "Live", "智能", "高", "语言", "自动检测"],
    },
    {
        "id": "billing", "label": "账单", "title": "账单", "hash": "#settings/Billing", "evidence": "billing",
        "keys": ["ChatGPT Plus", "自动续订", "升级", "交易记录", "已支付", "账单信息", "付款方式", "取消套餐"],
    },
    {
        "id": "usage", "label": "使用情况", "title": "用量", "hash": "#settings/Usage", "evidence": "usage",
        "keys": ["套餐限额", "5 小时限额", "每周限额", "使用限额重置", "使用重置次数", "额度", "自动充值", "赠送额度"],
    },
    {
        "id": "analytics", "label": "分析", "title": "分析", "hash": "#settings/Analytics", "evidence": "analytics",
        "keys": ["使用历史", "7 天", "30 天", "产品活动", "工具活动"],
    },
    {
        "id": "data", "label": "数据管理", "title": "数据管理", "hash": "#settings/DataControls", "evidence": "data-controls",
        "keys": ["为所有用户改进模型", "位置", "与应用共享的信息", "工作网络访问", "重置 ChatGPT Work", "共享链接", "已归档的聊天", "归档所有聊天", "删除所有聊天", "导出数据"],
    },
    {
        "id": "cloud-browser", "label": "云浏览器", "title": "云浏览器", "hash": "#settings/CloudBrowser", "evidence": "cloud-browser",
        "keys": ["默认权限", "始终询问", "站点权限", "添加站点", "浏览器数据", "Cookie"],
    },
    {
        "id": "storage", "label": "存储空间", "title": "存储空间", "hash": "#settings/Storage", "evidence": "storage",
        "keys": ["已使用 490 MB，共 20 GB", "管理存储空间", "文件", "165 MB • 2 个文件", "图片", "325 MB • 219 张图片"],
    },
    {
        "id": "safety", "label": "安全防护", "title": "安全防护", "hash": "#settings/SafetySettings", "evidence": "safety",
        "keys": ["减少敏感内容", "针对敏感话题添加额外防护", "了解更多"],
    },
    {
        "id": "security", "label": "账户安全与登录", "title": "账户安全与登录", "hash": "#settings/Security", "evidence": "security",
        "keys": ["密码", "安全密钥和通行密钥", "多因素身份验证 (MFA)", "Authenticator app", "Text message", "活跃会话", "高级账户安全", "锁定模式", "开发人员模式", "在开发者模式下强制执行 CSP", "通过 ChatGPT 安全登录", "为 Codex 启用设备代码授权"],
    },
    {
        "id": "parental", "label": "家长控制", "title": "家长控制", "hash": "#settings/ParentalControls", "evidence": "parental-controls",
        "keys": ["家长和青少年可以关联账户", "了解更多", "添加家庭成员"],
    },
    {
        "id": "trusted-contacts", "label": "受信任联系人", "title": "受信任联系人", "hash": "#settings/Safety", "evidence": "trusted-contacts",
        "keys": ["安排一位受信任联系人", "严重的安全风险", "了解更多", "添加联系人"],
    },
    {
        "id": "account", "label": "账户", "title": "账户", "hash": "#settings/Account", "evidence": "account",
        "keys": ["姓名", "用户名", "电子邮件", "删除账户", "GPT 构建者个人资料"],
    },
    {
        "id": "shortcuts", "label": "快捷键", "title": "快捷键", "hash": "#settings/Keyboard", "evidence": "keyboard",
        "keys": ["要更改快捷键", "输入框", "发送消息或停止生成", "在后台发送消息", "选择模型", "切换听写", "添加照片和文件", "应用", "打开新聊天", "显示快捷键", "搜索", "切换开发模式", "切换侧边栏", "设置自定义指令", "复制最后一个代码块", "删除聊天", "恢复默认"],
    },
]


BACK_PANEL_ACTIONS: dict[str, tuple[str, str]] = {
    "billing": (".csp-upgrade", "已打开升级套餐"),
    "usage": (".csp-usage-alert .csp-inline-link", "已打开添加额度"),
    "analytics": (".csp-analytics-section:first-child .csp-segmented button:nth-child(2)", "已切换为 30 天"),
    "data": (".csp-data .csp-disclosure-hit", "为所有用户改进模型"),
    "cloud-browser": (".csp-cloud .csp-pill", "已打开添加站点"),
    "storage": (".csp-storage-management > button", "已打开文件存储管理"),
    "safety": (".csp-safety [role='switch']", "减少敏感内容"),
    "security": (".csp-security .csp-disclosure-hit", "已打开密码设置"),
    "parental": (".csp-simple-info .csp-add-button", "已打开添加家庭成员"),
    "trusted-contacts": (".csp-trusted .csp-add-button", "已打开添加受信任联系人"),
    "account": (".csp-account .csp-disclosure-hit", "已打开用户名设置"),
    "shortcuts": (".csp-shortcuts [role='switch']", "发送消息或停止生成"),
}


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def normalise(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("\u00a0", " ")).strip()


def current_hash(page: Page) -> str:
    fragment = urlsplit(page.url).fragment
    return f"#{fragment}" if fragment else ""


class QAReport:
    def __init__(self) -> None:
        self.started = now_iso()
        self.checks: list[dict[str, Any]] = []
        self.console_errors: list[dict[str, Any]] = []
        self.page_errors: list[dict[str, Any]] = []
        self.request_failures: list[dict[str, Any]] = []
        self.http_errors: list[dict[str, Any]] = []
        self.screenshots: list[str] = []
        self.scenario_failures: list[dict[str, str]] = []

    def check(self, scenario: str, name: str, passed: bool, **details: Any) -> bool:
        row: dict[str, Any] = {"scenario": scenario, "name": name, "passed": bool(passed)}
        if details:
            row["details"] = details
        self.checks.append(row)
        return bool(passed)

    def fail_scenario(self, scenario: str, exc: BaseException) -> None:
        error = f"{type(exc).__name__}: {exc}"
        self.scenario_failures.append({"scenario": scenario, "error": error})
        self.check(scenario, "场景执行无异常", False, error=error)

    def attach_page_diagnostics(self, page: Page, scenario: str) -> None:
        def on_console(message: Any) -> None:
            if message.type == "error":
                self.console_errors.append({"scenario": scenario, "type": message.type, "text": message.text, "url": page.url})

        def on_failed(request: Any) -> None:
            if request.url.startswith(BASE_URL):
                self.request_failures.append({"scenario": scenario, "url": request.url, "method": request.method, "failure": request.failure})

        def on_response(response: Any) -> None:
            if response.url.startswith(BASE_URL) and response.status >= 400:
                self.http_errors.append({"scenario": scenario, "url": response.url, "status": response.status})

        page.on("console", on_console)
        page.on("pageerror", lambda error: self.page_errors.append({"scenario": scenario, "text": str(error), "url": page.url}))
        page.on("requestfailed", on_failed)
        page.on("response", on_response)

    def screenshot(self, page: Page, filename: str) -> None:
        path = OUT_DIR / filename
        page.screenshot(path=str(path), full_page=False, animations="disabled")
        self.screenshots.append(str(path.relative_to(ROOT)).replace("\\", "/"))

    def finalise(self) -> dict[str, Any]:
        self.check("diagnostics", "无 console.error", not self.console_errors, count=len(self.console_errors))
        self.check("diagnostics", "无未捕获 pageerror", not self.page_errors, count=len(self.page_errors))
        self.check("diagnostics", "无失败的本地请求", not self.request_failures, count=len(self.request_failures))
        self.check("diagnostics", "无本地 HTTP 4xx/5xx", not self.http_errors, count=len(self.http_errors))
        passed = sum(1 for row in self.checks if row["passed"])
        failed = len(self.checks) - passed
        return {
            "meta": {
                "base_url": BASE_URL,
                "started_at": self.started,
                "finished_at": now_iso(),
                "desktop_viewport": {"width": 1536, "height": 744},
                "mobile_viewport": {"width": 390, "height": 844},
                "tabs": len(TABS),
                "evidence": ["qa/auth-capture/tabs-summary.md", "qa/auth-capture/panel-texts.md", "qa/auth-capture/mobile-summary.md"],
            },
            "summary": {
                "passed": passed,
                "failed": failed,
                "total": len(self.checks),
                "matrix_screenshots": len(self.screenshots),
                "desktop_screenshots": sum("/desktop-" in f"/{path}" for path in self.screenshots),
                "mobile_screenshots": sum("/mobile-" in f"/{path}" for path in self.screenshots),
                "scenario_exceptions": len(self.scenario_failures),
            },
            "checks": self.checks,
            "console_errors": self.console_errors,
            "page_errors": self.page_errors,
            "request_failures": self.request_failures,
            "http_errors": self.http_errors,
            "scenario_failures": self.scenario_failures,
            "screenshots": self.screenshots,
        }


def run_scenario(report: QAReport, scenario: str, fn: Callable[[], None]) -> None:
    try:
        fn()
    except BaseException as exc:
        report.fail_scenario(scenario, exc)


def wait_for_dialog(page: Page) -> Locator:
    page.wait_for_selector('.ps-layer[data-state="open"] .ps-dialog[aria-hidden="false"]', state="visible", timeout=10_000)
    page.wait_for_timeout(280)
    return page.locator(".ps-dialog")


def open_settings(page: Page, fragment: str = "#settings", query: str = "") -> Locator:
    page.goto(f"{BASE_URL}/{query}{fragment}", wait_until="domcontentloaded", timeout=15_000)
    return wait_for_dialog(page)


def selected_tab_ids(dialog: Locator) -> list[str | None]:
    return dialog.locator('.ps-nav [role="tab"][aria-selected="true"]').evaluate_all(
        "els => els.map(el => el.getAttribute('data-settings-tab'))"
    )


def active_state_tab_ids(dialog: Locator) -> list[str | None]:
    return dialog.locator('.ps-nav [role="tab"][data-state="active"]').evaluate_all(
        "els => els.map(el => el.getAttribute('data-settings-tab'))"
    )


def overflow_metrics(page: Page) -> dict[str, Any]:
    return page.evaluate(
        """() => {
          const dialog = document.querySelector('.ps-dialog');
          const content = document.querySelector('.ps-content');
          const scroll = document.querySelector('.ps-content-scroll');
          const metric = (el) => el ? ({clientWidth: el.clientWidth, scrollWidth: el.scrollWidth}) : null;
          return {
            viewport: innerWidth,
            document: metric(document.documentElement),
            body: metric(document.body),
            dialog: metric(dialog),
            content: metric(content),
            contentScroll: metric(scroll),
          };
        }"""
    )


def no_horizontal_overflow(metrics: dict[str, Any]) -> bool:
    for key in ("document", "body", "dialog", "content", "contentScroll"):
        item = metrics.get(key)
        if item and item["scrollWidth"] > item["clientWidth"] + 1:
            return False
    return True


def evidence_preflight(report: QAReport) -> None:
    scenario = "evidence preflight"
    required = [
        ROOT / "qa" / "auth-capture" / "tabs-summary.md",
        ROOT / "qa" / "auth-capture" / "panel-texts.md",
        ROOT / "qa" / "auth-capture" / "mobile-summary.md",
    ]
    required.extend(ROOT / "qa" / "auth-capture" / "tabs" / f"{tab['evidence']}.png" for tab in TABS)
    required.extend(ROOT / "qa" / "auth-capture" / "mobile" / f"{tab['evidence']}.png" for tab in TABS)
    missing = [str(path.relative_to(ROOT)).replace("\\", "/") for path in required if not path.is_file()]
    report.check(scenario, "桌面/手机权威证据文件齐全", not missing, expected=len(required), missing=missing)


def desktop_matrix(browser: Browser, report: QAReport) -> None:
    scenario = "desktop 17-tab matrix"
    context = browser.new_context(viewport={"width": 1536, "height": 744}, device_scale_factor=1, color_scheme="light", locale="zh-CN")
    page = context.new_page()
    report.attach_page_diagnostics(page, scenario)
    try:
        dialog = open_settings(page, "#settings", "?qa=desktop-matrix")
        tabs = dialog.locator('.ps-nav [role="tab"][data-settings-tab]')
        report.check(scenario, "共有 17 个可点击标签", tabs.count() == 17, actual=tabs.count())
        rect = dialog.bounding_box() or {}
        geometry_ok = all([
            abs(rect.get("x", -999) - 428) <= 1.1,
            abs(rect.get("y", -999) - 64) <= 1.1,
            abs(rect.get("width", -999) - 680) <= 1.1,
            abs(rect.get("height", -999) - 600) <= 1.1,
        ])
        report.check(scenario, "桌面对话框为 680×600 且位于 (428,64)", geometry_ok, rect=rect)

        for index, tab in enumerate(TABS):
            try:
                target = dialog.locator(f'[data-settings-tab="{tab["id"]}"]')
                target.click(timeout=4_000)
                page.wait_for_timeout(120)
                selected = selected_tab_ids(dialog)
                active = active_state_tab_ids(dialog)
                title = normalise(dialog.locator(".ps-content-header h2").inner_text())
                panel = dialog.locator('[role="tabpanel"]')
                panel_text = normalise(dialog.locator(".ps-content").inner_text())
                missing_keys = [key for key in tab["keys"] if normalise(key) not in panel_text]
                metrics = overflow_metrics(page)

                report.check(scenario, f'{tab["id"]}: Hash 与权威路由一致', current_hash(page) == tab["hash"], expected=tab["hash"], actual=current_hash(page))
                report.check(scenario, f'{tab["id"]}: aria-selected 唯一', selected == [tab["id"]], selected=selected)
                report.check(scenario, f'{tab["id"]}: data-state=active 唯一且与 aria-selected 同一元素', active == selected == [tab["id"]], active=active, selected=selected)
                report.check(scenario, f'{tab["id"]}: 目标 tabpanel 可见', panel.is_visible(), visible=panel.is_visible())
                report.check(scenario, f'{tab["id"]}: 主标题与采集一致', title == tab["title"], expected=tab["title"], actual=title)
                report.check(scenario, f'{tab["id"]}: 关键文案与 panel-texts 一致', not missing_keys, missing=missing_keys)
                report.check(scenario, f'{tab["id"]}: 无页面/对话框/内容横向溢出', no_horizontal_overflow(metrics), metrics=metrics)
                report.screenshot(page, f'desktop-{index:02d}-{tab["evidence"]}.png')
            except BaseException as exc:
                report.check(scenario, f'{tab["id"]}: 标签完整执行', False, error=f"{type(exc).__name__}: {exc}")
                try:
                    report.screenshot(page, f'desktop-{index:02d}-{tab["evidence"]}.png')
                except BaseException:
                    pass
    finally:
        context.close()


def mobile_matrix(browser: Browser, report: QAReport) -> None:
    scenario = "mobile 17-tab matrix"
    context = browser.new_context(
        viewport={"width": 390, "height": 844},
        screen={"width": 390, "height": 844},
        device_scale_factor=1,
        is_mobile=True,
        has_touch=True,
        color_scheme="light",
        locale="zh-CN",
    )
    page = context.new_page()
    report.attach_page_diagnostics(page, scenario)
    try:
        dialog = open_settings(page, "#settings", "?qa=mobile-matrix")
        nav = dialog.locator(".ps-nav")
        search = dialog.locator('.ps-search input[aria-label="搜索设置"]')
        tabs = nav.locator('[role="tab"][data-settings-tab]')
        report.check(scenario, "共有 17 个横向标签", tabs.count() == 17, actual=tabs.count())
        report.check(scenario, "设置标题、搜索框、横向标签和内容同时可见", all([
            dialog.locator(".ps-sidebar-topbar h2").is_visible(), search.is_visible(), nav.is_visible(), dialog.locator('[role="tabpanel"]').is_visible(),
        ]))

        shell = page.evaluate(
            """() => {
              const dialog = document.querySelector('.ps-dialog');
              const nav = document.querySelector('.ps-nav');
              const dr = dialog.getBoundingClientRect();
              const ns = getComputedStyle(nav);
              const ds = getComputedStyle(dialog);
              return {
                dialog: {x: dr.x, y: dr.y, width: dr.width, height: dr.height, bottom: dr.bottom},
                radius: ds.borderRadius,
                navDisplay: ns.display,
                overflowX: ns.overflowX,
                oldBackCount: document.querySelectorAll('.ps-mobile-back').length,
                mobileDetailAttribute: dialog.getAttribute('data-mobile-detail'),
              };
            }"""
        )
        shell_ok = (
            abs(shell["dialog"]["x"] - 10) <= 0.7
            and abs(shell["dialog"]["width"] - 370) <= 1
            and 506 <= shell["dialog"]["height"] <= 718
            and 0 <= shell["dialog"]["y"]
            and shell["dialog"]["bottom"] <= 844.5
            and shell["radius"] == "16px"
            and shell["navDisplay"] == "flex"
            and shell["overflowX"] in {"auto", "scroll"}
        )
        report.check(scenario, "当前圆角 modal 几何与横向导航模式正确", shell_ok, shell=shell)
        report.check(scenario, "不存在旧版 back/list 或 data-mobile-detail", shell["oldBackCount"] == 0 and shell["mobileDetailAttribute"] is None, shell=shell)

        for index, tab in enumerate(TABS):
            try:
                target = nav.locator(f'[data-settings-tab="{tab["id"]}"]')
                # DOM click avoids Playwright auto-scrolling; selected-tab
                # visibility must therefore come from the app itself.
                target.evaluate("el => el.click()")
                page.wait_for_timeout(150)
                selected = selected_tab_ids(dialog)
                active = active_state_tab_ids(dialog)
                title = normalise(dialog.locator(".ps-content-header h2").inner_text())
                panel_text = normalise(dialog.locator(".ps-content").inner_text())
                missing_keys = [key for key in tab["keys"] if normalise(key) not in panel_text]
                visibility = page.evaluate(
                    """(id) => {
                      const nav = document.querySelector('.ps-nav');
                      const tab = nav.querySelector(`[data-settings-tab="${id}"]`);
                      const nr = nav.getBoundingClientRect();
                      const tr = tab.getBoundingClientRect();
                      return {
                        navLeft: nr.left, navRight: nr.right,
                        tabLeft: tr.left, tabRight: tr.right,
                        scrollLeft: nav.scrollLeft, scrollWidth: nav.scrollWidth, clientWidth: nav.clientWidth,
                        visible: tr.left >= nr.left - 1 && tr.right <= nr.right + 1,
                      };
                    }""",
                    tab["id"],
                )
                metrics = overflow_metrics(page)

                report.check(scenario, f'{tab["id"]}: Hash 与权威路由一致', current_hash(page) == tab["hash"], expected=tab["hash"], actual=current_hash(page))
                report.check(scenario, f'{tab["id"]}: aria-selected 唯一', selected == [tab["id"]], selected=selected)
                report.check(scenario, f'{tab["id"]}: data-state=active 唯一且与 aria-selected 同一元素', active == selected == [tab["id"]], active=active, selected=selected)
                report.check(scenario, f'{tab["id"]}: 主标题与采集一致', title == tab["title"], expected=tab["title"], actual=title)
                report.check(scenario, f'{tab["id"]}: 关键文案与 panel-texts 一致', not missing_keys, missing=missing_keys)
                report.check(scenario, f'{tab["id"]}: 选中标签由应用自动滚入可见区', visibility["visible"], geometry=visibility)
                report.check(scenario, f'{tab["id"]}: 无页面级或内容级横向溢出', no_horizontal_overflow(metrics), metrics=metrics)
                report.screenshot(page, f'mobile-{index:02d}-{tab["evidence"]}.png')

                if tab["id"] == "shortcuts":
                    scroll = dialog.locator(".ps-content-scroll")
                    scroll.evaluate("el => { el.scrollTop = el.scrollHeight; }")
                    page.wait_for_timeout(120)
                    sticky = page.evaluate(
                        """() => {
                          const scroll = document.querySelector('.ps-content-scroll');
                          const footer = document.querySelector('.csp-shortcut-footer');
                          const button = footer?.querySelector('button');
                          if (!scroll || !footer || !button) return null;
                          const sr = scroll.getBoundingClientRect();
                          const fr = footer.getBoundingClientRect();
                          const br = button.getBoundingClientRect();
                          return {
                            position: getComputedStyle(footer).position,
                            scrollTop: scroll.scrollTop,
                            scrollMax: scroll.scrollHeight - scroll.clientHeight,
                            scrollBottom: sr.bottom,
                            footerTop: fr.top,
                            footerBottom: fr.bottom,
                            intersectsBottom: fr.top < sr.bottom && fr.bottom >= sr.bottom - 1,
                            buttonVisible: br.top < sr.bottom && br.bottom > sr.top,
                          };
                        }"""
                    )
                    report.check(scenario, "shortcuts: Keyboard 恢复默认底栏为 sticky 且在滚动底部可见", bool(sticky and sticky["position"] == "sticky" and sticky["intersectsBottom"] and sticky["buttonVisible"]), sticky=sticky)
            except BaseException as exc:
                report.check(scenario, f'{tab["id"]}: 标签完整执行', False, error=f"{type(exc).__name__}: {exc}")
                try:
                    report.screenshot(page, f'mobile-{index:02d}-{tab["evidence"]}.png')
                except BaseException:
                    pass
    finally:
        context.close()


def critical_interactions(browser: Browser, report: QAReport) -> None:
    scenario = "critical interactions"
    context = browser.new_context(viewport={"width": 1536, "height": 744}, device_scale_factor=1, color_scheme="light", locale="zh-CN")
    page = context.new_page()
    report.attach_page_diagnostics(page, scenario)
    try:
        dialog = open_settings(page, "#settings", "?qa=interactions")

        smarter = dialog.get_by_role("switch", name="更强智能")
        before = smarter.is_checked()
        smarter.click(force=True)
        page.wait_for_timeout(130)
        after = smarter.is_checked()
        report.check(scenario, "General toggle 改变 checked 状态", after is (not before), before=before, after=after)
        smarter.click(force=True)

        appearance = dialog.locator('button.ps-select-wrap[aria-label="外观"]')
        appearance.click()
        menu = page.locator('.ps-select-menu[aria-label="外观"][data-state="open"]')
        menu.wait_for(state="visible", timeout=2_000)
        report.check(scenario, "Select 打开后具备 listbox/expanded 语义", appearance.get_attribute("aria-expanded") == "true" and menu.get_attribute("role") == "listbox")
        menu.get_by_role("option", name="深色", exact=True).click()
        page.wait_for_function("() => document.querySelector('.ps-layer')?.getAttribute('data-resolved-theme') === 'dark'", timeout=2_000)
        report.check(scenario, "Select 选项更新值与主题", normalise(appearance.inner_text()) == "深色" and page.locator(".ps-layer").get_attribute("data-resolved-theme") == "dark", value=normalise(appearance.inner_text()), theme=page.locator(".ps-layer").get_attribute("data-resolved-theme"))
        appearance.click()
        page.locator('.ps-select-menu[aria-label="外观"][data-state="open"]').get_by_role("option", name="浅色", exact=True).click()
        page.wait_for_function("() => document.querySelector('.ps-layer')?.getAttribute('data-resolved-theme') === 'light'", timeout=2_000)
        report.check(scenario, "Select 可再次关闭并恢复浅色", appearance.get_attribute("aria-expanded") == "false" and normalise(appearance.inner_text()) == "浅色")

        dialog.locator('[data-settings-tab="voice"]').click()
        page.wait_for_timeout(100)
        voice_before = normalise(dialog.locator(".ps-voice-name").inner_text())
        dialog.locator('button[aria-label="下一个语音"]').click()
        page.wait_for_timeout(190)
        voice_after = normalise(dialog.locator(".ps-voice-name").inner_text())
        checked_voices = dialog.locator('.ps-voice-dots [role="radio"][aria-checked="true"]').count()
        report.check(scenario, "Voice 下一项切换名称且保持唯一选中", voice_after != voice_before and checked_voices == 1, before=voice_before, after=voice_after, checked=checked_voices)
        cove = dialog.locator('.ps-voice-dots [role="radio"][aria-label="Cove"]')
        cove.click()
        page.wait_for_timeout(170)
        report.check(scenario, "Voice 圆点可直接切回 Cove", normalise(dialog.locator(".ps-voice-name").inner_text()) == "Cove" and cove.get_attribute("aria-checked") == "true")

        toast = dialog.locator(".ps-toast")
        for tab_id, (selector, expected) in BACK_PANEL_ACTIONS.items():
            dialog.locator(f'[data-settings-tab="{tab_id}"]').click()
            page.wait_for_timeout(80)
            action = dialog.locator(selector).first
            action.click(timeout=3_000)
            page.wait_for_function(
                "expected => document.querySelector('.ps-toast.is-visible')?.textContent?.includes(expected)",
                arg=expected,
                timeout=2_000,
            )
            text = normalise(toast.inner_text())
            report.check(scenario, f"{tab_id}: 关键按钮触发 toast/状态", expected in text, expected=expected, actual=text)

        # Regression for the formerly nested-button Location disclosure:
        # both the row-wide action and its independent inline help control must
        # remain semantic/actionable without emitting React DOM warnings.
        dialog.locator('[data-settings-tab="data"]').click()
        page.wait_for_timeout(80)
        location = dialog.locator(".csp-data .csp-disclosure").nth(1)
        location_main = location.locator(".csp-disclosure-hit")
        location_main.click()
        page.wait_for_function(
            "() => document.querySelector('.ps-toast.is-visible')?.textContent?.includes('已启用位置')",
            timeout=2_000,
        )
        report.check(
            scenario,
            "Data 位置 disclosure 主按钮可切换状态",
            "已启用" in (location_main.get_attribute("aria-label") or "") and "已启用位置" in normalise(toast.inner_text()),
            aria_label=location_main.get_attribute("aria-label"),
            toast=normalise(toast.inner_text()),
        )
        location.locator(".csp-inline-link").click()
        page.wait_for_function(
            "() => document.querySelector('.ps-toast.is-visible')?.textContent?.includes('已打开位置信息说明')",
            timeout=2_000,
        )
        report.check(
            scenario,
            "Data 位置“了解更多”为独立可用按钮",
            "已打开位置信息说明" in normalise(toast.inner_text()),
            toast=normalise(toast.inner_text()),
        )

        search = dialog.locator('.ps-search input[aria-label="搜索设置"]')
        search.fill("插件")
        page.wait_for_timeout(80)
        ids = dialog.locator('.ps-nav [data-settings-tab]').evaluate_all("els => els.map(el => el.dataset.settingsTab)")
        report.check(scenario, "搜索过滤为唯一插件标签", ids == ["plugins"], actual=ids)
        dialog.locator('[data-settings-tab="plugins"]').click()
        report.check(scenario, "搜索结果仍可直接切换页面", current_hash(page) == "#settings/Plugins", actual=current_hash(page))
        dialog.locator('.ps-search button[aria-label="清除搜索"]').click()
        page.wait_for_timeout(80)
        report.check(scenario, "清除搜索恢复 17 个标签", dialog.locator('.ps-nav [data-settings-tab]').count() == 17)
    finally:
        context.close()


def escape_and_history(browser: Browser, report: QAReport) -> None:
    scenario = "Escape and browser Back"
    context = browser.new_context(viewport={"width": 1536, "height": 744}, device_scale_factor=1, color_scheme="light", locale="zh-CN")
    page = context.new_page()
    report.attach_page_diagnostics(page, scenario)
    try:
        dialog = open_settings(page, "#settings", "?qa=history")
        dialog.locator('[data-settings-tab="notifications"]').click()
        page.wait_for_timeout(100)
        report.check(scenario, "切换标签建立可回退的设置历史", current_hash(page) == "#settings/Notifications", actual=current_hash(page))

        page.keyboard.press("Escape")
        page.wait_for_selector(".ps-dialog", state="detached", timeout=3_000)
        report.check(scenario, "Escape 关闭弹窗并清除 hash", current_hash(page) == "" and page.locator(".ps-dialog").count() == 0, actual_hash=current_hash(page))

        page.go_back(wait_until="domcontentloaded", timeout=5_000)
        restored = wait_for_dialog(page)
        selected = selected_tab_ids(restored)
        report.check(scenario, "浏览器 Back 恢复前一设置标签", current_hash(page) == "#settings" and selected == ["general"], actual_hash=current_hash(page), selected=selected)
    finally:
        context.close()


def write_reports(payload: dict[str, Any]) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "report.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    summary = payload["summary"]
    lines = [
        "# 本地 Plus 设置最终 QA",
        "",
        f"- 测试地址：`{payload['meta']['base_url']}`（仅本地）",
        "- 桌面视口：`1536×744`；手机视口：`390×844`",
        f"- 结果：**{summary['passed']} 通过 / {summary['failed']} 失败 / {summary['total']} 总计**",
        f"- 矩阵截图：**{summary['matrix_screenshots']}**（桌面 {summary['desktop_screenshots']} + 手机 {summary['mobile_screenshots']}）",
        f"- Console error：**{len(payload['console_errors'])}**；Page error：**{len(payload['page_errors'])}**；失败请求：**{len(payload['request_failures'])}**；HTTP 4xx/5xx：**{len(payload['http_errors'])}**",
        "",
        "## 场景汇总",
        "",
        "| 场景 | 通过 | 失败 |",
        "|---|---:|---:|",
    ]
    scenarios = sorted({row["scenario"] for row in payload["checks"]})
    for scenario in scenarios:
        rows = [row for row in payload["checks"] if row["scenario"] == scenario]
        lines.append(f"| {scenario} | {sum(row['passed'] for row in rows)} | {sum(not row['passed'] for row in rows)} |")

    failed = [row for row in payload["checks"] if not row["passed"]]
    lines.extend(["", "## 精确失败项", ""])
    if failed:
        for row in failed:
            details = json.dumps(row.get("details", {}), ensure_ascii=False)
            lines.append(f"- **{row['scenario']}** — {row['name']}：`{details}`")
    else:
        lines.append("无。")

    lines.extend([
        "",
        "## 覆盖范围",
        "",
        "- 桌面 17/17：可点击、唯一且同元素的 `aria-selected=true` / `data-state=active`、权威 Hash、标题、关键文案、无横向溢出。",
        "- 手机 17/17：圆角 modal、搜索框、横向标签、唯一且同元素的选中状态、无旧 back/list、自动滚入可见、无页面/内容横溢。",
        "- Keyboard：滚动到底后验证 `sticky` 恢复默认底栏。",
        "- 交互：General toggle、Select 打开/选择/关闭、Voice 箭头与圆点、后 12 页每页一个 toast/状态动作。",
        "- 历史：Escape 清除 Hash 并关闭；浏览器 Back 恢复上一设置标签。",
        "- 诊断：console、pageerror、失败请求、本地 HTTP 4xx/5xx。",
        "",
        "机器可读明细见 [`report.json`](./report.json)。",
        "",
    ])
    (OUT_DIR / "report.md").write_text("\n".join(lines), encoding="utf-8")


def clean_previous_matrix_screenshots() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for pattern in ("desktop-*.png", "mobile-*.png"):
        for path in OUT_DIR.glob(pattern):
            if path.is_file():
                path.unlink()


def main() -> int:
    clean_previous_matrix_screenshots()
    report = QAReport()
    evidence_preflight(report)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        run_scenario(report, "desktop 17-tab matrix", lambda: desktop_matrix(browser, report))
        run_scenario(report, "mobile 17-tab matrix", lambda: mobile_matrix(browser, report))
        run_scenario(report, "critical interactions", lambda: critical_interactions(browser, report))
        run_scenario(report, "Escape and browser Back", lambda: escape_and_history(browser, report))
        browser.close()

    payload = report.finalise()
    write_reports(payload)
    summary = payload["summary"]
    print(f"local-settings QA: {summary['passed']} passed, {summary['failed']} failed, {summary['matrix_screenshots']} matrix screenshots")
    print(str((OUT_DIR / "report.md").relative_to(ROOT)))
    return 0 if summary["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
