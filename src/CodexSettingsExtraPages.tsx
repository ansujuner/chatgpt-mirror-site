import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  CircleHelp,
  Clipboard,
  Code2,
  FileText,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { CodexResetCredits } from './CodexResetCredits'
import {
  aggregateCodexUsageBreakdown,
  CODEX_USAGE_PALETTE,
  formatApiEquivalent,
  formatCodexCredits,
  formatCodexPricingDisclosure,
  formatUsageBucketDate,
  normalizeCodexUsageDetails,
  selectCodexUsageRange,
  type CodexUsageBreakdown,
  type CodexUsageBucket,
  type CodexUsageDetails,
} from './lib/codexUsageDetails'
import './CodexSettingsExtraPages.css'

type JsonRecord = Record<string, unknown>

type QuotaMetric = {
  id: string
  label: string
  remaining: number
  resetsAt: number | string | null
}

type UsageData = {
  availability: 'available' | 'unlimited'
  plan: string | null
  metrics: QuotaMetric[]
  creditBalance: number | null
  resetCredits: number | null
  usageDetails: CodexUsageDetails
}

const EMPTY_USAGE: UsageData = {
  availability: 'available',
  plan: null,
  metrics: [],
  creditBalance: null,
  resetCredits: null,
  usageDetails: normalizeCodexUsageDetails(null),
}

type UsageLoadState = 'loading' | 'ready' | 'unauthenticated' | 'error'

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function firstValue(record: JsonRecord | null, ...keys: string[]) {
  if (!record) return undefined
  for (const key of keys) if (record[key] !== undefined && record[key] !== null) return record[key]
  return undefined
}

function firstRecord(record: JsonRecord | null, ...keys: string[]) {
  return asRecord(firstValue(record, ...keys))
}

function finiteNumber(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  const number = typeof value === 'number' ? value : Number(value.trim())
  return Number.isFinite(number) ? number : null
}

function clampPercent(value: unknown): number | null {
  const number = finiteNumber(value)
  return number === null ? null : Math.max(0, Math.min(100, Math.round(number)))
}

function quotaLabel(durationMins: number | null, fallback: string) {
  if (durationMins === null || !Number.isFinite(durationMins) || durationMins <= 0) return fallback
  const minutes = durationMins
  if (Math.abs(minutes - 300) <= 15) return '5 小时使用限额'
  if (Math.abs(minutes - 1_440) <= 72) return '每日使用限额'
  if (Math.abs(minutes - 10_080) <= 504) return '每周使用限额'
  if (Math.abs(minutes - 43_200) <= 2_160) return '每月使用上限'
  if (minutes >= 1_440) return `${Math.round(minutes / 1_440)} 天使用限额`
  if (minutes >= 60) return `${Math.round(minutes / 60)} 小时使用限额`
  return `${Math.round(minutes)} 分钟使用限额`
}

function normalizeWindow(value: unknown, id: string, fallbackLabel: string): QuotaMetric | null {
  const window = asRecord(value)
  if (!window) return null
  const used = clampPercent(firstValue(window, 'usedPercent', 'used_percent'))
  const explicitRemaining = clampPercent(firstValue(window, 'remainingPercent', 'remaining_percent'))
  const remaining = explicitRemaining ?? (used === null ? null : 100 - used)
  if (remaining === null) return null

  let durationMins = finiteNumber(firstValue(window, 'windowDurationMins', 'window_duration_mins', 'limitWindowMinutes', 'limit_window_minutes'))
  if (durationMins === null) {
    const durationSeconds = finiteNumber(firstValue(window, 'windowDurationSeconds', 'window_duration_seconds', 'limitWindowSeconds', 'limit_window_seconds'))
    if (durationSeconds !== null) durationMins = durationSeconds / 60
  }
  const rawReset = firstValue(window, 'resetsAt', 'resets_at', 'resetAt', 'reset_at')
  let resetsAt: number | string | null = typeof rawReset === 'number' || typeof rawReset === 'string' ? rawReset : null
  if (resetsAt === null) {
    const resetAfterSeconds = finiteNumber(firstValue(window, 'resetAfterSeconds', 'reset_after_seconds'))
    resetsAt = resetAfterSeconds === null ? null : Math.floor(Date.now() / 1_000 + Math.max(0, resetAfterSeconds))
  }
  return {
    id,
    label: quotaLabel(durationMins, fallbackLabel),
    remaining,
    resetsAt,
  }
}

function normalizeUsage(value: unknown): UsageData | null {
  const payload = asRecord(value)
  if (!payload) return null
  const quota = firstRecord(payload, 'quota')
  const rateLimits = firstRecord(payload, 'rateLimits', 'rate_limits')
  const rateLimit = firstRecord(payload, 'rateLimit', 'rate_limit')
  const primary = normalizeWindow(
    firstValue(quota, 'primary') ?? firstValue(rateLimits, 'primary') ?? firstValue(rateLimit, 'primaryWindow', 'primary_window', 'primary'),
    'primary',
    '主要使用限额',
  )
  const secondary = normalizeWindow(
    firstValue(quota, 'secondary') ?? firstValue(rateLimits, 'secondary') ?? firstValue(rateLimit, 'secondaryWindow', 'secondary_window', 'secondary'),
    'secondary',
    '次要使用限额',
  )
  const rawAvailability = firstValue(payload, 'availability')
  if (rawAvailability === 'unavailable') return null
  const availability = rawAvailability === 'unlimited' ? 'unlimited' : 'available'
  if (!primary && !secondary && availability !== 'unlimited') return null

  const credits = firstRecord(quota, 'credits')
  const resetCredits = firstRecord(quota, 'resetCredits', 'reset_credits')
    ?? firstRecord(payload, 'rateLimitResetCredits', 'rate_limit_reset_credits', 'resetCredits', 'reset_credits')
  const rawBalance = finiteNumber(firstValue(credits, 'balance'))
  const rawResetCredits = finiteNumber(firstValue(resetCredits, 'availableCount', 'available_count'))
  const planValue = firstValue(payload, 'plan', 'planType', 'plan_type')
  return {
    availability,
    plan: typeof planValue === 'string' ? planValue : null,
    metrics: [primary, secondary].filter((metric): metric is QuotaMetric => metric !== null),
    creditBalance: rawBalance === null ? null : Math.max(0, rawBalance),
    resetCredits: rawResetCredits === null ? null : Math.max(0, Math.round(rawResetCredits)),
    usageDetails: normalizeCodexUsageDetails(payload),
  }
}

function resetLabel(timestamp: number | string | null) {
  if (timestamp === null) return null
  let date: Date
  if (typeof timestamp === 'number') date = new Date(timestamp < 10_000_000_000 ? timestamp * 1_000 : timestamp)
  else if (/^\d+(?:\.\d+)?$/.test(timestamp.trim())) {
    const numeric = Number(timestamp)
    date = new Date(numeric < 10_000_000_000 ? numeric * 1_000 : numeric)
  } else date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return null
  return `重置时间：${new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)}`
}

function usageResponseError(payload: unknown, status: number) {
  const root = asRecord(payload)
  const error = firstRecord(root, 'error')
  const message = firstValue(error, 'message') ?? firstValue(root, 'message', 'detail')
  return typeof message === 'string' && message.trim() ? message : `额度接口请求失败（HTTP ${status}）`
}

function PageHeader({ children }: { children: ReactNode }) {
  return <header className="csx-page-header"><h1>{children}</h1></header>
}

function Modal({ title, children, onClose, width = 'medium' }: {
  title: string
  children: ReactNode
  onClose: () => void
  width?: 'medium' | 'wide'
}) {
  return (
    <div className="csx-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`csx-modal csx-modal-${width}`} role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><button type="button" aria-label="关闭" onClick={onClose}><X size={18} /></button></header>
        {children}
      </section>
    </div>
  )
}

function QuotaCard({ metric }: { metric: QuotaMetric }) {
  const reset = resetLabel(metric.resetsAt)
  return (
    <article className="csx-quota-card">
      <p>{metric.label}</p>
      <div className="csx-quota-value"><strong>{metric.remaining}%</strong><span> 剩余</span></div>
      <div className="csx-progress" role="progressbar" aria-label={`${metric.label}剩余 ${metric.remaining}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={metric.remaining}>
        <span className={metric.remaining <= 30 ? 'is-low' : ''} style={{ width: `${metric.remaining}%` }} />
      </div>
      {metric.remaining < 100 && reset && <div className="csx-quota-meta"><span>{reset}</span><i aria-hidden="true" /></div>}
    </article>
  )
}

function usageBucketServiceLabel(bucket: CodexUsageBucket) {
  const models = aggregateCodexUsageBreakdown([bucket], 'model')
    .filter((item) => item.credits > 0)
    .map((item) => item.label)
  const surfaces = aggregateCodexUsageBreakdown([bucket], 'surface')
    .filter((item) => item.credits > 0)
    .map((item) => item.label)
  const labels = models.length > 0 ? models : surfaces
  if (labels.length === 0) return '未归类'
  return labels.length > 2 ? `${labels.slice(0, 2).join('、')} 等` : labels.join('、')
}

export function UsageSettingsPage() {
  const [usage, setUsage] = useState<UsageData>(EMPTY_USAGE)
  const [loadState, setLoadState] = useState<UsageLoadState>('loading')
  const [loadError, setLoadError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [range, setRange] = useState<'week' | 'month'>('month')
  const [metric, setMetric] = useState<'credits' | 'api'>('credits')
  const [breakdown, setBreakdown] = useState<CodexUsageBreakdown>('model')
  const [creditModal, setCreditModal] = useState(false)
  const [autoReloadModal, setAutoReloadModal] = useState(false)
  const [autoReload, setAutoReload] = useState(false)

  const loadUsage = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/codex/analytics', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
        headers: { Accept: 'application/json' },
      })
      const payload: unknown = await response.json().catch(() => null)
      if (response.status === 401) {
        setUsage(EMPTY_USAGE)
        setLoadState('unauthenticated')
        return
      }
      if (!response.ok) throw new Error(usageResponseError(payload, response.status))
      const normalized = normalizeUsage(payload)
      if (!normalized) throw new Error('额度接口没有返回有效的 5 小时或每周额度窗口。')
      setUsage(normalized)
      setLoadState('ready')
    } catch (error) {
      if (signal?.aborted) return
      setUsage(EMPTY_USAGE)
      setLoadState('error')
      setLoadError(error instanceof Error ? error.message : '暂时无法查询当前 Session 的额度。')
    } finally {
      if (!signal?.aborted) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    // The request synchronizes this view with the authenticated server session.
    // eslint-disable-next-line react/set-state-in-effect
    void loadUsage(controller.signal)
    return () => controller.abort()
  }, [loadUsage])

  const retryUsage = () => {
    setLoadState('loading')
    setLoadError('')
    void loadUsage()
  }

  const refreshUsage = () => {
    setRefreshing(true)
    setLoadError('')
    void loadUsage()
  }

  const usageRange = useMemo(() => selectCodexUsageRange(usage.usageDetails, {
    days: range === 'week' ? 7 : 30,
    preferSummary: range === 'month',
  }), [range, usage.usageDetails])
  const breakdownItems = useMemo(
    () => aggregateCodexUsageBreakdown(usageRange.buckets, breakdown),
    [breakdown, usageRange.buckets],
  )
  const breakdownColors = useMemo(() => new Map(
    breakdownItems.map((item, index) => [item.key, CODEX_USAGE_PALETTE[index % CODEX_USAGE_PALETTE.length]]),
  ), [breakdownItems])
  const chartValues = useMemo(() => usageRange.buckets.map((bucket) => (
    metric === 'credits' ? bucket.credits : bucket.apiEquivalentUsd
  )), [metric, usageRange.buckets])
  const maxChartValue = Math.max(0, ...chartValues.map((value) => value ?? 0))
  const shownCredits = usageRange.totalCredits ?? (usageRange.knownCredits > 0 ? usageRange.knownCredits : null)
  const shownPrice = usageRange.apiEquivalentUsd
    ?? (usageRange.knownApiEquivalentUsd > 0 ? usageRange.knownApiEquivalentUsd : null)
  const chartTotal = metric === 'credits' ? shownCredits : shownPrice
  const recordBuckets = useMemo(() => [...usageRange.buckets].reverse(), [usageRange.buckets])

  const quotaContent = () => {
    if (loadState === 'loading') return (
      <div className="csx-usage-status" role="status">
        <RefreshCw className="is-spinning" size={18} aria-hidden />
        <div><strong>正在查询当前 Session 的真实额度</strong><p>请稍候…</p></div>
      </div>
    )
    if (loadState === 'unauthenticated') return (
      <div className="csx-usage-status" role="alert">
        <AlertCircle size={18} aria-hidden />
        <div><strong>请先授权 Session</strong><p>请先在主页面完成 Session 登录，然后返回此处查询 Codex 额度。</p></div>
        <a href="/">返回主页面</a>
      </div>
    )
    if (loadState === 'error') return (
      <div className="csx-usage-status is-error" role="alert">
        <AlertCircle size={18} aria-hidden />
        <div><strong>无法查询额度</strong><p>{loadError}</p></div>
        <button type="button" onClick={retryUsage}>重试</button>
      </div>
    )
    return (
      <>
        <div className="csx-quota-toolbar">
          <span>{usage.plan ? `当前方案：${usage.plan}` : '当前 Session'}</span>
          <button type="button" disabled={refreshing} onClick={refreshUsage}>
            <RefreshCw className={refreshing ? 'is-spinning' : ''} size={14} aria-hidden />
            {refreshing ? '刷新中' : '刷新额度'}
          </button>
        </div>
        {usage.availability === 'unlimited' ? (
          <div className="csx-usage-status" role="status">
            <CircleHelp size={18} aria-hidden />
            <div><strong>用量可用</strong><p>当前账号没有需要显示的百分比限额。</p></div>
          </div>
        ) : (
          <div className="csx-quota-grid">
            {usage.metrics.map((item) => <QuotaCard key={item.id} metric={item} />)}
            <article className="csx-quota-card csx-credit-card">
              <div className="csx-card-heading"><p>剩余额度</p><button className="csx-small-button" type="button" onClick={() => setCreditModal(true)}><Plus size={14} />添加更多</button></div>
              <div className="csx-quota-value"><strong>{usage.creditBalance === null ? '—' : usage.creditBalance.toLocaleString('zh-CN')}</strong></div>
              <p className="csx-card-footnote">{usage.creditBalance === null ? '当前额度接口未返回付费额度余额。' : '额度可让你在超出套餐限制时继续使用。'}</p>
            </article>
          </div>
        )}
      </>
    )
  }

  return (
    <div className="csx-page csx-usage-page">
      <PageHeader>使用情况面板</PageHeader>
      <div className="csx-page-stack csx-usage-stack">
        <section className="csx-section">
          <div className="csx-section-title">
            <div><h2>余额</h2><p>Codex 和工作共用同一用量限额。 <button className="csx-icon-inline" type="button" aria-label="详细了解 Codex 和工作用量限额" title="Codex、ChatGPT Work、ChatGPT for Excel 和工作空间智能体共用此用量限额。聊天会话不包含在内。"><CircleHelp size={15} /></button></p></div>
          </div>
          {quotaContent()}
        </section>

        {loadState === 'ready' && usage.availability !== 'unlimited' && (
          <CodexResetCredits variant="usage" onUsageChanged={refreshUsage} />
        )}

        <section className="csx-section">
          <div className="csx-section-title csx-responsive-title">
            <div><h2>使用详情</h2><p>使用情况数据为近似值，最多可能延迟 6 小时。</p></div>
            <div className="csx-controls-row">
              <div className="csx-segmented" role="group" aria-label="选择使用时间段">
                <button className={range === 'week' ? 'is-active' : ''} type="button" onClick={() => setRange('week')}>周</button>
                <button className={range === 'month' ? 'is-active' : ''} type="button" onClick={() => setRange('month')}>30 天</button>
              </div>
              <div className="csx-segmented" role="group" aria-label="选择使用拆分方式">
                <button className={breakdown === 'model' ? 'is-active' : ''} type="button" onClick={() => setBreakdown('model')}>按模型</button>
                <button className={breakdown === 'surface' ? 'is-active' : ''} type="button" onClick={() => setBreakdown('surface')}>按界面</button>
              </div>
              <label className="csx-select-wrap"><span className="csx-sr-only">选择使用指标</span><select value={metric} onChange={(event) => setMetric(event.currentTarget.value as 'credits' | 'api')}><option value="credits">额度用量</option><option value="api">API 等价估算</option></select><ChevronDown size={15} /></label>
            </div>
          </div>
          <div className="csx-detail-summary">
            <article><span>所选期间额度用量</span><strong>{usageRange.status === 'partial' && shownCredits !== null ? '≥ ' : ''}{formatCodexCredits(shownCredits)}</strong><small>{loadState !== 'ready' ? '等待当前 Session 的额度明细' : usageRange.status === 'partial' ? '仅统计已知额度' : 'ChatGPT 内部额度'}</small></article>
            <article><span>API 等价估算</span><strong>{shownPrice === null ? '—' : `≈ ${formatApiEquivalent(shownPrice, usageRange.pricing.currency)}`}</strong><small>{loadState !== 'ready' ? '等待当前 Session 的额度明细' : usageRange.priceStatus === 'partial' ? '部分明细未计价' : '估算，非账单'}</small></article>
          </div>
          <article className="csx-chart-card">
            <header><div><h3>个人使用</h3><p>{metric === 'credits' ? '已用额度' : 'API 等价价格（估算，非账单）'}</p></div><strong>{metric === 'credits' ? formatCodexCredits(chartTotal) : chartTotal === null ? '—' : `≈ ${formatApiEquivalent(chartTotal, usageRange.pricing.currency)}`}</strong></header>
            {loadState !== 'ready' ? (
              <div className="csx-chart-empty"><div className="csx-chart-grid-lines"><i /><i /><i /><i /></div><p>额度加载完成后显示使用详情</p></div>
            ) : usageRange.status === 'unavailable' ? (
              <div className="csx-chart-empty"><div className="csx-chart-grid-lines"><i /><i /><i /><i /></div><p>当前方案或明细端点暂未返回可用数据</p></div>
            ) : usageRange.status === 'empty' ? (
              <div className="csx-chart-empty"><div className="csx-chart-grid-lines"><i /><i /><i /><i /></div><p>此时间段内没有额度使用数据</p></div>
            ) : usageRange.buckets.length > 0 ? (
              <div className="csx-detail-bars" aria-label={metric === 'credits' ? '每日额度使用图表' : '每日 API 等价价格图表'}>
                {usageRange.buckets.map((bucket, index) => {
                  const value = chartValues[index]
                  const height = value !== null && maxChartValue > 0 ? value / maxChartValue * 100 : 0
                  const titleValue = metric === 'credits'
                    ? `${formatCodexCredits(value)} 额度`
                    : value === null ? '未计价' : formatApiEquivalent(value, usageRange.pricing.currency)
                  return <div className="csx-detail-column" key={bucket.date}>
                    <div className="csx-detail-bar-area"><i className={value === null ? 'is-unknown' : ''} title={`${bucket.date}：${titleValue}`} style={{ height: `${Math.max(value !== null && value > 0 ? 3 : 0, height)}%` }} /></div>
                    <span>{formatUsageBucketDate(bucket.date)}</span>
                  </div>
                })}
              </div>
            ) : (
              <div className="csx-chart-empty"><div className="csx-chart-grid-lines"><i /><i /><i /><i /></div><p>已取得汇总额度，但没有可绘制的每日明细</p></div>
            )}
            {breakdownItems.length > 0 && <div className="csx-detail-legend" aria-label={breakdown === 'model' ? '按模型额度汇总' : '按界面额度汇总'}>
              {breakdownItems.map((item, index) => <div key={item.key}><i style={{ background: breakdownColors.get(item.key) ?? CODEX_USAGE_PALETTE[index % CODEX_USAGE_PALETTE.length] }} /><span>{item.label}</span><strong>{formatCodexCredits(item.credits)}</strong></div>)}
            </div>}
          </article>
          {loadState === 'ready' && usageRange.status === 'partial' && <p className="csx-detail-warning">部分日期没有返回完整额度，总额仅包含接口返回的已知数据。</p>}
          {loadState === 'ready' && usageRange.priceStatus === 'unavailable' && usageRange.status !== 'empty' && usageRange.status !== 'unavailable' && <p className="csx-detail-warning">额度明细已返回，但没有足够的计价信息，暂时无法换算 API 等价价格。</p>}
          {loadState === 'ready' && usageRange.pricing.kind && <p className="csx-detail-note">{formatCodexPricingDisclosure(usageRange.pricing)}</p>}
        </section>

        <section className="csx-section">
          <div className="csx-section-title"><div><h2>额度使用记录</h2><p>数据最多可能延迟 6 小时。</p></div></div>
          <article className="csx-table-card">
            <div className="csx-credit-summary"><div><span>剩余额度</span><strong>{loadState === 'ready' && usage.creditBalance !== null ? usage.creditBalance.toLocaleString('zh-CN') : '—'}</strong></div><button className="csx-secondary-button" type="button" onClick={() => setCreditModal(true)}>添加更多</button></div>
            <div className="csx-table-scroll"><table><thead><tr><th>日期</th><th>服务</th><th>已使用的额度</th><th>API 等价估算</th></tr></thead><tbody>
              {loadState === 'ready' && usageRange.status !== 'unavailable' && usageRange.status !== 'empty' && recordBuckets.length > 0
                ? recordBuckets.map((bucket) => <tr key={bucket.date}><td>{bucket.date}</td><td title={usageBucketServiceLabel(bucket)}>{usageBucketServiceLabel(bucket)}</td><td>{formatCodexCredits(bucket.credits)}</td><td>{bucket.apiEquivalentUsd === null ? '—' : `≈ ${formatApiEquivalent(bucket.apiEquivalentUsd, usageRange.pricing.currency)}`}</td></tr>)
                : <tr><td className="csx-empty-cell" colSpan={4}>{loadState !== 'ready' || usageRange.status === 'unavailable' ? '用量详情暂不可用' : '此时间段内没有额度使用数据'}</td></tr>}
            </tbody></table></div>
          </article>
        </section>

        <section className="csx-section">
          <h2>自动充值</h2>
          <article className="csx-auto-card">
            <div><div className="csx-auto-title"><strong>自动充值额度</strong>{autoReload && <span><Check size={13} />活跃</span>}</div><p>{autoReload ? '达到最低余额时自动添加额度。' : '余额不足时自动添加额度'}</p></div>
            <button className="csx-secondary-button" type="button" onClick={() => setAutoReloadModal(true)}>设置</button>
          </article>
        </section>
      </div>

      {creditModal && (
        <Modal title="购买更多额度" onClose={() => setCreditModal(false)}>
          <div className="csx-modal-body">
            <p className="csx-modal-copy">额度可用于在套餐用量限额之外继续运行 Codex 云任务和代码审查。</p>
            <label className="csx-field"><span>要添加的金额</span><div className="csx-number-field"><input type="number" min={5} defaultValue={20} /><span>美元</span></div></label>
          </div>
          <footer className="csx-modal-actions"><button className="csx-secondary-button" type="button" onClick={() => setCreditModal(false)}>取消</button><button className="csx-primary-button" type="button" onClick={() => setCreditModal(false)}>继续</button></footer>
        </Modal>
      )}
      {autoReloadModal && (
        <Modal title="自动充值" onClose={() => setAutoReloadModal(false)}>
          <div className="csx-modal-body">
            <p className="csx-modal-copy">余额不足时自动购买额度。启用后，当余额低于最低值时，系统会从你的付款方式扣款。</p>
            <label className="csx-switch-row"><span><strong>自动充值额度</strong><small>达到最低余额时自动添加额度。</small></span><input type="checkbox" checked={autoReload} onChange={(event) => setAutoReload(event.currentTarget.checked)} /><i /></label>
            <div className="csx-two-fields"><label className="csx-field"><span>最低余额</span><input type="number" min={0} defaultValue={5} /></label><label className="csx-field"><span>目标余额</span><input type="number" min={1} defaultValue={20} /></label></div>
          </div>
          <footer className="csx-modal-actions"><button className="csx-secondary-button" type="button" onClick={() => setAutoReloadModal(false)}>取消</button><button className="csx-primary-button" type="button" onClick={() => setAutoReloadModal(false)}>保存</button></footer>
        </Modal>
      )}
    </div>
  )
}

type NoticeKind = 'headline' | 'announcement'

type WorkspaceNotice = {
  id: number
  kind: NoticeKind
  text: string
  archived: boolean
}

type NotificationsSettingsPageProps = {
  isAdmin?: boolean
}

function noticeCopy(kind: NoticeKind) {
  return kind === 'headline'
    ? { label: '标题', active: '生效标题', archived: '已归档标题', placeholder: '为此工作区撰写标题' }
    : { label: '公告', active: '生效公告', archived: '已归档公告', placeholder: '为此工作区撰写公告' }
}

export function NotificationsSettingsPage({ isAdmin = true }: NotificationsSettingsPageProps = {}) {
  const [notices, setNotices] = useState<WorkspaceNotice[]>([])
  const [editor, setEditor] = useState<{ kind: NoticeKind; id: number | null } | null>(null)
  const [draft, setDraft] = useState('')
  const [toast, setToast] = useState('')

  function openCreate(kind: NoticeKind) {
    setDraft('')
    setEditor({ kind, id: null })
  }

  function openEdit(notice: WorkspaceNotice) {
    setDraft(notice.text)
    setEditor({ kind: notice.kind, id: notice.id })
  }

  function saveNotice() {
    if (!editor || !draft.trim() || draft.length > 200) return
    if (editor.id == null) {
      setNotices((current) => [...current, { id: Date.now(), kind: editor.kind, text: draft.trim(), archived: false }])
      setToast('已添加通知')
    } else {
      setNotices((current) => current.map((notice) => notice.id === editor.id ? { ...notice, text: draft.trim() } : notice))
      setToast('已更新通知')
    }
    setEditor(null)
    window.setTimeout(() => setToast(''), 2_200)
  }

  function archiveNotice(id: number) {
    setNotices((current) => current.map((notice) => notice.id === id ? { ...notice, archived: true } : notice))
    setToast('已移除通知')
    window.setTimeout(() => setToast(''), 2_200)
  }

  return (
    <div className="csx-page csx-notifications-page">
      <PageHeader>通知</PageHeader>
      <div className="csx-page-stack csx-narrow-stack">
        {!isAdmin && <div className="csx-info-banner"><AlertCircle size={18} /><span>只有工作区管理员才能管理 Codex 通知。</span></div>}
        <p className="csx-page-description">管理整个工作区的 Codex 通知。同一时间可各保有一条生效标题与生效公告。标题会对所有人持续展示，直至移除。公告会向每位用户显示，直至用户手动关闭。</p>
        {(['headline', 'announcement'] as const).map((kind) => {
          const copy = noticeCopy(kind)
          const active = notices.find((notice) => notice.kind === kind && !notice.archived)
          const archived = notices.filter((notice) => notice.kind === kind && notice.archived)
          return (
            <section className="csx-notice-section" key={kind}>
              <header><h2>{copy.label}</h2>{isAdmin && !active && <button className="csx-secondary-button" type="button" onClick={() => openCreate(kind)}><Plus size={15} />添加</button>}</header>
              {active ? (
                <article className="csx-notice-card">
                  <div><span>{copy.active}</span><p>{active.text}</p></div>
                  {isAdmin && <div className="csx-notice-actions"><button type="button" onClick={() => openEdit(active)}>编辑</button><button className="is-danger" type="button" onClick={() => archiveNotice(active.id)}>移除</button></div>}
                </article>
              ) : (
                <div className="csx-notice-empty"><FileText size={20} /><p>当前没有{copy.active}。</p></div>
              )}
              <div className="csx-archive-heading"><span>{copy.archived}{archived.length ? ` (${archived.length})` : ''}</span></div>
              {archived.length ? archived.map((notice) => <article className="csx-archived-row" key={notice.id}><div><span>{copy.archived}</span><p>{notice.text}</p></div></article>) : <p className="csx-archive-empty">暂无{copy.archived.replace('已归档', '已归档的')}。</p>}
            </section>
          )
        })}
      </div>
      {toast && <div className="csx-toast" role="status"><Check size={16} />{toast}</div>}
      {editor && (
        <Modal title={`${editor.id == null ? '添加' : '编辑'}${noticeCopy(editor.kind).label}`} onClose={() => setEditor(null)}>
          <div className="csx-modal-body">
            <label className="csx-field"><span>{noticeCopy(editor.kind).label}</span><textarea autoFocus maxLength={200} rows={5} placeholder={noticeCopy(editor.kind).placeholder} value={draft} onChange={(event) => setDraft(event.currentTarget.value)} /><small className={draft.length >= 200 ? 'is-limit' : ''}>{draft.length}/200 个字符</small></label>
          </div>
          <footer className="csx-modal-actions"><button className="csx-secondary-button" type="button" onClick={() => setEditor(null)}>取消</button><button className="csx-primary-button" type="button" disabled={!draft.trim()} onClick={saveNotice}>{editor.id == null ? '添加' : '保存'}</button></footer>
        </Modal>
      )}
    </div>
  )
}

type Policy = {
  id: number
  groups: string[]
  contents: string
  isDefault: boolean
  hash: string
  updatedAt: string
}

type PoliciesSettingsPageProps = {
  enabled?: boolean
  isAdmin?: boolean
}

const WORKSPACE_GROUPS = ['Engineering', 'Security', 'Design', 'Data', 'Contractors']
const DEFAULT_POLICY = '# requirements.toml\n\n# Configure approval and sandbox restrictions for Codex clients.\n'

function newPolicy(id: number, isDefault = false): Policy {
  return { id, groups: [], contents: DEFAULT_POLICY, isDefault, hash: '—', updatedAt: '—' }
}

export function PoliciesSettingsPage({ enabled = true, isAdmin = true }: PoliciesSettingsPageProps = {}) {
  const [policies, setPolicies] = useState<Policy[]>([newPolicy(1, true)])
  const [lookupMode, setLookupMode] = useState<'group' | 'email'>('group')
  const [lookupGroup, setLookupGroup] = useState('')
  const [lookupEmail, setLookupEmail] = useState('')
  const [saved, setSaved] = useState(false)

  const assignedGroups = useMemo(() => new Set(policies.flatMap((policy) => policy.groups)), [policies])
  const effectiveGroup = lookupMode === 'group' ? lookupGroup : lookupEmail.toLowerCase().endsWith('@openai.com') ? 'Engineering' : ''
  const effectivePolicy = policies.find((policy) => effectiveGroup && policy.groups.includes(effectiveGroup)) ?? policies.find((policy) => policy.isDefault) ?? null

  function updatePolicy(id: number, change: (policy: Policy) => Policy) {
    setPolicies((current) => current.map((policy) => policy.id === id ? change(policy) : policy))
  }

  function addPolicy() {
    setPolicies((current) => {
      const next = newPolicy(Math.max(0, ...current.map((policy) => policy.id)) + 1)
      const defaultIndex = current.findIndex((policy) => policy.isDefault)
      if (defaultIndex < 0) return [...current, next]
      return [...current.slice(0, defaultIndex), next, ...current.slice(defaultIndex)]
    })
  }

  function removePolicy(id: number) {
    setPolicies((current) => {
      const removed = current.find((policy) => policy.id === id)
      const remaining = current.filter((policy) => policy.id !== id)
      if (!remaining.length) return []
      if (removed?.isDefault) return remaining.map((policy, index) => ({ ...policy, isDefault: index === remaining.length - 1 }))
      return remaining
    })
  }

  function movePolicy(id: number, direction: -1 | 1) {
    setPolicies((current) => {
      const from = current.findIndex((policy) => policy.id === id)
      const to = from + direction
      if (from < 0 || to < 0 || to >= current.length || current[to].isDefault) return current
      const next = [...current]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }

  function setDefaultPolicy(id: number) {
    setPolicies((current) => current.map((policy) => ({ ...policy, isDefault: policy.id === id })).sort((left, right) => Number(left.isDefault) - Number(right.isDefault)))
  }

  function addGroup(policyId: number, group: string) {
    if (!group || assignedGroups.has(group)) return
    updatePolicy(policyId, (policy) => ({ ...policy, groups: [...policy.groups, group] }))
  }

  function savePolicies() {
    const date = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())
    setPolicies((current) => current.map((policy) => ({ ...policy, hash: Math.random().toString(16).slice(2, 10), updatedAt: date })))
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2_200)
  }

  if (!enabled) return <div className="csx-page"><PageHeader>策略与配置</PageHeader><div className="csx-state-card"><AlertCircle size={20} /><div><h2>托管配置不可用</h2><p>此工作空间已禁用托管配置。</p></div></div></div>
  if (!isAdmin) return <div className="csx-page"><PageHeader>策略与配置</PageHeader><div className="csx-state-card"><ShieldCheck size={20} /><div><h2>需要管理员权限</h2><p>只有 Codex 管理员才能查看策略。</p></div></div></div>

  return (
    <div className="csx-page csx-policies-page">
      <PageHeader>策略与配置</PageHeader>
      <div className="csx-page-stack">
        <section className="csx-policy-intro">
          <div><h2>策略</h2><p>为 Codex 客户端定义整个工作区的审批和沙箱限制。策略将从上到下检查；首个匹配的群组策略生效，只有在没有群组策略匹配时才使用默认文件。</p></div>
          <button className="csx-primary-button" type="button" onClick={addPolicy}><Plus size={15} />添加策略</button>
        </section>
        <div className="csx-precedence-note"><CircleHelp size={16} /><p>优先顺序从上到下。使用“上移”和“下移”重新排列覆盖策略。默认后备策略固定在底部。</p></div>

        {policies.length === 0 ? (
          <div className="csx-policy-empty"><FileText size={23} /><p>尚无策略。</p><button className="csx-secondary-button" type="button" onClick={addPolicy}><Plus size={15} />添加策略</button></div>
        ) : (
          <div className="csx-policy-list">
            {policies.map((policy, index) => {
              const title = policy.isDefault ? '后备策略（最后评估）' : `策略 ${index + 1}`
              const canMoveUp = !policy.isDefault && index > 0
              const canMoveDown = !policy.isDefault && index < policies.length - 1 && !policies[index + 1].isDefault
              return (
                <article className={`csx-policy-card${policy.isDefault ? ' is-default' : ''}`} key={policy.id}>
                  <header>
                    <div><h3>{title}</h3>{policy.isDefault && <span>默认后备</span>}</div>
                    <div className="csx-policy-actions">
                      {!policy.isDefault && <><button type="button" disabled={!canMoveUp} title="上移" onClick={() => movePolicy(policy.id, -1)}><ArrowUp size={15} />上移</button><button type="button" disabled={!canMoveDown} title="下移" onClick={() => movePolicy(policy.id, 1)}><ArrowDown size={15} />下移</button><button type="button" onClick={() => setDefaultPolicy(policy.id)}>设为默认后备</button></>}
                      <button className="is-danger" type="button" title="移除" onClick={() => removePolicy(policy.id)}><Trash2 size={15} />移除</button>
                    </div>
                  </header>
                  {!policy.isDefault && (
                    <div className="csx-group-field">
                      <label htmlFor={`policy-group-${policy.id}`}>群组</label>
                      <p>为此策略选择一个或多个群组。每个群组只能分配给一个策略。</p>
                      <div className="csx-group-chips">
                        {policy.groups.map((group) => <button type="button" key={group} onClick={() => updatePolicy(policy.id, (current) => ({ ...current, groups: current.groups.filter((name) => name !== group) }))}>{group}<X size={13} /></button>)}
                        <label className="csx-add-group"><select id={`policy-group-${policy.id}`} value="" onChange={(event) => addGroup(policy.id, event.currentTarget.value)}><option value="">选择群组</option>{WORKSPACE_GROUPS.map((group) => <option value={group} disabled={assignedGroups.has(group)} key={group}>{group}{assignedGroups.has(group) ? '（已分配）' : ''}</option>)}</select><ChevronDown size={14} /></label>
                      </div>
                    </div>
                  )}
                  <label className="csx-policy-editor"><span className="csx-sr-only">{title} requirements.toml</span><textarea spellCheck={false} value={policy.contents} onChange={(event) => updatePolicy(policy.id, (current) => ({ ...current, contents: event.currentTarget.value }))} /></label>
                  <footer>哈希：{policy.hash} · 更新时间：{policy.updatedAt}</footer>
                </article>
              )
            })}
          </div>
        )}

        <section className="csx-lookup-card">
          <div><h2>快速查找</h2><p>选择一个群组或按用户电子邮箱查找，查看当前优先级下适用的策略。</p></div>
          <div className="csx-segmented" role="group" aria-label="快速查找方式"><button className={lookupMode === 'group' ? 'is-active' : ''} type="button" onClick={() => setLookupMode('group')}>按群组</button><button className={lookupMode === 'email' ? 'is-active' : ''} type="button" onClick={() => setLookupMode('email')}>按用户邮箱</button></div>
          {lookupMode === 'group' ? <label className="csx-field"><span>群组</span><select value={lookupGroup} onChange={(event) => setLookupGroup(event.currentTarget.value)}><option value="">未选择群组</option>{WORKSPACE_GROUPS.map((group) => <option key={group}>{group}</option>)}</select></label> : <label className="csx-field"><span>用户邮箱</span><input type="email" placeholder="name@company.com" value={lookupEmail} onChange={(event) => setLookupEmail(event.currentTarget.value)} /></label>}
          {(lookupGroup || lookupEmail) && <div className="csx-lookup-result"><span>生效策略</span><strong>{effectivePolicy ? effectivePolicy.isDefault ? '默认策略' : `策略 ${policies.indexOf(effectivePolicy) + 1}` : '未配置默认策略'}</strong><p>{effectiveGroup && effectivePolicy?.groups.includes(effectiveGroup) ? `匹配群组：${effectiveGroup}` : '未找到匹配的群组策略。正在使用默认策略。'}</p></div>}
        </section>

        <div className="csx-save-row"><button className="csx-primary-button" type="button" disabled={!policies.length} onClick={savePolicies}>保存</button></div>
      </div>
      {saved && <div className="csx-toast" role="status"><Check size={16} />策略已保存</div>}
    </div>
  )
}

export function ManagedConfigsSettingsPage(props: PoliciesSettingsPageProps = {}) {
  return <PoliciesSettingsPage {...props} />
}

type ApiEndpoint = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  title: string
  description: string
  request?: string
  response: string
}

const API_ENDPOINTS: ApiEndpoint[] = [
  { method: 'GET', path: '/wham/environments/with-creators', title: '列出环境', description: '返回当前账户可访问的 Codex 云环境及其创建者。', response: '{\n  "items": [],\n  "next_cursor": null\n}' },
  { method: 'POST', path: '/wham/environments', title: '创建环境', description: '创建用于云任务和代码审查的项目环境。', request: '{\n  "name": "my-environment",\n  "repository_id": "github-123"\n}', response: '{\n  "id": "env_...",\n  "name": "my-environment"\n}' },
  { method: 'PATCH', path: '/wham/environments/{environment_id}', title: '更新环境', description: '更新指定环境的配置、密钥或网络访问设置。', request: '{\n  "description": "Updated environment"\n}', response: '{\n  "id": "env_...",\n  "description": "Updated environment"\n}' },
  { method: 'DELETE', path: '/wham/environments/{environment_id}', title: '删除环境', description: '删除环境。使用它的现有任务会保留，但无法再创建后续任务。', response: '{\n  "success": true\n}' },
  { method: 'GET', path: '/wham/settings/code_review', title: '列出代码审查设置', description: '列出 GitHub 或 GitLab 存储库的代码审查配置。', response: '{\n  "repositories": [],\n  "next_token": null\n}' },
  { method: 'PATCH', path: '/wham/settings/code_review', title: '更新代码审查设置', description: '批量更新一个或多个存储库的代码与安全审查首选项。', request: '{\n  "repo_review_settings": []\n}', response: '{\n  "repo_review_settings": []\n}' },
  { method: 'GET', path: '/wham/agent-identities', title: '列出访问令牌', description: '返回可由当前用户管理的 Codex 访问令牌身份。', response: '{\n  "items": []\n}' },
  { method: 'POST', path: '/wham/agent-identities', title: '创建访问令牌', description: '使用准备请求返回的声明创建访问令牌身份。', request: '{\n  "name": "CI agent",\n  "scopes": ["codex"]\n}', response: '{\n  "id": "agent_..."\n}' },
]

function methodClass(method: ApiEndpoint['method']) {
  return `is-${method.toLowerCase()}`
}

function endpointKey(endpoint: ApiEndpoint) {
  return `${endpoint.method} ${endpoint.path}`
}

export function ApiReferenceSettingsPage() {
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState(endpointKey(API_ENDPOINTS[0]))
  const [copied, setCopied] = useState('')
  const endpoints = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? API_ENDPOINTS.filter((endpoint) => `${endpoint.method} ${endpoint.path} ${endpoint.title}`.toLowerCase().includes(needle)) : API_ENDPOINTS
  }, [query])
  const selected = API_ENDPOINTS.find((endpoint) => endpointKey(endpoint) === selectedKey) ?? endpoints[0] ?? API_ENDPOINTS[0]

  function copyText(value: string) {
    navigator.clipboard?.writeText(value).catch(() => undefined)
    setCopied(value)
    window.setTimeout(() => setCopied(''), 1_700)
  }

  return (
    <div className="csx-api-reference">
      <aside className="csx-api-sidebar">
        <div className="csx-api-brand"><Code2 size={20} /><div><strong>Codex Cloud API</strong><span>API 参考文档</span></div></div>
        <label className="csx-api-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索…" aria-label="搜索 API" />{query && <button type="button" aria-label="清除搜索" onClick={() => setQuery('')}><X size={14} /></button>}</label>
        <nav aria-label="API 端点">
          <p>端点</p>
          {endpoints.map((endpoint) => <button className={endpointKey(endpoint) === endpointKey(selected) ? 'is-active' : ''} type="button" key={endpointKey(endpoint)} onClick={() => setSelectedKey(endpointKey(endpoint))}><span className={methodClass(endpoint.method)}>{endpoint.method}</span><span>{endpoint.title}</span></button>)}
          {!endpoints.length && <div className="csx-api-no-results">没有搜索结果</div>}
        </nav>
        <a href="https://redocly.com/redoc/" target="_blank" rel="noreferrer">API docs by Redocly</a>
      </aside>
      <main className="csx-api-main">
        <header><span>Codex Cloud API</span><strong>1.0.0</strong><h1>{selected.title}</h1><p>{selected.description}</p></header>
        <section className="csx-api-operation">
          <div className="csx-api-path"><span className={methodClass(selected.method)}>{selected.method}</span><code>{selected.path}</code><button type="button" aria-label="复制端点" onClick={() => copyText(selected.path)}>{copied === selected.path ? <Check size={16} /> : <Clipboard size={16} />}</button></div>
          <h2>授权</h2><p>使用有效的 ChatGPT 会话，并在请求中发送工作空间账户上下文。</p>
          {selected.request && <><h2>请求正文</h2><CodeSample title="application/json" value={selected.request} copied={copied} onCopy={copyText} /></>}
          <h2>响应</h2><div className="csx-response-heading"><span>200</span><p>请求成功</p></div><CodeSample title="application/json" value={selected.response} copied={copied} onCopy={copyText} />
        </section>
      </main>
      <aside className="csx-api-sample">
        <h2>请求示例</h2>
        <CodeSample title="Shell" value={`curl -X ${selected.method} \\\n+  'https://chatgpt.com/backend-api${selected.path}' \\\n+  -H 'Content-Type: application/json'`} copied={copied} onCopy={copyText} />
      </aside>
    </div>
  )
}

function CodeSample({ title, value, copied, onCopy }: { title: string; value: string; copied: string; onCopy: (value: string) => void }) {
  return (
    <div className="csx-code-sample"><header><span>{title}</span><button type="button" aria-label="复制代码" onClick={() => onCopy(value)}>{copied === value ? <Check size={15} /> : <Clipboard size={15} />}</button></header><pre><code>{value}</code></pre></div>
  )
}

export function ApiReferenceLoadingState() {
  return <div className="csx-api-state"><RefreshCw className="is-spinning" size={20} /><span>正在加载 API 参考文档…</span></div>
}

export function ApiReferenceErrorState() {
  return <div className="csx-api-state"><AlertCircle size={20} /><span>我们暂时无法加载 API 参考文档。请稍后重试。</span></div>
}
