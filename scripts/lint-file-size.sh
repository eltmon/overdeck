#!/usr/bin/env bash
#
# lint-file-size.sh — ceiling guard against god files (A3, codebase health).
# No new non-test src file may exceed CEILING lines. Existing files may not grow
# beyond their line count on BASE_REF unless scripts/file-size-allowlist.txt
# explicitly accepts audited growth with an issue reference.
#
# Modes:
#   (default)       evaluate the working tree (local lint)
#   --at <commit>   evaluate the tree AT a commit — used by .husky/pre-push so
#                   a dirty working tree never blocks pushing already-committed,
#                   legal state, and an over-cap tip cannot hide behind a clean
#                   working tree
#   --lower         ratchet allowlist entries DOWN to the current line count of
#                   their file (never raises, never runs the guard). Files with
#                   uncommitted changes are skipped — a cap must never be pinned
#                   to uncommitted content. Explicit opt-in: a plain lint run
#                   must never rewrite the allowlist.
#
set -euo pipefail

cd "$(dirname "$0")/.."

MODE=tree
AT_REF=""
if [[ $# -gt 0 ]]; then
  if [[ "${1:-}" == "--at" && -n "${2:-}" && $# -eq 2 ]]; then
    MODE=at
    AT_REF="$2"
  elif [[ "${1:-}" == "--lower" && $# -eq 1 ]]; then
    MODE=lower
  else
    echo "usage: bash scripts/lint-file-size.sh [--at <commit> | --lower]" >&2
    exit 2
  fi
fi

CEILING=1000
BASE_REF="${FILE_SIZE_BASE_REF:-origin/main}"
ALLOWLIST="scripts/file-size-allowlist.txt"
ISSUE_REF_RE='([A-Z]+-[0-9]+|#[0-9]+)'

if ! git rev-parse --verify --quiet "${BASE_REF}^{commit}" >/dev/null; then
  echo "✖ file-size guard cannot resolve base ref '$BASE_REF'. Fetch the merge target, or set FILE_SIZE_BASE_REF to a resolvable commit or ref." >&2
  exit 1
fi

if [[ "$MODE" == "at" ]] && ! git rev-parse --verify --quiet "${AT_REF}^{commit}" >/dev/null; then
  echo "✖ file-size guard cannot resolve --at ref '$AT_REF'." >&2
  exit 1
fi

read_allowlist() {
  if [[ "$MODE" == "at" ]]; then
    git show "$AT_REF:$ALLOWLIST"
  else
    cat "$ALLOWLIST"
  fi
}

declare -A exceptions
line_number=0
entries=0
malformed=""
while IFS= read -r line || [[ -n "$line" ]]; do
  (( ++line_number ))
  [[ "$line" =~ ^[[:space:]]*$ ]] && continue
  [[ "$line" =~ ^[[:space:]]*# ]] && continue

  if [[ "$line" =~ ^([0-9]+)[[:space:]]+([^[:space:]#]+)[[:space:]]+#[[:space:]]*${ISSUE_REF_RE}[[:space:]]*$ ]]; then
    exceptions["${BASH_REMATCH[2]}"]="${BASH_REMATCH[1]}"
    (( ++entries ))
  else
    malformed="$line_number: $line"
    break
  fi
done < <(read_allowlist 2>/dev/null || true)

if [[ -n "$malformed" ]] || (( entries == 0 )); then
  if [[ "$MODE" == "at" ]] && ! git cat-file -e "$AT_REF:$ALLOWLIST" 2>/dev/null; then
    echo "✖ missing $ALLOWLIST at $AT_REF — restore the audited-growth allowlist." >&2
    exit 1
  elif [[ "$MODE" != "at" ]] && [[ ! -f "$ALLOWLIST" ]]; then
    echo "✖ missing $ALLOWLIST — restore the audited-growth allowlist." >&2
    exit 1
  elif [[ -n "$malformed" ]]; then
    echo "✖ malformed $ALLOWLIST line $malformed" >&2
    echo "  expected: <lines> <path> # <ISSUE-REF>" >&2
    exit 1
  fi
fi

if [[ "$MODE" == "lower" ]]; then
  changed=0
  new_rows=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^[[:space:]]*$ ]] || [[ "$line" =~ ^[[:space:]]*# ]]; then
      new_rows+=("$line")
      continue
    fi
    [[ "$line" =~ ^([0-9]+)[[:space:]]+([^[:space:]#]+)[[:space:]]+#[[:space:]]*${ISSUE_REF_RE}[[:space:]]*$ ]]
    cap="${BASH_REMATCH[1]}"
    f="${BASH_REMATCH[2]}"
    ref="${BASH_REMATCH[3]}"
    if [[ ! -f "$f" ]]; then
      echo "· $f skipped — file no longer exists (entry left at $cap; drop it manually if the deletion is permanent)"
      new_rows+=("$cap $f # $ref")
      continue
    fi
    if [[ -n "$(git status --porcelain -- "$f")" ]]; then
      echo "· $f skipped — uncommitted changes (entry left at $cap; never pin a cap to uncommitted content)"
      new_rows+=("$cap $f # $ref")
      continue
    fi
    n=$(wc -l < "$f")
    if (( n < cap )); then
      echo "↓ $f $cap → $n"
      new_rows+=("$n $f # $ref")
      changed=1
    else
      new_rows+=("$line")
    fi
  done < "$ALLOWLIST"
  if (( changed )); then
    printf '%s\n' "${new_rows[@]}" > "$ALLOWLIST"
    echo "✓ allowlist lowered — review the diff and commit it"
  else
    echo "✓ no allowlist entry sits above its file's current line count"
  fi
  exit 0
fi

if [[ "$MODE" == "at" ]]; then
  file_list() {
    git ls-tree -r --name-only "$AT_REF" -- src \
      | grep -E '\.(ts|tsx)$' \
      | grep -vE '(\.test\.tsx?$|\.d\.ts$|/__tests__/|/node_modules/|/dist/)' \
      | sort
  }
  line_count() { git show "$AT_REF:$1" | wc -l; }
else
  file_list() {
    find src -type f \( -name '*.ts' -o -name '*.tsx' \) \
      ! -name '*.test.ts' ! -name '*.test.tsx' ! -name '*.d.ts' \
      ! -path '*/__tests__/*' ! -path '*/node_modules/*' ! -path '*/dist/*' \
      | sort
  }
  line_count() { wc -l < "$1"; }
fi

fail=0
while IFS= read -r f; do
  n=$(line_count "$f")
  if (( n <= CEILING )); then
    continue
  fi

  allowed="${exceptions["$f"]:-}"
  if [[ -z "$allowed" ]]; then
    if base_lines=$(git show "$BASE_REF:$f" 2>/dev/null | wc -l); then
      if (( base_lines > CEILING )); then
        allowed=$base_lines
      else
        allowed=$CEILING
      fi
    else
      allowed=$CEILING
    fi
  fi

  if (( n > allowed )); then
    echo "✖ $f is $n lines (allowed $allowed) — god files must shrink, not grow."
    echo "  Shrink the file, or add an audited exception to $ALLOWLIST:"
    echo "  $n $f # <ISSUE-REF>"
    fail=1
  fi
done < <(file_list)

if (( fail )); then
  echo ""
  if [[ "$MODE" == "at" ]]; then
    echo "file-size guard failed at $AT_REF. No commit pushed to $BASE_REF may grow a god file past its base count without an issue-referenced allowlist entry."
  else
    echo "file-size guard failed. Working-tree files may not exceed their $BASE_REF line count without an issue-referenced allowlist entry."
  fi
  exit 1
fi

if [[ "$MODE" == "at" ]]; then
  echo "✓ file-size guard passed at $AT_REF (no new god files; no existing god file grew past $BASE_REF)"
else
  echo "✓ file-size guard passed (no new god files; no existing god file grew past $BASE_REF)"
fi
