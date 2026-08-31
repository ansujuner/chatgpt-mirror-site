from __future__ import annotations

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4173/qa/plus-conversation-fixture.html"
OUTPUT = ROOT / "qa" / "plus-conversation"
EDGE = Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")


def capture(page, name: str, width: int, height: int) -> dict:
    page.set_viewport_size({"width": width, "height": height})
    page.goto(URL, wait_until="networkidle")
    page.locator(".plus-turn-list").wait_for()
    metrics = page.evaluate(
        """() => {
          const box = (selector) => {
            const node = document.querySelector(selector)
            if (!node) return null
            const rect = node.getBoundingClientRect()
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          }
          return {
            viewport: { width: innerWidth, height: innerHeight },
            transcript: box('.plus-turn-list'),
            userBubble: box('.plus-turn-user .plus-turn-content'),
            assistant: box('.plus-turn-assistant .plus-turn-content'),
            assistantLogoCount: document.querySelectorAll('.plus-turn-assistant .plus-assistant-mark').length,
            actions: [...document.querySelectorAll('.plus-turn-action')].map((node) => {
              const rect = node.getBoundingClientRect()
              return { label: node.getAttribute('aria-label'), width: rect.width, height: rect.height }
            }),
            composer: box('.plus-conversation-dock .plus-composer'),
            dock: box('.plus-conversation-dock'),
            markdown: {
              strong: document.querySelectorAll('.plus-turn-markdown strong').length,
              list: document.querySelectorAll('.plus-turn-markdown ul').length,
              inlineCode: document.querySelectorAll('.plus-turn-markdown :not(pre) > code').length,
              codeBlock: document.querySelectorAll('.plus-turn-markdown pre code').length,
            },
          }
        }"""
    )
    page.screenshot(path=OUTPUT / f"{name}.png", full_page=False)
    page.locator(".plus-turn-action").first.click()
    page.wait_for_timeout(50)
    metrics["copyAction"] = page.evaluate(
        """() => ({
          label: document.querySelector('.plus-turn-action')?.getAttribute('aria-label'),
          text: window.__plusFixtureCopiedText,
        })"""
    )
    return metrics


OUTPUT.mkdir(parents=True, exist_ok=True)
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        executable_path=str(EDGE) if EDGE.exists() else None,
        headless=True,
    )
    page = browser.new_page()
    page.add_init_script(
        """Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: async (text) => { window.__plusFixtureCopiedText = text } },
        })"""
    )
    report = {
        "desktop": capture(page, "desktop-1920x1080", 1920, 1080),
        "mobile": capture(page, "mobile-390x844", 390, 844),
    }
    browser.close()

(OUTPUT / "metrics.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, ensure_ascii=False, indent=2))
