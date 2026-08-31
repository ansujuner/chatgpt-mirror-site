"""Loopback-only controller for the already-installed Edge Kimi WebBridge.

Endpoints:
  GET  http://127.0.0.1:10086/status
  POST http://127.0.0.1:10086/call
       {"name":"cdp","args":{"_tabId":123,"method":"Runtime.evaluate",...}}

The Edge extension connects to /ws itself.  No browser restart, profile copy,
cookie database access, or authentication export is involved.
"""

from __future__ import annotations

import asyncio
import json
import uuid

from aiohttp import WSMsgType, web


class Bridge:
    def __init__(self) -> None:
        self.socket: web.WebSocketResponse | None = None
        self.pending: dict[str, asyncio.Future] = {}
        self.extension_version: str | None = None

    async def websocket(self, request: web.Request) -> web.WebSocketResponse:
        socket = web.WebSocketResponse(max_msg_size=0, heartbeat=20)
        await socket.prepare(request)
        previous = self.socket
        self.socket = socket
        if previous is not None and not previous.closed:
            await previous.close(code=1001, message=b"new WebBridge connection")
        try:
            async for message in socket:
                if message.type != WSMsgType.TEXT:
                    continue
                data = json.loads(message.data)
                kind = data.get("type")
                if kind == "hello":
                    self.extension_version = data.get("payload", {}).get(
                        "extensionVersion"
                    )
                    await socket.send_json({"type": "hello_ack"})
                    print(
                        f"WebBridge connected (extension {self.extension_version})",
                        flush=True,
                    )
                elif kind == "ping":
                    await socket.send_json({"type": "pong"})
                elif kind == "tool_result":
                    request_id = data.get("responseToRequestId")
                    future = self.pending.pop(request_id, None)
                    if future is not None and not future.done():
                        future.set_result(data.get("payload", {}))
        finally:
            if self.socket is socket:
                self.socket = None
            for future in self.pending.values():
                if not future.done():
                    future.set_exception(ConnectionError("WebBridge disconnected"))
            self.pending.clear()
            print("WebBridge disconnected", flush=True)
        return socket

    async def call(self, request: web.Request) -> web.Response:
        socket = self.socket
        if socket is None or socket.closed:
            return web.json_response(
                {"ok": False, "error": "WebBridge is not connected"}, status=503
            )
        body = await request.json()
        name = body.get("name")
        args = body.get("args", {})
        if not isinstance(name, str) or not name:
            return web.json_response(
                {"ok": False, "error": "name is required"}, status=400
            )
        request_id = uuid.uuid4().hex
        future = asyncio.get_running_loop().create_future()
        self.pending[request_id] = future
        await socket.send_json(
            {
                "type": "tool_call",
                "requestId": request_id,
                "payload": {"name": name, "args": args},
            }
        )
        try:
            payload = await asyncio.wait_for(future, timeout=90)
        except TimeoutError:
            self.pending.pop(request_id, None)
            return web.json_response(
                {"ok": False, "error": "WebBridge call timed out"}, status=504
            )
        error = payload.get("error")
        if error:
            return web.json_response({"ok": False, "error": error}, status=502)
        return web.json_response({"ok": True, "data": payload.get("data")})

    async def status(self, _request: web.Request) -> web.Response:
        connected = self.socket is not None and not self.socket.closed
        return web.json_response(
            {
                "ok": True,
                "connected": connected,
                "extensionVersion": self.extension_version,
                "pending": len(self.pending),
            }
        )


bridge = Bridge()
app = web.Application(client_max_size=256 * 1024**2)
app.router.add_get("/ws", bridge.websocket)
app.router.add_post("/call", bridge.call)
app.router.add_get("/status", bridge.status)


if __name__ == "__main__":
    web.run_app(app, host="127.0.0.1", port=10086, print=None)
