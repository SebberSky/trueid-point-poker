#!/usr/bin/env bash
# Restart TrueID Point Poker under pm2 (called from Jenkins — job can exit; app keeps running).
# Host app lives under ~/apps/ (default ~/apps/trueid-point-poker). Override with TRUEID_POINT_POKER_DIR.
set -euo pipefail

# Jenkins agents often lack interactive-shell PATH (Homebrew / nvm / fnm).
ensure_node_on_path() {
  export PATH="/opt/homebrew/bin:/usr/local/bin:${HOME}/.local/bin:${PATH}"

  if [[ -s "${HOME}/.nvm/nvm.sh" ]]; then
    # shellcheck disable=SC1091
    . "${HOME}/.nvm/nvm.sh"
  fi
  if [[ -d "${HOME}/.fnm" ]]; then
    export PATH="${HOME}/.fnm:${PATH}"
    if command -v fnm >/dev/null 2>&1; then
      eval "$(fnm env)"
    fi
  fi
  # Volta
  if [[ -d "${HOME}/.volta/bin" ]]; then
    export PATH="${HOME}/.volta/bin:${PATH}"
  fi
  # Latest nvm node bin if nvm.sh did not load (non-interactive)
  if ! command -v npm >/dev/null 2>&1 && [[ -d "${HOME}/.nvm/versions/node" ]]; then
    local latest
    latest="$(ls -1d "${HOME}/.nvm/versions/node"/v* 2>/dev/null | sort -V | tail -1 || true)"
    if [[ -n "${latest}" && -x "${latest}/bin/npm" ]]; then
      export PATH="${latest}/bin:${PATH}"
    fi
  fi

  if ! command -v npm >/dev/null 2>&1; then
    echo "ERROR: npm not found in PATH for this Jenkins shell." >&2
    echo "PATH=${PATH}" >&2
    echo "Install Node (brew/nvm) for user $(whoami), or set PATH on the Jenkins node." >&2
    command -v node >/dev/null 2>&1 && echo "node=$(command -v node)" >&2 || echo "node: missing" >&2
    exit 127
  fi
  echo "==> using node=$(command -v node) npm=$(command -v npm)"
  node -v
  npm -v
}

ensure_node_on_path

SCRIPT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

resolve_deploy_dir() {
  if [[ -n "${TRUEID_POINT_POKER_DIR:-}" ]]; then
    echo "$TRUEID_POINT_POKER_DIR"
    return
  fi
  local preferred="$HOME/apps/trueid-point-poker"
  if [[ -d "$preferred/.git" ]]; then
    echo "$preferred"
    return
  fi
  echo "$preferred"
}

DEPLOY_DIR="$(resolve_deploy_dir)"

if [[ "$SCRIPT_ROOT" == *"/workspace/"* || "$SCRIPT_ROOT" == *"jenkins"* || "$SCRIPT_ROOT" == *"Jenkins"* ]]; then
  APP_DIR="$DEPLOY_DIR"
  echo "==> Jenkins workspace detected ($SCRIPT_ROOT)"
  echo "==> syncing permanent deploy dir: $APP_DIR"
  if [[ ! -d "$APP_DIR/.git" ]]; then
    echo "ERROR: permanent deploy dir missing: $APP_DIR" >&2
    echo "Expected ~/apps/trueid-point-poker (or set TRUEID_POINT_POKER_DIR)." >&2
    echo "Clone once: git clone https://github.com/SebberSky/trueid-point-poker.git ~/apps/trueid-point-poker" >&2
    ls -la "$HOME/apps" 2>&1 || true
    exit 1
  fi
  git -C "$APP_DIR" fetch origin
  git -C "$APP_DIR" checkout -B main origin/main
  git -C "$APP_DIR" reset --hard origin/main
else
  if [[ "$SCRIPT_ROOT" == *"/apps/"* ]]; then
    APP_DIR="$SCRIPT_ROOT"
  elif [[ -d "$DEPLOY_DIR/.git" ]]; then
    APP_DIR="$DEPLOY_DIR"
  else
    APP_DIR="$SCRIPT_ROOT"
  fi
  echo "==> manual restart from: $APP_DIR"
fi

cd "$APP_DIR"

if [[ ! -f server/.env ]]; then
  echo "ERROR: missing server/.env — copy from server/.env.example and set Jira/admin credentials." >&2
  exit 1
fi

echo "==> npm ci (root, server, client)"
npm ci
npm ci --prefix server
npm ci --prefix client

PM2=(npx --no-install pm2)

echo "==> pm2 delete trueid-point-poker then start from $APP_DIR"
"${PM2[@]}" delete trueid-point-poker 2>/dev/null || true
"${PM2[@]}" start "$APP_DIR/ecosystem.config.cjs"

"${PM2[@]}" save
"${PM2[@]}" status trueid-point-poker

echo "==> waiting for API health on :3002..."
ok=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf -m 2 http://127.0.0.1:3002/health >/tmp/trueid-point-poker-health.json 2>/dev/null; then
    echo "==> health:"
    cat /tmp/trueid-point-poker-health.json
    echo
    ok=1
    break
  fi
  sleep 2
done
if [[ "$ok" -ne 1 ]]; then
  echo "ERROR: /health did not come up on :3002" >&2
  "${PM2[@]}" logs trueid-point-poker --lines 40 --nostream || true
  exit 1
fi

echo "==> share URLs"
node scripts/share-info.mjs
