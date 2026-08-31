import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import type { PlusConversation } from './PlusShell'
import './SearchDialog.css'

export interface SearchDialogProps {
  open: boolean
  onClose: () => void
  onNewChat: () => void
  conversations?: PlusConversation[]
  onConversationSelect?: (conversation: PlusConversation) => void
}

const EXIT_DURATION_MS = 160
const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function usePresence(open: boolean) {
  const [present, setPresent] = useState(open)
  const [active, setActive] = useState(false)

  useEffect(() => {
    if (open) {
      // Presence mirrors an external controlled prop so the closing frame can finish.
      // eslint-disable-next-line react/set-state-in-effect
      setPresent(true)
      return
    }

    setActive(false)
    if (!present) return
    const timeout = window.setTimeout(() => setPresent(false), EXIT_DURATION_MS)
    return () => window.clearTimeout(timeout)
  }, [open, present])

  useEffect(() => {
    if (!open || !present) return
    const frame = window.requestAnimationFrame(() => setActive(true))
    return () => window.cancelAnimationFrame(frame)
  }, [open, present])

  return { active, present }
}

function useDialogFocus(
  open: boolean,
  present: boolean,
  dialogRef: RefObject<HTMLElement | null>,
  initialFocusRef: RefObject<HTMLInputElement | null>,
  onCloseRef: RefObject<() => void>,
) {
  useEffect(() => {
    if (!open || !present) return

    const dialog = dialogRef.current
    if (!dialog) return

    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const focusFrame = window.requestAnimationFrame(() => {
      initialFocusRef.current?.focus({ preventScroll: true })
    })

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current?.()
        return
      }

      if (event.key !== 'Tab') return

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => (
        !element.hidden
        && element.getAttribute('aria-hidden') !== 'true'
        && element.getClientRects().length > 0
      ))

      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus({ preventScroll: true })
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const current = document.activeElement

      if (event.shiftKey && (current === first || !dialog.contains(current))) {
        event.preventDefault()
        last.focus({ preventScroll: true })
      } else if (!event.shiftKey && (current === last || !dialog.contains(current))) {
        event.preventDefault()
        first.focus({ preventScroll: true })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [dialogRef, initialFocusRef, onCloseRef, open, present])
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M4.75 4.75 15.25 15.25M15.25 4.75 4.75 15.25" />
    </svg>
  )
}

function ComposeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <use href="/chatgpt-icons.svg#lightweight-sidebar-compose" />
    </svg>
  )
}

export function SearchDialog({ open, onClose, onNewChat, conversations = [], onConversationSelect }: SearchDialogProps) {
  const { active, present } = usePresence(open)
  const [query, setQuery] = useState('')
  const dialogRef = useRef<HTMLElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    // A newly opened logged-out search starts from the same pristine state as the live UI.
    // eslint-disable-next-line react/set-state-in-effect
    if (open) setQuery('')
  }, [open])

  useDialogFocus(open, present, dialogRef, inputRef, onCloseRef)

  if (!present) return null

  const close = () => onCloseRef.current()
  const clear = () => {
    if (query.length === 0) {
      close()
      return
    }
    setQuery('')
    inputRef.current?.focus({ preventScroll: true })
  }
  const startNewChat = () => {
    onNewChat()
    close()
  }
  const handleNewChat = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    startNewChat()
  }
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredConversations = conversations.filter((conversation) => (
    !normalizedQuery || conversation.title.toLocaleLowerCase().includes(normalizedQuery)
  ))

  return createPortal(
    <div
      aria-hidden={!open}
      className="search-dialog-layer"
      data-state={open && active ? 'open' : 'closed'}
      inert={!open}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <section
        id="search-chat-dialog"
        aria-label="搜索聊天"
        aria-modal="true"
        className="search-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="search-dialog-mobile-header">
          <button
            aria-label="关闭搜索"
            className="search-dialog-mobile-close"
            onClick={close}
            type="button"
          >
            <CloseIcon />
          </button>
        </div>

        <label className="search-dialog-field">
          <span className="search-dialog-sr-only">搜索聊天</span>
          <input
            autoComplete="off"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="搜索聊天..."
            ref={inputRef}
            spellCheck={false}
            type="search"
            value={query}
          />
          <button
            aria-label={query.length === 0 ? '关闭搜索' : '清除搜索'}
            className="search-dialog-clear"
            onClick={clear}
            type="button"
          >
            <CloseIcon />
          </button>
        </label>

        <div className="search-dialog-results" aria-label="搜索结果">
          <a
            className="search-dialog-new-chat"
            href="/"
            onClick={handleNewChat}
          >
            <ComposeIcon />
            <span>新聊天</span>
          </a>
          {filteredConversations.length > 0 && <div className="search-dialog-history">
            <p>{normalizedQuery ? '聊天' : '最近'}</p>
            {filteredConversations.slice(0, 9).map((conversation) => (
              <button key={conversation.id} type="button" onClick={() => {
                onConversationSelect?.(conversation)
                close()
              }}>
                <span>{conversation.title}</span>
                <small>聊天</small>
              </button>
            ))}
          </div>}
          {normalizedQuery && filteredConversations.length === 0 && <p className="search-dialog-empty">没有找到聊天</p>}
        </div>
      </section>
    </div>,
    document.body,
  )
}

export default SearchDialog
