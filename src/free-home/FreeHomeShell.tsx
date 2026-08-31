import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
  AttachmentSource,
  ComposerAttachment,
  ComposerSubmission,
  HistoryLoadStatus,
  PlusConversation,
  PlusMicState,
  PlusTurn,
} from '../PlusShell'
import './FreeHomeShell.css'

type HomePath = '/' | '/images' | '/library' | '/tasks' | '/plugins' | '/projects'

export type FreeHomeShellProps = {
  activeConversationId?: string | null
  accountEmail?: string
  accountName?: string
  accountInitials?: string
  attachments: readonly ComposerAttachment[]
  conversations?: readonly PlusConversation[]
  dictationSupported: boolean
  isGenerating: boolean
  micState: PlusMicState
  onFilesAdded: (files: readonly File[], source?: AttachmentSource) => void
  onConversationSelect?: (conversation: PlusConversation) => void
  onHelp: () => void
  onHistoryRetry?: () => void
  onLogout: () => void
  onMicrophoneClick: () => void
  onNavigate: (path: HomePath) => void
  onOpenSearch: () => void
  onOpenSettings: () => void
  onSessionDisconnect: () => void
  onSessionLogin: () => void
  onRemoveAttachment: (id: string) => void
  onSidebarCollapsedChange: (collapsed: boolean) => void
  onSidebarOpenChange: (open: boolean) => void
  onStopGenerating: () => void
  onSubmit: (submission: ComposerSubmission) => void
  onUpgrade: () => void
  onValueChange: (value: string) => void
  onVoiceClick: () => void
  planLabel?: string
  historyStatus?: HistoryLoadStatus
  sessionConnected?: boolean
  sidebarCollapsed: boolean
  sidebarOpen: boolean
  turns?: readonly PlusTurn[]
  value: string
}

type IconName =
  | 'chatgpt' | 'compose' | 'search' | 'sidebar' | 'menu' | 'image' | 'library'
  | 'clock' | 'plugin' | 'folder' | 'code' | 'more' | 'plus' | 'temporary'
  | 'attachment' | 'think' | 'microphone' | 'voice' | 'send' | 'close'
  | 'pencil' | 'globe' | 'lock' | 'upgrade' | 'settings' | 'help' | 'logout'
  | 'session' | 'unlink' | 'copy' | 'share' | 'check'

const spriteIds: Partial<Record<IconName, string>> = {
  chatgpt: 'chatgpt-mark',
  compose: 'lightweight-sidebar-compose',
  search: 'lightweight-sidebar-search',
  sidebar: 'lightweight-sidebar-sidebar',
  menu: 'lightweight-shell-mobile-sidebar-toggle',
  image: 'lightweight-sidebar-images',
  plugin: 'lightweight-sidebar-plugins',
  attachment: 'lightweight-composer-add-attachment',
  microphone: 'lightweight-composer-microphone',
  send: 'lightweight-composer-send',
}

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const sprite = spriteIds[name]
  if (sprite) {
    return <svg aria-hidden="true" className="free-icon" height={size} viewBox="0 0 20 20" width={size}><use href={`/chatgpt-icons.svg#${sprite}`} /></svg>
  }

  const common = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, strokeWidth: 1.55 }
  let drawing: ReactNode
  switch (name) {
    case 'library': drawing = <><rect x="2.7" y="4" width="2.4" height="12" rx=".6"/><rect x="7" y="4" width="2.4" height="12" rx=".6"/><path d="m12 4.6 2.25-.65 3.05 11.25-2.35.65L12 4.6Z"/></>; break
    case 'clock': drawing = <><circle cx="10" cy="10" r="7.25"/><path d="M10 5.8v4.5l-2.9 1.85"/></>; break
    case 'folder': drawing = <path d="M2.5 5.6c0-.85.7-1.55 1.55-1.55H8l1.55 1.7h6.4c.85 0 1.55.7 1.55 1.55v6.85c0 .85-.7 1.55-1.55 1.55H4.05c-.85 0-1.55-.7-1.55-1.55V5.6Z"/>; break
    case 'code': drawing = <><path d="m7.5 5.5-4 4.5 4 4.5M12.5 5.5l4 4.5-4 4.5"/><path d="m11.3 3.8-2.6 12.4"/></>; break
    case 'more': drawing = <><circle cx="4" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="10" r="1" fill="currentColor" stroke="none"/></>; break
    case 'plus': drawing = <path d="M10 4v12M4 10h12"/>; break
    case 'temporary': drawing = <><path d="M4.3 6.3A7 7 0 1 1 3 10.4"/><path d="M3.6 3.8v3.4H7"/><path d="M10 6.4v4l2.7 1.6"/></>; break
    case 'think': drawing = <><path d="M10 2.8a5.3 5.3 0 0 0-3.2 9.55c.65.5 1.05 1.2 1.05 1.95h4.3c0-.75.4-1.45 1.05-1.95A5.3 5.3 0 0 0 10 2.8Z"/><path d="M8.1 16.6h3.8M8.4 14.3h3.2"/></>; break
    case 'voice': drawing = <><path d="M5 8v4M8.3 5.5v9M11.7 7v6M15 4v12" stroke="white" strokeWidth="1.75"/></>; break
    case 'close': drawing = <path d="m5 5 10 10M15 5 5 15"/>; break
    case 'pencil': drawing = <><path d="m4 16 1.1-4 8.8-8.8a1.55 1.55 0 0 1 2.2 0l.7.7a1.55 1.55 0 0 1 0 2.2L8 14.9 4 16Z"/><path d="m12.8 4.3 2.9 2.9"/></>; break
    case 'globe': drawing = <><circle cx="10" cy="10" r="7.2"/><path d="M2.8 10h14.4M10 2.8c2 2 3 4.4 3 7.2s-1 5.2-3 7.2c-2-2-3-4.4-3-7.2s1-5.2 3-7.2Z"/></>; break
    case 'lock': drawing = <><rect x="5.2" y="8.5" width="9.6" height="7.5" rx="1.7"/><path d="M7.4 8.5V6.7a2.6 2.6 0 0 1 5.2 0v1.8"/></>; break
    case 'upgrade': drawing = <><path d="M10 16V4M5.8 8.2 10 4l4.2 4.2"/><path d="M4 16h12"/></>; break
    case 'settings': drawing = <><circle cx="10" cy="10" r="2.4"/><path d="M10 2.7v2M10 15.3v2M2.7 10h2M15.3 10h2M4.8 4.8l1.4 1.4M13.8 13.8l1.4 1.4M15.2 4.8l-1.4 1.4M6.2 13.8l-1.4 1.4"/></>; break
    case 'help': drawing = <><circle cx="10" cy="10" r="7.2"/><path d="M7.9 7.7a2.2 2.2 0 1 1 3.15 2c-.75.4-1.05.85-1.05 1.6M10 14.3h.01"/></>; break
    case 'session': drawing = <><circle cx="7.1" cy="10" r="3.2"/><path d="M10.3 10h6.2M13.4 10v2.1M15.5 10v1.2"/></>; break
    case 'unlink': drawing = <><path d="m7.3 12.7-1.15 1.15a2.7 2.7 0 0 1-3.8-3.8l2.25-2.25a2.7 2.7 0 0 1 3.8 0M12.7 7.3l1.15-1.15a2.7 2.7 0 1 1 3.8 3.8L15.4 12.2a2.7 2.7 0 0 1-3.8 0M7.6 12.4l4.8-4.8"/><path d="m3.5 3.5 13 13"/></>; break
    case 'copy': drawing = <><rect x="6.25" y="6.25" width="10" height="10" rx="1"/><path d="M7.5 3.75H4.75a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h1.5"/></>; break
    case 'share': drawing = <><path d="M10 12.75v-9m0 0L6.75 6.9M10 3.75l3.25 3.15"/><path d="M6 8.75H4.75a1 1 0 0 0-1 1v5.5a1 1 0 0 0 1 1h10.5a1 1 0 0 0 1-1v-5.5a1 1 0 0 0-1-1H14"/></>; break
    case 'check': drawing = <path d="m4.75 10.25 3.25 3.2 7.25-7.2"/>; break
    case 'logout': drawing = <><path d="M8 3.5H4.8c-.7 0-1.3.6-1.3 1.3v10.4c0 .7.6 1.3 1.3 1.3H8"/><path d="M11.7 6.5 15.2 10l-3.5 3.5M7.2 10h8"/></>; break
    default: drawing = <circle cx="10" cy="10" r="7"/>
  }
  return <svg aria-hidden="true" className="free-icon" height={size} viewBox="0 0 20 20" width={size} {...common}>{drawing}</svg>
}

function NavLink({ icon, label, href, active, trailing, onNavigate }: {
  icon: IconName
  label: string
  href: HomePath
  active?: boolean
  trailing?: ReactNode
  onNavigate: (path: HomePath) => void
}) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onNavigate(href)
  }
  return <a className={`free-nav-row${active ? ' is-active' : ''}`} href={href} onClick={follow}><Icon name={icon}/><span>{label}</span>{trailing}</a>
}

async function writeFreeConversationText(text: string) {
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

export default function FreeHomeShell({
  accountEmail = '', accountInitials = 'U', accountName = '账户', activeConversationId = null, attachments,
  conversations = [], dictationSupported, historyStatus = 'ready', isGenerating, micState,
  onConversationSelect, onFilesAdded, onHelp, onHistoryRetry, onLogout, onMicrophoneClick, onNavigate, onOpenSearch,
  onOpenSettings, onRemoveAttachment, onSidebarCollapsedChange, onSidebarOpenChange,
  onSessionDisconnect, onSessionLogin, onStopGenerating, onSubmit, onUpgrade,
  onValueChange, onVoiceClick, planLabel = '免费版', sessionConnected = false,
  sidebarCollapsed, sidebarOpen, turns = [], value,
}: FreeHomeShellProps) {
  const [profileOpen, setProfileOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [lockedHint, setLockedHint] = useState(false)
  const [copiedTurnId, setCopiedTurnId] = useState<PlusTurn['id'] | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const copyResetTimer = useRef<number | null>(null)
  const canSubmit = value.trim().length > 0 || attachments.length > 0

  useEffect(() => {
    if (!profileOpen && !moreOpen) return
    const close = (event: PointerEvent) => {
      if (!(event.target as Element).closest('.free-account-area, .free-more-area')) {
        setProfileOpen(false)
        setMoreOpen(false)
      }
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [moreOpen, profileOpen])

  useEffect(() => {
    if (!sidebarOpen) return
    const close = (event: globalThis.KeyboardEvent) => event.key === 'Escape' && onSidebarOpenChange(false)
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [onSidebarOpenChange, sidebarOpen])

  useEffect(() => {
    if (!lockedHint) return
    const timeout = window.setTimeout(() => setLockedHint(false), 1800)
    return () => window.clearTimeout(timeout)
  }, [lockedHint])

  useEffect(() => () => {
    if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current)
  }, [])

  const showCopiedState = (turnId: PlusTurn['id']) => {
    if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current)
    setCopiedTurnId(turnId)
    copyResetTimer.current = window.setTimeout(() => setCopiedTurnId(null), 1800)
  }

  const copyTurn = async (turn: PlusTurn) => {
    try {
      await writeFreeConversationText(turn.text)
      showCopiedState(turn.id)
    } catch {
      // Clipboard access can be unavailable in an insecure browser context.
    }
  }

  const shareTurn = async (turn: PlusTurn) => {
    try {
      if (navigator.share) {
        await navigator.share({ text: turn.text })
        return
      }
      await writeFreeConversationText(turn.text)
      showCopiedState(turn.id)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
    }
  }

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (!canSubmit || isGenerating) return
    onSubmit({ text: value, attachments })
  }
  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }
  const pickFiles = () => fileInputRef.current?.click()
  const openSidebar = () => {
    if (window.matchMedia('(max-width: 767px)').matches) onSidebarOpenChange(true)
    else {
      onSidebarOpenChange(false)
      onSidebarCollapsedChange(false)
    }
  }
  const closeSidebar = () => {
    if (window.matchMedia('(max-width: 767px)').matches) onSidebarOpenChange(false)
    else {
      onSidebarOpenChange(false)
      onSidebarCollapsedChange(true)
    }
  }
  const chooseSuggestion = (kind: 'image' | 'write' | 'web') => {
    if (kind === 'image') { onNavigate('/images'); return }
    onValueChange(kind === 'write' ? '帮我撰写或编辑：' : '搜索网页：')
    window.setTimeout(() => textareaRef.current?.focus(), 0)
  }
  const hasConversation = turns.length > 0 || isGenerating
  const composer = (
    <form className="free-composer" onSubmit={submit}>
      {attachments.length > 0 && <div className="free-attachment-list">{attachments.map(({ id, file }) => <span key={id}>{file.name}<button type="button" aria-label={`移除 ${file.name}`} onClick={() => onRemoveAttachment(id)}><Icon name="close" size={14}/></button></span>)}</div>}
      <button className="free-add-button" type="button" aria-label="添加文件等" onClick={pickFiles}><Icon name="attachment" size={20}/></button>
      <textarea ref={textareaRef} aria-label="与 ChatGPT 聊天" placeholder="有问题，随便问" rows={1} value={value} onChange={(event) => onValueChange(event.target.value)} onKeyDown={onComposerKeyDown}/>
      <div className="free-composer-actions">
        <button className="free-think-button" type="button" aria-label="思考" onClick={() => setLockedHint(true)}><Icon name="think" size={18}/><span>思考</span></button>
        <button className={`free-mic-button is-${micState}`} type="button" aria-label="开始听写" disabled={!dictationSupported || isGenerating} onClick={onMicrophoneClick}><Icon name="microphone" size={20}/></button>
        <button className="free-voice-button" type={canSubmit ? 'submit' : 'button'} aria-label={isGenerating ? '停止生成' : canSubmit ? '发送提示' : '启动语音功能'} onClick={isGenerating ? (event) => { event.preventDefault(); onStopGenerating() } : canSubmit ? undefined : onVoiceClick}><Icon name={isGenerating ? 'close' : canSubmit ? 'send' : 'voice'} size={20}/></button>
      </div>
      <input ref={fileInputRef} className="free-sr-only" type="file" multiple tabIndex={-1} onChange={(event) => { if (event.target.files?.length) onFilesAdded(Array.from(event.target.files), 'picker'); event.target.value = '' }}/>
    </form>
  )

  return <div className={`free-home-shell${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}${sidebarOpen ? ' is-drawer-open' : ''}`}>
    <aside className="free-sidebar" aria-label="侧边栏">
      <header className="free-sidebar-header">
        <a className="free-brand" href="/" aria-label="主页" onClick={(event) => { event.preventDefault(); onNavigate('/') }}><span>ChatGPT</span></a>
        <div className="free-sidebar-head-actions">
          <button type="button" aria-label="搜索" onClick={onOpenSearch}><Icon name="search"/></button>
          <button type="button" aria-label="关闭侧边栏" onClick={closeSidebar}><Icon name="sidebar"/></button>
        </div>
      </header>

      <nav className="free-sidebar-nav" aria-label="ChatGPT">
        <NavLink active href="/" icon="compose" label="新聊天" onNavigate={onNavigate}/>
        <NavLink href="/images" icon="image" label="图片" onNavigate={onNavigate}/>
        <NavLink href="/library" icon="library" label="资料库" onNavigate={onNavigate}/>
        <NavLink href="/tasks" icon="clock" label="已安排" onNavigate={onNavigate}/>
        <NavLink href="/plugins" icon="plugin" label="插件" onNavigate={onNavigate}/>
        <NavLink href="/projects" icon="folder" label="项目" onNavigate={onNavigate} trailing={<button className="free-nav-trailing" type="button" aria-label="新项目" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onNavigate('/projects') }}><Icon name="plus" size={18}/></button>}/>
        <button className="free-nav-row" type="button" onClick={() => setLockedHint(true)}><Icon name="code"/><span>Codex</span></button>
        <div className="free-more-area">
          <button className="free-nav-row" type="button" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}><Icon name="more"/><span>更多</span></button>
          {moreOpen && <div className="free-more-menu" role="menu"><button role="menuitem" type="button" onClick={() => chooseSuggestion('web')}><Icon name="globe"/><span>深度研究</span></button><button role="menuitem" type="button" onClick={() => onNavigate('/plugins')}><Icon name="plugin"/><span>探索 GPT</span></button></div>}
        </div>
      </nav>

      {(conversations.length > 0 || historyStatus === 'loading' || historyStatus === 'error') && (
        <section className="free-history-section" aria-labelledby="free-history-heading">
          <h2 id="free-history-heading">最近</h2>
          <div className="free-history-list">
            {historyStatus === 'loading' && conversations.length === 0 ? <p role="status">正在加载聊天…</p> : null}
            {historyStatus === 'error' ? <p role="alert"><span>聊天记录暂不可用</span><button type="button" onClick={onHistoryRetry}>重试</button></p> : null}
            {conversations.map((conversation) => (
              <button
                aria-current={activeConversationId === conversation.id ? 'page' : undefined}
                className={activeConversationId === conversation.id ? 'is-active' : ''}
                key={conversation.id}
                onClick={() => onConversationSelect?.(conversation)}
                title={conversation.title}
                type="button"
              >{conversation.title}</button>
            ))}
          </div>
        </section>
      )}

      <div className="free-account-area">
        {profileOpen && <div className="free-profile-menu" role="menu">
          {accountEmail && <div className="free-profile-identity"><strong>{accountName}</strong><span>{accountEmail}</span></div>}
          <button role="menuitem" type="button" onClick={() => { setProfileOpen(false); onSessionLogin() }}><Icon name="session"/><span>{sessionConnected ? '切换 Session' : 'Session 登录'}</span></button>
          {sessionConnected && <button role="menuitem" type="button" onClick={() => { setProfileOpen(false); onSessionDisconnect() }}><Icon name="unlink"/><span>断开 Session</span></button>}
          <div className="free-profile-separator" role="separator"/>
          <button role="menuitem" type="button" onClick={() => { setProfileOpen(false); onOpenSettings() }}><Icon name="settings"/><span>设置</span></button>
          <button role="menuitem" type="button" onClick={onHelp}><Icon name="help"/><span>帮助</span></button>
          <button role="menuitem" type="button" onClick={onLogout}><Icon name="logout"/><span>退出登录</span></button>
        </div>}
        <button className="free-account-button" type="button" aria-label={`${accountName} ${planLabel}，打开“个人资料”菜单`} aria-expanded={profileOpen} onClick={() => setProfileOpen((open) => !open)}>
          <span className="free-avatar">{accountInitials}</span><span className="free-account-copy"><strong>{accountName}</strong><small>{planLabel}</small></span>
        </button>
        <button className="free-sidebar-upgrade" type="button" aria-label="升级" onClick={onUpgrade}><Icon name="upgrade" size={18}/></button>
      </div>
    </aside>

    <button className="free-drawer-scrim" type="button" aria-label="关闭侧边栏" onClick={() => onSidebarOpenChange(false)}/>

    <section className="free-main-surface">
      <header className="free-topbar" role="banner">
        <div className="free-mobile-header">
          <button type="button" aria-label="打开侧边栏" onClick={openSidebar}><Icon name="menu"/></button>
          <button className="free-mobile-brand" type="button" onClick={() => onNavigate('/')}>ChatGPT</button>
        </div>
        <div className="free-mode-switch" role="radiogroup" aria-label="选择聊天界面">
          <button className="is-active" type="button" role="radio" aria-checked="true">聊天</button>
          <button className="is-locked" type="button" role="radio" aria-checked="false" aria-label="工作 需要升级" onClick={() => setLockedHint(true)}>工作 <Icon name="lock" size={13}/></button>
        </div>
        <div className="free-top-actions">
          <button className="free-top-upgrade" type="button" onClick={onUpgrade}>升级</button>
          <button className="free-temporary-button" type="button" aria-label="临时聊天" onClick={() => setLockedHint(true)}><Icon name="temporary" size={21}/></button>
        </div>
      </header>

      {hasConversation ? <main className="free-conversation-main">
        <div className="free-turn-scroll" aria-live="polite">
          <div className="free-turn-list" data-conversation-transcript="">
            {turns.map((turn, index) => <article className={`free-turn is-${turn.role}`} data-message-role={turn.role} key={turn.id}>
              <div className="free-turn-copy">
                {turn.attachments?.length ? <div className="free-turn-attachments">{turn.attachments.map(({ id, file }) => <span key={id}>{file.name}</span>)}</div> : null}
                {turn.text ? turn.role === 'assistant'
                  ? <div className="free-turn-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.text}</ReactMarkdown></div>
                  : <p className="free-turn-user-text">{turn.text}</p> : null}
                {turn.stopped ? <small>你已停止此回复</small> : null}
                {turn.role === 'assistant' && turn.text && !(isGenerating && index === turns.length - 1) ? <div className="free-turn-actions" role="group" aria-label="回复操作">
                  <button className="free-turn-action" type="button" aria-label={copiedTurnId === turn.id ? '已复制' : '复制'} title={copiedTurnId === turn.id ? '已复制' : '复制'} onClick={() => void copyTurn(turn)}><Icon name={copiedTurnId === turn.id ? 'check' : 'copy'} size={20}/></button>
                  <button className="free-turn-action" type="button" aria-label="分享" title="分享" onClick={() => void shareTurn(turn)}><Icon name="share" size={20}/></button>
                </div> : null}
              </div>
            </article>)}
            {isGenerating && turns.at(-1)?.role !== 'assistant' ? <article className="free-turn is-assistant is-thinking" data-message-role="assistant"><span className="free-thinking-dots"><i/><i/><i/></span></article> : null}
          </div>
        </div>
        <div className="free-conversation-dock"><p>ChatGPT 也可能会犯错。请核查重要信息。</p>{composer}</div>
      </main> : <main className="free-home-main">
        <div className="free-welcome">
          <h1>你今天在想些什么？</h1>
          {composer}

          {!value.trim() && attachments.length === 0 && <div className="free-suggestions" aria-label="建议">
            <button type="button" onClick={() => chooseSuggestion('image')}><Icon name="image"/><span>创建图像或贴纸</span></button>
            <button type="button" onClick={() => chooseSuggestion('write')}><Icon name="pencil"/><span>撰写或编辑</span></button>
            <button type="button" onClick={() => chooseSuggestion('web')}><Icon name="globe"/><span>搜索网页</span></button>
          </div>}
        </div>
      </main>}
    </section>

    {lockedHint && <div className="free-toast" role="status">此功能需要升级</div>}
  </div>
}
