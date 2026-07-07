#!/usr/bin/env bash
#
# lint-no-coderabbit-merge-gate.sh — PAN-2374 structural guard.
#
# CodeRabbit findings are strictly advisory and must never influence merge
# gates. Fail the build if any merge-gate file references coderabbit.
set -euo pipefail

GATE_FILES=(
  src/lib/review-status.ts
  src/lib/cloister/verification-runner.ts
  src/lib/cloister/deacon-merge.ts
  src/lib/cloister/auto-merge-eligibility.ts
  src/lib/flywheel-merge-order.ts
)

failed=0
for file in "${GATE_FILES[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "✗ merge-gate file missing: $file" >&2
    failed=1
    continue
  fi
  if grep -qi 'coderabbit' "$file"; then
    echo "✗ merge-gate file must not reference CodeRabbit: $file" >&2
    failed=1
  fi
done

if [[ "$failed" -ne 0 ]]; then
  echo "CodeRabbit state must never reach merge gates. See PAN-2374." >&2
  exit 1
fi

echo "✓ no CodeRabbit references in merge-gate files"
