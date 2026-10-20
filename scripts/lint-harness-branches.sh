#!/usr/bin/env bash
#
# lint-harness-branches.sh — shrink-only harness-name branch ratchet (PAN-4562).
#
# Counts, per src/ file, the comparisons of a harness name or transcript kind
# against a string literal (`harness === 'codex'`, `'acp' !== conv.harness`,
# `transcriptKind === 'claude-jsonl'`). Comment lines are not counted. This
# guard fails when a file's count exceeds its row in
# scripts/harness-branches-baseline.txt, or a file with a match has no row.
# Lower counts pass. Behavior belongs in HarnessCapabilities — see
# configuration/harnesses.mdx "Harness capabilities".
#
#   bash scripts/lint-harness-branches.sh            check
#   bash scripts/lint-harness-branches.sh --update   lower the baseline to the current
#                                                    counts; never raises a row, never
#                                                    adds one; initializes a missing file
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
  echo "usage: bash scripts/lint-harness-branches.sh [--update]" >&2
  exit 2
fi

BASELINE_FILE="scripts/harness-branches-baseline.txt"
HEADER_1="# Harness-name branch ratchet baseline (PAN-4562). Rows: <count> <path>."
HEADER_2="# Lower with: bash scripts/lint-harness-branches.sh --update"

N='claude-code|claude|ohmypi|pi|codex|acp|kimi-code|opencode|muse|prime-agent|[a-z-]+-jsonl'
P1="[A-Za-z0-9_\$.]*([Hh]arness|transcriptKind)[[:space:]]*[!=]==[[:space:]]*['\"]($N)['\"]"
P2="['\"]($N)['\"][[:space:]]*[!=]==[[:space:]]*[A-Za-z0-9_\$.]*([Hh]arness|transcriptKind)"

# Runtime definitions, the ToS policy table and harness storage key on names on purpose.
scan_files() {
  find src -type f \( -name '*.ts' -o -name '*.tsx' \) \
    ! -name '*.test.ts' ! -name '*.test.tsx' ! -path '*/__tests__/*' \
    ! -path 'src/lib/harness-policy.ts' \
    ! -path 'src/lib/runtimes/storage/*' \
    ! -path 'src/lib/runtimes/acp.ts' ! -path 'src/lib/runtimes/claude-code.ts' \
    ! -path 'src/lib/runtimes/codex.ts' ! -path 'src/lib/runtimes/kimi-code.ts' \
    ! -path 'src/lib/runtimes/muse.ts' ! -path 'src/lib/runtimes/ohmypi.ts' \
    ! -path 'src/lib/runtimes/pi.ts' ! -path 'src/lib/runtimes/prime-agent.ts' \
    -print0
}

# One "<count> <path>" row per file with at least one match, sorted by path.
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
    echo "${counts[$file]} $file"
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
    echo "✖ missing $BASELINE_FILE — initialize it with: bash scripts/lint-harness-branches.sh --update" >&2
    exit 1
  fi
  write_baseline "$current"
  echo "✓ harness-branch baseline initialized ($(printf '%s\n' "$current" | totals))"
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
  echo "✓ harness-branch baseline updated: $before → $(printf '%s\n' "$lowered" | totals)"
  exit 0
fi

report=$(awk '
  NR == FNR { if (NF >= 2) known[$2] = $1; next }
  NF >= 2 {
    if (!($2 in known)) print "✖ " $2 ": NEW file with " $1 " harness-name branches"
    else if ($1 + 0 > known[$2] + 0) print "✖ " $2 ": " $1 " harness-name branches (baseline " known[$2] ")"
  }
' <(printf '%s\n' "$base") <(printf '%s\n' "$current"))

if [[ -n "$report" ]]; then
  printf '%s\n' "$report" >&2
  echo "Replace the branch with a HarnessCapabilities field — see configuration/harnesses.mdx \"Harness capabilities\"." >&2
  exit 1
fi

stale=$(awk '
  NR == FNR { if (NF >= 2) cur[$2] = $1; next }
  NF >= 2 { if ((cur[$2] + 0) < ($1 + 0)) n++ }
  END { print n + 0 }
' <(printf '%s\n' "$current") <(printf '%s\n' "$base"))

echo "✓ harness-branch ratchet passed ($(printf '%s\n' "$current" | totals); none new)"
if (( stale > 0 )); then
  echo "  $stale baseline row(s) are above the current count — lower them with: bash scripts/lint-harness-branches.sh --update"
fi
