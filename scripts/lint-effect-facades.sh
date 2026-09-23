#!/usr/bin/env bash
#
# lint-effect-facades.sh — shrink-only Effect façade ratchet (PAN-3958).
#
# scripts/audit-effect-boundary.mjs --baseline prints one "<shape> <count> <path>"
# row per src/lib module and shape:
#   A  Promise façade (Effect.promise/tryPromise around an in-repo function)
#   B  sync façade (Effect.sync/try around an in-repo function)
#   C  sync/async twin pair (exported foo + fooSync, two implementations)
# This guard fails when any row's count exceeds its baseline row in
# scripts/effect-facades-baseline.txt, or a row appears that the baseline lacks.
# Lower counts pass. See docs/EFFECT-BRIDGING.md "In-repo code: no façades".
#
#   bash scripts/lint-effect-facades.sh            check
#   bash scripts/lint-effect-facades.sh --update   lower the baseline to the current
#                                                  counts; never raises a row, never
#                                                  adds one; initializes a missing file
#
# Raising a row (for example after a module rename) is a hand edit of the
# baseline in a commit that carries an issue reference; scripts/lint-ratchet-audit.sh
# enforces that.
#
set -euo pipefail
export LC_ALL=C
cd "$(dirname "$0")/.."

MODE=check
if [[ "${1:-}" == "--update" && $# -eq 1 ]]; then
  MODE=update
elif [[ $# -gt 0 ]]; then
  echo "usage: bash scripts/lint-effect-facades.sh [--update]" >&2
  exit 2
fi

BASELINE_FILE="scripts/effect-facades-baseline.txt"
HEADER_1="# Effect façade ratchet baseline (PAN-3958). Rows: <shape> <count> <path>. Shapes: A=Promise façade,"
HEADER_2="# B=sync façade, C=sync/async twin pair. Lower with: bash scripts/lint-effect-facades.sh --update"

current=$(node scripts/audit-effect-boundary.mjs --baseline)
current=$(printf '%s\n' "$current" | sed -E '/^[[:space:]]*$/d' | sort)

baseline_rows() { sed -E '/^[[:space:]]*(#|$)/d' "$BASELINE_FILE" | sort; }

totals() {
  awk '{ t[$1] += $2 } END { printf "A %d, B %d, C %d", t["A"], t["B"], t["C"] }'
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
    echo "✖ missing $BASELINE_FILE — initialize it with: bash scripts/lint-effect-facades.sh --update" >&2
    exit 1
  fi
  write_baseline "$current"
  echo "✓ Effect façade baseline initialized ($(printf '%s\n' "$current" | totals))"
  exit 0
fi

base=$(baseline_rows)

if [[ "$MODE" == "update" ]]; then
  # Per <shape> <path>: min(baseline, current); rows whose current count is 0
  # are dropped; rows absent from the baseline are never added.
  lowered=$(awk '
    NR == FNR { if (NF >= 3) cur[$1 " " $3] = $2; next }
    NF >= 3 {
      key = $1 " " $3
      if (!(key in cur)) next
      n = (cur[key] < $2) ? cur[key] : $2
      print $1 " " n " " $3
    }
  ' <(printf '%s\n' "$current") <(printf '%s\n' "$base") | sort)
  before=$(printf '%s\n' "$base" | totals)
  write_baseline "$lowered"
  echo "✓ Effect façade baseline updated: $before → $(printf '%s\n' "$lowered" | totals)"
  exit 0
fi

report=$(awk '
  NR == FNR { if (NF >= 3) known[$1 " " $3] = $2; next }
  NF >= 3 {
    key = $1 " " $3
    if (!(key in known)) print "NEW: " $0 " (baseline 0)"
    else if ($2 + 0 > known[key] + 0) print "NEW: " $0 " (baseline " known[key] ")"
  }
' <(printf '%s\n' "$base") <(printf '%s\n' "$current"))

if [[ -n "$report" ]]; then
  echo "✖ Effect façade ratchet: a module gained a façade or a sync/async twin." >&2
  printf '%s\n' "$report" >&2
  echo "  Call the underlying function directly instead of adding an Effect wrapper or a" >&2
  echo "  second variant; bridge at an Effect call site (docs/EFFECT-BRIDGING.md, 'In-repo code: no façades')." >&2
  echo "  Detail: node scripts/audit-effect-boundary.mjs --json" >&2
  exit 1
fi

stale=$(awk '
  NR == FNR { if (NF >= 3) cur[$1 " " $3] = $2; next }
  NF >= 3 { key = $1 " " $3; if ((cur[key] + 0) < ($2 + 0)) n++ }
  END { print n + 0 }
' <(printf '%s\n' "$current") <(printf '%s\n' "$base"))

echo "✓ Effect façade ratchet passed ($(printf '%s\n' "$current" | totals); none new)"
if (( stale > 0 )); then
  echo "  $stale baseline row(s) are above the current count — lower them with: bash scripts/lint-effect-facades.sh --update"
fi
