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
JQ_VERSION=1.8.1
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

# ─── 3. Install jq into the user-owned prefix ─────────────────────────────────
if ! command -v jq >/dev/null 2>&1; then
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64|Linux-amd64)
      JQ_ASSET=jq-linux-amd64
      JQ_SHA256=020468de7539ce70ef1bceaf7cde2e8c4f2ca6c3afb84642aabc5c97d9fc2a0d
      ;;
    Linux-aarch64|Linux-arm64)
      JQ_ASSET=jq-linux-arm64
      JQ_SHA256=6bc62f25981328edd3cfcfe6fe51b073f2d7e7710d7ef7fcdac28d4e384fc3d4
      ;;
    Darwin-x86_64|Darwin-amd64)
      JQ_ASSET=jq-macos-amd64
      JQ_SHA256=e80dbe0d2a2597e3c11c404f03337b981d74b4a8504b70586c354b7697a7c27f
      ;;
    Darwin-arm64|Darwin-aarch64)
      JQ_ASSET=jq-macos-arm64
      JQ_SHA256=a9fe3ea2f86dfc72f6728417521ec9067b343277152b114f4e98d8cb0e263603
      ;;
    *)
      err "jq is required, but no user-local binary is available for $(uname -s) $(uname -m)."
      err "Install jq from https://jqlang.org/download and re-run this command."
      exit 1
      ;;
  esac

  if ! command -v curl >/dev/null 2>&1; then
    err "curl is required to download jq."
    exit 1
  fi

  JQ_TMP=$(mktemp "${TMPDIR:-/tmp}/overdeck-jq.XXXXXX")
  JQ_URL="https://github.com/jqlang/jq/releases/download/jq-${JQ_VERSION}/${JQ_ASSET}"
  info "Installing jq ${JQ_VERSION} into ${BIN_DIR}…"
  if ! curl -fsSL "$JQ_URL" -o "$JQ_TMP"; then
    rm -f "$JQ_TMP"
    err "Could not download jq from ${JQ_URL}."
    exit 1
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    JQ_ACTUAL_SHA256=$(sha256sum "$JQ_TMP" | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then
    JQ_ACTUAL_SHA256=$(shasum -a 256 "$JQ_TMP" | awk '{print $1}')
  else
    rm -f "$JQ_TMP"
    err "A SHA-256 tool (sha256sum or shasum) is required to verify jq."
    exit 1
  fi
  if [ "$JQ_ACTUAL_SHA256" != "$JQ_SHA256" ]; then
    rm -f "$JQ_TMP"
    err "jq checksum verification failed; refusing to install it."
    exit 1
  fi

  chmod 755 "$JQ_TMP"
  mv "$JQ_TMP" "$BIN_DIR/jq"
fi

# ─── 4. Remove legacy user-local globals that also provide `pan` ──────────────
# Overdeck was previously published under other names; leaving them installed
# makes `pan` resolve to the stale package on PATH. Best-effort, never fatal.
for legacy in @panctl/cli @overdeck/cli panopticon-cli; do
  if NPM_CONFIG_PREFIX="$INSTALL_PREFIX" npm ls -g "$legacy" >/dev/null 2>&1; then
    info "Removing legacy global ${legacy} (it shadows the \`pan\` command)…"
    NPM_CONFIG_PREFIX="$INSTALL_PREFIX" npm rm -g "$legacy" >/dev/null 2>&1 || true
  fi
done

# ─── 5. Install ───────────────────────────────────────────────────────────────
info "Installing ${PKG}…"
if ! NPM_CONFIG_PREFIX="$INSTALL_PREFIX" npm install -g "${PKG}@latest"; then
  err "Install failed. Overdeck did not write to any system directory."
  exit 1
fi

# ─── 6. Verify and point the way ──────────────────────────────────────────────
if command -v overdeck >/dev/null 2>&1; then
  info "Installed $(overdeck --version 2>/dev/null || echo "${PKG}")."
  info "Start Command Deck:  overdeck up    (short alias: pan up)"
else
  err "Install finished, but 'overdeck' is not on your PATH."
  err "Open a new terminal and try again."
  exit 1
fi
