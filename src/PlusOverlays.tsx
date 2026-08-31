import {
  Archive,
  Blocks,
  Check,
  ChevronRight,
  CircleHelp,
  GraduationCap,
  Image,
  KeyRound,
  LogOut,
  Mail,
  Palette,
  Pencil,
  Search,
  Settings,
  Share2,
  Trash2,
  Unplug,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { ReasoningPicker,
  type ReasoningLevel,
  type ReasoningModelId,
  type ReasoningModelOption,
  type ReasoningPickerView,
  type ReasoningSliderOption,
} from './ReasoningPicker'
import './PlusOverlays.css'

export type PlusPopoverAnchor = RefObject<HTMLElement | null>
export type PlusModelId = ReasoningModelId
export type ReasoningEffort = ReasoningLevel
export type SidebarMoreAction = 'deep-research' | 'study' | 'images' | 'gpts'
export type AttachmentAction =
  | 'upload'
  | 'library'
  | 'create-image'
  | 'web-search'
  | 'deep-research'
  | 'github'
  | 'visualize'
  | 'sites'
  | 'gmail'
  // Kept for callers that used the original compact attachment menu API.
  | 'camera'
  | 'cloud'

type PopoverSide = 'top' | 'bottom'
type PopoverAlign = 'start' | 'end' | 'center'
type PopoverMobileMode = 'sheet' | 'anchored'
type InteractionIconName = 'paperclip' | 'library' | 'create-image-plugin' | 'skill-globe-light' | 'skill-deep-research-light' | 'github-mark'

interface AnchoredPopoverProps {
  open: boolean
  onClose: () => void
  anchorRef?: PlusPopoverAnchor
  ariaLabel: string
  className?: string
  side?: PopoverSide
  align?: PopoverAlign
  width?: number
  offset?: number
  alignOffset?: number
  matchAnchorWidth?: boolean
  mobileMode?: PopoverMobileMode
  mobileWidth?: number | 'anchor'
  children: ReactNode
}

interface MenuActionProps {
  icon: LucideIcon | InteractionIconName
  label: string
  description?: string
  checked?: boolean
  role?: 'menuitem' | 'menuitemradio'
  danger?: boolean
  disabled?: boolean
  accessory?: ReactNode
  onSelect?: () => void
}

function InteractionSpriteIcon({ name }: { name: InteractionIconName }) {
  if (name === 'github-mark') {
    return (
      <svg aria-hidden="true" height="20" viewBox="0 0 24 24" width="20">
        <path d="M12 2.7a9.5 9.5 0 0 0-3 18.5c.5.1.65-.2.65-.46v-1.82c-2.78.6-3.37-1.18-3.37-1.18-.45-1.17-1.12-1.48-1.12-1.48-.92-.63.07-.62.07-.62 1.02.07 1.55 1.04 1.55 1.04.9 1.55 2.37 1.1 2.95.84.09-.65.35-1.1.64-1.35-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.5 9.5 0 0 1 12 6.65c.85 0 1.7.11 2.5.34 1.9-1.29 2.74-1.02 2.74-1.02.55 1.37.2 2.39.1 2.64.64.7 1.02 1.59 1.02 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.86v2.66c0 .26.17.57.67.46A9.5 9.5 0 0 0 12 2.7Z" />
      </svg>
    )
  }
  const size = name === 'paperclip' || name === 'library' ? 20 : 24
  const href = name === 'paperclip'
    ? '/chatgpt-icons.svg#lightweight-composer-actions-paperclip'
    : `/chatgpt-interaction-icons.svg#${name}`
  return (
    <svg aria-hidden="true" height={size} viewBox={`0 0 ${size} ${size}`} width={size}>
      <use href={href} />
    </svg>
  )
}

function useLatest<T>(value: T) {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  }, [value])
  return ref
}

function usePopoverPresence(open: boolean, duration = 150) {
  const [present, setPresent] = useState(open)
  const [active, setActive] = useState(false)

  useEffect(() => {
    // Presence deliberately mirrors the controlled prop so the exit transition can finish.
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

function getMenuItems(menu: HTMLElement) {
  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"], [role="radio"]'))
    .filter((item) => item.getAttribute('aria-disabled') !== 'true' && !item.hidden)
}

function getFocusableItems(menu: HTMLElement) {
  return Array.from(menu.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
  )).filter((item) => !item.hidden && item.getAttribute('aria-hidden') !== 'true')
}

function AnchoredPopover({
  open,
  onClose,
  anchorRef,
  ariaLabel,
  className = '',
  side = 'bottom',
  align = 'start',
  width = 280,
  offset = 6,
  alignOffset = 0,
  matchAnchorWidth = false,
  mobileMode = 'sheet',
  mobileWidth,
  children,
}: AnchoredPopoverProps) {
  const { active, present } = usePopoverPresence(open)
  const onCloseRef = useLatest(onClose)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const [position, setPosition] = useState({ left: -9999, top: -9999, actualSide: side, menuWidth: width })

  useLayoutEffect(() => {
    if (!present || !menuRef.current) return

    const updatePosition = () => {
      const menu = menuRef.current
      if (!menu) return
      const mobileViewport = window.innerWidth <= 640
      if (mobileViewport && mobileMode === 'sheet') return
      const anchor = anchorRef?.current
      const rect = anchor?.getBoundingClientRect() ?? {
        top: window.innerHeight / 2,
        right: window.innerWidth / 2,
        bottom: window.innerHeight / 2,
        left: window.innerWidth / 2,
        width: 0,
        height: 0,
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
        toJSON: () => ({}),
      }
      let measuredWidth = matchAnchorWidth && anchor ? rect.width : width
      if (mobileViewport && typeof mobileWidth === 'number') measuredWidth = mobileWidth
      if (mobileViewport && mobileWidth === 'anchor') {
        measuredWidth = anchor?.getBoundingClientRect().width ?? Math.min(312, window.innerWidth - 24)
      }
      const measuredHeight = menu.offsetHeight
      const margin = 8

      let left = rect.left
      if (align === 'end') left = rect.right - measuredWidth
      if (align === 'center') left = rect.left + (rect.width - measuredWidth) / 2
      left += alignOffset
      left = Math.max(margin, Math.min(left, window.innerWidth - measuredWidth - margin))

      let actualSide: PopoverSide = side
      let top = side === 'top'
        ? rect.top - measuredHeight - offset
        : rect.bottom + offset

      if (side === 'top' && top < margin && rect.bottom + offset + measuredHeight <= window.innerHeight - margin) {
        actualSide = 'bottom'
        top = rect.bottom + offset
      } else if (side === 'bottom' && top + measuredHeight > window.innerHeight - margin && rect.top - offset - measuredHeight >= margin) {
        actualSide = 'top'
        top = rect.top - measuredHeight - offset
      }

      top = Math.max(margin, Math.min(top, window.innerHeight - measuredHeight - margin))
      const next = {
        left,
        top,
        actualSide,
        menuWidth: measuredWidth,
      }
      setPosition((current) => (
        current.left === next.left
        && current.top === next.top
        && current.actualSide === next.actualSide
        && current.menuWidth === next.menuWidth
          ? current
          : next
      ))
    }

    updatePosition()
    const observer = new ResizeObserver(updatePosition)
    observer.observe(menuRef.current)
    if (anchorRef?.current) observer.observe(anchorRef.current)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [align, alignOffset, anchorRef, matchAnchorWidth, mobileMode, mobileWidth, offset, present, side, width])

  useEffect(() => {
    if (!open || !present) return
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null

    const focusTimer = window.setTimeout(() => {
      const menu = menuRef.current
      if (!menu) return
      const checked = menu.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"], [role="radio"][aria-checked="true"]')
      ;(checked ?? getMenuItems(menu)[0] ?? getFocusableItems(menu)[0] ?? menu).focus({ preventScroll: true })
    })

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (menuRef.current?.contains(target) || anchorRef?.current?.contains(target)) return
      onCloseRef.current()
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const menu = menuRef.current
      if (!menu) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key === 'Tab') {
        if (!menu.querySelector('.reasoning-picker')) {
          onCloseRef.current()
          return
        }
        const focusableItems = getFocusableItems(menu)
        if (focusableItems.length === 0) return
        const currentIndex = document.activeElement instanceof HTMLElement
          ? focusableItems.indexOf(document.activeElement)
          : -1
        const nextIndex = event.shiftKey
          ? currentIndex <= 0 ? focusableItems.length - 1 : currentIndex - 1
          : currentIndex < 0 || currentIndex === focusableItems.length - 1 ? 0 : currentIndex + 1
        event.preventDefault()
        focusableItems[nextIndex].focus({ preventScroll: true })
        return
      }

      const items = getMenuItems(menu)
      if (items.length === 0) return
      const current = document.activeElement instanceof HTMLElement
        ? items.indexOf(document.activeElement)
        : -1
      let next = -1
      if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length
      if (event.key === 'ArrowUp') next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length
      if (event.key === 'Home') next = 0
      if (event.key === 'End') next = items.length - 1

      if (next >= 0) {
        event.preventDefault()
        items[next].focus({ preventScroll: true })
        return
      }

      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const query = event.key.toLocaleLowerCase()
        const searchOrder = [...items.slice(current + 1), ...items.slice(0, current + 1)]
        const match = searchOrder.find((item) => item.textContent?.trim().toLocaleLowerCase().startsWith(query))
        if (match) {
          event.preventDefault()
          match.focus({ preventScroll: true })
        }
      }
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown)
    const mountedMenu = menuRef.current
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown)
      const previous = previousFocusRef.current
      if (previous?.isConnected && mountedMenu?.contains(document.activeElement)) {
        previous.focus({ preventScroll: true })
      }
    }
  }, [anchorRef, onCloseRef, open, present])

  if (!present || typeof document === 'undefined') return null

  const menuStyle: CSSProperties = {
    left: position.left,
    top: position.top,
    width: position.menuWidth,
  }

  return createPortal(
    <div
      className="plus-popover-layer"
      data-mobile-mode={mobileMode}
      data-state={active ? 'open' : 'closed'}
      onPointerDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
    >
      <div
        aria-hidden={!open}
        aria-label={ariaLabel}
        className={`plus-popover ${className}`.trim()}
        data-side={position.actualSide}
        data-state={active ? 'open' : 'closed'}
        data-mobile-mode={mobileMode}
        id={menuId}
        ref={menuRef}
        role="menu"
        style={menuStyle}
        tabIndex={-1}
      >
        <div aria-hidden="true" className="plus-popover-mobile-handle" />
        {children}
      </div>
    </div>,
    document.body,
  )
}

function MenuAction({
  icon: Icon,
  label,
  description,
  checked,
  role = 'menuitem',
  danger = false,
  disabled = false,
  accessory,
  onSelect,
}: MenuActionProps) {
  return (
    <button
      aria-checked={role === 'menuitemradio' ? Boolean(checked) : undefined}
      aria-disabled={disabled || undefined}
      className={`plus-menu-action${description ? ' has-description' : ''}${danger ? ' is-danger' : ''}`}
      disabled={disabled}
      onClick={onSelect}
      role={role}
      type="button"
    >
      <span className="plus-menu-action-icon">
        {typeof Icon === 'string'
          ? <InteractionSpriteIcon name={Icon} />
          : <Icon aria-hidden="true" size={18} strokeWidth={1.8} />}
      </span>
      <span className="plus-menu-action-copy">
        <span className="plus-menu-action-label">{label}</span>
        {description && <span className="plus-menu-action-description">{description}</span>}
      </span>
      {checked && <Check aria-hidden="true" className="plus-menu-check" size={17} strokeWidth={2.2} />}
      {!checked && accessory && <span className="plus-menu-action-accessory">{accessory}</span>}
    </button>
  )
}

function Separator() {
  return <div aria-hidden="true" className="plus-menu-separator" role="separator" />
}

function InitialsAvatar({ name, initials: suppliedInitials }: { name: string; initials?: string }) {
  const initials = suppliedInitials || name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase())
    .join('') || 'CT'
  return <span aria-hidden="true" className="plus-account-avatar">{initials}</span>
}

export interface AccountMenuProps {
  open: boolean
  onClose: () => void
  anchorRef?: PlusPopoverAnchor
  userName?: string
  initials?: string
  planLabel?: string
  onAccount?: () => void
  /** Retained for callers using the earlier API; no upgrade row is rendered in the authenticated menu. */
  onUpgrade?: () => void
  onManagePlan?: () => void
  onPersonalization?: () => void
  onProfile?: () => void
  onSettings?: () => void
  onHelp?: () => void
  onSessionLogin?: () => void
  onSessionDisconnect?: () => void
  sessionConnected?: boolean
  onLogout?: () => void
}

export function AccountMenu({
  open,
  onClose,
  anchorRef,
  userName = 'Cody Thomas',
  initials,
  planLabel = 'Plus',
  onAccount,
  onManagePlan,
  onPersonalization,
  onProfile,
  onSettings,
  onHelp,
  onSessionLogin,
  onSessionDisconnect,
  sessionConnected = false,
  onLogout,
}: AccountMenuProps) {
  const select = (action?: () => void) => () => {
    onClose()
    action?.()
  }

  return (
    <AnchoredPopover
      align="start"
      anchorRef={anchorRef}
      ariaLabel={'\u8d26\u6237\u83dc\u5355'}
      className={`plus-account-menu is-plan-${planLabel.toLocaleLowerCase()}`}
      mobileMode="anchored"
      mobileWidth="anchor"
      offset={4}
      onClose={onClose}
      open={open}
      side="top"
      width={250}
    >
      <button
        className="plus-account-summary"
        onClick={select(onAccount ?? onManagePlan)}
        role="menuitem"
        type="button"
      >
        <InitialsAvatar initials={initials} name={userName} />
        <span className="plus-account-summary-copy">
          <strong>{userName}</strong>
          <span>{planLabel}</span>
        </span>
        <ChevronRight aria-hidden="true" className="plus-account-summary-chevron" size={17} />
      </button>
      <Separator />
      <div className="plus-menu-group">
        <MenuAction icon={Palette} label={'\u4e2a\u6027\u5316'} onSelect={select(onPersonalization)} />
        <MenuAction icon={UserRound} label={'\u4e2a\u4eba\u8d44\u6599'} onSelect={select(onProfile)} />
        <MenuAction icon={Settings} label={'\u8bbe\u7f6e'} onSelect={select(onSettings)} />
      </div>
      <Separator />
      <div className="plus-menu-group">
        <MenuAction
          icon={KeyRound}
          label={sessionConnected ? '切换 Session' : 'Session 登录'}
          onSelect={select(onSessionLogin)}
        />
        {sessionConnected ? (
          <MenuAction icon={Unplug} label="断开 Session" onSelect={select(onSessionDisconnect)} />
        ) : null}
      </div>
      <Separator />
      <div className="plus-menu-group">
        <MenuAction
          accessory={<ChevronRight aria-hidden="true" size={17} />}
          icon={CircleHelp}
          label={'\u5e2e\u52a9'}
          onSelect={select(onHelp)}
        />
        <MenuAction
          accessory={<ChevronRight aria-hidden="true" size={17} />}
          icon={LogOut}
          label={'\u9000\u51fa\u767b\u5f55'}
          onSelect={select(onLogout)}
        />
      </div>
    </AnchoredPopover>
  )
}

export interface ModelMenuProps {
  open: boolean
  onClose: () => void
  anchorRef?: PlusPopoverAnchor
  selectedModel?: PlusModelId
  reasoningEffort?: ReasoningEffort
  fastMode?: boolean
  showFastMode?: boolean
  modelLabel?: string
  sliderOptions?: readonly ReasoningSliderOption[]
  /** Renders the small reasoning-strength picker used by the composer control. */
  compactEffort?: boolean
  /** Pro exposes its own purple maximum-reasoning control and entitlement. */
  planVariant?: 'plus' | 'pro'
  modelOptions?: readonly ReasoningModelOption[]
  onModelChange?: (model: PlusModelId) => void
  onReasoningEffortChange?: (effort: ReasoningEffort) => void
  onFastModeChange?: (enabled: boolean) => void
}

export function ModelMenu({
  open,
  onClose,
  anchorRef,
  selectedModel = 'default',
  reasoningEffort = 1,
  fastMode = false,
  showFastMode = true,
  modelLabel,
  sliderOptions,
  compactEffort = false,
  planVariant = 'plus',
  modelOptions,
  onModelChange,
  onReasoningEffortChange,
  onFastModeChange,
}: ModelMenuProps) {
  const [pickerView, setPickerView] = useState<ReasoningPickerView>('effort')

  useEffect(() => {
    if (!open) setPickerView('effort')
  }, [open])

  const effectiveModelLabel = modelLabel ?? (planVariant === 'pro'
    ? 'Pro'
    : selectedModel === 'default'
      ? '5.6 Sol'
      : undefined)

  const models: readonly ReasoningModelOption[] | undefined = modelOptions ?? (planVariant === 'pro'
    ? [
        {
          id: 'gpt-5-6-pro',
          label: 'Pro',
          description: '最强推理能力，适合复杂和高难度任务',
          triggerLabel: 'Pro',
        },
        { id: '5.6-sol', label: '5.6 Sol', description: '高级推理与复杂任务' },
        { id: '5.6-terra', label: '5.6 Terra', description: '快速处理日常事务' },
      ]
    : undefined)

  return (
    <AnchoredPopover
      align="end"
      alignOffset={64.4}
      anchorRef={anchorRef}
      ariaLabel={compactEffort ? '\u601d\u8003\u5f3a\u5ea6' : '\u6a21\u578b\u4e0e\u63a8\u7406\u5f3a\u5ea6'}
      className={`plus-model-menu is-reasoning-picker is-${planVariant}`}
      mobileMode="anchored"
      offset={5.775}
      onClose={onClose}
      open={open}
      side="bottom"
      width={260}
    >
      <ReasoningPicker
        className={planVariant === 'pro' ? 'is-pro' : 'is-plus'}
        fastMode={fastMode}
        level={reasoningEffort}
        modelLabel={effectiveModelLabel}
        models={models}
        onFastModeChange={(enabled) => onFastModeChange?.(enabled)}
        onLevelChange={(level) => onReasoningEffortChange?.(level)}
        onModelChange={(model) => onModelChange?.(model)}
        onViewChange={setPickerView}
        selectedModel={selectedModel}
        showFastMode={showFastMode}
        sliderOptions={sliderOptions}
        view={pickerView}
      />
    </AnchoredPopover>
  )
}

const SIDEBAR_MORE_ITEMS: Array<{
  id: SidebarMoreAction
  label: string
  description?: string
  icon: LucideIcon
}> = [
  { id: 'deep-research', label: '深入研究', description: '创建包含来源的详细报告', icon: Search },
  { id: 'study', label: '学习与探索', description: '逐步学习新知识', icon: GraduationCap },
  { id: 'images', label: '创建图像', icon: Image },
  { id: 'gpts', label: '探索 GPT', icon: Blocks },
]

export interface SidebarMoreMenuProps {
  open: boolean
  onClose: () => void
  anchorRef?: PlusPopoverAnchor
  onSelect?: (action: SidebarMoreAction) => void
  hiddenActions?: readonly SidebarMoreAction[]
}

export function SidebarMoreMenu({ open, onClose, anchorRef, onSelect, hiddenActions = [] }: SidebarMoreMenuProps) {
  const select = (action: SidebarMoreAction) => {
    onSelect?.(action)
    onClose()
  }

  return (
    <AnchoredPopover
      align="start"
      anchorRef={anchorRef}
      ariaLabel="更多功能"
      className="plus-sidebar-more-menu"
      onClose={onClose}
      open={open}
      side="bottom"
      width={288}
    >
      <div className="plus-menu-group">
        {SIDEBAR_MORE_ITEMS.filter((item) => !hiddenActions.includes(item.id)).map((item) => (
          <MenuAction
            description={item.description}
            icon={item.icon}
            key={item.id}
            label={item.label}
            onSelect={() => select(item.id)}
          />
        ))}
      </div>
    </AnchoredPopover>
  )
}

export interface ChatRowMenuProps {
  open: boolean
  onClose: () => void
  anchorRef?: PlusPopoverAnchor
  onShare?: () => void
  onRename?: () => void
  onArchive?: () => void
  onDelete?: () => void
}

export function ChatRowMenu({
  open,
  onClose,
  anchorRef,
  onShare,
  onRename,
  onArchive,
  onDelete,
}: ChatRowMenuProps) {
  const select = (action?: () => void) => () => {
    onClose()
    action?.()
  }

  return (
    <AnchoredPopover
      align="end"
      anchorRef={anchorRef}
      ariaLabel="对话操作"
      className="plus-chat-row-menu"
      onClose={onClose}
      open={open}
      side="bottom"
      width={224}
    >
      <div className="plus-menu-group">
        <MenuAction icon={Share2} label="分享" onSelect={select(onShare)} />
        <MenuAction icon={Pencil} label="重命名" onSelect={select(onRename)} />
        <MenuAction icon={Archive} label="归档" onSelect={select(onArchive)} />
      </div>
      <Separator />
      <div className="plus-menu-group">
        <MenuAction danger icon={Trash2} label="删除" onSelect={select(onDelete)} />
      </div>
    </AnchoredPopover>
  )
}

const ATTACHMENT_ITEMS: Array<{
  id: AttachmentAction
  label: string
  description: string
  icon: LucideIcon | InteractionIconName
}> = [
  {
    id: 'upload',
    label: '\u6dfb\u52a0\u7167\u7247\u548c\u6587\u4ef6',
    description: '\u4ece\u7535\u8111\u4e0a\u4f20',
    icon: 'paperclip',
  },
  {
    id: 'library',
    label: '\u4ece\u8d44\u6599\u5e93\u6dfb\u52a0',
    description: '\u6d4f\u89c8\u548c\u641c\u7d22\u4f60\u7684\u6587\u4ef6',
    icon: 'library',
  },
  {
    id: 'create-image',
    label: '\u521b\u5efa\u56fe\u7247',
    description: '\u53ef\u89c6\u5316\u5448\u73b0\u4efb\u4f55\u5185\u5bb9',
    icon: 'create-image-plugin',
  },
  {
    id: 'web-search',
    label: '\u7f51\u9875\u641c\u7d22',
    description: '\u67e5\u627e\u5b9e\u65f6\u65b0\u95fb\u548c\u4fe1\u606f',
    icon: 'skill-globe-light',
  },
  {
    id: 'deep-research',
    label: '\u6df1\u5ea6\u7814\u7a76',
    description: 'Deep research',
    icon: 'skill-deep-research-light',
  },
  {
    id: 'github',
    label: 'GitHub',
    description: 'Triage PRs, issues, CI, and publish flows',
    icon: 'github-mark',
  },
  {
    id: 'visualize',
    label: 'Visualize',
    description: 'Create visualizations and interactive tools',
    icon: Blocks,
  },
  {
    id: 'sites',
    label: 'Sites',
    description: 'Build and deploy websites with Sites.',
    icon: Blocks,
  },
  {
    id: 'gmail',
    label: 'Gmail',
    description: 'Read and manage Gmail',
    icon: Mail,
  },
]

export interface AttachmentMenuProps {
  open: boolean
  onClose: () => void
  anchorRef?: PlusPopoverAnchor
  /** Match the anchor (normally the whole composer) and expand beneath it. */
  fullWidth?: boolean
  onSelect?: (action: AttachmentAction) => void
  hiddenActions?: readonly AttachmentAction[]
}

export function AttachmentMenu({
  open,
  onClose,
  anchorRef,
  fullWidth = false,
  onSelect,
  hiddenActions = [],
}: AttachmentMenuProps) {
  const select = (action: AttachmentAction) => {
    onSelect?.(action)
    onClose()
  }

  return (
    <AnchoredPopover
      align="start"
      anchorRef={anchorRef}
      ariaLabel={'\u6dfb\u52a0\u9644\u4ef6'}
      className={`plus-attachment-menu${fullWidth ? ' is-full-width' : ''}`}
      matchAnchorWidth={fullWidth}
      offset={fullWidth ? 8 : 6}
      onClose={onClose}
      open={open}
      side={fullWidth ? 'bottom' : 'top'}
      width={fullWidth ? 760 : 288}
    >
      <div className="plus-menu-group">
        {ATTACHMENT_ITEMS.filter((item) => !hiddenActions.includes(item.id)).map((item) => (
          <MenuAction
            description={item.description}
            icon={item.icon}
            key={item.id}
            label={item.label}
            onSelect={() => select(item.id)}
          />
        ))}
      </div>
    </AnchoredPopover>
  )
}
