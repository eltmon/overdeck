#!/usr/bin/env bash
set -euo pipefail
source_root=$(cd "$(dirname "$0")/.." && pwd)

if [[ "${1:-}" != "--branch" || -z "${2:-}" || "${3:-}" != "--range" || -z "${4:-}" ]]; then
  echo "usage: $0 --branch <branch> --range <base..tip>" >&2
  exit 2
fi

branch=$2
range=$4
mapfile -t state_paths < <(
  sed -n '/export const STATE_BRANCH_PATHS = \[/,/\] as const/p' "$source_root/src/lib/state-plane.ts" \
    | sed -n "s/^[[:space:]]*'\([^']*\)'.*/\1/p"
)

is_state_branch_path() {
  local path=$1 prefix
  [[ "$path" == "migration-complete.json" ]] && return 0
  for prefix in "${state_paths[@]}"; do
    [[ "$path" == "${prefix%/}" || "$path" == "$prefix"* ]] && return 0
  done
  return 1
}

if [[ "$branch" == "overdeck-state" ]]; then
  violations=""
  while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    is_state_branch_path "$path" || violations+="$path"$'\n'
  done < <(git diff --name-only "$range")
  if [[ -n "$violations" ]]; then
    echo "✖ overdeck-state may contain only STATE_BRANCH_PATHS and migration-complete.json:" >&2
    printf '%s' "$violations" >&2
    exit 1
  fi
  exit 0
fi

# Ancestry guard: a merge with --allow-unrelated-histories (e.g. strategy
# "ours") can graft overdeck-state's history into a code branch WITHOUT adding
# any state files, evading the content check below. If the state branch's
# orphan root commit is an ancestor of the candidate tip, the histories were
# connected — refuse regardless of file content.
tip=${range##*..}
state_ref=""
for candidate in refs/remotes/origin/overdeck-state refs/heads/overdeck-state; do
  git rev-parse --verify --quiet "$candidate" >/dev/null && { state_ref=$candidate; break; }
done
if [[ -n "$state_ref" ]]; then
  state_root=$(git rev-list --max-parents=0 "$state_ref" | tail -1)
  if [[ -n "$state_root" ]] && git merge-base --is-ancestor "$state_root" "$tip" 2>/dev/null; then
    echo "✖ candidate history contains overdeck-state's orphan root ($state_root)." >&2
    echo "  main and overdeck-state must never merge (PAN-2541 D8) — even an" >&2
    echo "  'ours' merge that adds no files. Drop the merge commit and retry." >&2
    exit 1
  fi
fi

violations=""
while IFS=$'\t' read -r status path rest; do
  [[ -z "$status" || "$status" == D* ]] && continue
  [[ "$status" == R* || "$status" == C* ]] && path=$rest
  for prefix in "${state_paths[@]}"; do
    legacy=".pan/$prefix"
    [[ "$prefix" == ".beads/" ]] && legacy="$prefix"
    if [[ "$path" == "${legacy%/}" || "$path" == "$legacy"* ]]; then
      violations+="$path"$'\n'
      break
    fi
  done
done < <(git diff --name-status "$range")

if [[ -n "$violations" ]]; then
  echo "✖ code branches may delete migrated state paths but may not add or modify them:" >&2
  printf '%s' "$violations" >&2
  exit 1
fi
