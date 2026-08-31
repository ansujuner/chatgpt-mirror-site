import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const playwrightUrl = pathToFileURL(join(
  process.env.APPDATA,
  'npm',
  'node_modules',
  '@playwright',
  'test',
  'node_modules',
  'playwright',
  'index.mjs',
)).href
const { chromium } = await import(playwrightUrl)

const targetUrl = process.argv[2] || 'http://127.0.0.1:5173/'
const outputDir = resolve(process.argv[3] || 'screenshots')
const prompt = process.argv[4] || '只回复：测试'
const mobile = process.argv.includes('--mobile')
const artifactStem = mobile ? 'anonymous-chat-local-mobile' : 'anonymous-chat-local'
const streamingScreenshot = join(outputDir, `${artifactStem}-streaming.png`)
const completeScreenshot = join(outputDir, `${artifactStem}-complete.png`)
const reportPath = join(outputDir, `${artifactStem}-metrics.json`)

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
})

try {
  const page = await browser.newPage({ viewport: mobile
    ? { width: 390, height: 844 }
    : { width: 1920, height: 1080 } })
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-auth-state="anonymous"]')
  await page.waitForSelector('textarea[aria-label="与 ChatGPT 聊天"]')
  await page.evaluate(() => document.fonts.ready)

  await page.locator('textarea[aria-label="与 ChatGPT 聊天"]').fill(prompt)
  await page.locator('textarea[aria-label="与 ChatGPT 聊天"]').press('Enter')
  await page.waitForSelector('[data-message-role="user"]')
  await page.waitForSelector('.thinking-dots, [aria-label="ChatGPT 正在思考"]')
  await page.waitForSelector('[aria-label="停止生成"]')
  await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))))
  await page.waitForTimeout(180)
  await mkdir(dirname(streamingScreenshot), { recursive: true })
  await page.screenshot({ path: streamingScreenshot })

  const streaming = await page.evaluate(() => ({
    authState: document.querySelector('.replica-shell')?.getAttribute('data-auth-state'),
    newChatActive: document.querySelector('.sidebar-new-chat .is-active') !== null,
    disclaimerVisible: Boolean(document.querySelector('.conversation-disclaimer')),
    loadingDots: document.querySelectorAll('.thinking-dot i, .thinking-dots i').length,
    actions: document.querySelectorAll('.assistant-actions button').length,
    submitLabel: document.querySelector('.submit-button')?.getAttribute('aria-label'),
  }))

  await page.waitForFunction(() => (
    document.querySelector('.submit-button')?.getAttribute('aria-label') === '启动语音模式'
    || document.querySelector('.submit-button')?.getAttribute('aria-label') === '发送消息'
  ), undefined, { timeout: 180_000 })
  await page.waitForSelector('[data-message-role="assistant"] .assistant-message')
  await page.waitForSelector('.assistant-actions button[aria-label="复制回复"], .assistant-actions button[aria-label="复制"]')
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(100)
  await page.screenshot({ path: completeScreenshot })

  const complete = await page.evaluate(() => {
    const rect = (selector) => {
      const node = document.querySelector(selector)
      if (!node) return null
      const { x, y, width, height } = node.getBoundingClientRect()
      return { x, y, width, height }
    }
    return {
      url: location.pathname,
      authState: document.querySelector('.replica-shell')?.getAttribute('data-auth-state'),
      transcriptText: document.querySelector('[data-conversation-transcript]')?.textContent?.trim(),
      assistantText: document.querySelector('[data-message-role="assistant"] .assistant-message')?.textContent?.trim(),
      toastText: document.querySelector('.replica-toast')?.textContent?.trim(),
      newChatActive: document.querySelector('.sidebar-new-chat .is-active') !== null,
      thread: rect('.conversation-thread'),
      userTurn: rect('.user-turn'),
      userMessage: rect('.user-message'),
      assistantTurn: rect('.assistant-turn'),
      assistantMessage: rect('.assistant-message'),
      assistantActions: rect('.assistant-actions'),
      actionButtons: [...document.querySelectorAll('.assistant-actions button')].map((node) => ({
        label: node.getAttribute('aria-label'),
        ...(() => {
          const { x, y, width, height } = node.getBoundingClientRect()
          return { x, y, width, height }
        })(),
      })),
      composer: rect('.chat-composer'),
      microphone: rect('.microphone-button'),
      disclaimer: rect('.conversation-disclaimer'),
      semantic: {
        sectionLabel: document.querySelector('.conversation-view')?.getAttribute('aria-label'),
        listTag: document.querySelector('.conversation-thread')?.tagName,
        listLabel: document.querySelector('.conversation-thread')?.getAttribute('aria-label'),
        turnTags: [...document.querySelectorAll('.chat-turn')].map((node) => node.tagName),
        actionRole: document.querySelector('.assistant-actions')?.getAttribute('role'),
        actionLabel: document.querySelector('.assistant-actions')?.getAttribute('aria-label'),
      },
    }
  })

  const assertNear = (name, actual, expected, tolerance = 2) => {
    if (typeof actual !== 'number' || Math.abs(actual - expected) > tolerance) {
      throw new Error(`${name}: expected ${expected} +/- ${tolerance}, got ${actual}`)
    }
  }
  if (streaming.authState !== 'anonymous' || complete.authState !== 'anonymous') {
    throw new Error(`Expected anonymous state, got ${streaming.authState}/${complete.authState}`)
  }
  if (streaming.newChatActive || complete.newChatActive) {
    throw new Error('The anonymous conversation must not leave New chat selected')
  }
  if (streaming.loadingDots !== 1) {
    throw new Error(`Expected one official-style loading dot, got ${streaming.loadingDots}`)
  }
  if (streaming.actions !== 0) throw new Error('Reply actions appeared before generation completed')
  if (complete.actionButtons.length !== 2) {
    throw new Error(`Expected copy/share actions, got ${complete.actionButtons.length}`)
  }
  if (complete.toastText?.includes('聊天请求失败')) {
    throw new Error(`The real anonymous stream failed: ${complete.toastText}`)
  }
  const expectedReply = prompt.match(/^只回复[：:]\s*(.+)$/)?.[1]
  if (expectedReply && complete.assistantText !== expectedReply) {
    throw new Error(`Expected exact reply ${JSON.stringify(expectedReply)}, got ${JSON.stringify(complete.assistantText)}`)
  }
  const expected = mobile
    ? {
        thread: { x: 16, y: 74, width: 358 },
        userMessage: { y: 126, height: 44 },
        assistantTurn: { y: 210 },
        assistantActions: { x: 6, y: 244 },
        composer: { x: 12, y: 784, width: 366, height: 52 },
      }
    : {
        thread: { x: 770, y: 72, width: 640 },
        userMessage: { y: 84, height: 44 },
        assistantTurn: { y: 168 },
        assistantActions: { x: 760, y: 202 },
        composer: { x: 706, y: 1012, width: 768, height: 52 },
      }
  assertNear('thread.x', complete.thread?.x, expected.thread.x)
  assertNear('thread.y', complete.thread?.y, expected.thread.y)
  assertNear('thread.width', complete.thread?.width, expected.thread.width)
  assertNear('userMessage.y', complete.userMessage?.y, expected.userMessage.y)
  assertNear('userMessage.height', complete.userMessage?.height, expected.userMessage.height)
  assertNear('assistantTurn.y', complete.assistantTurn?.y, expected.assistantTurn.y)
  assertNear('assistantActions.x', complete.assistantActions?.x, expected.assistantActions.x)
  assertNear('assistantActions.y', complete.assistantActions?.y, expected.assistantActions.y)
  assertNear('composer.x', complete.composer?.x, expected.composer.x)
  assertNear('composer.y', complete.composer?.y, expected.composer.y)
  assertNear('composer.width', complete.composer?.width, expected.composer.width)
  assertNear('composer.height', complete.composer?.height, 52)
  if (mobile) {
    assertNear('microphone.x', complete.microphone?.x, 285)
    assertNear('microphone.y', complete.microphone?.y, 788)
    assertNear('microphone.width', complete.microphone?.width, 44)
    assertNear('microphone.height', complete.microphone?.height, 44)
  }

  const report = { targetUrl, prompt, viewport: mobile ? 'mobile' : 'desktop', streaming, complete }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ streamingScreenshot, completeScreenshot, reportPath, streaming, complete }))
} finally {
  await browser.close()
}
