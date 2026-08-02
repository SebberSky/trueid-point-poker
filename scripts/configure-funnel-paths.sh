#!/usr/bin/env bash
# Configure Tailscale Serve/Funnel path split on agent3.
# Root (/) is intentionally unmapped — only /poker and /office.
set -euo pipefail

OFFICE_UPSTREAM="${OFFICE_UPSTREAM:-http://127.0.0.1:5173}"
POKER_UPSTREAM="${POKER_UPSTREAM:-http://127.0.0.1:5174}"

if ! command -v tailscale >/dev/null 2>&1; then
  echo "ERROR: tailscale CLI not found" >&2
  exit 1
fi

echo "==> reset existing serve/funnel handlers"
tailscale serve reset || true

echo "==> map /office → ${OFFICE_UPSTREAM}"
tailscale serve --bg --yes https /office "${OFFICE_UPSTREAM}"

echo "==> map /poker → ${POKER_UPSTREAM}"
tailscale serve --bg --yes https /poker "${POKER_UPSTREAM}"

echo "==> enable Funnel on 443 (no root handler)"
tailscale funnel --bg --yes 443 on

echo "==> status"
tailscale serve status
tailscale funnel status || true

echo
echo "URLs:"
echo "  (root unused)  https://agent3s-imac.taildc5084.ts.net/"
echo "  office         https://agent3s-imac.taildc5084.ts.net/office/"
echo "  poker          https://agent3s-imac.taildc5084.ts.net/poker/"
