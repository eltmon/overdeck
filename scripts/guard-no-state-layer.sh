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
# Excludes __fixtures__ directories (fixtures intentionally exercise legacy
# shapes for migration/no-loss tests). Everything else under the scan root is
# checked, including test files: no test may construct an IssueRecord either.
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

hit_count=0

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
  -print0)

if [[ "$hit_count" -gt 0 ]]; then
  echo "✗ guard-no-state-layer: ${hit_count} state-layer reference(s) found under ${scan_root}" >&2
  exit 1
fi

echo "✓ guard-no-state-layer passed: no state-layer references under ${scan_root}"
exit 0
