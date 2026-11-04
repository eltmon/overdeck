#!/usr/bin/env bash
# Overdeck MCP server for Grok Build (PAN-4927 W-INT3, PAN-4955).
# Serves MCP on stdio by exec'ing, in order: the paired Overdeck connector
# (a pan that has `mcp connector`, else npx with the pinned @overdeck/core),
# then `pan mcp serve`. It never writes to stdout: stdout is the server's
# JSON-RPC. See README.md.
set -euo pipefail

OVERDECK_CORE_VERSION="${OVERDECK_CORE_VERSION:-0.74.0}"
connector_home="${OVERDECK_CONNECTOR_HOME:-$HOME/.overdeck-connector}"

pan_has_connector() {
  command -v pan >/dev/null 2>&1 || return 1
  local help
  help="$(pan mcp --help 2>/dev/null)" || return 1
  grep -Eq '^[[:space:]]+connector[[:space:]]' <<<"$help"
}

if [ -f "$connector_home/pairing.json" ]; then
  if pan_has_connector; then
    exec pan mcp connector serve --stdio
  fi
  if command -v npx >/dev/null 2>&1; then
    exec npx -y "@overdeck/core@${OVERDECK_CORE_VERSION}" mcp connector serve --stdio
  fi
  echo "overdeck: a connector is paired in $connector_home, but neither pan nor npx is on PATH. Install Node 22.16 or later." >&2
  exit 1
fi

if command -v pan >/dev/null 2>&1; then
  default_token_file="$HOME/.overdeck/grok-build-mcp-token"
  if [ -z "${OVERDECK_MCP_TOKEN:-}" ] && [ -z "${OVERDECK_MCP_TOKEN_FILE:-}" ] && [ -f "$default_token_file" ]; then
    export OVERDECK_MCP_TOKEN_FILE="$default_token_file"
  fi
  exec pan mcp serve
fi

echo "Install Overdeck (npm i -g @overdeck/core) or pair a connector" >&2
exit 1
