import assert from 'node:assert/strict'
import test from 'node:test'

import {
  generateImage,
  ImageGenerationError,
} from '../src/lib/imageTransport.ts'

type FetchCall = {
  input: string
  init?: RequestInit
}

const VERIFIED_IDENTITY_HEADERS = {
  'content-type': 'application/json',
  'X-ChatGPT-Identity-Mode': 'verified-session',
}

function jsonResponse(
  status: number,
  payload: unknown,
  headers: Record<string, string> = VERIFIED_IDENTITY_HEADERS,
) {
  return new Response(JSON.stringify(payload), { status, headers })
}

function generatedImage(id = 'imgasset-result-1') {
  return {
    id,
    url: `/api/images/assets/${id}`,
    width: 1024,
    height: 1024,
    mimeType: 'image/webp',
    prompt: 'A glass city at sunrise',
  }
}

test('posts the image-generation contract and only accepts opaque same-origin asset URLs', async (context) => {
  const calls: FetchCall[] = []
  context.mock.method(globalThis, 'fetch', async (input, init) => {
    calls.push({ input: String(input), init })
    return jsonResponse(201, {
      id: 'imgjob-create-1',
      status: 'succeeded',
      conversationId: 'conversation-1',
      message: 'Image ready',
      images: [
        generatedImage(),
        {
          id: 'imgasset-external',
          url: 'https://upstream.example.invalid/signed-image.png',
          mimeType: 'image/png',
        },
      ],
      error: null,
    })
  })

  const result = await generateImage('  A glass city at sunrise  ', { model: 'auto' })

  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.input, '/api/images/generations')
  assert.equal(calls[0]?.init?.method, 'POST')
  assert.equal(calls[0]?.init?.cache, 'no-store')
  assert.equal(calls[0]?.init?.credentials, 'include')
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    model: 'auto',
    messages: [{
      role: 'user',
      content: [{ type: 'text', text: 'A glass city at sunrise' }],
    }],
    stream: false,
  })
  assert.deepEqual(result, {
    id: 'imgjob-create-1',
    status: 'succeeded',
    conversationId: 'conversation-1',
    message: 'Image ready',
    images: [generatedImage()],
  })
})

test('polls a queued generation until it succeeds', async (context) => {
  const calls: FetchCall[] = []
  const statuses: string[] = []
  context.mock.method(globalThis, 'fetch', async (input, init) => {
    calls.push({ input: String(input), init })
    if (calls.length === 1) {
      return jsonResponse(202, {
        id: 'imgjob-queued-1',
        status: 'queued',
        conversationId: null,
        message: 'Queued',
        images: [],
        error: null,
      })
    }
    return jsonResponse(200, {
      id: 'imgjob-queued-1',
      status: 'succeeded',
      conversationId: 'conversation-queued-1',
      message: 'Image ready',
      images: [generatedImage('imgasset-polled-1')],
      error: null,
    })
  })

  const result = await generateImage('Draw a lighthouse', {
    onStatus: (status) => statuses.push(status),
  })

  assert.equal(calls.length, 2)
  assert.equal(calls[1]?.input, '/api/images/generations/imgjob-queued-1')
  assert.equal(calls[1]?.init?.cache, 'no-store')
  assert.equal(calls[1]?.init?.credentials, 'include')
  assert.deepEqual(statuses, ['queued'])
  assert.equal(result.status, 'succeeded')
  assert.equal(result.conversationId, 'conversation-queued-1')
  assert.equal(result.images[0]?.url, '/api/images/assets/imgasset-polled-1')
})

test('surfaces a terminal failed generation with its backend error code', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => jsonResponse(200, {
    id: 'imgjob-failed-1',
    status: 'failed',
    conversationId: null,
    message: 'The image tool rejected this request.',
    images: [],
    error: { code: 'image_tool_failed' },
  }))

  await assert.rejects(
    generateImage('Draw something'),
    (error: unknown) => (
      error instanceof ImageGenerationError
      && error.status === 502
      && error.code === 'image_tool_failed'
      && error.message === 'The image tool rejected this request.'
    ),
  )
})

test('rejects a response that is not bound to the verified browser session', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => jsonResponse(200, {
    id: 'imgjob-guest-1',
    status: 'succeeded',
    conversationId: null,
    message: 'Image ready',
    images: [generatedImage()],
    error: null,
  }, {
    'content-type': 'application/json',
    'X-ChatGPT-Identity-Mode': 'guest',
  }))

  await assert.rejects(
    generateImage('Draw something'),
    (error: unknown) => (
      error instanceof ImageGenerationError
      && error.status === 502
      && error.code === 'identity_mode_mismatch'
    ),
  )
})

test('caller abort stops queued polling before another request is sent', async (context) => {
  const controller = new AbortController()
  let calls = 0
  context.mock.method(globalThis, 'fetch', async () => {
    calls += 1
    globalThis.setTimeout(() => controller.abort(), 0)
    return jsonResponse(202, {
      id: 'imgjob-abort-1',
      status: 'queued',
      conversationId: null,
      message: 'Queued',
      images: [],
      error: null,
    })
  })

  await assert.rejects(
    generateImage('Draw something', { signal: controller.signal }),
    (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
  )
  assert.equal(calls, 1)
})
