import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { authSessionErrorMessage, type SessionAccount } from './lib/authSession'
import './SessionLoginDialog.css'

export type SessionLoginDialogProps = {
  account: SessionAccount | null
  open: boolean
  onClose: () => void
  onSubmit: (session: string) => Promise<void>
}

function CloseIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m5 5 10 10M15 5 5 15" /></svg>
}

function EyeIcon({ hidden }: { hidden: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M2.5 10s2.7-4.5 7.5-4.5 7.5 4.5 7.5 4.5-2.7 4.5-7.5 4.5S2.5 10 2.5 10Z"/><circle cx="10" cy="10" r="2"/>{hidden && <path d="m4 4 12 12"/>}</svg>
}

export default function SessionLoginDialog({ account, open, onClose, onSubmit }: SessionLoginDialogProps) {
  const [session, setSession] = useState('')
  const [showSession, setShowSession] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const submittingRef = useRef(false)

  const close = () => {
    if (submittingRef.current) return
    setSession('')
    setShowSession(false)
    setError(null)
    onClose()
  }

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0)

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !submittingRef.current) {
        event.preventDefault()
        setSession('')
        setShowSession(false)
        setError(null)
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled)') ?? [])
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [onClose, open])

  if (!open) return null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submittingRef.current) return
    if (!session.trim()) {
      setError('请输入 Session。')
      inputRef.current?.focus()
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(session)
      setSession('')
      setShowSession(false)
      onClose()
    } catch (submitError) {
      setError(authSessionErrorMessage(submitError))
      inputRef.current?.focus()
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  return createPortal(
    <div className="session-dialog-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <div ref={dialogRef} className="session-dialog" role="dialog" aria-modal="true" aria-labelledby="session-dialog-title" aria-describedby="session-dialog-description">
        <div className="session-dialog-header">
          <div>
            <h2 id="session-dialog-title">{account ? '切换 Session' : '通过 Session 登录'}</h2>
            <p id="session-dialog-description">{account ? '粘贴其他账号的 Session，验证成功后即可切换账号。' : '粘贴账号对应的 Session，验证成功后即可登录。'}</p>
          </div>
          <button className="session-dialog-close" type="button" aria-label="关闭" disabled={submitting} onClick={close}><CloseIcon /></button>
        </div>

        {account && <div className="session-current-account" aria-label="当前连接的账号">
          <span className="session-current-avatar">{account.initials}</span>
          <span><strong>{account.name}</strong><small>{account.email || account.planLabel}</small></span>
          <em>{account.planLabel}</em>
        </div>}

        <form onSubmit={submit}>
          <label htmlFor="session-login-value">Session</label>
          <div className={`session-input-wrap${showSession ? '' : ' is-masked'}`}>
            <textarea
              ref={inputRef}
              id="session-login-value"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'session-login-error session-login-note' : 'session-login-note'}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              disabled={submitting}
              maxLength={60_000}
              placeholder="Session JSON、Bearer Token 或 Cookie 字符串"
              rows={5}
              spellCheck={false}
              value={session}
              onChange={(event) => { setSession(event.target.value); if (error) setError(null) }}
              onKeyDown={onInputKeyDown}
            />
            <button type="button" aria-label={showSession ? '隐藏 Session' : '显示 Session'} aria-pressed={showSession} disabled={submitting} onClick={() => setShowSession((visible) => !visible)}><EyeIcon hidden={showSession}/></button>
          </div>
          {error && <p className="session-login-error" id="session-login-error" role="alert">{error}</p>}
          <p className="session-login-note" id="session-login-note">Session 仅发送到本机后端验证，并保存在服务端内存中；不会写入 localStorage、网址或前端日志。</p>
          <div className="session-dialog-actions">
            <button type="button" disabled={submitting} onClick={close}>取消</button>
            <button className="is-primary" type="submit" disabled={submitting || !session.trim()}>{submitting ? <><span className="session-button-spinner"/>正在验证</> : error ? '重试验证' : '登录账号'}</button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
