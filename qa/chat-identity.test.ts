import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AUTHENTICATED_CHAT_ROUTE,
  ChatTransportError,
  GUEST_CHAT_ROUTE,
  hasVerifiedChatIdentity,
  requiresChatReauthentication,
  resolveChatApiUrl,
} from '../src/lib/chatIdentity.ts'

test('signed-in chat always upgrades the legacy local endpoint to the strict route', () => {
  assert.equal(resolveChatApiUrl(undefined, true), AUTHENTICATED_CHAT_ROUTE)
  assert.equal(resolveChatApiUrl(GUEST_CHAT_ROUTE, true), AUTHENTICATED_CHAT_ROUTE)
  assert.equal(resolveChatApiUrl(undefined, false), GUEST_CHAT_ROUTE)
})

test('a custom endpoint remains configurable but cannot bypass identity validation', () => {
  assert.equal(
    resolveChatApiUrl('https://api.example.invalid/chat', true),
    'https://api.example.invalid/chat',
  )
  assert.equal(hasVerifiedChatIdentity(new Headers()), false)
  assert.equal(hasVerifiedChatIdentity(new Headers({
    'X-ChatGPT-Identity-Mode': 'guest',
  })), false)
  assert.equal(hasVerifiedChatIdentity(new Headers({
    'X-ChatGPT-Identity-Mode': 'verified-session',
  })), true)
})

test('only explicit authenticated transport failures invalidate stale account UI', () => {
  const expired = new ChatTransportError('sign in again', {
    status: 401,
    code: 'authentication_required',
    requiresReauthentication: true,
  })
  assert.equal(requiresChatReauthentication(expired), true)
  assert.equal(requiresChatReauthentication(new ChatTransportError('gateway', {
    status: 502,
  })), false)
  assert.equal(requiresChatReauthentication(new Error('unrelated')), false)
})
