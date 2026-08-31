const TRUTHY_ENV_VALUES = new Set(['1', 'true', 'yes', 'on'])

const PORT_MIN = 1
const PORT_MAX = 65_535

export function envFlag(value) {
  return TRUTHY_ENV_VALUES.has(String(value ?? '').trim().toLowerCase())
}

export function envPort(value, fallback) {
  const raw = String(value ?? '').trim()
  if (!/^\d{1,5}$/u.test(raw)) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isInteger(parsed) && parsed >= PORT_MIN && parsed <= PORT_MAX
    ? parsed
    : fallback
}

export function envHost(value, fallback) {
  const host = String(value ?? '').trim()
  if (!host || host.length > 253 || /[\s/\\?#]/u.test(host)) return fallback
  return host
}

export function devRuntimeConfig({ argv = [], env = {} } = {}) {
  const lan = argv.includes('--lan') || envFlag(env.CHATGPT_DEV_LAN)
  return {
    lan,
    reload: envFlag(env.CHATGPT_DEV_RELOAD),
    webHost: envHost(env.CHATGPT_WEB_HOST, lan ? '0.0.0.0' : '127.0.0.1'),
    webPort: envPort(env.CHATGPT_WEB_PORT, 5173),
    bridgeHost: envHost(env.CHATGPT_BRIDGE_HOST, '127.0.0.1'),
    bridgePort: envPort(env.CHATGPT_BRIDGE_PORT, 8787),
  }
}

export function accountBridgeArgs({ reload = false, host = '127.0.0.1', port = 8787 } = {}) {
  const args = [
    '-m', 'uvicorn', 'server.app:app',
    '--host', host,
    '--port', String(port),
  ]
  if (reload) args.push('--reload', '--reload-dir', 'server')
  return args
}

export function viteArgs(viteEntry, { host = '127.0.0.1', port = 5173 } = {}) {
  return [viteEntry, '--host', host, '--port', String(port), '--strictPort']
}
