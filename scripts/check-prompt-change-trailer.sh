#!/usr/bin/env bash
set -euo pipefail

ROOT="${PROMPT_CHANGE_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT"

BASE_REF="${PROMPT_CHANGE_BASE_REF:-origin/main}"

log() {
  echo "prompt-trailer: $1"
}

fail() {
  echo "prompt-trailer: $1" >&2
}

# Determine the merge base against the configured base ref. If the base ref is
# unavailable (e.g., shallow clone without fetch-depth: 0), skip gracefully.
resolve_merge_base() {
  if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
    log "base ref $BASE_REF not found; skipping"
    exit 0
  fi
  git merge-base "$BASE_REF" HEAD
}

# List prompt files changed between the merge base and HEAD.
changed_prompt_files() {
  local merge_base="$1"
  git diff --name-only "$merge_base" HEAD | while read -r file; do
    if [[ "$file" == roles/*.md ]] || [[ "$file" == docs/flywheel-brief.md ]]; then
      echo "$file"
    fi
  done
}

# Check whether any commit in the current branch (merge_base..HEAD) contains a
# Prompt-Change: trailer.
has_prompt_change_trailer() {
  local merge_base="$1"
  local commit
  while read -r commit; do
    if [[ -n "$commit" ]] && git log -1 --format=%B "$commit" | grep -qE '^Prompt-Change:'; then
      return 0
    fi
  done < <(git rev-list "$merge_base"..HEAD)
  return 1
}

check() {
  local merge_base
  merge_base="$(resolve_merge_base)"

  local files
  files="$(changed_prompt_files "$merge_base" | sort -u | tr '\n' ' ')"
  files="${files% }"

  if [[ -z "$files" ]]; then
    log "no roles/*.md or docs/flywheel-brief.md changes; ok"
    exit 0
  fi

  log "changed prompt files: $files"

  if has_prompt_change_trailer "$merge_base"; then
    log "Prompt-Change trailer found; ok"
    exit 0
  fi

  fail "FAILED"
  fail "The PR changes load-bearing prompt files but no commit has a Prompt-Change: trailer." >&2
  fail "Changed files: $files" >&2
  fail "Add a trailer explaining the prompt change, e.g.:" >&2
  fail "" >&2
  fail "    Prompt-Change: clarified auto_pickup_backlog semantics" >&2
  fail "" >&2
  exit 1
}

self_test() {
  local tmp
  tmp="$(mktemp -d)"
  (
    cd "$tmp"
    git init -q
    git config user.email "test@example.com"
    git config user.name "Test"

    # Base history on "main".
    echo base >file.txt
    git add file.txt
    git commit -q -m "base"
    git branch -m main
    git checkout -q -b topic

    # No prompt change -> should pass.
    echo change >>file.txt
    git add file.txt
    git commit -q -m "non-prompt change"
    if ! PROMPT_CHANGE_ROOT="$tmp" PROMPT_CHANGE_BASE_REF=main bash "$ROOT/scripts/check-prompt-change-trailer.sh"; then
      echo "self-test failed: non-prompt change should pass" >&2
      exit 1
    fi

    # Prompt change without trailer -> should fail.
    mkdir -p roles
    echo '# prompt' >roles/flywheel.md
    git add roles/flywheel.md
    git commit -q -m "update flywheel prompt"
    if PROMPT_CHANGE_ROOT="$tmp" PROMPT_CHANGE_BASE_REF=main bash "$ROOT/scripts/check-prompt-change-trailer.sh"; then
      echo "self-test failed: prompt change without trailer should fail" >&2
      exit 1
    fi

    # Prompt change with trailer -> should pass.
    echo '# prompt v2' >roles/flywheel.md
    git add roles/flywheel.md
    git commit -q -m "update flywheel prompt

Prompt-Change: clarified auto_pickup_backlog semantics"
    if ! PROMPT_CHANGE_ROOT="$tmp" PROMPT_CHANGE_BASE_REF=main bash "$ROOT/scripts/check-prompt-change-trailer.sh"; then
      echo "self-test failed: prompt change with trailer should pass" >&2
      exit 1
    fi
  )
  rm -rf "$tmp"
  log "self-test passed"
}

if [[ "${1:-}" == "--self-test" ]]; then
  self_test
  exit 0
fi

check
