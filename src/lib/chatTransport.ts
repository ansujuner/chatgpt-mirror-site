import type { ChatMessage } from '../types'
import { streamMockReply } from './mockStream'
import type { MockReplyOptions } from './mockStream'

export type StreamChatReplyOptions = Omit<MockReplyOptions, 'messages'> & {
  attachments?: readonly File[]
  conversationId?: string
  /** @deprecated Prefer the endpoint-native `serviceTier`. */
  fastMode?: boolean
  model?: string
  onConversationId?: (conversationId: string) => void
  reasoningEffort?: 'min' | 'standard' | 'extended' | 'xhigh' | 'max'
  serviceTier?: 'standard' | 'fast'
}

type ChatCompletionContentPart =
  | { type: 'text'; text: string }
  | {
      type: 'image_url'
      image_url: { url: string; filename: string; width: number; height: number }
    }
  | { type: 'file'; file: { filename: string; file_data: string } }

interface ChatCompletionRequestMessage {
  role: ChatMessage['role']
  content: string | ChatCompletionContentPart[]
}

interface ParsedSseEvent {
  content?: string
  done: boolean
}

const MAX_ATTACHMENT_FILES = 10
const MAX_ATTACHMENT_FILE_BYTES = 25 * 1024 * 1024
const MAX_ATTACHMENT_TOTAL_BYTES = 50 * 1024 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function createAbortError(): Error {
  const error = new Error('聊天请求已取消')
  error.name = 'AbortError'
  return error
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function getApiError(payload: unknown): string | undefined {
  if (!isRecord(payload) || !isRecord(payload.error)) return undefined
  return typeof payload.error.message === 'string'
    ? payload.error.message
    : undefined
}

function getDeltaContent(payload: unknown): string | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return undefined

  const firstChoice: unknown = payload.choices[0]
  if (!isRecord(firstChoice) || !isRecord(firstChoice.delta)) return undefined

  return typeof firstChoice.delta.content === 'string'
    ? firstChoice.delta.content
    : undefined
}

function parseSseEvent(rawEvent: string): ParsedSseEvent {
  const data = rawEvent
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n')

  if (!data) return { done: false }
  if (data.trim() === '[DONE]') return { done: true }

  let payload: unknown
  try {
    payload = JSON.parse(data)
  } catch {
    throw new Error('聊天接口返回了无法解析的 SSE 数据')
  }

  const apiError = getApiError(payload)
  if (apiError) throw new Error(`聊天接口返回错误：${apiError}`)

  return { content: getDeltaContent(payload), done: false }
}

function drainSseEvents(buffer: string): {
  events: string[]
  remainder: string
} {
  const events: string[] = []
  let remainder = buffer
  let boundary = remainder.match(/\r?\n\r?\n/)

  while (boundary?.index !== undefined) {
    events.push(remainder.slice(0, boundary.index))
    remainder = remainder.slice(boundary.index + boundary[0].length)
    boundary = remainder.match(/\r?\n\r?\n/)
  }

  return { events, remainder }
}

function readHttpErrorDetail(rawBody: string): string | undefined {
  const body = rawBody.trim()
  if (!body) return undefined

  try {
    const parsed: unknown = JSON.parse(body)
    const apiError = getApiError(parsed)
    if (apiError) return apiError
  } catch {
    // Non-JSON errors (for example, an HTML proxy error) are summarized below.
  }

  return body.replace(/\s+/g, ' ').slice(0, 300)
}

function latestUserPrompt(messages: readonly ChatMessage[]): string {
  return (
    messages.findLast((message) => message.role === 'user')?.content ??
    messages.at(-1)?.content ??
    ''
  )
}

async function fileToDataUrl(file: File, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw createAbortError()
  if (file.size <= 0) throw new Error(`附件“${file.name}”为空，无法上传`)
  if (file.size > MAX_ATTACHMENT_FILE_BYTES) {
    throw new Error(`附件“${file.name}”超过 25 MB 的单文件限制`)
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (signal?.aborted) throw createAbortError()

  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return `data:${file.type || 'application/octet-stream'};base64,${window.btoa(binary)}`
}

async function getImageDimensions(
  file: File,
  signal?: AbortSignal,
): Promise<{ width: number; height: number }> {
  if (signal?.aborted) throw createAbortError()
  let bitmap: ImageBitmap
  try {
    bitmap = await window.createImageBitmap(file)
  } catch {
    throw new Error(`无法读取图片“${file.name}”的尺寸，请换一张有效图片后重试`)
  }
  try {
    if (signal?.aborted) throw createAbortError()
    if (bitmap.width <= 0 || bitmap.height <= 0) {
      throw new Error(`图片“${file.name}”的尺寸无效`)
    }
    return { width: bitmap.width, height: bitmap.height }
  } finally {
    bitmap.close()
  }
}

async function buildRequestMessages(
  messages: readonly ChatMessage[],
  attachments: readonly File[],
  signal?: AbortSignal,
): Promise<ChatCompletionRequestMessage[]> {
  const latestUserIndex = messages.findLastIndex((message) => message.role === 'user')
  const requestMessages: ChatCompletionRequestMessage[] = messages.map(({ role, content }) => ({ role, content }))
  if (latestUserIndex < 0 || attachments.length === 0) return requestMessages
  if (attachments.length > MAX_ATTACHMENT_FILES) {
    throw new Error(`一次最多上传 ${MAX_ATTACHMENT_FILES} 个附件`)
  }
  const totalBytes = attachments.reduce((total, file) => total + file.size, 0)
  if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
    throw new Error('附件总大小超过 50 MB 的限制')
  }

  const content: ChatCompletionContentPart[] = []
  const prompt = messages[latestUserIndex].content.trim()
  if (prompt) content.push({ type: 'text', text: prompt })

  for (const file of attachments) {
    if (file.type.startsWith('image/')) {
      const dimensions = await getImageDimensions(file, signal)
      const dataUrl = await fileToDataUrl(file, signal)
      content.push({
        type: 'image_url',
        image_url: {
          url: dataUrl,
          filename: file.name,
          width: dimensions.width,
          height: dimensions.height,
        },
      })
    } else {
      const dataUrl = await fileToDataUrl(file, signal)
      content.push({ type: 'file', file: { filename: file.name, file_data: dataUrl } })
    }
  }

  requestMessages[latestUserIndex] = {
    role: messages[latestUserIndex].role,
    content,
  }
  return requestMessages
}

/**
 * Streams either a local mock reply or an OpenAI-compatible SSE response.
 *
 * `VITE_CHAT_API_TOKEN` is supported for short-lived/local tokens only. Because
 * every `VITE_*` value is bundled into browser code, never put a private API key
 * there; production deployments should proxy requests through their own server.
 */
export async function* streamChatReply(
  messages: readonly ChatMessage[],
  options: StreamChatReplyOptions = {},
): AsyncGenerator<string, void, undefined> {
  const configuredApiUrl = import.meta.env.VITE_CHAT_API_URL?.trim()
  const apiMode = import.meta.env.VITE_CHAT_API_MODE?.trim().toLowerCase()
  const useMock = apiMode === 'mock' || configuredApiUrl?.toLowerCase() === 'mock'

  if (useMock) {
    yield* streamMockReply(latestUserPrompt(messages), {
      ...options,
      messages,
    })
    return
  }

  const apiUrl = configuredApiUrl || '/api/chat/completions'
  const model = options.model?.trim() || import.meta.env.VITE_CHAT_MODEL?.trim() || 'chatgpt-guest'

  if (options.signal?.aborted) throw createAbortError()

  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
  }
  const token = import.meta.env.VITE_CHAT_API_TOKEN?.trim()
  if (token) headers.Authorization = `Bearer ${token}`
  const conversationId = options.conversationId?.trim()
  if (conversationId) headers['X-Conversation-Id'] = conversationId

  let response: Response
  try {
    const requestMessages = await buildRequestMessages(messages, options.attachments ?? [], options.signal)
    response = await fetch(apiUrl, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({
        model,
        messages: requestMessages,
        ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
        ...(options.serviceTier
          ? { service_tier: options.serviceTier }
          : options.fastMode ? { service_tier: 'fast' } : {}),
        stream: true,
      }),
      signal: options.signal,
    })
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) throw createAbortError()
    throw new Error(`无法连接聊天接口：${getErrorMessage(error)}`)
  }

  if (!response.ok) {
    let detail: string | undefined
    try {
      detail = readHttpErrorDetail(await response.text())
    } catch {
      detail = undefined
    }

    const suffix = detail ? `：${detail}` : ''
    throw new Error(`聊天接口请求失败（HTTP ${response.status}）${suffix}`)
  }

  const responseConversationId = response.headers.get('X-Conversation-Id')?.trim()
  if (responseConversationId) options.onConversationId?.(responseConversationId)

  if (!response.body) throw new Error('聊天接口未返回可读取的流式响应')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      let result: ReadableStreamReadResult<Uint8Array>
      try {
        result = await reader.read()
      } catch (error) {
        if (options.signal?.aborted || isAbortError(error)) {
          throw createAbortError()
        }
        throw new Error(`读取聊天响应失败：${getErrorMessage(error)}`)
      }

      if (result.done) break

      buffer += decoder.decode(result.value, { stream: true })
      const drained = drainSseEvents(buffer)
      buffer = drained.remainder

      for (const rawEvent of drained.events) {
        const event = parseSseEvent(rawEvent)
        if (event.done) {
          await reader.cancel()
          return
        }
        if (event.content) yield event.content
      }
    }

    buffer += decoder.decode()
    if (buffer.trim()) {
      const event = parseSseEvent(buffer)
      if (event.content) yield event.content
    }
  } finally {
    reader.releaseLock()
  }
}
