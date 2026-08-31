import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  AuthSessionError,
  loginWithSessionAndHydrate,
} from '../src/lib/authSession.ts'

type FetchCall = {
  input: string
  init?: RequestInit
}

function jsonResponse(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('Session login is wired as a fifth visible entry on both logged-out login surfaces', async () => {
  const [overlaySource, authPageSource, appSource] = await Promise.all([
    readFile(new URL('../src/Overlays.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/AuthFlowPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  ])

  assert.match(overlaySource, /data-auth-provider="session"/)
  assert.match(overlaySource, /使用 Session 登录/)
  assert.match(authPageSource, /data-auth-provider="session"/)
  assert.match(authPageSource, /onClick=\{onSessionLogin\}/)
  assert.match(appSource, /onSessionLogin=\{showSessionLogin\}/)
  assert.match(appSource, /loginWithSessionAndHydrate\(session\)/)
})

test('Session login posts the secret only in the request body and re-hydrates the authoritative account plan', async () => {
  const originalFetch = globalThis.fetch
  const secret = 'session-secret-that-must-not-enter-a-url-or-storage'
  const calls: FetchCall[] = []
  const responses = [
    jsonResponse({
      authenticated: true,
      user: {
        id: 'account-1',
        name: 'Session User',
        email: 'session@example.test',
        initials: 'SU',
        plan: 'free',
        planLabel: '免费版',
      },
    }, 200),
    jsonResponse({
      authenticated: true,
      user: {
        id: 'account-1',
        name: 'Session User',
        email: 'session@example.test',
        initials: 'SU',
        plan: 'pro',
        planLabel: 'Pro',
      },
    }, 200),
  ]

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input: String(input), init })
    const response = responses.shift()
    assert.ok(response, 'unexpected fetch')
    return response
  }) as typeof fetch

  try {
    const snapshot = await loginWithSessionAndHydrate(`  ${secret}  `)
    assert.equal(snapshot.authenticated, true)
    assert.equal(snapshot.user?.id, 'account-1')
    // The second GET, not the POST response, is authoritative for entitlement UI.
    assert.equal(snapshot.user?.plan, 'pro')

    assert.equal(calls.length, 2)
    assert.equal(calls[0]?.input, '/api/auth/session-login')
    assert.equal(calls[0]?.init?.method, 'POST')
    assert.equal(calls[0]?.init?.credentials, 'include')
    assert.equal(calls[0]?.init?.cache, 'no-store')
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { session: secret })

    assert.equal(calls[1]?.input, '/api/auth/session')
    assert.equal(calls[1]?.init?.credentials, 'include')
    assert.equal(calls[1]?.init?.cache, 'no-store')
    assert.equal(calls[1]?.init?.body, undefined)
    assert.equal(calls.every((call) => !call.input.includes(secret)), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Session login rejects a failed verification without echoing the supplied secret', async () => {
  const originalFetch = globalThis.fetch
  const secret = 'rejected-session-secret'
  const calls: FetchCall[] = []

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input: String(input), init })
    return jsonResponse({
      error: {
        code: 'invalid_session',
        message: 'Session 无效或已过期，请重新获取后再试。',
      },
    }, 401)
  }) as typeof fetch

  try {
    await assert.rejects(
      loginWithSessionAndHydrate(secret),
      (error: unknown) => (
        error instanceof AuthSessionError
        && error.status === 401
        && error.code === 'invalid_session'
        && !error.message.includes(secret)
      ),
    )
    assert.equal(calls.length, 1, 'failed POST must not attempt hydration')
    assert.equal(calls[0]?.input.includes(secret), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Session login fails closed if the re-hydrated cookie belongs to a different account', async () => {
  const originalFetch = globalThis.fetch
  const responses = [
    jsonResponse({ authenticated: true, user: { id: 'account-a', name: 'A', email: '', initials: 'A', plan: 'plus', planLabel: 'Plus' } }, 200),
    jsonResponse({ authenticated: true, user: { id: 'account-b', name: 'B', email: '', initials: 'B', plan: 'pro', planLabel: 'Pro' } }, 200),
  ]

  globalThis.fetch = (async () => {
    const response = responses.shift()
    assert.ok(response, 'unexpected fetch')
    return response
  }) as typeof fetch

  try {
    await assert.rejects(
      loginWithSessionAndHydrate('session-value'),
      (error: unknown) => error instanceof AuthSessionError && error.code === 'session_account_mismatch',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
