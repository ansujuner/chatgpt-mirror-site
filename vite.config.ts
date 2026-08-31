import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const bridgeProxyTarget = process.env.CHATGPT_BRIDGE_PROXY_TARGET
  ?? `http://127.0.0.1:${process.env.CHATGPT_BRIDGE_PORT ?? '8787'}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: bridgeProxyTarget,
        changeOrigin: false,
      },
    },
  },
})
