import assert from 'node:assert/strict'
import test from 'node:test'

import {
  accountBridgeArgs,
  devRuntimeConfig,
  envFlag,
  envHost,
  envPort,
  viteArgs,
} from './dev-config.mjs'

test('account bridge keeps in-memory sessions stable by default', () => {
  const args = accountBridgeArgs()
  assert.equal(args.includes('--reload'), false)
  assert.equal(args.includes('--reload-dir'), false)
})

test('account bridge reload is an explicit opt-in', () => {
  const args = accountBridgeArgs({ reload: envFlag('true') })
  assert.deepEqual(args.slice(-3), ['--reload', '--reload-dir', 'server'])
  assert.equal(envFlag(undefined), false)
  assert.equal(envFlag('0'), false)
  assert.equal(envFlag('ON'), true)
})

test('LAN mode exposes only the web listener by default', () => {
  const config = devRuntimeConfig({ argv: ['--lan'], env: {} })
  assert.deepEqual(config, {
    lan: true,
    reload: false,
    webHost: '0.0.0.0',
    webPort: 5173,
    bridgeHost: '127.0.0.1',
    bridgePort: 8787,
  })
  assert.deepEqual(
    accountBridgeArgs({ host: config.bridgeHost, port: config.bridgePort }),
    ['-m', 'uvicorn', 'server.app:app', '--host', '127.0.0.1', '--port', '8787'],
  )
  assert.deepEqual(viteArgs('vite.mjs', { host: config.webHost, port: config.webPort }), [
    'vite.mjs', '--host', '0.0.0.0', '--port', '5173', '--strictPort',
  ])
})

test('deployment listener overrides are validated', () => {
  const config = devRuntimeConfig({
    env: {
      CHATGPT_DEV_LAN: 'yes',
      CHATGPT_WEB_HOST: '::',
      CHATGPT_WEB_PORT: '4173',
      CHATGPT_BRIDGE_HOST: '0.0.0.0',
      CHATGPT_BRIDGE_PORT: '9000',
    },
  })
  assert.equal(config.lan, true)
  assert.equal(config.webHost, '::')
  assert.equal(config.webPort, 4173)
  assert.equal(config.bridgeHost, '0.0.0.0')
  assert.equal(config.bridgePort, 9000)
  assert.equal(envPort('70000', 5173), 5173)
  assert.equal(envPort('5173oops', 5173), 5173)
  assert.equal(envHost('bad host', '127.0.0.1'), '127.0.0.1')
})
