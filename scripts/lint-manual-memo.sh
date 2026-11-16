#!/usr/bin/env bash
#
# lint-manual-memo.sh — shrink-only manual-memo ratchet for the dashboard
# frontend (PAN-4561).
#
# The React Compiler memoizes compiled components and hooks, so new code does
# not hand-write useMemo, useCallback or memo(). This guard counts, per
# frontend source file under src/dashboard/frontend/src, the call sites of
# useMemo( / useCallback( / memo( (with or without a `React.` prefix or a type
# argument, e.g. `useCallback<T>(`, `memo<Props>(`). Comment lines, tests,
# test utilities and .d.ts files are not counted. It fails when a file's count
# exceeds its row in scripts/manual-memo-baseline.txt, or a file with a call
# site has no row. Lower counts pass. Remove a file's manual memo only after
# the file has no row in scripts/react-compiler-skip-baseline.txt — see
# docs/DASHBOARD-ARCHITECTURE.md, React Compiler.
#
#   bash scripts/lint-manual-memo.sh            check
#   bash scripts/lint-manual-memo.sh --update   lower the baseline to the current
#                                               counts; never raises a row, never
#                                               adds one; initializes a missing file
#
# Raising a row is a hand edit of the baseline in a commit that carries an
# issue reference; scripts/lint-ratchet-audit.sh enforces that.
#
set -euo pipefail
export LC_ALL=C
cd "$(dirname "$0")/.."

MODE=check
if [[ "${1:-}" == "--update" && $# -eq 1 ]]; then
  MODE=update
elif [[ $# -gt 0 ]]; then
  echo "usage: bash scripts/lint-manual-memo.sh [--update]" >&2
  exit 2
fi

BASELINE_FILE="scripts/manual-memo-baseline.txt"
HEADER_1="# Manual memo ratchet baseline (PAN-4561). Rows: <count> <path>."
HEADER_2="# Lower with: bash scripts/lint-manual-memo.sh --update"
SCAN_ROOT="src/dashboard/frontend/src"

# The character before the name must not be an identifier character or `.`,
# so `x.useMemo(`, `x.memo(` and `memoize(` do not match;
# `React.useMemo(` and `React.memo(` match through the `React\.` prefix.
P1='(^|[^A-Za-z0-9_$.])(React\.)?(useMemo|useCallback)[[:space:]]*[(<]'
P2='(^|[^A-Za-z0-9_$.])(React\.)?memo[[:space:]]*[(<]'

scan_files() {
  if [[ ! -d "$SCAN_ROOT" ]]; then return 0; fi
  find "$SCAN_ROOT" -type f \( -name '*.ts' -o -name '*.tsx' \) \
    ! -name '*.d.ts' ! -name '*.test.*' ! -name '*.spec.*' \
    ! -path '*/__tests__/*' ! -path '*/test-utils/*' \
    -print0
}

# One "<count> <path>" row per file with at least one call site, sorted by path.
current_counts() {
  local -A counts=()
  local line file content n
  while IFS= read -r line; do
    file=${line%%:*}
    content=${line#*:}
    if [[ "$content" =~ ^[[:space:]]*(//|\*|/\*) ]]; then continue; fi
    n=$(grep -oE -e "$P1" -e "$P2" <<< "$content" | wc -l)
    counts[$file]=$(( ${counts[$file]:-0} + n ))
  done < <(scan_files | xargs -0 -r grep -HE -e "$P1" -e "$P2" -- || true)
  for file in "${!counts[@]}"; do
    if (( counts[$file] > 0 )); then echo "${counts[$file]} $file"; fi
  done | sort -k2
}

current=$(current_counts)

baseline_rows() { sed -E '/^[[:space:]]*(#|$)/d' "$BASELINE_FILE" | sort -k2; }

totals() {
  awk 'NF >= 2 { t += $1; f++ } END { printf "%d in %d files", t, f }'
}

write_baseline() {
  {
    echo "$HEADER_1"
    echo "$HEADER_2"
    if [[ -n "$1" ]]; then printf '%s\n' "$1"; fi
  } > "$BASELINE_FILE"
}

if [[ ! -f "$BASELINE_FILE" ]]; then
  if [[ "$MODE" != "update" ]]; then
    echo "✖ missing $BASELINE_FILE — initialize it with: bash scripts/lint-manual-memo.sh --update" >&2
    exit 1
  fi
  write_baseline "$current"
  echo "✓ manual-memo baseline initialized ($(printf '%s\n' "$current" | totals))"
  exit 0
fi

base=$(baseline_rows)

if [[ "$MODE" == "update" ]]; then
  # Per path: min(baseline, current); rows whose current count is 0 are
  # dropped; paths absent from the baseline are never added.
  lowered=$(awk '
    NR == FNR { if (NF >= 2) cur[$2] = $1; next }
    NF >= 2 {
      if (!($2 in cur)) next
      n = (cur[$2] + 0 < $1 + 0) ? cur[$2] : $1
      if (n + 0 > 0) print n " " $2
    }
  ' <(printf '%s\n' "$current") <(printf '%s\n' "$base") | sort -k2)
  before=$(printf '%s\n' "$base" | totals)
  write_baseline "$lowered"
  echo "✓ manual-memo baseline updated: $before → $(printf '%s\n' "$lowered" | totals)"
  exit 0
fi

report=$(awk '
  NR == FNR { if (NF >= 2) known[$2] = $1; next }
  NF >= 2 {
    if (!($2 in known) || $1 + 0 > known[$2] + 0) {
      print "✖ New useMemo/useCallback/memo in " $2 " (" $1 " call sites, baseline " (($2 in known) ? known[$2] : "none") "). The React Compiler memoizes compiled components; see docs/DASHBOARD-ARCHITECTURE.md, React Compiler."
    }
  }
' <(printf '%s\n' "$base") <(printf '%s\n' "$current"))

if [[ -n "$report" ]]; then
  printf '%s\n' "$report" >&2
  exit 1
fi

stale=$(awk '
  NR == FNR { if (NF >= 2) cur[$2] = $1; next }
  NF >= 2 { if ((cur[$2] + 0) < ($1 + 0)) n++ }
  END { print n + 0 }
' <(printf '%s\n' "$current") <(printf '%s\n' "$base"))

echo "✓ manual-memo ratchet passed ($(printf '%s\n' "$current" | totals); none new)"
if (( stale > 0 )); then
  echo "  $stale baseline row(s) are above the current count — lower them with: bash scripts/lint-manual-memo.sh --update"
fi
