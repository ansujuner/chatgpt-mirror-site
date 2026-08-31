import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { hostedSessionOnly } from './lib/deploymentMode'
import './Overlays.css'

export type AuthIntent = 'login' | 'signup' | 'login_or_signup'

export interface AuthDialogProps {
  open: boolean
  onClose: () => void
  intent?: AuthIntent
  onPhoneContinue?: () => void
  callbackPath?: string
  description?: string
  emailPlaceholder?: string
  variant?: 'default' | 'images'
  onNavigateAuth?: (provider: 'google' | 'apple' | 'email' | 'phone', loginHint?: string) => void
  onSessionLogin?: () => void
}

export type ThemePreference = 'system' | 'dark' | 'light'

export interface DataControlPreferences {
  improveModel: boolean
  marketingMeasurement: boolean
  personalizedMarketing: boolean
}

export interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  theme: ThemePreference
  onThemeChange: (theme: ThemePreference) => void
  language?: string
  onLanguageChange?: (language: string) => void
  dataControls?: DataControlPreferences
  onDataControlsChange?: (preferences: DataControlPreferences) => void
  onNavigateDataUsage?: () => void
  variant?: 'default' | 'images'
}

export interface ProductCardProps {
  open: boolean
  onClose: () => void
  onLogin: () => void
  onSignup: () => void
  anchorRef?: RefObject<HTMLElement | null>
  placement?: 'anchor' | 'images'
}

const DEFAULT_DATA_CONTROLS: DataControlPreferences = {
  improveModel: true,
  marketingMeasurement: true,
  personalizedMarketing: true,
}

const DATA_CONTROLS_STORAGE_KEY = 'replica-data-controls'
const PERSONALIZED_ADS_STORAGE_KEY = 'replica-personalized-ads'

function readStoredDataControls(): DataControlPreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(DATA_CONTROLS_STORAGE_KEY) || '{}') as Partial<DataControlPreferences>
    return {
      improveModel: typeof stored.improveModel === 'boolean' ? stored.improveModel : DEFAULT_DATA_CONTROLS.improveModel,
      marketingMeasurement: typeof stored.marketingMeasurement === 'boolean' ? stored.marketingMeasurement : DEFAULT_DATA_CONTROLS.marketingMeasurement,
      personalizedMarketing: typeof stored.personalizedMarketing === 'boolean' ? stored.personalizedMarketing : DEFAULT_DATA_CONTROLS.personalizedMarketing,
    }
  } catch {
    return DEFAULT_DATA_CONTROLS
  }
}

function authFlowHref(provider: 'google' | 'apple' | 'email' | 'phone', callbackPath: string, loginHint?: string) {
  const query = new URLSearchParams({
    callback_path: callbackPath,
    screen_hint: 'login_or_signup',
  })
  if (loginHint) query.set('login_hint', loginHint)
  return `/auth/${provider}?${query.toString()}`
}

function usePresence(open: boolean, duration: number) {
  const [present, setPresent] = useState(open)
  const [active, setActive] = useState(false)

  useEffect(() => {
    // Presence intentionally mirrors an external controlled value so the exit frame can finish.
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

function useLatest<T>(value: T) {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  }, [value])
  return ref
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function useModalInteractions(
  open: boolean,
  present: boolean,
  dialogRef: RefObject<HTMLElement | null>,
  initialFocusRef: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const onCloseRef = useLatest(onClose)

  useEffect(() => {
    if (!open || !present) return

    const dialog = dialogRef.current
    if (!dialog) return

    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const modalLayer = dialog.closest<HTMLElement>('.ov-modal-layer')
    const backgroundElements = modalLayer?.parentElement
      ? Array.from(modalLayer.parentElement.children)
          .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== modalLayer)
          .map((element) => ({ element, wasInert: element.inert }))
      : []
    backgroundElements.forEach(({ element }) => { element.inert = true })

    const focusTimer = window.setTimeout(() => {
      const target = initialFocusRef.current
        ?? dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
        ?? dialog
      target.focus({ preventScroll: true })
    })

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }

      if (event.key !== 'Tab') return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((element) => (
          !element.hidden
          && element.getAttribute('aria-hidden') !== 'true'
          && !element.closest('[inert]')
          && element.offsetParent !== null
          && element.tabIndex >= 0
        ))

      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const activeElement = document.activeElement

      if (event.shiftKey && (activeElement === first || !dialog.contains(activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (activeElement === last || !dialog.contains(activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      backgroundElements.forEach(({ element, wasInert }) => { element.inert = wasInert })
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [dialogRef, initialFocusRef, onCloseRef, open, present])
}

function ModalLayer({
  active,
  children,
  className,
  onBackdropPointerDown,
}: {
  active: boolean
  children: React.ReactNode
  className: string
  onBackdropPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
}) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      className={`ov-layer ov-modal-layer ${className}`}
      data-state={active ? 'open' : 'closed'}
      onPointerDown={onBackdropPointerDown}
    >
      {children}
    </div>,
    document.body,
  )
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 20 20">
      <path d="M4.816 4.816c.26-.26.68-.26.94 0L10 9.059l4.244-4.243a.665.665 0 0 1 .94.94L10.94 10l4.244 4.245a.665.665 0 0 1-.94.94L10 10.94l-4.243 4.245a.666.666 0 0 1-.94-.941l4.242-4.245-4.243-4.243a.665.665 0 0 1 0-.94" />
    </svg>
  )
}

function BackIcon() {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 20 20">
      <path d="M12.884 14.529a.666.666 0 0 1-.942.942l-4.705-4.706a1.082 1.082 0 0 1 0-1.53l4.705-4.706a.666.666 0 0 1 .942.942L8.355 10z" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 20 20">
      <path d="M7.116 14.529a.666.666 0 0 0 .942.942l4.705-4.706c.422-.423.422-1.107 0-1.53L8.058 4.529a.666.666 0 0 0-.942.942L11.645 10z" />
    </svg>
  )
}

function ExpandIcon() {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 20 20">
      <path d="M14.529 7.116a.666.666 0 0 1 .942.942l-4.706 4.705a1.082 1.082 0 0 1-1.53 0L4.529 8.058a.666.666 0 0 1 .942-.942L10 11.645z" />
    </svg>
  )
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18">
      <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.797 2.716v2.259h2.909c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285f4" />
      <path d="M9 18c2.43 0 4.468-.806 5.956-2.18l-2.91-2.259c-.805.54-1.835.86-3.046.86-2.344 0-4.328-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18Z" fill="#34a853" />
      <path d="M3.963 10.707A5.41 5.41 0 0 1 3.682 9c0-.592.102-1.168.281-1.707V4.961H.956A9 9 0 0 0 0 9c0 1.453.348 2.828.956 4.039l3.007-2.332Z" fill="#fbbc05" />
      <path d="M9 3.58c1.322 0 2.508.454 3.441 1.345l2.581-2.58C13.464.89 11.426 0 9 0A9 9 0 0 0 .956 4.961l3.007 2.332C4.672 5.164 6.656 3.58 9 3.58Z" fill="#ea4335" />
    </svg>
  )
}

function AppleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.79 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.1ZM12.03 7.25C11.88 5.02 13.69 3.18 15.77 3c.29 2.58-2.34 4.5-3.74 4.25Z" fill="currentColor" />
    </svg>
  )
}

function PhoneIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path d="M6.11 2.94 7.7 6.02a1.25 1.25 0 0 1-.27 1.47l-1.1 1.02a11.18 11.18 0 0 0 5.16 5.16l1.02-1.1a1.25 1.25 0 0 1 1.47-.27l3.08 1.59a1.25 1.25 0 0 1 .66 1.3v.13a2.6 2.6 0 0 1-2.77 2.33C8.36 17.1 2.9 11.64 2.35 5.05A2.6 2.6 0 0 1 4.68 2.28h.13a1.25 1.25 0 0 1 1.3.66Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.35" />
    </svg>
  )
}

function SessionIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path d="M11.15 8.85a3.25 3.25 0 1 0-4.6 0 3.25 3.25 0 0 0 4.6 0Z" stroke="currentColor" strokeWidth="1.35" />
      <path d="m11.15 8.85 5.7 5.7m-1.9-1.9-1.65 1.65m-.25-3.55-1.65 1.65" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.35" />
    </svg>
  )
}

/** ChatGPT's shared logged-out authentication sheet. */
export function AuthDialog({
  open,
  onClose,
  intent = 'login_or_signup',
  onPhoneContinue,
  callbackPath = '/',
  description = '你将获得更加智能的回复并能上传文件、图片等内容。',
  emailPlaceholder = '电子邮件地址',
  variant = 'default',
  onNavigateAuth,
  onSessionLogin,
}: AuthDialogProps) {
  const { active, present } = usePresence(open, 180)
  const [view, setView] = useState<'providers' | 'phone'>('providers')
  const dialogRef = useRef<HTMLDivElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    // Every newly opened auth flow starts at its provider chooser.
    // eslint-disable-next-line react/set-state-in-effect
    if (open) setView('providers')
  }, [open])

  useEffect(() => {
    if (open && view === 'phone') phoneRef.current?.focus({ preventScroll: true })
  }, [open, view])

  useEffect(() => {
    if (!open || view !== 'providers' || hostedSessionOnly) return
    if (!window.matchMedia('(min-width: 768px)').matches) return
    const frame = window.requestAnimationFrame(() => emailRef.current?.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [open, view])

  useModalInteractions(open, present, dialogRef, emailRef, onClose)

  if (!present) return null

  const closeFromBackdrop = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && open) onClose()
  }

  const showPhone = () => {
    setView('phone')
    onPhoneContinue?.()
  }

  return (
    <ModalLayer
      active={active}
      className={`ov-auth-layer${variant === 'images' ? ' ov-auth-layer-images' : ''}`}
      onBackdropPointerDown={closeFromBackdrop}
    >
      <div
        ref={dialogRef}
        aria-describedby={descriptionId}
        aria-hidden={!open}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`ov-auth-dialog${variant === 'images' ? ' ov-auth-dialog-images' : ''}`}
        data-auth-intent={intent}
        id="mobile-auth-dialog"
        inert={!open}
        role="dialog"
        tabIndex={-1}
      >
        <button className="ov-icon-button ov-auth-close" onClick={onClose} type="button" aria-label="关闭">
          <CloseIcon />
        </button>

        {hostedSessionOnly ? (
          <div className="ov-auth-view" data-view="session-only">
            <h2 id={titleId}>使用 Session 登录</h2>
            <p className="ov-auth-subtitle" id={descriptionId}>
              托管版本会由同源后端验证 Session；浏览器只保存 HttpOnly 登录句柄，不保存上游 Cookie 或访问令牌。
            </p>
            <div className="ov-auth-actions">
              <button
                className="ov-button ov-primary-button ov-provider-button"
                data-auth-provider="session"
                onClick={onSessionLogin}
                type="button"
              >
                <span className="ov-provider-inner">
                  <span className="ov-provider-icon"><SessionIcon /></span>
                  <span>继续使用 Session 登录</span>
                </span>
              </button>
            </div>
          </div>
        ) : view === 'providers' ? (
          <div className="ov-auth-view" data-view="providers">
            <h2 id={titleId}>登录或注册</h2>
            <p className="ov-auth-subtitle" id={descriptionId}>
              {description}
            </p>

            <div className="ov-auth-actions">
              <a
                className="ov-button ov-secondary-button ov-provider-button"
                data-auth-provider="google"
                href={authFlowHref('google', callbackPath)}
                onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                  event.preventDefault()
                  onNavigateAuth?.('google')
                }}
              >
                <span className="ov-provider-inner">
                  <span className="ov-provider-icon"><GoogleIcon /></span>
                  <span>使用 Google 账户继续</span>
                </span>
              </a>
              <a
                className="ov-button ov-secondary-button ov-provider-button"
                data-auth-provider="apple"
                href={authFlowHref('apple', callbackPath)}
                onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                  event.preventDefault()
                  onNavigateAuth?.('apple')
                }}
              >
                <span className="ov-provider-inner">
                  <span className="ov-provider-icon"><AppleIcon /></span>
                  <span>使用 Apple 账户继续</span>
                </span>
              </a>
              <button
                className="ov-button ov-secondary-button ov-provider-button"
                data-auth-provider="phone"
                onClick={showPhone}
                type="button"
              >
                <span className="ov-provider-inner">
                  <span className="ov-provider-icon"><PhoneIcon /></span>
                  <span>使用电话号码继续</span>
                </span>
              </button>
              <button
                className="ov-button ov-secondary-button ov-provider-button"
                data-auth-provider="session"
                onClick={onSessionLogin}
                type="button"
              >
                <span className="ov-provider-inner">
                  <span className="ov-provider-icon"><SessionIcon /></span>
                  <span>使用 Session 登录</span>
                </span>
              </button>
            </div>

            <div aria-hidden="true" className="ov-auth-divider">
              <span />
              <span>或</span>
              <span />
            </div>

            <form action={authFlowHref('email', callbackPath)} className="ov-auth-form" method="get" onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              onNavigateAuth?.('email', String(form.get('login_hint') ?? ''))
            }}>
              <input name="callback_path" type="hidden" value={callbackPath} />
              <input name="screen_hint" type="hidden" value="login_or_signup" />
              <label className="ov-sr-only" htmlFor={`${titleId}-email`}>{emailPlaceholder}</label>
              <input
                ref={emailRef}
                autoCapitalize="none"
                autoComplete="email"
                className="ov-auth-input"
                dir="ltr"
                id={`${titleId}-email`}
                inputMode="email"
                name="login_hint"
                placeholder={emailPlaceholder}
                required
                spellCheck={false}
                type="email"
              />
              <button className="ov-button ov-primary-button ov-auth-continue" type="submit">继续</button>
            </form>
          </div>
        ) : (
          <div className="ov-auth-view ov-auth-phone-view" data-view="phone">
            <button
              aria-label="返回登录方式"
              className="ov-icon-button ov-auth-back"
              onClick={() => setView('providers')}
              type="button"
            >
              <BackIcon />
            </button>
            <h2 id={titleId}>使用电话号码继续</h2>
            <p className="ov-auth-subtitle" id={descriptionId}>输入可接收短信验证码的电话号码。</p>
            <form action={authFlowHref('phone', callbackPath)} className="ov-auth-form ov-phone-form" method="get" onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              onNavigateAuth?.('phone', String(form.get('login_hint') ?? ''))
            }}>
              <input name="callback_path" type="hidden" value={callbackPath} />
              <input name="screen_hint" type="hidden" value="login_or_signup" />
              <label className="ov-sr-only" htmlFor={`${titleId}-phone`}>电话号码</label>
              <input
                ref={phoneRef}
                autoComplete="tel"
                className="ov-auth-input"
                id={`${titleId}-phone`}
                inputMode="tel"
                name="login_hint"
                placeholder="电话号码（例如 +86 138 0000 0000）"
                required
                type="tel"
              />
              <button className="ov-button ov-primary-button ov-auth-continue" type="submit">继续</button>
            </form>
          </div>
        )}
      </div>
    </ModalLayer>
  )
}

function AppearanceIcon() {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 20 20">
      <path d="M9.997 16.002a.665.665 0 0 1 .665.665v1.667a.665.665 0 0 1-1.33 0v-1.667a.665.665 0 0 1 .665-.665ZM4.813 14.241a.665.665 0 0 1 .94.941l-1.178 1.178a.665.665 0 0 1-.941-.94zM14.247 14.241a.665.665 0 0 1 .94 0l1.18 1.179a.665.665 0 0 1-.941.94l-1.179-1.178a.665.665 0 0 1 0-.94Z" />
      <path clipRule="evenodd" d="M10.833 6.002a3.998 3.998 0 1 1 0 7.997 3.998 3.998 0 0 1 0-7.997Zm0 1.33a2.668 2.668 0 1 0 0 5.337 2.668 2.668 0 0 0 0-5.337Z" fillRule="evenodd" />
      <path d="M3.333 9.331a.665.665 0 1 1 0 1.33H1.667a.665.665 0 1 1 0-1.33zM18.333 9.331a.665.665 0 1 1 0 1.33h-1.667a.665.665 0 1 1 0-1.33zM3.64 3.634a.665.665 0 0 1 .94 0l1.18 1.178a.665.665 0 0 1-.941.942L3.64 4.575a.665.665 0 0 1 0-.941ZM15.42 3.635a.665.665 0 0 1 .94.94l-1.179 1.179a.665.665 0 0 1-.94-.94zM9.997 1.002a.665.665 0 0 1 .665.665v1.667a.665.665 0 0 1-1.33 0V1.667a.665.665 0 0 1 .665-.665Z" />
    </svg>
  )
}

function LanguageIcon() {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 20 20">
      <path clipRule="evenodd" d="M10 1.835a8.165 8.165 0 1 1 0 16.33 8.165 8.165 0 0 1 0-16.33Zm-2.654 8.83c.07 1.728.41 3.255.905 4.368.279.628.594 1.095.91 1.396.313.297.595.406.839.406s.527-.109.84-.406c.316-.301.631-.768.91-1.396.495-1.113.834-2.64.904-4.368zm-4.149 0a6.84 6.84 0 0 0 4.225 5.665 8 8 0 0 1-.387-.757c-.581-1.308-.95-3.025-1.02-4.908zm10.788 0c-.07 1.883-.439 3.6-1.02 4.908-.119.267-.249.52-.389.757a6.84 6.84 0 0 0 4.227-5.665zM7.422 3.669a6.84 6.84 0 0 0-4.225 5.666h2.818c.07-1.883.439-3.6 1.02-4.908.119-.267.247-.521.387-.758ZM10 3.165c-.244 0-.527.109-.84.406-.316.301-.63.768-.91 1.396-.494 1.113-.834 2.64-.904 4.368h5.308c-.07-1.728-.41-3.255-.904-4.368-.279-.628-.594-1.095-.91-1.396-.313-.297-.596-.406-.84-.406Zm2.576.504c.14.237.27.49.389.758.581 1.308.95 3.025 1.02 4.908h2.818a6.84 6.84 0 0 0-4.227-5.666Z" fillRule="evenodd" />
    </svg>
  )
}

function FullAppDataIcon() {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 20 20">
      <path d="M14 13.333a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5" />
      <path clipRule="evenodd" d="M14.626 10.195c.353.05.668.247.87.54l.09.153.253.507.567-.034c.482-.028.94.217 1.18.635l.448.774.08.162c.132.33.12.702-.033 1.022l-.088.156-.312.473.312.473.088.156c.152.32.165.692.032 1.022l-.079.162-.447.774c-.211.366-.588.6-1.001.633l-.18.002-.567-.035-.252.507c-.189.378-.55.635-.961.694l-.179.012h-.895c-.483 0-.923-.274-1.139-.705l-.255-.508-.564.035a1.27 1.27 0 0 1-1.18-.635v-.001l-.447-.773a1.28 1.28 0 0 1 .039-1.34l.312-.473-.311-.474-.001.001a1.28 1.28 0 0 1-.04-1.34l.448-.774c.241-.417.696-.663 1.179-.635l.566.034.254-.507.09-.154a1.27 1.27 0 0 1 1.049-.551h.895zM13.13 12.36a.65.65 0 0 1-.62.358l-.979-.059-.431.748.54.82a.65.65 0 0 1 0 .714l-.54.819.431.748.979-.059.096.001a.65.65 0 0 1 .524.357l.438.877h.863l.437-.876.05-.083a.65.65 0 0 1 .571-.276l.98.059.431-.746-.54-.82a.65.65 0 0 1 0-.716l.54-.82-.431-.747-.98.059a.65.65 0 0 1-.62-.359l-.438-.875h-.863z" fillRule="evenodd" />
      <path clipRule="evenodd" d="M10 1.835c1.666 0 3.204.24 4.349.65.569.203 1.078.46 1.456.78.375.316.694.76.694 1.318v3.75a.666.666 0 0 1-1.33 0V6.324c-.251.135-.528.254-.82.359-1.145.408-2.683.649-4.349.649s-3.203-.24-4.348-.65a6 6 0 0 1-.82-.358V10l.016.06a.5.5 0 0 0 .095.137c.112.123.305.267.6.415.516.26 1.254.483 2.15.628l.393.058.132.031a.666.666 0 0 1-.17 1.292l-.134-.004-.43-.062c-.987-.16-1.866-.416-2.538-.753q-.058-.03-.114-.063v3.678c0 .015.005.079.111.196.112.123.305.268.6.416.59.296 1.47.546 2.543.686a.666.666 0 0 1-.172 1.32c-1.162-.152-2.2-.432-2.968-.817-.383-.192-.728-.426-.986-.71-.262-.287-.458-.656-.458-1.091V4.583c0-.559.32-1.002.694-1.318.378-.32.887-.577 1.456-.78 1.145-.41 2.682-.65 4.348-.65m0 1.33c-1.555 0-2.934.226-3.9.571-.486.174-.833.365-1.045.544-.214.18-.223.286-.223.303 0 .016.008.121.223.303.212.179.559.371 1.045.545.966.345 2.345.57 3.9.57s2.935-.225 3.901-.57c.486-.174.833-.366 1.045-.545.215-.182.223-.287.223-.303s-.01-.122-.223-.303c-.212-.179-.559-.37-1.045-.544-.966-.345-2.346-.57-3.901-.571" fillRule="evenodd" />
    </svg>
  )
}

function LightweightDataIcon() {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 20 20">
      <path clipRule="evenodd" d="M7.917 11.085a3.166 3.166 0 0 1 3.095 2.5h5.655a.665.665 0 1 1 0 1.33h-5.655a3.166 3.166 0 0 1-6.19 0H3.333a.665.665 0 1 1 0-1.33h1.489a3.166 3.166 0 0 1 3.095-2.5Zm0 1.33a1.835 1.835 0 1 0 0 3.67 1.835 1.835 0 0 0 0-3.67ZM12.083 2.585a3.166 3.166 0 0 1 3.095 2.5h1.489a.665.665 0 1 1 0 1.33h-1.489a3.166 3.166 0 0 1-6.19 0H3.333a.665.665 0 1 1 0-1.33h5.655a3.166 3.166 0 0 1 3.095-2.5Zm0 1.33a1.835 1.835 0 1 0 0 3.67 1.835 1.835 0 0 0 0-3.67Z" fillRule="evenodd" />
    </svg>
  )
}

function GeneralIcon() {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 20 20">
      <path clipRule="evenodd" d="M10 6.587a3.417 3.417 0 1 1 0 6.834 3.417 3.417 0 0 1 0-6.834m0 1.33A2.087 2.087 0 1 0 10 12.091 2.087 2.087 0 0 0 10 7.917" fillRule="evenodd" />
      <path clipRule="evenodd" d="M10.746 1.49a1.7 1.7 0 0 1 1.474.851l.986 1.718a.37.37 0 0 0 .318.184h1.983a1.7 1.7 0 0 1 1.472.848l.736 1.277a1.7 1.7 0 0 1 .006 1.688l-1.105 1.945 1.105 1.944a1.7 1.7 0 0 1-.006 1.687l-.736 1.277a1.7 1.7 0 0 1-1.472.85h-1.983a.37.37 0 0 0-.318.182l-.987 1.718a1.7 1.7 0 0 1-1.473.851H9.253a1.7 1.7 0 0 1-1.472-.852l-.988-1.717a.37.37 0 0 0-.317-.183H4.493a1.7 1.7 0 0 1-1.472-.85l-.736-1.275a1.7 1.7 0 0 1-.006-1.688L3.385 10 2.279 8.056a1.7 1.7 0 0 1 .006-1.688l.737-1.277a1.7 1.7 0 0 1 1.471-.85l1.983.002c.131 0 .253-.07.318-.184l.987-1.718a1.7 1.7 0 0 1 1.473-.851zM9.254 2.82a.37.37 0 0 0-.32.184l-.988 1.72c-.303.526-.864.849-1.47.849H4.493a.37.37 0 0 0-.32.183l-.736 1.277a.37.37 0 0 0-.002.366l1.291 2.27q.064.116.082.245l.005.087a.7.7 0 0 1-.087.33l-1.29 2.271a.37.37 0 0 0 .001.366l.737 1.276a.37.37 0 0 0 .32.184h1.982c.606 0 1.167.323 1.47.85l.989 1.719a.37.37 0 0 0 .319.184h1.492a.37.37 0 0 0 .32-.184l.988-1.72c.303-.526.864-.849 1.47-.849h1.983a.37.37 0 0 0 .32-.184l.735-1.276a.37.37 0 0 0 .002-.367l-1.29-2.27a.67.67 0 0 1 0-.66l1.29-2.272a.37.37 0 0 0 0-.366l-.738-1.277a.37.37 0 0 0-.32-.183h-1.982a1.7 1.7 0 0 1-1.47-.85c-.322-.558-.72-1.253-.988-1.719a.37.37 0 0 0-.319-.184z" fillRule="evenodd" />
    </svg>
  )
}

const LANGUAGE_OPTIONS = [
  ['auto', '自动检测'],
  ['zh-CN', '简体中文'],
  ['am', 'አማርኛ'],
  ['ar', 'العربية'],
  ['bg-BG', 'български'],
  ['bn-BD', 'বাংলা'],
  ['bs-BA', 'bosanski'],
  ['ca-ES', 'català'],
  ['cs-CZ', 'čeština'],
  ['da-DK', 'dansk'],
  ['de-DE', 'Deutsch'],
  ['el-GR', 'Ελληνικά'],
  ['en-US', 'English (US)'],
  ['es-419', 'español (Latinoamérica)'],
  ['es-ES', 'español (España)'],
  ['et-EE', 'eesti'],
  ['fa', 'فارسی'],
  ['fi-FI', 'suomi'],
  ['fr-CA', 'français (Canada)'],
  ['fr-FR', 'français (France)'],
  ['gu-IN', 'ગુજરાતી'],
  ['hi-IN', 'हिन्दी'],
  ['hr-HR', 'hrvatski'],
  ['hu-HU', 'magyar'],
  ['hy-AM', 'հայերեն'],
  ['id-ID', 'Indonesia'],
  ['is-IS', 'íslenska'],
  ['it-IT', 'italiano'],
  ['ja-JP', '日本語'],
  ['ka-GE', 'ქართული'],
  ['kk', 'қазақ тілі'],
  ['kn-IN', 'ಕನ್ನಡ'],
  ['ko-KR', '한국어'],
  ['lt', 'lietuvių'],
  ['lv-LV', 'latviešu'],
  ['mk-MK', 'македонски'],
  ['ml', 'മലയാളം'],
  ['mn', 'монгол'],
  ['mr-IN', 'मराठी'],
  ['ms-MY', 'Bahasa Melayu'],
  ['my-MM', 'မြန်မာ'],
  ['nb-NO', 'norsk bokmål'],
  ['nl-NL', 'Nederlands'],
  ['pa', 'ਪੰਜਾਬੀ'],
  ['pl-PL', 'polski'],
  ['pt-BR', 'português (Brasil)'],
  ['pt-PT', 'português (Portugal)'],
  ['ro-RO', 'română'],
  ['ru-RU', 'русский'],
  ['sk-SK', 'slovenčina'],
  ['sl-SI', 'slovenščina'],
  ['so-SO', 'Soomaali'],
  ['sq-AL', 'shqip'],
  ['sr-RS', 'српски'],
  ['sv-SE', 'svenska'],
  ['sw-TZ', 'Kiswahili'],
  ['ta-IN', 'தமிழ்'],
  ['te-IN', 'తెలుగు'],
  ['th-TH', 'ไทย'],
  ['tl', 'Tagalog'],
  ['tr-TR', 'Türkçe'],
  ['uk-UA', 'українська'],
  ['ur', 'اردو'],
  ['vi-VN', 'Tiếng Việt'],
  ['zh-HK', '繁體中文（香港）'],
  ['zh-TW', '繁體中文（台灣）'],
] as const

const THEME_OPTIONS = [
  ['system', '系统'],
  ['dark', '深色'],
  ['light', '浅色'],
] as const

type SelectOption = readonly [string, string]

const LIGHTWEIGHT_LANGUAGE_OPTIONS: readonly SelectOption[] = [
  LANGUAGE_OPTIONS[0],
  ...LANGUAGE_OPTIONS.slice(2, -2),
  LANGUAGE_OPTIONS[1],
  ...LANGUAGE_OPTIONS.slice(-2),
]

function SettingsSelect({
  ariaLabel,
  value,
  options,
  onChange,
  dialogOpen,
  className = '',
}: {
  ariaLabel: string
  value: string
  options: readonly SelectOption[]
  onChange: (value: string) => void
  dialogOpen: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 320 })
  const { active, present } = usePresence(open, 120)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()
  const selectedIndex = Math.max(0, options.findIndex(([optionValue]) => optionValue === value))
  const selectedLabel = options[selectedIndex]?.[1] ?? options[0]?.[1] ?? ''

  const updatePosition = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = 220
    const naturalHeight = options.length * 36 + 12
    const isLongMenu = options.length > 8
    const below = rect.bottom + 4
    const shortHeight = Math.min(naturalHeight, window.innerHeight - 20)
    const top = isLongMenu
      ? Math.max(8, rect.top - 6)
      : below + shortHeight <= window.innerHeight - 8
        ? below
        : Math.max(8, rect.top - shortHeight - 4)
    setPosition({
      left: Math.min(window.innerWidth - width - 8, Math.max(8, rect.right - width)),
      top,
      maxHeight: isLongMenu
        ? Math.max(120, window.innerHeight - top - 10)
        : shortHeight,
    })
  }

  const openMenu = (index = selectedIndex) => {
    setActiveIndex(index)
    setOpen(true)
  }

  const closeMenu = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) window.requestAnimationFrame(() => buttonRef.current?.focus())
  }

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
    window.addEventListener('resize', updatePosition)
    document.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      document.removeEventListener('scroll', updatePosition, true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, options.length])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return
      const dialog = buttonRef.current?.closest('[role="dialog"]')
      const clickedFocusable = target instanceof Element && target.closest(FOCUSABLE_SELECTOR)
      closeMenu(Boolean(dialog?.contains(target) && !clickedFocusable))
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  useEffect(() => {
    if (!active) return
    menuRef.current?.focus()
    document.getElementById(`${listboxId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, activeIndex, listboxId])

  const choose = (index: number) => {
    const option = options[index]
    if (!option) return
    onChange(option[0])
    closeMenu(true)
  }

  const handleButtonKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const delta = event.key === 'ArrowDown' ? 1 : -1
      openMenu((selectedIndex + delta + options.length) % options.length)
    }
  }

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
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
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      choose(activeIndex)
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      event.stopPropagation()
      const dialog = buttonRef.current?.closest<HTMLElement>('[role="dialog"]')
      const focusable = dialog
        ? Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => (
            !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true' && element.tabIndex >= 0
          ))
        : []
      const buttonIndex = buttonRef.current ? focusable.indexOf(buttonRef.current) : -1
      const nextIndex = event.shiftKey ? buttonIndex - 1 : buttonIndex + 1
      const nextTarget = focusable[(nextIndex + focusable.length) % focusable.length]
      closeMenu()
      window.requestAnimationFrame(() => nextTarget?.focus())
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        aria-controls={dialogOpen && open ? listboxId : undefined}
        aria-expanded={dialogOpen && open}
        aria-haspopup="listbox"
        aria-label={`${ariaLabel}，${selectedLabel}`}
        className={`ov-images-settings-select ${className}`}
        onClick={() => open ? closeMenu() : openMenu()}
        onKeyDown={handleButtonKeyDown}
        type="button"
      >
        <span>{selectedLabel}</span>
        <svg aria-hidden="true" fill="currentColor" viewBox="0 0 16 16"><path d="M12.629 5.879a.525.525 0 1 1 .742.742l-4.765 4.765a.86.86 0 0 1-1.212 0L2.629 6.62a.525.525 0 1 1 .742-.742L8 10.508z" /></svg>
      </button>
      {dialogOpen && present && createPortal(
        <div
          ref={menuRef}
          aria-activedescendant={`${listboxId}-${activeIndex}`}
          aria-label={ariaLabel}
          className="ov-images-settings-menu ov-layer"
          data-state={active ? 'open' : 'closed'}
          id={listboxId}
          onKeyDown={handleMenuKeyDown}
          role="listbox"
          style={position}
          tabIndex={-1}
        >
          {options.map(([optionValue, optionLabel], index) => (
            <button
              aria-selected={optionValue === value}
              className={`ov-images-settings-option${optionValue === value ? ' is-selected' : ''}${index === activeIndex ? ' is-active' : ''}`}
              id={`${listboxId}-${index}`}
              key={optionValue}
              onClick={() => choose(index)}
              onMouseEnter={() => setActiveIndex(index)}
              role="option"
              tabIndex={-1}
              type="button"
            >
              <span>{optionLabel}</span>
              {optionValue === value ? <svg aria-hidden="true" fill="currentColor" viewBox="0 0 16 16"><path d="M12.722 2.997a.524.524 0 0 1 .864.595L7.2 12.847a.625.625 0 0 1-.956.09L2.46 9.18a.525.525 0 0 1 .74-.745l3.423 3.397z" /></svg> : null}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}

/** Logged-out settings, including the nested data-controls pane. */
export function SettingsDialog({
  open,
  onClose,
  theme,
  onThemeChange,
  language,
  onLanguageChange,
  dataControls,
  onDataControlsChange,
  onNavigateDataUsage,
  variant = 'default',
}: SettingsDialogProps) {
  const { active, present } = usePresence(open, 180)
  const [pane, setPane] = useState<'main' | 'data'>('main')
  const [internalLanguage, setInternalLanguage] = useState('auto')
  const [internalDataControls, setInternalDataControls] = useState(readStoredDataControls)
  const [personalizedAds, setPersonalizedAds] = useState(() => localStorage.getItem(PERSONALIZED_ADS_STORAGE_KEY) !== 'false')
  const [saveStatus, setSaveStatus] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const leadingButtonRef = useRef<HTMLButtonElement>(null)
  const dataBackButtonRef = useRef<HTMLButtonElement>(null)
  const generalTabRef = useRef<HTMLButtonElement>(null)
  const dataTabRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const selectedLanguage = language ?? internalLanguage
  const selectedDataControls = dataControls ?? internalDataControls

  useEffect(() => {
    // Reopening settings always returns to the top-level pane.
    // eslint-disable-next-line react/set-state-in-effect
    if (open) setPane('main')
  }, [open])

  useEffect(() => {
    if (!saveStatus) return
    const timeout = window.setTimeout(() => setSaveStatus(''), 1200)
    return () => window.clearTimeout(timeout)
  }, [saveStatus])

  useEffect(() => {
    if (!open || variant !== 'default') return
    const frame = window.requestAnimationFrame(() => {
      const target = pane === 'data' ? dataBackButtonRef.current : leadingButtonRef.current
      target?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open, pane, variant])

  useModalInteractions(open, present, dialogRef, variant === 'images' ? dialogRef : leadingButtonRef, onClose)

  if (!present) return null

  const closeFromBackdrop = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && open) onClose()
  }

  const updateLanguage = (nextLanguage: string) => {
    if (language === undefined) setInternalLanguage(nextLanguage)
    onLanguageChange?.(nextLanguage)
  }

  const updateDataControl = (key: keyof DataControlPreferences, checked: boolean) => {
    const next = { ...selectedDataControls, [key]: checked }
    if (dataControls === undefined) {
      setInternalDataControls(next)
      localStorage.setItem(DATA_CONTROLS_STORAGE_KEY, JSON.stringify(next))
    }
    onDataControlsChange?.(next)
    setSaveStatus('已保存')
  }

  const isDataPane = pane === 'data'
  const selectedThemeLabel = THEME_OPTIONS.find(([optionValue]) => optionValue === theme)?.[1] ?? '系统'
  const selectedLanguageLabel = LANGUAGE_OPTIONS.find(([optionValue]) => optionValue === selectedLanguage)?.[1] ?? '自动检测'

  const handleFullAppTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    let nextPane: 'main' | 'data' | null = null
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'Home') nextPane = 'main'
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'End') nextPane = 'data'
    if (!nextPane) return
    event.preventDefault()
    setPane(nextPane)
    const target = nextPane === 'main' ? generalTabRef.current : dataTabRef.current
    window.requestAnimationFrame(() => target?.focus())
  }

  if (variant === 'images') {
    return (
      <ModalLayer
        active={active}
        className="ov-settings-layer ov-settings-layer-images"
        onBackdropPointerDown={closeFromBackdrop}
      >
        <div
          ref={dialogRef}
          aria-hidden={!open}
          aria-labelledby={titleId}
          aria-modal="true"
          className="ov-settings-dialog ov-settings-dialog-images"
          data-pane={pane}
          id="mobile-settings-dialog"
          inert={!open}
          role="dialog"
          tabIndex={-1}
        >
          <header className="ov-images-settings-header">
            <h2>设置</h2>
            <button ref={leadingButtonRef} aria-label="关闭" className="ov-icon-button ov-images-settings-close" onClick={onClose} type="button">
              <CloseIcon />
            </button>
          </header>
          <aside className="ov-images-settings-nav" aria-label="设置类别" role="tablist">
            <button ref={generalTabRef} aria-controls={`${titleId}-full-app-panel`} aria-selected={!isDataPane} className={`ov-images-settings-tab${!isDataPane ? ' is-active' : ''}`} id={`${titleId}-general-tab`} onClick={() => setPane('main')} onKeyDown={handleFullAppTabKeyDown} role="tab" tabIndex={!isDataPane ? 0 : -1} type="button">
              <GeneralIcon /><span>常规</span>
            </button>
            <button ref={dataTabRef} aria-controls={`${titleId}-full-app-panel`} aria-selected={isDataPane} className={`ov-images-settings-tab${isDataPane ? ' is-active' : ''}`} id={`${titleId}-data-tab`} onClick={() => setPane('data')} onKeyDown={handleFullAppTabKeyDown} role="tab" tabIndex={isDataPane ? 0 : -1} type="button">
              <FullAppDataIcon /><span>数据管理</span>
            </button>
          </aside>

          <section aria-labelledby={isDataPane ? `${titleId}-data-tab` : `${titleId}-general-tab`} className="ov-images-settings-content" id={`${titleId}-full-app-panel`} role="tabpanel">
            <h2 id={titleId}>{isDataPane ? '数据管理' : '常规'}</h2>
            {!isDataPane ? (
              <div className="ov-images-settings-general">
                <div className="ov-images-settings-row">
                  <span>外观</span>
                  <SettingsSelect ariaLabel="外观" className="is-theme" dialogOpen={open} onChange={(next) => onThemeChange(next as ThemePreference)} options={THEME_OPTIONS} value={theme} />
                </div>
                <div className="ov-images-settings-row">
                  <span>语言</span>
                  <SettingsSelect ariaLabel="语言" className="is-language" dialogOpen={open} onChange={updateLanguage} options={LANGUAGE_OPTIONS} value={selectedLanguage} />
                </div>
              </div>
            ) : (
              <div className="ov-images-data-pane">
                <div className="ov-images-switch-group">
                  <label className="ov-switch-row"><span>为所有用户改进模型</span><input aria-checked={selectedDataControls.improveModel} checked={selectedDataControls.improveModel} onChange={(event) => updateDataControl('improveModel', event.currentTarget.checked)} role="switch" type="checkbox" /></label>
                  <p className="ov-switch-description">允许我们将你的内容用于训练我们的模型，这样可以优化你和其他用户的 ChatGPT 使用体验。我们将采取措施保护你的隐私。<a href="/help/data-usage" onClick={(event) => { if (!onNavigateDataUsage) return; event.preventDefault(); onClose(); onNavigateDataUsage() }}>了解更多</a></p>
                </div>
                <div className="ov-images-switch-group">
                  <label className="ov-switch-row"><span>营销衡量</span><input aria-checked={selectedDataControls.marketingMeasurement} checked={selectedDataControls.marketingMeasurement} onChange={(event) => updateDataControl('marketingMeasurement', event.currentTarget.checked)} role="switch" type="checkbox" /></label>
                  <p className="ov-switch-description">这些 Cookie 可帮助我们衡量营销活动效果。</p>
                </div>
                <div className="ov-images-switch-group">
                  <label className="ov-switch-row"><span>个性化营销</span><input aria-checked={selectedDataControls.personalizedMarketing} checked={selectedDataControls.personalizedMarketing} onChange={(event) => updateDataControl('personalizedMarketing', event.currentTarget.checked)} role="switch" type="checkbox" /></label>
                  <p className="ov-switch-description">这有助于我们在第三方平台上个性化投放 OpenAI 自有营销内容，并衡量其效果。</p>
                </div>
                <h3>广告控制</h3>
                <div className="ov-images-switch-group">
                  <label className="ov-switch-row"><span>个性化广告</span><input aria-checked={personalizedAds} checked={personalizedAds} onChange={(event) => { const checked = event.currentTarget.checked; setPersonalizedAds(checked); localStorage.setItem(PERSONALIZED_ADS_STORAGE_KEY, String(checked)); setSaveStatus('已保存') }} role="switch" type="checkbox" /></label>
                  <p className="ov-switch-description">允许 ChatGPT 使用你过去的聊天、活动和偏好来选择广告。广告仍可能会根据你当前的聊天投放。</p>
                </div>
                <p aria-live="polite" className="ov-sr-only" role="status">{saveStatus}</p>
              </div>
            )}
          </section>
        </div>
      </ModalLayer>
    )
  }

  return (
    <ModalLayer
      active={active}
      className="ov-settings-layer"
      onBackdropPointerDown={closeFromBackdrop}
    >
      <div
        ref={dialogRef}
        aria-hidden={!open}
        aria-labelledby={isDataPane ? `${titleId}-data-title` : titleId}
        aria-modal="true"
        className="ov-settings-dialog"
        data-pane={pane}
        id="mobile-settings-dialog"
        inert={!open}
        role="dialog"
        tabIndex={-1}
      >
        <div className="ov-settings-swipe-viewport">
          <div className="ov-settings-swipe-track" data-pane={pane}>
            <main aria-hidden={isDataPane} className="ov-settings-screen" inert={isDataPane}>
              <header className="ov-settings-header">
                <button
                  ref={leadingButtonRef}
                  aria-label="返回 ChatGPT"
                  className="ov-icon-button ov-settings-leading"
                  onClick={onClose}
                  type="button"
                >
                  <BackIcon />
                </button>
                <h2 id={titleId}>设置</h2>
              </header>

              <div className="ov-settings-body">
                <div className="ov-settings-main-pane">
                  <section aria-label="常规" className="ov-settings-row-group">
                    <label className="ov-settings-row">
                      <span className="ov-settings-row-icon"><AppearanceIcon /></span>
                      <span className="ov-settings-copy">
                        <span className="ov-settings-label">外观</span>
                        <span className="ov-settings-hint">{selectedThemeLabel}</span>
                      </span>
                      <span className="ov-settings-expand"><ExpandIcon /></span>
                      <select
                        aria-label="外观"
                        className="ov-settings-select"
                        onChange={(event) => onThemeChange(event.currentTarget.value as ThemePreference)}
                        value={theme}
                      >
                        <option value="system">系统</option>
                        <option value="dark">深色</option>
                        <option value="light">浅色</option>
                      </select>
                    </label>
                    <label className="ov-settings-row">
                      <span className="ov-settings-row-icon"><LanguageIcon /></span>
                      <span className="ov-settings-copy">
                        <span className="ov-settings-label">语言</span>
                        <span className="ov-settings-hint">{selectedLanguageLabel}</span>
                      </span>
                      <span className="ov-settings-expand"><ExpandIcon /></span>
                      <select
                        aria-label="语言"
                        className="ov-settings-select"
                        onChange={(event) => updateLanguage(event.currentTarget.value)}
                        value={selectedLanguage}
                      >
                        {LIGHTWEIGHT_LANGUAGE_OPTIONS.map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                  </section>

                  <button
                    aria-controls={`${titleId}-data-controls`}
                    className="ov-settings-row ov-settings-detail-trigger"
                    onClick={() => setPane('data')}
                    type="button"
                  >
                    <span className="ov-settings-row-icon"><LightweightDataIcon /></span>
                    <span className="ov-settings-copy">
                      <span className="ov-settings-label">数据管理</span>
                    </span>
                    <span className="ov-settings-chevron"><ChevronIcon /></span>
                  </button>
                </div>
              </div>
            </main>

            <section
              aria-hidden={!isDataPane}
              aria-labelledby={`${titleId}-data-title`}
              className="ov-settings-screen"
              id={`${titleId}-data-controls`}
              inert={!isDataPane}
            >
              <header className="ov-settings-header">
                <button
                  ref={dataBackButtonRef}
                  aria-label="返回设置"
                  className="ov-icon-button ov-settings-leading"
                  onClick={() => setPane('main')}
                  type="button"
                >
                  <BackIcon />
                </button>
                <h2 id={`${titleId}-data-title`}>数据管理</h2>
              </header>

              <div className="ov-settings-body">
                <div className="ov-data-pane">
                  <div className="ov-switch-group">
                    <label className="ov-switch-row">
                      <span>为所有用户改进模型</span>
                      <input
                        aria-checked={selectedDataControls.improveModel}
                        checked={selectedDataControls.improveModel}
                        onChange={(event) => updateDataControl('improveModel', event.currentTarget.checked)}
                        role="switch"
                        type="checkbox"
                      />
                    </label>
                    <p className="ov-switch-description">
                      允许我们将你的内容用于训练我们的模型，这样可以优化你和其他用户的 ChatGPT 使用体验。我们将采取措施保护你的隐私。
                      <a href="/help/data-usage" onClick={(event) => { if (!onNavigateDataUsage) return; event.preventDefault(); onClose(); onNavigateDataUsage() }}>了解更多</a>
                    </p>
                  </div>

                  <div className="ov-switch-group">
                    <label className="ov-switch-row">
                      <span>营销衡量</span>
                      <input
                        aria-checked={selectedDataControls.marketingMeasurement}
                        checked={selectedDataControls.marketingMeasurement}
                        onChange={(event) => updateDataControl('marketingMeasurement', event.currentTarget.checked)}
                        role="switch"
                        type="checkbox"
                      />
                    </label>
                    <p className="ov-switch-description">这些 Cookie 可帮助我们衡量营销活动效果。</p>
                  </div>

                  <div className="ov-switch-group">
                    <label className="ov-switch-row">
                      <span>个性化营销</span>
                      <input
                        aria-checked={selectedDataControls.personalizedMarketing}
                        checked={selectedDataControls.personalizedMarketing}
                        onChange={(event) => updateDataControl('personalizedMarketing', event.currentTarget.checked)}
                        role="switch"
                        type="checkbox"
                      />
                    </label>
                    <p className="ov-switch-description">
                      这有助于我们在第三方平台上个性化投放 OpenAI 自有营销内容，并衡量其效果。
                    </p>
                  </div>
                  <p aria-live="polite" className="ov-sr-only" role="status">{saveStatus}</p>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </ModalLayer>
  )
}

/** Header product popover. It positions itself from anchorRef when supplied. */
export function ProductCard({
  open,
  onClose,
  onLogin,
  onSignup,
  anchorRef,
  placement = 'anchor',
}: ProductCardProps) {
  const { active, present } = usePresence(open, 120)
  const cardRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useLatest(onClose)
  const titleId = useId()
  const [position, setPosition] = useState({ left: 16, top: 56, positioned: !anchorRef })

  useLayoutEffect(() => {
    if (!open || !present) return

    const updatePosition = () => {
      if (placement === 'images') {
        const cardWidth = Math.min(320, window.innerWidth - 16)
        setPosition({
          left: Math.min(56, Math.max(8, window.innerWidth - cardWidth - 8)),
          top: 44,
          positioned: true,
        })
        return
      }

      const anchor = anchorRef?.current
      if (!anchor) {
        setPosition({ left: 16, top: 56, positioned: true })
        return
      }

      const rect = anchor.getBoundingClientRect()
      const cardWidth = Math.min(320, window.innerWidth - 16)
      const cardHeight = cardRef.current?.offsetHeight || 350
      const left = Math.min(
        Math.max(8, rect.left),
        Math.max(8, window.innerWidth - cardWidth - 8),
      )
      let top = rect.bottom + 8
      if (top + cardHeight > window.innerHeight - 8 && rect.top - cardHeight - 8 >= 8) {
        top = rect.top - cardHeight - 8
      }
      setPosition({ left, top: Math.max(8, top), positioned: true })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    document.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      document.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchorRef, open, placement, present])

  useEffect(() => {
    if (!open || !present) return

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (cardRef.current?.contains(target) || anchorRef?.current?.contains(target)) return
      onCloseRef.current()
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onCloseRef.current()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [anchorRef, onCloseRef, open, present])

  if (!present || typeof document === 'undefined') return null

  const chooseAction = (action: () => void) => {
    onClose()
    action()
  }

  return createPortal(
    <div
      ref={cardRef}
      aria-hidden={!open}
      aria-labelledby={titleId}
      className="ov-layer ov-product-card"
      data-positioned={position.positioned ? '' : undefined}
      data-state={active ? 'open' : 'closed'}
      id="desktop-chatgpt-product-card-popover"
      inert={!open}
      role="dialog"
      style={{ left: position.left, top: position.top }}
    >
      <div aria-hidden="true" className="ov-product-hero" />
      <div className="ov-product-content">
        <h2 id={titleId}>免费试用高级功能</h2>
        <p>登录以获取更加智能的回复、上传文件、创建图片，并获享更多功能。</p>
        <div className="ov-product-actions">
          <button
            className="ov-button ov-primary-button ov-product-action"
            onClick={() => chooseAction(onLogin)}
            type="button"
          >
            登录
          </button>
          <button
            className="ov-button ov-secondary-button ov-product-action"
            onClick={() => chooseAction(onSignup)}
            type="button"
          >
            免费注册
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
