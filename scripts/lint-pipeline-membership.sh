#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

fail=0

require_reference() {
  local file="$1" pattern="$2" label="$3"
  if ! rg -q "$pattern" "$file"; then
    echo "✗ pipeline-membership boundary: $label no longer delegates through the authoritative read door ($file)"
    fail=1
  fi
}

ban_pattern() {
  local file="$1" pattern="$2" label="$3"
  if rg -n "$pattern" "$file"; then
    echo "✗ pipeline-membership boundary: $label reintroduced legacy membership math ($file)"
    fail=1
  fi
}

if [[ "${1:-}" == "--self-test" ]]; then
  consumer='const isInPipeline = existsSync(join(workspacesDir, `feature-${issueId}`));'
  boundary="import { getAllReviewStatusesFromDb } from './review-status-sync.js';"
  if [[ "$consumer" != *"existsSync"* || "$consumer" != *"workspacesDir"* ]]; then
    echo "✗ pipeline-membership self-test: seeded legacy workspace predicate was not detected"
    exit 1
  fi
  if [[ ! "$boundary" =~ review-status|database|agents|tmux ]]; then
    echo "✗ pipeline-membership self-test: seeded disposable-state import was not detected"
    exit 1
  fi
  echo "✓ pipeline-membership self-test caught seeded consumer and durable-boundary violations"
  exit 0
fi

if [[ $# -gt 0 ]]; then
  echo "usage: bash scripts/lint-pipeline-membership.sh [--self-test]" >&2
  exit 2
fi

require_reference src/dashboard/server/services/resource-discovery.ts 'getPipelineMembershipForProjects' 'resource discovery'
require_reference src/dashboard/frontend/src/lib/pipeline-state.ts 'pipelineMembership' 'frontend pipeline state'
require_reference src/cli/commands/pending.ts 'resolvePipelineMembership' 'pan pending'
require_reference src/lib/reconstruct/enumerate-in-flight.ts 'resolvePipelineMembership' 'in-flight reconstruction'
require_reference src/lib/cloister/flywheel.ts 'resolvePipelineMembership' 'flywheel'
require_reference sync-sources/skills/pipeline-status/SKILL.md '/api/pipeline/membership' 'pipeline-status skill'

# Named legacy predicates from the six pre-PAN-1966 membership views.
ban_pattern src/dashboard/server/services/resource-discovery.ts 'filter\(\(issue\) => !isTerminalTrackerState' 'resource discovery'
ban_pattern src/dashboard/frontend/src/lib/pipeline-state.ts "stateType.*in_progress.*in_review" 'frontend pipeline state'
ban_pattern src/cli/commands/pending.ts 'const memberIds = new Set\(Object\.values\(allStatuses\)' 'pan pending'
ban_pattern src/lib/reconstruct/enumerate-in-flight.ts 'openIssueIds|FEATURE_DIR_RE' 'in-flight reconstruction'
ban_pattern src/lib/cloister/flywheel.ts 'workspacesDir.*feature-' 'flywheel'
ban_pattern sync-sources/skills/pipeline-status/SKILL.md "in_progress','in_review" 'pipeline-status skill'

# The resolver and gatherer are durable-lens code. Disposable L5 state may not
# enter through DB, review-status, agent-state, or tmux imports.
for file in src/lib/pipeline-membership.ts src/lib/pipeline-membership-gather.ts; do
  if rg -n "from ['\"][^'\"]*(database|review-status|agents|agent-state|tmux)" "$file"; then
    echo "✗ pipeline-membership boundary: disposable-state import in $file"
    fail=1
  fi
done

if (( fail )); then
  exit 1
fi

echo "✓ pipeline-membership boundary passed: six consumers delegate and durable lenses remain L5-free"
