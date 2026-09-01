import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ConversationHistoryError,
  getConversationHistory,
  getConversationPage,
} from '../src/lib/conversationHistory.ts'

function jsonResponse(status: number, payload: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function summary(id: string) {
  return {
    id,
    title: `Conversation ${id}`,
    createdAt: null,
    updatedAt: '2026-09-01T12:00:00Z',
  }
}

test('conversation page retries one browser-level network failure', async (context) => {
  let calls = 0
  context.mock.method(globalThis, 'fetch', async () => {
    calls += 1
    if (calls === 1) throw new TypeError('fetch failed')
    return jsonResponse(200, { items: [summary('one')], nextCursor: null })
  })

  const page = await getConversationPage()

  assert.equal(calls, 2)
  assert.deepEqual(page.items, [summary('one')])
})

test('later page failure preserves the successfully loaded first page', async (context) => {
  let calls = 0
  context.mock.method(globalThis, 'fetch', async () => {
    calls += 1
    if (calls === 1) {
      return jsonResponse(200, {
        items: [summary('one'), summary('two')],
        nextCursor: 'next-page',
      })
    }
    return jsonResponse(
      503,
      { error: { code: 'history_upstream_rejected', message: 'temporary' } },
      { 'retry-after': '0' },
    )
  })

  const items = await getConversationHistory()

  assert.equal(calls, 2)
  assert.deepEqual(items, [summary('one'), summary('two')])
})

test('rate limiting is not multiplied by a client-side HTTP retry', async (context) => {
  let calls = 0
  context.mock.method(globalThis, 'fetch', async () => {
    calls += 1
    return jsonResponse(429, {
      error: { code: 'history_rate_limited', message: 'try later' },
    }, { 'retry-after': '120' })
  })

  await assert.rejects(
    getConversationPage(),
    (error: unknown) => (
      error instanceof ConversationHistoryError
      && error.status === 429
      && error.code === 'history_rate_limited'
    ),
  )
  assert.equal(calls, 1)
})

test('authentication failure on a later page is never hidden as partial history', async (context) => {
  let calls = 0
  context.mock.method(globalThis, 'fetch', async () => {
    calls += 1
    return calls === 1
      ? jsonResponse(200, { items: [summary('one')], nextCursor: 'next-page' })
      : jsonResponse(401, {
          error: { code: 'authentication_required', message: 'Sign in again.' },
        })
  })

  await assert.rejects(
    getConversationHistory(),
    (error: unknown) => (
      error instanceof ConversationHistoryError
      && error.status === 401
      && error.code === 'authentication_required'
    ),
  )
  assert.equal(calls, 2)
})

test('caller abort stops retrying immediately', async (context) => {
  const controller = new AbortController()
  let calls = 0
  context.mock.method(globalThis, 'fetch', async () => {
    calls += 1
    controller.abort(new Error('cancelled'))
    throw new Error('network failure')
  })

  await assert.rejects(getConversationPage({}, controller.signal), /network failure/)
  assert.equal(calls, 1)
})
