#!/usr/bin/env bash
#
# lint-file-size.sh — ceiling guard against god files (A3, codebase health).
# No NEW non-test src file may exceed CEILING lines; a BASELINED file may shrink
# but never grow. Baseline is scripts/file-size-baseline.txt ("<lines> <path>").
# Check mode fails on stale baseline entries; run with --update to lower stale
# entries and drop files that are missing or now at/below the ceiling (D3).
# --update never raises or adds entries: accepting growth remains a manual,
# audited edit with an issue reference (D4).
#
set -euo pipefail

MODE=check
if [[ "${1:-}" == "--update" ]]; then
  MODE=update
elif [[ $# -gt 0 ]]; then
  echo "usage: bash scripts/lint-file-size.sh [--update]" >&2
  exit 2
fi

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

if [[ "$MODE" == "update" ]]; then
  tmp=$(mktemp)
  lowered=0
  dropped=0
  unchanged=0

  while read -r allowed path; do
    [[ -z "${path:-}" ]] && continue

    if [[ ! -f "$path" ]]; then
      (( ++dropped ))
      continue
    fi

    n=$(wc -l < "$path")
    if (( n <= CEILING )); then
      (( ++dropped ))
    elif (( n < allowed )); then
      printf '%s %s\n' "$n" "$path" >> "$tmp"
      (( ++lowered ))
    else
      printf '%s %s\n' "$allowed" "$path" >> "$tmp"
      (( ++unchanged ))
    fi
  done < "$BASELINE"

  sort -k2 "$tmp" > "$BASELINE"
  rm -f "$tmp"
  echo "✓ baseline updated: $lowered lowered, $dropped dropped, $unchanged unchanged"
  exit 0
fi

fail=0
stale=0
while IFS= read -r f; do
  n=$(wc -l < "$f")
  allowed="${base["$f"]:-}"
  if [[ -n "$allowed" ]]; then
    if (( n > allowed )); then
      echo "✖ $f grew to $n lines (baseline $allowed) — god files must shrink, not grow."
      fail=1
    elif (( n < allowed )); then
      echo "✖ stale baseline: $f is $n lines but baselined at $allowed — run: bash scripts/lint-file-size.sh --update"
      stale=1
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

while read -r allowed path; do
  [[ -z "${path:-}" ]] && continue

  if [[ ! -f "$path" ]]; then
    echo "✖ stale baseline: $path no longer exists — run: bash scripts/lint-file-size.sh --update"
    stale=1
    continue
  fi

  n=$(wc -l < "$path")
  if (( n <= CEILING )); then
    echo "✖ stale baseline: $path is $n lines at or under the $CEILING-line ceiling — run: bash scripts/lint-file-size.sh --update"
    stale=1
  fi
done < "$BASELINE"

if (( fail || stale )); then
  echo ""
  if (( fail )); then
    echo "file-size guard failed. Shrink the file, or manually edit the baseline in an issue-referenced commit to accept audited growth."
  fi
  if (( stale )); then
    echo "file-size guard found stale baseline entries. Update the baseline:"
    echo "  bash scripts/lint-file-size.sh --update"
  fi
  exit 1
fi

echo "✓ file-size guard passed (no new god files; no baselined file grew)"
