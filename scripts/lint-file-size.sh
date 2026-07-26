#!/usr/bin/env bash
#
# lint-file-size.sh — ceiling guard against god files (A3, codebase health).
# No new non-test src file may exceed CEILING lines. Existing files may not grow
# beyond their line count on BASE_REF unless scripts/file-size-allowlist.txt
# explicitly accepts audited growth with an issue reference.
#
set -euo pipefail

if [[ $# -gt 0 ]]; then
  echo "usage: bash scripts/lint-file-size.sh" >&2
  exit 2
fi

cd "$(dirname "$0")/.."

CEILING=1000
BASE_REF="${FILE_SIZE_BASE_REF:-origin/main}"
ALLOWLIST="scripts/file-size-allowlist.txt"
ISSUE_REF_RE='([A-Z]+-[0-9]+|#[0-9]+)'

if ! git rev-parse --verify --quiet "${BASE_REF}^{commit}" >/dev/null; then
  echo "✖ file-size guard cannot resolve base ref '$BASE_REF'. Fetch the merge target, or set FILE_SIZE_BASE_REF to a resolvable commit or ref." >&2
  exit 1
fi

if [[ ! -f "$ALLOWLIST" ]]; then
  echo "✖ missing $ALLOWLIST — restore the audited-growth allowlist." >&2
  exit 1
fi

declare -A exceptions
line_number=0
while IFS= read -r line || [[ -n "$line" ]]; do
  (( ++line_number ))
  [[ "$line" =~ ^[[:space:]]*$ ]] && continue
  [[ "$line" =~ ^[[:space:]]*# ]] && continue

  if [[ "$line" =~ ^([0-9]+)[[:space:]]+([^[:space:]#]+)[[:space:]]+#[[:space:]]*${ISSUE_REF_RE}[[:space:]]*$ ]]; then
    exceptions["${BASH_REMATCH[2]}"]="${BASH_REMATCH[1]}"
  else
    echo "✖ malformed $ALLOWLIST line $line_number: $line" >&2
    echo "  expected: <lines> <path> # <ISSUE-REF>" >&2
    exit 1
  fi
done < "$ALLOWLIST"

fail=0
while IFS= read -r f; do
  n=$(wc -l < "$f")
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
done < <(
  find src -type f \( -name '*.ts' -o -name '*.tsx' \) \
    ! -name '*.test.ts' ! -name '*.test.tsx' ! -name '*.d.ts' \
    ! -path '*/__tests__/*' ! -path '*/node_modules/*' ! -path '*/dist/*' \
    | sort
)

if (( fail )); then
  echo ""
  echo "file-size guard failed. Working-tree files may not exceed their $BASE_REF line count without an issue-referenced allowlist entry."
  exit 1
fi

echo "✓ file-size guard passed (no new god files; no existing god file grew past $BASE_REF)"
