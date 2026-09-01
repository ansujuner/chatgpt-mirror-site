import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import AuthFlowPage from './AuthFlowPage'
import CodexCloudSettingsPage from './CodexCloudSettingsPage'
import ImagesPage from './ImagesPage'
import HelpPage from './HelpPage'
import LegalPage from './LegalPage'
import PluginsPage from './PluginsPage'
import PricingPage from './PricingPage'
import { AuthDialog, ProductCard, SettingsDialog } from './Overlays'
import PlusHomeShell, {
  PlusSidebar,
  type AttachmentSource,
  type ComposerAttachment,
  type ComposerSubmission,
  type HistoryLoadStatus,
  type PlusConversation,
  type PlusDestination,
  type PlusMicState,
  type PlusMode,
  type PlusSuggestionId,
  type WorkspaceUsageView,
} from './PlusShell'
import {
  AccountMenu as PlusAccountMenu,
  AttachmentMenu as PlusAttachmentMenu,
  ChatRowMenu as PlusChatRowMenu,
  ModelMenu as PlusModelMenu,
  SidebarMoreMenu as PlusSidebarMoreMenu,
  type AttachmentAction as PlusAttachmentAction,
  type PlusModelId,
  type ReasoningEffort,
  type SidebarMoreAction as PlusSidebarMoreAction,
} from './PlusOverlays'
import PlusSettingsDialog, { type PlusSettingsTabId } from './PlusSettingsDialog'
import SearchDialog from './SearchDialog'
import SessionLoginDialog from './SessionLoginDialog'
import FreeHomeShell from './free-home/FreeHomeShell'
import {
  authSessionErrorMessage,
  getAccountRuntime,
  getAuthSession,
  loginWithSessionAndHydrate,
  logoutAuthSession,
  type AccountPlan,
  type AccountRuntime,
  type AuthSessionSnapshot,
  type RuntimeModelSurface,
  type SessionAccount,
} from './lib/authSession'
import {
  ANONYMOUS_AUTH_STATE,
  authenticatedAuthState,
  authStateFromSnapshot,
  createInitialAuthState,
  type AuthState,
} from './lib/authState'
import type { ReasoningModelOption, ReasoningSliderOption } from './ReasoningPicker'
import { streamChatReply } from './lib/chatTransport'
import { requiresChatReauthentication } from './lib/chatIdentity'
import {
  guestAssistantTurnUi,
  shouldStickToConversationBottom,
} from './lib/guestConversation'
import { accountUsageErrorMessage, getAccountUsage } from './lib/accountUsage'
import {
  AccountSettingsError,
  DEFAULT_ACCOUNT_SETTINGS,
  EMPTY_ACCOUNT_SETTINGS_OPTIONS,
  getAccountSettings,
  mergeAccountSettings,
  mergeAccountSettingsPatch,
  patchAccountSettings,
  splitAccountSettingsPatch,
  type AccountSettings,
  type AccountSettingsOptions,
  type AccountSettingsPatch,
  type SettingCapability,
} from './lib/accountSettings'
import {
  getChatModelPreference,
  patchChatModelPreference,
  type ChatModelPreference,
} from './lib/modelPreference'
import {
  conversationHistoryErrorMessage,
  getConversationDetail,
  getConversationHistory,
} from './lib/conversationHistory'
import type { ChatMessage } from './types'
import './App.css'

type IconName =
  | 'sidebar' | 'sidebar-hidden' | 'mobile-sidebar' | 'compose' | 'search' | 'images' | 'plugins'
  | 'deep-research' | 'plans' | 'external-link' | 'settings' | 'help' | 'chevron'
  | 'attachment' | 'microphone' | 'send' | 'stop' | 'web-search' | 'camera'
  | 'photo' | 'file' | 'paperclip' | 'create-image' | 'add-files' | 'check'

const ICON_IDS: Record<IconName, string> = {
  sidebar: 'lightweight-sidebar-sidebar',
  'sidebar-hidden': 'lightweight-sidebar-sidebar-hidden',
  'mobile-sidebar': 'lightweight-shell-mobile-sidebar-toggle',
  compose: 'lightweight-sidebar-compose',
  search: 'lightweight-sidebar-search',
  images: 'lightweight-sidebar-images',
  plugins: 'lightweight-sidebar-plugins',
  'deep-research': 'lightweight-sidebar-deep-research',
  plans: 'lightweight-sidebar-plans',
  'external-link': 'lightweight-sidebar-external-link',
  settings: 'lightweight-sidebar-settings',
  help: 'lightweight-sidebar-help',
  chevron: 'lightweight-shell-header-chevron',
  attachment: 'lightweight-composer-add-attachment',
  microphone: 'lightweight-composer-microphone',
  send: 'lightweight-composer-send',
  stop: 'lightweight-composer-stop',
  'web-search': 'lightweight-composer-web-search',
  camera: 'lightweight-composer-actions-camera',
  photo: 'lightweight-composer-actions-photo',
  file: 'lightweight-composer-actions-file',
  paperclip: 'lightweight-composer-actions-paperclip',
  'create-image': 'lightweight-composer-actions-images',
  'add-files': 'lightweight-composer-actions-add-files',
  check: 'lightweight-composer-actions-menu-check',
}

type FeatureCardKind = 'search-card' | 'deep-card'
type Layer = null | 'product' | 'attachment' | 'auth' | 'settings' | 'search-dialog' | FeatureCardKind
type PlusLayer = null | 'account' | 'model' | 'more' | 'chat-row' | 'attachment'
type AuthIntent = 'login' | 'signup' | 'login_or_signup'
type ThemeMode = 'system' | 'light' | 'dark'
type Turn = {
  id: string | number
  role: 'user' | 'assistant'
  text: string
  attachments?: readonly ComposerAttachment[]
  stopped?: boolean
}
type RouteKey = 'home' | 'conversation' | 'library' | 'projects' | 'tasks' | 'images' | 'plugins' | 'plugin-detail' | 'auth' | 'pricing' | 'help' | 'legal' | 'codex-settings' | 'not-found'
type LocalRoutePath = '/' | `/c/${string}` | '/library' | '/projects' | '/tasks' | '/images' | '/plugins' | `/plugins/${string}` | `/plugins?${string}` | `/auth/${string}` | '/pricing' | `/help${string}` | '/terms' | '/privacy' | `/openai${string}` | `/codex/cloud/settings${string}` | `/admin${string}`
type HomeSurface = 'lightweight' | 'full-app'

type BrowserSpeechRecognitionAlternative = {
  transcript: string
}

type BrowserSpeechRecognitionResult = {
  isFinal: boolean
  length: number
  [index: number]: BrowserSpeechRecognitionAlternative
}

type BrowserSpeechRecognitionResultList = {
  length: number
  [index: number]: BrowserSpeechRecognitionResult
}

type BrowserSpeechRecognitionEvent = Event & {
  resultIndex: number
  results: BrowserSpeechRecognitionResultList
}

type BrowserSpeechRecognitionErrorEvent = Event & {
  error: string
  message?: string
}

type BrowserSpeechRecognition = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onend: (() => void) | null
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null
  onstart: (() => void) | null
  abort: () => void
  start: () => void
  stop: () => void
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition
type SpeechRecognitionWindow = Window & typeof globalThis & {
  SpeechRecognition?: BrowserSpeechRecognitionConstructor
  webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor
}

type RequestReasoningEffort = 'min' | 'standard' | 'extended' | 'xhigh' | 'max'
type RequestServiceTier = 'standard' | 'fast'

type PowerSliderOption = ReasoningSliderOption & {
  modelSlug: string
  thinkingEffort?: RequestReasoningEffort
  lane: string
  defaultServiceTier?: 'standard' | 'fast'
  serviceTierOptions: readonly string[]
}

const REQUEST_REASONING_EFFORTS = new Set<RequestReasoningEffort>([
  'min',
  'standard',
  'extended',
  'xhigh',
  'max',
])

function requestReasoningEffort(value: string): RequestReasoningEffort | undefined {
  return REQUEST_REASONING_EFFORTS.has(value as RequestReasoningEffort)
    ? value as RequestReasoningEffort
    : undefined
}

function requestServiceTier(value: string): RequestServiceTier | undefined {
  return value === 'standard' || value === 'fast' ? value : undefined
}

function requestServiceTierOptions(values: readonly string[]) {
  return values.reduce<RequestServiceTier[]>((tiers, value) => {
    const tier = requestServiceTier(value)
    if (tier && !tiers.includes(tier)) tiers.push(tier)
    return tiers
  }, [])
}

/**
 * Match the upstream picker rule: a configured tier is only authoritative when
 * it is still supported by the selected preset. Otherwise use that preset's
 * valid default, then its first advertised option. An empty option list means
 * the runtime did not confirm tier support, so the request must omit the field.
 */
function resolveServiceTier(
  configured: RequestServiceTier | undefined,
  defaultTier: RequestServiceTier | undefined,
  options: readonly string[],
) {
  const supported = requestServiceTierOptions(options)
  if (!supported.length) return undefined
  if (configured && supported.includes(configured)) return configured
  if (defaultTier && supported.includes(defaultTier)) return defaultTier
  return supported[0]
}

function powerOptionLabel(
  surface: RuntimeModelSurface,
  thinkingEffort: RequestReasoningEffort | undefined,
  lane: string,
  endpointLabel: string,
) {
  if (lane.toLocaleLowerCase() === 'pro') return 'Pro'
  const isWork = surface.defaultModel.endsWith('-wm')
  if (thinkingEffort === 'min') return isWork ? '轻度' : '极速'
  if (thinkingEffort === 'standard') return '中'
  if (thinkingEffort === 'extended') return '高'
  if (thinkingEffort === 'xhigh') return '极高'
  if (thinkingEffort === 'max') return isWork ? '最高' : '极高'
  return endpointLabel
}

function categoryLaneForModel(surface: RuntimeModelSurface, modelSlug: string) {
  return surface.categories.find((category) => (
    category.defaultModel === modelSlug || category.supportedModels.includes(modelSlug)
  ))?.modelLane ?? ''
}

function surfaceOffersModel(surface: RuntimeModelSurface, modelSlug: string) {
  if (surface.categories.some((category) => (
    category.defaultModel === modelSlug || category.supportedModels.includes(modelSlug)
  ))) return true
  return surface.versions.some((version) => (
    version.enabled
    && (
      version.slugs.includes(modelSlug)
      || version.presets.some((preset) => (
        preset.presetType !== 'upgrade' && preset.modelSlug === modelSlug
      ))
    )
  ))
}

function concreteFallbackModel(model: PlusModelId, mode: PlusMode) {
  if (model.startsWith('gpt-')) return model
  if (mode === 'work') {
    if (model === '5.6-terra') return 'gpt-5.6-terra-wm'
    if (model === '5.6-luna') return 'gpt-5.6-luna-wm'
    if (model === '5.5') return 'gpt-5.5-wm'
    return 'gpt-5.6-sol-wm'
  }
  if (model === '5.6-luna') return 'gpt-5-6-t-mini'
  if (model === '5.5') return 'gpt-5-5-thinking'
  if (model === '5.6-terra') return 'gpt-5-6-instant'
  if (model === '5.6-sol-pro') return 'gpt-5-6-pro'
  return 'gpt-5-6-thinking'
}

function fallbackPowerOptions(
  mode: PlusMode,
  plan: AccountPlan,
  selectedModel: PlusModelId,
): readonly PowerSliderOption[] {
  if (mode === 'work') {
    const modelSlug = concreteFallbackModel(selectedModel, mode)
    return [
      { id: 'work:min', label: '轻度', modelSlug, thinkingEffort: 'min', lane: 'thinking_plus_plus', serviceTierOptions: [] },
      { id: 'work:standard', label: '中', modelSlug, thinkingEffort: 'standard', lane: 'thinking_plus_plus', serviceTierOptions: [] },
      { id: 'work:extended', label: '高', modelSlug, thinkingEffort: 'extended', lane: 'thinking_plus_plus', serviceTierOptions: [] },
      { id: 'work:xhigh', label: '极高', modelSlug, thinkingEffort: 'xhigh', lane: 'thinking_plus_plus', serviceTierOptions: [] },
      { id: 'work:max', label: '最高', modelSlug, thinkingEffort: 'max', lane: 'thinking_plus_plus', serviceTierOptions: [] },
    ]
  }

  const explicitModel = selectedModel !== 'default'
    ? concreteFallbackModel(selectedModel, mode)
    : ''
  if (explicitModel) {
    if (/instant$|t-mini$/i.test(explicitModel)) {
      return [{ id: `chat:${explicitModel}`, label: '极速', modelSlug: explicitModel, lane: 'instant', serviceTierOptions: [] }]
    }
    if (/pro$/i.test(explicitModel)) {
      return [{ id: `chat:${explicitModel}:standard`, label: 'Pro', modelSlug: explicitModel, thinkingEffort: 'standard', lane: 'pro', isMaximumEffort: true, serviceTierOptions: [] }]
    }
    return [
      { id: `chat:${explicitModel}:standard`, label: '中', modelSlug: explicitModel, thinkingEffort: 'standard', lane: 'thinking', serviceTierOptions: [] },
      { id: `chat:${explicitModel}:extended`, label: '高', modelSlug: explicitModel, thinkingEffort: 'extended', lane: 'thinking', serviceTierOptions: [] },
    ]
  }

  const plusOptions: PowerSliderOption[] = [
    { id: 'chat:instant', label: '极速', modelSlug: 'gpt-5-6-instant', lane: 'instant', serviceTierOptions: [] },
    { id: 'chat:standard', label: '中', modelSlug: 'gpt-5-6-thinking', thinkingEffort: 'standard', lane: 'thinking', serviceTierOptions: [] },
    { id: 'chat:extended', label: '高', modelSlug: 'gpt-5-6-thinking', thinkingEffort: 'extended', lane: 'thinking', serviceTierOptions: [] },
  ]
  if (plan !== 'pro') return plusOptions
  return [
    ...plusOptions,
    { id: 'chat:max', label: '极高', modelSlug: 'gpt-5-6-thinking', thinkingEffort: 'max', lane: 'thinking', serviceTierOptions: [] },
    { id: 'chat:pro', label: 'Pro', modelSlug: 'gpt-5-6-pro', thinkingEffort: 'standard', lane: 'pro', isMaximumEffort: true, serviceTierOptions: [] },
  ]
}

function runtimeVersionForSelection(surface: RuntimeModelSurface, selectedModel: PlusModelId) {
  const enabled = surface.versions.filter((version) => version.enabled)
  if (selectedModel === 'default') {
    return enabled.find((version) => (
      version.slugs.includes(surface.defaultModel)
      || version.presets.some((preset) => preset.modelSlug === surface.defaultModel)
    )) ?? enabled[0]
  }
  if (selectedModel === '5.5') return enabled.find((version) => /5\.5/i.test(version.id))
  if (selectedModel === '5.6-terra') return enabled.find((version) => /terra/i.test(version.id))
  if (selectedModel === '5.6-luna') return enabled.find((version) => /luna/i.test(version.id))
  if (selectedModel === '5.6-sol' || selectedModel === '5.6-sol-pro') {
    return enabled.find((version) => /sol/i.test(version.id)) ?? enabled[0]
  }
  return enabled.find((version) => (
    version.slugs.includes(selectedModel)
    || version.presets.some((preset) => preset.modelSlug === selectedModel)
  ))
}

function endpointPresetOptions(surface: RuntimeModelSurface, selectedModel: PlusModelId) {
  const version = runtimeVersionForSelection(surface, selectedModel)
  if (!version) return []
  return version.presets.flatMap((preset, index): PowerSliderOption[] => {
    if (!preset.modelSlug || preset.presetType === 'upgrade') return []
    const lane = preset.lane || categoryLaneForModel(surface, preset.modelSlug)
    const thinkingEffort = requestReasoningEffort(preset.thinkingEffort)
    const defaultServiceTier = requestServiceTier(preset.defaultServiceTier)
    return [{
      id: `preset:${version.id}:${preset.id ?? index}:${preset.modelSlug}:${preset.thinkingEffort}`,
      label: powerOptionLabel(
        surface,
        thinkingEffort,
        lane,
        preset.selectedTitle || preset.title || String(index + 1),
      ),
      modelSlug: preset.modelSlug,
      ...(thinkingEffort ? { thinkingEffort } : {}),
      lane,
      ...(defaultServiceTier ? { defaultServiceTier } : {}),
      serviceTierOptions: preset.serviceTierOptions,
      isMaximumEffort: lane.toLocaleLowerCase() === 'pro',
    }]
  })
}

function endpointModelOptions(
  surface: RuntimeModelSurface,
  selectedModel: PlusModelId,
  plan: AccountPlan,
) {
  if (selectedModel === 'default') return []
  const isWorkSurface = surface.defaultModel.endsWith('-wm')
  const modelSlug = concreteFallbackModel(selectedModel, isWorkSurface ? 'work' : 'chat')
  // `/models` may contain hidden, Work-only, or otherwise non-picker models in
  // its global model array. Only options advertised by this surface's category
  // or enabled version catalog may become a Chat slider/request selection.
  if (!surfaceOffersModel(surface, modelSlug)) return []
  const model = surface.models.find((candidate) => candidate.slug === modelSlug)
  if (!model) return []
  const lane = categoryLaneForModel(surface, model.slug)
  if (plan !== 'pro' && lane.toLocaleLowerCase() === 'pro') return []
  const version = runtimeVersionForSelection(surface, selectedModel)
  const tierMetadata = (thinkingEffort?: RequestReasoningEffort) => {
    const preset = version?.presets.find((candidate) => (
      candidate.modelSlug === model.slug
      && (!thinkingEffort || candidate.thinkingEffort === thinkingEffort)
      && candidate.serviceTierOptions.length > 0
    ))
    const defaultServiceTier = requestServiceTier(
      preset?.defaultServiceTier || model.defaultServiceTier,
    )
    const serviceTierOptions = preset?.serviceTierOptions.length
      ? preset.serviceTierOptions
      : model.serviceTierOptions
    return { defaultServiceTier, serviceTierOptions }
  }
  if (!model.thinkingEfforts.length) {
    const tiers = tierMetadata()
    return [{
      id: `model:${model.slug}`,
      label: lane === 'instant' ? '极速' : powerOptionLabel(surface, undefined, lane, model.title),
      modelSlug: model.slug,
      lane,
      ...(tiers.defaultServiceTier ? { defaultServiceTier: tiers.defaultServiceTier } : {}),
      serviceTierOptions: tiers.serviceTierOptions,
      isMaximumEffort: lane.toLocaleLowerCase() === 'pro',
    }] satisfies PowerSliderOption[]
  }
  return model.thinkingEfforts.flatMap((effort, index): PowerSliderOption[] => {
    const thinkingEffort = requestReasoningEffort(effort.value)
    if (!thinkingEffort) return []
    const tiers = tierMetadata(thinkingEffort)
    return [{
      id: `model:${model.slug}:${effort.value}`,
      label: powerOptionLabel(
        surface,
        thinkingEffort,
        lane,
        effort.label || effort.fullLabel || String(index + 1),
      ),
      modelSlug: model.slug,
      thinkingEffort,
      lane,
      ...(tiers.defaultServiceTier ? { defaultServiceTier: tiers.defaultServiceTier } : {}),
      serviceTierOptions: tiers.serviceTierOptions,
      isMaximumEffort: lane.toLocaleLowerCase() === 'pro',
    }]
  })
}

function powerOptionsForRuntime(
  runtime: AccountRuntime | null,
  mode: PlusMode,
  plan: AccountPlan,
  selectedModel: PlusModelId,
) {
  const surface = mode === 'work' ? runtime?.work : runtime?.chat
  if (surface) {
    const options = selectedModel === 'default'
      ? endpointPresetOptions(surface, selectedModel)
      : endpointModelOptions(surface, selectedModel, plan)
    if (plan === 'pro' && mode === 'chat' && selectedModel === 'default') {
      const maximum = options.filter((option) => option.isMaximumEffort)
      if (maximum.length) {
        return [
          ...options.filter((option) => !option.isMaximumEffort),
          ...maximum,
        ]
      }
      // A runtime catalog without a Pro lane must not silently downgrade a
      // Pro account's default to the ordinary Thinking endpoint.
      return fallbackPowerOptions(mode, plan, selectedModel)
    }
    const entitledOptions = mode === 'chat' && plan !== 'pro'
      ? options.filter((option) => !option.isMaximumEffort)
      : options
    if (entitledOptions.length) return entitledOptions
  }
  return fallbackPowerOptions(mode, plan, selectedModel)
}

function preferredPowerIndex(
  options: readonly PowerSliderOption[],
  mode: PlusMode,
  plan: AccountPlan,
) {
  if (!options.length) return 0
  const preferred = mode === 'work'
    ? options.findIndex((option) => option.thinkingEffort === 'standard')
    : plan === 'pro'
      ? options.findIndex((option) => option.isMaximumEffort)
      : options.findIndex((option) => (
          option.thinkingEffort === 'extended' && !option.isMaximumEffort
        ))
  return preferred >= 0 ? preferred : Math.max(options.length - 1, 0)
}

function plusRequestModel(
  model: PlusModelId,
  effort: ReasoningEffort,
  mode: PlusMode,
  runtime: AccountRuntime | null,
  selectedPowerOption?: PowerSliderOption,
) {
  if (selectedPowerOption?.modelSlug) return selectedPowerOption.modelSlug
  if (model.startsWith('gpt-')) return model
  if (model === 'default') {
    const runtimeDefault = mode === 'work'
      ? runtime?.work.defaultModel
      : runtime?.conversation.intendedDefaultModel || runtime?.conversation.defaultModel || runtime?.chat.defaultModel
    if (runtimeDefault) return runtimeDefault
  }
  if (mode === 'work') {
    if (model === '5.6-terra') return 'gpt-5.6-terra-wm'
    if (model === '5.6-luna') return 'gpt-5.6-luna-wm'
    if (model === '5.5') return 'gpt-5.5-wm'
    return 'gpt-5.6-sol-wm'
  }
  if (model === '5.6-luna') return 'gpt-5-6-t-mini'
  if (model === '5.5') return effort === 0 ? 'gpt-5-5-instant' : 'gpt-5-5-thinking'
  if (model === '5.6-terra') return 'gpt-5-6-instant'
  if (model === 'default') return effort === 0 ? 'gpt-5-6-instant' : 'gpt-5-6-thinking'
  if (model === '5.6-sol-pro') return 'gpt-5-6-pro'
  return 'gpt-5-6-thinking'
}

function blockedCapability(runtime: AccountRuntime | null, needles: readonly string[]) {
  if (!runtime) return false
  return runtime.conversation.blockedFeatures.some((feature) => {
    const normalized = feature.toLocaleLowerCase().replace(/[\s-]+/g, '_')
    // Upstream blocked-feature names are canonical identifiers. Keep this
    // conservative: a partial match could hide an unrelated paid capability.
    return needles.some((needle) => normalized === needle)
  })
}

function modelOptionsForRuntime(runtime: AccountRuntime | null, mode: PlusMode, plan: AccountPlan): readonly ReasoningModelOption[] | undefined {
  if (!runtime) return undefined
  const surface = mode === 'work' ? runtime.work : runtime.chat
  if (!surface.models.length) return undefined

  const allowedSlugs = new Set(surface.categories
    .filter((category) => {
      const level = category.subscriptionLevel.toLocaleLowerCase()
      if (plan === 'free') return level === 'free'
      if (plan !== 'pro' && level === 'pro') return false
      return true
    })
    .flatMap((category) => category.supportedModels))
  if (!allowedSlugs.size) {
    for (const version of surface.versions) {
      if (!version.enabled) continue
      for (const preset of version.presets) {
        if (preset.presetType !== 'upgrade' && preset.modelSlug) allowedSlugs.add(preset.modelSlug)
      }
    }
  }
  // An empty picker catalog is not permission to expose every object returned
  // in the endpoint's global model table. Use the plan-safe fallback instead.
  if (!allowedSlugs.size) return undefined
  const availableModels = surface.models.filter((model) => allowedSlugs.has(model.slug))
  if (!availableModels.length) return undefined

  const defaultLabel = plan === 'pro' ? 'Pro' : '默认'
  return [
    {
      id: 'default',
      label: defaultLabel,
      description: plan === 'pro' ? '最强推理能力，适合复杂和高难度任务' : '根据任务自动选择合适的能力',
      triggerLabel: plan === 'pro' ? 'Pro' : undefined,
    },
    ...availableModels.map((model) => ({
      id: model.slug,
      label: model.title || model.slug,
      description: model.description || undefined,
    })),
  ]
}

function appendSpeechTranscript(base: string, transcript: string) {
  const next = transcript.trim()
  if (!base) return next
  if (!next) return base
  const needsSpace = /[\p{L}\p{N}]$/u.test(base) && /^[A-Za-z0-9]/.test(next)
  return `${base}${needsSpace ? ' ' : ''}${next}`
}

function attachmentRequestText(attachments: readonly ComposerAttachment[]) {
  const names = attachments.map(({ file }) => file.name).join('、')
  return `请处理这些附件：${names}`
}

function turnRequestText(turn: Turn) {
  const text = turn.text.trim()
  const attachments = turn.attachments ?? []
  if (attachments.length === 0) return text
  const attachmentText = attachmentRequestText(attachments)
  return text ? `${text}\n\n${attachmentText}` : attachmentText
}

async function writeConversationText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textArea = document.createElement('textarea')
  textArea.value = text
  textArea.setAttribute('readonly', '')
  textArea.style.position = 'fixed'
  textArea.style.opacity = '0'
  document.body.append(textArea)
  textArea.select()
  const copied = document.execCommand('copy')
  textArea.remove()
  if (!copied) throw new Error('Copy failed')
}

const SIDEBAR_KEY = 'lightweight-web.desktop-sidebar-collapsed'

function readRoute(): RouteKey {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  if (path === '/') return 'home'
  if (path.startsWith('/c/')) return 'conversation'
  if (path === '/library') return 'library'
  if (path === '/projects') return 'projects'
  if (path === '/tasks') return 'tasks'
  if (path === '/images') return 'images'
  if (path === '/plugins') return 'plugins'
  if (path.startsWith('/plugins/')) return 'plugin-detail'
  if (path.startsWith('/auth/')) return 'auth'
  if (path === '/pricing') return 'pricing'
  if (path === '/codex/cloud/settings' || path.startsWith('/codex/cloud/settings/') || path.startsWith('/admin/access-tokens')) return 'codex-settings'
  if (path === '/help' || path.startsWith('/help/')) return 'help'
  if (path === '/terms' || path === '/privacy' || path === '/openai' || path.startsWith('/openai/')) return 'legal'
  return 'not-found'
}

const EMPTY_ACCOUNT_PRESENTATION: SessionAccount = {
  id: 'anonymous',
  name: '',
  email: '',
  initials: '',
  plan: 'unknown',
  planLabel: '',
}

function readConversationIdFromPath(pathname = window.location.pathname) {
  const match = pathname.match(/^\/c\/([^/]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

function createLocalConversationId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function isFullAppRoute(route: RouteKey) {
  return route === 'images' || route === 'plugins' || route === 'plugin-detail'
}

function isAccountOnlyRoute(route: RouteKey) {
  return route === 'conversation' || route === 'library' || route === 'projects' || route === 'tasks'
}

function isWorkspaceOnlyRoute(route: RouteKey) {
  return route === 'library' || route === 'projects' || route === 'tasks'
}

function readHomeSurface(route = readRoute()): HomeSurface {
  if (route !== 'home') return 'lightweight'
  return window.history.state?.homeSurface === 'full-app' ? 'full-app' : 'lightweight'
}

function readInitialHomeSurface(): HomeSurface {
  const route = readRoute()
  // `full-app` is an in-document navigation provenance marker, not a durable
  // preference. Any fresh document opened directly on `/` must start on the
  // lightweight landing surface; Back/Forward inside this SPA is handled by
  // the popstate listener below and still restores each entry precisely.
  if (route !== 'home') return 'lightweight'
  if (window.history.state?.homeSurface === 'full-app') {
    const { homeSurface: _discardedHomeSurface, ...rest } = window.history.state
    window.history.replaceState(rest, '', `${window.location.pathname}${window.location.search}`)
  }
  return 'lightweight'
}

const SETTINGS_HISTORY_KEY = '__chatgptReplicaSettings'

const SETTINGS_HASH_BY_TAB: Record<PlusSettingsTabId, string> = {
  general: '#settings',
  notifications: '#settings/Notifications',
  personalization: '#settings/Personalization',
  plugins: '#settings/Plugins',
  voice: '#settings/Voice',
  billing: '#settings/Billing',
  usage: '#settings/Usage',
  analytics: '#settings/Analytics',
  data: '#settings/DataControls',
  'cloud-browser': '#settings/CloudBrowser',
  storage: '#settings/Storage',
  safety: '#settings/SafetySettings',
  security: '#settings/Security',
  parental: '#settings/ParentalControls',
  'trusted-contacts': '#settings/Safety',
  account: '#settings/Account',
  shortcuts: '#settings/Keyboard',
}

function isSettingsHash() {
  return window.location.hash === '#settings' || window.location.hash.startsWith('#settings/')
}

function settingsTabFromHistory(): PlusSettingsTabId {
  const fromHash = (Object.entries(SETTINGS_HASH_BY_TAB) as Array<[PlusSettingsTabId, string]>)
    .find(([, hash]) => hash.toLocaleLowerCase() === window.location.hash.toLocaleLowerCase())?.[0]
  if (fromHash) return fromHash
  const value = window.history.state?.[SETTINGS_HISTORY_KEY]?.tab
  const validTabs: PlusSettingsTabId[] = [
    'general', 'notifications', 'personalization', 'plugins', 'voice', 'billing',
    'usage', 'analytics', 'data', 'cloud-browser', 'storage', 'safety', 'security',
    'parental', 'trusted-contacts', 'account', 'shortcuts',
  ]
  return validTabs.includes(value) ? value : 'general'
}

function isPlainLeftClick(event: MouseEvent<HTMLElement>) {
  return event.button === 0
    && !event.metaKey
    && !event.ctrlKey
    && !event.shiftKey
    && !event.altKey
}

function Icon({ name, size = 20, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" height={size} viewBox={`0 0 ${size} ${size}`} width={size}>
      <use href={`/chatgpt-icons.svg#${ICON_IDS[name]}`} />
    </svg>
  )
}

function ChatGPTMark({ className = '' }: { className?: string }) {
  return <svg aria-label="ChatGPT" className={className} role="img" viewBox="0 0 20 20"><use href="/chatgpt-icons.svg#chatgpt-mark" /></svg>
}

function ChatGPTWordmark() {
  return <svg aria-hidden="true" className="product-wordmark" viewBox="0 0 357 62"><use href="/chatgpt-icons.svg#lightweight-home-wordmark-text" /></svg>
}

function VoiceModeIcon() {
  return (
    <svg aria-hidden="true" className="voice-mode-icon" viewBox="0 0 20 20">
      <rect x="3.25" y="8" width="1.7" height="4" rx=".85" />
      <rect x="6.2" y="5.75" width="1.7" height="8.5" rx=".85" />
      <rect x="9.15" y="3.75" width="1.7" height="12.5" rx=".85" />
      <rect x="12.1" y="6" width="1.7" height="8" rx=".85" />
      <rect x="15.05" y="8" width="1.7" height="4" rx=".85" />
    </svg>
  )
}

function CopyMessageIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path d="M7.5 6.25h6.25v6.25M6.25 13.75h-1.5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v1.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
      <rect x="6.25" y="6.25" width="10" height="10" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function ShareMessageIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path d="M10 12.75v-9m0 0L6.75 6.9M10 3.75l3.25 3.15M6 8.75H4.75a1 1 0 0 0-1 1v5.5a1 1 0 0 0 1 1h10.5a1 1 0 0 0 1-1v-5.5a1 1 0 0 0-1-1H14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
    </svg>
  )
}

function RailAccountIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.35" />
      <circle cx="10" cy="7.6" r="2.05" stroke="currentColor" strokeWidth="1.25" />
      <path d="M6.4 14.1c.7-1.75 1.9-2.65 3.6-2.65s2.9.9 3.6 2.65" stroke="currentColor" strokeLinecap="round" strokeWidth="1.25" />
    </svg>
  )
}

type SidebarRowProps = {
  icon: IconName
  label: string
  active?: boolean
  external?: boolean
  href?: string
  controls?: string
  expanded?: boolean
  onClick?: (event: MouseEvent<HTMLElement>) => void
}

function SidebarRow({ icon, label, active = false, external = false, href, controls, expanded, onClick }: SidebarRowProps) {
  const contents = <><Icon name={icon} /><span>{label}</span>{external && <Icon name="external-link" size={16} className="row-external" />}</>
  if (href) return <a className={`sidebar-row${active ? ' is-active' : ''}`} href={href} aria-current={active ? 'page' : undefined} aria-label={label} onClick={onClick}>{contents}</a>
  return <button type="button" className={`sidebar-row${active ? ' is-active' : ''}`} aria-label={label} aria-haspopup={controls ? 'dialog' : undefined} aria-controls={controls} aria-expanded={controls ? expanded : undefined} onClick={onClick}>{contents}</button>
}

function SidebarFeatureCard({
  kind,
  open,
  anchorRef,
  cardRef,
  onEnter,
  onLeave,
  onLogin,
  onSignup,
  imagesVariant = false,
}: {
  kind: 'search' | 'deep'
  open: boolean
  anchorRef: RefObject<HTMLDivElement | null>
  cardRef: RefObject<HTMLDivElement | null>
  onEnter: () => void
  onLeave: () => void
  onLogin: () => void
  onSignup: () => void
  imagesVariant?: boolean
}) {
  const [present, setPresent] = useState(open)
  const [active, setActive] = useState(false)
  const [position, setPosition] = useState({ top: 8, left: 270 })

  useEffect(() => {
    if (open) {
      // Presence mirrors the controlled value while retaining the exit frame.
      // eslint-disable-next-line react/set-state-in-effect
      setPresent(true)
      const frame = window.requestAnimationFrame(() => setActive(true))
      return () => window.cancelAnimationFrame(frame)
    }
    // eslint-disable-next-line react/set-state-in-effect
    setActive(false)
    const timeout = window.setTimeout(() => setPresent(false), 120)
    return () => window.clearTimeout(timeout)
  }, [open])

  useLayoutEffect(() => {
    if (!present) return
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect()
      if (!anchor) return
      const width = Math.min(340, window.innerWidth - 16)
      const height = imagesVariant && kind === 'deep' ? 308 : 316
      const gap = imagesVariant && kind === 'deep' ? 10 : kind === 'search' ? 10 : 8
      const idealLeft = anchor.right + gap
      const left = idealLeft + width <= window.innerWidth - 8
        ? idealLeft
        : Math.max(8, anchor.left - gap - width)
      setPosition({
        top: Math.max(8, Math.min(anchor.top - (imagesVariant && kind === 'deep' ? 16 : 12), window.innerHeight - height - 8)),
        left,
      })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchorRef, imagesVariant, kind, present])

  if (!present) return null
  const isSearch = kind === 'search'
  return createPortal(
    <div
      ref={cardRef}
      id={isSearch ? 'desktop-search-product-card-popover' : 'desktop-deep-research-product-card-popover'}
      className={`sidebar-feature-card${imagesVariant ? ' is-images-variant' : ''}${active ? ' is-open' : ''}`}
      role="dialog"
      aria-label={isSearch ? '搜索你的聊天历史记录' : imagesVariant ? '从问题出发，开启研究之旅' : '将问题转化为研究'}
      style={{ top: position.top, left: position.left }}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <div className={`feature-card-hero ${isSearch ? 'is-search' : 'is-deep'}`} />
      <div className="feature-card-content">
        <h2>{isSearch ? '搜索你的聊天历史记录' : imagesVariant ? '从问题出发，开启研究之旅' : '将问题转化为研究'}</h2>
        <p>{isSearch
          ? '登录即可保存对话、检索历史回答，并从上次中断位置继续对话。'
          : imagesVariant ? '登录后进行多步骤研究、对比数据源并保存引用报告以备复查。' : '登录即可开展多步骤研究、比对信息来源，保存附带引用的报告以供后续查阅。'}</p>
        <div className="feature-card-actions">
          <button type="button" onClick={onLogin}>登录</button>
          <button type="button" onClick={onSignup}>免费注册</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function AttachmentMenu({
  isMobile, placement, webSearch, onWebSearch, onAuth, onPickCamera, onPickPhotos, onPickFiles, menuRef,
}: {
  isMobile: boolean
  placement: 'up' | 'down'
  webSearch: boolean
  onWebSearch: () => void
  onAuth: () => void
  onPickCamera: () => void
  onPickPhotos: () => void
  onPickFiles: () => void
  menuRef: RefObject<HTMLDivElement | null>
}) {
  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]'))
    if (!items.length) return
    event.preventDefault()
    const currentIndex = items.indexOf(document.activeElement as HTMLElement)
    let nextIndex = 0
    if (event.key === 'End') nextIndex = items.length - 1
    else if (event.key === 'ArrowUp') nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1
    else if (event.key === 'ArrowDown') nextIndex = currentIndex < 0 || currentIndex === items.length - 1 ? 0 : currentIndex + 1
    items[nextIndex]?.focus()
  }

  if (isMobile) return (
    <div className={`attachment-menu mobile-attachment-menu opens-${placement}`} id="composer-actions-popover" ref={menuRef} role="menu" onKeyDown={handleMenuKeyDown}>
      <button type="button" role="menuitem" onClick={onPickCamera}><Icon name="camera" /><span>相机</span></button>
      <button type="button" role="menuitem" onClick={onPickPhotos}><Icon name="photo" /><span>照片</span></button>
      <button type="button" role="menuitem" onClick={onPickFiles}><Icon name="file" /><span>文件</span></button>
    </div>
  )
  return (
    <div className={`attachment-menu opens-${placement}`} id="composer-actions-popover" ref={menuRef} role="menu" onKeyDown={handleMenuKeyDown}>
      <button type="button" role="menuitem" onClick={onPickPhotos}><Icon name="paperclip" /><span>添加照片</span></button>
      <button type="button" role="menuitemcheckbox" aria-checked={webSearch} onClick={onWebSearch}>
        <Icon name="web-search" /><span>网页搜索</span>{webSearch && <Icon name="check" size={16} className="menu-check" />}
      </button>
      <div className="attachment-separator" role="separator" />
      <p>登录后使用更多功能</p>
      <button type="button" className="locked-menu-item" role="menuitem" onClick={onAuth}><Icon name="create-image" /><span>创建图像</span><em>登录</em></button>
      <button type="button" className="locked-menu-item" role="menuitem" onClick={onAuth}><Icon name="deep-research" /><span>深度研究</span></button>
      <button type="button" className="locked-menu-item" role="menuitem" onClick={onAuth}><Icon name="add-files" /><span>添加文件</span></button>
    </div>
  )
}

function App() {
  const [route, setRoute] = useState<RouteKey>(() => readRoute())
  const [forceAnonymous] = useState(() => new URLSearchParams(window.location.search).get('guest') === '1')
  const [authState, setAuthState] = useState<AuthState>(() => createInitialAuthState(forceAnonymous))
  const [accountRuntime, setAccountRuntime] = useState<AccountRuntime | null>(null)
  const [sessionLoginOpen, setSessionLoginOpen] = useState(false)
  const [homeSurface, setHomeSurface] = useState<HomeSurface>(() => readInitialHomeSurface())
  const [locationHref, setLocationHref] = useState(() => `${window.location.pathname}${window.location.search}`)
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches)
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(() => localStorage.getItem(SIDEBAR_KEY) !== 'true')
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const [mobileBackdropPresent, setMobileBackdropPresent] = useState(false)
  const [layer, setLayer] = useState<Layer>(() => isSettingsHash() ? 'settings' : null)
  const [authIntent, setAuthIntent] = useState<AuthIntent>('login_or_signup')
  const [authContext, setAuthContext] = useState<'generic' | 'images'>('generic')
  const [prompt, setPrompt] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [webSearch, setWebSearch] = useState(false)
  const [attachmentPlacement, setAttachmentPlacement] = useState<'up' | 'down'>('down')
  const [selectedAttachments, setSelectedAttachments] = useState<ComposerAttachment[]>([])
  const [micState, setMicState] = useState<PlusMicState>('idle')
  const [notice, setNotice] = useState<{ id: number; message: string } | null>(null)
  const [copiedTurnId, setCopiedTurnId] = useState<Turn['id'] | null>(null)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [theme, setTheme] = useState<ThemeMode>(() => (localStorage.getItem('replica-theme') as ThemeMode) || 'system')
  const [language, setLanguage] = useState(() => localStorage.getItem('replica-language') || 'auto')
  const [accountSettings, setAccountSettings] = useState<AccountSettings>(DEFAULT_ACCOUNT_SETTINGS)
  const [accountSettingsCapabilities, setAccountSettingsCapabilities] = useState<Record<string, SettingCapability>>({})
  const [accountSettingsOptions, setAccountSettingsOptions] = useState<AccountSettingsOptions>(EMPTY_ACCOUNT_SETTINGS_OPTIONS)
  const [chatModelPreference, setChatModelPreference] = useState<ChatModelPreference | null>(null)
  const [plusMode, setPlusMode] = useState<PlusMode>('chat')
  const [plusLayer, setPlusLayer] = useState<PlusLayer>(null)
  const [plusModel, setPlusModel] = useState<PlusModelId>('default')
  const [chatReasoningEffort, setChatReasoningEffort] = useState<ReasoningEffort>(2)
  const [workReasoningEffort, setWorkReasoningEffort] = useState<ReasoningEffort>(1)
  const [draftServiceTier, setDraftServiceTier] = useState<RequestServiceTier | undefined>()
  const [conversationServiceTiers, setConversationServiceTiers] = useState<Record<string, RequestServiceTier>>({})
  const [plusConversations, setPlusConversations] = useState<PlusConversation[]>([])
  const [historyStatus, setHistoryStatus] = useState<HistoryLoadStatus>('idle')
  const [workspaceUsage, setWorkspaceUsage] = useState<WorkspaceUsageView>({
    status: 'loading',
    remainingPercent: null,
    limitReached: null,
    windowDurationMins: null,
    resetsAt: null,
  })
  const [activeConversationId, setActiveConversationId] = useState<string | null>(() => readConversationIdFromPath())
  const [guestConversationId, setGuestConversationId] = useState(() => createLocalConversationId())
  const [selectedConversation, setSelectedConversation] = useState<PlusConversation | null>(null)
  const [settingsInitialTab, setSettingsInitialTab] = useState<PlusSettingsTabId>(() => settingsTabFromHistory())

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const sidebarOpenButtonRef = useRef<HTMLButtonElement>(null)
  const sidebarCloseButtonRef = useRef<HTMLButtonElement>(null)
  const productTriggerRef = useRef<HTMLButtonElement>(null)
  const searchFeatureAnchorRef = useRef<HTMLDivElement>(null)
  const deepFeatureAnchorRef = useRef<HTMLDivElement>(null)
  const featureCardRef = useRef<HTMLDivElement>(null)
  const attachmentTriggerRef = useRef<HTMLButtonElement>(null)
  const attachmentMenuRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const conversationViewRef = useRef<HTMLElement>(null)
  const stickToConversationBottomRef = useRef(true)
  const copyResetTimerRef = useRef<number | null>(null)
  const generationAbortRef = useRef<AbortController | null>(null)
  const usageAbortRef = useRef<AbortController | null>(null)
  const historyListAbortRef = useRef<AbortController | null>(null)
  const historyDetailAbortRef = useRef<AbortController | null>(null)
  const historyDetailRequestRef = useRef(0)
  const upstreamConversationIdsRef = useRef<Map<string, string>>(new Map())
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  const dictationBaseRef = useRef('')
  const dictationFinalRef = useRef('')
  const micErrorResetRef = useRef<number | null>(null)
  const nextIdRef = useRef(1)
  const nextAttachmentIdRef = useRef(1)
  const featureOpenTimerRef = useRef<number | null>(null)
  const featureCloseTimerRef = useRef<number | null>(null)
  const featurePinnedRef = useRef(false)
  const restoreMobileOpenerRef = useRef(false)
  const modalFallbackRef = useRef<HTMLElement | null>(null)
  const noticeIdRef = useRef(1)
  const plusAccountAnchorRef = useRef<HTMLElement | null>(null)
  const plusModelAnchorRef = useRef<HTMLElement | null>(null)
  const plusMoreAnchorRef = useRef<HTMLElement | null>(null)
  const plusChatMenuAnchorRef = useRef<HTMLElement | null>(null)
  const plusAttachmentAnchorRef = useRef<HTMLElement | null>(null)
  const sessionRequestVersionRef = useRef(0)
  const accountSettingsRevisionRef = useRef(0)
  const accountSettingsOwnerRef = useRef<string | null>(null)
  const accountSettingsPendingRef = useRef<AccountSettingsPatch>({})
  const accountSettingsTimerRef = useRef<number | null>(null)
  const accountSettingsSaveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const chatModelPreferenceAppliedRef = useRef<number | null>(null)
  const chatModelPreferenceMutationRef = useRef(0)
  const chatModelPreferenceTimerRef = useRef<number | null>(null)
  const chatModelPreferenceSaveQueueRef = useRef<Promise<void>>(Promise.resolve())

  const sidebarOpen = isMobile ? mobileDrawerOpen : desktopSidebarOpen
  const sessionAccount = authState.account
  const isAuthenticated = authState.status === 'authenticated'
  const isHomeRoute = route === 'home'
  const isPlusChatRoute = isAuthenticated && (route === 'home' || route === 'conversation')
  const isPlusWorkspaceRoute = isAuthenticated && (isPlusChatRoute || route === 'library' || route === 'projects' || route === 'tasks')
  const isPluginRoute = route === 'plugins' || route === 'plugin-detail'
  const isReturnedHome = isHomeRoute && homeSurface === 'full-app'
  const settingsVariant = !isMobile || route === 'images' || isPluginRoute || isReturnedHome ? 'images' : 'default'
  const isPluginCategory = route === 'plugins' && new URL(locationHref, window.location.origin).searchParams.has('category')
  const hasConversation = turns.length > 0
  const visibleConversation = isHomeRoute && hasConversation
  // The full-app desktop composer exposes Voice mode when empty.  Its compact
  // mobile variant keeps the regular send affordance (matching ChatGPT's
  // responsive composer) rather than carrying the desktop waveform button
  // into the narrow layout.
  const showVoiceMode = isReturnedHome && !isMobile && !prompt.trim() && !isGenerating
  const showSuggestion = isHomeRoute && !isReturnedHome && !hasConversation && !prompt.trim() && selectedAttachments.length === 0 && !webSearch && layer !== 'auth'
  const speechRecognitionConstructor = (window as SpeechRecognitionWindow).SpeechRecognition
    ?? (window as SpeechRecognitionWindow).webkitSpeechRecognition
  const dictationSupported = Boolean(speechRecognitionConstructor) && (!sessionAccount || accountSettings.general.dictation)
  const accountPresentation = sessionAccount ?? EMPTY_ACCOUNT_PRESENTATION
  const accountPlan: AccountPlan = accountPresentation.plan
  const isFreeExperience = accountPlan === 'free'
  const isPaidExperience = accountPlan !== 'free' && accountPlan !== 'unknown'
  const paidPlanVariant = accountPlan === 'pro' ? 'pro' : 'plus'
  const workspaceCapabilities = {
    work: !blockedCapability(accountRuntime, ['work', 'agent_mode', 'computer_use']),
    images: !blockedCapability(accountRuntime, ['image_generation', 'image_gen', 'dall_e']),
    webSearch: !blockedCapability(accountRuntime, ['web_search', 'search']),
    plugins: !blockedCapability(accountRuntime, ['plugins', 'plugin', 'gizmos', 'gizmo']),
    deepResearch: !blockedCapability(accountRuntime, ['deep_research', 'research']),
    files: !blockedCapability(accountRuntime, ['file_upload', 'files', 'attachment']),
  }
  const hiddenSidebarActions: PlusSidebarMoreAction[] = [
    ...(!workspaceCapabilities.deepResearch ? ['deep-research' as const] : []),
    ...(!workspaceCapabilities.images ? ['images' as const] : []),
    ...(!workspaceCapabilities.plugins ? ['gpts' as const] : []),
  ]
  const hiddenAttachmentActions: PlusAttachmentAction[] = [
    ...(!workspaceCapabilities.files ? ['upload' as const, 'library' as const] : []),
    ...(!workspaceCapabilities.images ? ['create-image' as const] : []),
    ...(!workspaceCapabilities.webSearch ? ['web-search' as const] : []),
    ...(!workspaceCapabilities.deepResearch ? ['deep-research' as const] : []),
    ...(!workspaceCapabilities.plugins ? ['github' as const, 'visualize' as const, 'sites' as const, 'gmail' as const] : []),
  ]
  const effectivePlusMode: PlusMode = workspaceCapabilities.work ? plusMode : 'chat'
  const runtimeModelOptions = modelOptionsForRuntime(accountRuntime, effectivePlusMode, accountPlan)
  const powerSliderOptions = powerOptionsForRuntime(
    accountRuntime,
    effectivePlusMode,
    accountPlan,
    plusModel,
  )
  const requestedReasoningEffort = effectivePlusMode === 'work'
    ? workReasoningEffort
    : chatReasoningEffort
  const reasoningEffort = Math.min(
    Math.max(Math.trunc(requestedReasoningEffort), 0),
    Math.max(powerSliderOptions.length - 1, 0),
  )
  const selectedPowerOption = powerSliderOptions[reasoningEffort]
  const effectiveReasoningLabel = selectedPowerOption?.label ?? ''
  const configuredServiceTier = activeConversationId
    ? conversationServiceTiers[activeConversationId]
    : draftServiceTier
  const selectedDefaultServiceTier = requestServiceTier(selectedPowerOption?.defaultServiceTier ?? '')
  const effectiveServiceTier = resolveServiceTier(
    configuredServiceTier,
    selectedDefaultServiceTier,
    selectedPowerOption?.serviceTierOptions ?? [],
  )
  const selectedServiceTierOptions = requestServiceTierOptions(
    selectedPowerOption?.serviceTierOptions ?? [],
  )
  const supportsFastMode = selectedServiceTierOptions.includes('standard')
    && selectedServiceTierOptions.includes('fast')
  const fastMode = effectiveServiceTier === 'fast'
  const powerModelLabel = (() => {
    if (selectedPowerOption?.isMaximumEffort) return 'Pro'
    const surface = effectivePlusMode === 'work' ? accountRuntime?.work : accountRuntime?.chat
    const runtimeModel = surface?.models.find((model) => model.slug === selectedPowerOption?.modelSlug)
    return (runtimeModel?.title || (effectivePlusMode === 'work' ? 'GPT-5.6 Sol' : 'GPT-5.6 Sol'))
      .replace(/^GPT-/i, '')
  })()
  const notify = useCallback((message: string) => setNotice({ id: noticeIdRef.current++, message }), [])

  const updateConversationStickiness = useCallback((scroller: HTMLElement) => {
    const shouldStick = shouldStickToConversationBottom(scroller)
    stickToConversationBottomRef.current = shouldStick
    setShowScrollToBottom(!shouldStick)
  }, [])

  const scrollConversationToBottom = useCallback(() => {
    const scroller = conversationViewRef.current
    if (!scroller) return
    stickToConversationBottomRef.current = true
    setShowScrollToBottom(false)
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
  }, [])

  const setScopedServiceTier = useCallback((tier: RequestServiceTier | undefined) => {
    if (activeConversationId) {
      setConversationServiceTiers((current) => {
        const next = { ...current }
        if (tier) next[activeConversationId] = tier
        else delete next[activeConversationId]
        return next
      })
    }
    // Production also updates the draft preference while scoping the current
    // conversation, so the next new chat inherits the latest choice.
    setDraftServiceTier(tier)
  }, [activeConversationId])

  const normalizeScopedServiceTier = useCallback((
    mode: PlusMode,
    model: PlusModelId,
    effort: ReasoningEffort,
  ) => {
    const options = powerOptionsForRuntime(accountRuntime, mode, accountPlan, model)
    const index = Math.min(
      Math.max(Math.trunc(effort), 0),
      Math.max(options.length - 1, 0),
    )
    const option = options[index]
    const configured = activeConversationId
      ? conversationServiceTiers[activeConversationId]
      : draftServiceTier
    const normalized = resolveServiceTier(
      configured,
      requestServiceTier(option?.defaultServiceTier ?? ''),
      option?.serviceTierOptions ?? [],
    )
    // The official picker persists this fallback. Merely deriving it for one
    // render would let an unsupported old Fast selection revive after the user
    // switches back to another model.
    setScopedServiceTier(normalized)
  }, [
    accountPlan,
    accountRuntime,
    activeConversationId,
    conversationServiceTiers,
    draftServiceTier,
    setScopedServiceTier,
  ])

  const persistChatModelSelection = useCallback((model: PlusModelId, effort: ReasoningEffort) => {
    if (!sessionAccount) return
    const options = powerOptionsForRuntime(accountRuntime, 'chat', accountPlan, model)
    const index = Math.min(
      Math.max(Math.trunc(effort), 0),
      Math.max(options.length - 1, 0),
    )
    const option = options[index]
    if (!option?.modelSlug) return
    const sessionVersion = sessionRequestVersionRef.current
    const mutation = ++chatModelPreferenceMutationRef.current
    chatModelPreferenceAppliedRef.current = sessionVersion
    if (chatModelPreferenceTimerRef.current !== null) {
      window.clearTimeout(chatModelPreferenceTimerRef.current)
    }
    chatModelPreferenceTimerRef.current = window.setTimeout(() => {
      chatModelPreferenceTimerRef.current = null
      if (sessionRequestVersionRef.current !== sessionVersion) return
      const stillCurrent = () => sessionRequestVersionRef.current === sessionVersion
      const save = async () => {
        if (!stillCurrent()) return
        try {
          const preference = await patchChatModelPreference(option.modelSlug, option.thinkingEffort)
          if (!stillCurrent() || mutation !== chatModelPreferenceMutationRef.current) return
          chatModelPreferenceAppliedRef.current = sessionVersion
          setChatModelPreference(preference)
        } catch {
          if (!stillCurrent() || mutation !== chatModelPreferenceMutationRef.current) return
          try {
            const upstreamPreference = await getChatModelPreference()
            if (!stillCurrent() || mutation !== chatModelPreferenceMutationRef.current) return
            // Let the hydration effect translate the upstream model/effort
            // pair back to the current Chat-only slider catalog.
            chatModelPreferenceAppliedRef.current = null
            setChatModelPreference(upstreamPreference)
            notify('模型或思考强度保存失败，已恢复服务器中的选择。')
          } catch {
            // Keep the optimistic choice when upstream truth cannot be reloaded
            // rather than making up a fallback from Work or another plan.
            if (stillCurrent() && mutation === chatModelPreferenceMutationRef.current) {
              notify('模型或思考强度保存失败，且暂时无法重新读取 Chat 设置。')
            }
          }
        }
      }
      // Debouncing alone does not order requests that are already in flight.
      // Serialize writes so an older, slower PATCH cannot overwrite the user's
      // latest selection upstream. Stale-session jobs self-cancel before I/O.
      chatModelPreferenceSaveQueueRef.current = chatModelPreferenceSaveQueueRef.current
        .catch(() => undefined)
        .then(save)
    }, 220)
  }, [accountPlan, accountRuntime, notify, sessionAccount])

  const clearAccountSettingsState = useCallback(() => {
    if (accountSettingsTimerRef.current !== null) window.clearTimeout(accountSettingsTimerRef.current)
    if (chatModelPreferenceTimerRef.current !== null) window.clearTimeout(chatModelPreferenceTimerRef.current)
    accountSettingsTimerRef.current = null
    chatModelPreferenceTimerRef.current = null
    accountSettingsPendingRef.current = {}
    accountSettingsRevisionRef.current = 0
    accountSettingsOwnerRef.current = null
    accountSettingsSaveQueueRef.current = Promise.resolve()
    chatModelPreferenceAppliedRef.current = null
    chatModelPreferenceMutationRef.current = 0
    setAccountSettings(DEFAULT_ACCOUNT_SETTINGS)
    setAccountSettingsCapabilities({})
    setAccountSettingsOptions(EMPTY_ACCOUNT_SETTINGS_OPTIONS)
    setChatModelPreference(null)
  }, [])

  const loadAccountSettings = useCallback(async (requestVersion: number, account: SessionAccount) => {
    try {
      const preferenceMutation = chatModelPreferenceMutationRef.current
      const [snapshot, modelPreference] = await Promise.all([
        getAccountSettings(),
        getChatModelPreference().catch(() => null),
      ])
      if (requestVersion !== sessionRequestVersionRef.current || !snapshot.authenticated) return
      accountSettingsOwnerRef.current = account.id
      accountSettingsRevisionRef.current = snapshot.revision
      accountSettingsPendingRef.current = {}
      setAccountSettings(snapshot.settings)
      setAccountSettingsCapabilities(snapshot.capabilities)
      setAccountSettingsOptions(snapshot.options)
      if (preferenceMutation === chatModelPreferenceMutationRef.current) {
        chatModelPreferenceAppliedRef.current = null
        setChatModelPreference(modelPreference)
      }
      setTheme(snapshot.settings.general.theme)
      setLanguage(snapshot.settings.general.language)
    } catch (error) {
      if (requestVersion !== sessionRequestVersionRef.current) return
      notify(error instanceof AccountSettingsError ? error.message : '设置加载失败，请稍后重试。')
    }
  }, [notify])

  const flushAccountSettings = useCallback(() => {
    accountSettingsTimerRef.current = null
    const changes = accountSettingsPendingRef.current
    if (Object.keys(changes).length === 0) return
    accountSettingsPendingRef.current = {}
    const owner = accountSettingsOwnerRef.current
    if (!owner) return
    const sessionVersion = sessionRequestVersionRef.current
    const patches = splitAccountSettingsPatch(changes)
    const stillCurrent = () => (
      accountSettingsOwnerRef.current === owner
      && sessionRequestVersionRef.current === sessionVersion
    )

    accountSettingsSaveQueueRef.current = accountSettingsSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (!stillCurrent()) return
        try {
          for (const patch of patches) {
            if (!stillCurrent()) return
            let snapshot
            try {
              snapshot = await patchAccountSettings(patch, accountSettingsRevisionRef.current)
            } catch (error) {
              if (!(error instanceof AccountSettingsError) || error.status !== 409) throw error
              const current = await getAccountSettings()
              if (!stillCurrent()) return
              accountSettingsRevisionRef.current = current.revision
              setAccountSettingsCapabilities(current.capabilities)
              setAccountSettingsOptions(current.options)
              snapshot = await patchAccountSettings(patch, current.revision)
            }
            if (!stillCurrent()) return
            accountSettingsRevisionRef.current = snapshot.revision
            setAccountSettings((current) => mergeAccountSettings(current, patch))
          }
          // The upstream voice catalog is scoped by language and voice mode.
          // Refresh it after either dependency changes so the next voice click
          // is rendered from, and validated against, the matching catalog.
          if (changes.voice && ('language' in changes.voice || 'model' in changes.voice)) {
            const current = await getAccountSettings()
            if (!stillCurrent()) return
            accountSettingsRevisionRef.current = current.revision
            setAccountSettings(mergeAccountSettings(current.settings, accountSettingsPendingRef.current))
            setAccountSettingsCapabilities(current.capabilities)
            setAccountSettingsOptions(current.options)
            setTheme(current.settings.general.theme)
            setLanguage(current.settings.general.language)
          }
        } catch (error) {
          if (!stillCurrent()) return
          try {
            const current = await getAccountSettings()
            if (stillCurrent()) {
              accountSettingsRevisionRef.current = current.revision
              setAccountSettings(mergeAccountSettings(current.settings, accountSettingsPendingRef.current))
              setAccountSettingsCapabilities(current.capabilities)
              setAccountSettingsOptions(current.options)
              setTheme(current.settings.general.theme)
              setLanguage(current.settings.general.language)
            }
          } catch {
            // Keep the optimistic state if even the recovery read is unavailable.
          }
          notify(error instanceof AccountSettingsError ? error.message : '设置保存失败，请稍后重试。')
        }
      })
  }, [notify])

  const changeAccountSettings = useCallback((changes: AccountSettingsPatch) => {
    if (!accountSettingsOwnerRef.current) {
      notify('设置仍在加载，请稍后再试。')
      return
    }
    setAccountSettings((current) => mergeAccountSettings(current, changes))
    accountSettingsPendingRef.current = mergeAccountSettingsPatch(accountSettingsPendingRef.current, changes)
    if (accountSettingsTimerRef.current !== null) window.clearTimeout(accountSettingsTimerRef.current)
    accountSettingsTimerRef.current = window.setTimeout(flushAccountSettings, 320)
  }, [flushAccountSettings, notify])

  useEffect(() => () => {
    if (accountSettingsTimerRef.current !== null) window.clearTimeout(accountSettingsTimerRef.current)
    if (chatModelPreferenceTimerRef.current !== null) window.clearTimeout(chatModelPreferenceTimerRef.current)
  }, [])

  const resetAccountWorkspace = useCallback((
    nextPlan: AccountPlan,
    { preserveNavigation = false }: { preserveNavigation?: boolean } = {},
  ) => {
    generationAbortRef.current?.abort()
    generationAbortRef.current = null
    usageAbortRef.current?.abort()
    usageAbortRef.current = null
    historyListAbortRef.current?.abort()
    historyListAbortRef.current = null
    historyDetailAbortRef.current?.abort()
    historyDetailAbortRef.current = null
    historyDetailRequestRef.current += 1
    recognitionRef.current?.abort()
    recognitionRef.current = null
    upstreamConversationIdsRef.current.clear()
    if (micErrorResetRef.current) window.clearTimeout(micErrorResetRef.current)
    micErrorResetRef.current = null
    if (featureOpenTimerRef.current) window.clearTimeout(featureOpenTimerRef.current)
    if (featureCloseTimerRef.current) window.clearTimeout(featureCloseTimerRef.current)
    featureOpenTimerRef.current = null
    featureCloseTimerRef.current = null
    featurePinnedRef.current = false
    restoreMobileOpenerRef.current = false
    modalFallbackRef.current = null
    dictationBaseRef.current = ''
    dictationFinalRef.current = ''
    nextIdRef.current = 1
    nextAttachmentIdRef.current = 1

    setGuestConversationId(createLocalConversationId())
    setAccountRuntime(null)
    setTurns([])
    setPrompt('')
    setSelectedAttachments([])
    setWebSearch(false)
    setIsGenerating(false)
    setMicState('idle')
    setNotice(null)
    setLayer(null)
    setPlusLayer(null)
    setSessionLoginOpen(false)
    setMobileDrawerOpen(false)
    setPlusMode('chat')
    setDraftServiceTier(undefined)
    setConversationServiceTiers({})
    setWorkspaceUsage({
      status: 'loading',
      remainingPercent: null,
      limitReached: null,
      windowDurationMins: null,
      resetsAt: null,
    })
    // Match the account's normal Chat endpoint: Plus defaults to its highest
    // Thinking preset, while Pro defaults to the dedicated right-most Pro lane.
    setPlusModel('default')
    setChatReasoningEffort(preferredPowerIndex(
      fallbackPowerOptions('chat', nextPlan, 'default'),
      'chat',
      nextPlan,
    ))
    setWorkReasoningEffort(preferredPowerIndex(
      fallbackPowerOptions('work', nextPlan, 'default'),
      'work',
      nextPlan,
    ))
    // History is always reloaded from the newly authenticated account. Never
    // carry list rows, loaded turns, or continuation handles across accounts.
    setPlusConversations([])
    setHistoryStatus('idle')
    setActiveConversationId(null)
    setSelectedConversation(null)
    setHomeSurface('lightweight')
    if (!preserveNavigation) {
      setRoute('home')
      setLocationHref('/')
      window.history.replaceState({}, '', '/')
    }
  }, [])

  const loadWorkspaceUsage = useCallback(async (requestVersion: number) => {
    usageAbortRef.current?.abort()
    const controller = new AbortController()
    usageAbortRef.current = controller
    setWorkspaceUsage({
      status: 'loading',
      remainingPercent: null,
      limitReached: null,
      windowDurationMins: null,
      resetsAt: null,
    })
    try {
      const snapshot = await getAccountUsage(controller.signal)
      if (controller.signal.aborted || requestVersion !== sessionRequestVersionRef.current) return
      if (snapshot.availability === 'unavailable') {
        setWorkspaceUsage({
          status: 'unavailable',
          remainingPercent: null,
          limitReached: null,
          windowDurationMins: null,
          resetsAt: null,
          message: snapshot.message || '当前 Session 未返回可用的工作额度。',
        })
        return
      }
      const window = snapshot.quota.primary
      setWorkspaceUsage({
        status: 'available',
        unlimited: snapshot.availability === 'unlimited',
        remainingPercent: snapshot.quota.remainingPercent,
        limitReached: snapshot.quota.limitReached,
        windowDurationMins: window?.windowDurationMins ?? null,
        resetsAt: window?.resetsAt ?? null,
      })
    } catch (error) {
      if (controller.signal.aborted || requestVersion !== sessionRequestVersionRef.current) return
      setWorkspaceUsage({
        status: 'unavailable',
        remainingPercent: null,
        limitReached: null,
        windowDurationMins: null,
        resetsAt: null,
        message: accountUsageErrorMessage(error),
      })
    } finally {
      if (usageAbortRef.current === controller) usageAbortRef.current = null
    }
  }, [])

  const loadConversationDetail = useCallback(async (
    conversation: PlusConversation,
    requestVersion: number,
  ) => {
    historyDetailAbortRef.current?.abort()
    const controller = new AbortController()
    const detailRequest = ++historyDetailRequestRef.current
    historyDetailAbortRef.current = controller
    generationAbortRef.current?.abort()
    generationAbortRef.current = null
    upstreamConversationIdsRef.current.delete(conversation.id)
    setIsGenerating(false)
    setSelectedAttachments([])
    setPrompt('')
    setActiveConversationId(conversation.id)
    setTurns([{
      id: `loading-${detailRequest}`,
      role: 'assistant',
      text: '正在加载聊天记录…',
    }])
    try {
      const detail = await getConversationDetail(conversation.id, controller.signal)
      if (
        controller.signal.aborted
        || detailRequest !== historyDetailRequestRef.current
        || requestVersion !== sessionRequestVersionRef.current
      ) return
      upstreamConversationIdsRef.current.set(conversation.id, detail.continuationId)
      setPlusConversations((current) => current.map((item) => (
        item.id === conversation.id ? { ...item, ...detail.conversation } : item
      )))
      setTurns(detail.messages.length
        ? detail.messages.map((message) => ({
            id: message.id,
            role: message.role,
            text: message.content,
          }))
        : [{
            id: `empty-${detailRequest}`,
            role: 'assistant',
            text: '此聊天没有可显示的消息。',
          }])
    } catch (error) {
      if (
        controller.signal.aborted
        || detailRequest !== historyDetailRequestRef.current
        || requestVersion !== sessionRequestVersionRef.current
      ) return
      upstreamConversationIdsRef.current.delete(conversation.id)
      const message = conversationHistoryErrorMessage(error)
      setTurns([{
        id: `error-${detailRequest}`,
        role: 'assistant',
        text: `无法加载此聊天。${message}`,
      }])
      notify(message)
    } finally {
      if (historyDetailAbortRef.current === controller) historyDetailAbortRef.current = null
    }
  }, [notify])

  const loadConversationList = useCallback(async (requestVersion: number) => {
    historyListAbortRef.current?.abort()
    const controller = new AbortController()
    historyListAbortRef.current = controller
    setHistoryStatus('loading')
    try {
      const conversations = await getConversationHistory(controller.signal)
      if (controller.signal.aborted || requestVersion !== sessionRequestVersionRef.current) return
      setPlusConversations(conversations)
      setHistoryStatus('ready')
      const requestedId = readConversationIdFromPath()
      if (requestedId) {
        const requestedConversation = conversations.find((item) => item.id === requestedId)
        if (requestedConversation) {
          void loadConversationDetail(requestedConversation, requestVersion)
        } else {
          setActiveConversationId(requestedId)
          setTurns([{
            id: 'history-not-found',
            role: 'assistant',
            text: '此聊天记录不存在，或其本地句柄已过期。',
          }])
        }
      }
    } catch (error) {
      if (controller.signal.aborted || requestVersion !== sessionRequestVersionRef.current) return
      setPlusConversations([])
      setHistoryStatus('error')
      const requestedId = readConversationIdFromPath()
      if (requestedId) {
        setActiveConversationId(requestedId)
        setTurns([{
          id: 'history-list-error',
          role: 'assistant',
          text: `聊天记录暂不可用。${conversationHistoryErrorMessage(error)}`,
        }])
      }
    } finally {
      if (historyListAbortRef.current === controller) historyListAbortRef.current = null
    }
  }, [loadConversationDetail])

  const loadAccountRuntime = useCallback(async (requestVersion: number, account: SessionAccount) => {
    try {
      const snapshot = await getAccountRuntime()
      if (requestVersion !== sessionRequestVersionRef.current) return
      if (!snapshot.authenticated || !snapshot.runtime || snapshot.user?.id !== account.id) return
      const runtimePlan = snapshot.runtime.plan !== 'unknown'
        ? snapshot.runtime.plan
        : snapshot.user.plan !== 'unknown'
          ? snapshot.user.plan
          : account.plan
      if (runtimePlan !== account.plan) {
        // A late entitlement refresh must not eject the user from a directly
        // opened settings page (for example `/codex/cloud/settings/analytics`).
        resetAccountWorkspace(runtimePlan, { preserveNavigation: true })
        void loadWorkspaceUsage(requestVersion)
        void loadConversationList(requestVersion)
      }
      setAccountRuntime(snapshot.runtime)
      setChatReasoningEffort(preferredPowerIndex(
        powerOptionsForRuntime(snapshot.runtime, 'chat', runtimePlan, 'default'),
        'chat',
        runtimePlan,
      ))
      setWorkReasoningEffort(preferredPowerIndex(
        powerOptionsForRuntime(snapshot.runtime, 'work', runtimePlan, 'default'),
        'work',
        runtimePlan,
      ))
      setAuthState((current) => current.status === 'authenticated' && current.account.id === account.id
        ? authenticatedAuthState({
            ...current.account,
            plan: runtimePlan,
            planLabel: snapshot.runtime?.planLabel || snapshot.user?.planLabel || current.account.planLabel,
          })
        : current)
    } catch {
      // Runtime capabilities are an enhancement. Login remains usable with the
      // static plan-safe fallback if the upstream models endpoint is unavailable.
    }
  }, [loadConversationList, loadWorkspaceUsage, resetAccountWorkspace])

  useEffect(() => {
    if (!accountRuntime || !sessionAccount || chatModelPreference === null) return
    const sessionVersion = sessionRequestVersionRef.current
    if (chatModelPreferenceAppliedRef.current === sessionVersion) return

    if (!chatModelPreference.modelSlug) {
      chatModelPreferenceAppliedRef.current = sessionVersion
      setPlusModel('default')
      setChatReasoningEffort(preferredPowerIndex(
        powerOptionsForRuntime(accountRuntime, 'chat', accountPlan, 'default'),
        'chat',
        accountPlan,
      ))
      return
    }

    const findPreference = (model: PlusModelId) => {
      const options = powerOptionsForRuntime(accountRuntime, 'chat', accountPlan, model)
      let index = options.findIndex((option) => (
        option.modelSlug === chatModelPreference.modelSlug
        && (option.thinkingEffort ?? null) === chatModelPreference.thinkingEffort
      ))
      if (index < 0) {
        index = options.findIndex((option) => option.modelSlug === chatModelPreference.modelSlug)
      }
      return { index, options }
    }

    let selectedModel: PlusModelId = 'default'
    let match = findPreference(selectedModel)
    if (match.index < 0) {
      selectedModel = chatModelPreference.modelSlug
      match = findPreference(selectedModel)
    }
    chatModelPreferenceAppliedRef.current = sessionVersion
    if (match.index < 0) return
    setPlusModel(selectedModel)
    setChatReasoningEffort(match.index)
  }, [accountPlan, accountRuntime, chatModelPreference, sessionAccount])

  useEffect(() => {
    if (forceAnonymous) return
    let active = true
    const requestVersion = sessionRequestVersionRef.current
    void getAuthSession().then((snapshot) => {
      if (!active || requestVersion !== sessionRequestVersionRef.current) return
      if (snapshot.authenticated && snapshot.user) {
        // Restoring an already-authorized HttpOnly Session is hydration, not
        // an explicit navigation. Keep deep links intact on a fresh document.
        resetAccountWorkspace(snapshot.user.plan, { preserveNavigation: true })
        setAuthState(authStateFromSnapshot(snapshot))
        void loadAccountSettings(requestVersion, snapshot.user)
        void loadAccountRuntime(requestVersion, snapshot.user)
        void loadWorkspaceUsage(requestVersion)
        void loadConversationList(requestVersion)
      } else {
        clearAccountSettingsState()
        historyListAbortRef.current?.abort()
        historyDetailAbortRef.current?.abort()
        upstreamConversationIdsRef.current.clear()
        setPlusConversations([])
        setHistoryStatus('ready')
        setActiveConversationId(null)
        setTurns([])
        setAccountRuntime(null)
        setAuthState(ANONYMOUS_AUTH_STATE)
      }
    }).catch(() => {
      if (!active || requestVersion !== sessionRequestVersionRef.current) return
      // The local bridge being unavailable is not proof of a signed-in user.
      // Fail closed to the public shell instead of inventing a Free account.
      clearAccountSettingsState()
      setAccountRuntime(null)
      setAuthState(ANONYMOUS_AUTH_STATE)
    })
    return () => { active = false }
  }, [clearAccountSettingsState, forceAnonymous, loadAccountRuntime, loadAccountSettings, loadConversationList, loadWorkspaceUsage, resetAccountWorkspace])

  const submitSessionLogin = useCallback(async (session: string) => {
    const requestVersion = ++sessionRequestVersionRef.current
    // Do not trust only the write response. Re-read the opaque HttpOnly local
    // session and hydrate the account/plan from that authoritative snapshot.
    const snapshot = await loginWithSessionAndHydrate(session)
    if (requestVersion !== sessionRequestVersionRef.current || !snapshot.user) return
    resetAccountWorkspace(snapshot.user.plan)
    clearAccountSettingsState()
    setAuthState(authStateFromSnapshot(snapshot))
    void loadAccountSettings(requestVersion, snapshot.user)
    void loadAccountRuntime(requestVersion, snapshot.user)
    void loadWorkspaceUsage(requestVersion)
    void loadConversationList(requestVersion)
    notify(`已连接 ${snapshot.user.name}`)
  }, [clearAccountSettingsState, loadAccountRuntime, loadAccountSettings, loadConversationList, loadWorkspaceUsage, notify, resetAccountWorkspace])

  const disconnectSession = useCallback(async () => {
    ++sessionRequestVersionRef.current
    try {
      await logoutAuthSession()
      resetAccountWorkspace('free')
      clearAccountSettingsState()
      setAuthState(ANONYMOUS_AUTH_STATE)
      notify('已断开 Session')
    } catch (error) {
      notify(authSessionErrorMessage(error))
    }
  }, [clearAccountSettingsState, notify, resetAccountWorkspace])
  const closeSessionLogin = useCallback(() => setSessionLoginOpen(false), [])
  const showSessionLogin = useCallback(() => {
    // The secret itself remains only in SessionLoginDialog's in-memory field;
    // this transition stores no credential in history, URL or web storage.
    setLayer(null)
    setSessionLoginOpen(true)
  }, [])

  const abortDictation = useCallback(() => {
    if (micErrorResetRef.current) window.clearTimeout(micErrorResetRef.current)
    micErrorResetRef.current = null
    const recognition = recognitionRef.current
    recognitionRef.current = null
    if (recognition) {
      recognition.onstart = null
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      recognition.abort()
    }
    setMicState('idle')
  }, [])
  const clearFeatureTimers = useCallback(() => {
    if (featureOpenTimerRef.current) window.clearTimeout(featureOpenTimerRef.current)
    if (featureCloseTimerRef.current) window.clearTimeout(featureCloseTimerRef.current)
    featureOpenTimerRef.current = null
    featureCloseTimerRef.current = null
  }, [])
  const closeLayer = useCallback(() => {
    clearFeatureTimers()
    featurePinnedRef.current = false
    setLayer(null)
    if (restoreMobileOpenerRef.current) {
      restoreMobileOpenerRef.current = false
      window.setTimeout(() => sidebarOpenButtonRef.current?.focus(), 0)
    } else if (modalFallbackRef.current) {
      const fallback = modalFallbackRef.current
      modalFallbackRef.current = null
      window.setTimeout(() => fallback.isConnected && fallback.focus(), 0)
    }
  }, [clearFeatureTimers])

  const dismissForNavigation = useCallback(() => {
    const generation = generationAbortRef.current
    generationAbortRef.current = null
    generation?.abort()
    clearFeatureTimers()
    featurePinnedRef.current = false
    restoreMobileOpenerRef.current = false
    modalFallbackRef.current = null
    setLayer(null)
    setPlusLayer(null)
    setSessionLoginOpen(false)
    setMobileDrawerOpen(false)
    setNotice(null)
    abortDictation()
    setIsGenerating(false)
  }, [abortDictation, clearFeatureTimers])

  const navigate = useCallback((to: LocalRoutePath, replace = false) => {
    dismissForNavigation()
    const currentPath = `${window.location.pathname}${window.location.search}`
    const currentRoute = readRoute()
    if (currentPath !== to) {
      const state = to === '/' && isFullAppRoute(currentRoute) ? { homeSurface: 'full-app' } : {}
      window.history[replace ? 'replaceState' : 'pushState'](state, '', to)
    }
    const nextRoute = readRoute()
    setRoute(nextRoute)
    setHomeSurface(readHomeSurface(nextRoute))
    setLocationHref(`${window.location.pathname}${window.location.search}`)
  }, [dismissForNavigation])

  const completeProviderLogin = useCallback((snapshot: AuthSessionSnapshot, callbackPath: string) => {
    if (!snapshot.authenticated || !snapshot.user) return
    const requestVersion = ++sessionRequestVersionRef.current
    // The OAuth/device flow has already set the same HttpOnly local cookie
    // used by Session login. Hydrate every account-scoped surface from that
    // verified snapshot before returning to the caller's original route.
    resetAccountWorkspace(snapshot.user.plan, { preserveNavigation: true })
    clearAccountSettingsState()
    setAuthState(authStateFromSnapshot(snapshot))
    void loadAccountSettings(requestVersion, snapshot.user)
    void loadAccountRuntime(requestVersion, snapshot.user)
    void loadWorkspaceUsage(requestVersion)
    void loadConversationList(requestVersion)
    navigate(callbackPath as LocalRoutePath, true)
    notify(`已登录 ${snapshot.user.name}`)
  }, [clearAccountSettingsState, loadAccountRuntime, loadAccountSettings, loadConversationList, loadWorkspaceUsage, navigate, notify, resetAccountWorkspace])

  useLayoutEffect(() => {
    const anonymousDeepLink = authState.status === 'anonymous' && isAccountOnlyRoute(route)
    const unsupportedAccountWorkspace = isAuthenticated && !isPaidExperience && isWorkspaceOnlyRoute(route)
    if (!anonymousDeepLink && !unsupportedAccountWorkspace) return
    // Conversation and workspace URLs belong to a verified account. A stale
    // deep link must not leave an anonymous visitor, or an account without a
    // confirmed workspace entitlement, in an empty Plus shell.
    // eslint-disable-next-line react/set-state-in-effect
    navigate('/', true)
  }, [authState.status, isAuthenticated, isPaidExperience, navigate, route])

  const showAuth = useCallback((intent: AuthIntent = 'login_or_signup', context: 'generic' | 'images' = 'generic') => {
    clearFeatureTimers()
    featurePinnedRef.current = false
    restoreMobileOpenerRef.current = isMobile && mobileDrawerOpen
    if (!restoreMobileOpenerRef.current) {
      if (layer === 'product') modalFallbackRef.current = productTriggerRef.current
      else if (layer === 'search-card') modalFallbackRef.current = searchFeatureAnchorRef.current?.querySelector('button') ?? null
      else if (layer === 'deep-card') modalFallbackRef.current = deepFeatureAnchorRef.current?.querySelector('button') ?? null
      else modalFallbackRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
    setMobileDrawerOpen(false)
    setAuthIntent(intent)
    setAuthContext(context)
    setLayer('auth')
  }, [clearFeatureTimers, isMobile, layer, mobileDrawerOpen])

  const showSearchDialog = useCallback(() => {
    clearFeatureTimers()
    featurePinnedRef.current = false
    setLayer('search-dialog')
  }, [clearFeatureTimers])

  const showSettings = useCallback((tab: PlusSettingsTabId = 'general') => {
    clearFeatureTimers()
    featurePinnedRef.current = false
    restoreMobileOpenerRef.current = isMobile && mobileDrawerOpen
    modalFallbackRef.current = restoreMobileOpenerRef.current
      ? null
      : document.activeElement instanceof HTMLElement ? document.activeElement : null
    setMobileDrawerOpen(false)
    setPlusLayer(null)
    setSettingsInitialTab(tab)
    const nextHash = SETTINGS_HASH_BY_TAB[tab]
    if (!isSettingsHash()) {
      const currentState = window.history.state && typeof window.history.state === 'object' ? window.history.state : {}
      window.history.pushState({ ...currentState, [SETTINGS_HISTORY_KEY]: { tab } }, '', `${window.location.pathname}${window.location.search}${nextHash}`)
    } else {
      const currentState = window.history.state && typeof window.history.state === 'object' ? window.history.state : {}
      window.history.replaceState({ ...currentState, [SETTINGS_HISTORY_KEY]: { tab } }, '', `${window.location.pathname}${window.location.search}${nextHash}`)
    }
    setLayer('settings')
  }, [clearFeatureTimers, isMobile, mobileDrawerOpen])

  const closeSettings = useCallback(() => {
    closeLayer()
    if (!isSettingsHash()) return
    const currentState = window.history.state && typeof window.history.state === 'object' ? window.history.state : {}
    const { [SETTINGS_HISTORY_KEY]: _discarded, ...rest } = currentState
    window.history.replaceState(rest, '', `${window.location.pathname}${window.location.search}`)
  }, [closeLayer])

  const changeSettingsTab = useCallback((tab: PlusSettingsTabId) => {
    const nextHash = SETTINGS_HASH_BY_TAB[tab]
    setSettingsInitialTab(tab)
    if (window.location.hash === nextHash) return
    const currentState = window.history.state && typeof window.history.state === 'object' ? window.history.state : {}
    window.history.pushState({ ...currentState, [SETTINGS_HISTORY_KEY]: { tab } }, '', `${window.location.pathname}${window.location.search}${nextHash}`)
  }, [])

  useEffect(() => {
    const onPopState = () => {
      dismissForNavigation()
      const nextRoute = readRoute()
      setRoute(nextRoute)
      const conversationId = readConversationIdFromPath()
      if (conversationId) {
        const conversation = plusConversations.find((item) => item.id === conversationId)
        if (conversation) {
          void loadConversationDetail(conversation, sessionRequestVersionRef.current)
        } else if (historyStatus !== 'loading') {
          setActiveConversationId(conversationId)
          setTurns([{
            id: 'history-not-found-popstate',
            role: 'assistant',
            text: '此聊天记录不存在，或其本地句柄已过期。',
          }])
        }
      } else {
        historyDetailAbortRef.current?.abort()
        historyDetailAbortRef.current = null
        historyDetailRequestRef.current += 1
        setActiveConversationId(null)
        setTurns([])
      }
      setHomeSurface(readHomeSurface(nextRoute))
      setLocationHref(`${window.location.pathname}${window.location.search}`)
      if (isSettingsHash()) {
        setSettingsInitialTab(settingsTabFromHistory())
        setLayer('settings')
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [dismissForNavigation, historyStatus, loadConversationDetail, plusConversations])

  const openFeatureOnHover = (kind: FeatureCardKind) => {
    if (isMobile || featurePinnedRef.current) return
    if (featureCloseTimerRef.current) window.clearTimeout(featureCloseTimerRef.current)
    if (featureOpenTimerRef.current) window.clearTimeout(featureOpenTimerRef.current)
    featureOpenTimerRef.current = window.setTimeout(() => {
      featurePinnedRef.current = false
      setLayer(kind)
      featureOpenTimerRef.current = null
    }, 100)
  }

  const keepFeatureOpen = () => {
    if (featureCloseTimerRef.current) window.clearTimeout(featureCloseTimerRef.current)
    featureCloseTimerRef.current = null
  }

  const scheduleFeatureClose = (kind: FeatureCardKind) => {
    if (featureOpenTimerRef.current) window.clearTimeout(featureOpenTimerRef.current)
    featureOpenTimerRef.current = null
    if (featurePinnedRef.current) return
    if (featureCloseTimerRef.current) window.clearTimeout(featureCloseTimerRef.current)
    featureCloseTimerRef.current = window.setTimeout(() => {
      setLayer((current) => current === kind ? null : current)
      featureCloseTimerRef.current = null
    }, 300)
  }

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const sync = () => {
      const focusWasInSidebar = sidebarRef.current?.contains(document.activeElement) ?? false
      setIsMobile(media.matches)
      setMobileDrawerOpen(false)
      // Settings is itself responsive and must survive an orientation/window
      // breakpoint change. Closing it here also broke direct #settings loads,
      // because the old effect called sync() once during initial mount.
      setLayer((current) => current === 'settings' ? current : null)
      if (media.matches && focusWasInSidebar) window.setTimeout(() => sidebarOpenButtonRef.current?.focus(), 0)
    }
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (mobileDrawerOpen) {
      // Keep the scrim mounted long enough to animate both directions.
      // eslint-disable-next-line react/set-state-in-effect
      setMobileBackdropPresent(true)
      return
    }
    const timeout = window.setTimeout(() => setMobileBackdropPresent(false), 180)
    return () => window.clearTimeout(timeout)
  }, [mobileDrawerOpen])

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, String(!desktopSidebarOpen))
  }, [desktopSidebarOpen])

  useEffect(() => {
    const root = document.documentElement
    localStorage.setItem('replica-theme', theme)
    if (theme === 'system') {
      const media = window.matchMedia('(prefers-color-scheme: dark)')
      const apply = () => { root.dataset.theme = media.matches ? 'dark' : 'light' }
      apply(); media.addEventListener('change', apply)
      return () => media.removeEventListener('change', apply)
    }
    root.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    localStorage.setItem('replica-language', language)
    document.documentElement.lang = language === 'auto'
      ? 'zh-CN'
      : language.replace('_', '-')
  }, [language])

  useEffect(() => {
    const root = document.documentElement
    root.dataset.contrast = accountSettings.general.contrast === 'high'
      ? 'high'
      : accountSettings.general.contrast === 'standard'
        ? 'standard'
        : 'system'
    const accentColors: Record<AccountSettings['general']['accent'], [string, string]> = {
      default: ['', ''],
      black: ['#0d0d0d', '#fff'],
      blue: ['#3a83f7', '#fff'],
      green: ['#10a37f', '#fff'],
      purple: ['#ab68ff', '#fff'],
      yellow: ['#f4c542', '#111'],
      pink: ['#e85aad', '#fff'],
      orange: ['#f47b20', '#fff'],
    }
    const [accent, contrast] = accentColors[accountSettings.general.accent]
    if (accent) {
      root.style.setProperty('--accent', accent)
      root.style.setProperty('--accent-contrast', contrast)
      root.style.setProperty('--focus', accent)
    } else {
      root.style.removeProperty('--accent')
      root.style.removeProperty('--accent-contrast')
      root.style.removeProperty('--focus')
    }
  }, [accountSettings.general.accent, accountSettings.general.contrast])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(null), 1900)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useEffect(() => {
    const path = new URL(locationHref, window.location.origin).pathname
    document.title = route === 'codex-settings'
      ? 'Codex | ChatGPT 镜像站'
      : route === 'images'
      ? '图像 | ChatGPT 镜像站'
      : isPluginRoute
        ? '插件 | ChatGPT 镜像站'
        : route === 'pricing'
          ? '定价 | ChatGPT 镜像站'
          : route === 'help'
            ? '帮助中心 | ChatGPT 镜像站'
            : route === 'auth'
              ? '登录 | ChatGPT 镜像站'
              : route === 'legal'
                ? path === '/terms' ? '使用条款 | ChatGPT 镜像站' : path === '/privacy' ? '隐私政策 | ChatGPT 镜像站' : 'ChatGPT 镜像站'
                : 'ChatGPT 镜像站'
  }, [isPluginRoute, locationHref, route])

  useEffect(() => {
    if (!isHomeRoute) return
    const textarea = textareaRef.current
    if (!textarea) return
    const minimumHeight = isReturnedHome ? 26 : 24
    textarea.style.height = `${minimumHeight}px`
    textarea.style.height = `${Math.min(192, Math.max(minimumHeight, textarea.scrollHeight))}px`
  }, [isHomeRoute, isReturnedHome, prompt])

  useLayoutEffect(() => {
    if (!isHomeRoute || !hasConversation || !stickToConversationBottomRef.current) return
    const scroller = conversationViewRef.current
    if (!scroller) return
    const frame = window.requestAnimationFrame(() => {
      // Streaming produces many small updates. An immediate scroll keeps the
      // active line steady without queueing a long chain of smooth animations.
      scroller.scrollTop = scroller.scrollHeight
      setShowScrollToBottom(false)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [hasConversation, isGenerating, isHomeRoute, turns])

  useEffect(() => () => {
    if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current)
  }, [])

  useEffect(() => {
    if (sidebarRef.current) sidebarRef.current.inert = isMobile && !mobileDrawerOpen
    if (mainRef.current) mainRef.current.inert = isMobile && mobileDrawerOpen
  }, [isMobile, mobileDrawerOpen])

  useEffect(() => {
    if (!isMobile || !mobileDrawerOpen || layer) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMobileDrawerOpen(false)
      window.setTimeout(() => sidebarOpenButtonRef.current?.focus(), 0)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isMobile, layer, mobileDrawerOpen])

  useEffect(() => {
    if (layer !== 'attachment') return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!attachmentMenuRef.current?.contains(target) && !attachmentTriggerRef.current?.contains(target)) closeLayer()
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { closeLayer(); attachmentTriggerRef.current?.focus() }
    }
    document.addEventListener('pointerdown', onPointerDown, true); document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown, true); document.removeEventListener('keydown', onKeyDown) }
  }, [layer, closeLayer])

  useEffect(() => {
    if (layer !== 'search-card' && layer !== 'deep-card') return
    const anchor = layer === 'search-card' ? searchFeatureAnchorRef.current : deepFeatureAnchorRef.current
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (featureCardRef.current?.contains(target) || anchor?.contains(target)) return
      closeLayer()
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') closeLayer()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [closeLayer, layer])

  useEffect(() => () => {
    const generation = generationAbortRef.current
    generationAbortRef.current = null
    generation?.abort()
    usageAbortRef.current?.abort()
    usageAbortRef.current = null
    historyListAbortRef.current?.abort()
    historyListAbortRef.current = null
    historyDetailAbortRef.current?.abort()
    historyDetailAbortRef.current = null
    clearFeatureTimers()
    if (micErrorResetRef.current) window.clearTimeout(micErrorResetRef.current)
    const recognition = recognitionRef.current
    recognitionRef.current = null
    if (recognition) {
      recognition.onstart = null
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      recognition.abort()
    }
  }, [clearFeatureTimers])

  const closeSidebar = () => {
    if (isMobile) {
      setMobileDrawerOpen(false)
      window.setTimeout(() => sidebarOpenButtonRef.current?.focus(), 0)
    } else {
      closeLayer()
      setDesktopSidebarOpen(false)
    }
  }
  const openSidebar = () => {
    closeLayer()
    if (isMobile) {
      setMobileDrawerOpen(true)
      window.setTimeout(() => sidebarCloseButtonRef.current?.focus(), 80)
    } else {
      setDesktopSidebarOpen(true)
    }
  }

  const openImages = (event: MouseEvent<HTMLElement>) => {
    if (!isPlainLeftClick(event)) return
    event.preventDefault()
    navigate('/images')
  }

  const openPlugins = (event: MouseEvent<HTMLElement>) => {
    if (!isPlainLeftClick(event)) return
    event.preventDefault()
    navigate('/plugins')
  }

  const openLocalPage = (to: LocalRoutePath, event: MouseEvent<HTMLElement>) => {
    if (!isPlainLeftClick(event)) return
    event.preventDefault()
    navigate(to)
  }

  const navigatePluginTarget = (path: string, event?: MouseEvent<HTMLElement>) => {
    if (event && !isPlainLeftClick(event)) return
    event?.preventDefault()
    if (!path.startsWith('/plugins')) return
    navigate(path as LocalRoutePath)
  }

  const navigateAuthFlow = (provider: 'google' | 'apple' | 'email' | 'phone', loginHint?: string) => {
    const callbackPath = route === 'images' ? '/images' : isPluginRoute ? locationHref : '/'
    const params = new URLSearchParams({ callback_path: callbackPath, screen_hint: 'login_or_signup' })
    if (loginHint) params.set('login_hint', loginHint)
    navigate(`/auth/${provider}?${params.toString()}`)
  }

  const newChat = (event?: MouseEvent<HTMLElement>) => {
    if (event && !isPlainLeftClick(event)) return
    event?.preventDefault()
    const generation = generationAbortRef.current
    generationAbortRef.current = null
    generation?.abort()
    setGuestConversationId(createLocalConversationId())
    setTurns([]); setPrompt(''); setSelectedAttachments([]); setWebSearch(false); setIsGenerating(false)
    stickToConversationBottomRef.current = true
    setShowScrollToBottom(false)
    setCopiedTurnId(null)
    setActiveConversationId(null); setPlusLayer(null)
    navigate('/')
    window.setTimeout(() => textareaRef.current?.focus(), 50)
  }

  const logoutAccount = async () => {
    ++sessionRequestVersionRef.current
    if (sessionAccount) {
      try {
        await logoutAuthSession()
      } catch {
        // The visual logout still completes if the local bridge is unavailable.
      }
    }
    resetAccountWorkspace('free')
    clearAccountSettingsState()
    setAuthState(ANONYMOUS_AUTH_STATE)
  }

  const stopGenerating = () => {
    generationAbortRef.current?.abort()
  }

  const showCopiedReply = (turnId: Turn['id']) => {
    if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current)
    setCopiedTurnId(turnId)
    copyResetTimerRef.current = window.setTimeout(() => {
      setCopiedTurnId(null)
      copyResetTimerRef.current = null
    }, 1_800)
  }

  const copyAssistantReply = async (turn: Turn) => {
    try {
      await writeConversationText(turn.text)
      showCopiedReply(turn.id)
      notify('已复制')
    } catch {
      notify('无法访问剪贴板')
    }
  }

  const shareAssistantReply = async (turn: Turn) => {
    try {
      if (navigator.share) {
        await navigator.share({ text: turn.text })
        return
      }
      await writeConversationText(turn.text)
      showCopiedReply(turn.id)
      notify('已复制分享内容')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      notify('无法分享此回复')
    }
  }

  const submitText = (
    raw: string,
    conversationKey = activeConversationId ?? guestConversationId,
    attachments: readonly ComposerAttachment[] = selectedAttachments,
    refreshHistoryAfterReply = false,
  ) => {
    const text = raw.trim()
    const attachmentSnapshot = [...attachments]
    if ((!text && attachmentSnapshot.length === 0) || generationAbortRef.current) return

    const createdAt = new Date().toISOString()
    const userTurn: Turn = {
      id: nextIdRef.current++,
      role: 'user',
      text,
      attachments: attachmentSnapshot.length ? attachmentSnapshot : undefined,
    }
    const assistantId = nextIdRef.current++
    const requestTurns = [...turns, userTurn]
    const messages: ChatMessage[] = requestTurns.map((turn) => ({
      id: String(turn.id),
      role: turn.role,
      content: turnRequestText(turn),
      createdAt,
      status: 'complete',
    }))
    const controller = new AbortController()
    const requestVersionAtSubmit = sessionRequestVersionRef.current
    const upstreamConversationId = upstreamConversationIdsRef.current.get(conversationKey)
    const requestModel = isPaidExperience
      ? plusRequestModel(plusModel, reasoningEffort, effectivePlusMode, accountRuntime, selectedPowerOption)
      : (accountRuntime?.conversation.defaultModel || accountRuntime?.chat.defaultModel || 'gpt-5-6')
    // The selected endpoint preset is authoritative. Instant presets omit
    // the field; Thinking/Pro presets provide the exact upstream effort value.
    const requestReasoningEffort = isPaidExperience
      ? selectedPowerOption?.thinkingEffort
      : undefined
    const selectedServiceTier = isPaidExperience ? effectiveServiceTier : undefined
    generationAbortRef.current = controller

    stickToConversationBottomRef.current = true
    setShowScrollToBottom(false)
    setTurns((current) => [...current, userTurn])
    abortDictation()
    setPrompt(''); setSelectedAttachments([]); setLayer(null); setIsGenerating(true)
    window.setTimeout(() => textareaRef.current?.focus(), 0)

    void (async () => {
      let answer = ''

      try {
        for await (const delta of streamChatReply(messages, {
          attachments: attachmentSnapshot.map(({ file }) => file),
          conversationId: upstreamConversationId,
          model: requestModel,
          requireAuthentication: isAuthenticated,
          onConversationId: (conversationId) => {
            upstreamConversationIdsRef.current.set(conversationKey, conversationId)
          },
          reasoningEffort: requestReasoningEffort,
          serviceTier: selectedServiceTier,
          signal: controller.signal,
        })) {
          if (!delta || generationAbortRef.current !== controller) continue
          answer += delta
          const nextAnswer = answer
          setTurns((current) => {
            const hasAssistantTurn = current.some((turn) => turn.id === assistantId)
            if (!hasAssistantTurn) {
              return [...current, { id: assistantId, role: 'assistant', text: nextAnswer }]
            }
            return current.map((turn) => turn.id === assistantId
              ? { ...turn, text: nextAnswer }
              : turn)
          })
        }

        if (generationAbortRef.current === controller && !answer) {
          setTurns((current) => [
            ...current,
            { id: assistantId, role: 'assistant', text: '聊天接口没有返回内容，请稍后重试。' },
          ])
        }
      } catch (error) {
        if (generationAbortRef.current !== controller) return

        if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
          setTurns((current) => {
            const hasAssistantTurn = current.some((turn) => turn.id === assistantId)
            if (!hasAssistantTurn) {
              return current
            }
            return current.map((turn) => turn.id === assistantId
              ? { ...turn, stopped: true }
              : turn)
          })
          return
        }

        if (
          isAuthenticated
          && requestVersionAtSubmit === sessionRequestVersionRef.current
          && requiresChatReauthentication(error)
        ) {
          // A server restart can invalidate the in-memory HttpOnly binding
          // while React still renders the previous paid account. Do not leave
          // a stale Plus/Pro shell that repeatedly fails or silently downgrades.
          ++sessionRequestVersionRef.current
          resetAccountWorkspace('free')
          clearAccountSettingsState()
          setAuthState(ANONYMOUS_AUTH_STATE)
          setSessionLoginOpen(true)
        }

        const message = error instanceof Error ? error.message : String(error)
        if (!answer) {
          setTurns((current) => [
            ...current,
            { id: assistantId, role: 'assistant', text: `抱歉，请求失败：${message}` },
          ])
        }
        notify(`聊天请求失败：${message}`)
      } finally {
        if (generationAbortRef.current === controller) {
          generationAbortRef.current = null
          setIsGenerating(false)
        }
        if (
          refreshHistoryAfterReply
          && answer
          && !controller.signal.aborted
          && sessionAccount
          && requestVersionAtSubmit === sessionRequestVersionRef.current
        ) {
          // Upstream history can lag the completed stream by a short interval.
          // Refresh from the real API rather than inserting a local fake row.
          window.setTimeout(() => {
            if (requestVersionAtSubmit === sessionRequestVersionRef.current) {
              void loadConversationList(requestVersionAtSubmit)
            }
          }, 700)
        }
      }
    })()
  }

  const submit = (event?: FormEvent) => { event?.preventDefault(); if (isGenerating) stopGenerating(); else submitText(prompt) }
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      if (isGenerating) stopGenerating()
      else submitText(prompt)
    }
  }

  const addFiles = useCallback((files: readonly File[], source: AttachmentSource = 'picker') => {
    const incoming = Array.from(files)
    if (!incoming.length) return
    const fingerprints = new Set(selectedAttachments.map(({ file }) => `${file.name}:${file.size}:${file.lastModified}:${file.type}`))
    const next = [...selectedAttachments]
    const added: File[] = []
    for (const file of incoming) {
      if (next.length >= 8) break
      const fingerprint = `${file.name}:${file.size}:${file.lastModified}:${file.type}`
      if (fingerprints.has(fingerprint)) continue
      fingerprints.add(fingerprint)
      added.push(file)
      next.push({
        id: `attachment-${Date.now().toString(36)}-${nextAttachmentIdRef.current++}`,
        file,
        source,
      })
    }
    if (added.length === 0) {
      notify(selectedAttachments.length >= 8 ? '最多只能添加 8 个文件' : '这些文件已经添加过了')
      return
    }
    setSelectedAttachments(next)
    setLayer(null)
    notify(added.length === 1 ? `已添加 ${added[0].name}` : `已选择 ${added.length} 个文件`)
    window.setTimeout(() => textareaRef.current?.focus(), 0)
  }, [notify, selectedAttachments])

  const removeAttachment = useCallback((id: string | number) => {
    setSelectedAttachments((current) => typeof id === 'number'
      ? current.filter((_, index) => index !== id)
      : current.filter((attachment) => attachment.id !== id))
  }, [])

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files || [])
    addFiles(files, 'picker')
    event.currentTarget.value = ''
  }

  const toggleWebSearch = () => { setWebSearch((value) => !value); setLayer(null); window.setTimeout(() => textareaRef.current?.focus(), 0) }

  const updateAttachmentPlacement = useCallback(() => {
    const rect = attachmentTriggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const menuHeight = isMobile ? 144 : 277
    const fitsBelow = rect.bottom + 4 + menuHeight <= window.innerHeight - 8
    setAttachmentPlacement(fitsBelow ? 'down' : 'up')
  }, [isMobile])

  useEffect(() => {
    if (layer !== 'attachment') return
    window.addEventListener('resize', updateAttachmentPlacement)
    return () => window.removeEventListener('resize', updateAttachmentPlacement)
  }, [layer, updateAttachmentPlacement])

  const toggleAttachmentMenu = () => {
    clearFeatureTimers()
    featurePinnedRef.current = false
    if (layer === 'attachment') {
      setLayer(null)
      return
    }
    updateAttachmentPlacement()
    setLayer('attachment')
  }

  const showDictationError = (message: string) => {
    if (micErrorResetRef.current) window.clearTimeout(micErrorResetRef.current)
    setMicState('error')
    notify(message)
    micErrorResetRef.current = window.setTimeout(() => {
      micErrorResetRef.current = null
      setMicState((current) => current === 'error' ? 'idle' : current)
    }, 1800)
  }

  const toggleMic = () => {
    if (micState === 'requesting' || micState === 'listening' || micState === 'transcribing') {
      const recognition = recognitionRef.current
      if (!recognition) {
        setMicState('idle')
        return
      }
      setMicState('transcribing')
      try {
        recognition.stop()
      } catch {
        abortDictation()
      }
      return
    }

    const Recognition = speechRecognitionConstructor
    if (!Recognition) {
      showDictationError('当前浏览器不支持语音转文字')
      return
    }

    if (micErrorResetRef.current) window.clearTimeout(micErrorResetRef.current)
    micErrorResetRef.current = null
    const recognition = new Recognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = language === 'auto' ? 'zh-CN' : language.replace('_', '-')
    dictationBaseRef.current = prompt
    dictationFinalRef.current = ''
    recognitionRef.current = recognition

    recognition.onstart = () => {
      if (recognitionRef.current !== recognition) return
      setMicState('listening')
    }
    recognition.onresult = (event) => {
      if (recognitionRef.current !== recognition) return
      let interim = ''
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        const transcript = result?.[0]?.transcript ?? ''
        if (!transcript) continue
        if (result.isFinal) {
          dictationFinalRef.current = appendSpeechTranscript(dictationFinalRef.current, transcript)
        } else {
          interim = appendSpeechTranscript(interim, transcript)
        }
      }
      const recognized = appendSpeechTranscript(dictationFinalRef.current, interim)
      setPrompt(appendSpeechTranscript(dictationBaseRef.current, recognized))
    }
    recognition.onerror = (event) => {
      if (recognitionRef.current !== recognition) return
      recognitionRef.current = null
      if (event.error === 'aborted') {
        setMicState('idle')
        return
      }
      const message = event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? '未获得麦克风权限'
        : event.error === 'audio-capture'
          ? '找不到可用的麦克风'
          : event.error === 'network'
            ? '语音识别网络连接失败'
            : event.error === 'no-speech'
              ? '没有检测到语音'
              : event.message || '语音转文字失败，请重试'
      showDictationError(message)
    }
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return
      recognitionRef.current = null
      setMicState('idle')
      window.setTimeout(() => document.querySelector<HTMLTextAreaElement>('.plus-composer textarea, .chat-composer textarea')?.focus(), 0)
    }

    try {
      setMicState('requesting')
      recognition.start()
    } catch (error) {
      recognitionRef.current = null
      showDictationError(error instanceof Error ? error.message : '无法启动语音转文字')
    }
  }

  const launchVoiceMode = () => {
    notify('语音模式与听写是独立功能；当前镜像站已保留语音模式入口')
  }

  const openPlusLayer = (next: Exclude<PlusLayer, null>, anchor?: HTMLElement | null) => {
    setLayer(null)
    if (next === 'account') plusAccountAnchorRef.current = anchor ?? null
    if (next === 'model') plusModelAnchorRef.current = anchor ?? null
    if (next === 'more') plusMoreAnchorRef.current = anchor ?? null
    if (next === 'chat-row') plusChatMenuAnchorRef.current = anchor ?? null
    // The authenticated attachment panel is aligned to the complete composer,
    // not to the 32px plus button that triggered it.
    if (next === 'attachment') plusAttachmentAnchorRef.current = anchor?.closest<HTMLElement>('.plus-composer') ?? anchor ?? null
    setPlusLayer((current) => current === next ? null : next)
  }

  const handlePlusNavigate = (destination: PlusDestination, anchor?: HTMLElement) => {
    if (destination === 'new-chat') { newChat(); return }
    if (destination === 'search') { setPlusLayer(null); showSearchDialog(); return }
    if (destination === 'library') { navigate('/library'); return }
    if (destination === 'projects') { navigate('/projects'); return }
    if (destination === 'scheduled') { navigate('/tasks'); return }
    if (destination === 'plugins') { navigate('/plugins'); return }
    if (destination === 'more') openPlusLayer('more', anchor)
  }

  const changePlusMode = (nextMode: PlusMode) => {
    if (nextMode === 'work' && !workspaceCapabilities.work) return
    normalizeScopedServiceTier(
      nextMode,
      'default',
      nextMode === 'work' ? workReasoningEffort : chatReasoningEffort,
    )
    setPlusMode(nextMode)
    setPlusModel('default')
    setPlusLayer(null)
  }

  const openPlusConversation = (conversation: PlusConversation) => {
    navigate(`/c/${encodeURIComponent(conversation.id)}`)
    void loadConversationDetail(conversation, sessionRequestVersionRef.current)
  }

  const submitPlusText = (payload: ComposerSubmission | string) => {
    const text = (typeof payload === 'string' ? payload : payload.text).trim()
    const attachments = typeof payload === 'string' ? selectedAttachments : [...payload.attachments]
    if (!text && attachments.length === 0) return
    let conversationId = activeConversationId
    const createdConversation = !conversationId
    if (!conversationId) {
      const id = `local-${Date.now().toString(36)}`
      setActiveConversationId(id)
      if (effectiveServiceTier) {
        setConversationServiceTiers((current) => ({ ...current, [id]: effectiveServiceTier }))
      }
      conversationId = id
    }
    setPlusLayer(null)
    submitText(text, conversationId, attachments, createdConversation)
  }

  const handlePlusSuggestion = (suggestion: PlusSuggestionId) => {
    if (suggestion === 'create-image') { navigate('/images'); return }
    if (suggestion === 'write') {
      setPrompt('帮我撰写或编辑：')
      window.setTimeout(() => document.querySelector<HTMLTextAreaElement>('.plus-composer textarea')?.focus(), 0)
      return
    }
    setPrompt('搜索网页：')
    window.setTimeout(() => document.querySelector<HTMLTextAreaElement>('.plus-composer textarea')?.focus(), 0)
  }

  const plusSectionContent = route === 'library'
    ? { eyebrow: '资料库', title: '你的资料库', description: '浏览并搜索已上传的文件、生成的图片和保存的内容。' }
    : route === 'projects'
      ? { eyebrow: '项目', title: '项目', description: '把聊天、文件和自定义指令整理到同一个工作空间。' }
      : route === 'tasks'
        ? { eyebrow: '已安排', title: '已安排的任务', description: '查看和管理 ChatGPT 按计划执行的任务。' }
        : null

  if (route === 'auth') {
    // Provider changes stay inside the same top-level route. Key the flow by
    // URL so a completed verification state cannot leak into another provider
    // after an in-app navigation or browser back/forward action.
    return <>
      <AuthFlowPage key={locationHref} locationHref={locationHref} onAuthenticated={completeProviderLogin} onNavigate={(path) => navigate(path as LocalRoutePath)} onSessionLogin={showSessionLogin} />
      <SessionLoginDialog account={sessionAccount} open={sessionLoginOpen} onClose={closeSessionLogin} onSubmit={submitSessionLogin} />
    </>
  }

  if (route === 'pricing') {
    return <PricingPage onNavigate={(path) => navigate(path as LocalRoutePath)} />
  }

  if (route === 'codex-settings') {
    return <CodexCloudSettingsPage locationHref={locationHref} onNavigate={(path) => navigate(path as LocalRoutePath)} />
  }

  if (route === 'help') {
    return <HelpPage locationHref={locationHref} onNavigate={(path, event) => {
      if (event && !isPlainLeftClick(event)) return
      event?.preventDefault()
      navigate(path as LocalRoutePath)
    }} />
  }

  if (route === 'legal') {
    return <LegalPage locationHref={locationHref} onNavigate={(path, event) => {
      if (event && !isPlainLeftClick(event)) return
      event?.preventDefault()
      navigate(path as LocalRoutePath)
    }} />
  }

  if (isAuthenticated && isFreeExperience && (route === 'home' || route === 'conversation')) {
    return (
      <div className="free-authenticated-root plan-free" data-auth-state="authenticated" data-plan="free">
        <FreeHomeShell
          activeConversationId={activeConversationId}
          accountEmail={accountPresentation.email}
          accountInitials={sessionAccount?.initials ?? 'L'}
          accountName={accountPresentation.name}
          attachments={selectedAttachments}
          conversations={plusConversations}
          dictationSupported={dictationSupported}
          isGenerating={isGenerating}
          historyStatus={historyStatus}
          micState={micState}
          onFilesAdded={addFiles}
          onConversationSelect={openPlusConversation}
          onHelp={() => navigate('/help')}
          onHistoryRetry={() => { void loadConversationList(sessionRequestVersionRef.current) }}
          onLogout={() => { void logoutAccount() }}
          onMicrophoneClick={toggleMic}
          onNavigate={(path) => {
            if (path === '/') newChat()
            else navigate(path)
          }}
          onOpenSearch={showSearchDialog}
          onOpenSettings={() => showSettings('general')}
          onRemoveAttachment={removeAttachment}
          onSidebarCollapsedChange={(collapsed) => setDesktopSidebarOpen(!collapsed)}
          onSidebarOpenChange={setMobileDrawerOpen}
          onSessionDisconnect={() => { void disconnectSession() }}
          onSessionLogin={() => setSessionLoginOpen(true)}
          onStopGenerating={stopGenerating}
          onSubmit={submitPlusText}
          onUpgrade={() => navigate('/pricing')}
          onValueChange={(value) => {
            if (recognitionRef.current) abortDictation()
            setPrompt(value)
          }}
          onVoiceClick={launchVoiceMode}
          planLabel={accountPresentation.planLabel}
          sessionConnected={Boolean(sessionAccount)}
          sidebarCollapsed={!desktopSidebarOpen}
          sidebarOpen={mobileDrawerOpen}
          turns={turns}
          value={prompt}
        />
        <SessionLoginDialog account={sessionAccount} open={sessionLoginOpen} onClose={closeSessionLogin} onSubmit={submitSessionLogin} />
        <PlusSettingsDialog accountEmail={accountPresentation.email} accountName={accountPresentation.name} planLabel={accountPresentation.planLabel} initialTab={settingsInitialTab} open={layer === 'settings'} onClose={closeSettings} onTabChange={changeSettingsTab} theme={theme} onThemeChange={setTheme} language={language} onLanguageChange={setLanguage} settings={accountSettings} capabilities={accountSettingsCapabilities} options={accountSettingsOptions} onSettingsChange={changeAccountSettings} />
        <SearchDialog conversations={plusConversations} onConversationSelect={openPlusConversation} open={layer === 'search-dialog'} onClose={closeLayer} onNewChat={() => newChat()} />
        {notice && <div className="replica-toast" key={notice.id} role="status">{notice.message}</div>}
      </div>
    )
  }

  if (isPaidExperience && isPlusWorkspaceRoute) {
    return (
      <div className={`plus-authenticated-root plan-${accountPlan}`} data-auth-state="authenticated" data-plan={accountPlan}>
        <PlusHomeShell
          accountName={accountPresentation.name}
          activeConversationId={activeConversationId}
          attachments={selectedAttachments}
          capabilities={workspaceCapabilities}
          conversations={plusConversations}
          historyStatus={historyStatus}
          dictationSupported={dictationSupported}
          effortLabel={plusLayer === 'model' || selectedPowerOption?.isMaximumEffort ? '' : effectiveReasoningLabel}
          initials={accountPresentation.initials}
          isGenerating={isGenerating}
          micState={micState}
          mode={effectivePlusMode}
          modelLabel={plusLayer === 'model'
            ? '思考强度'
            : selectedPowerOption?.isMaximumEffort ? 'Pro' : ''}
          onAccountClick={(anchor) => openPlusLayer('account', anchor)}
          onAttachmentClick={(anchor) => openPlusLayer('attachment', anchor)}
          onConversationMenu={(conversation, anchor) => {
            setSelectedConversation(conversation)
            openPlusLayer('chat-row', anchor)
          }}
          onConversationSelect={openPlusConversation}
          onEffortClick={(anchor) => openPlusLayer('model', anchor)}
          onFilesAdded={addFiles}
          onHistoryRetry={() => { void loadConversationList(sessionRequestVersionRef.current) }}
          onMicrophoneClick={toggleMic}
          onModeChange={changePlusMode}
          onNavigate={handlePlusNavigate}
          onRemoveAttachment={removeAttachment}
          onSidebarCollapsedChange={(collapsed) => setDesktopSidebarOpen(!collapsed)}
          onSidebarOpenChange={setMobileDrawerOpen}
          onStopGenerating={stopGenerating}
          onSubmit={submitPlusText}
          onSuggestionClick={handlePlusSuggestion}
          onUsageRetry={() => { void loadWorkspaceUsage(sessionRequestVersionRef.current) }}
          onValueChange={(value) => {
            if (recognitionRef.current) abortDictation()
            setPrompt(value)
          }}
          onVoiceClick={launchVoiceMode}
          planLabel={accountPresentation.planLabel}
          planVariant={paidPlanVariant}
          sidebarCollapsed={!desktopSidebarOpen}
          sidebarOpen={mobileDrawerOpen}
          turns={isPlusChatRoute ? turns : []}
          value={prompt}
          usage={workspaceUsage}
        >
          {plusSectionContent && (
            <main className="plus-section-page">
              <div className="plus-section-inner">
                <span>{plusSectionContent.eyebrow}</span>
                <h1>{plusSectionContent.title}</h1>
                <p>{plusSectionContent.description}</p>
                <button type="button" onClick={() => notify('这里还没有内容')}>创建</button>
              </div>
            </main>
          )}
        </PlusHomeShell>

        <PlusAccountMenu
          anchorRef={plusAccountAnchorRef}
          initials={accountPresentation.initials}
          onClose={() => setPlusLayer(null)}
          onHelp={() => navigate('/help')}
          onLogout={() => { void logoutAccount() }}
          onPersonalization={() => showSettings('personalization')}
          onProfile={() => showSettings('account')}
          onSettings={() => showSettings('general')}
          onSessionDisconnect={() => { void disconnectSession() }}
          onSessionLogin={() => setSessionLoginOpen(true)}
          open={plusLayer === 'account'}
          planLabel={accountPresentation.planLabel}
          sessionConnected={Boolean(sessionAccount)}
          userName={accountPresentation.name}
        />
        <PlusModelMenu
          anchorRef={plusModelAnchorRef}
          compactEffort
          fastMode={fastMode}
          modelLabel={powerModelLabel}
          modelOptions={runtimeModelOptions}
          onClose={() => setPlusLayer(null)}
          onFastModeChange={(enabled) => {
            const tier: RequestServiceTier = enabled ? 'fast' : 'standard'
            setScopedServiceTier(tier)
          }}
          onModelChange={(model) => {
            normalizeScopedServiceTier(
              effectivePlusMode,
              model,
              effectivePlusMode === 'work' ? workReasoningEffort : chatReasoningEffort,
            )
            setPlusModel(model)
            if (effectivePlusMode === 'chat') {
              persistChatModelSelection(model, chatReasoningEffort)
            }
          }}
          onReasoningEffortChange={(effort) => {
            normalizeScopedServiceTier(effectivePlusMode, plusModel, effort)
            if (effectivePlusMode === 'work') setWorkReasoningEffort(effort)
            else {
              setChatReasoningEffort(effort)
              persistChatModelSelection(plusModel, effort)
            }
          }}
          open={plusLayer === 'model'}
          planVariant={paidPlanVariant}
          reasoningEffort={reasoningEffort}
          selectedModel={plusModel}
          showFastMode={supportsFastMode}
          sliderOptions={powerSliderOptions}
        />
        <PlusSidebarMoreMenu
          anchorRef={plusMoreAnchorRef}
          hiddenActions={hiddenSidebarActions}
          onClose={() => setPlusLayer(null)}
          onSelect={(action) => {
            if (action === 'images') navigate('/images')
            else if (action === 'gpts') navigate('/plugins')
            else {
              setPrompt(action === 'deep-research' ? '帮我进行深度研究：' : '开启学习模式：')
              notify(action === 'deep-research' ? '已启用深度研究' : '已启用学习模式')
            }
          }}
          open={plusLayer === 'more'}
        />
        <PlusChatRowMenu
          anchorRef={plusChatMenuAnchorRef}
          onArchive={() => {
            if (!selectedConversation) return
            setPlusConversations((current) => current.filter((item) => item.id !== selectedConversation.id))
            notify('对话已归档')
            if (activeConversationId === selectedConversation.id) newChat()
          }}
          onClose={() => setPlusLayer(null)}
          onDelete={() => {
            if (!selectedConversation) return
            setPlusConversations((current) => current.filter((item) => item.id !== selectedConversation.id))
            notify('对话已删除')
            if (activeConversationId === selectedConversation.id) newChat()
          }}
          onRename={() => {
            if (!selectedConversation) return
            const renamed = `${selectedConversation.title}（已重命名）`
            setPlusConversations((current) => current.map((item) => item.id === selectedConversation.id ? { ...item, title: renamed } : item))
            notify('对话已重命名')
          }}
          onShare={() => notify('分享链接已准备好')}
          open={plusLayer === 'chat-row'}
        />
        <PlusAttachmentMenu
          anchorRef={plusAttachmentAnchorRef}
          fullWidth
          hiddenActions={hiddenAttachmentActions}
          onClose={() => setPlusLayer(null)}
          onSelect={(action) => {
            if (action === 'upload') fileInputRef.current?.click()
            else if (action === 'camera') cameraInputRef.current?.click()
            else if (action === 'create-image') navigate('/images')
            else notify('已打开资料来源')
          }}
          open={plusLayer === 'attachment'}
        />
        <input ref={imageInputRef} className="sr-only" type="file" accept="image/*" multiple tabIndex={-1} onChange={handleFiles} />
        <input ref={cameraInputRef} className="sr-only" type="file" accept="image/*" capture="environment" tabIndex={-1} onChange={handleFiles} />
        <input id="upload-files" ref={fileInputRef} className="sr-only" type="file" multiple tabIndex={-1} onChange={handleFiles} />
        <PlusSettingsDialog accountEmail={accountPresentation.email} accountName={accountPresentation.name} planLabel={accountPresentation.planLabel} initialTab={settingsInitialTab} open={layer === 'settings'} onClose={closeSettings} onTabChange={changeSettingsTab} theme={theme} onThemeChange={setTheme} language={language} onLanguageChange={setLanguage} settings={accountSettings} capabilities={accountSettingsCapabilities} options={accountSettingsOptions} onSettingsChange={changeAccountSettings} />
        <SessionLoginDialog account={sessionAccount} open={sessionLoginOpen} onClose={closeSessionLogin} onSubmit={submitSessionLogin} />
        <SearchDialog conversations={plusConversations} onConversationSelect={openPlusConversation} open={layer === 'search-dialog'} onClose={closeLayer} onNewChat={() => newChat()} />
        {notice && <div className="replica-toast" key={notice.id} role="status">{notice.message}</div>}
      </div>
    )
  }

  return (
    <div data-auth-state={authState.status} className={`replica-shell route-${route}${isAuthenticated ? ` is-authenticated plan-${accountPlan}` : ''}${isReturnedHome ? ' returned-home' : ''}${sidebarOpen ? '' : ' sidebar-is-closed'}${visibleConversation ? ' has-conversation' : ''}${mobileDrawerOpen ? ' mobile-drawer-open' : ''}`}>
      {isAuthenticated && (isMobile || desktopSidebarOpen) && <PlusSidebar
        accountName={accountPresentation.name}
        activeConversationId={activeConversationId}
        capabilities={workspaceCapabilities}
        conversations={plusConversations}
        historyStatus={historyStatus}
        initials={accountPresentation.initials}
        mobileOpen={mobileDrawerOpen}
        onAccountClick={(anchor) => openPlusLayer('account', anchor)}
        onCloseMobile={() => setMobileDrawerOpen(false)}
        onCollapse={() => setDesktopSidebarOpen(false)}
        onConversationMenu={(conversation, anchor) => {
          setSelectedConversation(conversation)
          openPlusLayer('chat-row', anchor)
        }}
        onConversationSelect={openPlusConversation}
        onHistoryRetry={() => { void loadConversationList(sessionRequestVersionRef.current) }}
        onNavigate={handlePlusNavigate}
        planLabel={accountPresentation.planLabel}
        planVariant={isFreeExperience ? 'free' : paidPlanVariant}
        onUsageRetry={() => { void loadWorkspaceUsage(sessionRequestVersionRef.current) }}
        usage={workspaceUsage}
      />}
      {!isAuthenticated && <aside ref={sidebarRef} className="chat-sidebar" aria-label="聊天导航" aria-hidden={isMobile ? !mobileDrawerOpen : undefined}>
        <header className="sidebar-header">
          <a className="sidebar-logo-link" href="/" aria-label="ChatGPT 首页" onClick={newChat}><ChatGPTMark className="sidebar-logo" /></a>
          <div className="sidebar-header-actions">
            {(route === 'images' || isPluginRoute || isReturnedHome) && <button className="square-button images-sidebar-search" type="button" aria-label="搜索聊天" aria-haspopup="dialog" aria-controls="search-chat-dialog" aria-expanded={layer === 'search-dialog'} onClick={showSearchDialog}><Icon name="search" /></button>}
            <button
              ref={sidebarCloseButtonRef}
              className="square-button sidebar-close"
              type="button"
              onClick={sidebarOpen ? closeSidebar : openSidebar}
              aria-expanded={sidebarOpen}
              aria-label={sidebarOpen ? '关闭边栏' : '打开边栏'}
            >
              {(route === 'images' || isReturnedHome) && isMobile && mobileDrawerOpen ? (
                <svg className="images-drawer-close-icon" aria-hidden="true" viewBox="0 0 20 20">
                  <path d="M5 5 15 15M15 5 5 15" />
                </svg>
              ) : <Icon name={!isMobile && !desktopSidebarOpen ? 'sidebar-hidden' : 'sidebar'} />}
            </button>
          </div>
        </header>
        <div className="sidebar-new-chat"><SidebarRow icon="compose" label="新聊天" active={isHomeRoute && !hasConversation} href="/" onClick={newChat} /></div>
        <nav className="sidebar-navigation">
          <div className="sidebar-nav-top">
            <div ref={searchFeatureAnchorRef} className="sidebar-feature-anchor sidebar-search-anchor" onPointerEnter={() => route !== 'images' && openFeatureOnHover('search-card')} onPointerLeave={() => route !== 'images' && scheduleFeatureClose('search-card')}>
              <SidebarRow icon="search" label="搜索聊天" controls={route === 'images' ? 'search-chat-dialog' : 'mobile-auth-dialog'} expanded={route === 'images' ? layer === 'search-dialog' : layer === 'auth'} onClick={route === 'images' ? showSearchDialog : () => showAuth('login_or_signup')} />
            </div>
            <SidebarRow icon="images" label="图片" active={route === 'images'} href="/images" onClick={openImages} />
            <SidebarRow icon="plugins" label="插件" active={isPluginRoute} href="/plugins" onClick={openPlugins} />
            <div ref={deepFeatureAnchorRef} className="sidebar-feature-anchor" onPointerEnter={() => openFeatureOnHover('deep-card')} onPointerLeave={() => scheduleFeatureClose('deep-card')}>
              <SidebarRow icon="deep-research" label="深度研究" controls={isMobile ? 'mobile-auth-dialog' : 'desktop-deep-research-product-card-popover'} expanded={isMobile ? layer === 'auth' : layer === 'deep-card'} onClick={() => {
                if (isMobile) {
                  showAuth('login_or_signup')
                  return
                }
                clearFeatureTimers()
                featurePinnedRef.current = layer !== 'deep-card'
                setLayer((current) => current === 'deep-card' ? null : 'deep-card')
              }} />
            </div>
          </div>
          <div className="sidebar-nav-bottom">
            <SidebarRow icon="plans" label="查看套餐和定价" external href="/pricing" onClick={(event) => openLocalPage('/pricing', event)} />
            <SidebarRow icon="settings" label="设置" onClick={() => showSettings()} />
            <SidebarRow icon="help" label="帮助" external href="/help" onClick={(event) => openLocalPage('/help', event)} />
          </div>
        </nav>
        {(route === 'images' || isPluginRoute || isReturnedHome) && <button className="images-rail-account" type="button" aria-label="登录或注册" onClick={() => showAuth('login_or_signup')}><RailAccountIcon /></button>}
        <section className="sidebar-login-promo">
          <h2>{route === 'images' || isPluginRoute || isReturnedHome ? '获取为你量身定制的回复' : '获取为你量身定制的回答'}</h2>
          <p>登录以获取基于已保存聊天的回答，并可创建图片和上传文件。</p>
          <button type="button" onClick={() => showAuth('login')}>登录</button>
        </section>
      </aside>}

      {!isAuthenticated && !isMobile && <SidebarFeatureCard
        kind="search"
        open={layer === 'search-card'}
        anchorRef={searchFeatureAnchorRef}
        cardRef={featureCardRef}
        onEnter={keepFeatureOpen}
        onLeave={() => scheduleFeatureClose('search-card')}
        onLogin={() => showAuth('login')}
        onSignup={() => showAuth('signup')}
      />}
      {!isAuthenticated && !isMobile && <SidebarFeatureCard
        kind="deep"
        open={layer === 'deep-card'}
        anchorRef={deepFeatureAnchorRef}
        cardRef={featureCardRef}
        onEnter={keepFeatureOpen}
        onLeave={() => scheduleFeatureClose('deep-card')}
        onLogin={() => showAuth('login')}
        onSignup={() => showAuth('signup')}
        imagesVariant={route === 'images'}
      />}

      {isMobile && mobileBackdropPresent && <button className="mobile-sidebar-backdrop" data-state={mobileDrawerOpen ? 'open' : 'closed'} type="button" tabIndex={-1} onClick={closeSidebar} aria-label="关闭边栏" />}

      <main ref={mainRef} className="detail-pane" aria-hidden={isMobile && mobileDrawerOpen}>
        <header className="detail-header">
          <div className="header-left">
            {isMobile && !mobileDrawerOpen && <button ref={sidebarOpenButtonRef} className="square-button sidebar-open" type="button" onClick={openSidebar} aria-label="打开边栏"><Icon name="mobile-sidebar" size={24} className="mobile-sidebar-icon" /></button>}
            {isAuthenticated && !isMobile && !desktopSidebarOpen && <button className="square-button sidebar-open authenticated-sidebar-open" type="button" onClick={openSidebar} aria-label="打开边栏"><Icon name="sidebar-hidden" /></button>}
            {(route === 'plugin-detail' || isPluginCategory) && <a className="plugin-header-back" href="/plugins" onClick={openPlugins}>
              <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m11.75 4.25-5.5 5.75 5.5 5.75" /></svg><span>插件</span>
            </a>}
            {!isAuthenticated && !isPluginRoute && <button ref={productTriggerRef} className="product-trigger" type="button" onClick={() => {
              clearFeatureTimers()
              featurePinnedRef.current = false
              setLayer((current) => current === 'product' ? null : 'product')
            }} aria-label="ChatGPT" aria-haspopup="dialog" aria-controls="desktop-chatgpt-product-card-popover" aria-expanded={layer === 'product'}>
              <span className="product-text">ChatGPT</span><ChatGPTWordmark /><Icon name="chevron" size={16} />
            </button>}
          </div>
          {!isAuthenticated && <div className="auth-actions">
            <button className="login-button" type="button" onClick={() => showAuth('login')}>登录</button>
            <button className="signup-button" type="button" onClick={() => showAuth('signup')}>免费注册</button>
          </div>}
        </header>

        {!isAuthenticated && !isPluginRoute && <ProductCard open={layer === 'product'} onClose={closeLayer} onLogin={() => showAuth('login')} onSignup={() => showAuth('signup')} anchorRef={productTriggerRef} placement={route === 'images' ? 'images' : 'anchor'} />}

        {isHomeRoute && <>
          {hasConversation && <section
            ref={conversationViewRef}
            className="conversation-view"
            aria-label={turns.findLast((turn) => turn.role === 'user')?.text || '对话'}
            onScroll={(event) => updateConversationStickiness(event.currentTarget)}
          ><ol className="conversation-thread" data-conversation-transcript="" aria-busy={isGenerating} aria-label="对话" aria-live="polite">
          {turns.map((turn, index) => {
            if (turn.role === 'user') return <li className="chat-turn user-turn" data-message-role="user" key={turn.id}>
              <h2 className="sr-only">你说：</h2>
              <div className="user-turn-body">
                {turn.attachments && turn.attachments.length > 0 && <div className="user-attachments" aria-label="消息附件">
                  {turn.attachments.map(({ id, file }) => <span className="user-attachment" key={id} title={file.name}>
                    <Icon name={file.type.startsWith('image/') ? 'photo' : 'file'} size={18} /><span>{file.name}</span>
                  </span>)}
                </div>}
                {turn.text && <button className="user-message" type="button">{turn.text}</button>}
              </div>
            </li>

            const assistantUi = guestAssistantTurnUi({
              hasText: Boolean(turn.text),
              isGenerating,
              isLastTurn: index === turns.length - 1,
            })
            return <li
              className={`chat-turn assistant-turn${turn.stopped ? ' stopped-turn' : ''}${assistantUi.streaming ? ' is-streaming' : ''}`}
              data-message-role="assistant"
              key={turn.id}
            >
              <h2 className="sr-only">ChatGPT 说：</h2>
              <div className="assistant-turn-body">
                {turn.text && <div className="assistant-message markdown-body">
                  <ReactMarkdown
                    components={{
                      a: ({ children, node: _node, ...props }) => <a {...props} rel="noreferrer noopener" target="_blank">{children}</a>,
                    }}
                    remarkPlugins={[remarkGfm]}
                  >{turn.text}</ReactMarkdown>
                </div>}
                {assistantUi.showActions && <div className="assistant-actions" aria-label="回复操作" role="group">
                  <button
                    type="button"
                    aria-label={copiedTurnId === turn.id ? '已复制回复' : '复制回复'}
                    title={copiedTurnId === turn.id ? '已复制' : '复制'}
                    onClick={() => { void copyAssistantReply(turn) }}
                  >{copiedTurnId === turn.id ? <Icon name="check" size={20} /> : <CopyMessageIcon />}</button>
                  <button type="button" aria-label="分享" title="分享" onClick={() => { void shareAssistantReply(turn) }}><ShareMessageIcon /></button>
                </div>}
              </div>
            </li>
          })}
          {isGenerating && turns.at(-1)?.role !== 'assistant' && <li className="chat-turn assistant-turn is-generating" data-message-role="assistant" aria-label="ChatGPT 正在思考">
            <h2 className="sr-only">ChatGPT 说：</h2><div className="thinking-dot" aria-hidden="true"><i /></div>
          </li>}
        </ol></section>}
          {hasConversation && showScrollToBottom && <button className="scroll-to-bottom-button" type="button" aria-label="滚动到底部" onClick={scrollConversationToBottom}>
            <svg aria-hidden="true" fill="none" viewBox="0 0 20 20"><path d="m5.5 8 4.5 4.5L14.5 8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>
          </button>}

        <section className="composer-dock"><div className="composer-positioner">
          {!hasConversation && <h1>{isReturnedHome
            ? <span className="returned-home-heading">准备好了，随时开始</span>
            : <><span className="desktop-heading">我们先从哪里开始呢？</span><span className="mobile-heading">你想做点什么？</span></>}</h1>}
          {hasConversation && !isGenerating && <p className="conversation-disclaimer">ChatGPT 是 AI，可能会犯错。</p>}
          <form className={`chat-composer${selectedAttachments.length || webSearch ? ' has-context' : ''}`} onSubmit={submit}>
            {(selectedAttachments.length > 0 || webSearch) && <div className="composer-context-strip">
              {webSearch && <button className="composer-context-chip" type="button" onClick={() => setWebSearch(false)} title="移除网页搜索"><Icon name="web-search" size={16} /><span>网页搜索</span><b aria-hidden="true">×</b></button>}
              {selectedAttachments.map(({ id, file }) => <button className="composer-context-chip file-chip" type="button" key={id} onClick={() => removeAttachment(id)} title={`移除 ${file.name}`}>
                <Icon name={file.type.startsWith('image/') ? 'photo' : 'file'} size={16} /><span>{file.name}</span><b aria-hidden="true">×</b>
              </button>)}
            </div>}
            <button
              ref={attachmentTriggerRef}
              type="button"
              className="composer-icon-button attachment-button"
              onClick={toggleAttachmentMenu}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowDown') return
                event.preventDefault()
                clearFeatureTimers()
                featurePinnedRef.current = false
                updateAttachmentPlacement()
                setLayer('attachment')
                window.setTimeout(() => attachmentMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]')?.focus(), 0)
              }}
              aria-label="添加文件等"
              aria-haspopup="menu"
              aria-controls="composer-actions-popover"
              aria-expanded={layer === 'attachment'}
            ><Icon name="attachment" /></button>
            <div className="composer-primary"><textarea ref={textareaRef} rows={1} value={prompt} onChange={(event) => {
              if (recognitionRef.current) abortDictation()
              setPrompt(event.currentTarget.value)
            }} onKeyDown={handleKeyDown} aria-label="与 ChatGPT 聊天" placeholder={isReturnedHome ? '有问题，随便问' : '询问 ChatGPT'} /></div>
            <div className="composer-actions">
              <button type="button" className={`composer-icon-button microphone-button is-${micState}`} onClick={toggleMic} disabled={!dictationSupported || micState === 'requesting' || micState === 'transcribing'} aria-label={micState === 'listening' ? '停止听写' : '开始听写'}>{micState === 'requesting' || micState === 'transcribing' ? <span className="mic-spinner" /> : <Icon name="microphone" />}</button>
              <button
                type={showVoiceMode ? 'button' : 'submit'}
                disabled={!showVoiceMode && !prompt.trim() && selectedAttachments.length === 0 && !isGenerating}
                className={`composer-icon-button submit-button${showVoiceMode ? ' voice-mode-button' : ''}${prompt.trim() || selectedAttachments.length || isGenerating ? ' is-ready' : ''}${isGenerating ? ' is-generating' : ''}`}
                aria-label={showVoiceMode ? '启动语音模式' : isGenerating ? '停止生成' : '发送消息'}
                aria-disabled={!showVoiceMode && !prompt.trim() && selectedAttachments.length === 0 && !isGenerating}
                onClick={showVoiceMode ? launchVoiceMode : undefined}
              ><span className="submit-disc">{showVoiceMode ? <VoiceModeIcon /> : <Icon name={isGenerating ? 'stop' : 'send'} />}</span></button>
            </div>
            {layer === 'attachment' && <AttachmentMenu
              isMobile={isMobile}
              placement={attachmentPlacement}
              webSearch={webSearch}
              onWebSearch={toggleWebSearch}
              onAuth={() => showAuth('login_or_signup')}
              onPickCamera={() => { setLayer(null); cameraInputRef.current?.click() }}
              onPickPhotos={() => { setLayer(null); imageInputRef.current?.click() }}
              onPickFiles={() => { setLayer(null); fileInputRef.current?.click() }}
              menuRef={attachmentMenuRef}
            />}
          </form>
          {showSuggestion && <button className="empty-action" type="button" onClick={() => submitText('你能做什么？')}>你能做什么？</button>}
        </div></section>

          {!hasConversation && <p className="legal-copy">ChatGPT 是 AI。使用即表示你同意我们的<a href="/terms" target="_blank" rel="noreferrer">条款</a>和<a href="/privacy" target="_blank" rel="noreferrer">隐私政策</a>。聊天内容可能会被审核，并用于改进我们的 AI 模型。<a href="/help/data-usage" target="_blank" rel="noreferrer">了解更多</a></p>}
        </>}

        {route === 'images' && <ImagesPage authenticated={isAuthenticated} onRequestAuth={() => showAuth('login_or_signup', 'images')} onNotice={notify} />}

        {isPluginRoute && <PluginsPage locationHref={locationHref} onNavigate={navigatePluginTarget} onRequestAuth={() => isAuthenticated ? notify('插件已安装') : showAuth('login_or_signup')} />}

        {route === 'not-found' && <section className="route-placeholder" aria-labelledby="route-not-found-title">
          <h1 id="route-not-found-title">找不到页面</h1>
          <button type="button" onClick={() => navigate('/')}>返回首页</button>
        </section>}
      </main>

      <input ref={imageInputRef} className="sr-only" type="file" accept="image/*" multiple tabIndex={-1} onChange={handleFiles} />
      <input ref={cameraInputRef} className="sr-only" type="file" accept="image/*" capture="environment" tabIndex={-1} onChange={handleFiles} />
      <input id="upload-files" ref={fileInputRef} className="sr-only" type="file" multiple tabIndex={-1} onChange={handleFiles} />
      {!isAuthenticated && <AuthDialog open={layer === 'auth'} intent={authIntent} onClose={closeLayer} callbackPath={route === 'images' ? '/images' : isPluginRoute ? locationHref : '/'} description={authContext === 'images' ? '要生成图像，请登录或注册。' : undefined} emailPlaceholder={authContext === 'images' ? 'Email address' : undefined} variant={route === 'images' ? 'images' : 'default'} onNavigateAuth={navigateAuthFlow} onSessionLogin={showSessionLogin} />}
      {isAuthenticated
        ? <PlusSettingsDialog accountEmail={accountPresentation.email} accountName={accountPresentation.name} planLabel={accountPresentation.planLabel} initialTab={settingsInitialTab} open={layer === 'settings'} onClose={closeSettings} onTabChange={changeSettingsTab} theme={theme} onThemeChange={setTheme} language={language} onLanguageChange={setLanguage} settings={accountSettings} capabilities={accountSettingsCapabilities} options={accountSettingsOptions} onSettingsChange={changeAccountSettings} />
        : <SettingsDialog open={layer === 'settings'} onClose={closeSettings} theme={theme} onThemeChange={setTheme} language={language} onLanguageChange={setLanguage} onNavigateDataUsage={() => navigate('/help/data-usage')} variant={settingsVariant} />}
      {isAuthenticated && <>
        <PlusAccountMenu
          anchorRef={plusAccountAnchorRef}
          initials={accountPresentation.initials}
          onClose={() => setPlusLayer(null)}
          onHelp={() => navigate('/help')}
          onLogout={() => { void logoutAccount() }}
          onPersonalization={() => showSettings('personalization')}
          onProfile={() => showSettings('account')}
          onSettings={() => showSettings('general')}
          onSessionDisconnect={() => { void disconnectSession() }}
          onSessionLogin={() => setSessionLoginOpen(true)}
          open={plusLayer === 'account'}
          planLabel={accountPresentation.planLabel}
          sessionConnected={Boolean(sessionAccount)}
          userName={accountPresentation.name}
        />
        <PlusSidebarMoreMenu
          anchorRef={plusMoreAnchorRef}
          hiddenActions={hiddenSidebarActions}
          onClose={() => setPlusLayer(null)}
          onSelect={(action) => {
            if (action === 'images') navigate('/images')
            else if (action === 'gpts') navigate('/plugins')
            else { navigate('/'); setPrompt(action === 'deep-research' ? '帮我进行深度研究：' : '开启学习模式：') }
          }}
          open={plusLayer === 'more'}
        />
        <PlusChatRowMenu
          anchorRef={plusChatMenuAnchorRef}
          onArchive={() => selectedConversation && setPlusConversations((current) => current.filter((item) => item.id !== selectedConversation.id))}
          onClose={() => setPlusLayer(null)}
          onDelete={() => selectedConversation && setPlusConversations((current) => current.filter((item) => item.id !== selectedConversation.id))}
          onRename={() => selectedConversation && setPlusConversations((current) => current.map((item) => item.id === selectedConversation.id ? { ...item, title: `${item.title}（已重命名）` } : item))}
          onShare={() => notify('分享链接已准备好')}
          open={plusLayer === 'chat-row'}
        />
      </>}
      <SessionLoginDialog account={sessionAccount} open={sessionLoginOpen} onClose={closeSessionLogin} onSubmit={submitSessionLogin} />
      <SearchDialog conversations={isAuthenticated ? plusConversations : undefined} onConversationSelect={isAuthenticated ? openPlusConversation : undefined} open={layer === 'search-dialog'} onClose={closeLayer} onNewChat={() => newChat()} />
      {notice && <div className="replica-toast" key={notice.id} role="status">{notice.message}</div>}
    </div>
  )
}

export default App
