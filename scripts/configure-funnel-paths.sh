#!/usr/bin/env bash
# Configure Tailscale Funnel path split on agent3.
# Root (/) unmapped — only /poker and /office.
#
# Upstream MUST include the mount path so Vite receives /poker/... and /office/...
# (not stripped to /). Otherwise absolute asset URLs 404 at the Funnel root.
set -euo pipefail

OFFICE_UPSTREAM="${OFFICE_UPSTREAM:-http://127.0.0.1:5173/office}"
POKER_UPSTREAM="${POKER_UPSTREAM:-http://127.0.0.1:5174/poker}"

if ! command -v tailscale >/dev/null 2>&1; then
  echo "ERROR: tailscale CLI not found" >&2
  exit 1
fi

echo "==> reset existing serve/funnel handlers"
tailscale serve reset || true
tailscale funnel reset || true

echo "==> off any root (/) handler if still present"
tailscale serve --bg --set-path=/ off 2>/dev/null || true
tailscale funnel --bg --set-path=/ off 2>/dev/null || true

echo "==> Funnel /office → ${OFFICE_UPSTREAM}"
tailscale funnel --bg --set-path=/office "${OFFICE_UPSTREAM}"

echo "==> Funnel /poker → ${POKER_UPSTREAM}"
tailscale funnel --bg --set-path=/poker "${POKER_UPSTREAM}"

echo "==> status"
tailscale serve status || true
tailscale funnel status || true

echo
echo "URLs:"
echo "  (root unused)  https://agent3s-imac.taildc5084.ts.net/"
echo "  office         https://agent3s-imac.taildc5084.ts.net/office/"
echo "  poker          https://agent3s-imac.taildc5084.ts.net/poker/"
echo
echo "Do NOT run: tailscale funnel --bg on"
echo "Re-run this after Funnel changes; then Jenkins/pm2 restart the apps."
