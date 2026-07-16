#!/bin/sh
#
# Overdeck installer.
#
#   curl -fsSL https://overdeck.ai/install | sh
#
# Installs the `overdeck` command (and its built-in `pan` alias) into the
# user-owned ~/.local prefix via npm. No sudo or system-directory writes.
#
# This script is intentionally dependency-light POSIX sh so it runs under the
# default shell on macOS and Linux. It is idempotent — re-running upgrades.
set -eu

PKG="@overdeck/core"
MIN_NODE_MAJOR=22
INSTALL_PREFIX=${OVERDECK_INSTALL_PREFIX:-"$HOME/.local"}
BIN_DIR="$INSTALL_PREFIX/bin"

info() { printf '\033[36m[overdeck]\033[0m %s\n' "$1"; }
err()  { printf '\033[31m[overdeck]\033[0m %s\n' "$1" >&2; }

# ─── 1. Node.js + npm bootstrap ───────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  err "Node.js is required but was not found."
  err "Install Node.js 24 from https://nodejs.org and re-run this command."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  err "npm was not found — it ships with Node.js. Reinstall Node from https://nodejs.org."
  exit 1
fi

mkdir -p "$BIN_DIR"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) PATH="$BIN_DIR:$PATH"; export PATH ;;
esac

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]; then
  err "Node.js ${MIN_NODE_MAJOR}+ is required (found $(node -v)). Update from https://nodejs.org and re-run."
  exit 1
fi

# ─── 2. Persist the user-local command path ───────────────────────────────────
if [ "$INSTALL_PREFIX" = "$HOME/.local" ]; then
  PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'
  PROFILE="$HOME/.profile"
  touch "$PROFILE"
  if ! grep -F "$PATH_LINE" "$PROFILE" >/dev/null 2>&1; then
    printf '\n# Overdeck CLI\n%s\n' "$PATH_LINE" >> "$PROFILE"
  fi

  case ${SHELL:-} in
    */bash) SHELL_RC="$HOME/.bashrc" ;;
    */zsh) SHELL_RC="$HOME/.zshrc" ;;
    *) SHELL_RC= ;;
  esac
  if [ -n "$SHELL_RC" ]; then
    touch "$SHELL_RC"
    if ! grep -F "$PATH_LINE" "$SHELL_RC" >/dev/null 2>&1; then
      printf '\n# Overdeck CLI\n%s\n' "$PATH_LINE" >> "$SHELL_RC"
    fi
  fi
fi

# ─── 3. Remove legacy user-local globals that also provide `pan` ──────────────
# Overdeck was previously published under other names; leaving them installed
# makes `pan` resolve to the stale package on PATH. Best-effort, never fatal.
for legacy in @panctl/cli @overdeck/cli panopticon-cli; do
  if NPM_CONFIG_PREFIX="$INSTALL_PREFIX" npm ls -g "$legacy" >/dev/null 2>&1; then
    info "Removing legacy global ${legacy} (it shadows the \`pan\` command)…"
    NPM_CONFIG_PREFIX="$INSTALL_PREFIX" npm rm -g "$legacy" >/dev/null 2>&1 || true
  fi
done

# ─── 4. Install ───────────────────────────────────────────────────────────────
info "Installing ${PKG}…"
if ! NPM_CONFIG_PREFIX="$INSTALL_PREFIX" npm install -g "${PKG}@latest"; then
  err "Install failed. Overdeck did not write to any system directory."
  exit 1
fi

# ─── 5. Verify and point the way ──────────────────────────────────────────────
if command -v overdeck >/dev/null 2>&1; then
  info "Installed $(overdeck --version 2>/dev/null || echo "${PKG}")."
  info "Start Command Deck:  overdeck up    (short alias: pan up)"
else
  err "Install finished, but 'overdeck' is not on your PATH."
  err "Open a new terminal and try again."
  exit 1
fi
