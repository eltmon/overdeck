#!/usr/bin/env bash
#
# lint-ratchet-audit.sh — require issue references for ratchet increases.
# File-size exceptions carry their issue reference in each mandatory allowlist
# row and are validated by lint-file-size.sh before this audit runs. Removing
# ESLint allowlist entries and updating circular baseline paths to follow
# source-file renames are always free. Raising either remaining ratchet must
# happen in a commit whose message includes an issue reference matching
# ([A-Z]+-[0-9]+|#[0-9]+).
#
set -euo pipefail
cd "$(dirname "$0")/.."

MODE=last
RANGE=""
if [[ "${1:-}" == "--range" && -n "${2:-}" && $# -eq 2 ]]; then
  MODE=range
  RANGE="$2"
elif [[ $# -ne 0 ]]; then
  echo "usage: bash scripts/lint-ratchet-audit.sh [--range <base>..<head>]" >&2
  exit 2
fi

CIRCULAR_BASELINE="scripts/circular-deps-baseline.txt"
ESLINT_ALLOWLIST="eslint-any-allowlist.json"
ISSUE_REF_RE='([A-Z]+-[0-9]+|#[0-9]+)'

declare -A seen_commits

eslint_allowlist_at() {
  local rev="$1"
  { git show "$rev:$ESLINT_ALLOWLIST" 2>/dev/null || true; } |
    node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{if(!d.trim())return;JSON.parse(d).forEach(p=>console.log(p))})" |
    sort -u
}

circular_baseline_at() {
  local rev="$1"
  { git show "$rev:$CIRCULAR_BASELINE" 2>/dev/null || true; } | grep -v '^[[:space:]]*$' | sort -u
}

parent_circular_baseline_at() {
  for parent in "$@"; do
    circular_baseline_at "$parent"
  done | sort -u
}

parent_eslint_allowlist_at() {
  for parent in "$@"; do
    eslint_allowlist_at "$parent"
  done | sort -u
}

eslint_allowlist_increases_for_commit() {
  local commit="$1"
  shift
  local old_file new_file
  old_file=$(mktemp)
  new_file=$(mktemp)
  parent_eslint_allowlist_at "$@" > "$old_file"
  eslint_allowlist_at "$commit" > "$new_file"
  comm -13 "$old_file" "$new_file" | sed 's/^/allowlist added: /'
  rm -f "$old_file" "$new_file"
}

circular_baseline_increases_for_commit() {
  local commit="$1"
  shift
  local old_file new_file added_file removed_file renames_file
  old_file=$(mktemp)
  new_file=$(mktemp)
  added_file=$(mktemp)
  removed_file=$(mktemp)
  renames_file=$(mktemp)
  parent_circular_baseline_at "$@" > "$old_file"
  circular_baseline_at "$commit" > "$new_file"
  comm -13 "$old_file" "$new_file" > "$added_file"
  comm -23 "$old_file" "$new_file" > "$removed_file"
  git log --format= --name-status --find-renames "$commit" > "$renames_file"
  node - "$removed_file" "$added_file" "$renames_file" <<'NODE'
const fs = require('fs')
const [removedPath, addedPath, renamesPath] = process.argv.slice(2)
const lines = (path) => fs.readFileSync(path, 'utf8').split('\n').filter(Boolean)
const removed = lines(removedPath)
const added = lines(addedPath)
const renameEdges = new Map()

for (const line of lines(renamesPath)) {
  const [status, from, to] = line.split('\t')
  if (!/^R\d*$/.test(status) || !from || !to) continue
  const destinations = renameEdges.get(from) ?? new Set()
  destinations.add(to)
  renameEdges.set(from, destinations)
}

function followsRename(from, to) {
  if (from === to) return true
  const pending = [from]
  const seen = new Set(pending)
  while (pending.length > 0) {
    const current = pending.pop()
    for (const next of renameEdges.get(current) ?? []) {
      if (next === to) return true
      if (!seen.has(next)) {
        seen.add(next)
        pending.push(next)
      }
    }
  }
  return false
}

for (const addition of added) {
  const addedPaths = addition.split(' > ')
  const migratedIndex = removed.findIndex((candidate) => {
    const removedPaths = candidate.split(' > ')
    return removedPaths.length === addedPaths.length &&
      removedPaths.some((path, index) => path !== addedPaths[index]) &&
      removedPaths.every((path, index) => followsRename(path, addedPaths[index]))
  })
  if (migratedIndex >= 0) {
    removed.splice(migratedIndex, 1)
  } else {
    console.log(`circular baseline added: ${addition}`)
  }
}
NODE
  rm -f "$old_file" "$new_file" "$added_file" "$removed_file" "$renames_file"
}

commit_has_issue_ref() {
  local commit="$1"
  git log -1 --format=%B "$commit" | grep -Eq "$ISSUE_REF_RE"
}

audit_commit() {
  local commit="$1"

  if [[ -n "${seen_commits[$commit]:-}" ]]; then
    return 0
  fi
  seen_commits["$commit"]=1

  if ! git rev-parse -q --verify "$commit^" >/dev/null; then
    echo "⚠ ratchet audit: cannot see parent of ${commit:0:12} — skipping (pre-push range mode is the primary gate)"
    return 0
  fi

  local parents
  read -r -a parents <<< "$(git rev-list --parents -n 1 "$commit" | cut -d' ' -f2-)"

  local increases
  increases=$(
    eslint_allowlist_increases_for_commit "$commit" "${parents[@]}"
    circular_baseline_increases_for_commit "$commit" "${parents[@]}"
  )

  if [[ -z "$increases" ]]; then
    return 0
  fi

  if commit_has_issue_ref "$commit"; then
    return 0
  fi

  local subject
  subject=$(git log -1 --format=%s "$commit")
  echo "✖ ratchet audit: commit ${commit:0:12} ($subject) increases a ratchet without an issue reference"
  echo "$increases"
  echo "A ratchet increase must reference an issue — amend the commit message with e.g. PAN-XXXX."
  exit 1
}

commits_for_file() {
  local file="$1"
  if [[ "$MODE" == "range" ]]; then
    git rev-list --reverse "$RANGE" -- "$file"
  else
    git log -1 --format=%H -- "$file"
  fi
}

for file in "$ESLINT_ALLOWLIST" "$CIRCULAR_BASELINE"; do
  while IFS= read -r commit; do
    [[ -z "$commit" ]] && continue
    audit_commit "$commit"
  done < <(commits_for_file "$file")
done

echo "✓ ratchet audit passed (no unaudited ESLint/circular ratchet increases)"
