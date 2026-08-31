import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, CircleHelp, LogIn, RefreshCw } from 'lucide-react'
import { CodexResetCredits } from './CodexResetCredits'
import {
  aggregateCodexUsageBreakdown,
  CODEX_USAGE_PALETTE,
  codexUsageBucketSlices,
  formatApiEquivalent,
  formatCodexCredits,
  formatCodexPricingDisclosure,
  formatUsageBucketDate,
  normalizeCodexUsageDetails,
  selectCodexUsageRange,
  type CodexUsageBreakdown,
  type CodexUsageDetails,
} from './lib/codexUsageDetails'
import './CodexSettingsAnalyticsPage.css'

type Period = '7d' | '1m' | 'custom'
type AnalyticsTab = 'usage' | 'reviews'
type LoadState = 'loading' | 'ready' | 'unauthenticated' | 'error'
type JsonRecord = Record<string, unknown>

type RateWindow = {
  usedPercent: number | null
  remainingPercent: number
  windowDurationMins: number | null
  resetsAt: number | string | null
}

type AnalyticsData = {
  availability: 'available' | 'unlimited'
  plan: string | null
  primary: RateWindow | null
  secondary: RateWindow | null
  resetCredits: number | null
  usageDetails: CodexUsageDetails
}

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
  if (typeof value === 'boolean' || value === null || value === undefined) return null
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function nonNegativeInteger(value: unknown) {
  const numeric = finiteNumber(value)
  return numeric === null ? null : Math.max(0, Math.round(numeric))
}

function percent(value: unknown): number | null {
  const numeric = finiteNumber(value)
  return numeric === null ? null : Math.min(100, Math.max(0, Math.round(numeric)))
}

function normalizeWindow(value: unknown): RateWindow | null {
  const window = asRecord(value)
  if (!window) return null
  const used = percent(firstValue(window, 'usedPercent', 'used_percent'))
  const explicitRemaining = percent(firstValue(window, 'remainingPercent', 'remaining_percent'))
  const remaining = explicitRemaining ?? (used === null ? null : 100 - used)
  if (remaining === null) return null

  let durationMins = finiteNumber(firstValue(window, 'windowDurationMins', 'window_duration_mins', 'limitWindowMinutes', 'limit_window_minutes'))
  if (durationMins === null) {
    const seconds = finiteNumber(firstValue(window, 'windowDurationSeconds', 'window_duration_seconds', 'limitWindowSeconds', 'limit_window_seconds'))
    if (seconds !== null) durationMins = seconds / 60
  }
  const rawReset = firstValue(window, 'resetsAt', 'resets_at', 'resetAt', 'reset_at')
  let resetsAt = typeof rawReset === 'string' || typeof rawReset === 'number' ? rawReset : null
  if (resetsAt === null) {
    const resetAfterSeconds = finiteNumber(firstValue(window, 'resetAfterSeconds', 'reset_after_seconds'))
    if (resetAfterSeconds !== null) resetsAt = Math.floor(Date.now() / 1_000 + Math.max(0, resetAfterSeconds))
  }
  return { usedPercent: used, remainingPercent: remaining, windowDurationMins: durationMins, resetsAt }
}

function normalizePayload(value: unknown): AnalyticsData | null {
  const payload = asRecord(value)
  if (!payload) return null
  const quota = firstRecord(payload, 'quota')
  const rateLimits = firstRecord(payload, 'rateLimits', 'rate_limits')
  const rateLimit = firstRecord(payload, 'rateLimit', 'rate_limit')
  const primary = normalizeWindow(
    firstValue(quota, 'primary') ?? firstValue(rateLimits, 'primary') ?? firstValue(rateLimit, 'primaryWindow', 'primary_window', 'primary'),
  )
  const secondary = normalizeWindow(
    firstValue(quota, 'secondary') ?? firstValue(rateLimits, 'secondary') ?? firstValue(rateLimit, 'secondaryWindow', 'secondary_window', 'secondary'),
  )
  const rawAvailability = firstValue(payload, 'availability')
  if (rawAvailability === 'unavailable') return null
  const availability = rawAvailability === 'unlimited' ? 'unlimited' : 'available'
  if (!primary && !secondary && availability !== 'unlimited') return null

  const resetCredits = firstRecord(quota, 'resetCredits', 'reset_credits')
    ?? firstRecord(payload, 'resetCredits', 'reset_credits', 'rateLimitResetCredits', 'rate_limit_reset_credits')
  const planValue = firstValue(payload, 'plan', 'planType', 'plan_type')
  return {
    availability,
    plan: typeof planValue === 'string' ? planValue : null,
    primary,
    secondary,
    resetCredits: nonNegativeInteger(firstValue(resetCredits, 'availableCount', 'available_count')),
    usageDetails: normalizeCodexUsageDetails(payload),
  }
}

function formatReset(value: RateWindow['resetsAt']) {
  if (value === null) return null
  let date: Date
  if (typeof value === 'number') date = new Date(value < 10_000_000_000 ? value * 1_000 : value)
  else if (/^\d+(?:\.\d+)?$/.test(value.trim())) {
    const numeric = Number(value)
    date = new Date(numeric < 10_000_000_000 ? numeric * 1_000 : numeric)
  } else date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

function quotaWindowTitle(window: RateWindow | null, slot: 'primary' | 'secondary') {
  const minutes = window?.windowDurationMins
  if (minutes !== null && minutes !== undefined && Number.isFinite(minutes) && minutes > 0) {
    if (Math.abs(minutes - 300) <= 15) return '5 小时使用上限'
    if (Math.abs(minutes - 10_080) <= 504) return '每周使用上限'
    if (Math.abs(minutes - 43_200) <= 2_160) return '每月使用上限'
    if (minutes >= 1_440) return `${Math.round(minutes / 1_440)} 天使用上限`
    if (minutes >= 60) return `${Math.round(minutes / 60)} 小时使用上限`
    return `${Math.round(minutes)} 分钟使用上限`
  }
  return slot === 'primary' ? '主要使用限额' : '次要使用限额'
}

function QuotaCard({ slot, window }: { slot: 'primary' | 'secondary'; window: RateWindow | null }) {
  // `primary`/`secondary` are transport slots only. The visible cadence comes
  // from WHAM's actual limit_window_seconds -> windowDurationMins value.
  const title = quotaWindowTitle(window, slot)
  if (!window) return (
    <article className="csa-quota-card is-unavailable">
      <span className="csa-quota-label">{title}</span>
      <div className="csa-quota-unavailable">当前 Session 未返回此额度窗口</div>
    </article>
  )
  const reset = formatReset(window.resetsAt)
  return (
    <article className="csa-quota-card">
      <span className="csa-quota-label">{title}</span>
      <div className="csa-quota-value"><strong>{window.remainingPercent}%</strong><span>剩余</span></div>
      <div className="csa-quota-track" role="progressbar" aria-label={`${title}剩余 ${window.remainingPercent}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={window.remainingPercent}>
        <i className={window.remainingPercent <= 20 ? 'is-low' : ''} style={{ width: `${window.remainingPercent}%` }} />
      </div>
      <span className="csa-quota-reset">{reset ? `重置时间：${reset}` : '重置时间暂不可用'}</span>
    </article>
  )
}

function responseError(payload: unknown, status: number) {
  const root = asRecord(payload)
  const error = firstRecord(root, 'error')
  const message = firstValue(error, 'message') ?? firstValue(root, 'message', 'detail')
  return typeof message === 'string' && message.trim() ? message : `额度接口请求失败（HTTP ${status}）`
}

export function AnalyticsSettingsPage() {
  const [period, setPeriod] = useState<Period>('1m')
  const [tab, setTab] = useState<AnalyticsTab>('usage')
  const [groupBy, setGroupBy] = useState<'day' | 'week'>('day')
  const [breakdown, setBreakdown] = useState<CodexUsageBreakdown>('model')
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const loadUsage = useCallback(async (signal?: AbortSignal) => {
    if (data) setRefreshing(true)
    else setLoadState('loading')
    setLoadError('')
    try {
      const response = await fetch('/api/codex/analytics', {
        credentials: 'same-origin', cache: 'no-store', signal, headers: { Accept: 'application/json' },
      })
      const payload: unknown = await response.json().catch(() => null)
      if (response.status === 401) {
        setData(null)
        setLoadState('unauthenticated')
        return
      }
      if (!response.ok) throw new Error(responseError(payload, response.status))
      const normalized = normalizePayload(payload)
      if (!normalized) throw new Error('额度接口没有返回有效的使用限额窗口。')
      setData(normalized)
      setLoadState('ready')
    } catch (error) {
      if (signal?.aborted) return
      setData(null)
      setLoadState('error')
      setLoadError(error instanceof Error ? error.message : '暂时无法查询当前 Session 的额度。')
    } finally {
      if (!signal?.aborted) setRefreshing(false)
    }
  }, [data])

  useEffect(() => {
    const controller = new AbortController()
    void loadUsage(controller.signal)
    return () => controller.abort()
    // 每次进入页面仅查询一次当前 HttpOnly Session，手动刷新由按钮触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const usageRange = useMemo(() => {
    const details = data?.usageDetails ?? normalizeCodexUsageDetails(null)
    if (period === 'custom') {
      return selectCodexUsageRange(details, {
        startDate: customStart || undefined,
        endDate: customEnd || undefined,
      })
    }
    return selectCodexUsageRange(details, {
      days: period === '7d' ? 7 : 30,
      preferSummary: period === '1m',
    })
  }, [customEnd, customStart, data, period])
  const breakdownItems = useMemo(
    () => aggregateCodexUsageBreakdown(usageRange.buckets, breakdown),
    [breakdown, usageRange.buckets],
  )
  const breakdownColors = useMemo(() => new Map(
    breakdownItems.map((item, index) => [item.key, CODEX_USAGE_PALETTE[index % CODEX_USAGE_PALETTE.length]]),
  ), [breakdownItems])
  const maxDailyCredits = useMemo(() => Math.max(0, ...usageRange.buckets.map((bucket) => {
    if (bucket.credits !== null) return bucket.credits
    return codexUsageBucketSlices(bucket, breakdown).reduce((total, slice) => total + slice.credits, 0)
  })), [breakdown, usageRange.buckets])
  const shownCredits = usageRange.totalCredits ?? (usageRange.knownCredits > 0 ? usageRange.knownCredits : null)
  const shownPrice = usageRange.apiEquivalentUsd
    ?? (usageRange.knownApiEquivalentUsd > 0 ? usageRange.knownApiEquivalentUsd : null)
  const isPlus = data?.plan?.toLowerCase().includes('plus') === true
  const quotaDescription = isPlus
    ? 'Plus 的 Codex 额度包含滚动 5 小时窗口和每周窗口。'
    : data?.availability === 'unlimited'
      ? '当前账号可用，没有需要显示的剩余百分比。'
      : data?.plan
      ? `${data.plan} 方案的额度窗口以当前 Session 的实际返回结果为准。`
      : '额度窗口以当前 Session 的实际返回结果为准。'
  const choosePeriod = (next: Period) => { setPeriod(next); setCustomOpen(next === 'custom') }

  const quotaContent = () => {
    if (loadState === 'loading') return <div className="csa-quota-state is-loading" role="status"><span className="csa-spinner" />正在查询当前 Session 的真实额度…</div>
    if (loadState === 'unauthenticated') return (
      <div className="csa-quota-state" role="alert">
        <LogIn aria-hidden size={18} />
        <div><strong>尚未授权 Session</strong><span>请先在主页面通过 Session 登录，然后返回此处查询 Codex 额度。</span></div>
        <a href="/">返回主页面</a>
      </div>
    )
    if (loadState === 'error') return (
      <div className="csa-quota-state is-error" role="alert">
        <CircleHelp aria-hidden size={18} />
        <div><strong>无法查询额度</strong><span>{loadError}</span></div>
        <button type="button" onClick={() => void loadUsage()}>重试</button>
      </div>
    )
    return <>
      <div className="csa-quota-toolbar">
        <span>{data?.plan ? `当前方案：${data.plan}` : '当前 Session'}</span>
        <button type="button" disabled={refreshing} onClick={() => void loadUsage()}><RefreshCw aria-hidden size={13} className={refreshing ? 'is-spinning' : ''} />{refreshing ? '刷新中' : '刷新额度'}</button>
      </div>
      {data?.availability === 'unlimited' ? (
        <div className="csa-quota-state" role="status">
          <CircleHelp aria-hidden size={18} />
          <div><strong>用量可用</strong><span>当前账号没有需要显示的百分比限额。</span></div>
        </div>
      ) : (
        <div className="csa-quota-list">
          <QuotaCard slot="primary" window={data?.primary ?? null} />
          <QuotaCard slot="secondary" window={data?.secondary ?? null} />
        </div>
      )}
    </>
  }

  return (
    <div className="csa-page">
      <div className="csa-heading-row">
        <h1>Codex 和工作分析</h1>
        <div className="csa-controls">
          <div className="csa-period" aria-label="时间范围">
            <button className={period === '7d' ? 'is-active' : ''} type="button" onClick={() => choosePeriod('7d')}>7天</button>
            <button className={period === '1m' ? 'is-active' : ''} type="button" onClick={() => choosePeriod('1m')}>1个月</button>
            <button className={period === 'custom' ? 'is-active' : ''} type="button" onClick={() => choosePeriod('custom')}>自定义</button>
          </div>
          <label className="csa-group-select">
            <span>分组方式：</span>
            <select aria-label="分组方式" value={groupBy} onChange={(event) => setGroupBy(event.currentTarget.value as 'day' | 'week')}><option value="day">天</option><option value="week">周</option></select>
            <ChevronDown aria-hidden size={15} />
          </label>
          {customOpen && <div className="csa-custom-popover"><strong>自定义日期范围</strong><label>开始日期<input type="date" value={customStart} onChange={(event) => setCustomStart(event.currentTarget.value)} /></label><label>结束日期<input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.currentTarget.value)} /></label><button type="button" onClick={() => setCustomOpen(false)}>应用</button></div>}
        </div>
      </div>

      <div className="csa-tabs" role="tablist" aria-label="分析内容">
        <button className={tab === 'usage' ? 'is-active' : ''} type="button" role="tab" aria-selected={tab === 'usage'} onClick={() => setTab('usage')}>使用情况</button>
        <button className={tab === 'reviews' ? 'is-active' : ''} type="button" role="tab" aria-selected={tab === 'reviews'} onClick={() => setTab('reviews')}>代码审查</button>
      </div>

      {tab === 'usage' ? <>
        <section className="csa-balance-section">
          <h2>余额</h2>
          <p>{quotaDescription}<button type="button" aria-label="关于用量限额"><CircleHelp size={14} /></button></p>
          {quotaContent()}
        </section>

        {loadState === 'ready' && data && data.availability !== 'unlimited' && (
          <CodexResetCredits variant="analytics" onUsageChanged={() => loadUsage()} />
        )}

        <section className="csa-usage-section">
          <h2>使用详情 <CircleHelp aria-hidden size={14} /></h2>
          <p className="csa-usage-copy">来自当前 Session 的真实每日额度明细；数据最多可能延迟 6 小时。</p>
          <div className="csa-personal-heading"><h3>个人使用</h3><div className="csa-breakdown"><button className={breakdown === 'model' ? 'is-active' : ''} type="button" onClick={() => setBreakdown('model')}>按模型</button><button className={breakdown === 'surface' ? 'is-active' : ''} type="button" onClick={() => setBreakdown('surface')}>按界面</button></div></div>
          <div className="csa-usage-summary">
            <article><span>所选期间额度用量</span><strong>{usageRange.status === 'partial' && shownCredits !== null ? '≥ ' : ''}{formatCodexCredits(shownCredits)}</strong><small>{loadState !== 'ready' ? '等待当前 Session 的额度明细' : usageRange.status === 'partial' ? '仅包含接口返回的已知额度' : 'ChatGPT 内部额度'}</small></article>
            <article><span>API 等价估算</span><strong>{shownPrice === null ? '—' : `≈ ${formatApiEquivalent(shownPrice, usageRange.pricing.currency)}`}</strong><small>{loadState !== 'ready' ? '等待当前 Session 的额度明细' : usageRange.priceStatus === 'partial' ? '部分模型或日期未计价' : '估算，非账单'}</small></article>
          </div>
          <div className={`csa-usage-chart is-${usageRange.status}`}>
            {loadState !== 'ready'
              ? <p>额度加载完成后显示用量详情</p>
              : usageRange.status === 'unavailable'
                ? <p>当前方案或明细端点暂未返回可用数据</p>
                : usageRange.status === 'empty'
                  ? <p>在此期间无额度使用数据</p>
                  : usageRange.buckets.length === 0
                    ? <p>已取得汇总额度，但没有可绘制的每日明细</p>
                    : <div className="csa-daily-bars" aria-label="每日额度使用图表">
                        {usageRange.buckets.map((bucket) => {
                          const slices = codexUsageBucketSlices(bucket, breakdown)
                          const knownBucketCredits = bucket.credits
                            ?? slices.reduce((total, slice) => total + slice.credits, 0)
                          const barHeight = maxDailyCredits > 0 ? knownBucketCredits / maxDailyCredits * 100 : 0
                          return <div className="csa-daily-column" key={bucket.date}>
                            <div className="csa-daily-bar-area">
                              <div className="csa-daily-stack" style={{ height: `${Math.max(knownBucketCredits > 0 ? 4 : 0, barHeight)}%` }} title={`${bucket.date}：${formatCodexCredits(bucket.credits ?? knownBucketCredits)} 额度`}>
                                {slices.map((slice) => <i key={slice.key} style={{ background: breakdownColors.get(slice.key), flexGrow: slice.credits }} />)}
                              </div>
                            </div>
                            <span>{formatUsageBucketDate(bucket.date)}</span>
                          </div>
                        })}
                      </div>}
          </div>
          {loadState === 'ready' && usageRange.status === 'partial' && <p className="csa-usage-warning">部分日期没有返回完整额度，图表和总额只统计已知数据。</p>}
          {loadState === 'ready' && usageRange.priceStatus === 'unavailable' && usageRange.status !== 'empty' && usageRange.status !== 'unavailable' && <p className="csa-usage-warning">额度明细已返回，但没有足够的计价信息，暂时无法换算 API 等价价格。</p>}
          {loadState === 'ready' && usageRange.pricing.kind && <p className="csa-pricing-note">{formatCodexPricingDisclosure(usageRange.pricing)}</p>}
          {breakdownItems.length > 0 && <div className="csa-usage-legend" aria-label={breakdown === 'model' ? '按模型汇总' : '按界面汇总'}>
            {breakdownItems.map((item) => <div key={item.key}><i style={{ background: breakdownColors.get(item.key) }} /><span>{item.label}</span><strong>{formatCodexCredits(item.credits)}</strong></div>)}
          </div>}
        </section>
      </> : <section className="csa-review-section"><h2>代码审查</h2><h3>个人代码审查</h3><div><span>在此期间无数据</span></div><div className="csa-metrics"><div><span>审查</span><strong>0</strong></div><div><span>发现的问题</span><strong>0</strong></div><div><span>已修复</span><strong>0</strong></div></div></section>}
      <span className="sr-only" aria-live="polite">{loadState === 'ready' ? '已加载当前 Session 的实时 Codex 额度' : loadState === 'loading' ? '正在查询额度' : loadState === 'unauthenticated' ? 'Session 尚未授权' : '额度查询失败'}</span>
    </div>
  )
}

export default AnalyticsSettingsPage
