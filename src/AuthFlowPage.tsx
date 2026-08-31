import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from 'react'
import {
  AuthFlowError,
  authFlowErrorMessage,
  cancelAuthLogin,
  completeAuthLogin,
  startAuthLogin,
  type AuthLoginProvider,
  type StartedAuthLogin,
} from './lib/authFlow'
import { hostedSessionOnly } from './lib/deploymentMode'
import {
  authSessionErrorMessage,
  getAuthSession,
  type AuthSessionSnapshot,
} from './lib/authSession'
import './AuthFlowPage.css'

type RestorableFlow = {
  flowId: string
  provider: AuthLoginProvider
  callbackPath: string
  expiresAt: number
  pollAfterMs: number
}

type ActiveFlow = RestorableFlow & {
  authorizationUrl?: string
}

type FlowPhase = 'idle' | 'starting' | 'pending' | 'authenticated' | 'error'

const FLOW_STORAGE_KEY = 'replica-auth-flow-v1'
const PROVIDERS = new Set<AuthLoginProvider>(['google', 'apple', 'phone', 'email'])

function ChatGPTMark() {
  return <svg aria-label="ChatGPT" role="img" viewBox="0 0 20 20"><use href="/chatgpt-icons.svg#chatgpt-mark" /></svg>
}

function providerFromPath(pathname: string): AuthLoginProvider {
  const value = pathname.split('/').filter(Boolean)[1]
  return PROVIDERS.has(value as AuthLoginProvider) ? value as AuthLoginProvider : 'email'
}

function safeCallback(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/'
  if (
    value === '/'
    || value === '/images'
    || value === '/pricing'
    || value === '/help'
    || value === '/terms'
    || value === '/privacy'
    || value.startsWith('/plugins')
    || value.startsWith('/help/')
    || value.startsWith('/openai')
  ) return value.slice(0, 2_048)
  return '/'
}

function providerName(provider: AuthLoginProvider) {
  if (provider === 'google') return 'Google'
  if (provider === 'apple') return 'Apple'
  if (provider === 'phone') return '电话号码'
  return '电子邮件'
}

function normalizedPhoneHint(value: string) {
  const normalized = value.trim().replace(/[ ()-]/g, '')
  return /^\+[1-9][0-9]{7,14}$/.test(normalized) ? normalized : ''
}

function readRestorableFlow(provider: AuthLoginProvider): RestorableFlow | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(FLOW_STORAGE_KEY) || 'null') as Partial<RestorableFlow> | null
    if (
      !value
      || value.provider !== provider
      || typeof value.flowId !== 'string'
      || typeof value.callbackPath !== 'string'
      || typeof value.expiresAt !== 'number'
      || typeof value.pollAfterMs !== 'number'
      || value.expiresAt <= Date.now()
    ) {
      sessionStorage.removeItem(FLOW_STORAGE_KEY)
      return null
    }
    return {
      flowId: value.flowId,
      provider,
      callbackPath: safeCallback(value.callbackPath),
      expiresAt: value.expiresAt,
      pollAfterMs: Math.min(10_000, Math.max(500, value.pollAfterMs)),
    }
  } catch {
    sessionStorage.removeItem(FLOW_STORAGE_KEY)
    return null
  }
}

function rememberFlow(flow: RestorableFlow) {
  try {
    // The authorization URL contains transient OAuth state and intentionally
    // stays in memory. Only the opaque local flow handle survives a reload.
    sessionStorage.setItem(FLOW_STORAGE_KEY, JSON.stringify(flow))
  } catch {
    // Login can continue without reload recovery if storage is unavailable.
  }
}

function forgetFlow(flowId?: string) {
  try {
    if (!flowId) {
      sessionStorage.removeItem(FLOW_STORAGE_KEY)
      return
    }
    const value = JSON.parse(sessionStorage.getItem(FLOW_STORAGE_KEY) || 'null') as Partial<RestorableFlow> | null
    if (value?.flowId === flowId) sessionStorage.removeItem(FLOW_STORAGE_KEY)
  } catch {
    sessionStorage.removeItem(FLOW_STORAGE_KEY)
  }
}

function popupFeatures() {
  const width = 520
  const height = 720
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2))
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2))
  return `popup=yes,width=${width},height=${height},left=${left},top=${top}`
}

function ProviderGlyph({ provider }: { provider: AuthLoginProvider }) {
  return <span aria-hidden="true">{provider === 'google' ? 'G' : provider === 'apple' ? '●' : provider === 'phone' ? '⌕' : '@'}</span>
}

export type AuthCallbackMarker = 'processing' | 'success' | 'error'

export function AuthCallbackProcessingPage({ marker }: { marker: AuthCallbackMarker }) {
  const failed = marker === 'error'
  return <main className="auth-flow-page auth-callback-page">
    <section className="auth-flow-card auth-callback-card" aria-labelledby="auth-callback-title">
      <ChatGPTMark />
      <div className={failed ? 'auth-callback-state is-error' : 'auth-callback-state'} aria-hidden="true">{failed ? '!' : '✓'}</div>
      <h1 id="auth-callback-title">{failed ? '授权未完成' : marker === 'success' ? '授权已完成' : '正在完成登录'}</h1>
      <p>{failed ? '请关闭此窗口，并在原页面重新发起登录。' : '授权结果已安全返回。原页面正在验证账号并加载对应工作区。'}</p>
      <button type="button" onClick={() => window.close()}>关闭窗口</button>
    </section>
  </main>
}

export default function AuthFlowPage({ locationHref, onNavigate, onAuthenticated, onSessionLogin }: {
  locationHref: string
  onNavigate: (path: string) => void
  onAuthenticated: (snapshot: AuthSessionSnapshot, callbackPath: string) => void
  onSessionLogin: () => void
}) {
  const url = useMemo(() => new URL(locationHref, window.location.origin), [locationHref])
  const provider = providerFromPath(url.pathname)
  const callbackPath = safeCallback(url.searchParams.get('callback_path'))
  const loginHint = (url.searchParams.get('login_hint') ?? '').trim().slice(0, 320)
  const teamSignupLanding = url.pathname.replace(/\/+$/, '') === '/auth/team-sign-up'
  const isTeamSignup = teamSignupLanding || url.searchParams.get('flow') === 'team-sign-up'
  const restoredFlow = useMemo(() => readRestorableFlow(provider), [provider])
  const [email, setEmail] = useState('')
  const [identifier, setIdentifier] = useState(loginHint)
  const [activeFlow, setActiveFlow] = useState<ActiveFlow | null>(restoredFlow)
  const [phase, setPhase] = useState<FlowPhase>(restoredFlow ? 'pending' : 'idle')
  const [error, setError] = useState('')
  const popupRef = useRef<Window | null>(null)
  const [popupName] = useState(() => `replica-openai-login-${crypto.randomUUID()}`)
  const startAbortRef = useRef<AbortController | null>(null)
  const genericLanding = (provider === 'email' && !loginHint && !activeFlow) || teamSignupLanding
  const name = providerName(provider)

  const go = (path: string, event?: MouseEvent<HTMLAnchorElement>) => {
    if (event && (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return
    event?.preventDefault()
    onNavigate(path)
  }

  const providerPath = (nextProvider: AuthLoginProvider, nextLoginHint = '') => {
    const params = new URLSearchParams({ callback_path: callbackPath, screen_hint: isTeamSignup ? 'signup' : 'login_or_signup' })
    if (isTeamSignup) params.set('flow', 'team-sign-up')
    if (nextLoginHint) params.set('login_hint', nextLoginHint)
    return `/auth/${nextProvider}?${params.toString()}`
  }

  const closePopup = useCallback(() => {
    try {
      if (popupRef.current && !popupRef.current.closed) popupRef.current.close()
    } catch {
      // Cross-origin popup access may be restricted after navigation.
    }
    popupRef.current = null
  }, [])

  const openOfficialLogin = useCallback((flow: Pick<StartedAuthLogin, 'authorizationUrl'>) => {
    let popup = popupRef.current
    try {
      if (!popup || popup.closed) popup = window.open('about:blank', popupName, popupFeatures())
      if (!popup) return false
      popupRef.current = popup
      popup.location.replace(flow.authorizationUrl)
      popup.focus()
      return true
    } catch {
      return false
    }
  }, [popupName])

  const start = useCallback(async () => {
    if (phase === 'starting') return
    const normalizedIdentifier = provider === 'phone'
      ? normalizedPhoneHint(identifier)
      : identifier.trim()
    if (provider === 'phone' && !normalizedIdentifier) {
      setError('请输入有效的国际电话号码，例如 +86 138 0013 8000。')
      setPhase('error')
      return
    }
    setPhase('starting')
    setError('')

    // Create the window synchronously from the click so popup blockers do not
    // mistake the later official redirect for an unsolicited window.
    try {
      popupRef.current = window.open('about:blank', popupName, popupFeatures())
    } catch {
      popupRef.current = null
    }

    let controller: AbortController | null = null
    try {
      startAbortRef.current?.abort()
      controller = new AbortController()
      startAbortRef.current = controller
      const started = await startAuthLogin({
        provider,
        callbackPath,
        ...((provider === 'email' || provider === 'phone') && normalizedIdentifier
          ? { loginHint: normalizedIdentifier }
          : {}),
        signal: controller.signal,
      })
      if (controller.signal.aborted) {
        void cancelAuthLogin(started.flowId).catch(() => undefined)
        return
      }
      const nextFlow: ActiveFlow = {
        flowId: started.flowId,
        provider,
        callbackPath,
        expiresAt: Date.now() + started.expiresIn * 1_000,
        pollAfterMs: started.pollAfterMs,
        authorizationUrl: started.authorizationUrl,
      }
      rememberFlow(nextFlow)
      setActiveFlow(nextFlow)
      setPhase('pending')
      // Keep the controller page alive because only it owns the opaque local
      // flow handle used by POST /complete. If the popup was blocked, the
      // pending screen exposes a user-initiated "重新打开" action instead of
      // navigating this tab away and abandoning completion polling.
      openOfficialLogin(started)
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return
      closePopup()
      setError(authFlowErrorMessage(caught))
      setPhase('error')
    } finally {
      if (startAbortRef.current === controller) startAbortRef.current = null
    }
  }, [callbackPath, closePopup, identifier, openOfficialLogin, phase, popupName, provider])

  useEffect(() => {
    if (!activeFlow || phase !== 'pending') return
    let alive = true
    let timer = 0
    let controller: AbortController | null = null

    const finish = async () => {
      if (!alive) return
      if (Date.now() >= activeFlow.expiresAt) {
        forgetFlow(activeFlow.flowId)
        setError('登录流程已过期，请重新开始。')
        setPhase('error')
        closePopup()
        return
      }
      controller = new AbortController()
      try {
        const result = await completeAuthLogin(activeFlow.flowId, controller.signal)
        if (!alive) return
        if (result.status === 'pending') {
          timer = window.setTimeout(finish, result.pollAfterMs)
          return
        }

        const snapshot = await getAuthSession()
        if (!alive) return
        if (!snapshot.authenticated || !snapshot.user) {
          throw new AuthFlowError('登录已完成，但本地会话尚未生效，请重新登录。', 502, 'session_not_hydrated')
        }
        if (result.provider !== activeFlow.provider) {
          throw new AuthFlowError('登录结果与当前登录方式不一致，请重新登录。', 409, 'provider_mismatch')
        }
        if (snapshot.user.id !== result.user.id) {
          throw new AuthFlowError('登录结果与当前本地会话不一致，请重新登录。', 409, 'session_account_mismatch')
        }
        forgetFlow(activeFlow.flowId)
        closePopup()
        setPhase('authenticated')
        onAuthenticated(snapshot, safeCallback(result.callbackPath || activeFlow.callbackPath))
      } catch (caught) {
        if (!alive || (caught instanceof DOMException && caught.name === 'AbortError')) return
        const status = typeof (caught as { status?: unknown })?.status === 'number'
          ? Number((caught as { status: number }).status)
          : 0
        const retryable = status === 0 || status === 429 || status >= 500
        if (!retryable) {
          forgetFlow(activeFlow.flowId)
          setActiveFlow(null)
          closePopup()
        }
        const message = caught instanceof AuthFlowError
          ? authFlowErrorMessage(caught)
          : authSessionErrorMessage(caught)
        setError(message)
        setPhase('error')
      }
    }

    timer = window.setTimeout(finish, activeFlow.pollAfterMs)
    return () => {
      alive = false
      window.clearTimeout(timer)
      controller?.abort()
    }
  }, [activeFlow, closePopup, onAuthenticated, phase])

  useEffect(() => () => {
    startAbortRef.current?.abort()
    closePopup()
  }, [closePopup])

  const cancel = useCallback(async (navigateBack = false) => {
    const flow = activeFlow
    setActiveFlow(null)
    setPhase('idle')
    setError('')
    startAbortRef.current?.abort()
    startAbortRef.current = null
    closePopup()
    if (flow) {
      forgetFlow(flow.flowId)
      try {
        await cancelAuthLogin(flow.flowId)
      } catch {
        // Cancellation is best effort; the server expires abandoned flows.
      }
    }
    if (navigateBack) onNavigate(callbackPath)
  }, [activeFlow, callbackPath, closePopup, onNavigate])

  const retry = () => {
    setError('')
    setPhase(activeFlow ? 'pending' : 'idle')
  }

  const pending = phase === 'starting' || phase === 'pending'

  if (hostedSessionOnly) {
    return (
      <main className="auth-flow-page">
        <a className="auth-flow-brand is-wordmark" href="/" aria-label="ChatGPT 首页" onClick={(event) => go('/', event)}><strong>ChatGPT</strong></a>
        <section className="auth-flow-card is-generic" aria-labelledby="auth-flow-title">
          <div className="auth-generic-landing">
            <h1 id="auth-flow-title">使用 Session 登录</h1>
            <p className="auth-flow-subtitle">托管版本不提供只能回调到本机的第三方 OAuth 流程。请通过同源后端验证 Session 后使用账号功能。</p>
            <div className="auth-generic-providers">
              <button data-auth-provider="session" type="button" onClick={onSessionLogin}><span className="auth-provider-session">◇</span>打开 Session 登录</button>
            </div>
            <a className="auth-flow-return" href={callbackPath} onClick={(event) => { event.preventDefault(); onNavigate(callbackPath) }}>返回 ChatGPT</a>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="auth-flow-page">
      <a className={`auth-flow-brand${genericLanding ? ' is-wordmark' : ''}`} href="/" aria-label="ChatGPT 首页" onClick={(event) => go('/', event)}>{genericLanding ? <strong>ChatGPT</strong> : <ChatGPTMark />}</a>
      <section className={`auth-flow-card${genericLanding ? ' is-generic' : ''}`} aria-labelledby="auth-flow-title" aria-busy={pending}>
        {!genericLanding && <ChatGPTMark />}
        {phase === 'authenticated' ? (
          <div className="auth-flow-complete" role="status">
            <span aria-hidden="true">✓</span>
            <h1 id="auth-flow-title">登录成功</h1>
            <p>账号已经通过本地后端验证，正在加载你的 ChatGPT 工作区。</p>
          </div>
        ) : activeFlow && (phase === 'pending' || phase === 'error') ? (
          <div className="auth-flow-pending" role="status">
            <h1 id="auth-flow-title">在官方页面完成授权</h1>
            <p className="auth-flow-subtitle">请在 OpenAI 官方窗口中完成{name}授权。本页面会安全地检查结果并自动返回。</p>
            <p className="auth-restored-flow">正在等待官方授权结果。完成密码或验证码验证后，此页面会自动加载对应账号。</p>
            {error && <div className="auth-flow-error" role="alert"><p>{error}</p><button type="button" onClick={retry}>重新检查</button></div>}
            <div className="auth-flow-pending-actions">
              {activeFlow.authorizationUrl && <button type="button" onClick={() => openOfficialLogin({ authorizationUrl: activeFlow.authorizationUrl! })}>重新打开官方页面</button>}
              <button className="is-secondary" type="button" onClick={() => { void cancel(false) }}>取消登录</button>
            </div>
            <small className="auth-flow-security-note">密码和短信验证码只在 auth.openai.com 输入，不会提交给本地页面。</small>
          </div>
        ) : genericLanding ? (
          <div className="auth-generic-landing">
            <h1 id="auth-flow-title">{isTeamSignup ? '创建 ChatGPT Business 工作区' : '登录或注册'}</h1>
            <p className="auth-flow-subtitle">{isTeamSignup ? '使用工作账户继续团队设置。身份验证将在 OpenAI 官方页面完成。' : '你将获得更加智能的回复并能上传文件、图片等内容。'}</p>
            <div className="auth-generic-providers">
              <button type="button" onClick={() => onNavigate(providerPath('google'))}><span className="auth-provider-google">G</span>使用 Google 账户继续</button>
              <button type="button" onClick={() => onNavigate(providerPath('apple'))}><span className="auth-provider-apple">●</span>使用 Apple 账户继续</button>
              <button type="button" onClick={() => onNavigate(providerPath('phone'))}><span className="auth-provider-phone">⌕</span>使用电话号码继续</button>
              {!isTeamSignup && <button data-auth-provider="session" type="button" onClick={onSessionLogin}><span className="auth-provider-session">◇</span>使用 Session 登录</button>}
            </div>
            <div className="auth-generic-divider"><span />或<span /></div>
            <form className="auth-generic-email" onSubmit={(event: FormEvent) => { event.preventDefault(); if (email.trim()) onNavigate(providerPath('email', email.trim())) }}>
              <label htmlFor="auth-generic-email">{isTeamSignup ? '工作邮箱地址' : '电子邮件地址'}</label>
              <input id="auth-generic-email" autoComplete="email" type="email" required value={email} onChange={(event) => setEmail(event.currentTarget.value)} />
              <button type="submit">{isTeamSignup ? '继续创建团队' : '继续'}</button>
            </form>
          </div>
        ) : (
          <>
            <h1 id="auth-flow-title">{isTeamSignup ? `使用${name}创建团队` : `使用${name}继续`}</h1>
            <p className="auth-flow-subtitle">{loginHint ? `${isTeamSignup ? '验证工作账户' : '继续验证'} ${loginHint}` : `继续连接你的${name}账户`}</p>
            <form className={`auth-provider-preview is-${provider}`} onSubmit={(event) => { event.preventDefault(); void start() }}>
              <ProviderGlyph provider={provider} />
              <strong>{name}</strong>
              {provider === 'phone' && <label className="auth-provider-identifier">
                <span>电话号码</span>
                <input
                  autoComplete="tel"
                  inputMode="tel"
                  pattern="\+[1-9][0-9 ()-]{7,24}"
                  placeholder="+86 138 0000 0000"
                  required
                  type="tel"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.currentTarget.value.slice(0, 32))}
                />
              </label>}
              <small>授权将在 OpenAI 官方页面完成；本地服务不会接收你的密码或验证码。</small>
              <button type="submit" disabled={phase === 'starting'}>{phase === 'starting' ? '正在连接…' : '前往官方登录'}</button>
            </form>
            {error && <div className="auth-flow-error" role="alert"><p>{error}</p><button type="button" onClick={retry}>重新开始</button></div>}
            <a className="auth-flow-return" href={callbackPath} onClick={(event) => { event.preventDefault(); void cancel(true) }}>返回 ChatGPT</a>
          </>
        )}
      </section>
      <footer><a href="/terms" onClick={(event) => go('/terms', event)}>使用条款</a><span>·</span><a href="/privacy" onClick={(event) => go('/privacy', event)}>隐私政策</a></footer>
    </main>
  )
}
