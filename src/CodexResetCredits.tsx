import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, RefreshCw, RotateCcw, X } from 'lucide-react'
import './CodexResetCredits.css'

type JsonRecord = Record<string, unknown>
type LoadState = 'loading' | 'ready' | 'unauthenticated' | 'forbidden' | 'error'
type NoticeKind = 'success' | 'info' | 'error'

type ResetCredit = {
  id: string
  title: string | null
  expiresAt: number | string | null
  isSupportedByPlan: boolean
  status: string
  resetType: string
}

type ResetCreditsSnapshot = {
  availableCount: number | null
  credits: ResetCredit[]
}

type ResetSelection = {
  key: string
  creditId: string | null
  title: string
  resetType: string | null
  supported: boolean
  expiresAt: number | string | null
  automatic: boolean
}

type PendingAttempt = {
  selectionKey: string
  redeemRequestId: string
  ambiguous: boolean
}

type ActionNotice = {
  kind: NoticeKind
  text: string
}

type DialogOutcome = 'nothing_to_reset' | null

export type CodexResetCreditsProps = {
  variant: 'analytics' | 'usage'
  onUsageChanged: () => void | Promise<void>
}

const AUTOMATIC_SELECTION_KEY = '__automatic_reset_credit__'

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function firstValue(record: JsonRecord | null, ...keys: string[]) {
  if (!record) return undefined
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key]
  }
  return undefined
}

function nonNegativeInteger(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : null
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeCreditsPayload(value: unknown): ResetCreditsSnapshot | null {
  const payload = asRecord(value)
  if (!payload) return null
  const availableCount = nonNegativeInteger(firstValue(payload, 'availableCount', 'available_count'))
  const rawCredits = firstValue(payload, 'credits')
  const credits = Array.isArray(rawCredits)
    ? rawCredits.flatMap((value) => {
        const credit = asRecord(value)
        const id = optionalString(firstValue(credit, 'id'))
        if (!credit || !id) return []
        const rawExpiry = firstValue(credit, 'expiresAt', 'expires_at')
        return [{
          id,
          title: optionalString(firstValue(credit, 'title')),
          expiresAt: typeof rawExpiry === 'number' || typeof rawExpiry === 'string' ? rawExpiry : null,
          // The upstream field is optional. Only an explicit `false` means the
          // current plan cannot use this card; missing/null keeps it usable.
          isSupportedByPlan: firstValue(credit, 'isSupportedByPlan', 'is_supported_by_plan') !== false,
          status: optionalString(firstValue(credit, 'status'))?.toLowerCase() ?? 'unknown',
          resetType: optionalString(firstValue(credit, 'resetType', 'reset_type')) ?? 'unknown',
        }]
      })
    : []
  return { availableCount, credits }
}

function responseError(payload: unknown, status: number, fallback: string) {
  const root = asRecord(payload)
  const error = asRecord(firstValue(root, 'error'))
  const message = firstValue(error, 'message') ?? firstValue(root, 'message', 'detail')
  return typeof message === 'string' && message.trim() ? message.trim() : `${fallback}（HTTP ${status}）`
}

function resetTarget(resetType: string | null) {
  switch (resetType) {
    case 'codex_five_hour':
      return {
        short: '5 小时限额',
        confirmation: '当前 Codex 的 5 小时使用限额',
      }
    case 'codex_weekly':
      return {
        short: '每周限额',
        confirmation: '当前 Codex 的每周使用限额',
      }
    case 'codex_rate_limits':
      return {
        short: '所有符合条件的 Codex 限额',
        confirmation: '当前所有符合条件的 Codex 限额窗口（通常包括 5 小时和每周窗口）',
      }
    default:
      return {
        short: 'Codex 使用限额',
        confirmation: '这张卡片所对应的 Codex 使用限额窗口',
      }
  }
}

function formatExpiry(value: number | string | null) {
  if (value === null) return null
  let date: Date
  if (typeof value === 'number') {
    date = new Date(value < 10_000_000_000 ? value * 1_000 : value)
  } else if (/^\d+(?:\.\d+)?$/.test(value.trim())) {
    const numeric = Number(value)
    date = new Date(numeric < 10_000_000_000 ? numeric * 1_000 : numeric)
  } else {
    date = new Date(value)
  }
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function countLabel(count: number | null) {
  if (count === null) return '可用数量未知'
  return `${count} 张可用`
}

export function CodexResetCredits({ variant, onUsageChanged }: CodexResetCreditsProps) {
  const headingId = useId()
  const descriptionId = useId()
  const dialogTitleId = useId()
  const dialogDescriptionId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const snapshotRef = useRef<ResetCreditsSnapshot | null>(null)
  const pendingAttemptRef = useRef<PendingAttempt | null>(null)
  const submitInFlightRef = useRef(false)
  const wasDialogOpenRef = useRef(false)

  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [snapshot, setSnapshot] = useState<ResetCreditsSnapshot | null>(null)
  const [loadError, setLoadError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogOutcome, setDialogOutcome] = useState<DialogOutcome>(null)
  const [submitting, setSubmitting] = useState(false)
  const [ambiguousRetry, setAmbiguousRetry] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [notice, setNotice] = useState<ActionNotice | null>(null)

  const loadCredits = useCallback(async (signal?: AbortSignal, background = false) => {
    if (background) setRefreshing(true)
    else {
      setLoadState('loading')
      setLoadError('')
    }
    try {
      const response = await fetch('/api/codex/reset-credits', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
        headers: { Accept: 'application/json' },
      })
      const payload: unknown = await response.json().catch(() => null)
      // Only an HTTP 401 invalidates the local Session. Other backend errors
      // may also carry `authenticated: false` in their generic error shape.
      if (response.status === 401) {
        snapshotRef.current = null
        setSnapshot(null)
        setLoadState('unauthenticated')
        return
      }
      if (response.status === 403) {
        snapshotRef.current = null
        setSnapshot(null)
        setLoadState('forbidden')
        setLoadError(responseError(payload, response.status, '当前方案不支持使用限额重置卡'))
        return
      }
      if (!response.ok) throw new Error(responseError(payload, response.status, '无法查询重置卡'))
      const normalized = normalizeCreditsPayload(payload)
      if (!normalized) throw new Error('重置卡接口没有返回有效数据。')
      snapshotRef.current = normalized
      setSnapshot(normalized)
      setLoadState('ready')
      setLoadError('')
    } catch (error) {
      if (signal?.aborted) return
      const message = error instanceof Error ? error.message : '暂时无法查询当前 Session 的重置卡。'
      if (background && snapshotRef.current) {
        setLoadState('ready')
        setNotice((current) => current?.kind === 'success'
          ? { kind: 'success', text: `${current.text} 卡片列表暂未刷新，请稍后手动刷新。` }
          : { kind: 'error', text: message })
      } else {
        snapshotRef.current = null
        setSnapshot(null)
        setLoadState('error')
        setLoadError(message)
      }
    } finally {
      if (!signal?.aborted) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    // The request synchronizes this panel with the current HttpOnly Session.
    // eslint-disable-next-line react/set-state-in-effect
    void loadCredits(controller.signal)
    return () => controller.abort()
  }, [loadCredits])

  useEffect(() => {
    if (!dialogOpen) {
      if (wasDialogOpenRef.current) triggerRef.current?.focus()
      wasDialogOpenRef.current = false
      return
    }
    wasDialogOpenRef.current = true
    cancelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) {
        setDialogOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getAttribute('aria-hidden') !== 'true')
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [dialogOpen, submitting])

  const availableCredits = useMemo(
    () => snapshot?.credits.filter((credit) => credit.status === 'available') ?? [],
    [snapshot],
  )
  const useAutomaticSelection = snapshot !== null
    && snapshot.availableCount !== null
    && snapshot.availableCount > 0
    && snapshot.credits.length === 0

  const selections = useMemo<ResetSelection[]>(() => {
    if (useAutomaticSelection) {
      return [{
        key: AUTOMATIC_SELECTION_KEY,
        creditId: null,
        title: '自动选择可用重置卡',
        resetType: null,
        supported: true,
        expiresAt: null,
        automatic: true,
      }]
    }
    return availableCredits.map((credit) => ({
      key: credit.id,
      creditId: credit.id,
      title: credit.title ?? resetTarget(credit.resetType).short,
      resetType: credit.resetType,
      supported: credit.isSupportedByPlan,
      expiresAt: credit.expiresAt,
      automatic: false,
    }))
  }, [availableCredits, useAutomaticSelection])

  const selected = useMemo(() => {
    const requested = selections.find((selection) => selection.key === selectedKey && selection.supported)
    return requested ?? selections.find((selection) => selection.supported) ?? null
  }, [selectedKey, selections])

  const closeDialog = () => {
    if (submitting) return
    setDialogOpen(false)
    setDialogOutcome(null)
    setSubmitError('')
  }

  const openDialog = () => {
    if (!selected) return
    setAmbiguousRetry(
      pendingAttemptRef.current?.selectionKey === selected.key
      && pendingAttemptRef.current.ambiguous,
    )
    setDialogOutcome(null)
    setSubmitError('')
    setNotice(null)
    setDialogOpen(true)
  }

  const refreshAfterOutcome = useCallback(async () => {
    await Promise.allSettled([
      loadCredits(undefined, true),
      Promise.resolve().then(() => onUsageChanged()),
    ])
  }, [loadCredits, onUsageChanged])

  const consumeCredit = async () => {
    if (!selected || submitInFlightRef.current) return
    submitInFlightRef.current = true

    const previousAttempt = pendingAttemptRef.current
    const retryingAmbiguousAttempt = previousAttempt?.selectionKey === selected.key && previousAttempt.ambiguous
    const attempt: PendingAttempt = retryingAmbiguousAttempt
      ? previousAttempt
      : {
          selectionKey: selected.key,
          redeemRequestId: crypto.randomUUID(),
          ambiguous: false,
        }
    pendingAttemptRef.current = attempt
    setSubmitting(true)
    setSubmitError('')

    try {
      const body: { creditId?: string; redeemRequestId: string } = {
        redeemRequestId: attempt.redeemRequestId,
      }
      if (selected.creditId !== null) body.creditId = selected.creditId
      const response = await fetch('/api/codex/reset-credits/consume', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      const payload: unknown = await response.json().catch(() => null)
      const root = asRecord(payload)

      if (response.status === 401) {
        pendingAttemptRef.current = null
        setAmbiguousRetry(false)
        setDialogOpen(false)
        snapshotRef.current = null
        setSnapshot(null)
        setLoadState('unauthenticated')
        return
      }
      if (response.status === 403) {
        pendingAttemptRef.current = null
        setAmbiguousRetry(false)
        setDialogOpen(false)
        setLoadState('forbidden')
        setLoadError(responseError(payload, response.status, '当前账号或方案不支持使用这张重置卡'))
        return
      }
      if (!response.ok) {
        const message = responseError(payload, response.status, '使用重置卡失败')
        if (response.status >= 500) {
          attempt.ambiguous = true
          pendingAttemptRef.current = attempt
          setAmbiguousRetry(true)
          setSubmitError(`${message} 请求结果尚不确定，重试将沿用同一个请求编号，不会重复使用卡片。`)
          return
        }
        pendingAttemptRef.current = null
        setAmbiguousRetry(false)
        setSubmitError(message)
        return
      }

      const code = optionalString(firstValue(root, 'code'))
      if (!code) {
        attempt.ambiguous = true
        pendingAttemptRef.current = attempt
        setAmbiguousRetry(true)
        setSubmitError('服务器没有返回明确的处理结果。重试将沿用同一个请求编号，不会重复使用卡片。')
        return
      }

      if (code === 'reset' || (code === 'already_redeemed' && retryingAmbiguousAttempt)) {
        pendingAttemptRef.current = null
        setAmbiguousRetry(false)
        setDialogOpen(false)
        setNotice({
          kind: 'success',
          text: code === 'reset' ? '重置卡已使用，正在刷新实际额度。' : '已确认此前的重置成功，正在刷新实际额度。',
        })
        await refreshAfterOutcome()
        return
      }

      pendingAttemptRef.current = null
      setAmbiguousRetry(false)
      if (code === 'nothing_to_reset') {
        setDialogOutcome('nothing_to_reset')
        setSubmitError('')
        await refreshAfterOutcome()
        return
      }

      setDialogOpen(false)
      if (code === 'already_redeemed') {
        setNotice({ kind: 'error', text: '这张重置卡已经使用，未再次执行重置。' })
      } else if (code === 'no_credit') {
        setNotice({ kind: 'error', text: '当前没有可用的重置卡，列表已刷新。' })
      } else {
        setNotice({ kind: 'error', text: `服务器返回了无法识别的结果：${code}` })
      }
      await refreshAfterOutcome()
    } catch (error) {
      attempt.ambiguous = true
      pendingAttemptRef.current = attempt
      setAmbiguousRetry(true)
      const message = error instanceof Error ? error.message : '网络连接失败。'
      setSubmitError(`${message} 请求结果尚不确定，重试将沿用同一个请求编号，不会重复使用卡片。`)
    } finally {
      submitInFlightRef.current = false
      setSubmitting(false)
    }
  }

  const renderBody = () => {
    if (loadState === 'loading') return (
      <div className="crc-state" role="status">
        <RefreshCw className="crc-spin" size={17} aria-hidden />
        <div><strong>正在查询可用重置卡</strong><span>正在读取当前 Session 的实际卡片状态…</span></div>
      </div>
    )
    if (loadState === 'unauthenticated') return (
      <div className="crc-state crc-state-warning" role="alert">
        <AlertCircle size={18} aria-hidden />
        <div><strong>请先授权 Session</strong><span>当前 Session 已失效，请返回主页面重新授权。</span></div>
        <a href="/">返回主页面</a>
      </div>
    )
    if (loadState === 'forbidden') return (
      <div className="crc-state crc-state-warning" role="alert">
        <AlertCircle size={18} aria-hidden />
        <div><strong>当前方案不支持</strong><span>{loadError || '当前账号或方案不能使用限额重置卡。Session 仍保持授权。'}</span></div>
        <button type="button" onClick={() => void loadCredits()}>重新检查</button>
      </div>
    )
    if (loadState === 'error') return (
      <div className="crc-state crc-state-error" role="alert">
        <AlertCircle size={18} aria-hidden />
        <div><strong>无法查询重置卡</strong><span>{loadError}</span></div>
        <button type="button" onClick={() => void loadCredits()}>重试</button>
      </div>
    )
    if (snapshot?.availableCount === null) return (
      <div className="crc-state" role="status">
        <AlertCircle size={18} aria-hidden />
        <div><strong>可用数量暂不可用</strong><span>接口没有返回可用卡片数量，不会将未知状态显示为 0。</span></div>
        <button type="button" disabled={refreshing} onClick={() => void loadCredits(undefined, true)}>刷新</button>
      </div>
    )
    if (snapshot?.availableCount === 0) return (
      <div className="crc-state" role="status">
        <RotateCcw size={18} aria-hidden />
        <div><strong>暂无可用重置卡</strong><span>获得重置卡后，可在这里一次性恢复卡片对应的 Codex 限额。</span></div>
        <button type="button" disabled={refreshing} onClick={() => void loadCredits(undefined, true)}>刷新</button>
      </div>
    )

    return (
      <>
        <div className="crc-toolbar">
          <span><strong>{countLabel(snapshot?.availableCount ?? null)}</strong> · 每张卡只能成功使用一次</span>
          <button type="button" disabled={refreshing} onClick={() => void loadCredits(undefined, true)}>
            <RefreshCw className={refreshing ? 'crc-spin' : ''} size={13} aria-hidden />
            {refreshing ? '刷新中' : '刷新卡片'}
          </button>
        </div>
        {selections.length > 0 ? (
          <div className="crc-card-list" role="radiogroup" aria-label="选择一张限额重置卡">
            {selections.map((selection) => {
              const expiry = formatExpiry(selection.expiresAt)
              const checked = selected?.key === selection.key
              return (
                <label className={`crc-card${checked ? ' is-selected' : ''}${!selection.supported ? ' is-disabled' : ''}`} key={selection.key}>
                  <input
                    type="radio"
                    name={`reset-credit-${headingId}`}
                    value={selection.key}
                    checked={checked}
                    disabled={!selection.supported}
                    onChange={() => setSelectedKey(selection.key)}
                  />
                  <span className="crc-radio" aria-hidden />
                  <span className="crc-card-copy">
                    <strong>{selection.title}</strong>
                    <span>{selection.automatic
                      ? '卡片明细暂未提供；提交时由服务器自动选择一张可用卡。'
                      : `影响范围：${resetTarget(selection.resetType).short}`}</span>
                    {expiry && <small>有效期至 {expiry}</small>}
                    {!selection.supported && <small className="is-warning">当前方案不支持这张卡</small>}
                  </span>
                </label>
              )
            })}
          </div>
        ) : (
          <div className="crc-inline-empty" role="status">
            卡片状态已经变化，当前没有可选择的可用卡片。请刷新后再试。
          </div>
        )}
        <div className="crc-actions">
          <p>{selected
            ? `将重置${selected.automatic ? '服务器所选卡片对应的窗口' : resetTarget(selected.resetType).short}。`
            : '请选择一张当前方案支持的重置卡。'}</p>
          <button ref={triggerRef} type="button" disabled={!selected || refreshing} onClick={openDialog}>使用重置卡</button>
        </div>
      </>
    )
  }

  return (
    <section className={`crc-section crc-${variant}`} aria-labelledby={headingId} aria-describedby={descriptionId}>
      <header className="crc-heading">
        <div>
          <h3 id={headingId}>使用限额重置</h3>
          <p id={descriptionId}>使用真实重置卡恢复卡片对应的 Codex 限额；重置范围由卡片类型决定。</p>
        </div>
      </header>

      {notice && (
        <div className={`crc-notice is-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          {notice.kind === 'success' ? <Check size={16} aria-hidden /> : <AlertCircle size={16} aria-hidden />}
          <span>{notice.text}</span>
          <button type="button" aria-label="关闭提示" onClick={() => setNotice(null)}><X size={14} /></button>
        </div>
      )}

      {renderBody()}

      {dialogOpen && selected && (
        <div className="crc-dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeDialog()
        }}>
          <section
            ref={dialogRef}
            className="crc-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            aria-describedby={dialogDescriptionId}
            tabIndex={-1}
          >
            <header>
              <div className="crc-dialog-icon"><RotateCcw size={19} aria-hidden /></div>
              <div>
                <h4 id={dialogTitleId}>{dialogOutcome === 'nothing_to_reset' ? '当前额度已是 100%' : '确认使用重置卡？'}</h4>
                <p id={dialogDescriptionId}>{dialogOutcome === 'nothing_to_reset' ? '没有需要重置的限额窗口。' : '成功后，这张卡将被消耗且无法撤销。'}</p>
              </div>
              <button type="button" aria-label="关闭确认框" disabled={submitting} onClick={closeDialog}><X size={18} /></button>
            </header>
            <div className="crc-dialog-body">
              {dialogOutcome === 'nothing_to_reset' ? (
                <div className="crc-dialog-result" role="status">
                  <Check size={18} aria-hidden />
                  <div><strong>重置卡未被使用</strong><span>对应额度当前已经是 100%，你可以稍后再使用这张卡。</span></div>
                </div>
              ) : (
                <>
                  <dl>
                    <div><dt>重置卡</dt><dd>{selected.title}</dd></div>
                    <div><dt>影响范围</dt><dd>{selected.automatic ? '由服务器所选卡片的真实类型决定' : resetTarget(selected.resetType).confirmation}</dd></div>
                    <div><dt>消耗数量</dt><dd>1 张一次性重置卡</dd></div>
                  </dl>
                  {selected.automatic && <p className="crc-dialog-note">当前接口只返回了可用数量，没有返回卡片明细。后端会自动选择一张可用卡，不会发送虚构的卡片 ID。</p>}
                  {submitError && <div className="crc-submit-error" role="alert"><AlertCircle size={16} aria-hidden /><span>{submitError}</span></div>}
                </>
              )}
            </div>
            <footer>
              {dialogOutcome === 'nothing_to_reset' ? (
                <button ref={cancelRef} className="crc-primary" type="button" disabled={submitting} onClick={closeDialog}>知道了</button>
              ) : (
                <>
                  <button ref={cancelRef} className="crc-secondary" type="button" disabled={submitting} onClick={closeDialog}>取消</button>
                  <button className="crc-primary" type="button" disabled={submitting} onClick={() => void consumeCredit()}>
                    {submitting && <RefreshCw className="crc-spin" size={14} aria-hidden />}
                    {submitting ? '正在使用…' : ambiguousRetry ? '使用相同请求重试' : '确认使用'}
                  </button>
                </>
              )}
            </footer>
          </section>
        </div>
      )}

      <span className="crc-sr-only" aria-live="polite">
        {submitting
          ? '正在使用重置卡，请勿重复提交'
          : dialogOutcome === 'nothing_to_reset'
            ? '当前额度已是百分之百，重置卡未被使用'
            : notice?.text ?? ''}
      </span>
    </section>
  )
}

export default CodexResetCredits
