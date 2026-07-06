#!/usr/bin/env bash
#
# lint-quarantine-audit.sh — require tracker-issue references for quarantine entries.
# Removing entries is always free; an absent or empty quarantine file is OK.
# Adding an entry must include an issue reference matching ([A-Z]+-[0-9]+|#[0-9]+).
#
set -euo pipefail
cd "$(dirname "$0")/.."

QUARANTINE="scripts/flaky-quarantine.txt"
ISSUE_REF_RE='([A-Z]+-[0-9]+|#[0-9]+)'

if [[ ! -s "$QUARANTINE" ]]; then
  echo "✓ quarantine audit passed (no quarantine file or file is empty)"
  exit 0
fi

offending=()
valid=0

while IFS= read -r line || [[ -n "$line" ]]; do
  # Skip empty lines and comment lines.
  [[ -z "${line// /}" ]] && continue
  [[ "$line" =~ ^[[:space:]]*# ]] && continue

  if [[ ! "$line" =~ $ISSUE_REF_RE ]]; then
    offending+=("$line")
  else
    ((valid++)) || true
  fi
done < "$QUARANTINE"

if [[ ${#offending[@]} -gt 0 ]]; then
  echo "✖ quarantine audit: the following entries lack an issue reference" >&2
  for bad in "${offending[@]}"; do
    echo "  $bad" >&2
  done
  echo "Each quarantine entry must reference an issue — add e.g. # PAN-XXXX." >&2
  exit 1
fi

echo "✓ quarantine audit passed ($valid entries validated)"
