import { useEffect, useMemo, useState } from 'react'
import {
  BarChart3,
  ChevronDown,
  CircleHelp,
  Code2,
  Database,
  ExternalLink,
  GitPullRequest,
  KeyRound,
  Menu,
  Plug,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react'
import './CodexCloudAnalyticsPage.css'

type Period = '7d' | '1m' | 'custom'
type UsageView = 'usage' | 'reviews'
type Breakdown = 'model' | 'surface'

type RateWindow = {
  usedPercent?: number | null
  remainingPercent?: number | null
  windowDurationMins?: number | null
  resetsAt?: number | null
}

type AnalyticsPayload = {
  ok?: boolean
  live?: boolean
  source?: string
  fetchedAt?: string
  remainingPercent?: number
  resetLabel?: string
  turns?: number
  pluginCalls?: number
  skillsUsed?: number
  quota?: {
    remainingPercent?: number | null
    primary?: RateWindow | null
    secondary?: RateWindow | null
    resetCredits?: { availableCount?: number | null } | null
    credits?: { balance?: number | string | null } | null
  }
  rateLimits?: {
    primary?: RateWindow | null
    secondary?: RateWindow | null
  }
  usage?: {
    summary?: {
      lifetimeTokens?: number | null
      peakDailyTokens?: number | null
      longestRunningTurnSec?: number | null
      currentStreakDays?: number | null
      longestStreakDays?: number | null
      turns?: number | null
      pluginCalls?: number | null
      skillsUsed?: number | null
    } | null
    dailyUsageBuckets?: Array<{ startDate?: string; tokens?: number | null }> | null
  }
}

type PageData = {
  live: boolean
  primary: RateWindow
  secondary: RateWindow | null
  turns: number
  pluginCalls: number
  skillsUsed: number
  resetCredits: number
  lifetimeTokens: number
  dailyUsage: Array<{ startDate: string; tokens: number }>
}

const FALLBACK_DATA: PageData = {
  live: false,
  primary: {
    usedPercent: 0,
    remainingPercent: 100,
    windowDurationMins: 43_200,
    resetsAt: null,
  },
  secondary: null,
  turns: 0,
  pluginCalls: 0,
  skillsUsed: 0,
  resetCredits: 0,
  lifetimeTokens: 0,
  dailyUsage: [],
}

const NAV_ITEMS = [
  { label: '常规', icon: Settings2 },
  { label: '环境', icon: SlidersHorizontal },
  { label: '代码审查', icon: GitPullRequest },
  { label: '连接器', icon: Plug },
  { label: '分析', icon: BarChart3, active: true },
  { label: '数据管理', icon: Database },
  { label: '访问令牌', icon: KeyRound },
] as const

function clampPercent(value: unknown, fallback = 100) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(100, Math.max(0, Math.round(numeric)))
}

function normalizeWindow(window: RateWindow | null | undefined, fallback?: RateWindow): RateWindow | null {
  if (!window && !fallback) return null
  const next = window ?? fallback ?? {}
  const used = typeof next.usedPercent === 'number' ? next.usedPercent : null
  return {
    ...next,
    usedPercent: used,
    remainingPercent: clampPercent(next.remainingPercent ?? (used == null ? 100 : 100 - used)),
  }
}

function normalizePayload(payload: AnalyticsPayload): PageData {
  const primaryRaw = payload.quota?.primary ?? payload.rateLimits?.primary
  const secondaryRaw = payload.quota?.secondary ?? payload.rateLimits?.secondary
  const explicitRemaining = payload.quota?.remainingPercent ?? payload.remainingPercent
  const primary = normalizeWindow(primaryRaw, {
    ...FALLBACK_DATA.primary,
    remainingPercent: explicitRemaining ?? FALLBACK_DATA.primary.remainingPercent,
  }) ?? FALLBACK_DATA.primary
  const summary = payload.usage?.summary
  const dailyUsage = Array.isArray(payload.usage?.dailyUsageBuckets)
    ? payload.usage.dailyUsageBuckets.flatMap((bucket) => {
        if (!bucket || typeof bucket.startDate !== 'string') return []
        return [{ startDate: bucket.startDate, tokens: Math.max(0, Number(bucket.tokens) || 0) }]
      })
    : []

  return {
    live: payload.live === true || payload.ok === true,
    primary,
    secondary: normalizeWindow(secondaryRaw),
    turns: Math.max(0, Number(payload.turns ?? summary?.turns) || 0),
    pluginCalls: Math.max(0, Number(payload.pluginCalls ?? summary?.pluginCalls) || 0),
    skillsUsed: Math.max(0, Number(payload.skillsUsed ?? summary?.skillsUsed) || 0),
    resetCredits: Math.max(0, Number(payload.quota?.resetCredits?.availableCount) || 0),
    lifetimeTokens: Math.max(0, Number(summary?.lifetimeTokens) || 0),
    dailyUsage,
  }
}

function windowLabel(window: RateWindow) {
  const mins = Number(window.windowDurationMins)
  if (Number.isFinite(mins)) {
    if (Math.abs(mins - 300) <= 15) return '5 小时使用上限'
    if (Math.abs(mins - 1_440) <= 72) return '每日使用上限'
    if (Math.abs(mins - 10_080) <= 504) return '每周使用上限'
    if (Math.abs(mins - 43_200) <= 2_160) return '每月使用上限'
  }
  return '使用上限'
}

function resetText(window: RateWindow) {
  if (!window.resetsAt || clampPercent(window.remainingPercent) === 100) return null
  const date = new Date(window.resetsAt * 1000)
  if (Number.isNaN(date.getTime())) return null
  return `重置时间：${new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)}`
}

function QuotaCard({ window }: { window: RateWindow }) {
  const remaining = clampPercent(window.remainingPercent)
  const reset = resetText(window)
  return (
    <article className="cca-quota-card">
      <p className="cca-card-eyebrow">{windowLabel(window)}</p>
      <div className="cca-balance-line">
        <strong>{remaining}%</strong>
        <span>剩余</span>
      </div>
      <div className="cca-progress" aria-label={`剩余 ${remaining}%`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={remaining}>
        <span className={remaining <= 30 ? 'is-low' : ''} style={{ width: `${remaining}%` }} />
      </div>
      {reset && <p className="cca-reset-date">{reset}</p>}
    </article>
  )
}

function EmptyChart({ view }: { view: Breakdown }) {
  return (
    <div className="cca-chart" aria-label={view === 'model' ? '按模型统计图' : '按使用界面统计图'}>
      <div className="cca-chart-axis"><span>100%</span><span>50%</span><span>0%</span></div>
      <div className="cca-chart-grid"><i /><i /><i /></div>
      <p>此时间范围内没有可显示的数据</p>
    </div>
  )
}

export default function CodexCloudAnalyticsPage() {
  const [period, setPeriod] = useState<Period>('1m')
  const [groupBy, setGroupBy] = useState('day')
  const [view, setView] = useState<UsageView>('usage')
  const [breakdown, setBreakdown] = useState<Breakdown>('model')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [data, setData] = useState<PageData>(FALLBACK_DATA)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    fetch('/api/codex/analytics', { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`analytics ${response.status}`)
        return response.json() as Promise<AnalyticsPayload>
      })
      .then((payload) => {
        if (active) setData(normalizePayload(payload))
      })
      .catch(() => {
        if (active) setData(FALLBACK_DATA)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [])

  const chartTotal = useMemo(
    () => data.dailyUsage.reduce((total, bucket) => total + bucket.tokens, 0),
    [data.dailyUsage],
  )

  return (
    <div className="codex-analytics-page">
      <header className="cca-topbar">
        <div className="cca-brand">
          <button className="cca-mobile-menu" type="button" aria-label="打开设置导航" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
          <a href="/" aria-label="ChatGPT 首页"><img alt="" src="/chatgpt-mark.svg" /><span>ChatGPT</span></a>
        </div>
        <nav className="cca-product-nav" aria-label="产品导航">
          <a href="/">ChatGPT</a>
          <a className="active" href="/codex/cloud/settings/analytics">Codex</a>
          <a href="https://learn.chatgpt.com" target="_blank" rel="noreferrer">文档 <ExternalLink size={13} /></a>
          <button type="button" aria-label="帮助"><CircleHelp size={18} /></button>
          <button className="cca-avatar" type="button" aria-label="账户菜单">LX</button>
        </nav>
      </header>

      <div className="cca-layout">
        {sidebarOpen && <button className="cca-sidebar-scrim" type="button" aria-label="关闭设置导航" onClick={() => setSidebarOpen(false)} />}
        <aside className={`cca-sidebar${sidebarOpen ? ' is-open' : ''}`}>
          <div className="cca-sidebar-title"><span>设置</span><button type="button" aria-label="关闭设置导航" onClick={() => setSidebarOpen(false)}><X size={18} /></button></div>
          <nav aria-label="Codex 设置">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const active = 'active' in item && item.active === true
              return (
                <button
                  className={active ? 'active' : ''}
                  key={item.label}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => !active && window.dispatchEvent(new CustomEvent('codex-settings:navigate', { detail: item.label }))}
                >
                  <Icon size={18} strokeWidth={1.7} /><span>{item.label}</span>
                </button>
              )
            })}
          </nav>
          <div className="cca-sidebar-footer"><Sparkles size={16} /><span>Codex 云端</span></div>
        </aside>

        <main className="cca-main">
          <div className="cca-main-inner">
            <div className="cca-page-heading">
              <h1>Codex 和工作分析</h1>
              <div className="cca-filter-row">
                <div className="cca-segmented" aria-label="时间范围">
                  <button className={period === '7d' ? 'active' : ''} type="button" onClick={() => setPeriod('7d')}>7天</button>
                  <button className={period === '1m' ? 'active' : ''} type="button" onClick={() => setPeriod('1m')}>1个月</button>
                  <button className={period === 'custom' ? 'active' : ''} type="button" onClick={() => setPeriod('custom')}>自定义</button>
                </div>
                <label className="cca-select"><span className="sr-only">分组方式</span><select value={groupBy} onChange={(event) => setGroupBy(event.currentTarget.value)}><option value="day">按天分组</option><option value="week">按周分组</option></select><ChevronDown size={15} /></label>
              </div>
            </div>

            {period === 'custom' && <div className="cca-custom-dates"><label>开始日期<input type="date" /></label><span>—</span><label>结束日期<input type="date" /></label></div>}

            <div className="cca-tabs" role="tablist" aria-label="分析类型">
              <button className={view === 'usage' ? 'active' : ''} type="button" role="tab" aria-selected={view === 'usage'} onClick={() => setView('usage')}>使用情况</button>
              <button className={view === 'reviews' ? 'active' : ''} type="button" role="tab" aria-selected={view === 'reviews'} onClick={() => setView('reviews')}>代码审查</button>
            </div>

            {view === 'usage' ? (
              <>
                <section className="cca-section cca-balance-section">
                  <h2>余额</h2>
                  <p className="cca-section-copy">Codex 和工作共用同一用量限额。<button type="button" aria-label="了解共享用量限额"><CircleHelp size={14} /></button></p>
                  <div className="cca-quota-grid">
                    <QuotaCard window={data.primary} />
                    {data.secondary && <QuotaCard window={data.secondary} />}
                  </div>
                </section>

                <section className="cca-section cca-reset-section">
                  <h2>使用限额重置</h2>
                  <div className="cca-reset-card">
                    <div><strong>{data.resetCredits}</strong><span>可用重置次数</span></div>
                    <p>{data.resetCredits > 0 ? '你可以重置一次符合条件的 Codex 使用限额。' : '你目前没有可用的使用限额重置。'}</p>
                    <button type="button" disabled={data.resetCredits === 0}>重置使用限额</button>
                  </div>
                </section>

                <section className="cca-section cca-details-section">
                  <h2>使用详情</h2>
                  <div className="cca-usage-card">
                    <div className="cca-usage-header">
                      <div><h3>个人使用</h3><p>你在所选时间范围内的 Codex 使用情况。</p></div>
                      <div className="cca-mini-segmented"><button className={breakdown === 'model' ? 'active' : ''} type="button" onClick={() => setBreakdown('model')}>按模型</button><button className={breakdown === 'surface' ? 'active' : ''} type="button" onClick={() => setBreakdown('surface')}>按界面</button></div>
                    </div>
                    <div className="cca-stat-line"><div><span>回合数</span><strong>{data.turns.toLocaleString('zh-CN')}</strong></div><div><span>Token</span><strong>{(chartTotal || data.lifetimeTokens).toLocaleString('zh-CN')}</strong></div></div>
                    <EmptyChart view={breakdown} />
                  </div>
                  <div className="cca-metric-grid">
                    <article><div className="cca-metric-icon"><Plug size={18} /></div><span>插件调用</span><strong>{data.pluginCalls}</strong><p>此时间范围内使用插件的次数</p></article>
                    <article><div className="cca-metric-icon"><Sparkles size={18} /></div><span>已使用技能</span><strong>{data.skillsUsed}</strong><p>此时间范围内调用技能的次数</p></article>
                  </div>
                </section>
              </>
            ) : (
              <section className="cca-section cca-review-section">
                <h2>代码审查</h2>
                <p>查看由 Codex 在 GitHub 中完成的代码审查。</p>
                <div className="cca-review-empty"><div><Code2 size={22} /></div><h3>暂无代码审查数据</h3><p>所选时间范围内完成的审查会显示在这里。</p></div>
              </section>
            )}
            <span className="cca-data-source" aria-live="polite">{data.live ? '实时 Codex 数据' : '本地演示数据'}</span>
          </div>
        </main>
      </div>
    </div>
  )
}
