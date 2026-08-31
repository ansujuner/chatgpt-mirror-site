"""Use the currently signed-in ChatGPT browser session to send one message.

This talks only to the loopback WebBridge in ``edge_webbridge_server.py``.
It deliberately does not export or print cookies, sessionToken, or accessToken;
the ChatGPT page builds the current Sentinel/Conduit request chain itself.

Example:
    python tools/session_chat_call.py "请只回复：SESSION_CALL_OK"
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from typing import Any

import requests


DEFAULT_BRIDGE = "http://127.0.0.1:10086"


class BridgeError(RuntimeError):
    pass


class WebBridge:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")

    def status(self) -> dict[str, Any]:
        response = requests.get(f"{self.base_url}/status", timeout=10)
        response.raise_for_status()
        return response.json()

    def call(self, name: str, args: dict[str, Any], timeout: float = 120) -> Any:
        response = requests.post(
            f"{self.base_url}/call",
            json={"name": name, "args": args},
            timeout=timeout,
        )
        try:
            payload = response.json()
        except ValueError as exc:
            raise BridgeError(f"WebBridge returned HTTP {response.status_code}") from exc
        if not response.ok or not payload.get("ok"):
            raise BridgeError(payload.get("error") or f"HTTP {response.status_code}")
        return payload.get("data")

    def cdp(
        self, tab_id: int, method: str, params: dict[str, Any] | None = None
    ) -> Any:
        return self.call(
            "cdp",
            {"_tabId": tab_id, "method": method, "params": params or {}},
            timeout=180,
        )

    def evaluate(self, tab_id: int, expression: str) -> Any:
        result = self.cdp(
            tab_id,
            "Runtime.evaluate",
            {
                "expression": expression,
                "returnByValue": True,
                "awaitPromise": True,
                "userGesture": False,
            },
        )
        if result.get("exceptionDetails"):
            raise BridgeError(json.dumps(result["exceptionDetails"], ensure_ascii=False))
        return result.get("result", {}).get("value")


AUTH_AND_PAGE_STATE = r"""
(async () => {
  const response = await fetch('/api/auth/session', {
    credentials: 'include', cache: 'no-store'
  });
  let session = null;
  try { session = await response.json(); } catch (_) {}
  return {
    status: response.status,
    authenticated: !!(session && session.user && session.accessToken),
    ready: document.readyState,
    composer: !!document.querySelector('#prompt-textarea'),
    href: location.href
  };
})()
"""


COMPOSER_STATE = r"""
(() => {
  const composer = document.querySelector('#prompt-textarea');
  if (!composer) return {ok:false, reason:'composer-not-found'};
  composer.focus();
  const send = document.querySelector(
    '#composer-submit-button[data-testid="send-button"], button[data-testid="send-button"]'
  );
  let rect = null;
  if (send) {
    const r = send.getBoundingClientRect();
    rect = {x:r.left + r.width / 2, y:r.top + r.height / 2,
            width:r.width, height:r.height};
  }
  return {ok:true, send:!!send, rect, text:(composer.innerText || '').trim()};
})()
"""


ANSWER_STATE = r"""
(() => {
  const nodes = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
  const last = nodes.length ? nodes[nodes.length - 1] : null;
  const button = document.querySelector('#composer-submit-button') ||
                 document.querySelector('button[data-testid="stop-button"],button[data-testid="send-button"]');
  return {
    text: last ? (last.innerText || '').trim() : '',
    count: nodes.length,
    button: button ? button.getAttribute('data-testid') : null,
    href: location.href
  };
})()
"""


def wait_until(predicate, timeout: float, interval: float = 0.25) -> Any:
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        last = predicate()
        if last:
            return last
        time.sleep(interval)
    raise TimeoutError(f"operation timed out; last state: {last!r}")


def open_chatgpt(bridge: WebBridge) -> int:
    result = bridge.call("navigate", {"url": "https://chatgpt.com/"})
    tab_id = result.get("tabId") if isinstance(result, dict) else None
    if not isinstance(tab_id, int):
        raise BridgeError(f"navigate did not return a tab id: {result!r}")
    return tab_id


def wait_for_authenticated_composer(bridge: WebBridge, tab_id: int) -> None:
    def check() -> bool:
        try:
            state = bridge.evaluate(tab_id, AUTH_AND_PAGE_STATE)
            if state and state.get("status") == 200 and not state.get("authenticated"):
                raise BridgeError("ChatGPT page is not signed in")
            return bool(
                state
                and state.get("authenticated")
                and state.get("ready") == "complete"
                and state.get("composer")
            )
        except BridgeError:
            raise
        except Exception:
            return False

    wait_until(check, timeout=30, interval=0.5)


def insert_prompt(bridge: WebBridge, tab_id: int, prompt: str) -> None:
    bridge.evaluate(
        tab_id,
        """(() => {
          const el = document.querySelector('#prompt-textarea');
          if (!el) return false;
          el.focus();
          const s = getSelection();
          if (s) { const r = document.createRange(); r.selectNodeContents(el); s.removeAllRanges(); s.addRange(r); }
          return true;
        })()""",
    )
    # Trusted CDP keyboard events keep React/ProseMirror state in sync.
    bridge.cdp(
        tab_id,
        "Input.dispatchKeyEvent",
        {"type": "keyDown", "key": "Backspace", "code": "Backspace"},
    )
    bridge.cdp(
        tab_id,
        "Input.dispatchKeyEvent",
        {"type": "keyUp", "key": "Backspace", "code": "Backspace"},
    )
    bridge.cdp(tab_id, "Input.insertText", {"text": prompt})


def click_send(bridge: WebBridge, tab_id: int) -> None:
    state = wait_until(
        lambda: (
            value
            if (value := bridge.evaluate(tab_id, COMPOSER_STATE))
            and value.get("send")
            and value.get("rect")
            and value["rect"].get("width", 0) > 0
            else None
        ),
        timeout=15,
    )
    # The editor change above came from a trusted CDP Input event. Trigger the
    # page's own React submit handler directly; this proved more reliable than
    # viewport-coordinate mouse events across Edge display scaling settings.
    result = bridge.cdp(
        tab_id,
        "Runtime.evaluate",
        {
            "expression": """(() => {
              const b = document.querySelector(
                '#composer-submit-button[data-testid="send-button"], button[data-testid="send-button"]'
              );
              if (!b) return false;
              b.click();
              return true;
            })()""",
            "returnByValue": True,
            "awaitPromise": True,
            "userGesture": True,
        },
    )
    clicked = result.get("result", {}).get("value")
    if not clicked:
        raise BridgeError(f"send button disappeared before click: {state!r}")


def wait_for_answer(bridge: WebBridge, tab_id: int, timeout: float) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    last_text = ""
    stable_since: float | None = None
    last_state: dict[str, Any] = {}

    while time.monotonic() < deadline:
        state = bridge.evaluate(tab_id, ANSWER_STATE) or {}
        last_state = state
        text = state.get("text") or ""
        if text:
            if text != last_text:
                last_text = text
                stable_since = time.monotonic()
            elif stable_since is not None:
                stable_for = time.monotonic() - stable_since
                # Usually the button changes back to send-button. The stability
                # fallback handles UI builds where the stop button lingers.
                if state.get("button") != "stop-button" and stable_for >= 1.0:
                    return state
                if stable_for >= 4.0:
                    return state
        time.sleep(0.35)

    raise TimeoutError(
        f"answer timed out after {timeout:.0f}s; partial={last_text!r}; state={last_state!r}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Send a ChatGPT message using the currently signed-in Edge session."
    )
    parser.add_argument("prompt", help="message to send")
    parser.add_argument("--timeout", type=float, default=180, help="answer timeout in seconds")
    parser.add_argument("--bridge", default=DEFAULT_BRIDGE, help="loopback WebBridge URL")
    args = parser.parse_args()

    bridge = WebBridge(args.bridge)
    status = bridge.status()
    if not status.get("connected"):
        raise BridgeError(
            "WebBridge is not connected. Start tools/edge_webbridge_server.py "
            "and make sure the Edge extension is connected."
        )

    tab_id = open_chatgpt(bridge)
    wait_for_authenticated_composer(bridge, tab_id)
    insert_prompt(bridge, tab_id, args.prompt)
    click_send(bridge, tab_id)
    answer = wait_for_answer(bridge, tab_id, args.timeout)

    print(answer["text"])
    print(f"\n[conversation] {answer.get('href', '')}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (BridgeError, requests.RequestException, TimeoutError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
