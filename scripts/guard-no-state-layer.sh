#!/usr/bin/env bash
#
# guard-no-state-layer.sh — PAN-3917 (W3): CI guard for the state-layer cut.
#
# Overdeck stores no status it can derive. This guard fails when a file under
# the scan root (default: src/) references the deleted record plane, the
# deleted status-mirror fields, the deleted pipeline-record type, or the
# deleted state-branch/door names. It is deliberately broad — a false
# positive here is cheaper than a resurrected mirror.
#
# Excludes __fixtures__ directories and the migrate-plan-home bridge, whose one
# job is reading the legacy records/ shape off the archived state branch.
# (fixtures intentionally exercise legacy
# shapes for migration/no-loss tests). Everything else under the scan root is
# checked, including test files: no test may construct an IssueRecord either.
#
# A second pass scans the Markdown that SHIPS TO AGENTS — the runtime prompts
# under src/lib/cloister/prompts/ and everything under sync-sources/ (rules,
# skills, agent definitions). A prompt telling an agent to write a
# statusOverride or push to overdeck-state resurrects the mirror just as surely
# as code does, and the code pass never saw those files (PAN-3917 finding 17).
# The Markdown pass uses a narrower pattern set than the code pass: it looks for
# the things that unambiguously name the deleted plane (the records/ directory,
# statusOverrides, IssueRecord, the task door, the overdeck-state branch, the
# deleted /api/review/:id/status endpoint). The six status FIELD names are left
# to the code pass — in prose "reviewStatus" is as often vocabulary a doc is
# explaining as a field a doc is telling an agent to read, and a guard that
# cannot tell the two apart teaches people to route around it.
#
# Two files legitimately name the deleted plane and are exempt by name:
# sync-sources/rules/protect-overdeck-state-branch.md (the rule that forbids
# deleting the archived branch) and
# sync-sources/skills/pan-admin-migrate-plan-home/SKILL.md (the doc for the
# migration bridge that reads it), matching the migrate-plan-home.ts exemption.
#
# Usage: bash scripts/guard-no-state-layer.sh [scan-root]
#
# Expected to fail on this branch until every worker's re-point lands
# (PAN-3917 wave B); it is a checkpoint gate, not a per-commit gate.
set -euo pipefail

if [[ $# -gt 1 ]]; then
  echo "usage: bash scripts/guard-no-state-layer.sh [scan-root]" >&2
  exit 2
fi

scan_root="${1:-src}"

if [[ ! -d "$scan_root" ]]; then
  echo "guard-no-state-layer: scan root does not exist: $scan_root" >&2
  exit 2
fi

# label -> extended-regex pattern (grep -P). Order matches the spec list.
labels=(
  'records/'
  'statusOverrides'
  'recoveryTrips'
  'readyForMerge'
  'reviewStatus|testStatus|verificationStatus|inspectStatus|mergeStatus|releaseStatus'
  'overdeck-state'
  'task-door'
  'auto-commit'
  'IssueRecord'
)
patterns=(
  '(?<![A-Za-z0-9_-])records/'
  '\bstatusOverrides\b'
  '\brecoveryTrips\b'
  '\breadyForMerge\b'
  '\b(reviewStatus|testStatus|verificationStatus|inspectStatus|mergeStatus|releaseStatus)\b'
  'overdeck-state'
  '\btask-door\b'
  '\bauto-commit\b'
  '\bIssueRecord\b'
)

# Agent-facing Markdown: the deleted plane by name, plus the deleted endpoint.
md_labels=(
  'records/'
  'statusOverrides'
  'overdeck-state'
  'task-door'
  'IssueRecord'
  '/api/review/:id/status'
)
md_patterns=(
  '(?<![A-Za-z0-9_-])records/'
  '\bstatusOverrides\b'
  'overdeck-state'
  '\btask-door\b'
  '\bIssueRecord\b'
  '/api/review/[^/\s]+/status'
)

hit_count=0

report_md_hits() {
  local file="$1" rel_file i lineno _rest
  rel_file=$(realpath --relative-to="$PWD" -- "$file")
  for i in "${!md_patterns[@]}"; do
    while IFS=: read -r lineno _rest; do
      [[ -z "$lineno" ]] && continue
      echo "${rel_file}:${lineno}: ${md_labels[$i]}"
      hit_count=$((hit_count + 1))
    done < <(grep -nP -- "${md_patterns[$i]}" "$file" 2>/dev/null || true)
  done
}

while IFS= read -r -d '' file; do
  # Report paths relative to the invoking directory (matches the other
  # lint:* scripts) regardless of whether scan_root was passed as a relative
  # or absolute path.
  rel_file=$(realpath --relative-to="$PWD" -- "$file")
  for i in "${!patterns[@]}"; do
    while IFS=: read -r lineno _rest; do
      [[ -z "$lineno" ]] && continue
      echo "${rel_file}:${lineno}: ${labels[$i]}"
      hit_count=$((hit_count + 1))
    done < <(grep -nP -- "${patterns[$i]}" "$file" 2>/dev/null || true)
  done
done < <(find "$scan_root" -type f \
  \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.mjs' -o -name '*.cjs' \) \
  -not -path '*/__fixtures__/*' \
  -not -name 'migrate-plan-home.ts' \
  -print0)

# Markdown that ships to agents. Only scanned when the caller did not narrow the
# code scan root, so `guard-no-state-layer.sh <some-dir>` stays a code-only scan.
if [[ $# -eq 0 ]]; then
  for md_root in src/lib/cloister/prompts sync-sources; do
    [[ -d "$md_root" ]] || continue
    while IFS= read -r -d '' file; do
      report_md_hits "$file"
    done < <(find "$md_root" -type f -name '*.md' \
      -not -path '*/__fixtures__/*' \
      -not -path '*/protect-overdeck-state-branch.md' \
      -not -path '*/pan-admin-migrate-plan-home/*' \
      -print0)
  done
fi

if [[ "$hit_count" -gt 0 ]]; then
  echo "✗ guard-no-state-layer: ${hit_count} state-layer reference(s) found under ${scan_root}" >&2
  exit 1
fi

echo "✓ guard-no-state-layer passed: no state-layer references under ${scan_root}"
exit 0
