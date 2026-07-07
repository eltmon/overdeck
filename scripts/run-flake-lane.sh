#!/usr/bin/env bash
#
# run-flake-lane.sh — run quarantined tests in a non-blocking lane and emit a
# GitHub Actions job summary. Quarantined tests are run individually so each
# file's pass/fail result can be recorded in the ledger.
#
set -euo pipefail
cd "$(dirname "$0")/.."

QUARANTINE="scripts/flaky-quarantine.txt"
SUMMARY_FILE="${GITHUB_STEP_SUMMARY:-/dev/stdout}"

if [[ ! -s "$QUARANTINE" ]]; then
  {
    echo "## 🧪 Flake Lane Summary"
    echo ""
    echo "*No tests are currently quarantined.*"
  } >> "$SUMMARY_FILE"
  exit 0
fi

{
  echo "## 🧪 Flake Lane Summary"
  echo ""
  echo "Quarantined tests run individually with retry enabled. Failures here are"
  echo "non-blocking and must be tracked back to their issue refs."
  echo ""
  echo "| Test file | Tracking issue | Result |"
  echo "|-----------|----------------|--------|"
} >> "$SUMMARY_FILE"

overall=0

while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "${line// /}" ]] && continue
  [[ "$line" =~ ^[[:space:]]*# ]] && continue

  path="${line%%#*}"
  path="$(printf '%s' "$path" | sed 's/[[:space:]]*$//')"
  ref="${line#*#}"
  ref="$(echo "$ref" | sed 's/^[[:space:]]*//')"

  result="PASS"
  # Non-blocking per-file: a failure sets the result to FAIL but continues.
  if ! OVERDECK_FLAKE_LANE=1 npx vitest run "$path" --configLoader runner 2>&1 | tee /tmp/flake-lane-last.log; then
    result="FAIL"
    overall=1
  fi

  printf '| `%s` | %s | %s |\n' "$path" "$ref" "$result" >> "$SUMMARY_FILE"
done < "$QUARANTINE"

exit "$overall"
