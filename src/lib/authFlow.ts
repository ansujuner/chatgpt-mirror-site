import type { SessionAccount } from './authSession'

export type AuthLoginProvider = 'google' | 'apple' | 'phone' | 'email'
export type AuthLoginStatus = 'pending' | 'authenticated' | 'failed' | 'expired'

export type StartedAuthLogin = {
  flowId: string
  provider: AuthLoginProvider
  status: 'pending'
  authorizationUrl: string
  expiresIn: number
  pollAfterMs: number
}

export type PendingAuthLogin = {
  flowId: string
  status: 'pending'
  pollAfterMs: number
}

export type CompletedAuthLogin = {
  flowId: string
  provider: AuthLoginProvider
  status: 'authenticated'
  user: SessionAccount
  callbackPath: string
}

export type AuthLoginCompletion = PendingAuthLogin | CompletedAuthLogin

export class AuthFlowError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status = 0, code = '') {
    super(message)
    this.name = 'AuthFlowError'
    this.status = status
    this.code = code
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function safeCallbackPath(value: unknown) {
  const path = stringValue(value)
  if (!path || !path.startsWith('/') || path.startsWith('//')) return '/'
  return path.slice(0, 2_048)
}

function normalizeFlowId(value: unknown) {
  const flowId = stringValue(value)
  if (!flowId || flowId.length > 256 || !/^[a-zA-Z0-9._~-]+$/.test(flowId)) {
    throw new AuthFlowError('登录服务返回了无效的流程标识，请重新开始登录。', 502, 'invalid_flow_id')
  }
  return flowId
}

function normalizePollAfterMs(value: unknown) {
  const milliseconds = Math.round(numberValue(value))
  return Math.min(10_000, Math.max(500, milliseconds || 1_000))
}

function normalizeProvider(value: unknown) {
  const provider = stringValue(value)
  if (provider === 'google' || provider === 'apple' || provider === 'phone' || provider === 'email') return provider
  throw new AuthFlowError('登录服务返回了无效的登录方式。', 502, 'invalid_provider')
}

function normalizeAuthorizationUrl(value: unknown) {
  const raw = stringValue(value)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new AuthFlowError('登录服务没有返回有效的官方授权地址。', 502, 'invalid_authorization_url')
  }
  if (
    url.origin.toLocaleLowerCase() !== 'https://auth.openai.com'
    || Boolean(url.username)
    || Boolean(url.password)
  ) {
    throw new AuthFlowError('登录服务返回了非官方授权地址，已阻止跳转。', 502, 'untrusted_authorization_url')
  }
  return url.toString()
}

function normalizeAccount(value: unknown): SessionAccount {
  const user = asRecord(value)
  const id = stringValue(user?.id)
  const plan = stringValue(user?.plan).toLocaleLowerCase()
  if (!user || !id || !['free', 'plus', 'pro', 'go', 'business', 'enterprise', 'edu', 'unknown'].includes(plan)) {
    throw new AuthFlowError('登录已经完成，但服务没有返回有效的账号信息。', 502, 'invalid_account')
  }
  const name = stringValue(user.name) || 'ChatGPT 用户'
  const email = stringValue(user.email)
  const initials = stringValue(user.initials).slice(0, 2)
    || Array.from(name || email || 'U').slice(0, 2).join('').toLocaleUpperCase()
  const avatarUrl = stringValue(user.avatarUrl ?? user.avatar_url)
  return {
    id,
    name,
    email,
    initials,
    plan: plan as SessionAccount['plan'],
    planLabel: stringValue(user.planLabel ?? user.plan_label) || plan,
    ...(avatarUrl ? { avatarUrl } : {}),
  }
}

function safeBackendError(payload: unknown) {
  const root = asRecord(payload)
  const error = asRecord(root?.error)
  const rawMessage = stringValue(error?.message)
  const hasControlCharacters = Array.from(rawMessage).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint < 0x20 || codePoint === 0x7f
  })
  const message = rawMessage.length <= 300 && !hasControlCharacters
    ? rawMessage
    : ''
  const rawCode = stringValue(error?.code)
  const code = /^[a-z][a-z0-9_]{0,79}$/i.test(rawCode) ? rawCode : ''
  return { message, code }
}

function fallbackMessage(status: number) {
  if (status === 400 || status === 422) return '登录请求不完整，请返回后重新开始。'
  if (status === 401 || status === 403) return '官方登录未完成或已经失效，请重新开始。'
  if (status === 404 || status === 410) return '登录流程已过期，请重新开始。'
  if (status === 408 || status === 504) return '登录服务响应超时，请稍后重试。'
  if (status === 409) return '登录流程状态已变化，请重新检查。'
  if (status === 429) return '登录检查过于频繁，请稍后再试。'
  if (status >= 500) return '本地登录服务暂时不可用，请稍后重试。'
  return '登录失败，请重新开始。'
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

async function request(path: string, init: RequestInit = {}) {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      cache: 'no-store',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...init.headers,
      },
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    const suffix = error instanceof Error && error.name ? `（${error.name}）` : ''
    throw new AuthFlowError(`无法连接本地登录服务${suffix}，请确认后端已经启动。`)
  }

  const payload = await readJson(response)
  if (!response.ok) {
    const backend = safeBackendError(payload)
    throw new AuthFlowError(backend.message || fallbackMessage(response.status), response.status, backend.code)
  }
  return { payload, status: response.status }
}

export async function startAuthLogin({
  provider,
  callbackPath,
  loginHint,
  signal,
}: {
  provider: AuthLoginProvider
  callbackPath: string
  loginHint?: string
  signal?: AbortSignal
}): Promise<StartedAuthLogin> {
  let hint = loginHint?.trim().slice(0, 320) ?? ''
  if (provider === 'phone') {
    hint = hint.replace(/[ ()-]/g, '')
    if (!/^\+[1-9][0-9]{7,14}$/.test(hint)) {
      throw new AuthFlowError('请输入有效的国际电话号码，例如 +86 138 0013 8000。', 400, 'oauth_login_hint_invalid')
    }
  } else if (provider === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hint)) {
    throw new AuthFlowError('请输入有效的邮箱地址后继续。', 400, 'oauth_login_hint_invalid')
  }
  const { payload } = await request('/api/auth/login/start', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider,
      callbackPath: safeCallbackPath(callbackPath),
      ...(hint ? { loginHint: hint } : {}),
    }),
  })
  const value = asRecord(payload)
  if (value?.status !== 'pending') {
    throw new AuthFlowError('登录服务没有创建可用的授权流程。', 502, 'invalid_start_response')
  }
  if (normalizeProvider(value.provider) !== provider) {
    throw new AuthFlowError('登录服务返回的登录方式与请求不一致。', 409, 'provider_mismatch')
  }
  const expiresIn = Math.min(1_800, Math.max(30, Math.round(numberValue(value.expiresIn)) || 600))
  return {
    flowId: normalizeFlowId(value.flowId),
    provider,
    status: 'pending',
    authorizationUrl: normalizeAuthorizationUrl(value.authorizationUrl),
    expiresIn,
    pollAfterMs: normalizePollAfterMs(value.pollAfterMs),
  }
}

export async function completeAuthLogin(flowId: string, signal?: AbortSignal): Promise<AuthLoginCompletion> {
  const normalizedId = normalizeFlowId(flowId)
  const { payload, status } = await request(`/api/auth/login/${encodeURIComponent(normalizedId)}/complete`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const value = asRecord(payload)
  if (status === 202 && value?.status === 'pending') {
    return {
      flowId: normalizeFlowId(value.flowId ?? normalizedId),
      status: 'pending',
      pollAfterMs: normalizePollAfterMs(value.pollAfterMs),
    }
  }
  if (status === 200 && value?.status === 'authenticated') {
    return {
      flowId: normalizeFlowId(value.flowId ?? normalizedId),
      provider: normalizeProvider(value.provider),
      status: 'authenticated',
      user: normalizeAccount(value.user),
      callbackPath: safeCallbackPath(value.callbackPath),
    }
  }
  throw new AuthFlowError('登录服务返回了无法识别的完成状态。', 502, 'invalid_completion_response')
}

export async function cancelAuthLogin(flowId: string, signal?: AbortSignal) {
  const normalizedId = normalizeFlowId(flowId)
  await request(`/api/auth/login/${encodeURIComponent(normalizedId)}`, {
    method: 'DELETE',
    signal,
  })
}

export function authFlowErrorMessage(error: unknown) {
  return error instanceof AuthFlowError ? error.message : '登录失败，请稍后重试。'
}
