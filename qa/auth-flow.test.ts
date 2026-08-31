import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AuthFlowError,
  cancelAuthLogin,
  completeAuthLogin,
  startAuthLogin,
} from '../src/lib/authFlow.ts'

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

test('provider login client follows the local OAuth/PKCE contract', async () => {
  const originalFetch = globalThis.fetch
  const calls: FetchCall[] = []
  const responses = [
    jsonResponse({
      flowId: 'flow.start-1',
      provider: 'phone',
      status: 'pending',
      authorizationUrl: 'https://auth.openai.com/oauth/authorize?state=redacted',
      expiresIn: 600,
      pollAfterMs: 1_000,
    }, 201),
    jsonResponse({
      flowId: 'flow.start-1',
      status: 'pending',
      pollAfterMs: 1_200,
    }, 202),
    jsonResponse({
      flowId: 'flow.start-1',
      provider: 'phone',
      status: 'authenticated',
      callbackPath: '/images',
      user: {
        id: 'account-1',
        name: 'Account User',
        email: 'account@example.test',
        initials: 'AU',
        plan: 'plus',
        planLabel: 'Plus',
      },
    }, 200),
    new Response(null, { status: 204 }),
  ]

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input: String(input), init })
    const response = responses.shift()
    assert.ok(response, 'unexpected fetch')
    return response
  }) as typeof fetch

  try {
    const started = await startAuthLogin({
      provider: 'phone',
      callbackPath: '/images',
      loginHint: '+86 138 0000 0000',
    })
    assert.equal(started.flowId, 'flow.start-1')
    assert.equal(started.provider, 'phone')
    assert.equal(started.authorizationUrl.startsWith('https://auth.openai.com/'), true)
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
      provider: 'phone',
      callbackPath: '/images',
      loginHint: '+8613800000000',
    })
    assert.equal(calls[0]?.init?.credentials, 'include')

    const pending = await completeAuthLogin(started.flowId)
    assert.deepEqual(pending, {
      flowId: 'flow.start-1',
      status: 'pending',
      pollAfterMs: 1_200,
    })
    assert.equal(calls[1]?.input, '/api/auth/login/flow.start-1/complete')
    assert.equal(calls[1]?.init?.method, 'POST')
    assert.equal(calls[1]?.init?.body, '{}')

    const completed = await completeAuthLogin(started.flowId)
    assert.equal(completed.status, 'authenticated')
    if (completed.status === 'authenticated') {
      assert.equal(completed.user.plan, 'plus')
      assert.equal(completed.callbackPath, '/images')
    }

    await cancelAuthLogin(started.flowId)
    assert.equal(calls[3]?.init?.method, 'DELETE')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('provider login client blocks a non-OpenAI authorization URL', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => jsonResponse({
    flowId: 'flow-untrusted',
    provider: 'google',
    status: 'pending',
    authorizationUrl: 'https://example.test/oauth/authorize',
    expiresIn: 600,
    pollAfterMs: 1_000,
  }, 201)) as typeof fetch

  try {
    await assert.rejects(
      startAuthLogin({ provider: 'google', callbackPath: '/' }),
      (error: unknown) => error instanceof AuthFlowError && error.code === 'untrusted_authorization_url',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
