#!/usr/bin/env bash
# PAN-3849 (W32, FR-23): one liveness oracle. Every "is this agent alive" or
# "is this agent idle" decision goes through src/lib/agents/liveness.ts; the
# migrated consumers must not re-introduce private predicates built on
# sessionExists(/sessionExistsSync(/pane_dead, and the retired
# cloister/agent-idle.ts module must not be re-imported.
set -euo pipefail

cd "$(dirname "$0")/.."

fail=0

LIVENESS_MODULE="src/lib/agents/liveness.ts"

CONSUMERS=(
  src/lib/parked/resolver.ts
  src/lib/cloister/feedback-target.ts
  src/lib/work-agent-lifecycle.ts
  src/lib/agents/messaging.ts
)

require_reference() {
  local file="$1" pattern="$2" label="$3"
  if ! rg -q "$pattern" "$file"; then
    echo "✗ liveness boundary: $label no longer delegates through the liveness oracle ($file)"
    fail=1
  fi
}

ban_pattern() {
  local file="$1" pattern="$2" label="$3"
  if rg -n "$pattern" "$file"; then
    echo "✗ liveness boundary: $label reintroduced a private liveness predicate ($file)"
    fail=1
  fi
}

check_all() {
  # The oracle module must exist and export the three entry points.
  require_reference "$LIVENESS_MODULE" 'export async function isAlive' 'liveness module'
  require_reference "$LIVENESS_MODULE" 'export function isIdle' 'liveness module'
  require_reference "$LIVENESS_MODULE" 'export function idleAgeMs' 'liveness module'

  # PAN-3926: no synchronous liveness door. A sync probe can only ask tmux
  # (Herdr answers over an async socket), so it reads every Herdr agent dead.
  if rg -n 'function isAliveSync' "$LIVENESS_MODULE"; then
    echo "✗ liveness boundary: a sync liveness door is tmux-only — await isAlive instead (PAN-3926)"
    fail=1
  fi

  # Each migrated consumer delegates to the oracle (specifier is
  # './liveness.js' from inside src/lib/agents, '../agents/liveness.js' elsewhere)...
  local file
  for file in "${CONSUMERS[@]}"; do
    require_reference "$file" "['\"](\\./|\\.\\./)(agents/)?liveness\\.js['\"]" "$file"
  done

  # ...and none of them keeps a private predicate.
  for file in "${CONSUMERS[@]}"; do
    ban_pattern "$file" 'sessionExists\(|sessionExistsSync\(|pane_dead' "$file"
  done

  # The retired idle module must not be re-imported anywhere.
  if rg -n "agent-idle\.js" src/ tests/ 2>/dev/null; then
    echo "✗ liveness boundary: cloister/agent-idle.ts was retired into agents/liveness.ts — re-import is forbidden"
    fail=1
  fi
}

if [[ "${1:-}" == "--self-test" ]]; then
  fixture_dir="$(mktemp -d)"
  trap 'rm -rf "$fixture_dir"' EXIT
  printf '%s\n' "import { sessionExistsSync } from './tmux.js';" > "$fixture_dir/consumer.ts"
  printf '%s\n' 'const alive = sessionExistsSync(agentId);' >> "$fixture_dir/consumer.ts"

  fail=0
  require_reference "$fixture_dir/consumer.ts" "['\"](\\./|\\.\\./)(agents/)?liveness\\.js['\"]" 'seeded consumer'
  ban_pattern "$fixture_dir/consumer.ts" 'sessionExists\(|sessionExistsSync\(|pane_dead' 'seeded consumer'
  if (( fail == 0 )); then
    echo "liveness self-test failed to reject seeded violations" >&2
    exit 2
  fi
  echo "liveness self-test caught seeded delegation and private-predicate violations"
  exit 1
fi

if [[ $# -gt 0 ]]; then
  echo "usage: bash scripts/lint-liveness.sh [--self-test]" >&2
  exit 2
fi

check_all

if (( fail )); then
  exit 1
fi

echo "✓ liveness boundary passed: four consumers delegate through src/lib/agents/liveness.ts and no private predicates remain"
