export const SHORTCUT_DEFAULTS = {
  send: ['⏎'],
  background: ['Ctrl', '⏎'],
  model: ['Ctrl', 'Shift', 'M'],
  dictation: ['Ctrl', 'Shift', 'D'],
  upload: ['Ctrl', 'U'],
  'new-chat': ['Ctrl', 'Shift', 'O'],
  'show-shortcuts': ['Ctrl', '/'],
  search: ['Ctrl', 'K'],
  developer: ['Ctrl', '.'],
  sidebar: ['Ctrl', 'Shift', 'S'],
  instructions: ['Ctrl', 'Shift', 'I'],
  'copy-code': ['Ctrl', 'Shift', ';'],
  'delete-chat': ['Ctrl', 'Shift', '⌫'],
} as const

export type NotificationChannel = 'push' | 'email' | 'both' | 'off'
export type NotificationTransport = 'push' | 'email'

export interface NotificationSettingOption {
  id: string
  label: string
  description: string
  channels: NotificationTransport[]
}

export interface VoiceSettingOption {
  id: string
  label: string
  description: string
}

export interface AccountSettingsOptions {
  notifications: NotificationSettingOption[]
  voices: VoiceSettingOption[]
}

export const EMPTY_ACCOUNT_SETTINGS_OPTIONS: AccountSettingsOptions = {
  notifications: [],
  voices: [],
}

export interface AccountSettings {
  general: {
    theme: 'system' | 'dark' | 'light'
    contrast: 'system' | 'standard' | 'high'
    accent: 'default' | 'black' | 'blue' | 'green' | 'purple' | 'yellow' | 'pink' | 'orange'
    language: 'auto' | 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko'
    smarter: boolean
    dictation: boolean
  }
  notifications: Record<string, NotificationChannel>
  personalization: {
    personaStyle: 'default' | 'professional' | 'friendly' | 'candid' | 'quirky' | 'efficient' | 'cynical'
    traits: Record<'warmth' | 'enthusiasm' | 'headings' | 'emoji', 'default' | 'more' | 'less'>
    quickAnswers: boolean
    suggestions: boolean
    customInstructions: string
    nickname: string
    occupation: string
    details: string
    memory: boolean
    recordHistory: boolean
    pet: string
  }
  voice: {
    name: string
    model: 'live' | 'standard'
    intelligence: 'instant' | 'medium' | 'high'
    language: 'auto' | 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko'
  }
  usage: { autoRecharge: boolean }
  analytics: {
    historyRange: '7' | '30'
    historyMode: 'product' | 'model'
    productRange: '7' | '30'
    toolsRange: '7' | '30'
  }
  data: {
    improveModel: boolean
    preciseLocation: boolean
    workNetworkAccess: boolean
  }
  cloudBrowser: { defaultPermission: 'ask' | 'allow' | 'auto' }
  safety: { reducedSensitiveContent: boolean }
  security: {
    authenticatorApp: boolean
    textMessage: boolean
    lockdownMode: boolean
    developerMode: boolean
    enforceCsp: boolean
    deviceCodeAuth: boolean
  }
  account: { showBuilderName: boolean }
  shortcuts: {
    enabled: Record<keyof typeof SHORTCUT_DEFAULTS, boolean>
    keys: Record<keyof typeof SHORTCUT_DEFAULTS, string[]>
  }
}

export type AccountSettingsPatch = {
  [Section in keyof AccountSettings]?: AccountSettings[Section] extends Record<string, unknown>
    ? { [Key in keyof AccountSettings[Section]]?: AccountSettings[Section][Key] extends Record<string, unknown>
        ? Partial<AccountSettings[Section][Key]>
        : AccountSettings[Section][Key] }
    : AccountSettings[Section]
}

const shortcutEnabled = Object.fromEntries(Object.keys(SHORTCUT_DEFAULTS).map((id) => [id, true])) as AccountSettings['shortcuts']['enabled']
const shortcutKeys = Object.fromEntries(Object.entries(SHORTCUT_DEFAULTS).map(([id, keys]) => [id, [...keys]])) as AccountSettings['shortcuts']['keys']

export const DEFAULT_ACCOUNT_SETTINGS: AccountSettings = {
  general: { theme: 'system', contrast: 'system', accent: 'default', language: 'auto', smarter: true, dictation: true },
  notifications: { codex: 'push', personalization: 'both', tasks: 'push', usage: 'both', health: 'push', replies: 'push', group: 'push', marketing: 'push', projects: 'email' },
  personalization: {
    personaStyle: 'default',
    traits: { warmth: 'default', enthusiasm: 'default', headings: 'default', emoji: 'default' },
    quickAnswers: true,
    suggestions: true,
    customInstructions: '',
    nickname: '',
    occupation: '',
    details: '',
    memory: true,
    recordHistory: true,
    pet: 'default',
  },
  voice: { name: 'cove', model: 'live', intelligence: 'medium', language: 'auto' },
  usage: { autoRecharge: false },
  analytics: { historyRange: '7', historyMode: 'product', productRange: '7', toolsRange: '7' },
  data: { improveModel: true, preciseLocation: false, workNetworkAccess: true },
  cloudBrowser: { defaultPermission: 'ask' },
  safety: { reducedSensitiveContent: false },
  security: { authenticatorApp: true, textMessage: false, lockdownMode: false, developerMode: false, enforceCsp: false, deviceCodeAuth: true },
  account: { showBuilderName: true },
  shortcuts: { enabled: shortcutEnabled, keys: shortcutKeys },
}

export interface AccountSettingsSnapshot {
  authenticated: boolean
  settings: AccountSettings
  revision: number
  updatedAt: string
  capabilities: Record<string, SettingCapability>
  options: AccountSettingsOptions
}

export interface SettingCapability {
  source: 'chatgpt' | 'replica' | 'flow' | 'readOnly' | string
  writable: boolean
  reason?: string
}

export class AccountSettingsError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status = 0, code = 'settings_request_failed') {
    super(message)
    this.name = 'AccountSettingsError'
    this.status = status
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mergeKnown<T>(defaults: T, value: unknown): T {
  if (!isRecord(defaults) || !isRecord(value)) return (value === undefined ? defaults : value) as T
  const result: Record<string, unknown> = {}
  for (const [key, fallback] of Object.entries(defaults)) {
    result[key] = isRecord(fallback) ? mergeKnown(fallback, value[key]) : (value[key] ?? fallback)
  }
  return result as T
}

export function mergeAccountSettings(current: AccountSettings, changes: AccountSettingsPatch): AccountSettings {
  return mergeAccountSettingsPatch(current, changes) as AccountSettings
}

export function mergeAccountSettingsPatch(current: AccountSettingsPatch, changes: AccountSettingsPatch): AccountSettingsPatch {
  const merge = (left: unknown, right: unknown): unknown => {
    if (!isRecord(left) || !isRecord(right)) return right
    const result: Record<string, unknown> = { ...left }
    for (const [key, value] of Object.entries(right)) result[key] = merge(result[key], value)
    return result
  }
  return merge(current, changes) as AccountSettingsPatch
}

export function splitAccountSettingsPatch(changes: AccountSettingsPatch): AccountSettingsPatch[] {
  const patches: AccountSettingsPatch[] = []
  const build = (parts: string[], value: unknown): AccountSettingsPatch => {
    let nested: unknown = value
    for (let index = parts.length - 1; index >= 0; index -= 1) nested = { [parts[index]]: nested }
    return nested as AccountSettingsPatch
  }
  const walk = (value: unknown, parts: string[]) => {
    if (isRecord(value)) {
      for (const [key, nested] of Object.entries(value)) walk(nested, [...parts, key])
      return
    }
    patches.push(build(parts, value))
  }

  // Voice name availability depends on the target language and mode. Keep
  // those fields together so the backend can apply mode/language first and
  // validate the voice against the refreshed catalog.
  if (changes.voice) patches.push({ voice: { ...changes.voice } })
  for (const [section, value] of Object.entries(changes)) {
    if (section === 'voice') continue
    walk(value, [section])
  }
  return patches
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try { return JSON.parse(text) as unknown } catch { return null }
}

async function request(path: string, init?: RequestInit) {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      cache: 'no-store',
      credentials: 'include',
      headers: { Accept: 'application/json', ...init?.headers },
    })
  } catch {
    throw new AccountSettingsError('无法连接本地设置服务，请确认后端已经启动。')
  }
  const payload = await readJson(response)
  if (!response.ok) {
    const record = isRecord(payload) ? payload : {}
    const error = isRecord(record.error) ? record.error : {}
    const message = typeof error.message === 'string' && error.message
      ? error.message
      : response.status === 409
        ? '设置已在另一个窗口中更新，正在重新加载。'
        : response.status === 401
          ? 'Session 已过期，请重新登录。'
          : '设置保存失败，请稍后重试。'
    const code = typeof error.code === 'string' ? error.code : 'settings_request_failed'
    throw new AccountSettingsError(message, response.status, code)
  }
  return payload
}

const DYNAMIC_ID = /^[a-z0-9][a-z0-9_:-]{0,63}$/
const VOICE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
const RESERVED_DYNAMIC_IDS = new Set(['constructor', 'prototype', '__proto__'])
const NOTIFICATION_VALUES = new Set<NotificationChannel>(['push', 'email', 'both', 'off'])

function safeDisplayText(value: unknown, maximum: number) {
  if (typeof value !== 'string') return ''
  const withoutControls = Array.from(value, (character) => {
    const code = character.charCodeAt(0)
    return code < 0x20 || code === 0x7f ? ' ' : character
  }).join('')
  return withoutControls.replace(/\s+/g, ' ').trim().slice(0, maximum)
}

function normalizeOptions(value: unknown): AccountSettingsOptions {
  const raw = isRecord(value) ? value : {}
  const notifications: NotificationSettingOption[] = []
  const notificationIds = new Set<string>()
  if (Array.isArray(raw.notifications)) {
    for (const item of raw.notifications.slice(0, 64)) {
      if (!isRecord(item) || typeof item.id !== 'string' || !DYNAMIC_ID.test(item.id)) continue
      if (RESERVED_DYNAMIC_IDS.has(item.id) || notificationIds.has(item.id)) continue
      const channels: NotificationTransport[] = []
      if (Array.isArray(item.channels)) {
        for (const channel of item.channels) {
          if ((channel === 'push' || channel === 'email') && !channels.includes(channel)) channels.push(channel)
        }
      }
      if (!channels.length) continue
      notificationIds.add(item.id)
      notifications.push({
        id: item.id,
        label: safeDisplayText(item.label, 120) || item.id,
        description: safeDisplayText(item.description, 500),
        channels,
      })
    }
  }

  const voices: VoiceSettingOption[] = []
  const voiceIds = new Set<string>()
  if (Array.isArray(raw.voices)) {
    for (const item of raw.voices.slice(0, 48)) {
      if (!isRecord(item) || typeof item.id !== 'string' || !VOICE_ID.test(item.id) || voiceIds.has(item.id)) continue
      voiceIds.add(item.id)
      voices.push({
        id: item.id,
        label: safeDisplayText(item.label, 120) || item.id,
        description: safeDisplayText(item.description, 500),
      })
    }
  }
  return { notifications, voices }
}

function normalizeNotificationSettings(value: unknown, options: NotificationSettingOption[]) {
  const raw = isRecord(value) ? value : {}
  const result: Record<string, NotificationChannel> = Object.create(null) as Record<string, NotificationChannel>
  const allowedIds = options.length ? new Set(options.map((option) => option.id)) : null
  for (const [id, channel] of Object.entries(raw)) {
    if (!DYNAMIC_ID.test(id) || RESERVED_DYNAMIC_IDS.has(id) || (allowedIds && !allowedIds.has(id))) continue
    if (typeof channel === 'string' && NOTIFICATION_VALUES.has(channel as NotificationChannel)) {
      result[id] = channel as NotificationChannel
    }
  }
  if (options.length) {
    for (const option of options) result[option.id] ??= 'off'
    return result
  }
  return Object.keys(result).length ? result : { ...DEFAULT_ACCOUNT_SETTINGS.notifications }
}

function normalizeSnapshot(value: unknown): AccountSettingsSnapshot {
  const payload = isRecord(value) ? value : {}
  const options = normalizeOptions(payload.options)
  const capabilities: Record<string, SettingCapability> = {}
  if (isRecord(payload.capabilities)) {
    for (const [path, raw] of Object.entries(payload.capabilities)) {
      if (!isRecord(raw) || typeof raw.source !== 'string' || typeof raw.writable !== 'boolean') continue
      capabilities[path] = {
        source: raw.source,
        writable: raw.writable,
        ...(typeof raw.reason === 'string' ? { reason: raw.reason } : {}),
      }
    }
  }
  const settings = mergeKnown(DEFAULT_ACCOUNT_SETTINGS, payload.settings)
  const rawSettings = isRecord(payload.settings) ? payload.settings : {}
  settings.notifications = normalizeNotificationSettings(rawSettings.notifications, options.notifications)
  const rawVoice = isRecord(rawSettings.voice) ? rawSettings.voice : {}
  if (typeof rawVoice.name === 'string' && VOICE_ID.test(rawVoice.name)) settings.voice.name = rawVoice.name
  return {
    authenticated: payload.authenticated === true,
    settings,
    revision: typeof payload.revision === 'number' && payload.revision >= 0 ? payload.revision : 0,
    updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : '',
    capabilities,
    options,
  }
}

export async function getAccountSettings(): Promise<AccountSettingsSnapshot> {
  return normalizeSnapshot(await request('/api/account/settings'))
}

export async function patchAccountSettings(
  changes: AccountSettingsPatch,
  revision?: number,
): Promise<AccountSettingsSnapshot> {
  return normalizeSnapshot(await request('/api/account/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changes, ...(revision === undefined ? {} : { revision }) }),
  }))
}
