import { DEFAULT_MOCK_REPLY, MOCK_REPLY_RULES } from '../data/mockReplies'
import type {
  ChatMessage,
  MockReplyContext,
  MockReplyFactory,
  MockReplyRule,
} from '../types'

export interface TextStreamOptions {
  initialDelayMs?: number
  intervalMs?: number
  jitterMs?: number
  minChunkSize?: number
  maxChunkSize?: number
  strategy?: 'character' | 'word'
  signal?: AbortSignal
  random?: () => number
}

export interface MockReplyOptions extends TextStreamOptions {
  messages?: readonly ChatMessage[]
  rules?: readonly MockReplyRule[]
  fallback?: string | MockReplyFactory
}

const DEFAULT_STREAM_OPTIONS = {
  initialDelayMs: 280,
  intervalMs: 24,
  jitterMs: 18,
  minChunkSize: 1,
  maxChunkSize: 4,
  strategy: 'word' as const,
}

function abortError(): Error {
  const error = new Error('The stream was aborted')
  error.name = 'AbortError'
  return error
}

function ensureNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

function sleep(durationMs: number, signal?: AbortSignal): Promise<void> {
  ensureNotAborted(signal)
  if (durationMs <= 0) return Promise.resolve()

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort)
      resolve()
    }, durationMs)

    function handleAbort() {
      window.clearTimeout(timeoutId)
      signal?.removeEventListener('abort', handleAbort)
      reject(abortError())
    }

    signal?.addEventListener('abort', handleAbort, { once: true })
  })
}

function clampInteger(value: number, minimum: number): number {
  if (!Number.isFinite(value)) return minimum
  return Math.max(minimum, Math.floor(value))
}

function tokenize(text: string, strategy: 'character' | 'word'): string[] {
  if (strategy === 'character') return Array.from(text)
  return text.match(/\S+\s*|\s+/g) ?? []
}

export async function resolveMockReply(
  prompt: string,
  options: Pick<MockReplyOptions, 'messages' | 'rules' | 'fallback'> = {},
): Promise<string> {
  const normalizedPrompt = prompt.trim().toLocaleLowerCase()
  const context: MockReplyContext = {
    prompt: prompt.trim(),
    messages: options.messages ?? [],
  }
  const rules = options.rules ?? MOCK_REPLY_RULES
  const matchedRule = rules.find((rule) =>
    rule.keywords.some((keyword) =>
      normalizedPrompt.includes(keyword.toLocaleLowerCase()),
    ),
  )
  const response = matchedRule?.response ?? options.fallback ?? DEFAULT_MOCK_REPLY

  return typeof response === 'function' ? response(context) : response
}

export async function* streamText(
  text: string,
  options: TextStreamOptions = {},
): AsyncGenerator<string, void, undefined> {
  const settings = { ...DEFAULT_STREAM_OPTIONS, ...options }
  const random = settings.random ?? Math.random
  const minimum = clampInteger(settings.minChunkSize, 1)
  const maximum = Math.max(minimum, clampInteger(settings.maxChunkSize, minimum))
  const tokens = tokenize(text, settings.strategy)

  await sleep(Math.max(0, settings.initialDelayMs), settings.signal)

  for (let index = 0; index < tokens.length; ) {
    ensureNotAborted(settings.signal)
    const chunkSize =
      minimum + Math.floor(random() * (maximum - minimum + 1))
    const chunk = tokens.slice(index, index + chunkSize).join('')
    index += chunkSize

    yield chunk

    if (index < tokens.length) {
      const jitter = (random() * 2 - 1) * Math.max(0, settings.jitterMs)
      await sleep(Math.max(0, settings.intervalMs + jitter), settings.signal)
    }
  }
}

export async function* streamMockReply(
  prompt: string,
  options: MockReplyOptions = {},
): AsyncGenerator<string, void, undefined> {
  const response = await resolveMockReply(prompt, options)
  yield* streamText(response, options)
}

export async function simulateMockReply(
  prompt: string,
  onChunk: (delta: string, accumulated: string) => void,
  options: MockReplyOptions = {},
): Promise<string> {
  let accumulated = ''

  for await (const delta of streamMockReply(prompt, options)) {
    accumulated += delta
    onChunk(delta, accumulated)
  }

  return accumulated
}
