#!/usr/bin/env bash
#
# lint-state-writes.sh — repo-wide guard: all durable state mutations go
# through approved writer functions; never an ad-hoc fs write/rename to a
# state file. Enforces reference/state-model.mdx. See PAN-1921 / PAN-1919.
#
# Approved write surface (raw fs primitives may appear here only):
#   - src/lib/pan-dir/record.ts        — per-issue record writer (PAN-1919)
#   - src/lib/pan-dir/records.ts       — record builder / backfill
#   - src/lib/pan-dir/specs.ts         — immutable plan single-writer (PAN-1124)
#   - src/lib/pan-dir/auto-commit.ts   — commit fan-in helper
#   - src/lib/pan-dir/drafts.ts        — PRD drafts (human/agent narrative)
#   - src/lib/pan-dir/context.ts       — context-layer config
#   - src/lib/agents.ts writeAgentStateJsonSync — state.json writer
#
# Legacy exceptions (known scattered state writes not yet routed to the record
# writer; tracked for follow-up):
#   - src/lib/pan-dir/continue.ts, continues.ts
#   - src/lib/pan-dir/feedback.ts, sessions.ts
#   - src/lib/vbrief/io.ts, continue-state.ts, lifecycle-io.ts
#   - src/lib/planning/spawn-planning-session.ts
#   - src/lib/cloister/feedback-writer.ts
#   - src/cli/commands/done.ts
#   - src/dashboard/server/routes/agents.ts
set -euo pipefail

cd "$(dirname "$0")/.."

# Phase-2 filter: drop comment/JSDoc lines from git-grep output.
# Input format: path:lineno:content
comment_filter() {
  perl -ne '
    next unless length;
    my ($prefix, $content) = /^([^:]+:\d+:)(.*)$/ ? ($1, $2) : ("", $_);
    next if $content =~ m{^\s*(?://|\*|/\*)};
    print;
  '
}

# ── Rule 1: pan-dir raw-primitive ban outside the approved writer allowlist ──
PAN_DIR_APPROVED=(
  ':!src/lib/pan-dir/record.ts'
  ':!src/lib/pan-dir/records.ts'
  ':!src/lib/pan-dir/specs.ts'
  ':!src/lib/pan-dir/auto-commit.ts'
  ':!src/lib/pan-dir/drafts.ts'
  ':!src/lib/pan-dir/context.ts'
)
PAN_DIR_LEGACY=(
  ':!src/lib/pan-dir/continue.ts'
  ':!src/lib/pan-dir/continues.ts'
  ':!src/lib/pan-dir/feedback.ts'
  ':!src/lib/pan-dir/sessions.ts'
)

candidates=$(
  { git grep -nE -e 'writeFileString' -e 'writeFileSync' -e 'writeFile\(' -e '\.rename\(' -e 'renameSync' \
      -- 'src/lib/pan-dir/' "${PAN_DIR_APPROVED[@]}" "${PAN_DIR_LEGACY[@]}" ':!src/lib/pan-dir/__tests__/*'; } || true
)
violations=$(printf '%s\n' "$candidates" | comment_filter)
if [[ -n "$violations" ]]; then
  echo "✗ ad-hoc state write under src/lib/pan-dir/ outside the approved writer or legacy exception list:" >&2
  echo "$violations" >&2
  echo "Route durable mutations through src/lib/pan-dir/record.ts or update the allowlist/legacy list." >&2
  exit 1
fi

legacy_candidates=$(
  { git grep -nE -e 'writeFileString' -e 'writeFileSync' -e 'writeFile\(' -e '\.rename\(' -e 'renameSync' \
      -- 'src/lib/pan-dir/' "${PAN_DIR_APPROVED[@]}" ':!src/lib/pan-dir/__tests__/*'; } || true
)
legacy_violations=$(printf '%s\n' "$legacy_candidates" | comment_filter)

# ── Rule 2: state.json single-writer in agents.ts ──
# MULTILINE-AWARE: the canonical write is split across lines, so a line-oriented
# grep misses it. Find every 'state.json' literal co-located with a write/rename
# primitive and fail if it falls outside writeAgentStateJsonSync.
agents_file='src/lib/agents.ts'
func_start=$(grep -n 'export function writeAgentStateJsonSync' -- "$agents_file" 2>/dev/null | head -1 | cut -d: -f1 || true)
if [[ -n "$func_start" ]]; then
  func_end=$(awk -v start="$func_start" '
    NR > start && /^export / { print NR; exit }
  ' "$agents_file" || true)
  if [[ -z "$func_end" ]]; then
    func_end=$(wc -l < "$agents_file")
  fi

  violation=$(
    awk -v start="$func_start" -v end="$func_end" -v file="$agents_file" '
      function is_comment_or_blank(line) {
        return line ~ /^[[:space:]]*($|\/\/|\*)/
      }
      function has_primitive(line) {
        return line ~ /writeFileSync|writeFileString|writeFile\(|\.rename\(|renameSync/
      }
      {
        if (is_comment_or_blank($0)) { prev=""; next }
        if ($0 ~ /'\''state\.json'\''/) {
          if (has_primitive(prev) || has_primitive($0)) {
            if (!(NR >= start && NR <= end)) {
              print file ":" NR ": state.json write outside writeAgentStateJsonSync"
            }
          }
        }
        prev=$0
      }
    ' "$agents_file"
  )
  if [[ -n "$violation" ]]; then
    echo "✗ state.json written outside writeAgentStateJsonSync:" >&2
    echo "$violation" >&2
    exit 1
  fi
fi

# ── Rule 3: continue-file literal guard (scans ALL of src/) ──
# Known off-pan-dir continue writers are allowlisted as legacy exceptions; any
# new file that writes to the continue file fails.
CONTINUE_EXCLUDES=(
  ':!src/lib/pan-dir/continue.ts'
  ':!src/lib/pan-dir/continues.ts'
  ':!src/lib/vbrief/io.ts'
  ':!src/lib/vbrief/continue-state.ts'
  ':!src/lib/planning/spawn-planning-session.ts'
  ':!src/lib/cloister/feedback-writer.ts'
  ':!src/cli/commands/done.ts'
  ':!src/dashboard/server/routes/agents.ts'
  ':!src/**/__tests__/*'
  ':!*.md'
)

cont_candidates=$(
  { git grep -nE -e 'PAN_CONTINUE_FILENAME' -e "continue\\.json" -e 'continuePath' \
      -- 'src/' "${CONTINUE_EXCLUDES[@]}"; } || true
)
cont_violations=$(
  printf '%s\n' "$cont_candidates" | comment_filter | perl -ne '
    next unless /writeFileSync|writeFileString|writeFile\(|\.rename\(|renameSync/;
    print;
  '
)
if [[ -n "$cont_violations" ]]; then
  echo "✗ ad-hoc write to the workspace/project continue file outside legacy exceptions:" >&2
  echo "$cont_violations" >&2
  exit 1
fi

echo "✓ state-write lint passed (single write surface intact)"
if [[ -n "${legacy_violations:-}" ]]; then
  echo "⚠ legacy pan-dir writers still present — route to record.ts when possible:"
  echo "$legacy_violations"
fi
