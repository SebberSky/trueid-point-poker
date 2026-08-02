#!/usr/bin/env node
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = __dirname
const PORT = Number(process.env.PORT || 5170)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0] || '/')
  const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '')
  let filePath = path.join(ROOT, safe === '/' ? 'index.html' : safe)

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden')
    return
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      filePath = path.join(ROOT, 'index.html')
    }
    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        res.writeHead(404).end('Not found')
        return
      }
      const ext = path.extname(filePath)
      res.writeHead(200, {
        'Content-Type': TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      })
      res.end(data)
    })
  })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[trueid-portal] http://0.0.0.0:${PORT}/`)
})
