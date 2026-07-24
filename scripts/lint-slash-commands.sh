#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

CLI_ENTRY="dist/cli/index.js"
GENERATED_FILE="src/dashboard/frontend/src/components/chat/slashCommands.generated.ts"

if [[ ! -f "$CLI_ENTRY" ]]; then
  echo "dist/cli/index.js not found — run 'npm run build:cli' first" >&2
  exit 2
fi

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

node scripts/generate-slash-commands.mjs --out "$tmp" >/dev/null
if ! diff -u "$GENERATED_FILE" "$tmp"; then
  echo "slash-command autocomplete has drifted from the CLI registry — run 'npm run generate:slash-commands' and commit the result" >&2
  exit 1
fi

echo "✓ slash-command autocomplete matches the CLI registry"
