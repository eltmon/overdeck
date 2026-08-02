#!/usr/bin/env bash
#
# guard-park-exits.sh — PAN-3488: the guard-exit invariant.
#
# Every stuck flavor the pipeline can park an issue with must carry operator
# copy — a "why parked" sentence AND a "release condition" sentence — in
# STUCK_REASON_COPY (src/lib/parked/resolver.ts). A park without a documented
# exit is how the graveyard accumulated: ten silent orbits across six
# subsystems before the sweeper existed. This guard makes an exit-less park
# flavor unmergeable.
#
# Checked write shapes:
#   markWorkspaceStuck(<id>, '<flavor>', …)     — the canonical stuck write door
#   stuckReason: '<flavor>'                     — direct status writes
#   FEEDBACK_DELIVERY_STUCK_REASON              — const-referenced flavor
#
# The other nine orbits (needs-you, gates, merge/UAT/conflict failures,
# zombies, idle, circuit-breaker) carry their exit copy in classifyParked()
# itself; the per-orbit fixture tests in src/lib/parked/__tests__/ assert
# non-empty parkReason + unparkCondition for all ten.
set -euo pipefail
cd "$(dirname "$0")/.."

RESOLVER='src/lib/parked/resolver.ts'

flavors=$(
  {
    git grep -nPo "markWorkspaceStuck\([^,]+,\s*'[a-z_0-9-]+'" -- 'src/**' ':!**/__tests__/**' ':!**/*.test.ts' ':!**/*.test.tsx' \
      | grep -oP "'[a-z_0-9-]+'\s*$" | tr -d "' " || true
    git grep -nPo "stuckReason:\s*'[a-z_0-9-]+'" -- 'src/**' ':!**/__tests__/**' ':!**/*.test.ts' ':!**/*.test.tsx' ':!src/dashboard/frontend/**' \
      | grep -oP "'[a-z_0-9-]+'" | tr -d "'" || true
    # Const-referenced flavors: resolve FEEDBACK_DELIVERY_STUCK_REASON's value.
    git grep -nPo "FEEDBACK_DELIVERY_STUCK_REASON\s*=\s*'[a-z_0-9-]+'" -- 'src/**' \
      | grep -oP "'[a-z_0-9-]+'" | tr -d "'" || true
  } | sort -u
)

missing=()
while IFS= read -r flavor; do
  [[ -z "$flavor" ]] && continue
  # A documented flavor appears as a quoted key in STUCK_REASON_COPY.
  if ! grep -q "^  \('$flavor'\|$flavor\):" "$RESOLVER"; then
    missing+=("$flavor")
  fi
done <<< "$flavors"

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "✗ stuck flavors parked without a documented exit (guard-exit invariant, PAN-3488):" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  echo "Add park + release copy for each to STUCK_REASON_COPY in $RESOLVER." >&2
  exit 1
fi

echo "✓ park-exits guard passed (every stuck flavor documents its exit)"
