import assert from 'node:assert/strict'
import test from 'node:test'

import {
  conversationDistanceFromBottom,
  guestAssistantTurnUi,
  shouldStickToConversationBottom,
} from '../src/lib/guestConversation.ts'

test('streaming assistant replies hide actions until the reply completes', () => {
  assert.deepEqual(
    guestAssistantTurnUi({ hasText: true, isGenerating: true, isLastTurn: true }),
    { streaming: true, showActions: false },
  )
  assert.deepEqual(
    guestAssistantTurnUi({ hasText: true, isGenerating: false, isLastTurn: true }),
    { streaming: false, showActions: true },
  )
})

test('a stopped partial reply keeps copy/share actions without adding a status badge', () => {
  assert.deepEqual(
    guestAssistantTurnUi({ hasText: true, isGenerating: false, isLastTurn: true }),
    { streaming: false, showActions: true },
  )
  assert.deepEqual(
    guestAssistantTurnUi({ hasText: false, isGenerating: false, isLastTurn: true }),
    { streaming: false, showActions: false },
  )
})

test('conversation scrolling sticks only while the reader remains near the bottom', () => {
  const nearBottom = { clientHeight: 500, scrollHeight: 1_200, scrollTop: 610 }
  const readingEarlier = { clientHeight: 500, scrollHeight: 1_200, scrollTop: 300 }

  assert.equal(conversationDistanceFromBottom(nearBottom), 90)
  assert.equal(shouldStickToConversationBottom(nearBottom), true)
  assert.equal(shouldStickToConversationBottom(readingEarlier), false)
})
