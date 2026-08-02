import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/poker/',
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
    allowedHosts: true,
    proxy: {
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
