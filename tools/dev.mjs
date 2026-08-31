import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { accountBridgeArgs, devRuntimeConfig, viteArgs } from './dev-config.mjs'

const localPython = resolve(
  process.cwd(),
  process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python',
)
const pythonCommand = process.env.PYTHON
  ?? (existsSync(localPython) ? localPython : (process.platform === 'win32' ? 'python' : 'python3'))
const viteEntry = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))
const children = new Set()
let shuttingDown = false
const runtime = devRuntimeConfig({ argv: process.argv.slice(2), env: process.env })

function start(command, args, label, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', ...extraEnv },
    stdio: 'inherit',
    windowsHide: true,
  })
  children.add(child)
  child.on('exit', (code, signal) => {
    children.delete(child)
    if (!shuttingDown) {
      console.error(`[dev] ${label} exited (${signal ?? code ?? 'unknown'}); stopping.`)
      shutdown(code ?? 1)
    }
  })
  child.on('error', (error) => {
    console.error(`[dev] Failed to start ${label}: ${error.message}`)
    shutdown(1)
  })
  return child
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    child.kill('SIGTERM')
  }
  setTimeout(() => process.exit(exitCode), 250).unref()
}

start(
  pythonCommand,
  accountBridgeArgs({
    reload: runtime.reload,
    host: runtime.bridgeHost,
    port: runtime.bridgePort,
  }),
  'account bridge',
)
console.log(
  `[dev] account bridge auto-reload ${runtime.reload ? 'enabled' : 'disabled'}; `
  + 'set CHATGPT_DEV_RELOAD=1 to opt in (reload clears in-memory Session state).',
)
start(
  process.execPath,
  viteArgs(viteEntry, { host: runtime.webHost, port: runtime.webPort }),
  'Vite',
  {
    CHATGPT_BRIDGE_PROXY_TARGET: process.env.CHATGPT_BRIDGE_PROXY_TARGET
      ?? `http://127.0.0.1:${runtime.bridgePort}`,
  },
)

console.log(`[dev] web listening on ${runtime.webHost}:${runtime.webPort}`)
console.log(`[dev] account bridge listening on ${runtime.bridgeHost}:${runtime.bridgePort}`)
if (runtime.lan || runtime.webHost === '0.0.0.0' || runtime.webHost === '::') {
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
    .map((entry) => `http://${entry.address}:${runtime.webPort}`)
  for (const address of [...new Set(addresses)]) console.log(`[dev] LAN: ${address}`)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
