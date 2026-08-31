import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { MessageSquareText, Plus, Search, X } from 'lucide-react'

export interface SearchDialogItem {
  id: string
  title: string
  /** Optional excerpt searched together with the title. */
  subtitle?: string
  /** A short, already-formatted value such as "Today" or "Aug 30". */
  meta?: string
}

export interface SearchDialogProps {
  open: boolean
  items: SearchDialogItem[]
  onClose: () => void
  onSelect: (item: SearchDialogItem) => void
  onNewChat?: () => void
  initialQuery?: string
  title?: string
  placeholder?: string
  emptyText?: string
  closeOnSelect?: boolean
  onQueryChange?: (query: string) => void
}

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

/** A keyboard-friendly, controlled-visibility conversation search dialog. */
export function SearchDialog({
  open,
  items,
  onClose,
  onSelect,
  onNewChat,
  initialQuery = '',
  title = '搜索聊天',
  placeholder = '搜索聊天记录…',
  emptyText = '未找到相关聊天',
  closeOnSelect = true,
  onQueryChange,
}: SearchDialogProps) {
  const [query, setQuery] = useState(initialQuery)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return

    const previouslyFocused = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const focusTimer = window.setTimeout(() => {
      setQuery(initialQuery)
      inputRef.current?.focus()
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
  }, [initialQuery, open])

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return items

    return items.filter((item) =>
      `${item.title} ${item.subtitle ?? ''}`
        .toLocaleLowerCase()
        .includes(needle),
    )
  }, [items, query])

  if (!open) return null

  const updateQuery = (value: string) => {
    setQuery(value)
    onQueryChange?.(value)
  }

  const selectItem = (item: SearchDialogItem) => {
    onSelect(item)
    if (closeOnSelect) onClose()
  }

  const createNewChat = () => {
    onNewChat?.()
    onClose()
  }

  return (
    <div
      className="modal-overlay search-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        className="modal-panel search-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <div className="search-dialog-header">
          <Search className="search-dialog-leading-icon" aria-hidden="true" />
          <h2 id={titleId} className="search-dialog-title">
            {title}
          </h2>
          <button
            type="button"
            className="icon-button search-dialog-close"
            onClick={onClose}
            aria-label="关闭搜索"
          >
            <X aria-hidden="true" />
          </button>
        </div>

        <p id={descriptionId} className="sr-only">
          输入关键词以搜索聊天记录。
        </p>

        <div className="search-input-wrap">
          <Search className="search-input-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            className="search-input"
            type="search"
            value={query}
            onChange={(event) => updateQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown') return
              event.preventDefault()
              panelRef.current
                ?.querySelector<HTMLButtonElement>('.search-result')
                ?.focus()
            }}
            placeholder={placeholder}
            aria-label={placeholder}
            autoComplete="off"
          />
          {query && (
            <button
              type="button"
              className="icon-button search-clear"
              onClick={() => {
                updateQuery('')
                inputRef.current?.focus()
              }}
              aria-label="清除搜索关键词"
            >
              <X aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="search-results" aria-live="polite">
          {onNewChat && !query && (
            <button
              type="button"
              className="search-result search-new-chat"
              onClick={createNewChat}
            >
              <span className="search-result-icon" aria-hidden="true">
                <Plus />
              </span>
              <span className="search-result-copy">
                <span className="search-result-title">新建聊天</span>
              </span>
            </button>
          )}

          {filteredItems.length > 0 ? (
            <>
              <div className="search-results-label" aria-hidden="true">
                {query ? `搜索结果 · ${filteredItems.length}` : '聊天记录'}
              </div>
              <div className="search-results-list">
                {filteredItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="search-result"
                    onClick={() => selectItem(item)}
                  >
                    <span className="search-result-icon" aria-hidden="true">
                      <MessageSquareText />
                    </span>
                    <span className="search-result-copy">
                      <span className="search-result-title">{item.title}</span>
                      {item.subtitle && (
                        <span className="search-result-subtitle">
                          {item.subtitle}
                        </span>
                      )}
                    </span>
                    {item.meta && (
                      <span className="search-result-meta">{item.meta}</span>
                    )}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="search-empty" role="status">
              <Search aria-hidden="true" />
              <span>{emptyText}</span>
              <small>请尝试其他关键词</small>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SearchDialog

/**
 * Global CSS hooks used by this component:
 * .modal-overlay .search-overlay .modal-panel .search-dialog
 * .search-dialog-header .search-dialog-leading-icon .search-dialog-title
 * .search-dialog-close .icon-button .sr-only .search-input-wrap
 * .search-input-icon .search-input .search-clear .search-results
 * .search-results-label .search-results-list .search-result .search-new-chat
 * .search-result-icon .search-result-copy .search-result-title
 * .search-result-subtitle .search-result-meta .search-empty
 */
