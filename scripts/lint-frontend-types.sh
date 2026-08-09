#!/usr/bin/env bash
#
# lint-frontend-types.sh — typecheck guard for the dashboard frontend (PAN-3192).
#
# The root tsconfig excludes src/dashboard/**, and lint-dashboard-types.sh covers
# only the server, so no mandated gate (typecheck/lint/test) ever typechecked
# the frontend. Frontend-only type errors were invisible locally and surfaced
# only in CI — PAN-3156 burned two flywheel runs on a one-line error its own
# gates could not see.
#
# Like the server guard this is a RATCHET, not a hard gate: the error count may
# shrink but never grow. The baseline also records the baselined error lines so
# a failure can name the NEW errors instead of dumping a mixed list the agent
# cannot triage — the second PAN-3156 defect.
#
# Baseline is scripts/frontend-types-baseline.txt: '#'-prefixed header lines
# plus one baselined `error TS` line per row, sorted. Count = non-comment lines.
# Run with --update to lower a stale baseline after fixing errors.
# --update never raises: accepting growth would defeat the ratchet.
#
set -euo pipefail

MODE=check
if [[ "${1:-}" == "--update" ]]; then
  MODE=update
elif [[ $# -gt 0 ]]; then
  echo "usage: bash scripts/lint-frontend-types.sh [--update]" >&2
  exit 2
fi

BASELINE_FILE="scripts/frontend-types-baseline.txt"
TSCONFIG="src/dashboard/frontend/tsconfig.json"

if [[ ! -f "$BASELINE_FILE" ]]; then
  echo "✖ missing $BASELINE_FILE" >&2
  exit 1
fi

baseline_count=$(grep -cvE '^[[:space:]]*(#|$)' "$BASELINE_FILE" || true)

# tsc exits non-zero when it reports type errors, but launcher failures and
# crashes can also exit non-zero without completing the typecheck. Preserve the
# status so only parseable TypeScript diagnostics enter the ratchet path.
# Local-install-only: `npx tsc` falls back to the npm registry's unscoped
# `tsc` package when node_modules is stale (PAN-3605).
TSC_BIN="node_modules/.bin/tsc"
if [[ ! -x "$TSC_BIN" ]]; then
  echo "✖ missing $TSC_BIN — run 'bun install' first (never falling back to the npm registry)." >&2
  exit 1
fi

if output=$("$TSC_BIN" --noEmit -p "$TSCONFIG" 2>&1); then
  tsc_status=0
else
  tsc_status=$?
fi
current=$(printf '%s\n' "$output" | grep -E 'error TS' | sort || true)
count=$(printf '%s\n' "$current" | grep -cE 'error TS' || true)

if (( tsc_status != 0 && count == 0 )); then
  echo "✖ dashboard frontend typecheck command failed (exit $tsc_status) without TypeScript diagnostics." >&2
  printf '%s\n' "$output" >&2
  echo "  Reproduce: node_modules/.bin/tsc --noEmit -p $TSCONFIG" >&2
  exit 1
fi

# Normalized comparison key: strip the (line,col) position so an edit that
# shifts a pre-existing error's line does not relabel it as NEW when annotating.
norm() { grep -E 'error TS' | sed -E 's/^([^(:]+)\([0-9]+,[0-9]+\)/\1/' | sort -u; }

if [[ "$MODE" == "update" ]]; then
  if (( count > baseline_count )); then
    echo "✖ refusing to raise the baseline: $count errors vs baseline $baseline_count." >&2
    echo "  Fix the new errors — the ratchet only lowers." >&2
    exit 1
  fi
  {
    echo "# frontend type-error baseline for lint-frontend-types.sh (PAN-3192)."
    echo "# One baselined 'error TS' line per row, sorted. Lower with: bash scripts/lint-frontend-types.sh --update"
    printf '%s\n' "$current"
  } > "$BASELINE_FILE"
  echo "✓ frontend-types baseline updated: $baseline_count → $count"
  exit 0
fi

if (( count > baseline_count )); then
  echo "✖ dashboard frontend typecheck regressed: $count errors (baseline $baseline_count)." >&2
  echo "  Errors with no baseline match (yours to fix):" >&2
  comm -23 <(printf '%s\n' "$current" | norm) <(grep -E 'error TS' "$BASELINE_FILE" | norm || true) | sed 's/^/  NEW: /' >&2
  echo "  Baselined backlog (pre-existing — not yours):" >&2
  comm -12 <(printf '%s\n' "$current" | norm) <(grep -E 'error TS' "$BASELINE_FILE" | norm || true) | sed 's/^/  known: /' >&2
  echo "  Note: an edit that rewords a pre-existing error can relabel it as NEW;" >&2
  echo "  the count delta ($((count - baseline_count))) bounds how many are truly new." >&2
  echo "  Reproduce: node_modules/.bin/tsc --noEmit -p $TSCONFIG" >&2
  exit 1
fi

if (( count < baseline_count )); then
  echo "✖ stale baseline: $count errors but baselined at $baseline_count — run: bash scripts/lint-frontend-types.sh --update" >&2
  exit 1
fi

echo "✓ frontend-types guard passed ($count known errors; none new)"
