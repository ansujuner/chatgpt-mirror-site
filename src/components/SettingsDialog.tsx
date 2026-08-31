import { useEffect, useId, useRef, useState } from 'react'
import {
  Database,
  Info,
  Languages,
  MonitorCog,
  PanelLeft,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'

export type ThemePreference = 'system' | 'light' | 'dark'

export interface SettingsValues {
  theme: ThemePreference
  language: string
  historyEnabled: boolean
  compactSidebar: boolean
}

export interface SettingsLanguageOption {
  value: string
  label: string
}

export type SettingsSection = 'general' | 'data' | 'about'

export interface SettingsDialogProps {
  open: boolean
  values: SettingsValues
  onChange: (nextValues: SettingsValues) => void
  onClose: () => void
  onClearHistory?: () => void
  languages?: SettingsLanguageOption[]
  initialSection?: SettingsSection
  productName?: string
  version?: string
}

const DEFAULT_LANGUAGES: SettingsLanguageOption[] = [
  { value: 'zh-CN', label: '中文（简体）' },
  { value: 'zh-TW', label: '中文（繁体）' },
  { value: 'en', label: 'English' },
]

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function getFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((element) => !element.hasAttribute('hidden'))
}

export function SettingsDialog({
  open,
  values,
  onChange,
  onClose,
  onClearHistory,
  languages = DEFAULT_LANGUAGES,
  initialSection = 'general',
  productName = 'AI Chat',
  version,
}: SettingsDialogProps) {
  const [activeSection, setActiveSection] =
    useState<SettingsSection>(initialSection)
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return

    const previouslyFocused = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const focusTimer = window.setTimeout(() => {
      setActiveSection(initialSection)
      if (!panelRef.current) return
      const firstFocusable = getFocusableElements(panelRef.current)[0]
      if (firstFocusable) firstFocusable.focus()
      else panelRef.current.focus()
    }, 0)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }

      if (event.key !== 'Tab' || !panelRef.current) return

      const focusableElements = getFocusableElements(panelRef.current)
      if (focusableElements.length === 0) {
        event.preventDefault()
        panelRef.current.focus()
        return
      }

      const first = focusableElements[0]
      const last = focusableElements[focusableElements.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [initialSection, open])

  if (!open) return null

  const updateValue = <Key extends keyof SettingsValues>(
    key: Key,
    value: SettingsValues[Key],
  ) => onChange({ ...values, [key]: value })

  const sections: Array<{
    id: SettingsSection
    label: string
    icon: typeof SlidersHorizontal
  }> = [
    { id: 'general', label: '常规', icon: SlidersHorizontal },
    { id: 'data', label: '数据控制', icon: Database },
    { id: 'about', label: '关于', icon: Info },
  ]

  return (
    <div
      className="modal-overlay settings-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        className="modal-panel settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="settings-header">
          <h2 id={titleId} className="settings-title">
            设置
          </h2>
          <button
            type="button"
            className="icon-button settings-close"
            onClick={onClose}
            aria-label="关闭设置"
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="settings-layout">
          <nav className="settings-nav" aria-label="设置分类">
            {sections.map((section) => {
              const Icon = section.icon
              const selected = activeSection === section.id
              return (
                <button
                  key={section.id}
                  type="button"
                  className={`settings-nav-item${selected ? ' is-active' : ''}`}
                  onClick={() => setActiveSection(section.id)}
                  aria-current={selected ? 'page' : undefined}
                >
                  <Icon aria-hidden="true" />
                  <span>{section.label}</span>
                </button>
              )
            })}
          </nav>

          <div className="settings-content">
            {activeSection === 'general' && (
              <section
                className="settings-section"
                aria-labelledby={`${titleId}-general`}
              >
                <div className="settings-section-heading">
                  <h3 id={`${titleId}-general`}>常规</h3>
                  <p>自定义界面的显示方式。</p>
                </div>

                <div className="settings-row">
                  <div className="settings-row-icon" aria-hidden="true">
                    <MonitorCog />
                  </div>
                  <label className="settings-row-copy" htmlFor={`${titleId}-theme`}>
                    <span className="settings-row-label">主题</span>
                    <span className="settings-row-description">
                      选择浅色、深色或跟随系统。
                    </span>
                  </label>
                  <select
                    id={`${titleId}-theme`}
                    className="settings-select"
                    value={values.theme}
                    onChange={(event) =>
                      updateValue(
                        'theme',
                        event.currentTarget.value as ThemePreference,
                      )
                    }
                  >
                    <option value="system">跟随系统</option>
                    <option value="light">浅色</option>
                    <option value="dark">深色</option>
                  </select>
                </div>

                <div className="settings-row">
                  <div className="settings-row-icon" aria-hidden="true">
                    <Languages />
                  </div>
                  <label
                    className="settings-row-copy"
                    htmlFor={`${titleId}-language`}
                  >
                    <span className="settings-row-label">语言</span>
                    <span className="settings-row-description">
                      设置导航和控件的显示语言。
                    </span>
                  </label>
                  <select
                    id={`${titleId}-language`}
                    className="settings-select"
                    value={values.language}
                    onChange={(event) =>
                      updateValue('language', event.currentTarget.value)
                    }
                  >
                    {languages.map((language) => (
                      <option key={language.value} value={language.value}>
                        {language.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="settings-row">
                  <div className="settings-row-icon" aria-hidden="true">
                    <PanelLeft />
                  </div>
                  <div className="settings-row-copy">
                    <span className="settings-row-label">紧凑侧边栏</span>
                    <span className="settings-row-description">
                      减少会话列表的留白。
                    </span>
                  </div>
                  <button
                    type="button"
                    className={`settings-switch${values.compactSidebar ? ' is-on' : ''}`}
                    role="switch"
                    aria-checked={values.compactSidebar}
                    aria-label="紧凑侧边栏"
                    onClick={() =>
                      updateValue('compactSidebar', !values.compactSidebar)
                    }
                  >
                    <span className="settings-switch-thumb" aria-hidden="true" />
                  </button>
                </div>
              </section>
            )}

            {activeSection === 'data' && (
              <section
                className="settings-section"
                aria-labelledby={`${titleId}-data`}
              >
                <div className="settings-section-heading">
                  <h3 id={`${titleId}-data`}>数据控制</h3>
                  <p>管理聊天记录在此设备上的保存方式。</p>
                </div>

                <div className="settings-row">
                  <div className="settings-row-icon" aria-hidden="true">
                    <Database />
                  </div>
                  <div className="settings-row-copy">
                    <span className="settings-row-label">保存聊天记录</span>
                    <span className="settings-row-description">
                      关闭后，新对话将不会出现在历史记录中。
                    </span>
                  </div>
                  <button
                    type="button"
                    className={`settings-switch${values.historyEnabled ? ' is-on' : ''}`}
                    role="switch"
                    aria-checked={values.historyEnabled}
                    aria-label="保存聊天记录"
                    onClick={() =>
                      updateValue('historyEnabled', !values.historyEnabled)
                    }
                  >
                    <span className="settings-switch-thumb" aria-hidden="true" />
                  </button>
                </div>

                {onClearHistory && (
                  <div className="settings-row settings-row-danger">
                    <div className="settings-row-icon" aria-hidden="true">
                      <Trash2 />
                    </div>
                    <div className="settings-row-copy">
                      <span className="settings-row-label">删除所有聊天</span>
                      <span className="settings-row-description">
                        该操作无法撤销。
                      </span>
                    </div>
                    <button
                      type="button"
                      className="settings-danger-button"
                      onClick={onClearHistory}
                    >
                      全部删除
                    </button>
                  </div>
                )}
              </section>
            )}

            {activeSection === 'about' && (
              <section
                className="settings-section settings-about"
                aria-labelledby={`${titleId}-about`}
              >
                <div className="settings-section-heading">
                  <h3 id={`${titleId}-about`}>关于</h3>
                  <p>应用信息与版本。</p>
                </div>
                <div className="settings-about-card">
                  <div className="settings-about-mark" aria-hidden="true">
                    <Info />
                  </div>
                  <div>
                    <strong>{productName}</strong>
                    {version && <span>版本 {version}</span>}
                    <p>一个专注、流畅的 AI 对话界面。</p>
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsDialog

/**
 * Global CSS hooks used by this component:
 * .modal-overlay .settings-overlay .modal-panel .settings-dialog .icon-button
 * .settings-header .settings-title .settings-close .settings-layout
 * .settings-nav .settings-nav-item .is-active .settings-content
 * .settings-section .settings-section-heading .settings-row .settings-row-icon
 * .settings-row-copy .settings-row-label .settings-row-description
 * .settings-select .settings-switch .is-on .settings-switch-thumb
 * .settings-row-danger .settings-danger-button .settings-about
 * .settings-about-card .settings-about-mark
 */
