import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
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
    },
  },
})
