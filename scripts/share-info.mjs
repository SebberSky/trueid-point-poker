#!/usr/bin/env node
/**
 * Share URLs for Point Poker on the agent3 host (same machine as TrueID Office).
 * Funnel root (/) is unused — only /poker and /office.
 */
const WEB_PORT = process.env.WEB_PORT || '5174'
const API_PORT = process.env.API_PORT || '3002'
const HOST = process.env.HOST_IP || '100.84.246.127'
const FUNNEL_HOST = process.env.FUNNEL_HOST || 'agent3s-imac.taildc5084.ts.net'

console.log(`
TrueID Point Poker — โฮสต์ (agent3, คู่กับ trueid-office)
────────────────────────────────────────
คนนอก / Funnel poker:   https://${FUNNEL_HOST}/poker/
คนนอก / Funnel office:  https://${FUNNEL_HOST}/office/
Root (/):                ไม่ผูกแอป — ต้องเปิด /poker หรือ /office
ใน Tailscale (สำรอง):  http://${HOST}:${WEB_PORT}/poker/
เครื่องโฮสต์เอง:         http://localhost:${WEB_PORT}/poker/
Admin:                   https://${FUNNEL_HOST}/poker/room-hosts-ctrl
API health:              http://localhost:${API_PORT}/health

ตั้ง Funnel path (ครั้งเดียวบนโฮสต์):
  bash scripts/configure-funnel-paths.sh
  # หรือมือ:
  #   tailscale serve reset; tailscale funnel reset
  #   tailscale funnel --bg --set-path=/office http://127.0.0.1:5173/office
  #   tailscale funnel --bg --set-path=/poker  http://127.0.0.1:5174/poker
  # ห้าม: tailscale funnel --bg on   ← CLI จะไปยิง target "http://on"

สำคัญ
• โฮสต์รันผ่าน pm2 จาก ~/apps/trueid-point-poker (Jenkins webhook)
• พอร์ตไม่ชน office: web ${WEB_PORT} / api ${API_PORT} (office = 5173 / 3001)
• รีสตาร์ทมือ: cd ~/apps/trueid-point-poker && npm run restart:host
`)
