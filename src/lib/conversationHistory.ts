export type ConversationSummaryDto = {
  id: string
  title: string
  createdAt: string | null
  updatedAt: string | null
}

export type ConversationMessageDto = {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string | null
}

export type ConversationDetailDto = {
  conversation: ConversationSummaryDto
  messages: ConversationMessageDto[]
  /** Local bridge handle accepted by X-Conversation-Id. */
  continuationId: string
}

export type ConversationPageDto = {
  items: ConversationSummaryDto[]
  nextCursor: string | null
}

export class ConversationHistoryError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status = 0, code = 'history_request_failed') {
    super(message)
    this.name = 'ConversationHistoryError'
    this.status = status
    this.code = code
  }
}

type JsonRecord = Record<string, unknown>

const HISTORY_NETWORK_ATTEMPTS = 2

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function optionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeConversation(value: unknown): ConversationSummaryDto | null {
  const item = asRecord(value)
  const id = optionalText(item?.id)
  const title = optionalText(item?.title)
  if (!id || !title) return null
  return {
    id,
    title,
    createdAt: optionalText(item?.createdAt),
    updatedAt: optionalText(item?.updatedAt),
  }
}

function normalizeMessage(value: unknown): ConversationMessageDto | null {
  const item = asRecord(value)
  const id = optionalText(item?.id)
  const role = item?.role
  if (!id || (role !== 'user' && role !== 'assistant') || typeof item?.content !== 'string') return null
  return {
    id,
    role,
    content: item.content,
    createdAt: optionalText(item.createdAt),
  }
}

function errorFromResponse(payload: unknown, status: number) {
  const root = asRecord(payload)
  const error = asRecord(root?.error)
  const code = optionalText(error?.code) ?? 'history_request_failed'
  const message = optionalText(error?.message)
    ?? optionalText(root?.message)
    ?? optionalText(root?.detail)
    ?? (status === 401
      ? '当前 Session 已失效，无法加载聊天记录。'
      : status === 403
        ? '当前账号暂不允许读取聊天记录。'
        : `聊天记录请求失败（HTTP ${status}）。`)
  return new ConversationHistoryError(message, status, code)
}

function waitForRetry(milliseconds: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(signal.reason)
  return new Promise<void>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    const onAbort = () => {
      globalThis.clearTimeout(timer)
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function request(path: string, signal?: AbortSignal) {
  for (let attempt = 0; attempt < HISTORY_NETWORK_ATTEMPTS; attempt += 1) {
    let response: Response
    try {
      response = await fetch(path, {
        cache: 'no-store',
        credentials: 'include',
        headers: { Accept: 'application/json' },
        signal,
      })
    } catch (error) {
      if (signal?.aborted) throw error
      if (attempt + 1 >= HISTORY_NETWORK_ATTEMPTS) {
        throw new ConversationHistoryError('无法连接本地聊天记录服务。')
      }
      await waitForRetry(100, signal)
      continue
    }
    // The bridge already retries safe upstream GETs. Retrying its HTTP status
    // again here would multiply requests (and can worsen a real 429). Only a
    // browser-level network failure is replayed by this client.
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok) throw errorFromResponse(payload, response.status)
    return payload
  }
  throw new ConversationHistoryError('无法连接本地聊天记录服务。')
}

export async function getConversationPage(
  { cursor, limit = 50 }: { cursor?: string | null; limit?: number } = {},
  signal?: AbortSignal,
): Promise<ConversationPageDto> {
  const params = new URLSearchParams({ limit: String(Math.min(50, Math.max(1, Math.trunc(limit)))) })
  if (cursor) params.set('cursor', cursor)
  const payload = asRecord(await request(`/api/conversations?${params.toString()}`, signal))
  if (!payload || !Array.isArray(payload.items)) {
    throw new ConversationHistoryError('聊天记录接口返回了无效数据。', 502, 'history_invalid_response')
  }
  return {
    items: payload.items.flatMap((item) => {
      const normalized = normalizeConversation(item)
      return normalized ? [normalized] : []
    }),
    nextCursor: optionalText(payload.nextCursor),
  }
}

export async function getConversationHistory(signal?: AbortSignal) {
  const items: ConversationSummaryDto[] = []
  const ids = new Set<string>()
  const cursors = new Set<string>()
  let cursor: string | null = null

  // Keep a finite client-side ceiling while still loading substantially more
  // than the first sidebar viewport. The opaque server cursor remains private
  // to this fetch loop and is never stored in browser history.
  for (let pageIndex = 0; pageIndex < 5; pageIndex += 1) {
    let page: ConversationPageDto
    try {
      page = await getConversationPage({ cursor, limit: 50 }, signal)
    } catch (error) {
      if (signal?.aborted || items.length === 0) throw error
      // A later page is optional sidebar enrichment. Keep the already loaded
      // first page after exhausted transient retries instead of replacing the
      // entire authenticated history with an error state.
      if (
        !(error instanceof ConversationHistoryError)
        || error.status === 401
        || error.status === 403
      ) throw error
      break
    }
    for (const item of page.items) {
      if (ids.has(item.id)) continue
      ids.add(item.id)
      items.push(item)
    }
    if (!page.nextCursor || cursors.has(page.nextCursor)) break
    cursors.add(page.nextCursor)
    cursor = page.nextCursor
  }
  return items
}

export async function getConversationDetail(id: string, signal?: AbortSignal): Promise<ConversationDetailDto> {
  const localId = id.trim()
  if (!localId) throw new ConversationHistoryError('聊天记录 ID 为空。', 400, 'conversation_id_required')
  const payload = asRecord(await request(`/api/conversations/${encodeURIComponent(localId)}`, signal))
  const conversation = normalizeConversation(payload?.conversation)
  const continuationId = optionalText(payload?.continuationId)
  if (!payload || !conversation || !continuationId || !Array.isArray(payload.messages)) {
    throw new ConversationHistoryError('聊天详情接口返回了无效数据。', 502, 'history_invalid_response')
  }
  return {
    conversation,
    messages: payload.messages.flatMap((message) => {
      const normalized = normalizeMessage(message)
      return normalized ? [normalized] : []
    }),
    continuationId,
  }
}

export function conversationHistoryErrorMessage(error: unknown) {
  return error instanceof ConversationHistoryError
    ? error.message
    : '聊天记录暂不可用，请稍后重试。'
}
