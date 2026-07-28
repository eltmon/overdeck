#!/usr/bin/env bash
#
# guard-workspace-doors.sh — PAN-1990: the projects/workspaces/project_targets/
# pinned_docs tables have exactly one read door (src/lib/workspaces/resolver.ts)
# and one write door (src/lib/workspaces/writer.ts); src/lib/overdeck/infra.ts
# owns their DDL (an idempotent overdeck.db runtime top-up, not panopticon.db's
# schema.ts — see PAN-1990's workspace-doors item). Any other file issuing SQL
# against these tables is a violation of the two-doors tenet
# (docs/PIPELINE-MEMBERSHIP.md).
set -euo pipefail
cd "$(dirname "$0")/.."

TABLES='workspaces|projects|project_targets|pinned_docs'

ALLOWED=(
  ':!src/lib/workspaces/*.ts'
  ':!src/lib/overdeck/infra.ts'
  ':!scripts/guard-workspace-doors.sh'
  ':!**/__tests__/**'
  ':!**/*.test.ts'
  ':!tests/**'
)

# Phase-2 filter: drop comment lines from git-grep output (mirrors lint-state-writes.sh).
comment_filter() {
  perl -ne '
    next unless length;
    my ($prefix, $content) = /^([^:]+:\d+:)(.*)$/ ? ($1, $2) : ("", $_);
    next if $content =~ m{^\s*(?://|\*|/\*|#)};
    print;
  '
}

# -P (PCRE) with a negative lookahead: SQL references a bare table name, never
# followed by '.' or '-' (which instead signal prose like "projects.yaml" or
# a file/branch name), so this excludes non-SQL mentions without a full parser.
candidates=$(
  { git grep -nPi \
      -e "FROM ($TABLES)(?![.\\-\\w])" \
      -e "INTO ($TABLES)(?![.\\-\\w])" \
      -e "UPDATE ($TABLES)(?![.\\-\\w])" \
      -e "DELETE FROM ($TABLES)(?![.\\-\\w])" \
      -- 'src/**' 'scripts/**' "${ALLOWED[@]}"; } || true
)
violations=$(printf '%s\n' "$candidates" | comment_filter)

if [[ -n "$violations" ]]; then
  echo "✗ direct SQL against workspaces/projects/project_targets/pinned_docs outside the two doors:" >&2
  echo "$violations" >&2
  echo "Route reads through src/lib/workspaces/resolver.ts and writes through src/lib/workspaces/writer.ts." >&2
  exit 1
fi

echo "✓ workspace-doors guard passed (no direct SQL outside the two doors)"
