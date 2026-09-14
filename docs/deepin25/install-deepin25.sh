#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
DESKTOP_TEMPLATE="$SCRIPT_DIR/ZTools.desktop"

log() {
  printf '\n[deepin25-install] %s\n' "$*"
}

fail() {
  printf '\n[deepin25-install] ERROR: %s\n' "$*" >&2
  exit 1
}

find_latest_deb() {
  local latest
  latest="$(find "$ROOT_DIR/dist" -maxdepth 1 -type f -name 'ZTools_*_*.deb' -printf '%T@ %p\n' 2>/dev/null | sort -nr | awk 'NR==1 {print $2}')"
  [[ -n "$latest" ]] || fail "No deb package found in $ROOT_DIR/dist. Run docs/deepin25/build-deepin25.sh first."
  printf '%s\n' "$latest"
}

resolve_desktop_dir() {
  if [[ -n "${XDG_DESKTOP_DIR:-}" ]]; then
    printf '%s\n' "$XDG_DESKTOP_DIR"
    return
  fi

  if [[ -f "$HOME/.config/user-dirs.dirs" ]]; then
    local configured
    configured="$(awk -F= '$1 == "XDG_DESKTOP_DIR" {gsub(/"/, "", $2); print $2}' "$HOME/.config/user-dirs.dirs")"
    if [[ -n "$configured" ]]; then
      printf '%s\n' "${configured/#\$HOME/$HOME}"
      return
    fi
  fi

  printf '%s\n' "$HOME/Desktop"
}

resolve_icon_path() {
  local candidates=(
    "/opt/ZTools/resources/app.asar.unpacked/resources/icons/icon-ztools.png"
    "/opt/ZTools/resources/app.asar.unpacked/resources/icons/icon.png"
    "/usr/share/icons/hicolor/1024x1024/apps/ztools.png"
  )

  local icon
  for icon in "${candidates[@]}"; do
    if [[ -f "$icon" ]]; then
      printf '%s\n' "$icon"
      return
    fi
  done

  printf '%s\n' "ztools"
}

write_desktop_file() {
  local target="$1"
  local mode="$2"
  local icon_path
  icon_path="$(resolve_icon_path)"

  sed "s|^Icon=.*$|Icon=$icon_path|" "$DESKTOP_TEMPLATE" > "$target"
  chmod "$mode" "$target"
}

install_deb() {
  local deb="$1"
  log "Installing $deb"
  if command -v apt >/dev/null 2>&1; then
    sudo apt install -y "$deb"
  else
    sudo dpkg -i "$deb"
    sudo apt-get install -f -y
  fi
}

install_launcher() {
  local desktop_dir
  local launcher_path
  local app_dir
  local app_path
  desktop_dir="$(resolve_desktop_dir)"
  launcher_path="$desktop_dir/ZTools.desktop"
  app_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  app_path="$app_dir/ztools.desktop"

  [[ -f "$DESKTOP_TEMPLATE" ]] || fail "Missing launcher template: $DESKTOP_TEMPLATE"
  [[ -x /opt/ZTools/ztools ]] || fail "/opt/ZTools/ztools does not exist or is not executable"

  mkdir -p "$desktop_dir"
  write_desktop_file "$launcher_path" 0755
  if command -v gio >/dev/null 2>&1; then
    gio set "$launcher_path" metadata::trusted true 2>/dev/null || true
  fi

  if command -v desktop-file-validate >/dev/null 2>&1; then
    desktop-file-validate "$launcher_path"
  fi

  mkdir -p "$app_dir"
  write_desktop_file "$app_path" 0644

  if command -v desktop-file-validate >/dev/null 2>&1; then
    desktop-file-validate "$app_path"
  fi

  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$app_dir" 2>/dev/null || true
  fi

  if [[ -f /usr/share/icons/hicolor/1024x1024/apps/ztools.png ]] && command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -q /usr/share/icons/hicolor 2>/dev/null || true
  fi

  log "Launcher created: $launcher_path"
  log "Application entry created: $app_path"
}

if [[ "${1:-}" == "--launcher-only" ]]; then
  install_launcher
  log "Done. You can launch ZTools from the desktop icon, app launcher, or run: ztools"
  exit 0
fi

DEB_PATH="${1:-$(find_latest_deb)}"
[[ -f "$DEB_PATH" ]] || fail "Package not found: $DEB_PATH"

install_deb "$DEB_PATH"
install_launcher

log "Done. You can launch ZTools from the desktop icon, app launcher, or run: ztools"
