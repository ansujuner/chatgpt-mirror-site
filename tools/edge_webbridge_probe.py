"""Non-destructive probe for the already-installed Kimi WebBridge extension.

The extension initiates the loopback WebSocket connection.  This script never
opens Edge's profile database and never requests cookies.  It attaches only to
the active chatgpt.com tab, evaluates a small DOM summary, then detaches by
exiting.
"""

from __future__ import annotations

import asyncio
import json
import sys
import uuid

import websockets


async def probe(socket: websockets.ServerConnection) -> None:
    hello = json.loads(await asyncio.wait_for(socket.recv(), timeout=40))
    if hello.get("type") != "hello":
        raise RuntimeError(f"unexpected first message: {hello!r}")
    print(json.dumps({"connected": True, "hello": hello}, ensure_ascii=False))
    await socket.send(json.dumps({"type": "hello_ack"}))

    async def call(name: str, args: dict) -> dict:
        request_id = uuid.uuid4().hex
        await socket.send(
            json.dumps(
                {
                    "type": "tool_call",
                    "requestId": request_id,
                    "payload": {"name": name, "args": args},
                }
            )
        )
        while True:
            message = json.loads(await asyncio.wait_for(socket.recv(), timeout=20))
            if (
                message.get("type") == "tool_result"
                and message.get("responseToRequestId") == request_id
            ):
                payload = message.get("payload", {})
                if payload.get("error"):
                    raise RuntimeError(payload["error"])
                return payload.get("data", {})

    tab = await call("find_tab", {"url": "chatgpt.com", "active": True})
    tab_id = tab["tabId"]
    # DOM-only verification.  Deliberately excludes cookies/storage/tokens.
    expression = """(() => ({
      href: location.href,
      title: document.title,
      lang: document.documentElement.lang,
      bodyClass: document.body.className,
      dialogs: [...document.querySelectorAll('[role=dialog]')].map(x => ({
        text: (x.innerText || '').slice(0, 500),
        rect: (() => { const r=x.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()
      })),
      buttons: [...document.querySelectorAll('button')].slice(0, 30).map(x => ({
        text: (x.innerText || '').trim().slice(0, 80),
        aria: x.getAttribute('aria-label')
      }))
    }))()"""
    result = await call(
        "cdp",
        {
            "_tabId": tab_id,
            "method": "Runtime.evaluate",
            "params": {"expression": expression, "returnByValue": True},
        },
    )
    value = result.get("result", {}).get("value")
    print(json.dumps({"tab": tab, "dom": value}, ensure_ascii=False, indent=2))


async def main() -> None:
    done = asyncio.Event()
    failure: list[BaseException] = []

    async def handler(socket: websockets.ServerConnection) -> None:
        try:
            await probe(socket)
        except BaseException as exc:  # surface it after server cleanup
            failure.append(exc)
        finally:
            done.set()

    async with websockets.serve(handler, "127.0.0.1", 10086):
        print("waiting for WebBridge on ws://127.0.0.1:10086/ws", flush=True)
        try:
            await asyncio.wait_for(done.wait(), timeout=65)
        except TimeoutError as exc:
            raise RuntimeError("WebBridge did not connect within 65 seconds") from exc
    if failure:
        raise failure[0]


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
    except BaseException as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise
