#!/usr/bin/env bash
# PAN-3903: one pipeline read door. Every "what state is this issue in" read
# under src/lib/cloister/ goes through src/lib/overdeck/pipeline-view.ts, which
# answers the state and the in-flight transition owner together. A patrol that
# takes its own review_status snapshot cannot tell that another actor is already
# mid-transition, and acts on state it does not own — PAN-3842, where
# checkOrphanedCompletions "recovered" one issue nine times in forty-five
# minutes on top of the work agent's own re-review.
#
# The door itself and the write side are allowlisted by path; nothing else under
# src/lib/cloister/ may name a raw store reader.
set -euo pipefail

cd "$(dirname "$0")/.."

READ_DOOR="src/lib/overdeck/pipeline-view.ts"

# The raw store readers the door replaces.
RAW_READERS='getReviewStatusSync|getReviewStatusesSync|loadReviewStatuses|loadReviewStatusesForIssues|getAllReviewStatusesFromDb|getReviewStatusFromDbSync|getReviewStatusesFromDb'

fail=0

scan_dir() {
  local dir="$1" label="$2"
  local hits
  # Tests may still mock the underlying module; only production code is gated.
  hits="$(rg -n --glob '!*.test.ts' --glob '!**/__tests__/**' -e "\\b($RAW_READERS)\\b" "$dir" || true)"
  if [[ -n "$hits" ]]; then
    echo "✗ pipeline read door: $label reads review_status directly instead of through $READ_DOOR"
    echo "$hits" | sed 's/^/    /'
    echo "    Use getPipelineView/getPipelineStatus/listPipelineViews/listPipelineStatuses."
    echo "    A patrol that ACTS must skip an issue whose inFlightOwner is non-null."
    fail=1
  fi
}

check_all() {
  # The door must exist and export its read surface plus the owner derivation.
  local entry
  for entry in getPipelineView getPipelineStatus listPipelineViews listPipelineStatuses deriveInFlightOwner; do
    if ! rg -q "export function $entry" "$READ_DOOR"; then
      echo "✗ pipeline read door: $READ_DOOR no longer exports $entry"
      fail=1
    fi
  done

  # The door is the only reader under src/lib/cloister.
  scan_dir src/lib/cloister 'src/lib/cloister'
}

if [[ "${1:-}" == "--self-test" ]]; then
  fixture_dir="$(mktemp -d)"
  trap 'rm -rf "$fixture_dir"' EXIT
  printf '%s\n' "import { getReviewStatusSync } from '../review-status.js';" > "$fixture_dir/patrol.ts"
  printf '%s\n' 'const status = getReviewStatusSync(issueId);' >> "$fixture_dir/patrol.ts"

  fail=0
  scan_dir "$fixture_dir" 'seeded patrol'
  if (( fail == 0 )); then
    echo "pipeline read door self-test failed to reject a seeded direct read" >&2
    exit 2
  fi
  echo "pipeline read door self-test caught the seeded direct review_status read"
  exit 1
fi

if [[ $# -gt 0 ]]; then
  echo "usage: bash scripts/lint-pipeline-read-door.sh [--self-test]" >&2
  exit 2
fi

check_all

if (( fail )); then
  exit 1
fi

echo "✓ pipeline read door passed: src/lib/cloister reads pipeline state only through $READ_DOOR"
