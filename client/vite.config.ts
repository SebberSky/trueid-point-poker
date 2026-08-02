import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Funnel `--set-path=/poker` forwards `/poker/...` as `/...` to Vite.
 * Absolute base `/poker/` then 302s `/` → `/poker/` forever — use relative base.
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3002',
      },
      '/socket.io': {
        target: 'http://127.0.0.1:3002',
        ws: true,
      },
      // Local visits to /poker/... without Funnel strip
      '/poker/api': {
        target: 'http://127.0.0.1:3002',
        rewrite: (p) => p.replace(/^\/poker/, ''),
      },
      '/poker/socket.io': {
        target: 'http://127.0.0.1:3002',
        ws: true,
        rewrite: (p) => p.replace(/^\/poker/, ''),
      },
    },
  },
})
