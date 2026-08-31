export type UsageAvailability = 'available' | 'unlimited' | 'unavailable'

export type UsageRateWindow = {
  usedPercent: number | null
  remainingPercent: number | null
  windowDurationMins: number | null
  resetsAt: number | string | null
}

export type AccountUsageSnapshot = {
  authenticated: boolean
  live: boolean
  availability: UsageAvailability
  planType: string | null
  quota: {
    remainingPercent: number | null
    primary: UsageRateWindow | null
    secondary: UsageRateWindow | null
    allowed: boolean | null
    limitReached: boolean | null
    resetCredits: { availableCount: number | null }
  }
  message: string | null
}

export class AccountUsageError extends Error {
  readonly status: number

  constructor(message: string, status = 0) {
    super(message)
    this.name = 'AccountUsageError'
    this.status = status
  }
}

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function firstValue(record: JsonRecord | null, ...keys: string[]) {
  if (!record) return undefined
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key]
  }
  return undefined
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function percent(value: unknown) {
  const numeric = finiteNumber(value)
  return numeric === null ? null : Math.min(100, Math.max(0, Math.round(numeric)))
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function normalizeWindow(value: unknown): UsageRateWindow | null {
  const window = asRecord(value)
  if (!window) return null
  let duration = finiteNumber(firstValue(
    window,
    'windowDurationMins',
    'window_duration_mins',
    'limitWindowMinutes',
    'limit_window_minutes',
  ))
  if (duration === null) {
    const seconds = finiteNumber(firstValue(
      window,
      'windowDurationSeconds',
      'window_duration_seconds',
      'limitWindowSeconds',
      'limit_window_seconds',
    ))
    if (seconds !== null) duration = seconds / 60
  }

  const rawReset = firstValue(window, 'resetsAt', 'resets_at', 'resetAt', 'reset_at')
  return {
    usedPercent: percent(firstValue(window, 'usedPercent', 'used_percent')),
    remainingPercent: percent(firstValue(window, 'remainingPercent', 'remaining_percent')),
    windowDurationMins: duration,
    resetsAt: typeof rawReset === 'number' || typeof rawReset === 'string' ? rawReset : null,
  }
}

function errorMessage(payload: unknown, status: number) {
  const root = asRecord(payload)
  const error = asRecord(firstValue(root, 'error'))
  const candidate = firstValue(error, 'message') ?? firstValue(root, 'message', 'detail')
  if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  if (status === 401 || status === 403) return '当前 Session 无法读取用量。'
  return `用量接口请求失败（HTTP ${status}）。`
}

function normalizeUsage(value: unknown): AccountUsageSnapshot {
  const payload = asRecord(value)
  if (!payload) throw new AccountUsageError('用量接口未返回有效 JSON。', 502)
  const quota = asRecord(firstValue(payload, 'quota'))
  const primary = normalizeWindow(firstValue(quota, 'primary'))
  const secondary = normalizeWindow(firstValue(quota, 'secondary'))
  const resetCredits = asRecord(firstValue(quota, 'resetCredits', 'reset_credits'))
  const rawAvailability = firstValue(payload, 'availability')
  const authenticated = payload.authenticated === true
  const live = payload.live === true
  const availability: UsageAvailability = authenticated && live && rawAvailability === 'unlimited'
    ? 'unlimited'
    : authenticated && live && rawAvailability === 'available'
      ? 'available'
      : 'unavailable'
  const rawMessage = firstValue(payload, 'message', 'detail')

  return {
    authenticated,
    live,
    availability,
    planType: typeof firstValue(payload, 'planType', 'plan_type', 'plan') === 'string'
      ? String(firstValue(payload, 'planType', 'plan_type', 'plan'))
      : null,
    quota: {
      remainingPercent: percent(firstValue(quota, 'remainingPercent', 'remaining_percent'))
        ?? primary?.remainingPercent
        ?? null,
      primary,
      secondary,
      allowed: nullableBoolean(firstValue(quota, 'allowed')),
      // Credits can make an account effectively usable even when its rolling
      // window reports limitReached. Prefer the backend's composed signal.
      limitReached: nullableBoolean(firstValue(quota, 'effectiveLimitReached', 'effective_limit_reached'))
        ?? nullableBoolean(firstValue(quota, 'limitReached', 'limit_reached')),
      resetCredits: {
        availableCount: finiteNumber(firstValue(resetCredits, 'availableCount', 'available_count')),
      },
    },
    message: typeof rawMessage === 'string' && rawMessage.trim() ? rawMessage.trim() : null,
  }
}

export async function getAccountUsage(signal?: AbortSignal): Promise<AccountUsageSnapshot> {
  let response: Response
  try {
    response = await fetch('/api/codex/analytics', {
      cache: 'no-store',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new AccountUsageError('无法连接本地用量服务，请稍后重试。')
  }

  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new AccountUsageError(errorMessage(payload, response.status), response.status)
  return normalizeUsage(payload)
}

export function accountUsageErrorMessage(error: unknown) {
  return error instanceof AccountUsageError
    ? error.message
    : '用量暂不可用，请稍后重试。'
}
