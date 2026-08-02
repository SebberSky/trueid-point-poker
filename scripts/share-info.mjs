#!/usr/bin/env node
/**
 * Share URLs for Point Poker + portal on the agent3 host.
 */
const WEB_PORT = process.env.WEB_PORT || '5174'
const API_PORT = process.env.API_PORT || '3002'
const PORTAL_PORT = process.env.PORTAL_PORT || '5170'
const HOST = process.env.HOST_IP || '100.84.246.127'
const FUNNEL_HOST = process.env.FUNNEL_HOST || 'agent3s-imac.taildc5084.ts.net'

console.log(`
TrueID Portal + Point Poker — โฮสต์ (agent3)
────────────────────────────────────────
Portal (root):           https://${FUNNEL_HOST}/
Office:                  https://${FUNNEL_HOST}/office/
Point Poker:             https://${FUNNEL_HOST}/poker/
เครื่องโฮสต์ portal:     http://localhost:${PORTAL_PORT}/
เครื่องโฮสต์ poker:      http://localhost:${WEB_PORT}/poker/
Admin:                   https://${FUNNEL_HOST}/poker/room-hosts-ctrl
API health:              http://localhost:${API_PORT}/health

ตั้ง Funnel path:
  bash scripts/configure-funnel-paths.sh
  #   /        → :5170 portal
  #   /office  → :5173/office
  #   /poker   → :5174/poker

สำคัญ
• pm2: trueid-portal (:5170) + trueid-point-poker
• รีสตาร์ทมือ: cd ~/apps/trueid-point-poker && npm run restart:host
`)
