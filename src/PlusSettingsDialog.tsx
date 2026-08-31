import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Search,
  X,
} from 'lucide-react'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { CurrentSettingsPanel } from './CurrentSettingsPanels'
import {
  DEFAULT_ACCOUNT_SETTINGS,
  EMPTY_ACCOUNT_SETTINGS_OPTIONS,
  mergeAccountSettings,
  type AccountSettings,
  type AccountSettingsOptions,
  type AccountSettingsPatch,
  type NotificationChannel,
  type NotificationSettingOption,
  type SettingCapability,
  type VoiceSettingOption,
} from './lib/accountSettings'
import './PlusSettingsDialog.css'

export type PlusSettingsTheme = 'system' | 'dark' | 'light'

export interface PlusSettingsDialogProps {
  open: boolean
  onClose: () => void
  initialTab?: PlusSettingsTabId
  onTabChange?: (tab: PlusSettingsTabId) => void
  theme: PlusSettingsTheme
  onThemeChange: (theme: PlusSettingsTheme) => void
  language?: string
  onLanguageChange?: (language: string) => void
  accountName?: string
  accountEmail?: string
  planLabel?: string
  settings?: AccountSettings
  capabilities?: Record<string, SettingCapability>
  options?: AccountSettingsOptions
  onSettingsChange?: (changes: AccountSettingsPatch) => void
}

export type PlusSettingsTabId =
  | 'general'
  | 'notifications'
  | 'personalization'
  | 'plugins'
  | 'voice'
  | 'billing'
  | 'usage'
  | 'analytics'
  | 'data'
  | 'cloud-browser'
  | 'storage'
  | 'safety'
  | 'security'
  | 'parental'
  | 'trusted-contacts'
  | 'account'
  | 'shortcuts'

interface NavItem {
  id: PlusSettingsTabId
  label: string
  iconId: string
}

const NAV_ITEMS: NavItem[] = [
  { id: 'general', label: '常规', iconId: 'settings-general' },
  { id: 'notifications', label: '通知', iconId: 'settings-notifications' },
  { id: 'personalization', label: '个性化', iconId: 'settings-personalization' },
  { id: 'plugins', label: '插件', iconId: 'settings-plugins' },
  { id: 'voice', label: '语音', iconId: 'settings-voice' },
  { id: 'billing', label: '账单', iconId: 'settings-billing' },
  { id: 'usage', label: '使用情况', iconId: 'settings-usage' },
  { id: 'analytics', label: '分析', iconId: 'settings-analytics' },
  { id: 'data', label: '数据管理', iconId: 'settings-data' },
  { id: 'cloud-browser', label: '云浏览器', iconId: 'settings-cloud-browser' },
  { id: 'storage', label: '存储空间', iconId: 'settings-storage' },
  { id: 'safety', label: '安全防护', iconId: 'settings-safety' },
  { id: 'security', label: '账户安全与登录', iconId: 'settings-security' },
  { id: 'parental', label: '家长控制', iconId: 'settings-parental' },
  { id: 'trusted-contacts', label: '受信任联系人', iconId: 'settings-trusted-contacts' },
  { id: 'account', label: '账户', iconId: 'settings-account' },
  { id: 'shortcuts', label: '快捷键', iconId: 'settings-shortcuts' },
]

const LANGUAGE_OPTIONS = [
  ['auto', '自动检测'],
  ['zh-CN', '中文（简体）'],
  ['zh-TW', '中文（繁体）'],
  ['en', 'English'],
  ['ja', '日本語'],
  ['ko', '한국어'],
] as const

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function usePresence(open: boolean, duration = 190) {
  const [present, setPresent] = useState(open)
  const [active, setActive] = useState(false)

  useEffect(() => {
    // Keep the portal mounted for a short closing animation.
    // eslint-disable-next-line react/set-state-in-effect
    if (open) setPresent(true)
    else setActive(false)
  }, [open])

  useEffect(() => {
    if (!present) return
    if (!open) {
      const timeout = window.setTimeout(() => setPresent(false), duration)
      return () => window.clearTimeout(timeout)
    }

    let secondFrame = 0
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => setActive(true))
    })
    return () => {
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
    }
  }, [duration, open, present])

  return { active, present }
}

function useSystemDark() {
  const [dark, setDark] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  ))

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setDark(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return dark
}

function Toggle({ checked, disabled = false, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <label className="ps-switch" title={label}>
      <span className="ps-sr-only">{label}</span>
      <input checked={checked} disabled={disabled} onChange={(event) => onChange(event.currentTarget.checked)} role="switch" type="checkbox" />
      <span aria-hidden="true" className="ps-switch-track"><span /></span>
    </label>
  )
}

function SettingsSpriteIcon({ className, id }: { className?: string; id: string }) {
  return (
    <svg aria-hidden="true" className={className}>
      <use href={`/settings-icons.svg#${id}`} />
    </svg>
  )
}

function SelectControl({
  ariaLabel,
  disabled = false,
  onChange,
  options,
  value,
}: {
  ariaLabel: string
  disabled?: boolean
  onChange: (value: string) => void
  options: ReadonlyArray<readonly [string, string]>
  value: string
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 320 })
  const { active, present } = usePresence(menuOpen, 120)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()
  const selectedIndex = Math.max(0, options.findIndex(([optionValue]) => optionValue === value))
  const label = options[selectedIndex]?.[1] ?? value

  const updatePosition = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.min(220, window.innerWidth - 16)
    const naturalHeight = options.length * 36 + 12
    const maxHeight = Math.min(naturalHeight, window.innerHeight - 16)
    const below = rect.bottom + 4
    const top = below + maxHeight <= window.innerHeight - 8
      ? below
      : Math.max(8, rect.top - maxHeight - 4)
    setPosition({
      left: Math.min(window.innerWidth - width - 8, Math.max(8, rect.left - 4)),
      top,
      maxHeight,
    })
  }

  const closeMenu = (restoreFocus = false) => {
    setMenuOpen(false)
    if (restoreFocus) window.requestAnimationFrame(() => buttonRef.current?.focus({ preventScroll: true }))
  }

  const openMenu = (index = selectedIndex) => {
    setActiveIndex(index)
    setMenuOpen(true)
  }

  const choose = (index: number) => {
    const option = options[index]
    if (!option) return
    onChange(option[0])
    closeMenu(true)
  }

  useLayoutEffect(() => {
    if (!menuOpen) return
    updatePosition()
    window.addEventListener('resize', updatePosition)
    document.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      document.removeEventListener('scroll', updatePosition, true)
    }
  // The options are immutable constants at each call site.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen, options.length])

  useEffect(() => {
    if (!menuOpen) return
    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return
      closeMenu()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [menuOpen])

  useEffect(() => {
    if (!active) return
    menuRef.current?.focus({ preventScroll: true })
    document.getElementById(`${listboxId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, activeIndex, listboxId])

  const handleButtonKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const delta = event.key === 'ArrowDown' ? 1 : -1
    openMenu((selectedIndex + delta + options.length) % options.length)
  }

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeMenu(true)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const delta = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((current) => (current + delta + options.length) % options.length)
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setActiveIndex(event.key === 'Home' ? 0 : options.length - 1)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      choose(activeIndex)
      return
    }
    if (event.key === 'Tab') closeMenu()
  }

  return (
    <>
      <button
        ref={buttonRef}
        aria-controls={menuOpen && present ? listboxId : undefined}
        aria-expanded={menuOpen && present}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="ps-select-wrap"
        disabled={disabled}
        onClick={() => menuOpen ? closeMenu() : openMenu()}
        onKeyDown={handleButtonKeyDown}
        type="button"
      >
      <span>{label}</span>
        <svg aria-hidden="true" fill="currentColor" viewBox="0 0 16 16"><path d="M12.629 5.879a.525.525 0 1 1 .742.742l-4.765 4.765a.86.86 0 0 1-1.212 0L2.629 6.62a.525.525 0 1 1 .742-.742L8 10.508z" /></svg>
      </button>
      {present ? createPortal(
        <div
          ref={menuRef}
          aria-activedescendant={`${listboxId}-${activeIndex}`}
          aria-label={ariaLabel}
          className="ps-select-menu"
          data-resolved-theme={document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'}
        data-state={menuOpen ? 'open' : 'closed'}
          id={listboxId}
          onKeyDown={handleMenuKeyDown}
          role="listbox"
          style={position}
          tabIndex={-1}
        >
          {options.map(([optionValue, optionLabel], index) => (
            <button
              aria-selected={optionValue === value}
              className={`ps-select-option${activeIndex === index ? ' is-active' : ''}`}
              id={`${listboxId}-${index}`}
              key={optionValue}
              onClick={() => choose(index)}
              onPointerMove={() => setActiveIndex(index)}
              role="option"
              tabIndex={-1}
              type="button"
            >
              <span>{optionLabel}</span>
              {optionValue === value ? <Check aria-hidden="true" /> : null}
            </button>
          ))}
        </div>,
        document.body,
      ) : null}
    </>
  )
}

const ACCENT_COLORS: Record<string, string> = {
  default: '#b4b4b4',
  black: '#0d0d0d',
  blue: '#3a83f7',
  green: '#10a37f',
  purple: '#ab68ff',
  yellow: '#f4c542',
  pink: '#e85aad',
  orange: '#f47b20',
}

function AccentControl({ disabled = false, onChange, value }: { disabled?: boolean; onChange: (value: string) => void; value: string }) {
  return (
    <span className="ps-accent-control">
      <span aria-hidden="true" className="ps-accent-dot" style={{ backgroundColor: ACCENT_COLORS[value] ?? ACCENT_COLORS.black }} />
      <SelectControl
        ariaLabel="强调色"
        disabled={disabled}
        onChange={onChange}
        options={[["default", "默认"], ["black", "黑色"], ["blue", "蓝色"], ["green", "绿色"], ["purple", "紫色"], ["yellow", "黄色"], ["pink", "粉色"], ["orange", "橙色"]]}
        value={value}
      />
    </span>
  )
}

function SettingsRow({
  action,
  description,
  title,
}: {
  action: ReactNode
  description?: ReactNode
  title: string
}) {
  return (
    <div className="ps-row">
      <div className="ps-row-copy">
        <div className="ps-row-title">{title}</div>
        {description ? <div className="ps-row-description">{description}</div> : null}
      </div>
      <div className="ps-row-action">{action}</div>
    </div>
  )
}

function DetailRow({
  action,
  className = '',
  description,
  footer,
  title,
}: {
  action?: ReactNode
  className?: string
  description?: ReactNode
  footer?: ReactNode
  title: string
}) {
  return (
    <div className={`ps-detail-row${className ? ` ${className}` : ''}`}>
      <div className="ps-detail-copy">
        <div className="ps-detail-title">{title}</div>
        {description ? <div className="ps-detail-description">{description}</div> : null}
        {footer ? <div className="ps-detail-footer">{footer}</div> : null}
      </div>
      {action ? <div className="ps-detail-action">{action}</div> : null}
    </div>
  )
}

function DisclosureRow({
  description,
  onClick,
  title,
  value,
}: {
  description?: ReactNode
  onClick: () => void
  title: string
  value?: ReactNode
}) {
  return (
    <button className="ps-disclosure-row" onClick={onClick} type="button">
      <span className="ps-disclosure-copy">
        <span className="ps-detail-title">{title}</span>
        {description ? <span className="ps-detail-description">{description}</span> : null}
      </span>
      <span className="ps-disclosure-value">{value ? <span>{value}</span> : null}<ChevronRight aria-hidden="true" /></span>
    </button>
  )
}

const FALLBACK_NOTIFICATION_ROWS: NotificationSettingOption[] = [
  { id: 'codex', label: 'Codex', description: '接收有关 Codex 任务的通知。', channels: ['push'] },
  { id: 'personalization', label: '个性化提示', description: '根据你与 ChatGPT 的对话获取实用推荐。', channels: ['push', 'email'] },
  { id: 'tasks', label: '任务', description: '当你创建的任务有更新时收到通知。', channels: ['push'] },
  { id: 'usage', label: '使用情况', description: '当图片生成等功能的额度重置时收到通知。', channels: ['push', 'email'] },
  { id: 'health', label: '健康', description: '当你的健康数据准备就绪时收到通知。', channels: ['push'] },
  { id: 'replies', label: '回复', description: '当需要较长时间的回复完成时收到通知。', channels: ['push'] },
  { id: 'group', label: '群聊', description: '接收群聊新消息通知。', channels: ['push'] },
  { id: 'marketing', label: '营销', description: '随时了解 ChatGPT 的新工具和功能。', channels: ['push'] },
  { id: 'projects', label: '项目', description: '接收共享项目邀请通知。', channels: ['email'] },
]

const FALLBACK_VOICES: VoiceSettingOption[] = [
  { id: 'maple', label: 'Maple', description: '开朗直率' },
  { id: 'spruce', label: 'Spruce', description: '冷静坚定' },
  { id: 'vale', label: 'Vale', description: '聪颖好奇' },
  { id: 'cove', label: 'Cove', description: '沉稳直率' },
  { id: 'juniper', label: 'Juniper', description: '开放豁达' },
  { id: 'ember', label: 'Ember', description: '自信乐观' },
  { id: 'sol', label: 'Sol', description: '聪慧随性' },
  { id: 'breeze', label: 'Breeze', description: '活泼认真' },
  { id: 'arbor', label: 'Arbor', description: '随和多才' },
]

function notificationChannelOptions(channels: NotificationSettingOption['channels']) {
  const supported = new Set(channels)
  const result: Array<readonly [NotificationChannel, string]> = []
  if (supported.has('push')) result.push(['push', '推送'])
  if (supported.has('email')) result.push(['email', '电子邮件'])
  if (supported.has('push') && supported.has('email')) result.push(['both', '推送，电子邮件'])
  result.push(['off', '关闭'])
  return result
}

function ActionButton({ children, danger = false, onClick }: { children: ReactNode; danger?: boolean; onClick: () => void }) {
  return (
    <button className={`ps-action-button${danger ? ' is-danger' : ''}`} onClick={onClick} type="button">
      {children}
    </button>
  )
}

function SettingsSection({ children, className = '', title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <section className={`ps-section${className ? ` ${className}` : ''}`}>
      {title ? <h3>{title}</h3> : null}
      <div className="ps-section-rows">{children}</div>
    </section>
  )
}

export function PlusSettingsDialog({
  accountEmail = '',
  accountName = 'ChatGPT 用户',
  capabilities = {},
  initialTab = 'general',
  language,
  onClose,
  onLanguageChange,
  onSettingsChange,
  onTabChange,
  onThemeChange,
  open,
  options = EMPTY_ACCOUNT_SETTINGS_OPTIONS,
  planLabel = 'Plus',
  settings = DEFAULT_ACCOUNT_SETTINGS,
  theme,
}: PlusSettingsDialogProps) {
  const { present } = usePresence(open, 16)
  const systemDark = useSystemDark()
  const [selectedTab, setSelectedTab] = useState<PlusSettingsTabId>(initialTab)
  const [query, setQuery] = useState('')
  const [internalLanguage, setInternalLanguage] = useState('auto')
  const [draftSettings, setDraftSettings] = useState<AccountSettings>(() => mergeAccountSettings(DEFAULT_ACCOUNT_SETTINGS, settings))
  const [actionMessage, setActionMessage] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const selectedLanguage = language ?? internalLanguage
  const currentItem = NAV_ITEMS.find((item) => item.id === selectedTab) ?? NAV_ITEMS[0]
  const notificationRows = options.notifications.length ? options.notifications : FALLBACK_NOTIFICATION_ROWS
  const voiceChoices = options.voices.length ? options.voices : FALLBACK_VOICES
  const voiceIndex = voiceChoices.findIndex((voice) => voice.id === draftSettings.voice.name)
  const voiceNavigationIndex = voiceIndex >= 0 ? voiceIndex : 0
  const currentVoice = voiceIndex >= 0
    ? voiceChoices[voiceIndex]
    : {
        id: draftSettings.voice.name,
        label: draftSettings.voice.name || '不可用',
        description: '当前语音不在可用列表中。',
      }
  const resolvedDark = theme === 'dark' || (theme === 'system' && systemDark)
  const writable = (path: string) => {
    const capability = capabilities[path]
      ?? (path.startsWith('notifications.') ? capabilities.notifications : undefined)
    return capability?.writable === true
  }
  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('zh-CN')
    if (!normalized) return NAV_ITEMS
    return NAV_ITEMS.filter((item) => item.label.toLocaleLowerCase('zh-CN').includes(normalized))
  }, [query])

  useEffect(() => {
    if (!open) return
    // Keep the pane synchronized with hash/history changes.
    // eslint-disable-next-line react/set-state-in-effect
    setSelectedTab(initialTab)
  }, [initialTab, open])

  useEffect(() => {
    if (!open) return
    setQuery('')
  }, [open])

  useEffect(() => {
    // The dialog keeps an optimistic draft so controls respond immediately
    // while the parent serializes backend writes.
    // eslint-disable-next-line react/set-state-in-effect
    setDraftSettings(mergeAccountSettings(DEFAULT_ACCOUNT_SETTINGS, settings))
  }, [settings])

  useEffect(() => {
    if (!actionMessage) return
    const timeout = window.setTimeout(() => setActionMessage(''), 1800)
    return () => window.clearTimeout(timeout)
  }, [actionMessage])

  useEffect(() => {
    if (!open || !present) return
    const dialog = dialogRef.current
    if (!dialog) return

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const portalLayer = dialog.parentElement
    const siblings = portalLayer?.parentElement
      ? Array.from(portalLayer.parentElement.children)
          .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== portalLayer)
          .map((element) => ({ element, inert: element.inert }))
      : []
    siblings.forEach(({ element }) => { element.inert = true })

    // Keep keyboard focus inside the modal without painting a search-field
    // focus ring on open; the native desktop dialog opens visually neutral.
    const focusTimer = window.setTimeout(() => dialog.focus({ preventScroll: true }))
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((element) => !element.hidden && !element.closest('[inert]') && element.offsetParent !== null && element.tabIndex >= 0)
      if (!focusable.length) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', keydown)
    return () => {
      window.clearTimeout(focusTimer)
      window.removeEventListener('keydown', keydown)
      document.body.style.overflow = previousOverflow
      siblings.forEach(({ element, inert }) => { element.inert = inert })
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [onClose, open, present])

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => {
      const nav = dialogRef.current?.querySelector<HTMLElement>('.ps-nav')
      const tab = nav?.querySelector<HTMLElement>(`[data-settings-tab="${selectedTab}"]`)
      if (!nav || !tab) return
      if (nav.scrollWidth > nav.clientWidth + 1) {
        const edgeInset = 6
        const tabStart = tab.offsetLeft
        const tabEnd = tabStart + tab.offsetWidth
        const visibleStart = nav.scrollLeft + edgeInset
        const visibleEnd = nav.scrollLeft + nav.clientWidth - edgeInset
        if (tabStart < visibleStart) nav.scrollLeft = Math.max(0, tabStart - edgeInset)
        else if (tabEnd > visibleEnd) nav.scrollLeft = tabEnd - nav.clientWidth + edgeInset
      } else {
        tab.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open, selectedTab])

  if (!present || typeof document === 'undefined') return null

  const changeSettings = (changes: AccountSettingsPatch) => {
    setDraftSettings((current) => mergeAccountSettings(current, changes))
    onSettingsChange?.(changes)
  }

  const updateLanguage = (nextLanguage: string) => {
    if (language === undefined) setInternalLanguage(nextLanguage)
    onLanguageChange?.(nextLanguage)
    changeSettings({ general: { language: nextLanguage as AccountSettings['general']['language'] } })
  }

  const chooseTab = (id: PlusSettingsTabId) => {
    setSelectedTab(id)
    onTabChange?.(id)
    const content = dialogRef.current?.querySelector<HTMLElement>('.ps-content-scroll')
    content?.scrollTo({ top: 0 })
  }

  const runAction = (message: string) => setActionMessage(message)

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, id: PlusSettingsTabId) => {
    const currentIndex = filteredItems.findIndex((item) => item.id === id)
    if (currentIndex < 0) return
    let nextIndex: number | null = null
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % filteredItems.length
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + filteredItems.length) % filteredItems.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = filteredItems.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    const nextId = filteredItems[nextIndex]?.id
    if (!nextId) return
    chooseTab(nextId)
    dialogRef.current?.querySelector<HTMLButtonElement>(`[data-settings-tab="${nextId}"]`)?.focus()
  }

  const generalPanel = (
    <>
      <SettingsSection className="ps-general-panel">
        <SettingsRow
          action={<SelectControl ariaLabel="外观" disabled={!writable('general.theme')} onChange={(value) => { onThemeChange(value as PlusSettingsTheme); changeSettings({ general: { theme: value as AccountSettings['general']['theme'] } }) }} options={[["system", "系统"], ["dark", "深色"], ["light", "浅色"]]} value={theme} />}
          title="外观"
        />
        <SettingsRow
          action={<SelectControl ariaLabel="对比度" disabled={!writable('general.contrast')} onChange={(value) => changeSettings({ general: { contrast: value as AccountSettings['general']['contrast'] } })} options={[["system", "系统"], ["standard", "标准"], ["high", "高对比度"]]} value={draftSettings.general.contrast} />}
          title="对比度"
        />
        <SettingsRow
          action={<AccentControl disabled={!writable('general.accent')} onChange={(value) => changeSettings({ general: { accent: value as AccountSettings['general']['accent'] } })} value={draftSettings.general.accent} />}
          title="强调色"
        />
        <SettingsRow
          action={<SelectControl ariaLabel="语言" disabled={!writable('general.language')} onChange={updateLanguage} options={LANGUAGE_OPTIONS} value={selectedLanguage} />}
          title="语言"
        />
        <SettingsRow
          action={<Toggle checked={draftSettings.general.smarter} disabled={!writable('general.smarter')} label="更强智能" onChange={(checked) => changeSettings({ general: { smarter: checked } })} />}
          description="当你提出复杂问题时，ChatGPT 可以自动使用更高智能级别设置。"
          title="更强智能"
        />
        <SettingsRow
          action={<Toggle checked={draftSettings.general.dictation} disabled={!writable('general.dictation')} label="启用听写" onChange={(checked) => changeSettings({ general: { dictation: checked } })} />}
          description="在聊天输入框中使用语音输入。"
          title="启用听写"
        />
      </SettingsSection>
    </>
  )

  const panelForTab = (): ReactNode => {
    if (selectedTab === 'general') return generalPanel
    if (selectedTab === 'notifications') return (
      <section className="ps-detail-list ps-notification-list">
        {notificationRows.map((row) => (
          <DetailRow
            action={<SelectControl ariaLabel={`${row.label}通知方式`} disabled={!writable(`notifications.${row.id}`)} onChange={(next) => changeSettings({ notifications: { [row.id]: next as NotificationChannel } })} options={notificationChannelOptions(row.channels)} value={draftSettings.notifications[row.id] ?? 'off'} />}
            className={row.description.length > 72 ? 'is-tall' : ''}
            description={row.description}
            key={row.id}
            title={row.label}
          />
        ))}
      </section>
    )
    if (selectedTab === 'personalization') return (
      <section className="ps-personalization-panel ps-personalization-current">
        <section className="ps-personality-primary">
          <div className="ps-personality-style-row">
            <div className="ps-personality-copy">
              <div className="ps-personality-title">基本风格和语调</div>
              <div className="ps-personality-description">设置 ChatGPT 回复你的风格和语调。这不会影响 ChatGPT 的功能。</div>
            </div>
            <SelectControl
              ariaLabel="基本风格和语调"
              disabled={!writable('personalization.personaStyle')}
              onChange={(value) => changeSettings({ personalization: { personaStyle: value as AccountSettings['personalization']['personaStyle'] } })}
              options={[["default", "默认"], ["professional", "专业可靠"], ["friendly", "亲和友善"], ["candid", "直言不讳"], ["quirky", "天马行空"], ["efficient", "高效务实"], ["cynical", "吐槽达人"]]}
              value={draftSettings.personalization.personaStyle}
            />
          </div>
          <div className="ps-personality-feature-heading">
            <div>特征</div>
            <span>在基本风格和语调的基础上选择额外的自定义项。</span>
          </div>
          {[
            ['warmth', '温和体贴'],
            ['enthusiasm', '热情洋溢'],
            ['headings', '标题和列表'],
            ['emoji', '表情符号'],
          ].map(([key, label]) => (
            <div className="ps-personality-trait-row" key={key}>
              <span>{label}</span>
              <SelectControl
                ariaLabel={label}
                disabled={!writable('personalization.traits')}
                onChange={(value) => changeSettings({ personalization: { traits: { [key]: value } } })}
                options={[["default", "默认"], ["more", "更多"], ["less", "更少"]]}
                value={draftSettings.personalization.traits[key as keyof AccountSettings['personalization']['traits']] ?? 'default'}
              />
            </div>
          ))}
          <div className="ps-personality-separator" />
          <SettingsRow
            action={<Toggle checked={draftSettings.personalization.quickAnswers} disabled={!writable('personalization.quickAnswers')} label="快速回答" onChange={(checked) => changeSettings({ personalization: { quickAnswers: checked } })} />}
            description="ChatGPT 有时会利用其通用知识提供快速且深入的回答。这些回答并非个性化内容，也不会使用你的记忆。"
            title="快速回答"
          />
          <SettingsRow
            action={<Toggle checked={draftSettings.personalization.suggestions} disabled={!writable('personalization.suggestions')} label="建议提示" onChange={(checked) => changeSettings({ personalization: { suggestions: checked } })} />}
            description="ChatGPT 可以通过搜索已连接的插件来生成建议"
            title="建议提示"
          />
          <label className="ps-field-block ps-personality-field">
            <span>自定义指令</span>
            <textarea disabled={!writable('personalization.customInstructions')} maxLength={5000} onChange={(event) => changeSettings({ personalization: { customInstructions: event.currentTarget.value } })} placeholder="其他行为、风格和语调偏好设置" rows={1} value={draftSettings.personalization.customInstructions} />
          </label>
        </section>

        <section className="ps-current-subsection ps-pet-section">
          <h3>宠物</h3>
          <div className="ps-pet-row">
            <span><strong>{draftSettings.personalization.pet === 'default' ? '默认' : draftSettings.personalization.pet}</strong><small>选择一个与你并肩工作的伙伴</small></span>
            <SelectControl ariaLabel="选择宠物" disabled={!writable('personalization.pet')} onChange={(value) => changeSettings({ personalization: { pet: value } })} options={[["default", "默认"], ["codex", "Codex"], ["dewey", "Dewey"], ["fireball", "Fireball"], ["hoots", "Hoots"], ["rocky", "Rocky"], ["seedy", "Seedy"], ["stacky", "Stacky"], ["bsod", "BSOD"], ["null-signal", "Null Signal"]]} value={draftSettings.personalization.pet} />
          </div>
        </section>

        <section className="ps-current-subsection ps-about-section">
          <h3>关于你</h3>
          <label className="ps-field-block"><span>昵称</span><textarea disabled={!writable('personalization.nickname')} maxLength={128} onChange={(event) => changeSettings({ personalization: { nickname: event.currentTarget.value } })} placeholder="ChatGPT 应该怎么称呼你？" rows={1} value={draftSettings.personalization.nickname} /></label>
          <label className="ps-field-block"><span>职业</span><textarea disabled={!writable('personalization.occupation')} maxLength={512} onChange={(event) => changeSettings({ personalization: { occupation: event.currentTarget.value } })} placeholder="滑铁卢大学工程系学生" rows={1} value={draftSettings.personalization.occupation} /></label>
          <label className="ps-field-block"><span>你的详情</span><textarea disabled={!writable('personalization.details')} maxLength={5000} onChange={(event) => changeSettings({ personalization: { details: event.currentTarget.value } })} placeholder="需要记住的兴趣、价值观或偏好" rows={1} value={draftSettings.personalization.details} /></label>
        </section>

        <section className="ps-current-subsection ps-memory-section">
          <h3>记忆</h3>
          <SettingsRow action={<Toggle checked={draftSettings.personalization.memory} disabled={!writable('personalization.memory')} label="启用记忆" onChange={(checked) => changeSettings({ personalization: { memory: checked } })} />} description={<>让 ChatGPT 依据聊天记录、文件及已关联应用，为你定制专属使用体验。 <button className="ps-inline-link" onClick={() => runAction('帮助页面需要独立流程，未执行任何更改')} type="button">了解更多</button></>} title="启用记忆" />
          <DetailRow action={<ActionButton onClick={() => runAction('记忆管理需要独立流程，未执行任何更改')}>管理</ActionButton>} description="查看 ChatGPT 已了解的关于你的信息概览。对于你希望它始终记住的信息，请使用自定义指令。你仍可管理旧版已保存的记忆。" title="记忆摘要" />
          <div className="ps-memory-note">GPT 可使用记忆库，通过必应等搜索提供商进行个性化查询。 <button className="ps-inline-link" onClick={() => runAction('帮助页面需要独立流程，未执行任何更改')} type="button">了解更多</button></div>
        </section>

        <section className="ps-current-subsection ps-record-section">
          <h3>录音模式</h3>
          <SettingsRow action={<Toggle checked={draftSettings.personalization.recordHistory} disabled={!writable('personalization.recordHistory')} label="参考录音历史记录" onChange={(checked) => changeSettings({ personalization: { recordHistory: checked } })} />} description="允许 ChatGPT 在回复时参考所有过往录音转录内容和笔记。" title="参考录音历史记录" />
        </section>
        <button className="ps-advanced-row" onClick={() => runAction('高级设置需要独立流程，未执行任何更改')} type="button">高级 <ChevronRight /></button>
      </section>
    )
    if (selectedTab === 'plugins') return (
      <section className="ps-plugins-panel">
        <DisclosureRow
          description="选择 ChatGPT 在使用插件时应在何时请求许可。"
          onClick={() => runAction('插件权限需要独立流程，未执行任何更改')}
          title="权限"
          value={<><span className="ps-plugin-permission-full">允许低风险操作</span><span className="ps-plugin-permission-short">允许低风险</span></>}
        />
        <div className="ps-plugin-list">
          {[
            ['research', 'Deep Research'],
            ['templates', 'Default templates'],
            ['documents', 'Documents'],
            ['github', 'GitHub'],
            ['pdf', 'PDF'],
            ['management', 'Plugin Management'],
            ['presentations', 'Presentations'],
            ['spreadsheets', 'Spreadsheets'],
            ['template-creator', 'Template Creator'],
          ].map(([kind, label]) => (
            <button className="ps-plugin-row" key={kind} onClick={() => runAction(`${label} 需要独立流程，未执行任何更改`)} type="button">
              {kind === 'github'
                ? <svg aria-label="GitHub" className="ps-plugin-logo ps-plugin-github" role="img" viewBox="0 0 19 19"><use href="/icons.svg#github-icon" /></svg>
                : kind === 'template-creator'
                  ? <span aria-hidden="true" className="ps-plugin-logo ps-plugin-template-logo">✦</span>
                  : <img alt={label} className="ps-plugin-logo" src={`/plugin-${kind}.png`} />}
              <span>{label}</span>
              <ChevronRight aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className="ps-plugin-footer-list">
          <a className="ps-plugin-row" href="/plugins"><span className="ps-plugin-system-icon"><SettingsSpriteIcon id="settings-plugins" /></span><span>浏览插件</span><ChevronRight /></a>
          <a className="ps-plugin-row" href="/#settings/Security"><span className="ps-plugin-system-icon"><SettingsSpriteIcon id="settings-general" /></span><span>开发者模式</span><ChevronRight /></a>
        </div>
      </section>
    )
    if (selectedTab === 'voice') return (
      <section className="ps-voice-panel">
        <div className="ps-voice-picker">
          <div className={`ps-voice-orb is-${currentVoice.id}`} key={currentVoice.id} />
          <div className="ps-voice-name">{currentVoice.label}</div>
          <div className="ps-voice-description">{currentVoice.description}</div>
          <button aria-label="上一个语音" className="ps-voice-arrow is-previous" disabled={!writable('voice.name') || voiceChoices.length === 0} onClick={() => changeSettings({ voice: { name: voiceChoices[(voiceNavigationIndex - 1 + voiceChoices.length) % voiceChoices.length].id } })} type="button"><ChevronLeft /></button>
          <button aria-label="下一个语音" className="ps-voice-arrow is-next" disabled={!writable('voice.name') || voiceChoices.length === 0} onClick={() => changeSettings({ voice: { name: voiceChoices[(voiceNavigationIndex + 1) % voiceChoices.length].id } })} type="button"><ChevronRight /></button>
          <div aria-label="选择语音" className="ps-voice-dots" role="radiogroup">
            {voiceChoices.map((voice) => <button aria-checked={draftSettings.voice.name === voice.id} aria-label={voice.label} className={draftSettings.voice.name === voice.id ? 'is-active' : ''} disabled={!writable('voice.name')} key={voice.id} onClick={() => changeSettings({ voice: { name: voice.id } })} role="radio" type="button" />)}
          </div>
        </div>
        <SettingsRow action={<SelectControl ariaLabel="语音模型" disabled={!writable('voice.model')} onChange={(value) => changeSettings({ voice: { model: value as AccountSettings['voice']['model'] } })} options={[["live", "Live"], ["standard", "标准"]]} value={draftSettings.voice.model} />} title="模型" />
        <SettingsRow action={<SelectControl ariaLabel="语音智能" disabled={!writable('voice.intelligence')} onChange={(value) => changeSettings({ voice: { intelligence: value as AccountSettings['voice']['intelligence'] } })} options={[["instant", "快速"], ["medium", "标准"], ["high", "高"]]} value={draftSettings.voice.intelligence} />} title="智能" />
        <SettingsRow action={<SelectControl ariaLabel="语音语言" disabled={!writable('voice.language')} onChange={(value) => changeSettings({ voice: { language: value as AccountSettings['voice']['language'] } })} options={LANGUAGE_OPTIONS} value={draftSettings.voice.language} />} title="语言" />
      </section>
    )
    if (
      selectedTab === 'billing'
      || selectedTab === 'usage'
      || selectedTab === 'analytics'
      || selectedTab === 'data'
      || selectedTab === 'cloud-browser'
      || selectedTab === 'storage'
      || selectedTab === 'safety'
      || selectedTab === 'security'
      || selectedTab === 'parental'
      || selectedTab === 'trusted-contacts'
      || selectedTab === 'account'
      || selectedTab === 'shortcuts'
    ) {
      return <CurrentSettingsPanel accountEmail={accountEmail} accountName={accountName} capabilities={capabilities} onAction={runAction} onSettingsChange={changeSettings} planLabel={planLabel} settings={draftSettings} tab={selectedTab} />
    }
    return null
  }

  const closeFromBackdrop = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && open) onClose()
  }

  return createPortal(
    <div
      className="ps-layer"
      data-resolved-theme={resolvedDark ? 'dark' : 'light'}
      data-state={open ? 'open' : 'closed'}
      onPointerDown={closeFromBackdrop}
    >
      <div
        ref={dialogRef}
        aria-describedby={descriptionId}
        aria-hidden={!open}
        aria-labelledby={titleId}
        aria-modal="true"
        className="ps-dialog"
        inert={!open}
        role="dialog"
        tabIndex={-1}
      >
        <h2 className="ps-sr-only" id={titleId}>设置</h2>
        <p className="ps-sr-only" id={descriptionId}>ChatGPT {planLabel} 账户设置</p>
        <aside aria-label="设置导航" className="ps-sidebar">
          <div className="ps-sidebar-topbar">
            <button aria-label="关闭设置" className="ps-icon-button ps-close" onClick={onClose} type="button"><X /></button>
            <h2>设置</h2>
          </div>
          <label className="ps-search">
            <Search aria-hidden="true" size={18} />
            <span className="ps-sr-only">搜索设置</span>
            <input ref={searchRef} aria-label="搜索设置" onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索设置" type="search" value={query} />
            {query ? <button aria-label="清除搜索" onClick={() => { setQuery(''); searchRef.current?.focus() }} type="button"><X size={15} /></button> : null}
          </label>
          <nav aria-label="设置类别" className="ps-nav" role="tablist">
            {filteredItems.map((item) => {
              const selected = item.id === selectedTab
              return (
                <button
                  aria-controls={`${titleId}-panel`}
                  aria-selected={selected}
                  className={`ps-nav-item${selected ? ' is-active' : ''}`}
                  data-settings-tab={item.id}
                  data-state={selected ? 'active' : 'inactive'}
                  key={item.id}
                  onClick={() => chooseTab(item.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, item.id)}
                  role="tab"
                  tabIndex={selected || (!filteredItems.some((candidate) => candidate.id === selectedTab) && item === filteredItems[0]) ? 0 : -1}
                  type="button"
                >
                  <SettingsSpriteIcon id={item.iconId} />
                  <span>{item.label}</span>
                </button>
              )
            })}
            {filteredItems.length === 0 ? <div className="ps-search-empty"><Search size={22} /><span>没有找到设置</span></div> : null}
          </nav>
        </aside>

        <main
          aria-labelledby={`${titleId}-content-title`}
          className={`ps-content${selectedTab === 'plugins' ? ' is-with-subtitle' : ''}`}
          id={`${titleId}-panel`}
          role="tabpanel"
        >
          <header className={`ps-content-header${selectedTab === 'plugins' ? ' is-with-subtitle' : ''}`}>
            <h2 id={`${titleId}-content-title`}>{selectedTab === 'usage' ? '用量' : currentItem.label}</h2>
            {selectedTab === 'plugins' ? <span className="ps-content-subtitle">管理已安装的插件</span> : null}
            {selectedTab === 'cloud-browser' ? <button aria-label="关于云浏览器" className="ps-header-help" onClick={() => runAction('帮助页面需要独立流程，未执行任何更改')} type="button"><CircleHelp /></button> : null}
          </header>
          <div className="ps-content-scroll">{panelForTab()}</div>
        </main>

        <div aria-atomic="true" aria-live="polite" className={`ps-toast${actionMessage ? ' is-visible' : ''}`} role="status">
          {actionMessage ? <><Check size={16} />{actionMessage}</> : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default PlusSettingsDialog
