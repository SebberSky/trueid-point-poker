import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** Avoid 302 /poker → /poker/ which can loop through Funnel path mounts. */
function pokerBaseRewrite(): Plugin {
  return {
    name: 'poker-base-rewrite',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/poker') req.url = '/poker/'
        next()
      })
    },
  }
}

export default defineConfig({
  base: '/poker/',
  plugins: [react(), pokerBaseRewrite()],
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
