#!/usr/bin/env bash
# Configure Tailscale Funnel path split on agent3.
# Root (/) is intentionally unmapped — only /poker and /office.
#
# Use `tailscale funnel` with --set-path (NOT `funnel --bg on` — "on" is parsed as a bad target).
# Example:
#   tailscale funnel --bg --set-path=/poker http://127.0.0.1:5174
set -euo pipefail

OFFICE_UPSTREAM="${OFFICE_UPSTREAM:-http://127.0.0.1:5173}"
POKER_UPSTREAM="${POKER_UPSTREAM:-http://127.0.0.1:5174}"

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
echo "  (CLI treats 'on' as the upstream target → http://on error)"
