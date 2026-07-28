#!/usr/bin/env bash
#
# lint-state-paths.sh — prevent new direct derivations of canonical spec/draft paths.
# Test fixtures are excluded because they intentionally exercise legacy layouts.
# Audited migration and path-authority modules remain allowlisted below.
#
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ $# -gt 1 ]]; then
  echo "usage: bash scripts/lint-state-paths.sh [scan-root]" >&2
  exit 2
fi

scan_root="${1:-src}"
if [[ ! -d "$scan_root" ]]; then
  echo "state-path lint: scan root does not exist: $scan_root" >&2
  exit 2
fi

matches_file=$(mktemp)
trap 'rm -f "$matches_file"' EXIT

pattern="['\"]\\.pan['\"][[:space:]]*,[[:space:]]*['\"](specs|drafts)['\"]|['\"]\\.pan/(specs|drafts)['\"]"
grep -RInE \
  --include='*.js' \
  --include='*.ts' \
  --include='*.tsx' \
  -- "$pattern" "$scan_root" > "$matches_file" || true

violations=0
while IFS= read -r match; do
  [[ -z "$match" ]] && continue

  path=${match%%:*}
  remainder=${match#*:}
  line_number=${remainder%%:*}
  source_line=${remainder#*:}

  relative_path=${path#"$scan_root"/}
  logical_path="src/$relative_path"

  case "$logical_path" in
    */__tests__/*|*.test.ts|*.test.tsx|*.test.js)
      continue
      ;;
    src/lib/pan-dir/*|\
    src/lib/state-read-home.ts|\
    src/lib/state-plane.ts|\
    src/lib/orders/validate.ts|\
    src/lib/cloister/merge-agent.ts|\
    src/lib/overdeck/planning-promotion.ts|\
    src/cli/commands/admin/state-migrate.ts|\
    src/lib/cloister/verification-runner.ts)
      continue
      ;;
  esac

  trimmed=${source_line#"${source_line%%[![:space:]]*}"}
  if [[ "$trimmed" =~ ^(//|/\*|\*|#) ]]; then
    continue
  fi

  printf '%s:%s:%s\n' "$logical_path" "$line_number" "$source_line"
  violations=$((violations + 1))
done < "$matches_file"

if (( violations > 0 )); then
  echo "✖ state-path lint found $violations direct spec/draft path derivation(s). Use getProjectPanPaths(projectRoot)." >&2
  exit 1
fi

echo "✓ state-path lint passed (canonical spec/draft paths use getProjectPanPaths)"
