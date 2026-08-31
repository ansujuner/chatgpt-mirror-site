import assert from 'node:assert/strict'
import test from 'node:test'

import {
  aggregateCodexUsageBreakdown,
  normalizeCodexUsageDetails,
  selectCodexUsageRange,
} from '../src/lib/codexUsageDetails.ts'

function isoDay(offset: number) {
  const now = new Date()
  const utc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset)
  return new Date(utc).toISOString().slice(0, 10)
}

function payload(buckets: unknown[], summary: Record<string, unknown> = {}) {
  return {
    usage: {
      availability: 'available',
      units: 'credits',
      groupBy: 'day',
      summary,
      pricing: {
        kind: 'nominal_api_equivalent',
        creditsPerUsd: 25,
        currency: 'USD',
        asOf: '2026-08-31',
      },
      dailyUsageBuckets: buckets,
    },
  }
}

test('normalizes real credit buckets without inventing token counts', () => {
  const details = normalizeCodexUsageDetails(payload([
    {
      date: isoDay(-1),
      credits: 1.75,
      apiEquivalentUsd: 0.07,
      models: [{ model: 'gpt-5.6-sol', speed: 'standard', credits: 1.75, apiEquivalentUsd: 0.07 }],
      productSurfaceUsageValues: { web: 1.75 },
    },
    {
      date: isoDay(0),
      credits: 2,
      apiEquivalentUsd: 0.08,
      models: [{ model: 'gpt-5.6-sol', speed: 'fast', credits: 2, apiEquivalentUsd: 0.08 }],
      productSurfaceUsageValues: { cli: 2 },
    },
  ], { rangeCredits: 3.75, apiEquivalentUsd: 0.15 }))

  const range = selectCodexUsageRange(details, { days: 30, preferSummary: true })
  assert.equal(range.status, 'complete')
  assert.equal(range.totalCredits, 3.75)
  assert.equal(range.apiEquivalentUsd, 0.15)
  assert.deepEqual(
    aggregateCodexUsageBreakdown(range.buckets, 'model').map(({ label, credits }) => ({ label, credits })),
    [
      { label: 'gpt-5.6-sol · fast', credits: 2 },
      { label: 'gpt-5.6-sol · standard', credits: 1.75 },
    ],
  )
  assert.equal('tokens' in details.dailyUsageBuckets[0], false)
})

test('seven-day selection is anchored to today rather than the newest old activity', () => {
  const details = normalizeCodexUsageDetails(payload([
    { date: isoDay(-12), credits: 9, apiEquivalentUsd: 0.36, models: [], productSurfaceUsageValues: {} },
    { date: isoDay(-1), credits: 1, apiEquivalentUsd: 0.04, models: [], productSurfaceUsageValues: {} },
  ]))
  const range = selectCodexUsageRange(details, { days: 7 })
  assert.deepEqual(range.buckets.map((bucket) => bucket.date), [isoDay(-1)])
  assert.equal(range.totalCredits, 1)
})

test('empty and partial ranges remain distinct', () => {
  const empty = selectCodexUsageRange(
    normalizeCodexUsageDetails(payload([], { rangeCredits: 0, apiEquivalentUsd: 0 })),
    { days: 30, preferSummary: true },
  )
  assert.equal(empty.status, 'empty')
  assert.equal(empty.totalCredits, 0)
  assert.equal(empty.apiEquivalentUsd, 0)

  const partial = selectCodexUsageRange(normalizeCodexUsageDetails(payload([
    { date: isoDay(0), credits: null, apiEquivalentUsd: null, models: [], productSurfaceUsageValues: {} },
  ])), { days: 30 })
  assert.equal(partial.status, 'partial')
  assert.equal(partial.totalCredits, null)
  assert.equal(partial.priceStatus, 'unavailable')
})

test('an unavailable detail endpoint never becomes a fabricated zero', () => {
  const details = normalizeCodexUsageDetails({ usage: { availability: 'unavailable' } })
  const range = selectCodexUsageRange(details)
  assert.equal(range.status, 'unavailable')
  assert.equal(range.totalCredits, null)
  assert.equal(range.apiEquivalentUsd, null)
})

test('derives the nominal API equivalent locally only for explicit credit units', () => {
  const creditDetails = normalizeCodexUsageDetails(payload([
    {
      date: isoDay(0),
      credits: 50,
      models: [{ model: 'gpt-5.6-sol', credits: 25 }],
      productSurfaceUsageValues: { cli: 50 },
    },
  ], { rangeCredits: 50 }))
  const creditRange = selectCodexUsageRange(creditDetails, { days: 30, preferSummary: true })

  assert.equal(creditRange.apiEquivalentUsd, 2)
  assert.equal(creditRange.priceStatus, 'complete')
  assert.equal(creditDetails.dailyUsageBuckets[0].apiEquivalentUsd, 2)
  assert.equal(creditDetails.dailyUsageBuckets[0].models[0].apiEquivalentUsd, 1)
  assert.equal(creditDetails.dailyUsageBuckets[0].surfaces[0].apiEquivalentUsd, 2)

  const percentDetails = normalizeCodexUsageDetails({
    usage: {
      availability: 'available',
      units: 'percent',
      pricing: { creditsPerUsd: 25, currency: 'USD' },
      summary: { rangeCredits: 50, apiEquivalentUsd: 2 },
      dailyUsageBuckets: [{
        date: isoDay(0),
        credits: 50,
        apiEquivalentUsd: 2,
        models: [{ model: 'not-credits', credits: 25, apiEquivalentUsd: 1 }],
        surfaces: [{ surface: 'cli', credits: 50, apiEquivalentUsd: 2 }],
      }],
    },
  })
  const percentRange = selectCodexUsageRange(percentDetails)
  assert.equal(percentDetails.summary.apiEquivalentUsd, null)
  assert.equal(percentDetails.dailyUsageBuckets[0].apiEquivalentUsd, null)
  assert.equal(percentDetails.dailyUsageBuckets[0].models[0].apiEquivalentUsd, null)
  assert.equal(percentDetails.dailyUsageBuckets[0].surfaces[0].apiEquivalentUsd, null)
  assert.equal(percentRange.status, 'unavailable')
  assert.equal(percentRange.apiEquivalentUsd, null)
})

test('respects an explicit pricing unavailable signal even for credit units', () => {
  const details = normalizeCodexUsageDetails({
    usage: {
      availability: 'available',
      units: 'credits',
      pricing: { available: false, creditsPerUsd: 25, currency: 'USD' },
      summary: { rangeCredits: 25, apiEquivalentUsd: 1 },
      dailyUsageBuckets: [{
        date: isoDay(0),
        credits: 25,
        apiEquivalentUsd: 1,
        models: [{ model: 'blocked', credits: 25, apiEquivalentUsd: 1 }],
        surfaces: [{ surface: 'cli', credits: 25, apiEquivalentUsd: 1 }],
      }],
    },
  })
  const range = selectCodexUsageRange(details)
  assert.equal(details.summary.apiEquivalentUsd, null)
  assert.equal(details.dailyUsageBuckets[0].apiEquivalentUsd, null)
  assert.equal(details.dailyUsageBuckets[0].models[0].apiEquivalentUsd, null)
  assert.equal(details.dailyUsageBuckets[0].surfaces[0].apiEquivalentUsd, null)
  assert.equal(range.totalCredits, 25)
  assert.equal(range.apiEquivalentUsd, null)
  assert.equal(range.priceStatus, 'unavailable')
})

test('negative credits are invalid partial data rather than fabricated zero usage', () => {
  const details = normalizeCodexUsageDetails(payload([
    { date: isoDay(0), credits: -25, apiEquivalentUsd: -1 },
  ]))
  const range = selectCodexUsageRange(details)
  assert.equal(details.dailyUsageBuckets[0].credits, null)
  assert.equal(details.dailyUsageBuckets[0].apiEquivalentUsd, null)
  assert.equal(range.status, 'partial')
  assert.equal(range.totalCredits, null)
})
