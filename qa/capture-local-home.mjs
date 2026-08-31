import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const port = Number(process.argv[2] || 9333)
const targetUrl = process.argv[3] || 'http://localhost:5173/'
const output = resolve(process.argv[4] || 'screenshots/free-home-local-mobile.png')
const viewportWidth = Number(process.argv[5] || 390)
const viewportHeight = Number(process.argv[6] || 844)
const metricsOutput = output.replace(/\.png$/i, '.json')
const drawerOutput = output.replace(/\.png$/i, '-drawer.png')

async function retry(fn, attempts = 30) {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await fn() } catch (error) { lastError = error; await new Promise((done) => setTimeout(done, 200)) }
  }
  throw lastError
}

const targets = await retry(async () => {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`)
  if (!response.ok) throw new Error(`CDP target list: ${response.status}`)
  return response.json()
})
const target = targets.find((entry) => entry.type === 'page')
if (!target?.webSocketDebuggerUrl) throw new Error('No page CDP target found')

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolveOpen, reject) => {
  socket.addEventListener('open', resolveOpen, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let nextId = 1
const pending = new Map()
socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (!message.id) return
  const waiter = pending.get(message.id)
  if (!waiter) return
  pending.delete(message.id)
  if (message.error) waiter.reject(new Error(message.error.message))
  else waiter.resolve(message.result)
})

function send(method, params = {}) {
  const id = nextId++
  const promise = new Promise((resolveResult, reject) => pending.set(id, { resolve: resolveResult, reject }))
  socket.send(JSON.stringify({ id, method, params }))
  return promise
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: viewportWidth,
  height: viewportHeight,
  deviceScaleFactor: 1,
  mobile: viewportWidth < 768,
  screenWidth: viewportWidth,
  screenHeight: viewportHeight,
  positionX: 0,
  positionY: 0,
})
await send('Page.navigate', { url: targetUrl })
await retry(async () => {
  const result = await send('Runtime.evaluate', { expression: `document.readyState === 'complete' && !!document.querySelector('.free-home-shell')`, returnByValue: true })
  if (!result.result.value) throw new Error('Home not ready')
  return true
})
await new Promise((done) => setTimeout(done, 250))

const capture = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
await mkdir(dirname(output), { recursive: true })
await writeFile(output, Buffer.from(capture.data, 'base64'))

const metrics = await send('Runtime.evaluate', {
  expression: `(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector)
      if (!element) return null
      const box = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return { x: box.x, y: box.y, width: box.width, height: box.height, display: style.display, color: style.color, background: style.backgroundColor }
    }
    return {
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      heading: rect('.free-welcome h1'),
      composer: rect('.free-composer'),
      suggestions: [...document.querySelectorAll('.free-suggestions button')].map((element) => {
        const box = element.getBoundingClientRect()
        return { text: element.textContent.trim(), x: box.x, y: box.y, width: box.width, height: box.height }
      }),
      sidebarTransform: getComputedStyle(document.querySelector('.free-sidebar')).transform,
      visibleText: document.body.innerText,
      historyLinks: [...document.querySelectorAll('.free-sidebar a')].map((element) => element.textContent.trim()).filter((text) => /最近|历史|手机屏幕|模型区别/.test(text)),
      account: document.querySelector('.free-account-button')?.getAttribute('aria-label'),
      composerLabel: document.querySelector('.free-composer textarea')?.getAttribute('aria-label'),
      placeholder: document.querySelector('.free-composer textarea')?.getAttribute('placeholder'),
    }
  })()`,
  returnByValue: true,
})
await writeFile(metricsOutput, `${JSON.stringify(metrics.result.value, null, 2)}\n`)

let drawer = null
let desktopSidebar = null
if (viewportWidth < 768) {
  await send('Runtime.evaluate', { expression: `document.querySelector('[aria-label="打开侧边栏"]')?.click()` })
  await new Promise((done) => setTimeout(done, 240))
  const drawerResult = await send('Runtime.evaluate', {
    expression: `(() => { const element = document.querySelector('.free-sidebar'); const box = element.getBoundingClientRect(); return { x: box.x, width: box.width, transform: getComputedStyle(element).transform, open: document.querySelector('.free-home-shell').classList.contains('is-drawer-open') } })()`,
    returnByValue: true,
  })
  drawer = drawerResult.result.value
  const drawerCapture = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  await writeFile(drawerOutput, Buffer.from(drawerCapture.data, 'base64'))
  await send('Runtime.evaluate', { expression: `document.querySelector('.free-drawer-scrim')?.click()` })
} else {
  await send('Runtime.evaluate', { expression: `document.querySelector('.free-sidebar [aria-label="关闭侧边栏"]')?.click()` })
  await new Promise((done) => setTimeout(done, 220))
  const collapsed = await send('Runtime.evaluate', {
    expression: `(() => { const shell = document.querySelector('.free-home-shell'); const box = document.querySelector('.free-sidebar').getBoundingClientRect(); return { collapsed: shell.classList.contains('is-sidebar-collapsed'), sidebarX: box.x, openButtonVisible: getComputedStyle(document.querySelector('[aria-label="打开侧边栏"]')).display !== 'none' } })()`,
    returnByValue: true,
  })
  await send('Runtime.evaluate', { expression: `document.querySelector('[aria-label="打开侧边栏"]')?.click()` })
  await new Promise((done) => setTimeout(done, 220))
  const restored = await send('Runtime.evaluate', {
    expression: `(() => { const shell = document.querySelector('.free-home-shell'); const box = document.querySelector('.free-sidebar').getBoundingClientRect(); return { collapsed: shell.classList.contains('is-sidebar-collapsed'), sidebarX: box.x } })()`,
    returnByValue: true,
  })
  desktopSidebar = { collapsed: collapsed.result.value, restored: restored.result.value }
}
await send('Runtime.evaluate', { expression: `document.querySelector('.free-composer textarea')?.focus()` })
await new Promise((done) => setTimeout(done, 220))
await send('Input.insertText', { text: '你好' })
await new Promise((done) => setTimeout(done, 80))
const interaction = await send('Runtime.evaluate', {
  expression: `({ value: document.querySelector('.free-composer textarea')?.value, suggestionCount: document.querySelectorAll('.free-suggestions button').length, primaryLabel: document.querySelector('.free-voice-button')?.getAttribute('aria-label'), drawerOpen: document.querySelector('.free-home-shell').classList.contains('is-drawer-open') })`,
  returnByValue: true,
})
const report = { ...metrics.result.value, drawer, desktopSidebar, interaction: interaction.result.value }
await writeFile(metricsOutput, `${JSON.stringify(report, null, 2)}\n`)
socket.close()
console.log(JSON.stringify({ output, drawerOutput: drawer ? drawerOutput : null, metricsOutput, viewport: report.viewport, composer: report.composer, drawer: report.drawer, desktopSidebar: report.desktopSidebar, interaction: report.interaction, historyLinks: report.historyLinks }))
