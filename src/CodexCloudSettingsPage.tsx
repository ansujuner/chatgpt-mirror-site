import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AppWindow,
  Bell,
  Check,
  ExternalLink,
  LogOut,
  Menu,
  Settings,
  X,
} from 'lucide-react'
import { AnalyticsSettingsPage } from './CodexSettingsAnalyticsPage'
import {
  AccessTokensSettingsPage,
  CodeReviewSettingsPage,
  ConnectorsSettingsPage,
  DataSettingsPage,
} from './CodexSettingsSecondaryPages'
import { EnvironmentsSettingsPage, GeneralSettingsPage } from './CodexSettingsPrimaryPages'
import {
  ApiReferenceSettingsPage,
  ManagedConfigsSettingsPage,
  NotificationsSettingsPage,
  PoliciesSettingsPage,
  UsageSettingsPage,
} from './CodexSettingsExtraPages'
import './CodexCloudSettingsPage.css'

type CodexCloudSettingsPageProps = {
  locationHref: string
  onNavigate: (path: string) => void
}

type HeaderMenu = 'apps' | 'notifications' | 'profile' | null

function GithubMark({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg aria-hidden className={className} width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .7A11.5 11.5 0 0 0 8.36 23.1c.58.1.79-.25.79-.56v-2.22c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.17.08 1.78 1.2 1.78 1.2 1.04 1.77 2.72 1.26 3.38.96.1-.75.4-1.26.74-1.55-2.57-.29-5.28-1.29-5.28-5.72 0-1.26.45-2.3 1.2-3.1-.12-.3-.52-1.47.11-3.06 0 0 .98-.31 3.16 1.18a10.98 10.98 0 0 1 5.76 0c2.19-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.76.11 3.06.75.8 1.2 1.84 1.2 3.1 0 4.45-2.71 5.42-5.29 5.71.42.36.79 1.06.79 2.15v3.19c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
    </svg>
  )
}

const SETTINGS_NAV = [
  { label: '常规', path: '/codex/cloud/settings/general', match: '/codex/cloud/settings/general' },
  { label: '环境', path: '/codex/cloud/settings/environments', match: '/codex/cloud/settings/environment' },
  { label: '代码审查', path: '/codex/cloud/settings/code-review', match: '/codex/cloud/settings/code-review' },
  { label: '连接器', path: '/codex/cloud/settings/connectors', match: '/codex/cloud/settings/connectors' },
  { label: '分析', path: '/codex/cloud/settings/analytics', match: '/codex/cloud/settings/analytics' },
  { label: '数据管理', path: '/codex/cloud/settings/data', match: '/codex/cloud/settings/data' },
  { label: '访问令牌', path: '/admin/access-tokens', match: '/admin/access-tokens', external: true },
] as const

function readStoredBoolean(key: string) {
  try { return window.localStorage.getItem(key) === 'true' } catch { return false }
}

function isActivePath(pathname: string, item: (typeof SETTINGS_NAV)[number]) {
  if (item.label === '环境') {
    return pathname.startsWith('/codex/cloud/settings/environments') || pathname.startsWith('/codex/cloud/settings/environment/')
  }
  if (item.label === '访问令牌') {
    return pathname === '/admin/access-tokens' || pathname.startsWith('/codex/cloud/settings/access-tokens')
  }
  return pathname.startsWith(item.match)
}

function SettingsSidebar({ pathname, onNavigate, onClose }: {
  pathname: string
  onNavigate: (path: string) => void
  onClose?: () => void
}) {
  const navigate = (path: string) => {
    onNavigate(path)
    onClose?.()
  }
  return (
    <div className="ccs-sidebar-content">
      {onClose && (
        <div className="ccs-drawer-close-row">
          <button type="button" aria-label="关闭设置侧边栏" onClick={onClose}><X size={19} /></button>
        </div>
      )}
      <p className="ccs-sidebar-title">设置</p>
      <nav aria-label="Codex 设置">
        {SETTINGS_NAV.map((item) => {
          const active = isActivePath(pathname, item)
          return (
            <button
              className={active ? 'is-active' : ''}
              type="button"
              key={item.path}
              aria-current={active ? 'page' : undefined}
              onClick={() => navigate(item.path)}
            >
              <span>{item.label}</span>
              {'external' in item && item.external && <ExternalLink aria-hidden size={15} />}
            </button>
          )
        })}
      </nav>
      {onClose && (
        <a className="ccs-drawer-docs" href="https://platform.openai.com/docs/codex/overview" target="_blank" rel="noreferrer">
          <span>文档</span><ExternalLink size={14} />
        </a>
      )}
    </div>
  )
}

function GithubConnectDialog({ onClose, onConnect }: { onClose: () => void; onConnect: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    dialogRef.current?.querySelector<HTMLButtonElement>('.ccs-dialog-primary')?.focus()
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  return (
    <div className="ccs-modal-layer" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <div className="ccs-connect-dialog" role="dialog" aria-modal="true" aria-labelledby="ccs-github-dialog-title" ref={dialogRef}>
        <button className="ccs-dialog-close" type="button" aria-label="关闭" onClick={onClose}><X size={18} /></button>
        <div className="ccs-dialog-logo"><GithubMark size={27} /></div>
        <h2 id="ccs-github-dialog-title">连接到 GitHub</h2>
        <p>连接你的 GitHub 账户，以便 Codex 访问你选择的代码仓库并创建云端环境。</p>
        <button className="ccs-dialog-primary" type="button" onClick={onConnect}><GithubMark size={17} />继续连接 GitHub</button>
        <button className="ccs-dialog-secondary" type="button" onClick={onClose}>取消</button>
        <small>你可以随时在“连接器”中更改此设置。</small>
      </div>
    </div>
  )
}

function SettingsContent({ pathname, search, githubConnected, onConnectGithub, onGithubConnectionChange, onNavigate }: {
  pathname: string
  search: string
  githubConnected: boolean
  onConnectGithub: () => void
  onGithubConnectionChange: (connected: boolean) => void
  onNavigate: (path: string) => void
}) {
  if (pathname === '/codex/cloud/settings' || pathname === '/codex/cloud/settings/') {
    return <GeneralSettingsPage />
  }
  if (pathname.startsWith('/codex/cloud/settings/general')) return <GeneralSettingsPage />
  if (pathname.startsWith('/codex/cloud/settings/environments') || pathname.startsWith('/codex/cloud/settings/environment/')) {
    return (
      <EnvironmentsSettingsPage
        path={pathname}
        isGithubConnected={githubConnected}
        onConnectGithub={onConnectGithub}
        onNavigate={onNavigate}
      />
    )
  }
  if (pathname.startsWith('/codex/cloud/settings/code-review')) {
    return <CodeReviewSettingsPage initialRepositoryId={new URLSearchParams(search).get('repoId')} isGithubConnected={githubConnected} />
  }
  if (pathname.startsWith('/codex/cloud/settings/connectors')) {
    return <ConnectorsSettingsPage isGithubConnected={githubConnected} onGithubConnectionChange={onGithubConnectionChange} />
  }
  if (pathname.startsWith('/codex/cloud/settings/analytics')) return <AnalyticsSettingsPage />
  if (pathname.startsWith('/codex/cloud/settings/data')) return <DataSettingsPage />
  if (pathname.startsWith('/codex/cloud/settings/access-tokens') || pathname === '/admin/access-tokens') return <AccessTokensSettingsPage />
  if (pathname.startsWith('/codex/cloud/settings/usage')) return <UsageSettingsPage />
  if (pathname.startsWith('/codex/cloud/settings/notifications')) return <NotificationsSettingsPage />
  if (pathname.startsWith('/codex/cloud/settings/policies')) return <PoliciesSettingsPage />
  if (pathname.startsWith('/codex/cloud/settings/managed-configs')) return <ManagedConfigsSettingsPage />
  if (pathname.startsWith('/codex/cloud/settings/apireference')) return <ApiReferenceSettingsPage />
  return (
    <div className="ccs-route-not-found">
      <h1>找不到此设置页面</h1>
      <p>此链接可能已移动，或者你的账户无权访问。</p>
      <button type="button" onClick={() => onNavigate('/codex/cloud/settings/general')}>返回常规设置</button>
    </div>
  )
}

export default function CodexCloudSettingsPage({ locationHref, onNavigate }: CodexCloudSettingsPageProps) {
  const location = useMemo(() => new URL(locationHref, window.location.origin), [locationHref])
  const pathname = location.pathname
  const nestedEnvironment = pathname.startsWith('/codex/cloud/settings/environment/')
  const [githubConnected, setGithubConnected] = useState(() => readStoredBoolean('codex-cloud.github-connected'))
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [connectDialogOpen, setConnectDialogOpen] = useState(false)
  const [headerMenu, setHeaderMenu] = useState<HeaderMenu>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    try { window.localStorage.setItem('codex-cloud.github-connected', String(githubConnected)) } catch { /* storage may be disabled */ }
  }, [githubConnected])
  useEffect(() => {
    setHeaderMenu(null)
    setMobileSidebarOpen(false)
  }, [locationHref])
  useEffect(() => {
    if (pathname === '/codex/cloud/settings' || pathname === '/codex/cloud/settings/') {
      onNavigate('/codex/cloud/settings/general')
    }
  }, [onNavigate, pathname])
  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(null), 2200)
    return () => window.clearTimeout(timeout)
  }, [toast])
  useEffect(() => {
    if (!mobileSidebarOpen) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileSidebarOpen(false) }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [mobileSidebarOpen])

  const changeGithubConnection = (connected: boolean) => {
    setGithubConnected(connected)
    setConnectDialogOpen(false)
    setToast(connected ? 'GitHub 已连接' : 'GitHub 已断开连接')
  }

  const openHeaderMenu = (menu: Exclude<HeaderMenu, null>) => setHeaderMenu((current) => current === menu ? null : menu)

  return (
    <div className={`codex-settings-shell${githubConnected ? ' is-github-connected' : ''}${nestedEnvironment ? ' is-nested-environment' : ''}`}>
      <header className="ccs-header">
        <div className="ccs-header-left">
          <button className="ccs-mobile-nav-button" type="button" aria-label="打开设置侧边栏" onClick={() => setMobileSidebarOpen(true)}><Menu size={20} /></button>
          <button className="ccs-wordmark" type="button" aria-label="返回 ChatGPT" onClick={() => onNavigate('/')}>
            <img alt="" src="/chatgpt-mark.svg" /><span>ChatGPT</span>
          </button>
        </div>
        <nav className="ccs-top-nav" aria-label="Codex 导航">
          <button type="button" onClick={() => setToast('你正在使用 Codex 云端')}>代码</button>
          <button type="button" onClick={() => openHeaderMenu('apps')} aria-expanded={headerMenu === 'apps'}>应用</button>
          <a href="https://platform.openai.com/docs/codex/overview" target="_blank" rel="noreferrer">文档</a>
          <button className="ccs-icon-button" type="button" aria-label="Codex 设置" onClick={() => onNavigate('/codex/cloud/settings/general')}><Settings size={17} strokeWidth={1.7} /></button>
          <button className="ccs-icon-button" type="button" aria-label="通知" aria-expanded={headerMenu === 'notifications'} onClick={() => openHeaderMenu('notifications')}><Bell size={17} strokeWidth={1.7} /></button>
          <button className="ccs-avatar" type="button" aria-label="账户菜单" aria-expanded={headerMenu === 'profile'} onClick={() => openHeaderMenu('profile')}>LI</button>
        </nav>

        {headerMenu === 'apps' && (
          <div className="ccs-header-popover ccs-apps-popover">
            <p>应用</p>
            <button type="button" onClick={() => { setHeaderMenu(null); setToast('已在 Codex') }}><span className="ccs-app-icon"><Check size={16} /></span><span><strong>Codex</strong><small>编写和审查代码</small></span></button>
            <button type="button" onClick={() => { setHeaderMenu(null); onNavigate('/') }}><span className="ccs-app-icon"><AppWindow size={16} /></span><span><strong>ChatGPT</strong><small>聊天与创作</small></span></button>
          </div>
        )}
        {headerMenu === 'notifications' && (
          <div className="ccs-header-popover ccs-notifications-popover">
            <div><strong>通知</strong><button type="button" onClick={() => setHeaderMenu(null)}><X size={15} /></button></div>
            <span className="ccs-empty-bell"><Bell size={21} /></span>
            <p>暂无通知</p>
          </div>
        )}
        {headerMenu === 'profile' && (
          <div className="ccs-header-popover ccs-profile-popover">
            <div className="ccs-profile-identity"><span>LI</span><div><strong>lisi</strong><small>个人账户</small></div></div>
            <hr />
            <button type="button" onClick={() => { setHeaderMenu(null); onNavigate('/codex/cloud/settings/general') }}><Settings size={16} /><span>Codex 设置</span></button>
            <button type="button" onClick={() => { setHeaderMenu(null); setToast('已打开 ChatGPT 设置入口') }}><AppWindow size={16} /><span>ChatGPT 设置</span></button>
            <hr />
            <button type="button" onClick={() => { setHeaderMenu(null); onNavigate('/') }}><LogOut size={16} /><span>退出 Codex</span></button>
          </div>
        )}
      </header>

      {!githubConnected && (
        <div className="ccs-github-banner">
          <GithubMark size={18} />
          <span>你的 GitHub 账户尚未连接。</span>
          <button type="button" onClick={() => setConnectDialogOpen(true)}>立即连接</button>
          <span>。</span>
        </div>
      )}

      <div className="ccs-layout">
        {!nestedEnvironment && <aside className="ccs-sidebar"><SettingsSidebar pathname={pathname} onNavigate={onNavigate} /></aside>}
        <main className="ccs-main" data-scroll-root>
          <SettingsContent
            pathname={pathname}
            search={location.search}
            githubConnected={githubConnected}
            onConnectGithub={() => setConnectDialogOpen(true)}
            onGithubConnectionChange={changeGithubConnection}
            onNavigate={onNavigate}
          />
        </main>
      </div>

      {mobileSidebarOpen && (
        <div className="ccs-mobile-layer">
          <button className="ccs-mobile-scrim" type="button" aria-label="关闭设置侧边栏" onClick={() => setMobileSidebarOpen(false)} />
          <aside className="ccs-mobile-sidebar"><SettingsSidebar pathname={pathname} onNavigate={onNavigate} onClose={() => setMobileSidebarOpen(false)} /></aside>
        </div>
      )}
      {connectDialogOpen && <GithubConnectDialog onClose={() => setConnectDialogOpen(false)} onConnect={() => changeGithubConnection(true)} />}
      {toast && <div className="ccs-toast" role="status">{toast}</div>}
    </div>
  )
}
