#!/usr/bin/env node
/**
 * Share URLs for Point Poker on the agent3 host (same machine as TrueID Office).
 * Public guests use Tailscale Funnel with path /poker (office stays at /).
 */
const WEB_PORT = process.env.WEB_PORT || '5174'
const API_PORT = process.env.API_PORT || '3002'
const HOST = process.env.HOST_IP || '100.84.246.127'
const FUNNEL_HOST = process.env.FUNNEL_HOST || 'agent3s-imac.taildc5084.ts.net'

console.log(`
TrueID Point Poker — โฮสต์ (agent3, คู่กับ trueid-office)
────────────────────────────────────────
คนนอก / Funnel:         https://${FUNNEL_HOST}/poker/
Office (root):           https://${FUNNEL_HOST}/
ใน Tailscale (สำรอง):  http://${HOST}:${WEB_PORT}/poker/
เครื่องโฮสต์เอง:         http://localhost:${WEB_PORT}/poker/
Admin:                   https://${FUNNEL_HOST}/poker/room-hosts-ctrl
API health:              http://localhost:${API_PORT}/health

Funnel path (ครั้งแรกบนโฮสต์ — คู่กับ office ที่ /):
  tailscale serve --bg https / http://127.0.0.1:5173
  tailscale serve --bg https /poker http://127.0.0.1:5174
  tailscale funnel --bg 443 on

สำคัญ
• โฮสต์รันผ่าน pm2 จาก ~/apps/trueid-point-poker (Jenkins webhook)
• พอร์ตไม่ชน office: web ${WEB_PORT} / api ${API_PORT} (office = 5173 / 3001)
• รีสตาร์ทมือ: cd ~/apps/trueid-point-poker && npm run restart:host
`)
