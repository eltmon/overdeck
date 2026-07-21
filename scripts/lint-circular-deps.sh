#!/usr/bin/env bash
#
# lint-circular-deps.sh — shrink-only ratchet against import cycles (A4, codebase health).
# No NEW directed import cycle may appear in src/. A BASELINED cycle may disappear,
# lowering the baseline; a new cycle fails CI. Baseline is
# scripts/circular-deps-baseline.txt (one canonical cycle per line).
#
# Modes:
#   (no args)     check current src/ against the baseline
#   --update      drop cycles that have been removed; never add new ones
#   --regen       rewrite the baseline from the current cycle list
#
# --update lowers the ratchet when cycles are removed (D3). --regen is for initial
# seeding or deliberate rebaselining; introducing a new cycle still requires a
# separate, issue-referenced decision because lint-ratchet-audit.sh audits the
# baseline for additions (D4).
#
set -euo pipefail

# Force C locale so coreutils `sort`/`comm` use code-point ordering, matching
# the canonicalizer's JS `.sort()` (also code-point). Without this, a non-C
# LC_COLLATE (e.g. en_US.UTF-8 in CI) orders paths differently than the
# canonicalizer, and `comm` flags every baselined cycle as both "new" and
# "stale" — a false positive that has nothing to do with the diff under test.
export LC_ALL=C

MODE=check
if [[ "${1:-}" == "--update" ]]; then
  MODE=update
elif [[ "${1:-}" == "--regen" ]]; then
  MODE=regen
elif [[ $# -gt 0 ]]; then
  echo "usage: bash scripts/lint-circular-deps.sh [--update | --regen]" >&2
  exit 2
fi

cd "$(dirname "$0")/.."

BASELINE="scripts/circular-deps-baseline.txt"
MADGE="node_modules/.bin/madge"
CANON="scripts/canonicalize-circular-deps.js"

if [[ ! -x "$MADGE" ]]; then
  echo "✖ madge not found at $MADGE — run: bun install" >&2
  exit 1
fi

if [[ ! -f "$CANON" ]]; then
  echo "✖ missing $CANON — required by lint-circular-deps.sh" >&2
  exit 1
fi

# Current cycles, one canonical line per cycle.
# Exclude test files, __tests__ directories, and .d.ts declarations — we only ratchet production source cycles.
current_raw=$(mktemp)
current=$(mktemp)
"$MADGE" --circular --json --extensions ts,tsx \
  --exclude '\/(__tests__|__mocks__)\/|\.(test|spec)\.(ts|tsx)$|\.d\.ts$' \
  src/ 2>/dev/null > "$current_raw" || true
node "$CANON" < "$current_raw" | LC_ALL=C sort -u > "$current"
rm -f "$current_raw"

# Regen mode: rewrite the baseline from the current cycle list.
if [[ "$MODE" == "regen" ]]; then
  cp "$current" "$BASELINE"
  count=$(wc -l < "$current")
  rm -f "$current"
  echo "✓ circular-deps baseline regenerated ($count cycles)"
  exit 0
fi

# Ensure baseline file exists.
if [[ ! -f "$BASELINE" ]]; then
  echo "✖ missing $BASELINE — regenerate it: bash scripts/lint-circular-deps.sh --regen" >&2
  rm -f "$current"
  exit 1
fi

# Load baseline into a sorted file for comparison.
baseline=$(mktemp)
LC_ALL=C sort -u "$BASELINE" > "$baseline"

# Update mode: only drop cycles that no longer exist; never add new ones.
if [[ "$MODE" == "update" ]]; then
  tmp=$(mktemp)
  dropped=0
  unchanged=0

  while IFS= read -r line || [[ -n "$line" ]]; do
    if grep -Fxq "$line" "$current"; then
      echo "$line" >> "$tmp"
      (( ++unchanged ))
    else
      (( ++dropped ))
    fi
  done < "$baseline"

  LC_ALL=C sort -u "$tmp" > "$BASELINE"
  rm -f "$tmp" "$current" "$baseline"
  echo "✓ circular-deps baseline updated: $dropped dropped, $unchanged unchanged"
  exit 0
fi

# Check mode: detect new cycles (in current but not baseline) and stale cycles
# (in baseline but not current).
new_cycles=$(LC_ALL=C comm -23 "$current" "$baseline" || true)
stale_cycles=$(LC_ALL=C comm -13 "$current" "$baseline" || true)

fail=0
if [[ -n "$new_cycles" ]]; then
  echo "✖ new circular dependencies found — these must be removed, not baselined:" >&2
  echo "$new_cycles" | sed 's/^/    /' >&2
  fail=1
fi

if [[ -n "$stale_cycles" ]]; then
  echo "✖ stale baseline entries — run: bash scripts/lint-circular-deps.sh --update" >&2
  echo "$stale_cycles" | sed 's/^/    /' >&2
  fail=1
fi

if (( fail )); then
  rm -f "$current" "$baseline"
  echo "" >&2
  echo "circular-dependency guard failed. Break the cycle, or manually edit the baseline in an issue-referenced commit to accept audited growth." >&2
  exit 1
fi

count=$(wc -l < "$current")
rm -f "$current" "$baseline"
echo "✓ circular-dependency guard passed ($count baselined cycles; no new cycles)"
