#!/usr/bin/env bash
#
# lint-dashboard-types.sh — typecheck guard for the dashboard server (PAN-2765).
#
# The root tsconfig excludes src/dashboard/**, so the dashboard server was never
# typechecked at all. That is not theoretical: `agent-enrichment-service.ts` read
# `enrichment.pendingProposedPlan`, a property that did not exist on
# AgentEnrichment, in three places — so every plan payload was `undefined` and no
# plan ever reached the store from the agent path. Nothing caught it because
# nothing looked.
#
# The server carries a real backlog of pre-existing errors, so this is a RATCHET,
# not a gate: the count may shrink but never grow. That closes the hole today —
# no new error can be added — and the baseline drives the backlog to zero over
# time. Same contract as lint-file-size.sh.
#
# Baseline is scripts/dashboard-types-baseline.txt (a single integer).
# Run with --update to lower a stale baseline after fixing errors.
# --update never raises: accepting growth would defeat the ratchet.
#
set -euo pipefail

MODE=check
if [[ "${1:-}" == "--update" ]]; then
  MODE=update
elif [[ $# -gt 0 ]]; then
  echo "usage: bash scripts/lint-dashboard-types.sh [--update]" >&2
  exit 2
fi

BASELINE_FILE="scripts/dashboard-types-baseline.txt"
TSCONFIG="src/dashboard/server/tsconfig.json"

if [[ ! -f "$BASELINE_FILE" ]]; then
  echo "✖ missing $BASELINE_FILE" >&2
  exit 1
fi

baseline=$(tr -d '[:space:]' < "$BASELINE_FILE")

# Local-install-only: `npx tsc` falls back to the npm registry's unscoped
# `tsc` package when node_modules is stale (PAN-3605).
TSC_BIN="node_modules/.bin/tsc"
if [[ ! -x "$TSC_BIN" ]]; then
  echo "✖ missing $TSC_BIN — run 'bun install' first (never falling back to the npm registry)." >&2
  exit 1
fi

# tsc exits non-zero when it reports errors; count them rather than trust status.
output=$("$TSC_BIN" --noEmit -p "$TSCONFIG" 2>&1 || true)
count=$(printf '%s\n' "$output" | grep -cE 'error TS' || true)

if [[ "$MODE" == "update" ]]; then
  if (( count > baseline )); then
    echo "✖ refusing to raise the baseline: $count errors vs baseline $baseline." >&2
    echo "  Fix the new errors — the ratchet only lowers." >&2
    exit 1
  fi
  printf '%s\n' "$count" > "$BASELINE_FILE"
  echo "✓ dashboard-types baseline updated: $baseline → $count"
  exit 0
fi

if (( count > baseline )); then
  echo "✖ dashboard server typecheck regressed: $count errors (baseline $baseline)." >&2
  echo "  New type errors in src/dashboard/server. Offending lines:" >&2
  printf '%s\n' "$output" | grep -E 'error TS' | head -20 >&2
  echo "  Reproduce: node_modules/.bin/tsc --noEmit -p $TSCONFIG" >&2
  exit 1
fi

if (( count < baseline )); then
  echo "✖ stale baseline: $count errors but baselined at $baseline — run: bash scripts/lint-dashboard-types.sh --update" >&2
  exit 1
fi

echo "✓ dashboard-types guard passed ($count known errors; none new)"
