export type ChatThinkingEffort = 'min' | 'standard' | 'extended' | 'xhigh' | 'max'

export interface ChatModelPreference {
  modelSlug: string | null
  thinkingEffort: ChatThinkingEffort | null
}

export class ModelPreferenceError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status = 0, code = 'model_preference_request_failed') {
    super(message)
    this.name = 'ModelPreferenceError'
    this.status = status
    this.code = code
  }
}

const THINKING_EFFORTS = new Set<ChatThinkingEffort>([
  'min',
  'standard',
  'extended',
  'xhigh',
  'max',
])
const MODEL_SLUG = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalize(value: unknown): ChatModelPreference {
  const payload = isRecord(value) ? value : {}
  const raw = isRecord(payload.preference) ? payload.preference : payload
  const effort = typeof raw.thinkingEffort === 'string'
    && THINKING_EFFORTS.has(raw.thinkingEffort as ChatThinkingEffort)
    ? raw.thinkingEffort as ChatThinkingEffort
    : null
  return {
    modelSlug: typeof raw.modelSlug === 'string' && MODEL_SLUG.test(raw.modelSlug)
      ? raw.modelSlug
      : null,
    thinkingEffort: effort,
  }
}

async function request(init?: RequestInit): Promise<ChatModelPreference> {
  let response: Response
  try {
    response = await fetch('/api/account/model-preference', {
      ...init,
      cache: 'no-store',
      credentials: 'include',
      headers: { Accept: 'application/json', ...init?.headers },
    })
  } catch {
    throw new ModelPreferenceError('无法连接本地模型设置服务。')
  }

  let payload: unknown = null
  try {
    const text = await response.text()
    payload = text ? JSON.parse(text) as unknown : null
  } catch {
    payload = null
  }
  if (!response.ok) {
    const record = isRecord(payload) ? payload : {}
    const error = isRecord(record.error) ? record.error : {}
    throw new ModelPreferenceError(
      typeof error.message === 'string' ? error.message : '模型和思考强度保存失败。',
      response.status,
      typeof error.code === 'string' ? error.code : 'model_preference_request_failed',
    )
  }
  return normalize(payload)
}

export function getChatModelPreference() {
  return request()
}

export function patchChatModelPreference(
  modelSlug: string,
  thinkingEffort?: ChatThinkingEffort,
) {
  return request({
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelSlug, ...(thinkingEffort ? { thinkingEffort } : {}) }),
  })
}
