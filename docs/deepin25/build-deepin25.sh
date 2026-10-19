#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
ARCH="${ZTOOLS_LINUX_ARCH:-x64}"

log() {
  printf '\n[deepin25-build] %s\n' "$*"
}

fail() {
  printf '\n[deepin25-build] ERROR: %s\n' "$*" >&2
  exit 1
}

ensure_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing command: $1"
}

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return
  fi

  log "pnpm not found; preparing temporary pnpm via npm exec"
  ensure_command npm
  npm_config_registry="$REGISTRY" npm exec --yes pnpm@10 -- --version >/dev/null

  local pnpm_bin
  pnpm_bin="$(find "$HOME/.npm/_npx" -path '*/node_modules/.bin/pnpm' -type f 2>/dev/null | sort | tail -n 1 || true)"
  [[ -n "$pnpm_bin" ]] || fail "Unable to locate pnpm under $HOME/.npm/_npx"
  export PATH="$(dirname "$pnpm_bin"):$PATH"
}

log "Project root: $ROOT_DIR"
cd "$ROOT_DIR"

ensure_command node
ensure_pnpm

log "Node: $(node --version)"
log "pnpm: $(pnpm --version)"
log "Registry: $REGISTRY"

log "Cleaning previous build output"
rm -rf dist out node_modules internal-plugins/setting/node_modules internal-plugins/setting/dist

log "Installing root dependencies with pnpm default node linker"
pnpm install --frozen-lockfile --registry="$REGISTRY"

log "Installing setting plugin dependencies"
pnpm --dir internal-plugins/setting install --frozen-lockfile --node-linker=hoisted --registry="$REGISTRY"

log "Building setting plugin"
pnpm --dir internal-plugins/setting build

log "Running type checks"
pnpm typecheck

log "Building Electron app"
./node_modules/.bin/electron-vite build

log "Packaging Linux $ARCH artifacts"
./node_modules/.bin/electron-builder --linux --"$ARCH"

log "Artifacts"
find dist -maxdepth 1 -type f \( -name '*.deb' -o -name '*.AppImage' -o -name 'update-linux-*.zip' \) -printf '%p %s bytes\n' | sort

log "SHA-256"
sha256sum dist/*.deb dist/*.AppImage dist/update-linux-*.zip 2>/dev/null || true
