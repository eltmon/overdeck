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
