#!/usr/bin/env bash
#
# lint-file-size.sh — ceiling guard against god files (A3, codebase health).
# No NEW non-test src file may exceed CEILING lines; a BASELINED file may shrink
# but never grow. Baseline is scripts/file-size-baseline.txt ("<lines> <path>").
# Regenerate the baseline only to intentionally accept a change (see REGEN below).
#
set -euo pipefail
cd "$(dirname "$0")/.."

CEILING=1000
BASELINE="scripts/file-size-baseline.txt"

if [[ ! -f "$BASELINE" ]]; then
  echo "✖ missing $BASELINE — run the REGEN command in this script's header." >&2
  exit 1
fi

declare -A base
while read -r lines path; do
  [[ -z "${path:-}" ]] && continue
  base["$path"]=$lines
done < "$BASELINE"

fail=0
while IFS= read -r f; do
  n=$(wc -l < "$f")
  allowed="${base["$f"]:-}"
  if [[ -n "$allowed" ]]; then
    if (( n > allowed )); then
      echo "✖ $f grew to $n lines (baseline $allowed) — god files must shrink, not grow."
      fail=1
    fi
  elif (( n > CEILING )); then
    echo "✖ $f is $n lines (> $CEILING) — new files must stay under the ceiling."
    fail=1
  fi
done < <(
  find src -type f \( -name '*.ts' -o -name '*.tsx' \) \
    ! -name '*.test.ts' ! -name '*.test.tsx' ! -name '*.d.ts' \
    ! -path '*/__tests__/*' ! -path '*/node_modules/*' ! -path '*/dist/*' \
    | sort
)

if (( fail )); then
  echo ""
  echo "file-size guard failed. Shrink the file, or (to intentionally accept it) regenerate the baseline:"
  echo "  REGEN: see scripts/lint-file-size.sh header / the A3 PRD"
  exit 1
fi
echo "✓ file-size guard passed (no new god files; no baselined file grew)"
