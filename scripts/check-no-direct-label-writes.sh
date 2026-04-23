#!/usr/bin/env bash
# check-no-direct-label-writes.sh — Prevent direct `gh issue edit` label writes outside the reconciler.
#
# PAN-805: All workflow label mutations must go through the reconciler service.
# This script fails the build if any direct label writes are found outside:
#   - src/lib/lifecycle/reconciler/  (the reconciler itself)
#   - Lines annotated with PAN-805-exempt
#   - Test files

set -euo pipefail

SEARCH_DIR="${1:-src/}"

echo "Checking for direct label writes outside reconciler in ${SEARCH_DIR}..."

# Search for gh issue edit with label flags
matches=$(grep -rn \
  --include='*.ts' \
  --include='*.js' \
  --include='*.tsx' \
  --include='*.jsx' \
  'gh issue edit.*--\(add-label\|remove-label\|label\)' \
  "${SEARCH_DIR}" \
  || true)

# Apply exclusions
filtered=""
while IFS= read -r line; do
  [ -z "$line" ] && continue

  # Exclude reconciler directory
  if echo "$line" | grep -q 'src/lib/lifecycle/reconciler/'; then
    continue
  fi

  # Exclude test files
  if echo "$line" | grep -q '\.test\.\(ts\|js\)'; then
    continue
  fi

  # Exclude lines with PAN-805-exempt annotation
  if echo "$line" | grep -q 'PAN-805-exempt'; then
    continue
  fi

  filtered="${filtered}${line}"$'\n'
done <<< "$matches"

if [ -n "$filtered" ]; then
  echo "ERROR: Direct label writes found outside reconciler. Move them to the reconciler or annotate with PAN-805-exempt."
  echo "$filtered"
  exit 1
fi

echo "OK: No direct label write violations found."
