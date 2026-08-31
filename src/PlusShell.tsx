import {
  useEffect,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './PlusShell.css'

export type PlusMode = 'chat' | 'work'
export type WorkspacePlanVariant = 'free' | 'plus' | 'pro'
export type WorkspaceCapabilities = {
  work: boolean
  images: boolean
  webSearch: boolean
  plugins: boolean
  deepResearch: boolean
  files: boolean
}

const ALL_WORKSPACE_CAPABILITIES: WorkspaceCapabilities = {
  work: true,
  images: true,
  webSearch: true,
  plugins: true,
  deepResearch: true,
  files: true,
}

export type PlusDestination =
  | 'new-chat'
  | 'search'
  | 'library'
  | 'projects'
  | 'scheduled'
  | 'plugins'
  | 'more'

export type PlusSuggestionId = 'create-image' | 'write' | 'web-search'

export type PlusConversation = {
  id: string
  title: string
  createdAt?: string | null
  updatedAt?: string | null
}

export type HistoryLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export type WorkspaceUsageView = {
  status: 'loading' | 'available' | 'unavailable'
  unlimited?: boolean
  remainingPercent: number | null
  limitReached: boolean | null
  windowDurationMins: number | null
  resetsAt: number | string | null
  message?: string | null
}

export type PlusTurn = {
  id: string | number
  role: 'user' | 'assistant'
  text: string
  attachments?: readonly ComposerAttachment[]
  stopped?: boolean
}

export type PlusMicState = 'idle' | 'requesting' | 'listening' | 'transcribing' | 'error'
export type AttachmentSource = 'picker' | 'drop' | 'paste'
export type ComposerAttachment = {
  id: string
  file: File
  source: AttachmentSource
}
export type ComposerSubmission = {
  text: string
  attachments: readonly ComposerAttachment[]
}

const DEFAULT_PLUS_CONVERSATIONS: PlusConversation[] = [
  { id: 'phone-screen', title: '查看手机屏幕方法' },
  { id: 'model-difference', title: '模型区别说明' },
  { id: 'awning', title: '遮阳棚内避阳人物' },
  { id: 'restore-uuid', title: '还原链接_uuid' },
  { id: 'signboard', title: '修改牌匾设计' },
  { id: 'three-view-outfit', title: '制作三视图换装' },
  { id: 'ai-history', title: '研究AI发展史' },
  { id: 'income', title: '月入十万计算' },
  { id: 'chibi', title: '生成Q版形象' },
  { id: 'comic-portrait', title: '创建漫画肖像' },
  { id: 'mini-world', title: '创建迷你世界 ⸜(｡˃ ᵕ ˂ )⸝' },
  { id: 'chibi-three-view', title: '生成Q版三视图' },
  { id: 'snake-coordinate', title: '解释蛇头坐标计算' },
  { id: 'python', title: 'Python入门教学' },
  { id: 'language', title: '选择编程语言' },
  { id: 'hello', title: '问候交流' },
  { id: 'study', title: '查找学习模式' },
  { id: 'snake', title: '制作贪吃蛇' },
  { id: 'pricing-model', title: '模型价格配置方法' },
  { id: 'school-video', title: '学校宣传片创意方案' },
  { id: 'travel', title: '三天旅行行程规划' },
]

type SpriteIconName =
  | 'compose'
  | 'search'
  | 'sidebar'
  | 'images'
  | 'plugins'
  | 'attachment'
  | 'microphone'

const PLUS_SPRITE_IDS: Record<SpriteIconName, string> = {
  compose: 'lightweight-sidebar-compose',
  search: 'lightweight-sidebar-search',
  sidebar: 'lightweight-sidebar-sidebar',
  images: 'lightweight-sidebar-images',
  plugins: 'lightweight-sidebar-plugins',
  attachment: 'lightweight-composer-add-attachment',
  microphone: 'lightweight-composer-microphone',
}

function SpriteIcon({ name, size = 20, className = '' }: { name: SpriteIconName; size?: number; className?: string }) {
  return (
    <svg aria-hidden="true" className={className} height={size} viewBox="0 0 20 20" width={size}>
      <use href={`/chatgpt-icons.svg#${PLUS_SPRITE_IDS[name]}`} />
    </svg>
  )
}

type LineIconName =
  | 'library'
  | 'folder'
  | 'clock'
  | 'more'
  | 'chevron-down'
  | 'image'
  | 'pen'
  | 'globe'
  | 'store'
  | 'close'
  | 'send'
  | 'stop'
  | 'copy'
  | 'check'
  | 'share'
  | 'menu'

function LineIcon({ name, size = 20, className = '' }: { name: LineIconName; size?: number; className?: string }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 1.6,
  }

  let drawing: ReactNode
  switch (name) {
    case 'library':
      drawing = (
        <>
          <rect height="11.5" rx=".45" width="2.15" x="2.55" y="4.25" />
          <rect height="11.5" rx=".45" width="2.15" x="6.35" y="4.25" />
          <path d="m10.85 4.8 2.15-.6 3.25 11-2.2.6-3.2-11Z" />
        </>
      )
      break
    case 'folder':
      drawing = <path d="M2.5 5.35c0-.8.65-1.45 1.45-1.45H8l1.55 1.65h6.5c.8 0 1.45.65 1.45 1.45v7.05c0 .8-.65 1.45-1.45 1.45H3.95c-.8 0-1.45-.65-1.45-1.45v-8.7Z" />
      break
    case 'clock':
      drawing = (
        <>
          <circle cx="10" cy="10" r="7.25" />
          <path d="M10 5.8v4.55l-2.8 1.8" />
        </>
      )
      break
    case 'more':
      drawing = (
        <>
          <circle cx="4" cy="10" r="1" fill="currentColor" stroke="none" />
          <circle cx="10" cy="10" r="1" fill="currentColor" stroke="none" />
          <circle cx="16" cy="10" r="1" fill="currentColor" stroke="none" />
        </>
      )
      break
    case 'chevron-down':
      drawing = <path d="m6.5 8 3.5 3.5L13.5 8" />
      break
    case 'image':
      drawing = (
        <>
          <rect x="3" y="3" width="14" height="14" rx="2" />
          <circle cx="7.1" cy="7.15" r="1.25" />
          <path d="m4.5 14 3.65-3.55 2.5 2.35 1.85-1.7 3 2.9" />
        </>
      )
      break
    case 'pen':
      drawing = (
        <>
          <path d="m4 16 1.2-4.15L13.9 3.2a1.55 1.55 0 0 1 2.2 0l.7.7a1.55 1.55 0 0 1 0 2.2l-8.65 8.7L4 16Z" />
          <path d="m12.8 4.3 2.9 2.9M5.2 11.85l2.95 2.95" />
        </>
      )
      break
    case 'globe':
      drawing = (
        <>
          <circle cx="10" cy="10" r="7" />
          <path d="M3.2 10h13.6M10 3c2 1.9 3 4.25 3 7s-1 5.1-3 7c-2-1.9-3-4.25-3-7s1-5.1 3-7Z" />
        </>
      )
      break
    case 'store':
      drawing = (
        <>
          <path d="m3.35 7.4.9-3.2h11.5l.9 3.2" />
          <path d="M4.1 9.25v6.2h11.8v-6.2M7.55 15.45v-4.1h4.9v4.1" />
          <path d="M3 7.4c0 1.25.8 2.05 1.85 2.05.95 0 1.7-.6 1.95-1.55.25.95 1 1.55 1.95 1.55s1.7-.6 1.95-1.55c.25.95 1 1.55 1.95 1.55 1.05 0 1.85-.8 1.85-2.05" />
        </>
      )
      break
    case 'close':
      drawing = <path d="m5 5 10 10M15 5 5 15" />
      break
    case 'send':
      drawing = (
        <>
          <path d="M10 15V5" />
          <path d="m6 9 4-4 4 4" />
        </>
      )
      break
    case 'stop':
      drawing = <rect fill="currentColor" height="7" rx="1.15" stroke="none" width="7" x="6.5" y="6.5" />
      break
    case 'copy':
      drawing = (
        <>
          <rect height="10.5" rx="1.65" width="10.5" x="6.25" y="6.25" />
          <path d="M13.25 6.25V4.9c0-.9-.73-1.65-1.65-1.65H4.9c-.9 0-1.65.74-1.65 1.65v6.7c0 .92.74 1.65 1.65 1.65h1.35" />
        </>
      )
      break
    case 'check':
      drawing = <path d="m4.4 10.25 3.45 3.5L15.8 5.8" />
      break
    case 'share':
      drawing = (
        <>
          <path d="M10 12.75V3.5" />
          <path d="m6.5 7 3.5-3.5L13.5 7" />
          <path d="M5.25 9.75H4.5c-.7 0-1.25.55-1.25 1.25v4.5c0 .7.55 1.25 1.25 1.25h11c.7 0 1.25-.55 1.25-1.25V11c0-.7-.55-1.25-1.25-1.25h-.75" />
        </>
      )
      break
    case 'menu':
      drawing = <><path d="M3.5 6.25h13" /><path d="M3.5 12.75h8.25" /></>
      break
  }

  return (
    <svg aria-hidden="true" className={className} height={size} viewBox="0 0 20 20" width={size} {...common}>
      {drawing}
    </svg>
  )
}

function VoiceIcon() {
  return (
    <svg aria-hidden="true" className="plus-voice-bars" viewBox="0 0 20 20">
      <rect height="4" rx=".85" width="1.7" x="3.25" y="8" />
      <rect height="8.5" rx=".85" width="1.7" x="6.2" y="5.75" />
      <rect height="12.5" rx=".85" width="1.7" x="9.15" y="3.75" />
      <rect height="8" rx=".85" width="1.7" x="12.1" y="6" />
      <rect height="4" rx=".85" width="1.7" x="15.05" y="8" />
    </svg>
  )
}

function ChatGPTMark({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 20 20">
      <use href="/chatgpt-icons.svg#chatgpt-mark" />
    </svg>
  )
}

function TemporaryChatIcon({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 20 20">
      <path d="M16.6 10a6.6 6.6 0 1 1-1.93-4.67" stroke="currentColor" strokeLinecap="round" strokeWidth="1.55" />
      <path d="M14.6 2.9v2.55h2.55" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.55" />
    </svg>
  )
}

type PlusNavRowProps = {
  active?: boolean
  children: ReactNode
  icon: ReactNode
  onClick?: (anchor: HTMLButtonElement) => void
}

function PlusNavRow({ active = false, children, icon, onClick }: PlusNavRowProps) {
  return (
    <button className={`plus-nav-row${active ? ' is-active' : ''}`} onClick={(event) => onClick?.(event.currentTarget)} type="button">
      <span className="plus-nav-icon">{icon}</span>
      <span className="plus-nav-label">{children}</span>
    </button>
  )
}

function usageWindowLabel(minutes: number | null) {
  if (minutes !== null && Number.isFinite(minutes) && minutes > 0) {
    if (Math.abs(minutes - 300) <= 15) return '5 小时上限'
    if (Math.abs(minutes - 1_440) <= 72) return '每日上限'
    if (Math.abs(minutes - 10_080) <= 504) return '每周上限'
    if (minutes >= 1_440) return `${Math.round(minutes / 1_440)} 天上限`
    if (minutes >= 60) return `${Math.round(minutes / 60)} 小时上限`
    return `${Math.round(minutes)} 分钟上限`
  }
  return '工作用量'
}

function formatUsageReset(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null
  let date: Date
  if (typeof value === 'number') date = new Date(value < 10_000_000_000 ? value * 1_000 : value)
  else if (/^\d+(?:\.\d+)?$/.test(value.trim())) {
    const numeric = Number(value)
    date = new Date(numeric < 10_000_000_000 ? numeric * 1_000 : numeric)
  } else date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export type PlusSidebarProps = {
  conversations?: PlusConversation[]
  historyStatus?: HistoryLoadStatus
  activeConversationId?: string | null
  accountName?: string
  planLabel?: string
  planVariant?: WorkspacePlanVariant
  capabilities?: WorkspaceCapabilities
  showUsageCard?: boolean
  usage?: WorkspaceUsageView
  initials?: string
  mobileOpen?: boolean
  onCloseMobile?: () => void
  onCollapse?: () => void
  onNavigate?: (destination: PlusDestination, anchor?: HTMLElement) => void
  onConversationSelect?: (conversation: PlusConversation) => void
  onConversationMenu?: (conversation: PlusConversation, anchor: HTMLElement) => void
  onHistoryRetry?: () => void
  onUsageRetry?: () => void
  onAccountClick?: (anchor: HTMLElement) => void
}

export function PlusSidebar({
  conversations = DEFAULT_PLUS_CONVERSATIONS,
  historyStatus = 'ready',
  activeConversationId = null,
  accountName = 'Cody Thomas',
  planLabel = 'Plus',
  planVariant = 'plus',
  capabilities = ALL_WORKSPACE_CAPABILITIES,
  showUsageCard = false,
  usage,
  initials = 'CT',
  mobileOpen = false,
  onCloseMobile,
  onCollapse,
  onNavigate,
  onConversationSelect,
  onConversationMenu,
  onHistoryRetry,
  onUsageRetry,
  onAccountClick,
}: PlusSidebarProps) {
  const navigate = (destination: PlusDestination, anchor?: HTMLElement) => {
    onNavigate?.(destination, anchor)
    if (destination !== 'more') onCloseMobile?.()
  }

  const handleConversationMenu = (event: MouseEvent<HTMLButtonElement>, conversation: PlusConversation) => {
    event.stopPropagation()
    onConversationMenu?.(conversation, event.currentTarget)
  }

  const remainingPercent = usage?.status === 'available' ? usage.remainingPercent : null
  const usageTitle = usageWindowLabel(usage?.windowDurationMins ?? null)
  const usageCopy = usage?.status === 'loading'
    ? '查询中…'
    : usage?.status === 'available'
      ? usage.unlimited ? '无限 / 可用' : remainingPercent === null ? '剩余量不可用' : `剩余 ${remainingPercent}%`
      : '暂不可用'

  return (
    <aside
      aria-label="历史聊天记录"
      className={`plus-sidebar is-plan-${planVariant}${mobileOpen ? ' is-mobile-open' : ''}`}
      data-plan={planVariant}
      id="plus-history-sidebar"
    >
      <div className="plus-sidebar-header">
        <button className="plus-brand" onClick={(event) => navigate('new-chat', event.currentTarget)} type="button">
          <ChatGPTMark className="plus-mobile-brand-mark" />
          <span className="plus-brand-text">ChatGPT</span>
        </button>
        <div className="plus-sidebar-head-actions">
          <button aria-label="搜索聊天" className="plus-icon-button" onClick={(event) => navigate('search', event.currentTarget)} type="button">
            <SpriteIcon name="search" />
          </button>
          <button aria-label="关闭侧栏" className="plus-icon-button plus-desktop-collapse" onClick={onCollapse} type="button">
            <SpriteIcon name="sidebar" />
          </button>
          <button aria-label="关闭侧栏" className="plus-icon-button plus-mobile-close" onClick={onCloseMobile} type="button">
            <LineIcon name="close" />
          </button>
        </div>
      </div>

      <nav aria-label="主要导航" className="plus-primary-nav">
        <PlusNavRow active icon={<SpriteIcon name="compose" />} onClick={(anchor) => navigate('new-chat', anchor)}>新聊天</PlusNavRow>
        <PlusNavRow icon={<LineIcon name="library" />} onClick={(anchor) => navigate('library', anchor)}>资料库</PlusNavRow>
        <PlusNavRow icon={<LineIcon name="folder" />} onClick={(anchor) => navigate('projects', anchor)}>项目</PlusNavRow>
        <PlusNavRow icon={<LineIcon name="clock" />} onClick={(anchor) => navigate('scheduled', anchor)}>已安排</PlusNavRow>
        {capabilities.plugins ? <PlusNavRow icon={<SpriteIcon name="plugins" />} onClick={(anchor) => navigate('plugins', anchor)}>插件</PlusNavRow> : null}
        <PlusNavRow icon={<LineIcon name="more" />} onClick={(anchor) => navigate('more', anchor)}>更多</PlusNavRow>
      </nav>

      <section aria-labelledby="plus-recent-heading" className="plus-history-section">
        <h2 id="plus-recent-heading">最近</h2>
        <div className="plus-history-list" role="list">
          {historyStatus === 'loading' && conversations.length === 0 ? (
            <div className="plus-history-status" role="status">正在加载聊天…</div>
          ) : null}
          {historyStatus === 'error' ? (
            <div className="plus-history-status is-error" role="alert">
              <span>聊天记录暂不可用</span>
              <button type="button" onClick={onHistoryRetry}>重试</button>
            </div>
          ) : null}
          {conversations.map((conversation) => {
            const selected = activeConversationId === conversation.id
            return (
              <div className={`plus-history-row${selected ? ' is-selected' : ''}`} key={conversation.id} role="listitem">
                <button
                  aria-current={selected ? 'page' : undefined}
                  className="plus-history-main"
                  onClick={() => {
                    onConversationSelect?.(conversation)
                    onCloseMobile?.()
                  }}
                  title={conversation.title}
                  type="button"
                >
                  <span>{conversation.title}</span>
                </button>
                <button
                  aria-label={`${conversation.title}的选项`}
                  className="plus-history-more"
                  onClick={(event) => handleConversationMenu(event, conversation)}
                  type="button"
                >
                  <LineIcon name="more" size={18} />
                </button>
              </div>
            )
          })}
        </div>
      </section>

      {showUsageCard ? <aside aria-label="工作用量" className={`plus-usage-card is-${usage?.status ?? 'unavailable'}`}>
        <div className="plus-usage-card-row">
          <span>{usageTitle}</span>
          {usage?.status === 'unavailable' ? <button type="button" onClick={onUsageRetry}>重试</button> : <span>{usageCopy}</span>}
        </div>
        <div
          aria-label={remainingPercent === null ? undefined : `剩余 ${remainingPercent}%`}
          aria-valuemax={remainingPercent === null ? undefined : 100}
          aria-valuemin={remainingPercent === null ? undefined : 0}
          aria-valuenow={remainingPercent ?? undefined}
          className="plus-usage-track"
          role={remainingPercent === null ? undefined : 'progressbar'}
        ><span style={{ width: remainingPercent === null ? undefined : `${remainingPercent}%` }} /></div>
      </aside> : null}

      <div className="plus-account-wrap">
        <button
          aria-haspopup="menu"
          className="plus-account-row"
          onClick={(event) => onAccountClick?.(event.currentTarget)}
          type="button"
        >
          <span aria-hidden="true" className="plus-avatar">{initials}</span>
          <span className="plus-account-copy">
            <strong>{accountName}</strong>
            <small>{planLabel}</small>
          </span>
          <LineIcon className="plus-account-store" name="store" size={19} />
        </button>
      </div>
    </aside>
  )
}

export type PlusTopBarProps = {
  mode: PlusMode
  workEnabled?: boolean
  sidebarCollapsed?: boolean
  onModeChange?: (mode: PlusMode) => void
  onOpenSidebar?: () => void
  onNewChat?: () => void
}

export function PlusTopBar({ mode, workEnabled = true, sidebarCollapsed = false, onModeChange, onOpenSidebar, onNewChat }: PlusTopBarProps) {
  return (
    <header className={`plus-topbar is-${mode}`}>
      <div className="plus-mobile-topbar">
        <button
          aria-controls="plus-history-sidebar"
          aria-label="打开侧栏"
          className="plus-icon-button"
          onClick={onOpenSidebar}
          type="button"
        >
          <LineIcon name="menu" size={22} />
        </button>
        <button
          aria-label={workEnabled ? '切换模式' : '聊天'}
          className="plus-mobile-title"
          onClick={() => workEnabled && onModeChange?.(mode === 'chat' ? 'work' : 'chat')}
          type="button"
        >
          <span>{mode === 'chat' ? '聊天' : '工作'}</span>
          {workEnabled ? <LineIcon name="chevron-down" size={17} /> : null}
        </button>
        <button aria-label="临时聊天" className="plus-icon-button" onClick={onNewChat} type="button">
          <TemporaryChatIcon className="plus-mobile-temp-icon" />
        </button>
      </div>

      {sidebarCollapsed && (
        <button
          aria-controls="plus-history-sidebar"
          aria-label="打开侧栏"
          className="plus-icon-button plus-desktop-open-sidebar"
          onClick={onOpenSidebar}
          type="button"
        >
          <SpriteIcon name="sidebar" />
        </button>
      )}

      <div aria-label="模式" className={`plus-mode-switch${workEnabled ? '' : ' is-single'}`} role="tablist">
        <button
          aria-selected={mode === 'chat'}
          className={mode === 'chat' ? 'is-active' : ''}
          onClick={() => onModeChange?.('chat')}
          role="tab"
          type="button"
        >聊天</button>
        {workEnabled ? <button
            aria-selected={mode === 'work'}
            className={mode === 'work' ? 'is-active' : ''}
            onClick={() => onModeChange?.('work')}
            role="tab"
            type="button"
          >工作</button> : null}
      </div>

      <span aria-hidden="true" className="plus-status-glyph">
        <TemporaryChatIcon />
      </span>
    </header>
  )
}

function formatAttachmentSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`
}

function AttachmentFileIcon() {
  return (
    <svg aria-hidden="true" className="plus-attachment-file-icon" viewBox="0 0 24 24">
      <path d="M7.5 2.75h6.1l4.9 4.9v11.1a2.5 2.5 0 0 1-2.5 2.5H7.5a2.5 2.5 0 0 1-2.5-2.5V5.25a2.5 2.5 0 0 1 2.5-2.5Z" />
      <path d="M13.25 2.95v4.9h4.9" />
    </svg>
  )
}

function PlusAttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: ComposerAttachment
  onRemove?: (id: string) => void
}) {
  const { file } = attachment
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!file.type.startsWith('image/')) {
      setPreviewUrl(null)
      return
    }
    const nextUrl = URL.createObjectURL(file)
    setPreviewUrl(nextUrl)
    return () => URL.revokeObjectURL(nextUrl)
  }, [file])

  return (
    <article className="plus-attachment-chip" title={file.name}>
      <div className={`plus-attachment-preview${previewUrl ? ' has-image' : ''}`}>
        {previewUrl ? <img alt="" src={previewUrl} /> : <AttachmentFileIcon />}
      </div>
      <div className="plus-attachment-copy">
        <strong>{file.name}</strong>
        <span>{file.type || '文件'} · {formatAttachmentSize(file.size)}</span>
      </div>
      {onRemove && (
        <button
          aria-label={`移除 ${file.name}`}
          className="plus-attachment-remove"
          onClick={() => onRemove(attachment.id)}
          type="button"
        >
          <LineIcon name="close" size={14} />
        </button>
      )}
    </article>
  )
}

function MicActivity({ state }: { state: PlusMicState }) {
  if (state === 'requesting' || state === 'transcribing') {
    return <span aria-hidden="true" className={`plus-mic-spinner is-${state}`} />
  }
  if (state === 'listening') {
    return <span aria-hidden="true" className="plus-mic-wave"><i /><i /><i /><i /></span>
  }
  return <SpriteIcon name="microphone" size={24} />
}

export type PlusComposerActionsProps = {
  value?: string
  mode?: PlusMode
  modelLabel?: string
  effortLabel?: string
  planVariant?: WorkspacePlanVariant
  placeholder?: string
  attachments?: readonly ComposerAttachment[]
  micState?: PlusMicState
  dictationSupported?: boolean
  onValueChange?: (value: string) => void
  onSubmit?: (payload: ComposerSubmission) => void
  onFilesAdded?: (files: readonly File[], source: AttachmentSource) => void
  onRemoveAttachment?: (id: string) => void
  onAttachmentClick?: (anchor: HTMLElement) => void
  onEffortClick?: (anchor: HTMLElement) => void
  onMicrophoneClick?: (anchor: HTMLElement) => void
  onVoiceClick?: (anchor: HTMLElement) => void
  isGenerating?: boolean
  onStopGenerating?: () => void
}

export function PlusComposerActions({
  value,
  mode = 'chat',
  modelLabel = '5.6 Sol',
  effortLabel = '轻度',
  planVariant = 'plus',
  placeholder = '问问 ChatGPT',
  attachments = [],
  micState = 'idle',
  dictationSupported = true,
  onValueChange,
  onSubmit,
  onFilesAdded,
  onRemoveAttachment,
  onAttachmentClick,
  onEffortClick,
  onMicrophoneClick,
  onVoiceClick,
  isGenerating = false,
  onStopGenerating,
}: PlusComposerActionsProps) {
  const [internalValue, setInternalValue] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const text = value ?? internalValue
  const textareaId = useId()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dragDepthRef = useRef(0)

  const setText = (next: string) => {
    if (value === undefined) setInternalValue(next)
    onValueChange?.(next)
  }

  const resizeTextarea = (textarea: HTMLTextAreaElement) => {
    textarea.style.height = '24px'
    textarea.style.height = `${Math.min(textarea.scrollHeight, mode === 'work' ? 104 : 120)}px`
  }

  const submit = () => {
    if (isGenerating) return
    const trimmed = text.trim()
    if (!trimmed && attachments.length === 0) return
    onSubmit?.({ text: trimmed, attachments: [...attachments] })
    if (value === undefined) setInternalValue('')
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (textarea) textarea.style.height = '24px'
    })
  }

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    resizeTextarea(event.currentTarget)
    setText(event.currentTarget.value)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    submit()
  }

  const addTransferFiles = (files: Iterable<File>, source: AttachmentSource) => {
    const nextFiles = Array.from(files)
    if (nextFiles.length) onFilesAdded?.(nextFiles, source)
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (!pastedFiles.length) return
    addTransferFiles(pastedFiles, 'paste')
    if (!event.clipboardData.getData('text/plain')) event.preventDefault()
  }

  const handleDragEnter = (event: DragEvent<HTMLFormElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dragDepthRef.current += 1
    setIsDragging(true)
  }

  const handleDragLeave = (event: DragEvent<HTMLFormElement>) => {
    if (!isDragging) return
    event.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setIsDragging(false)
  }

  const handleDrop = (event: DragEvent<HTMLFormElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dragDepthRef.current = 0
    setIsDragging(false)
    addTransferFiles(event.dataTransfer.files, 'drop')
  }

  const handleDragOver = (event: DragEvent<HTMLFormElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const micLabel = micState === 'listening'
    ? '停止听写'
    : micState === 'requesting'
      ? '正在请求麦克风权限'
      : micState === 'transcribing'
        ? '正在转写'
        : '开始听写'

  const canSubmit = Boolean(text.trim() || attachments.length)

  return (
    <form
      aria-label="消息输入"
      className={`plus-composer is-${mode} is-plan-${planVariant}${attachments.length ? ' has-attachments' : ''}${isDragging ? ' is-dragging' : ''}${micState !== 'idle' ? ` is-mic-${micState}` : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onSubmit={handleSubmit}
    >
      <div className="plus-composer-primary">
        {attachments.length > 0 && (
          <div aria-label="已添加的文件" className="plus-attachment-strip">
            {attachments.map((attachment) => (
              <PlusAttachmentChip
                attachment={attachment}
                key={attachment.id}
                onRemove={onRemoveAttachment}
              />
            ))}
          </div>
        )}
        <label className="plus-sr-only" htmlFor={textareaId}>与 ChatGPT 聊天</label>
        <textarea
          aria-label="与 ChatGPT 聊天"
          id={textareaId}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder}
          ref={textareaRef}
          rows={1}
          value={text}
        />
      </div>
      {isDragging && <div aria-hidden="true" className="plus-composer-drop-target">松开即可添加文件</div>}
      <div className="plus-composer-footer">
        <button
          aria-haspopup="menu"
          aria-label="添加文件等"
          className="plus-composer-icon plus-attachment-button"
          onClick={(event) => onAttachmentClick?.(event.currentTarget)}
          type="button"
        >
          <SpriteIcon name="attachment" size={20} />
        </button>
        <div className="plus-composer-end">
        <button
          aria-label={`${modelLabel} ${effortLabel}`}
          aria-haspopup="menu"
          className="plus-effort-button"
          onClick={(event) => onEffortClick?.(event.currentTarget)}
          type="button"
        >
          {modelLabel ? <span className="plus-effort-model">{modelLabel}</span> : null}
          {effortLabel ? <span className="plus-effort-level">{effortLabel}</span> : null}
          <LineIcon name="chevron-down" size={14} />
        </button>
        <button
          aria-label={micLabel}
          aria-pressed={micState === 'listening'}
          className={`plus-composer-icon plus-mic-button is-${micState}`}
          disabled={micState === 'requesting' || micState === 'transcribing'}
          onClick={(event) => onMicrophoneClick?.(event.currentTarget)}
          title={!dictationSupported ? '当前浏览器不支持语音听写' : undefined}
          type="button"
        >
          <MicActivity state={micState} />
        </button>
        {isGenerating ? (
          <button aria-label="停止生成" className="plus-submit-button" onClick={onStopGenerating} type="button">
            <LineIcon name="stop" size={20} />
          </button>
        ) : canSubmit ? (
          <button aria-label="发送消息" className="plus-submit-button" type="submit">
            <LineIcon name="send" size={20} />
          </button>
        ) : mode === 'chat' ? (
          <button
            aria-label="启动语音模式"
            className="plus-voice-button"
            onClick={(event) => onVoiceClick?.(event.currentTarget)}
            type="button"
          >
            <VoiceIcon />
          </button>
        ) : null}
        </div>
      </div>
    </form>
  )
}

export type PlusWelcomeProps = PlusComposerActionsProps & {
  mode?: PlusMode
  capabilities?: WorkspaceCapabilities
  usage?: WorkspaceUsageView
  onUsageRetry?: () => void
  onSuggestionClick?: (suggestion: PlusSuggestionId) => void
  onWorkNavigate?: (destination: 'projects' | 'plugins') => void
}

const PLUS_SUGGESTIONS: Array<{ id: PlusSuggestionId; label: string; icon: LineIconName }> = [
  { id: 'create-image', label: '创建图像或贴纸', icon: 'image' },
  { id: 'write', label: '撰写或编辑', icon: 'pen' },
  { id: 'web-search', label: '搜索网页', icon: 'globe' },
]

export function PlusWelcome({
  mode = 'chat',
  capabilities = ALL_WORKSPACE_CAPABILITIES,
  usage,
  onUsageRetry,
  onSuggestionClick,
  onWorkNavigate,
  ...composerProps
}: PlusWelcomeProps) {
  if (mode === 'work') {
    const remaining = usage?.status === 'available' ? usage.remainingPercent : null
    // Missing quota data is not proof of exhaustion. Only the two authoritative
    // backend signals below may render the exhausted experience.
    const exhausted = usage?.status === 'available' && usage.unlimited !== true
      && (usage.limitReached === true || remaining === 0)
    const reset = formatUsageReset(usage?.resetsAt)
    const statusTitle = usage?.status === 'loading'
      ? '正在查询工作用量'
      : usage?.status === 'unavailable'
        ? '工作用量暂不可用'
        : exhausted
          ? '你暂时已用完工作用量'
          : '工作用量可用'
    const statusDetail = usage?.status === 'loading'
      ? '正在从当前 Session 加载实时额度…'
      : usage?.status === 'unavailable'
        ? usage.message || '暂时无法确认剩余用量，请重试。'
        : exhausted
          ? `升级或添加额度以立即继续使用工作${reset ? `，或等待用量在 ${reset} 重置` : ''}`
          : usage?.unlimited
            ? '当前账号可用，没有需要显示的剩余百分比。'
          : remaining === null
            ? '已连接用量服务，但当前窗口未返回剩余百分比。'
            : `当前窗口剩余 ${remaining}%${reset ? `，${reset} 重置` : ''}。`
    return (
      <main className="plus-home-main is-work">
        <div className="plus-welcome is-work">
          <div className="plus-work-stack">
            <h1>我们该做什么？</h1>
            <aside className={`plus-work-usage-banner is-${usage?.status ?? 'unavailable'}${exhausted ? ' is-exhausted' : ''}`}>
              <div className="plus-work-usage-copy">
                <strong>{statusTitle}</strong>
                <span>{statusDetail}</span>
              </div>
              {usage?.status === 'unavailable' ? (
                <div className="plus-work-usage-actions"><button className="plus-work-primary-button" type="button" onClick={onUsageRetry}>重试</button></div>
              ) : exhausted ? (
                <div className="plus-work-usage-actions">
                  <button className="plus-work-secondary-button" type="button">升级</button>
                  <button className="plus-work-primary-button" type="button">添加额度</button>
                </div>
              ) : null}
            </aside>
            <PlusComposerActions {...composerProps} mode="work" />
            <div className="plus-work-toolbar">
              <div className="plus-work-toolbar-inner">
                <button className="plus-work-project-button" onClick={() => onWorkNavigate?.('projects')} type="button"><LineIcon name="folder" size={20} /><span>选择项目</span></button>
                {capabilities.plugins ? <button className="plus-work-plugin-button" onClick={() => onWorkNavigate?.('plugins')} type="button">
                  <span>插件</span>
                  <span aria-hidden="true" className="plus-work-plugin-stack">
                    <svg className="plus-work-plugin-plus" viewBox="0 0 16 16"><path d="M8 2.475a.525.525 0 0 1 .525.525v4.475H13a.525.525 0 1 1 0 1.05H8.525V13a.525.525 0 1 1-1.05 0V8.525H3a.525.525 0 1 1 0-1.05h4.475V3A.525.525 0 0 1 8 2.475Z" /></svg>
                    <span className="plus-work-plugin-logo">
                      <svg viewBox="0 0 24 24"><path d="M12 2.7a9.5 9.5 0 0 0-3 18.5c.5.1.65-.2.65-.46v-1.82c-2.78.6-3.37-1.18-3.37-1.18-.45-1.17-1.12-1.48-1.12-1.48-.92-.63.07-.62.07-.62 1.02.07 1.55 1.04 1.55 1.04.9 1.55 2.37 1.1 2.95.84.09-.65.35-1.1.64-1.35-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.5 9.5 0 0 1 12 6.65c.85 0 1.7.11 2.5.34 1.9-1.29 2.74-1.02 2.74-1.02.55 1.37.2 2.39.1 2.64.64.7 1.02 1.59 1.02 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.86v2.66c0 .26.17.57.67.46A9.5 9.5 0 0 0 12 2.7Z" /></svg>
                    </span>
                  </span>
                </button> : null}
                <span className="plus-work-toolbar-spacer" />
                <button className="plus-work-desktop-button" type="button">
                  <svg aria-hidden="true" viewBox="0 0 20 20"><rect height="11" rx="1.4" width="15" x="2.5" y="3" /><path d="M7 17h6M10 14v3" /></svg>
                  <span>下载桌面应用</span>
                </button>
              </div>
            </div>
          </div>
          <section aria-label="认识 ChatGPT Work" className="plus-work-onboarding">
            <img alt="" aria-hidden="true" src="/work-onboarding-collage.png" />
            <h2>认识 ChatGPT <span>Work</span></h2>
            <p>ChatGPT Work 可以帮你完成工作。它能打开浏览器、创建文档、使用真实工具，并执行多步骤任务。</p>
            <div className="plus-work-onboarding-actions">
              <button onClick={() => onSuggestionClick?.('web-search')} type="button"><span aria-hidden="true">💡</span>看看“工作”有哪些功能</button>
              <button onClick={() => onSuggestionClick?.('write')} type="button"><span aria-hidden="true">🌈</span>为我个性化设置工作</button>
            </div>
          </section>
        </div>
      </main>
    )
  }

  return (
    <main className="plus-home-main">
      <div className="plus-welcome">
        <h1>我们先从哪里开始呢？</h1>
        <PlusComposerActions {...composerProps} mode="chat" />
        <div aria-label="建议" className="plus-suggestions">
          {PLUS_SUGGESTIONS.filter((suggestion) => (
            (suggestion.id !== 'create-image' || capabilities.images)
            && (suggestion.id !== 'web-search' || capabilities.webSearch)
          )).map((suggestion) => (
            <button className="plus-suggestion-row" key={suggestion.id} onClick={() => onSuggestionClick?.(suggestion.id)} type="button">
              <LineIcon name={suggestion.icon} size={19} />
              <span>{suggestion.label}</span>
            </button>
          ))}
        </div>
      </div>
    </main>
  )
}

type PlusConversationSurfaceProps = PlusWelcomeProps & {
  turns: PlusTurn[]
  isGenerating?: boolean
  onStopGenerating?: () => void
}

function PlusTurnMarkdown({ text }: { text: string }) {
  return (
    <div className="plus-turn-markdown">
      <ReactMarkdown
        components={{
          a: ({ children, node: _node, ...props }) => <a {...props} rel="noreferrer" target="_blank">{children}</a>,
        }}
        remarkPlugins={[remarkGfm]}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
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

function PlusConversationSurface({ turns, isGenerating = false, onStopGenerating, ...composerProps }: PlusConversationSurfaceProps) {
  const [copiedTurnId, setCopiedTurnId] = useState<PlusTurn['id'] | null>(null)
  const copyResetTimer = useRef<number | null>(null)

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
      await writeConversationText(turn.text)
      showCopiedState(turn.id)
    } catch {
      // Clipboard access can be denied without a secure browser context.
    }
  }

  const shareTurn = async (turn: PlusTurn) => {
    try {
      if (navigator.share) {
        await navigator.share({ text: turn.text })
        return
      }
      await writeConversationText(turn.text)
      showCopiedState(turn.id)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
    }
  }

  return (
    <main className="plus-conversation-main">
      <div aria-live="polite" className="plus-turn-scroll">
        <div className="plus-turn-list">
          {turns.map((turn, index) => (
            <article className={`plus-turn plus-turn-${turn.role}`} key={turn.id}>
              <div className="plus-turn-content">
                {turn.attachments && turn.attachments.length > 0 && (
                  <div aria-label="消息附件" className="plus-turn-attachments">
                    {turn.attachments.map((attachment) => (
                      <PlusAttachmentChip attachment={attachment} key={attachment.id} />
                    ))}
                  </div>
                )}
                {turn.text && (turn.role === 'assistant'
                  ? <PlusTurnMarkdown text={turn.text} />
                  : <p className="plus-turn-user-text">{turn.text}</p>)}
                {turn.stopped && <span className="plus-turn-stopped">你已停止此回复</span>}
                {turn.role === 'assistant'
                  && turn.text
                  && !(isGenerating && index === turns.length - 1) && (
                    <div aria-label="回复操作" className="plus-turn-actions" role="group">
                      <button
                        aria-label={copiedTurnId === turn.id ? '已复制' : '复制'}
                        className="plus-turn-action"
                        onClick={() => void copyTurn(turn)}
                        title={copiedTurnId === turn.id ? '已复制' : '复制'}
                        type="button"
                      >
                        <LineIcon name={copiedTurnId === turn.id ? 'check' : 'copy'} size={20} />
                      </button>
                      <button
                        aria-label="分享"
                        className="plus-turn-action"
                        onClick={() => void shareTurn(turn)}
                        title="分享"
                        type="button"
                      >
                        <LineIcon name="share" size={20} />
                      </button>
                    </div>
                  )}
              </div>
            </article>
          ))}
          {isGenerating && turns.at(-1)?.role !== 'assistant' && (
            <article aria-label="ChatGPT 正在思考" className="plus-turn plus-turn-assistant plus-turn-thinking">
              <span aria-hidden="true" className="plus-thinking-dots"><i /><i /><i /></span>
            </article>
          )}
        </div>
      </div>
      <div className="plus-conversation-dock">
        <p className="plus-conversation-note">ChatGPT 也可能会犯错。请核查重要信息。</p>
        <PlusComposerActions
          {...composerProps}
          isGenerating={isGenerating}
          onStopGenerating={onStopGenerating}
        />
      </div>
    </main>
  )
}

export type PlusHomeShellProps = Omit<PlusSidebarProps, 'mobileOpen' | 'onCloseMobile' | 'onCollapse' | 'showUsageCard'>
  & Omit<PlusWelcomeProps, 'mode'>
  & {
    children?: ReactNode
    hideTopBar?: boolean
    initialMode?: PlusMode
    mode?: PlusMode
    turns?: PlusTurn[]
    isGenerating?: boolean
    onStopGenerating?: () => void
    sidebarCollapsed?: boolean
    sidebarOpen?: boolean
    onModeChange?: (mode: PlusMode) => void
    onSidebarCollapsedChange?: (collapsed: boolean) => void
    onSidebarOpenChange?: (open: boolean) => void
  }

export function PlusHomeShell({
  children,
  hideTopBar = false,
  initialMode = 'chat',
  mode: controlledMode,
  turns = [],
  isGenerating = false,
  onStopGenerating,
  sidebarCollapsed: controlledCollapsed,
  sidebarOpen: controlledOpen,
  onModeChange,
  onSidebarCollapsedChange,
  onSidebarOpenChange,
  conversations,
  historyStatus,
  activeConversationId,
  accountName,
  capabilities = ALL_WORKSPACE_CAPABILITIES,
  planLabel,
  planVariant,
  initials,
  usage,
  onNavigate,
  onConversationSelect,
  onConversationMenu,
  onHistoryRetry,
  onUsageRetry,
  onAccountClick,
  ...welcomeProps
}: PlusHomeShellProps) {
  const [internalMode, setInternalMode] = useState<PlusMode>(initialMode)
  const [internalCollapsed, setInternalCollapsed] = useState(false)
  const [internalOpen, setInternalOpen] = useState(false)
  const mode = controlledMode ?? internalMode
  const sidebarCollapsed = controlledCollapsed ?? internalCollapsed
  const sidebarOpen = controlledOpen ?? internalOpen

  const setMode = (next: PlusMode) => {
    if (controlledMode === undefined) setInternalMode(next)
    onModeChange?.(next)
  }

  const setCollapsed = (next: boolean) => {
    if (controlledCollapsed === undefined) setInternalCollapsed(next)
    onSidebarCollapsedChange?.(next)
  }

  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(next)
    onSidebarOpenChange?.(next)
  }

  const handleNavigate = (destination: PlusDestination, anchor?: HTMLElement) => {
    if (destination === 'new-chat') setOpen(false)
    onNavigate?.(destination, anchor)
  }

  return (
    <div className={`plus-shell is-plan-${planVariant ?? 'plus'}${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}`} data-plan={planVariant ?? 'plus'}>
      <button
        aria-label="关闭侧栏"
        className={`plus-mobile-scrim${sidebarOpen ? ' is-visible' : ''}`}
        onClick={() => setOpen(false)}
        tabIndex={sidebarOpen ? 0 : -1}
        type="button"
      />
      {!sidebarCollapsed || sidebarOpen ? (
        <PlusSidebar
          activeConversationId={activeConversationId}
          accountName={accountName}
          capabilities={capabilities}
          conversations={conversations}
          historyStatus={historyStatus}
          initials={initials}
          mobileOpen={sidebarOpen}
          onAccountClick={onAccountClick}
          onCloseMobile={() => setOpen(false)}
          onCollapse={() => {
            setCollapsed(true)
            setOpen(false)
          }}
          onConversationMenu={onConversationMenu}
          onConversationSelect={onConversationSelect}
          onHistoryRetry={onHistoryRetry}
          onNavigate={handleNavigate}
          onUsageRetry={onUsageRetry}
          planLabel={planLabel}
          planVariant={planVariant}
          showUsageCard={mode === 'work'}
          usage={usage}
        />
      ) : null}
      <section className="plus-main-surface">
        {!hideTopBar && (
          <PlusTopBar
            mode={mode}
            onModeChange={setMode}
            onNewChat={() => handleNavigate('new-chat')}
            onOpenSidebar={() => {
              setCollapsed(false)
              setOpen(true)
            }}
            sidebarCollapsed={sidebarCollapsed}
            workEnabled={capabilities.work}
          />
        )}
        {children != null ? (
          <div className={`plus-custom-content${hideTopBar ? ' has-no-topbar' : ''}`}>{children}</div>
        ) : turns.length > 0 || isGenerating ? (
          <PlusConversationSurface
            {...welcomeProps}
            isGenerating={isGenerating}
            mode={mode}
            onStopGenerating={onStopGenerating}
            planVariant={planVariant}
            capabilities={capabilities}
            turns={turns}
            usage={usage}
            onUsageRetry={onUsageRetry}
          />
        ) : (
          <PlusWelcome {...welcomeProps} capabilities={capabilities} mode={mode} onUsageRetry={onUsageRetry} onWorkNavigate={handleNavigate} planVariant={planVariant} usage={usage} />
        )}
      </section>
    </div>
  )
}

export default PlusHomeShell
