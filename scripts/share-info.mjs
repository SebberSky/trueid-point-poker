#!/usr/bin/env node
/**
 * Share URLs for Point Poker on the agent3 host.
 */
const WEB_PORT = process.env.WEB_PORT || '5174'
const API_PORT = process.env.API_PORT || '3002'
const HOST = process.env.HOST_IP || '100.84.246.127'
const FUNNEL_HOST = process.env.FUNNEL_HOST || 'agent3s-imac.taildc5084.ts.net'

console.log(`
TrueID Point Poker — โฮสต์ (agent3)
────────────────────────────────────────
Portal (root):           https://${FUNNEL_HOST}/
Office:                  https://${FUNNEL_HOST}/office/
Point Poker:             https://${FUNNEL_HOST}/poker/
เครื่องโฮสต์ poker:      http://localhost:${WEB_PORT}/poker/
Admin:                   https://${FUNNEL_HOST}/poker/room-hosts-ctrl
API health:              http://localhost:${API_PORT}/health
Tailscale IP:            http://${HOST}:${WEB_PORT}/poker/

Portal lives in https://github.com/SebberSky/trueid-portal
  (~/apps/trueid-portal · pm2 trueid-portal :5170)

สำคัญ
• pm2: trueid-point-poker (web :${WEB_PORT} / api :${API_PORT})
• รีสตาร์ทมือ: cd ~/apps/trueid-point-poker && npm run restart:host
`)
