#!/usr/bin/env bash
#
# lint-ratchet-audit.sh — require issue references for ratchet increases.
# Lowering file-size baselines and removing allowlist entries is always free.
# Raising/adding either ratchet must happen in a commit whose message includes
# an issue reference matching ([A-Z]+-[0-9]+|#[0-9]+).
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

BASELINE="scripts/file-size-baseline.txt"
CIRCULAR_BASELINE="scripts/circular-deps-baseline.txt"
ALLOWLIST="eslint-any-allowlist.json"
ISSUE_REF_RE='([A-Z]+-[0-9]+|#[0-9]+)'

declare -A seen_commits

baseline_at() {
  local rev="$1"
  { git show "$rev:$BASELINE" 2>/dev/null || true; } | awk '$1 ~ /^[0-9]+$/ && NF >= 2 { print $1, $2 }' | sort -k2
}

allowlist_at() {
  local rev="$1"
  { git show "$rev:$ALLOWLIST" 2>/dev/null || true; } |
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

parent_baseline_at() {
  for parent in "$@"; do
    baseline_at "$parent"
  done | awk '
    !($2 in max) || $1 > max[$2] { max[$2] = $1 }
    END { for (path in max) print max[path], path }
  ' | sort -k2
}

parent_allowlist_at() {
  for parent in "$@"; do
    allowlist_at "$parent"
  done | sort -u
}

baseline_increases_for_commit() {
  local commit="$1"
  shift
  local old_file new_file
  old_file=$(mktemp)
  new_file=$(mktemp)
  parent_baseline_at "$@" > "$old_file"
  baseline_at "$commit" > "$new_file"
  awk '
    FILENAME == ARGV[1] { old[$2] = $1; next }
    !($2 in old) { print "baseline added: " $2 " (" $1 " lines)"; next }
    $1 > old[$2] { print "baseline raised: " $2 " " old[$2] " -> " $1 }
  ' "$old_file" "$new_file"
  rm -f "$old_file" "$new_file"
}

allowlist_increases_for_commit() {
  local commit="$1"
  shift
  local old_file new_file
  old_file=$(mktemp)
  new_file=$(mktemp)
  parent_allowlist_at "$@" > "$old_file"
  allowlist_at "$commit" > "$new_file"
  comm -13 "$old_file" "$new_file" | sed 's/^/allowlist added: /'
  rm -f "$old_file" "$new_file"
}

circular_baseline_increases_for_commit() {
  local commit="$1"
  shift
  local old_file new_file
  old_file=$(mktemp)
  new_file=$(mktemp)
  parent_circular_baseline_at "$@" > "$old_file"
  circular_baseline_at "$commit" > "$new_file"
  comm -13 "$old_file" "$new_file" | sed 's/^/circular baseline added: /'
  rm -f "$old_file" "$new_file"
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
    baseline_increases_for_commit "$commit" "${parents[@]}"
    allowlist_increases_for_commit "$commit" "${parents[@]}"
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

for file in "$BASELINE" "$ALLOWLIST" "$CIRCULAR_BASELINE"; do
  while IFS= read -r commit; do
    [[ -z "$commit" ]] && continue
    audit_commit "$commit"
  done < <(commits_for_file "$file")
done

echo "✓ ratchet audit passed (no unaudited baseline/allowlist/circular-baseline increases)"
