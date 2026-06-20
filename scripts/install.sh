#!/bin/sh
#
# Overdeck installer.
#
#   curl -fsSL https://overdeck.ai/install | sh
#
# Installs the `overdeck` command (and its built-in `pan` alias) globally via
# npm. For the GUI, download the desktop app instead: https://overdeck.ai/download
#
# This script is intentionally dependency-light POSIX sh so it runs under the
# default shell on macOS and Linux. It is idempotent — re-running upgrades.
set -eu

PKG="@overdeck/core"
MIN_NODE_MAJOR=22

info() { printf '\033[36m[overdeck]\033[0m %s\n' "$1"; }
err()  { printf '\033[31m[overdeck]\033[0m %s\n' "$1" >&2; }

# ─── 1. Node.js 22+ ───────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  err "Node.js ${MIN_NODE_MAJOR}+ is required but was not found."
  err "Install it from https://nodejs.org (or via nvm/fnm) and re-run this command."
  exit 1
fi

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]; then
  err "Node.js ${MIN_NODE_MAJOR}+ is required (found $(node -v)). Update from https://nodejs.org and re-run."
  exit 1
fi

# ─── 2. npm (ships with Node) ─────────────────────────────────────────────────
if ! command -v npm >/dev/null 2>&1; then
  err "npm was not found — it ships with Node.js. Reinstall Node from https://nodejs.org."
  exit 1
fi

# ─── 3. Remove legacy globals that also provide the `pan` command ─────────────
# Overdeck was previously published under other names; leaving them installed
# makes `pan` resolve to the stale package on PATH. Best-effort, never fatal.
for legacy in @panctl/cli @overdeck/cli panopticon-cli; do
  if npm ls -g "$legacy" >/dev/null 2>&1; then
    info "Removing legacy global ${legacy} (it shadows the \`pan\` command)…"
    npm rm -g "$legacy" >/dev/null 2>&1 || true
  fi
done

# ─── 4. Install ───────────────────────────────────────────────────────────────
info "Installing ${PKG}…"
if ! npm install -g "${PKG}@latest"; then
  err "Global install failed. If this is a permissions error, try:"
  err "  sudo npm install -g ${PKG}@latest"
  exit 1
fi

# ─── 5. Verify and point the way ──────────────────────────────────────────────
if command -v overdeck >/dev/null 2>&1; then
  info "Installed $(overdeck --version 2>/dev/null || echo "${PKG}")."
  info "Start Command Deck:  overdeck up    (short alias: pan up)"
else
  err "Install finished, but 'overdeck' is not on your PATH."
  err "Add your npm global bin to PATH, then re-open your shell:"
  err "  export PATH=\"\$(npm prefix -g)/bin:\$PATH\""
  exit 1
fi
