#!/usr/bin/env bash
#
# lint-overdeck-boundaries.sh — the cutover GATE for the Overdeck migration.
#
# Fails when any CONSUMER (lib logic, dashboard server, CLI, hook, script) still
# reaches the OLD panopticon.db — either by calling getDatabase() or by importing
# an old `src/lib/database/*` store module — instead of going through an overdeck
# door (src/lib/overdeck/*). It also flags code that grabs the raw overdeck `Db`
# handle directly instead of a domain resolver/writer.
#
# The violation COUNT is the remaining consumer-cutover work. Zero means every
# consumer is on the doors and the big-bang cutover to overdeck.db is safe.
#
# Exemptions are ONLY structural, never per-domain "deferred" passes:
#   - src/lib/overdeck/**   the new doors themselves
#   - src/lib/database/**   the OLD store layer — deleted wholesale at cutover,
#                           not a "consumer to repoint" (the shared sqlite driver
#                           lives here too and is allowed everywhere)
#   - tests / *.md / db-bootstrap scripts
# There are NO src/lib/{costs,conversations,vbrief,reconstruct}/** or
# agent-backfill exemptions — if a file there still touches the old DB, that IS
# the work, and the gate must show it.
#
# Enforced in CI via PAN_OVERDECK_BOUNDARY_LINT=1.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${PAN_OVERDECK_BOUNDARY_LINT:-0}" != "1" ]]; then
  echo "✓ overdeck boundary gate: set PAN_OVERDECK_BOUNDARY_LINT=1 to enforce"
  exit 0
fi

INCLUDES=(
  'src/lib/'
  'src/dashboard/server/'
  'src/cli/'
  'scripts/'
)

EXCLUDES=(
  ':!src/lib/overdeck/**'
  ':!src/lib/database/**'
  ':!src/**/__tests__/**'
  ':!tests/**'
  ':!**/*.test.ts'
  ':!*.md'
  ':!scripts/create-overdeck-db.ts'
  ':!scripts/drizzle-node-sqlite-smoke.ts'
  ':!scripts/lint-overdeck-boundaries.sh'
)

# Skip comment lines so a stale comment mentioning the old DB never false-flags.
comment_filter() {
  perl -ne '
    next unless length;
    my ($prefix, $content) = /^([^:]+:\d+:)(.*)$/ ? ($1, $2) : ("", $_);
    next if $content =~ m{^\s*(#|//|\*|/\*)};
    print;
  '
}

# 1) Direct calls to getDatabase() — the panopticon.db handle.
getdb=$(
  { git grep -nE --untracked -e "\\bgetDatabase[[:space:]]*\\(" \
      -- "${INCLUDES[@]}" "${EXCLUDES[@]}"; } || true
)

# 2) Imports of any OLD store module under src/lib/database/, EXCEPT the shared
#    sqlite driver (which overdeck uses too).
dbimport=$(
  { git grep -nE --untracked \
      -e "from[[:space:]]*['\"][^'\"]*\\bdatabase/[A-Za-z0-9_-]+(\\.js)?['\"]" \
      -- "${INCLUDES[@]}" "${EXCLUDES[@]}"; } \
    | grep -vE "database/driver(\\.js)?['\"]" || true
)

# 3) Grabbing the raw overdeck Db handle instead of going through a door.
rawdb=$(
  { git grep -nE --untracked \
      -e "import[[:space:]]*\\{[^}]*\\bDb\\b[^}]*\\}[[:space:]]*from[[:space:]]*['\"][^'\"]*overdeck/infra(\\.js)?['\"]" \
      -- "${INCLUDES[@]}" "${EXCLUDES[@]}"; } || true
)

violations=$(
  { printf '%s\n' "$getdb" "$dbimport" "$rawdb"; } \
    | grep -vE '^[[:space:]]*$' | comment_filter | sort -u
)

if [[ -n "$violations" ]]; then
  count=$(printf '%s\n' "$violations" | grep -c .)
  files=$(printf '%s\n' "$violations" | sed -E 's/:[0-9]+:.*//' | sort -u | grep -c .)
  echo "✗ overdeck boundary gate: ${count} site(s) across ${files} file(s) still on the OLD panopticon.db" >&2
  echo "" >&2
  echo "$violations" >&2
  echo "" >&2
  echo "Each must go through an overdeck door (src/lib/overdeck/*) — not getDatabase() or a database/* store." >&2
  exit 1
fi

echo "✓ overdeck boundary gate: zero consumers on the old database"
