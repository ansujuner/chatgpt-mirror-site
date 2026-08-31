export type AccountPlan =
  | 'free'
  | 'plus'
  | 'pro'
  | 'go'
  | 'business'
  | 'enterprise'
  | 'edu'
  | 'unknown'

export type SessionAccount = {
  id: string
  name: string
  email: string
  initials: string
  /** Stable entitlement key used to select the matching product experience. */
  plan: AccountPlan
  planLabel: string
  avatarUrl?: string
}

export type AuthSessionSnapshot = {
  authenticated: boolean
  user: SessionAccount | null
}

export type RuntimeThinkingEffort = {
  value: string
  label: string
  fullLabel: string
  mobileFullLabel: string
  description: string
}

export type RuntimeModel = {
  slug: string
  title: string
  description: string
  reasoningType: string
  configurableThinkingEffort: boolean
  thinkingEfforts: RuntimeThinkingEffort[]
  defaultServiceTier: string
  serviceTierOptions: string[]
  enabledTools: string[]
  tags: string[]
}

export type RuntimeCategory = {
  category: string
  defaultModel: string
  name: string
  shortName: string
  subscriptionLevel: string
  modelLane: string
  supportedModels: string[]
  supportedFeatures: string[]
}

export type RuntimePreset = {
  id: number | null
  title: string
  selectedTitle: string
  modelSlug: string
  thinkingEffort: string
  lane: string
  presetType: string
  upgradePlanType: string
  defaultServiceTier: string
  serviceTierOptions: string[]
}

export type RuntimeVersion = {
  id: string
  displayText: string
  fullDisplayText: string
  intelligenceDisplayText: string
  shortIntelligenceDisplayText: string
  enabled: boolean
  slugs: string[]
  presets: RuntimePreset[]
}

export type RuntimeModelSurface = {
  defaultModel: string
  title: string
  secondaryTitle: string
  categories: RuntimeCategory[]
  models: RuntimeModel[]
  versions: RuntimeVersion[]
}

export type AccountRuntime = {
  plan: AccountPlan
  planLabel: string
  features: string[]
  chat: RuntimeModelSurface
  work: RuntimeModelSurface
  conversation: {
    defaultModel: string
    intendedDefaultModel: string
    blockedFeatures: string[]
    modelLimits: Array<Record<string, boolean | number | string | null>>
    atlasModeEnabled: boolean
  }
}

export type AccountRuntimeSnapshot = {
  authenticated: boolean
  user: SessionAccount | null
  runtime: AccountRuntime | null
}

export class AuthSessionError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status = 0, code = '') {
    super(message)
    this.name = 'AuthSessionError'
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

const PLAN_LABELS: Record<Exclude<AccountPlan, 'unknown'>, string> = {
  free: '免费版',
  plus: 'Plus',
  pro: 'Pro',
  go: 'Go',
  business: 'Business',
  enterprise: 'Enterprise',
  edu: 'Edu',
}

export function normalizeAccountPlan(value: unknown): AccountPlan {
  const raw = stringValue(value)
  const normalized = raw.toLocaleLowerCase().replace(/[\s_-]+/g, '')
  if (!normalized) return 'unknown'
  if (normalized === 'free' || normalized === '免费' || normalized === '免费版') return 'free'
  if (normalized === 'plus' || normalized === 'chatgptplus') return 'plus'
  if (normalized === 'pro' || normalized === 'chatgptpro') return 'pro'
  if (normalized === 'go' || normalized === 'chatgptgo') return 'go'
  if (normalized === 'team' || normalized === 'business' || normalized === 'chatgptbusiness') return 'business'
  if (normalized === 'enterprise' || normalized === 'chatgptenterprise') return 'enterprise'
  if (normalized === 'edu' || normalized === 'education' || normalized === 'chatgptedu') return 'edu'
  return 'unknown'
}

function planPresentation(value: unknown, fallbackValue?: unknown) {
  const primaryRaw = stringValue(value)
  if (primaryRaw) {
    const plan = normalizeAccountPlan(primaryRaw)
    if (plan !== 'unknown') return { plan, label: PLAN_LABELS[plan] }
  }

  const fallbackRaw = stringValue(fallbackValue)
  if (fallbackRaw) {
    const fallbackPlan = normalizeAccountPlan(fallbackRaw)
    if (fallbackPlan !== 'unknown') return { plan: fallbackPlan, label: PLAN_LABELS[fallbackPlan] }
  }

  const raw = primaryRaw || fallbackRaw
  return { plan: 'unknown' as const, label: raw.slice(0, 40) || '免费版' }
}

function initialsFor(name: string, email: string) {
  const source = name || email.split('@')[0] || 'U'
  const parts = source.split(/[\s._-]+/).filter(Boolean)
  if (parts.length > 1) {
    return `${parts[0]?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}`.toLocaleUpperCase().slice(0, 2)
  }
  return Array.from(source).slice(0, 2).join('').toLocaleUpperCase()
}

function normalizeAccount(value: unknown): SessionAccount | null {
  const account = asRecord(value)
  if (!account) return null

  const email = stringValue(account.email)
  const name = stringValue(account.name) || email.split('@')[0] || 'ChatGPT 用户'
  // Newer bridges return both a canonical `plan` and a presentation label.
  // Older builds returned only one of planLabel/planType, so keep both paths.
  const planValue = account.plan ?? account.planType ?? account.plan_type
  const labelValue = account.planLabel ?? account.plan_label
  const plan = planPresentation(planValue, labelValue)
  const avatarUrl = stringValue(account.avatarUrl ?? account.avatar_url ?? account.picture)

  return {
    id: stringValue(account.id) || 'session-account',
    name,
    email,
    initials: stringValue(account.initials).slice(0, 2) || initialsFor(name, email),
    plan: plan.plan,
    planLabel: plan.label,
    ...(avatarUrl ? { avatarUrl } : {}),
  }
}

function normalizeSnapshot(value: unknown): AuthSessionSnapshot {
  const payload = asRecord(value)
  if (!payload) return { authenticated: false, user: null }

  const user = normalizeAccount(payload.user ?? payload.account)
  const authenticated = payload.authenticated === true && Boolean(user)
  return { authenticated, user: authenticated ? user : null }
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const text = stringValue(item)
    return text ? [text] : []
  })
}

function normalizeModelSurface(value: unknown): RuntimeModelSurface {
  const surface = asRecord(value) ?? {}
  const categories = Array.isArray(surface.categories) ? surface.categories.flatMap((item) => {
    const category = asRecord(item)
    if (!category) return []
    return [{
      category: stringValue(category.category),
      defaultModel: stringValue(category.defaultModel),
      name: stringValue(category.name),
      shortName: stringValue(category.shortName),
      subscriptionLevel: stringValue(category.subscriptionLevel),
      modelLane: stringValue(category.modelLane),
      supportedModels: stringArray(category.supportedModels),
      supportedFeatures: stringArray(category.supportedFeatures),
    }]
  }) : []
  const models = Array.isArray(surface.models) ? surface.models.flatMap((item) => {
    const model = asRecord(item)
    if (!model) return []
    const slug = stringValue(model.slug)
    if (!slug) return []
    const thinkingEfforts = Array.isArray(model.thinkingEfforts) ? model.thinkingEfforts.flatMap((effortValue) => {
      const effort = asRecord(effortValue)
      if (!effort) return []
      return [{
        value: stringValue(effort.value),
        label: stringValue(effort.label),
        fullLabel: stringValue(effort.fullLabel),
        mobileFullLabel: stringValue(effort.mobileFullLabel),
        description: stringValue(effort.description),
      }]
    }) : []
    return [{
      slug,
      title: stringValue(model.title) || slug,
      description: stringValue(model.description),
      reasoningType: stringValue(model.reasoningType),
      configurableThinkingEffort: model.configurableThinkingEffort === true,
      thinkingEfforts,
      defaultServiceTier: stringValue(model.defaultServiceTier),
      serviceTierOptions: stringArray(model.serviceTierOptions),
      enabledTools: stringArray(model.enabledTools),
      tags: stringArray(model.tags),
    }]
  }) : []
  const versions = Array.isArray(surface.versions) ? surface.versions.flatMap((item) => {
    const version = asRecord(item)
    if (!version) return []
    const presets = Array.isArray(version.presets) ? version.presets.flatMap((presetValue) => {
      const preset = asRecord(presetValue)
      if (!preset) return []
      return [{
        id: typeof preset.id === 'number' ? preset.id : null,
        title: stringValue(preset.title),
        selectedTitle: stringValue(preset.selectedTitle),
        modelSlug: stringValue(preset.modelSlug),
        thinkingEffort: stringValue(preset.thinkingEffort),
        lane: stringValue(preset.lane),
        presetType: stringValue(preset.presetType),
        upgradePlanType: stringValue(preset.upgradePlanType),
        defaultServiceTier: stringValue(preset.defaultServiceTier),
        serviceTierOptions: stringArray(preset.serviceTierOptions),
      }]
    }) : []
    return [{
      id: stringValue(version.id),
      displayText: stringValue(version.displayText),
      fullDisplayText: stringValue(version.fullDisplayText),
      intelligenceDisplayText: stringValue(version.intelligenceDisplayText),
      shortIntelligenceDisplayText: stringValue(version.shortIntelligenceDisplayText),
      enabled: version.enabled !== false,
      slugs: stringArray(version.slugs),
      presets,
    }]
  }) : []

  return {
    defaultModel: stringValue(surface.defaultModel),
    title: stringValue(surface.title),
    secondaryTitle: stringValue(surface.secondaryTitle),
    categories,
    models,
    versions,
  }
}

function normalizeRuntime(value: unknown): AccountRuntime | null {
  const runtime = asRecord(value)
  if (!runtime) return null
  const conversation = asRecord(runtime.conversation) ?? {}
  const rawLimits = Array.isArray(conversation.modelLimits) ? conversation.modelLimits : []
  const modelLimits = rawLimits.flatMap((item) => {
    const limit = asRecord(item)
    if (!limit) return []
    const safe: Record<string, boolean | number | string | null> = {}
    for (const [key, nested] of Object.entries(limit)) {
      if (nested === null || ['boolean', 'number', 'string'].includes(typeof nested)) {
        safe[key] = nested as boolean | number | string | null
      }
    }
    return [safe]
  })
  const plan = normalizeAccountPlan(runtime.plan)
  return {
    plan,
    planLabel: stringValue(runtime.planLabel),
    features: stringArray(runtime.features),
    chat: normalizeModelSurface(runtime.chat),
    work: normalizeModelSurface(runtime.work),
    conversation: {
      defaultModel: stringValue(conversation.defaultModel),
      intendedDefaultModel: stringValue(conversation.intendedDefaultModel),
      blockedFeatures: stringArray(conversation.blockedFeatures),
      modelLimits,
      atlasModeEnabled: conversation.atlasModeEnabled === true,
    },
  }
}

function messageForStatus(status: number) {
  if (status === 400 || status === 422) return 'Session 格式不正确，请粘贴完整的 Session JSON、Bearer Token 或 Cookie 字符串。'
  if (status === 401 || status === 403) return 'Session 无效或已过期，请重新获取后再试。'
  if (status === 408 || status === 504) return '验证 Session 超时，请稍后重试。'
  if (status === 429) return '验证请求过于频繁，请稍后重试。'
  if (status >= 500) return '本地服务暂时无法验证 Session，请稍后重试。'
  return 'Session 登录失败，请检查内容后重试。'
}

function backendError(payload: unknown) {
  const root = asRecord(payload)
  const error = asRecord(root?.error)
  if (!error) return null

  // The bridge only returns credential-safe messages. Still keep the client
  // defensive: never render control characters or an unbounded upstream body.
  const rawMessage = stringValue(error.message)
  const hasControlCharacters = Array.from(rawMessage).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint < 0x20 || codePoint === 0x7f
  })
  const message = rawMessage && rawMessage.length <= 300 && !hasControlCharacters
    ? rawMessage
    : ''
  const rawCode = stringValue(error.code)
  const code = /^[a-z][a-z0-9_]{0,79}$/i.test(rawCode) ? rawCode : ''
  return message || code ? { message, code } : null
}

function responseErrorMessage(status: number, payload: unknown) {
  const backend = backendError(payload)
  if (backend?.message) {
    const diagnostics = [`HTTP ${status}`, backend.code].filter(Boolean).join(' · ')
    return {
      message: diagnostics ? `${backend.message}（${diagnostics}）` : backend.message,
      code: backend.code,
    }
  }
  if (status >= 500) {
    return {
      message: `本地 Session 接口请求失败（HTTP ${status}），但没有返回可识别的错误详情。请确认后端健康检查正常后重试。`,
      code: '',
    }
  }
  return { message: messageForStatus(status), code: backend?.code ?? '' }
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

async function request(path: string, init?: RequestInit) {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      cache: 'no-store',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...init?.headers,
      },
    })
  } catch (error) {
    const cause = error instanceof Error && error.name ? `（${error.name}）` : ''
    throw new AuthSessionError(`无法连接本地 Session 服务${cause}，请确认后端已经启动，并访问 /api/health 检查代理连接。`)
  }

  const payload = await readJson(response)
  if (!response.ok) {
    const failure = responseErrorMessage(response.status, payload)
    throw new AuthSessionError(failure.message, response.status, failure.code)
  }
  return payload
}

export async function getAuthSession(): Promise<AuthSessionSnapshot> {
  try {
    return normalizeSnapshot(await request('/api/auth/session'))
  } catch (error) {
    if (error instanceof AuthSessionError && (error.status === 401 || error.status === 403)) {
      return { authenticated: false, user: null }
    }
    throw error
  }
}

export async function getAccountRuntime(): Promise<AccountRuntimeSnapshot> {
  const payload = asRecord(await request('/api/account/runtime'))
  if (!payload) return { authenticated: false, user: null, runtime: null }
  const user = normalizeAccount(payload.user ?? payload.account)
  const runtime = normalizeRuntime(payload.runtime)
  const authenticated = payload.authenticated === true && Boolean(user) && Boolean(runtime)
  return {
    authenticated,
    user: authenticated ? user : null,
    runtime: authenticated ? runtime : null,
  }
}

export async function loginWithSession(session: string): Promise<AuthSessionSnapshot> {
  const value = session.trim()
  if (!value) throw new AuthSessionError('请输入 Session。', 400)
  if (value.length > 60_000) throw new AuthSessionError('Session 内容过长，请检查后重试。', 400)

  const snapshot = normalizeSnapshot(await request('/api/auth/session-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: value }),
  }))
  if (!snapshot.authenticated || !snapshot.user) {
    throw new AuthSessionError('Session 已验证，但没有返回可用的账号信息。', 502)
  }
  return snapshot
}

/**
 * Submit an upstream Session and then re-read the opaque local HttpOnly
 * session. The POST response proves that the credential was accepted, while
 * the second request is the authoritative account/plan snapshot the UI will
 * hydrate. Keeping this sequence here also makes it harder for callers to
 * accidentally render account entitlements from only the write response.
 */
export async function loginWithSessionAndHydrate(session: string): Promise<AuthSessionSnapshot> {
  const submitted = await loginWithSession(session)
  const hydrated = await getAuthSession()
  if (!hydrated.authenticated || !hydrated.user) {
    throw new AuthSessionError(
      'Session 已验证，但本地登录状态尚未生效，请重新登录。',
      502,
      'session_not_hydrated',
    )
  }
  if (!submitted.user || hydrated.user.id !== submitted.user.id) {
    throw new AuthSessionError(
      'Session 登录结果与当前本地账号不一致，请重新登录。',
      409,
      'session_account_mismatch',
    )
  }
  return hydrated
}

export async function logoutAuthSession() {
  await request('/api/auth/logout', { method: 'POST' })
}

export function authSessionErrorMessage(error: unknown) {
  return error instanceof AuthSessionError
    ? error.message
    : 'Session 登录失败，请稍后重试。'
}
