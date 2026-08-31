export type CodexUsageAvailability = 'available' | 'unavailable'

export type CodexUsagePricing = {
  kind: string | null
  available: boolean | null
  creditsPerUsd: number | null
  currency: string
  asOf: string | null
  source: string | null
  apiPricingSource: string | null
  note: string | null
}

export type CodexUsageModel = {
  model: string | null
  speed: string | null
  credits: number | null
  apiEquivalentUsd: number | null
}

export type CodexUsageSurface = {
  surface: string
  credits: number
  apiEquivalentUsd: number | null
}

export type CodexUsageBucket = {
  date: string
  credits: number | null
  apiEquivalentUsd: number | null
  models: CodexUsageModel[]
  surfaces: CodexUsageSurface[]
  productSurfaceUsageValues: Record<string, number>
}

export type CodexUsageDetails = {
  availability: CodexUsageAvailability
  units: string | null
  groupBy: string | null
  scope: string | null
  summary: {
    rangeCredits: number | null
    apiEquivalentUsd: number | null
  }
  pricing: CodexUsagePricing
  dailyUsageBuckets: CodexUsageBucket[]
}

export type CodexUsageRangeStatus = 'unavailable' | 'empty' | 'complete' | 'partial'
export type CodexUsagePriceStatus = 'unavailable' | 'complete' | 'partial'
export type CodexUsageBreakdown = 'model' | 'surface'

export type CodexUsageRange = {
  buckets: CodexUsageBucket[]
  status: CodexUsageRangeStatus
  priceStatus: CodexUsagePriceStatus
  totalCredits: number | null
  knownCredits: number
  apiEquivalentUsd: number | null
  knownApiEquivalentUsd: number
  missingCreditBuckets: number
  missingPriceBuckets: number
  pricing: CodexUsagePricing
}

export type CodexUsageSlice = {
  key: string
  label: string
  credits: number
  apiEquivalentUsd: number | null
}

type JsonRecord = Record<string, unknown>

export const CODEX_USAGE_PALETTE = [
  '#2f6fed',
  '#77aaf7',
  '#8d72e1',
  '#21a179',
  '#e8913a',
  '#d75b75',
  '#4e9fa7',
  '#8a93a3',
] as const

const EMPTY_PRICING: CodexUsagePricing = {
  kind: null,
  available: null,
  creditsPerUsd: null,
  currency: 'USD',
  asOf: null,
  source: null,
  apiPricingSource: null,
  note: null,
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function firstValue(record: JsonRecord | null, ...keys: string[]) {
  if (!record) return undefined
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key]
  }
  return undefined
}

function finiteNonNegative(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function isCreditUnit(value: string | null) {
  const unit = value?.trim().toLowerCase()
  return unit === 'credit' || unit === 'credits'
}

function nominalApiEquivalent(
  credits: number | null,
  explicitPrice: number | null,
  units: string | null,
  pricing: CodexUsagePricing,
) {
  if (
    !isCreditUnit(units)
    || pricing.available === false
  ) return null
  if (explicitPrice !== null) return explicitPrice
  if (
    credits === null
    || pricing.creditsPerUsd === null
    || pricing.creditsPerUsd <= 0
  ) return null
  return credits / pricing.creditsPerUsd
}

function boundedString(value: unknown, maximum = 160): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized.slice(0, maximum) : null
}

function normalizeDate(value: unknown): string | null {
  const normalized = boundedString(value, 40)
  if (!normalized) return null
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(normalized)
  if (!match || Number.isNaN(Date.parse(`${match[1]}T00:00:00Z`))) return null
  return match[1]
}

function normalizePricing(value: unknown): CodexUsagePricing {
  const pricing = asRecord(value)
  if (!pricing) return { ...EMPTY_PRICING }
  return {
    kind: boundedString(firstValue(pricing, 'kind'), 80),
    available: optionalBoolean(firstValue(pricing, 'available')),
    creditsPerUsd: finiteNonNegative(firstValue(pricing, 'creditsPerUsd', 'credits_per_usd')),
    currency: boundedString(firstValue(pricing, 'currency'), 12)?.toUpperCase() || 'USD',
    asOf: boundedString(firstValue(pricing, 'asOf', 'as_of'), 40),
    source: boundedString(firstValue(pricing, 'source'), 320),
    apiPricingSource: boundedString(firstValue(pricing, 'apiPricingSource', 'api_pricing_source'), 320),
    note: boundedString(firstValue(pricing, 'note'), 500),
  }
}

function normalizeModels(value: unknown): CodexUsageModel[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    const model = asRecord(candidate)
    if (!model) return []
    const name = boundedString(firstValue(model, 'model', 'modelSlug', 'model_slug'), 100)
    const speed = boundedString(firstValue(model, 'speed', 'serviceTier', 'service_tier'), 40)
    const credits = finiteNonNegative(firstValue(model, 'credits'))
    const apiEquivalentUsd = finiteNonNegative(firstValue(model, 'apiEquivalentUsd', 'api_equivalent_usd'))
    if (!name && !speed && credits === null && apiEquivalentUsd === null) return []
    return [{ model: name, speed, credits, apiEquivalentUsd }]
  })
}

function normalizeSurfaces(value: unknown): Record<string, number> {
  const surfaces = asRecord(value)
  if (!surfaces) return {}
  const normalized: Record<string, number> = {}
  for (const [rawName, rawCredits] of Object.entries(surfaces)) {
    const name = rawName.trim().slice(0, 80)
    const credits = finiteNonNegative(rawCredits)
    if (name && credits !== null) normalized[name] = credits
  }
  return normalized
}

function normalizeSurfaceEntries(bucket: JsonRecord): CodexUsageSurface[] {
  const rawEntries = firstValue(bucket, 'surfaces')
  if (Array.isArray(rawEntries)) {
    return rawEntries.flatMap((candidate) => {
      const entry = asRecord(candidate)
      if (!entry) return []
      const surface = boundedString(firstValue(entry, 'surface'), 80)
      const credits = finiteNonNegative(firstValue(entry, 'credits'))
      if (!surface || credits === null) return []
      return [{
        surface,
        credits,
        apiEquivalentUsd: finiteNonNegative(firstValue(entry, 'apiEquivalentUsd', 'api_equivalent_usd')),
      }]
    })
  }
  const creditsBySurface = normalizeSurfaces(firstValue(
    bucket,
    'productSurfaceUsageValues',
    'product_surface_usage_values',
  ))
  const pricesBySurface = asRecord(firstValue(
    bucket,
    'productSurfaceApiEquivalentUsd',
    'product_surface_api_equivalent_usd',
  ))
  return Object.entries(creditsBySurface).map(([surface, credits]) => ({
    surface,
    credits,
    apiEquivalentUsd: finiteNonNegative(pricesBySurface?.[surface]),
  }))
}

export function normalizeCodexUsageDetails(value: unknown): CodexUsageDetails {
  const payload = asRecord(value)
  const usage = asRecord(firstValue(payload, 'usage'))
  const summary = asRecord(firstValue(usage, 'summary'))
  const units = boundedString(firstValue(usage, 'units'), 40)
  const pricing = normalizePricing(firstValue(usage, 'pricing') ?? firstValue(payload, 'pricing'))
  const rawBuckets = firstValue(usage, 'dailyUsageBuckets', 'daily_usage_buckets')
  const dailyUsageBuckets = Array.isArray(rawBuckets)
    ? rawBuckets.flatMap((candidate) => {
        const bucket = asRecord(candidate)
        if (!bucket) return []
        const date = normalizeDate(firstValue(bucket, 'date'))
        if (!date) return []
        const surfaces = normalizeSurfaceEntries(bucket)
        const credits = finiteNonNegative(firstValue(bucket, 'credits'))
        const models = normalizeModels(firstValue(bucket, 'models')).map((model) => ({
          ...model,
          apiEquivalentUsd: nominalApiEquivalent(
            model.credits,
            model.apiEquivalentUsd,
            units,
            pricing,
          ),
        }))
        const pricedSurfaces = surfaces.map((surface) => ({
          ...surface,
          apiEquivalentUsd: nominalApiEquivalent(
            surface.credits,
            surface.apiEquivalentUsd,
            units,
            pricing,
          ),
        }))
        return [{
          date,
          credits,
          apiEquivalentUsd: nominalApiEquivalent(
            credits,
            finiteNonNegative(firstValue(bucket, 'apiEquivalentUsd', 'api_equivalent_usd')),
            units,
            pricing,
          ),
          models,
          surfaces: pricedSurfaces,
          productSurfaceUsageValues: Object.fromEntries(
            pricedSurfaces.map((surface) => [surface.surface, surface.credits]),
          ),
        }]
      }).sort((left, right) => left.date.localeCompare(right.date))
    : []
  const rawAvailability = firstValue(usage, 'availability')
  const availability: CodexUsageAvailability = rawAvailability === 'available'
    ? 'available'
    : 'unavailable'
  return {
    availability,
    units,
    groupBy: boundedString(firstValue(usage, 'groupBy', 'group_by'), 20),
    scope: boundedString(firstValue(usage, 'scope'), 40),
    summary: {
      rangeCredits: finiteNonNegative(firstValue(summary, 'rangeCredits', 'range_credits')),
      apiEquivalentUsd: nominalApiEquivalent(
        finiteNonNegative(firstValue(summary, 'rangeCredits', 'range_credits')),
        finiteNonNegative(firstValue(summary, 'apiEquivalentUsd', 'api_equivalent_usd')),
        units,
        pricing,
      ),
    },
    pricing,
    dailyUsageBuckets,
  }
}

function dateEpoch(date: string) {
  const epoch = Date.parse(`${date}T00:00:00Z`)
  return Number.isNaN(epoch) ? null : epoch
}

function selectBuckets(
  details: CodexUsageDetails,
  options: { days?: number; startDate?: string; endDate?: string },
) {
  if (options.startDate || options.endDate) {
    return details.dailyUsageBuckets.filter((bucket) => (
      (!options.startDate || bucket.date >= options.startDate)
      && (!options.endDate || bucket.date <= options.endDate)
    ))
  }
  if (!options.days || options.days <= 0 || details.dailyUsageBuckets.length === 0) {
    return details.dailyUsageBuckets
  }
  // The upstream query always ends on the current UTC date. Anchoring a short
  // range to the newest non-empty bucket would incorrectly pull old activity
  // into "7 days" when the account has not been used recently.
  const now = new Date()
  const rangeEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const cutoff = rangeEnd - (Math.max(1, Math.round(options.days)) - 1) * 86_400_000
  return details.dailyUsageBuckets.filter((bucket) => {
    const epoch = dateEpoch(bucket.date)
    return epoch !== null && epoch >= cutoff && epoch <= rangeEnd
  })
}

export function selectCodexUsageRange(
  details: CodexUsageDetails,
  options: { days?: number; startDate?: string; endDate?: string; preferSummary?: boolean } = {},
): CodexUsageRange {
  // The legacy Plus endpoint reports daily allowance percentages in fields
  // named `credits`.  Those values are useful for quota UI but are not
  // billable credits, so never display or price them as credit usage.
  if (details.availability !== 'available' || !isCreditUnit(details.units)) {
    return {
      buckets: [],
      status: 'unavailable',
      priceStatus: 'unavailable',
      totalCredits: null,
      knownCredits: 0,
      apiEquivalentUsd: null,
      knownApiEquivalentUsd: 0,
      missingCreditBuckets: 0,
      missingPriceBuckets: 0,
      pricing: details.pricing,
    }
  }

  const buckets = selectBuckets(details, options)
  const missingCreditBuckets = buckets.filter((bucket) => bucket.credits === null).length
  const knownCredits = buckets.reduce((total, bucket) => total + (bucket.credits ?? 0), 0)
  const coversFullPayload = buckets.length === details.dailyUsageBuckets.length
  const useSummary = options.preferSummary === true && coversFullPayload
  const summaryCredits = useSummary ? details.summary.rangeCredits : null
  const totalCredits = summaryCredits ?? (missingCreditBuckets === 0 ? knownCredits : null)

  const missingPriceBuckets = buckets.filter((bucket) => (
    (bucket.credits ?? 0) > 0 && bucket.apiEquivalentUsd === null
  )).length
  const knownApiEquivalentUsd = buckets.reduce(
    (total, bucket) => total + (bucket.apiEquivalentUsd ?? 0),
    0,
  )
  const summaryPrice = useSummary ? details.summary.apiEquivalentUsd : null
  let apiEquivalentUsd = summaryPrice
    ?? (missingPriceBuckets === 0 && missingCreditBuckets === 0 ? knownApiEquivalentUsd : null)

  const definitelyEmpty = totalCredits === 0 && missingCreditBuckets === 0
  let status: CodexUsageRangeStatus
  if (definitelyEmpty) status = 'empty'
  else if (totalCredits !== null && missingCreditBuckets === 0) status = 'complete'
  else status = 'partial'

  let priceStatus: CodexUsagePriceStatus
  if (definitelyEmpty) {
    apiEquivalentUsd = 0
    priceStatus = 'complete'
  } else if (apiEquivalentUsd !== null && missingPriceBuckets === 0) {
    priceStatus = 'complete'
  } else if (apiEquivalentUsd !== null || knownApiEquivalentUsd > 0) {
    priceStatus = 'partial'
  } else {
    priceStatus = 'unavailable'
  }

  return {
    buckets,
    status,
    priceStatus,
    totalCredits,
    knownCredits,
    apiEquivalentUsd,
    knownApiEquivalentUsd,
    missingCreditBuckets,
    missingPriceBuckets,
    pricing: details.pricing,
  }
}

const SURFACE_LABELS: Record<string, string> = {
  cli: 'Codex CLI',
  codex_cloud: 'Codex Cloud',
  chatgpt_work: 'ChatGPT Work',
  vscode: 'VS Code',
  web: 'Codex Web',
  work_web: 'Work Web',
  mobile: '移动端',
  work_mobile: 'Work 移动端',
  slack: 'Slack',
  linear: 'Linear',
  jetbrains: 'JetBrains',
  sdk: 'SDK',
  exec: 'Exec',
  github: 'GitHub',
  desktop_app: '桌面应用',
  work_desktop: 'Work 桌面端',
  github_code_review: 'GitHub 代码审查',
  agent_identity: '智能体身份',
  unknown: '未知界面',
}

export function formatUsageSurface(surface: string) {
  return SURFACE_LABELS[surface] ?? surface.replaceAll('_', ' ')
}

function modelLabel(model: CodexUsageModel) {
  const name = model.model || '未知模型'
  return model.speed ? `${name} · ${model.speed}` : name
}

function nonNegativeRemainder(total: number | null, known: number) {
  if (total === null) return 0
  const remainder = total - known
  return remainder > 1e-9 ? remainder : 0
}

export function codexUsageBucketSlices(
  bucket: CodexUsageBucket,
  breakdown: CodexUsageBreakdown,
): CodexUsageSlice[] {
  if (breakdown === 'surface') {
    const slices = bucket.surfaces
      .filter((surface) => surface.credits > 0)
      .map((surface) => ({
        key: `surface:${surface.surface}`,
        label: formatUsageSurface(surface.surface),
        credits: surface.credits,
        apiEquivalentUsd: surface.apiEquivalentUsd,
      }))
    const known = slices.reduce((total, slice) => total + slice.credits, 0)
    const knownPrice = slices.reduce((total, slice) => total + (slice.apiEquivalentUsd ?? 0), 0)
    const remainder = nonNegativeRemainder(bucket.credits, known)
    if (remainder > 0) slices.push({
      key: 'surface:__unattributed',
      label: '未归类界面',
      credits: remainder,
      apiEquivalentUsd: bucket.apiEquivalentUsd === null
        ? null
        : nonNegativeRemainder(bucket.apiEquivalentUsd, knownPrice),
    })
    return slices
  }

  const slices = bucket.models.flatMap((model) => {
    if (model.credits === null || model.credits <= 0) return []
    const modelKey = model.model || '__unknown'
    const speedKey = model.speed || ''
    return [{
      key: `model:${modelKey}:${speedKey}`,
      label: modelLabel(model),
      credits: model.credits,
      apiEquivalentUsd: model.apiEquivalentUsd,
    }]
  })
  const knownCredits = slices.reduce((total, slice) => total + slice.credits, 0)
  const knownPrice = slices.reduce((total, slice) => total + (slice.apiEquivalentUsd ?? 0), 0)
  const remainder = nonNegativeRemainder(bucket.credits, knownCredits)
  if (remainder > 0) {
    const priceRemainder = nonNegativeRemainder(bucket.apiEquivalentUsd, knownPrice)
    slices.push({
      key: 'model:__unattributed:',
      label: '未归类模型',
      credits: remainder,
      apiEquivalentUsd: bucket.apiEquivalentUsd === null ? null : priceRemainder,
    })
  }
  return slices
}

export function aggregateCodexUsageBreakdown(
  buckets: CodexUsageBucket[],
  breakdown: CodexUsageBreakdown,
): CodexUsageSlice[] {
  const totals = new Map<string, {
    label: string
    credits: number
    knownPrice: number
    missingPrice: boolean
  }>()
  for (const bucket of buckets) {
    for (const slice of codexUsageBucketSlices(bucket, breakdown)) {
      const current = totals.get(slice.key) ?? {
        label: slice.label,
        credits: 0,
        knownPrice: 0,
        missingPrice: false,
      }
      current.credits += slice.credits
      if (slice.apiEquivalentUsd === null) current.missingPrice = current.missingPrice || slice.credits > 0
      else current.knownPrice += slice.apiEquivalentUsd
      totals.set(slice.key, current)
    }
  }
  return [...totals.entries()]
    .map(([key, total]) => ({
      key,
      label: total.label,
      credits: total.credits,
      apiEquivalentUsd: total.missingPrice ? null : total.knownPrice,
    }))
    .sort((left, right) => right.credits - left.credits || left.label.localeCompare(right.label))
}

export function formatCodexCredits(value: number | null) {
  if (value === null) return '—'
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: value >= 1_000 ? 0 : 2,
  }).format(value)
}

export function formatApiEquivalent(value: number | null, currency = 'USD') {
  if (value === null) return '—'
  try {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
      maximumFractionDigits: value > 0 && value < 0.01 ? 6 : 2,
    }).format(value)
  } catch {
    return `$${value.toFixed(value > 0 && value < 0.01 ? 4 : 2)}`
  }
}

export function formatCodexPricingDisclosure(pricing: CodexUsagePricing) {
  const ratio = pricing.creditsPerUsd === null
    ? '当前标准速率'
    : `${formatCodexCredits(pricing.creditsPerUsd)} credits ≈ US$1`
  const asOf = pricing.asOf ? `；价格基准 ${pricing.asOf}` : ''
  return `按 ${ratio} 名义换算${asOf}。Fast/优先处理、长上下文及工具费用可能不同；这是估算，不是实际 API 账单。`
}

export function formatUsageBucketDate(value: string) {
  const epoch = dateEpoch(value)
  if (epoch === null) return value
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(epoch))
}
