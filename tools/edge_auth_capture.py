"""Capture authenticated ChatGPT settings UI through Edge's debugger extension.

Requires ``tools/edge_webbridge_server.py`` to be running and connected.  The
capture is read-only apart from navigation between settings sections and a page
reload.  Cookie/storage APIs are never called.  Authentication-like values are
redacted before artifacts are written.
"""

from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import re
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests


BASE = "http://127.0.0.1:10086"
OUT = Path("qa/auth-capture")
TAB_OUT = OUT / "tabs"
NETWORK_OUT = OUT / "network"
BODY_OUT = NETWORK_OUT / "bodies"
STYLESHEET_OUT = OUT / "stylesheets"

SENSITIVE_KEY = re.compile(
    r"(?:^|[_-])(?:access|refresh|session|auth|id)?[_-]?token(?:$|[_-])"
    r"|authorization|cookie|secret|csrf|api[_-]?key|password",
    re.I,
)
BEARER_RE = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{12,}")
JSON_SECRET_RE = re.compile(
    r'(?i)(["\'](?:access[_-]?token|refresh[_-]?token|session[_-]?token|auth[_-]?token|authorization|cookie|secret|csrf|api[_-]?key)["\']\s*:\s*["\'])(.*?)(["\'])'
)


TABS = [
    ("general", "常规", "#settings"),
    ("notifications", "通知", "#settings/Notifications"),
    ("personalization", "个性化", "#settings/Personalization"),
    ("plugins", "插件", "#settings/Plugins"),
    ("voice", "语音", "#settings/Voice"),
    ("billing", "账单", "#settings/Billing"),
    ("usage", "使用情况", "#settings/Usage"),
    ("analytics", "分析", "#settings/Analytics"),
    ("data-controls", "数据管理", "#settings/DataControls"),
    ("cloud-browser", "云浏览器", "#settings/CloudBrowser"),
    ("storage", "存储空间", "#settings/Storage"),
    ("safety", "安全防护", "#settings/SafetySettings"),
    ("security", "账户安全与登录", "#settings/Security"),
    ("parental-controls", "家长控制", "#settings/ParentalControls"),
    ("trusted-contacts", "受信任联系人", "#settings/Safety"),
    ("account", "账户", "#settings/Account"),
    ("keyboard", "快捷键", "#settings/Keyboard"),
]

COMPUTED_STYLES = [
    "display",
    "visibility",
    "opacity",
    "position",
    "inset",
    "top",
    "right",
    "bottom",
    "left",
    "z-index",
    "width",
    "height",
    "min-width",
    "min-height",
    "max-width",
    "max-height",
    "box-sizing",
    "margin",
    "padding",
    "gap",
    "row-gap",
    "column-gap",
    "overflow",
    "overflow-x",
    "overflow-y",
    "flex",
    "flex-direction",
    "flex-wrap",
    "align-items",
    "align-content",
    "justify-content",
    "grid-template-columns",
    "grid-template-rows",
    "font-family",
    "font-size",
    "font-style",
    "font-weight",
    "font-variation-settings",
    "line-height",
    "letter-spacing",
    "text-align",
    "text-transform",
    "white-space",
    "color",
    "background",
    "background-color",
    "background-image",
    "border",
    "border-width",
    "border-color",
    "border-radius",
    "box-shadow",
    "filter",
    "backdrop-filter",
    "transform",
    "transform-origin",
    "transition",
    "animation",
    "cursor",
    "pointer-events",
    "scrollbar-gutter",
]


def call(name: str, args: dict[str, Any], timeout: float = 120) -> Any:
    response = requests.post(
        f"{BASE}/call", json={"name": name, "args": args}, timeout=timeout
    )
    try:
        payload = response.json()
    except Exception as exc:
        raise RuntimeError(f"bridge returned HTTP {response.status_code}") from exc
    if not response.ok or not payload.get("ok"):
        raise RuntimeError(payload.get("error") or f"HTTP {response.status_code}")
    return payload.get("data")


def cdp(tab_id: int, method: str, params: dict[str, Any] | None = None) -> Any:
    return call(
        "cdp",
        {"_tabId": tab_id, "method": method, "params": params or {}},
        timeout=180,
    )


def evaluate(tab_id: int, expression: str) -> Any:
    result = cdp(
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
        raise RuntimeError(str(result["exceptionDetails"]))
    return result.get("result", {}).get("value")


def scrub(value: Any, key: str = "") -> Any:
    if SENSITIVE_KEY.search(key):
        return "<redacted>"
    if isinstance(value, dict):
        return {str(k): scrub(v, str(k)) for k, v in value.items()}
    if isinstance(value, list):
        return [scrub(v) for v in value]
    if isinstance(value, str):
        value = BEARER_RE.sub("Bearer <redacted>", value)
        value = JSON_SECRET_RE.sub(r"\1<redacted>\3", value)
        return value
    return value


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(scrub(value), ensure_ascii=False, indent=2), encoding="utf-8"
    )


def write_text(path: Path, value: str, do_scrub: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(scrub(value) if do_scrub else value, encoding="utf-8")


def wait_ready(tab_id: int, timeout: float = 20) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            state = evaluate(
                tab_id,
                "({ready:document.readyState,dialog:!!document.querySelector('[role=dialog]'),hash:location.hash})",
            )
            if state and state.get("ready") == "complete" and state.get("dialog"):
                return
        except Exception:
            pass
        time.sleep(0.4)
    raise TimeoutError("settings dialog did not become ready")


FETCH_HOOK = r"""
(() => {
  if (globalThis.__authCaptureInstalled) return;
  globalThis.__authCaptureInstalled = true;
  const records = [];
  Object.defineProperty(globalThis, '__authCaptureRequests', {value: records});
  const sensitive = /authorization|cookie|token|secret|csrf|api[-_]?key/i;
  const safeHeaders = input => {
    const out = {};
    try { new Headers(input || {}).forEach((v,k) => out[k] = sensitive.test(k) ? '<redacted>' : v); }
    catch (e) { out.__error = String(e); }
    return out;
  };
  const originalFetch = globalThis.fetch;
  if (originalFetch) globalThis.fetch = function(input, init) {
    try {
      const request = new Request(input, init);
      records.push({kind:'fetch', time:performance.now(), url:request.url,
        method:request.method, credentials:request.credentials,
        mode:request.mode, cache:request.cache, redirect:request.redirect,
        headers:safeHeaders(request.headers), bodyPresent:!!(init && init.body)});
    } catch (e) { records.push({kind:'fetch-error',error:String(e)}); }
    return Reflect.apply(originalFetch, this, arguments);
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSet = XMLHttpRequest.prototype.setRequestHeader;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method,url) {
    this.__capture = {kind:'xhr',time:performance.now(),method:String(method),
      url:new URL(String(url),location.href).href,headers:{}};
    return Reflect.apply(originalOpen,this,arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function(k,v) {
    if (this.__capture) this.__capture.headers[k] = sensitive.test(k) ? '<redacted>' : String(v);
    return Reflect.apply(originalSet,this,arguments);
  };
  XMLHttpRequest.prototype.send = function(body) {
    if (this.__capture) { this.__capture.bodyPresent = body != null; records.push(this.__capture); }
    return Reflect.apply(originalSend,this,arguments);
  };
})();
"""


PAGE_SUMMARY_JS = r"""
(() => {
  const rect = el => { const r=el.getBoundingClientRect(); return {
    x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,right:r.right,bottom:r.bottom,left:r.left}; };
  const dialog=document.querySelector('[role=dialog]');
  const navButtons=dialog ? [...dialog.querySelectorAll('button')]
    .filter(x => String(x.className||'').includes('__menu-item'))
    .map(x => ({text:(x.innerText||'').trim(),aria:x.getAttribute('aria-label'),
      className:String(x.className||''),state:x.getAttribute('data-state'),rect:rect(x)})) : [];
  return {
    href:location.href,title:document.title,lang:document.documentElement.lang,
    viewport:{innerWidth,innerHeight,outerWidth,outerHeight,devicePixelRatio,
      visualViewport:globalThis.visualViewport ? {width:visualViewport.width,height:visualViewport.height,
        scale:visualViewport.scale,offsetLeft:visualViewport.offsetLeft,offsetTop:visualViewport.offsetTop}:null},
    colorScheme:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light',
    reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,
    documentClass:document.documentElement.className,bodyClass:document.body.className,
    dialog:dialog ? {rect:rect(dialog),className:String(dialog.className||''),
      ariaLabel:dialog.getAttribute('aria-label'),ariaLabelledby:dialog.getAttribute('aria-labelledby'),
      text:(dialog.innerText||'')} : null,
    navButtons
  };
})()
"""


RESOURCES_JS = r"""
(() => ({
  href:location.href,
  resources:performance.getEntriesByType('resource').map(x=>({name:x.name,
    initiatorType:x.initiatorType,startTime:x.startTime,duration:x.duration,
    transferSize:x.transferSize,encodedBodySize:x.encodedBodySize,
    decodedBodySize:x.decodedBodySize,nextHopProtocol:x.nextHopProtocol,
    renderBlockingStatus:x.renderBlockingStatus,responseStatus:x.responseStatus})),
  scripts:[...document.scripts].map((x,i)=>({i,src:x.src,type:x.type,async:x.async,
    defer:x.defer,noModule:x.noModule,crossOrigin:x.crossOrigin,integrity:x.integrity,
    referrerPolicy:x.referrerPolicy,textLength:x.src?0:x.textContent.length})),
  links:[...document.querySelectorAll('link')].map((x,i)=>({i,rel:x.rel,href:x.href,
    as:x.as,type:x.type,media:x.media,crossOrigin:x.crossOrigin,integrity:x.integrity,
    referrerPolicy:x.referrerPolicy,disabled:x.disabled})),
  styles:[...document.querySelectorAll('style')].map((x,i)=>({i,media:x.media,
    nonce:x.nonce?'present':'',textLength:x.textContent.length})),
  styleSheets:[...document.styleSheets].map((x,i)=>({i,href:x.href,disabled:x.disabled,
    media:[...x.media],ownerTag:x.ownerNode?.tagName||'',rules:(()=>{try{return x.cssRules.length}catch(e){return null}})()})),
  fonts:[...document.fonts].map(x=>({family:x.family,style:x.style,weight:x.weight,
    stretch:x.stretch,status:x.status,unicodeRange:x.unicodeRange,variant:x.variant,
    featureSettings:x.featureSettings,variationSettings:x.variationSettings}))
}))()
"""


def selected_tab_state(tab_id: int, label: str) -> dict[str, Any]:
    expression = f"""(() => {{
      const d=document.querySelector('[role=dialog]');
      const label={json.dumps(label, ensure_ascii=False)};
      const candidates=d?[...d.querySelectorAll('button')]:[];
      const b=candidates.find(x => (x.innerText||'').trim()===label &&
        String(x.className||'').includes('__menu-item'));
      if(!b) return {{found:false,label,hash:location.hash,
        buttons:candidates.slice(0,25).map(x=>(x.innerText||'').trim())}};
      const r=b.getBoundingClientRect();
      return {{found:true,label,hash:location.hash,
        state:b.getAttribute('data-state'),selected:b.getAttribute('aria-selected'),
        className:String(b.className||''),rect:{{x:r.x,y:r.y,width:r.width,height:r.height}},
        hit:(()=>{{const h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
          return h?{{tag:h.tagName,text:(h.innerText||'').trim(),className:String(h.className||'')}}:null}})()}};
    }})()"""
    return evaluate(tab_id, expression)


def click_tab(tab_id: int, label: str, expected_hash: str) -> dict[str, Any]:
    # React's settings navigation intentionally ignores synthetic
    # HTMLElement.click() in this runtime.  Scroll the real button into view,
    # then dispatch a trusted CDP mouse sequence at its visual center.
    prep_expression = f"""(() => {{
      const label={json.dumps(label, ensure_ascii=False)};
      const d=[...document.querySelectorAll('[role=dialog]')].find(x =>
        [...x.querySelectorAll('button.__menu-item')].some(b => (b.innerText||'').trim()===label));
      const b=d&&[...d.querySelectorAll('button.__menu-item')]
        .find(x=>(x.innerText||'').trim()===label);
      if(!b) return {{found:false,label}};
      b.scrollIntoView({{block:'nearest',inline:'nearest'}});
      const r=b.getBoundingClientRect();
      return {{found:true,x:r.x+r.width/2,y:r.y+r.height/2,
        width:r.width,height:r.height,state:b.getAttribute('data-state'),
        selected:b.getAttribute('aria-selected'),hash:location.hash}};
    }})()"""
    prep = evaluate(tab_id, prep_expression)
    if not prep or not prep.get("found"):
        raise RuntimeError(f"unable to locate settings tab {label!r}: {prep}")

    # If it is already selected, still enforce the canonical hash below.
    if not (prep.get("selected") == "true" and prep.get("state") == "active"):
        time.sleep(0.12)
        # Scrolling can shift layout; recompute the center after it settles.
        prep = evaluate(tab_id, prep_expression)
        x, y = float(prep["x"]), float(prep["y"])
        cdp(
            tab_id,
            "Input.dispatchMouseEvent",
            {
                "type": "mouseMoved",
                "x": x,
                "y": y,
                "button": "none",
                "buttons": 0,
            },
        )
        cdp(
            tab_id,
            "Input.dispatchMouseEvent",
            {
                "type": "mousePressed",
                "x": x,
                "y": y,
                "button": "left",
                "buttons": 1,
                "clickCount": 1,
            },
        )
        cdp(
            tab_id,
            "Input.dispatchMouseEvent",
            {
                "type": "mouseReleased",
                "x": x,
                "y": y,
                "button": "left",
                "buttons": 0,
                "clickCount": 1,
            },
        )

    deadline = time.monotonic() + 12
    state: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        time.sleep(0.2)
        state = selected_tab_state(tab_id, label)
        if (
            state
            and state.get("found")
            and state.get("selected") == "true"
            and state.get("state") == "active"
            and state.get("hash") == expected_hash
        ):
            wait_ready(tab_id)
            time.sleep(1.15)  # lazy API + entrance animation settle
            verified = selected_tab_state(tab_id, label)
            if not (
                verified.get("selected") == "true"
                and verified.get("state") == "active"
                and verified.get("hash") == expected_hash
            ):
                raise RuntimeError(
                    f"settings tab {label!r} lost selection after settle: {verified}"
                )
            return verified
    raise RuntimeError(
        f"trusted click did not select {label!r} / {expected_hash!r}: {state}"
    )


def capture_tab(tab_id: int, slug: str, label: str, expected_hash: str) -> None:
    print(f"capture tab: {slug} / {label}", flush=True)
    verified_selection = click_tab(tab_id, label, expected_hash)
    summary = evaluate(tab_id, PAGE_SUMMARY_JS)
    if not (
        verified_selection.get("selected") == "true"
        and verified_selection.get("state") == "active"
        and summary.get("href", "").endswith(expected_hash)
    ):
        raise RuntimeError(
            f"refusing to write unverified tab artifact {slug}: "
            f"selection={verified_selection}, href={summary.get('href')}"
        )
    html = evaluate(
        tab_id,
        "document.querySelector('[role=dialog]')?.outerHTML || ''",
    )
    dom_snapshot = cdp(
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
    screenshot = call("screenshot", {"_tabId": tab_id, "format": "png"}, 180)
    write_json(
        TAB_OUT / f"{slug}.json",
        {
            "slug": slug,
            "label": label,
            "expectedHash": expected_hash,
            "verifiedSelection": verified_selection,
            "summary": summary,
            "dialogOuterHTML": html,
        },
    )
    write_json(TAB_OUT / f"{slug}.domsnapshot.json", dom_snapshot)
    (TAB_OUT / f"{slug}.png").write_bytes(base64.b64decode(screenshot["data"]))


def extension_for(mime: str, url: str, is_base64: bool) -> str:
    if is_base64:
        return ".bin"
    mime = (mime or "").lower()
    if "javascript" in mime:
        return ".js"
    if "css" in mime:
        return ".css"
    if "json" in mime:
        return ".json"
    if "html" in mime:
        return ".html"
    suffix = Path(urlparse(url).path).suffix
    if suffix and len(suffix) <= 8:
        return suffix
    return mimetypes.guess_extension(mime.split(";", 1)[0]) or ".txt"


def safe_basename(url: str) -> str:
    name = Path(urlparse(url).path).name or "index"
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name)[:80]
    return name or "resource"


def capture_network(tab_id: int) -> None:
    listing = call("network", {"_tabId": tab_id, "cmd": "list"}, 180)
    write_json(NETWORK_OUT / "requests.json", listing)
    manifest: list[dict[str, Any]] = []
    requests_list = listing.get("requests", [])
    wanted = [
        item
        for item in requests_list
        if item.get("completed")
        and item.get("status") not in (204, 304)
        and any(
            marker in (item.get("mimeType") or "").lower()
            for marker in ("javascript", "css", "json", "html", "text/plain")
        )
    ]
    print(f"network requests={len(requests_list)}, bodies to try={len(wanted)}", flush=True)
    for index, item in enumerate(wanted, 1):
        request_id = item["requestId"]
        url = item.get("url", "")
        entry: dict[str, Any] = dict(item)
        try:
            detail = call(
                "network",
                {"_tabId": tab_id, "cmd": "detail", "requestId": request_id},
                180,
            )
            body = detail.get("body")
            is_base64 = bool(detail.get("base64Encoded"))
            ext = extension_for(detail.get("mimeType", ""), url, is_base64)
            digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]
            filename = f"{digest}-{safe_basename(url)}"
            if not filename.lower().endswith(ext.lower()):
                filename += ext
            path = BODY_OUT / filename
            path.parent.mkdir(parents=True, exist_ok=True)
            if is_base64 and isinstance(body, str):
                path.write_bytes(base64.b64decode(body))
            elif isinstance(body, (dict, list)):
                write_json(path, body)
            else:
                write_text(path, str(body or ""), do_scrub=True)
            entry.update({"file": str(path.as_posix()), "captured": True})
        except Exception as exc:
            entry.update({"captured": False, "error": str(exc)})
        manifest.append(entry)
        if index % 20 == 0:
            print(f"  response bodies {index}/{len(wanted)}", flush=True)
    write_json(NETWORK_OUT / "body-manifest.json", manifest)

    # Request bodies are captured only for non-idempotent requests and scrubbed.
    posts: list[dict[str, Any]] = []
    for item in requests_list:
        if item.get("method") not in {"POST", "PUT", "PATCH"}:
            continue
        record = {"requestId": item.get("requestId"), "url": item.get("url")}
        try:
            result = cdp(
                tab_id,
                "Network.getRequestPostData",
                {"requestId": item["requestId"]},
            )
            record["postData"] = result.get("postData", "")
        except Exception as exc:
            record["error"] = str(exc)
        posts.append(record)
    write_json(NETWORK_OUT / "request-bodies-sanitized.json", posts)


def capture_cssom(tab_id: int, resources: dict[str, Any]) -> None:
    manifest = []
    for sheet in resources.get("styleSheets", []):
        index = sheet["i"]
        record = dict(sheet)
        try:
            css = evaluate(
                tab_id,
                f"(() => {{ try {{ return [...document.styleSheets[{index}].cssRules].map(x=>x.cssText).join('\\n') }} catch(e) {{ return {{__error:String(e)}} }} }})()",
            )
            if isinstance(css, dict) and css.get("__error"):
                record["error"] = css["__error"]
            else:
                filename = f"cssom-{index:03d}.css"
                write_text(STYLESHEET_OUT / filename, css or "", do_scrub=True)
                record["file"] = str((STYLESHEET_OUT / filename).as_posix())
        except Exception as exc:
            record["error"] = str(exc)
        manifest.append(record)
    write_json(STYLESHEET_OUT / "manifest.json", manifest)


def main() -> None:
    for directory in (OUT, TAB_OUT, NETWORK_OUT, BODY_OUT, STYLESHEET_OUT):
        directory.mkdir(parents=True, exist_ok=True)
    (OUT / "capture-complete.json").unlink(missing_ok=True)
    status = requests.get(f"{BASE}/status", timeout=5).json()
    if not status.get("connected"):
        raise RuntimeError(f"WebBridge is not connected: {status}")
    write_json(OUT / "bridge-status.json", status)

    tab = call("find_tab", {"url": "chatgpt.com", "active": True})
    tab_id = int(tab["tabId"])
    write_json(OUT / "target-tab.json", tab)
    if not str(tab.get("url", "")).startswith("https://chatgpt.com/"):
        raise RuntimeError(f"active tab is not chatgpt.com: {tab}")
    hook_id: dict[str, Any] = {}
    network_started = False
    metrics_overridden = False
    completed = False
    try:
        # chrome.debugger shows a browser banner which otherwise subtracts
        # roughly 50 physical px.  Emulate the canonical 1920x930 content area
        # at 125% scaling (1536x744 CSS px), giving the real desktop dialog its
        # intended 680x600 CSS geometry.
        cdp(
            tab_id,
            "Emulation.setDeviceMetricsOverride",
            {
                "width": 1536,
                "height": 744,
                "deviceScaleFactor": 1.25,
                "mobile": False,
                "screenWidth": 1536,
                "screenHeight": 744,
            },
        )
        metrics_overridden = True

        # The authenticated tab can be on the Work home screen after another
        # QA recorder finishes.  Open settings before the capture reload.
        initial = evaluate(
            tab_id,
            "({href:location.href,dialog:!!document.querySelector('[role=dialog]')})",
        )
        if not initial or not initial.get("dialog"):
            cdp(tab_id, "Page.navigate", {"url": "https://chatgpt.com/#settings"})
            wait_ready(tab_id, timeout=35)

        # Enable the extension's HAR-like recorder, install sanitized fetch/XHR
        # instrumentation for explicit request headers, and reload uncached.
        call("network", {"_tabId": tab_id, "cmd": "start"})
        network_started = True
        cdp(tab_id, "Network.setCacheDisabled", {"cacheDisabled": True})
        hook_id = cdp(
            tab_id,
            "Page.addScriptToEvaluateOnNewDocument",
            {"source": FETCH_HOOK, "runImmediately": True},
        )
        cdp(tab_id, "Page.reload", {"ignoreCache": True})
        wait_ready(tab_id, timeout=35)
        time.sleep(5)
        canonical_viewport = evaluate(
            tab_id,
            "({innerWidth,innerHeight,devicePixelRatio,href:location.href})",
        )
        if (
            canonical_viewport.get("innerWidth") != 1536
            or canonical_viewport.get("innerHeight") != 744
        ):
            raise RuntimeError(f"unexpected capture viewport: {canonical_viewport}")
        write_json(
            OUT / "instrumentation.json",
            {
                "fetchHook": hook_id,
                "deviceMetricsOverride": canonical_viewport,
                "reason": "neutralize chrome.debugger banner viewport reduction",
            },
        )

        # Capture each real settings section. Navigation buttons are the only
        # UI controls clicked; no preference value is modified.
        for slug, label, expected_hash in TABS:
            capture_tab(tab_id, slug, label, expected_hash)

        # Restore the neutral General tab and collect whole-page artifacts.
        click_tab(tab_id, "常规", "#settings")
        page_summary = evaluate(tab_id, PAGE_SUMMARY_JS)
        full_html = evaluate(tab_id, "document.documentElement.outerHTML")
        write_json(OUT / "page-summary.json", page_summary)
        write_text(OUT / "document.outerHTML.html", full_html or "", do_scrub=True)
        resources = evaluate(tab_id, RESOURCES_JS)
        write_json(OUT / "resource-manifest.json", resources)
        request_hook = evaluate(tab_id, "globalThis.__authCaptureRequests || []")
        write_json(NETWORK_OUT / "fetch-xhr-sanitized.json", request_hook)
        capture_cssom(tab_id, resources)

        # CDP's MHTML snapshot is the most replayable browser-delivered source
        # artifact. It contains fetched resources but no cookie database.
        try:
            mhtml = cdp(tab_id, "Page.captureSnapshot", {"format": "mhtml"})
            write_text(OUT / "page.mhtml", mhtml.get("data", ""), do_scrub=True)
        except Exception as exc:
            write_json(OUT / "page-mhtml-error.json", {"error": str(exc)})

        capture_network(tab_id)
        write_json(
            OUT / "capture-complete.json",
            {
                "complete": True,
                "capturedAtEpoch": time.time(),
                "tabCount": len(TABS),
                "target": tab,
                "viewport": canonical_viewport,
                "authentication": "existing browser session; cookies/storage were not read",
                "redaction": "authorization/cookie/token/secret/csrf/api-key/password values",
            },
        )
        completed = True
        print(f"capture complete: {OUT.resolve()}", flush=True)
    finally:
        # Always leave the real browser on General and undo instrumentation.
        try:
            click_tab(tab_id, "常规", "#settings")
        except Exception as exc:
            print(f"warning: could not restore General: {exc}", flush=True)
        if network_started:
            try:
                call("network", {"_tabId": tab_id, "cmd": "stop"})
            except Exception:
                pass
        try:
            cdp(tab_id, "Network.setCacheDisabled", {"cacheDisabled": False})
        except Exception:
            pass
        try:
            identifier = hook_id.get("identifier")
            if identifier:
                cdp(
                    tab_id,
                    "Page.removeScriptToEvaluateOnNewDocument",
                    {"identifier": identifier},
                )
        except Exception:
            pass
        if metrics_overridden:
            try:
                cdp(tab_id, "Emulation.clearDeviceMetricsOverride")
            except Exception:
                pass
        if not completed:
            (OUT / "capture-complete.json").unlink(missing_ok=True)


if __name__ == "__main__":
    main()
