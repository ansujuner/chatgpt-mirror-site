import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ANONYMOUS_AUTH_STATE,
  authenticatedAuthState,
  authStateFromSnapshot,
  createInitialAuthState,
} from '../src/lib/authState.ts'
import type { SessionAccount } from '../src/lib/authSession.ts'

const plusAccount: SessionAccount = {
  id: 'account-plus',
  name: 'Plus User',
  email: 'plus@example.test',
  initials: 'PU',
  plan: 'plus',
  planLabel: 'Plus',
}

test('a normal document never starts in a fake authenticated Free state', () => {
  assert.deepEqual(createInitialAuthState(), { status: 'checking', account: null })
  assert.deepEqual(createInitialAuthState(true), ANONYMOUS_AUTH_STATE)
})

test('a missing or malformed Session resolves to anonymous', () => {
  assert.deepEqual(
    authStateFromSnapshot({ authenticated: false, user: null }),
    ANONYMOUS_AUTH_STATE,
  )
  assert.deepEqual(
    authStateFromSnapshot({ authenticated: true, user: null }),
    ANONYMOUS_AUTH_STATE,
  )
})

test('a verified Session preserves the hydrated account and plan', () => {
  assert.deepEqual(
    authStateFromSnapshot({ authenticated: true, user: plusAccount }),
    authenticatedAuthState(plusAccount),
  )
})
