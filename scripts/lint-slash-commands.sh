#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

CLI_ENTRY="dist/cli/index.js"
MANIFEST_FILE="packages/contracts/src/composer-commands.generated.ts"

if [[ ! -f "$CLI_ENTRY" ]]; then
  echo "dist/cli/index.js not found — run 'npm run build:cli' first" >&2
  exit 2
fi

tmp_manifest=$(mktemp)
trap 'rm -f "$tmp_manifest"' EXIT

node scripts/generate-slash-commands.mjs --manifest-out "$tmp_manifest" >/dev/null

if ! diff -u "$MANIFEST_FILE" "$tmp_manifest"; then
  echo "composer-command manifest has drifted from the CLI registry — run 'npm run generate:slash-commands' and commit the result" >&2
  exit 1
fi

echo "✓ composer-command manifest matches the CLI registry"
