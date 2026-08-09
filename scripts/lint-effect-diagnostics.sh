#!/usr/bin/env bash
#
# lint-effect-diagnostics.sh — Effect diagnostics ratchet (PAN-3568).
#
# The diagnostic tsconfigs load @effect/language-service while the real project
# tsconfigs deliberately remain plugin-free, preserving existing typecheck gates.
# Plugin findings render as:
# file(line,col): <category> TS<ruleCode>: <message>    effect(<ruleName>)
# The four spaces before the trailing marker are part of the pinned format.
#
# The baseline is scripts/effect-diagnostics-baseline.txt: '#' header lines plus
# one sorted finding per row. Run with --update after fixing findings to lower a
# stale baseline; --update never raises it.
#
set -euo pipefail

MODE=check
if [[ "${1:-}" == "--update" ]]; then
  MODE=update
elif [[ $# -gt 0 ]]; then
  echo "usage: bash scripts/lint-effect-diagnostics.sh [--update]" >&2
  exit 2
fi

BASELINE_FILE="scripts/effect-diagnostics-baseline.txt"
# A finding must end with this marker. Do not classify diagnostics by severity or code.
MARKER_REGEX='    effect\([A-Za-z]+\)$'
TYPE_DIAGNOSTIC_REGEX='^[^(]+\([0-9]+,[0-9]+\): (error|warning|message) TS[0-9]+: '
LANES=(
  "root:tsconfig.effect-diag.json"
  "dashboard-server:src/dashboard/server/tsconfig.effect-diag.json"
  "contracts:packages/contracts/tsconfig.effect-diag.json"
  "effect-acp:packages/effect-acp/tsconfig.effect-diag.json"
)

initializing=false
if [[ ! -f "$BASELINE_FILE" ]]; then
  if [[ "$MODE" != "update" ]]; then
    echo "✖ missing $BASELINE_FILE" >&2
    exit 1
  fi
  initializing=true
  baseline_count=0
else
  baseline_count=$(grep -cvE '^[[:space:]]*(#|$)' "$BASELINE_FILE" || true)
fi

# Resolve tools from the local install ONLY. `npx <name>` falls back to the
# npm registry when the local bin is missing, and the unscoped
# `effect-language-service` name there is claimed by a third-party squatter
# (PAN-3605): a stale node_modules turned this line into downloading and
# executing unreviewed code. Fail loudly instead.
ELS_BIN="node_modules/.bin/effect-language-service"
TSC_BIN="node_modules/.bin/tsc"
for tool in "$ELS_BIN" "$TSC_BIN"; do
  if [[ ! -x "$tool" ]]; then
    echo "✖ missing $tool — run 'bun install' first (never falling back to the npm registry)." >&2
    exit 1
  fi
done

"$ELS_BIN" patch

all_output=""
for lane in "${LANES[@]}"; do
  label=${lane%%:*}
  tsconfig=${lane#*:}
  if output=$("$TSC_BIN" --noEmit -p "$tsconfig" 2>&1); then
    tsc_status=0
  else
    tsc_status=$?
  fi

  if (( tsc_status != 0 )) && ! grep -Eq "$TYPE_DIAGNOSTIC_REGEX" <<< "$output"; then
    echo "✖ Effect diagnostics lane '$label' failed (exit $tsc_status) without TypeScript diagnostics." >&2
    printf '%s\n' "$output" >&2
    echo "  Reproduce: node_modules/.bin/tsc --noEmit -p $tsconfig" >&2
    exit 1
  fi

  all_output+="$output"$'\n'
done

current=$(printf '%s\n' "$all_output" | grep -E "$MARKER_REGEX" | sort || true)
count=$(printf '%s\n' "$current" | grep -cE "$MARKER_REGEX" || true)

# Normalized comparison keys strip source positions, preventing a line shift from
# turning a pre-existing finding into a NEW finding during annotation.
norm() { grep -E "$MARKER_REGEX" | sed -E 's/^([^(:]+)\([0-9]+,[0-9]+\)/\1/' | sort -u; }

if [[ "$MODE" == "update" ]]; then
  if [[ "$initializing" != true ]] && (( count > baseline_count )); then
    echo "✖ refusing to raise the baseline: $count findings vs baseline $baseline_count." >&2
    echo "  Fix the new findings — the ratchet only lowers." >&2
    exit 1
  fi
  {
    echo "# Effect diagnostics baseline for lint-effect-diagnostics.sh (PAN-3568)."
    echo "# One finding ending in effect(<ruleName>) per row, sorted. Lower with: bash scripts/lint-effect-diagnostics.sh --update"
    printf '%s\n' "$current"
  } > "$BASELINE_FILE"
  echo "✓ Effect diagnostics baseline updated: $baseline_count → $count"
  exit 0
fi

if (( count > baseline_count )); then
  echo "✖ Effect diagnostics regressed: $count findings (baseline $baseline_count)." >&2
  echo "  Findings with no baseline match (yours to fix):" >&2
  comm -23 <(printf '%s\n' "$current" | norm) <(grep -E "$MARKER_REGEX" "$BASELINE_FILE" | norm || true) | sed 's/^/  NEW: /' >&2
  echo "  Baselined backlog (pre-existing — not yours):" >&2
  comm -12 <(printf '%s\n' "$current" | norm) <(grep -E "$MARKER_REGEX" "$BASELINE_FILE" | norm || true) | sed 's/^/  known: /' >&2
  echo "  Note: rewording a pre-existing finding can relabel it as NEW;" >&2
  echo "  the count delta ($((count - baseline_count))) bounds how many are truly new." >&2
  echo "  Reproduce each lane with: node_modules/.bin/tsc --noEmit -p <tsconfig.effect-diag.json>" >&2
  exit 1
fi

if (( count < baseline_count )); then
  echo "✖ stale baseline: $count findings but baselined at $baseline_count — run: bash scripts/lint-effect-diagnostics.sh --update" >&2
  exit 1
fi

echo "✓ Effect diagnostics guard passed ($count known findings; none new)"
