#!/usr/bin/env bash
#
# lint-overdeck-boundaries.sh — cutover guard for the Overdeck two-door rule.
#
# Dormant by default: the remodel is still relocating legacy callers, so `npm
# run lint` must stay green until the `ci-guard-on` bead flips strict mode. Set
# PAN_OVERDECK_BOUNDARY_LINT=1 to enforce now.
#
# Strict mode fails when route/RPC/CLI/hook/script code imports data stores
# directly instead of going through a domain resolver/writer service.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ "${PAN_OVERDECK_BOUNDARY_LINT:-0}" != "1" ]]; then
  echo "✓ overdeck import-boundary lint authored (strict enforcement disabled until ci-guard-on)"
  exit 0
fi

INCLUDES=(
  'src/dashboard/server/routes/'
  'src/cli/'
  'src/lib/'
  'scripts/'
)

EXCLUDES=(
  ':!src/lib/overdeck/**'
  ':!src/**/__tests__/**'
  ':!tests/**'
  ':!*.md'
  ':!scripts/create-overdeck-db.ts'
  ':!scripts/drizzle-node-sqlite-smoke.ts'
  # Compatibility bridge — intentional state.json read/write for rollback
  ':!src/lib/agents.ts'
  # True boundary-owners: own their permanent-plane or domain data directly
  ':!src/lib/vbrief/**'
  ':!src/lib/reconstruct/**'
  ':!src/lib/costs/**'
  ':!src/lib/conversations/**'
  ':!src/lib/database/agent-backfill.ts'
  # Deferred migration — needs new AgentState fields (location, autoSpawnOnFinalize)
  ':!src/lib/planning/**'
  # Deferred migration — reads getDatabase() or pan-dir for legacy SQLite / pipeline record queries
  ':!src/lib/git-activity.ts'
  ':!src/lib/cloister/service.ts'
  ':!src/lib/review-status.ts'
  ':!src/lib/memory/checkpoints.ts'
  # Deferred migration — routes using non-standard state.json fields (location, vmName, lastPing)
  ':!src/dashboard/server/routes/issues.ts'
  ':!src/dashboard/server/routes/misc.ts'
  ':!src/dashboard/server/routes/projects.ts'
  # Deferred migration — CLI tools with bulk-scan or custom state shapes (DoctorAgentState, autoSpawnOnFinalize)
  ':!src/cli/commands/db.ts'
  ':!src/cli/commands/doctor.ts'
  ':!src/cli/commands/plan-finalize.ts'
)

comment_filter() {
  perl -ne '
    next unless length;
    my ($prefix, $content) = /^([^:]+:\d+:)(.*)$/ ? ($1, $2) : ("", $_);
    next if $content =~ m{^\s*(#|//|\*|/\*)};
    print;
  '
}

db_candidates=$(
  { git grep -nE --untracked \
      -e "import[[:space:]]*\\{[^}]*\\bDb\\b[^}]*\\}[[:space:]]*from[[:space:]]*['\"][^'\"]*overdeck/infra(\\.js)?['\"]" \
      -- "${INCLUDES[@]}" "${EXCLUDES[@]}"; } || true
)

raw_cache_candidates=$(
  { git grep -nE --untracked \
      -e "from[[:space:]]*['\"][^'\"]*lib/database/driver(\\.js)?['\"]" \
      -e "from[[:space:]]*['\"][^'\"]*database/(index|schema)(\\.js)?['\"]" \
      -- "${INCLUDES[@]}" "${EXCLUDES[@]}"; } || true
)

raw_pan_candidates=$(
  { git grep -nE --untracked \
      -e "from[[:space:]]*['\"][^'\"]*pan-dir/(record|records|continue|continues|specs|feedback|sessions)(\\.js)?['\"]" \
      -e "['\"]state\\.json['\"]" \
      -- "${INCLUDES[@]}" "${EXCLUDES[@]}"; } || true
)

violations=$(
  {
    printf '%s\n' "$db_candidates"
    printf '%s\n' "$raw_cache_candidates"
    printf '%s\n' "$raw_pan_candidates"
  } | comment_filter | sort -u
)

if [[ -n "$violations" ]]; then
  echo "✗ overdeck import-boundary violation: route/RPC/CLI/hook/script code reached a store directly" >&2
  echo "" >&2
  echo "$violations" >&2
  echo "" >&2
  echo "Use the owning domain resolver/writer Service instead. Only resolver/writer Layers may acquire Db or raw source-of-truth writers." >&2
  exit 1
fi

echo "✓ overdeck import-boundary lint passed"
