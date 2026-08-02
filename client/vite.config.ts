import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const MOUNT = '/poker'

/** Ensure absolute root URLs in index.html are mounted under /poker for Funnel. */
function mountAbsoluteUrls(): Plugin {
  return {
    name: 'mount-absolute-urls',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html
          .replace(/(href|src)="\/(?!\/|poker\/)/g, `$1="${MOUNT}/`)
          .replace(/(href|src)='\/(?!\/|poker\/)/g, `$1='${MOUNT}/`)
          .replace(/(from )(["'])\/(?!\/|poker\/)/g, `$1$2${MOUNT}/`)
          .replace(/(url\(['"]?)\/(?!\/|poker\/)/g, `$1${MOUNT}/`)
      },
    },
  }
}

export default defineConfig({
  // Public URLs under Funnel /poker — upstream must forward /poker/* to Vite (see funnel script).
  base: `${MOUNT}/`,
  plugins: [react(), mountAbsoluteUrls()],
  server: {
    host: true,
    port: 5174,
    allowedHosts: true,
    proxy: {
      [`${MOUNT}/api`]: {
        target: 'http://127.0.0.1:3002',
        rewrite: (p) => p.replace(new RegExp(`^${MOUNT}`), ''),
      },
      [`${MOUNT}/socket.io`]: {
        target: 'http://127.0.0.1:3002',
        ws: true,
        rewrite: (p) => p.replace(new RegExp(`^${MOUNT}`), ''),
      },
    },
  },
  preview: {
    host: true,
    port: 5174,
    allowedHosts: true,
    proxy: {
      [`${MOUNT}/api`]: {
        target: 'http://127.0.0.1:3002',
        rewrite: (p) => p.replace(new RegExp(`^${MOUNT}`), ''),
      },
      [`${MOUNT}/socket.io`]: {
        target: 'http://127.0.0.1:3002',
        ws: true,
        rewrite: (p) => p.replace(new RegExp(`^${MOUNT}`), ''),
      },
    },
  },
})
