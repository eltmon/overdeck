#!/usr/bin/env bash
#
# lint-last-verified.sh — every codebase-map footer must be exactly
# `<!-- last-verified: YYYY-MM-DD -->` (PAN-5020). Agents appended issue ids to
# the footer, so every parallel PR edited the same line and conflicted.
# Provenance belongs in commit messages. A footer is a line that starts with
# `<!-- last-verified`; prose that mentions the word mid-line is not checked.
# The number of footers is NOT checked: a union merge of concerns.md can leave
# two date-only footers on main, and a red lint there would block every merge.
set -euo pipefail
cd "$(dirname "$0")/.."

MAP_DIR=".overdeck/context/codebase"
FOOTER_RE='^[[:space:]]*<!--[[:space:]]*last-verified'
VALID_RE='^<!-- last-verified: [0-9]{4}-[0-9]{2}-[0-9]{2} -->$'

shopt -s nullglob
files=("$MAP_DIR"/*.md)
if [[ ${#files[@]} -eq 0 ]]; then
  echo "✓ lint:last-verified passed (no codebase map)"
  exit 0
fi

checked=0
fail=0
for file in "${files[@]}"; do
  lineno=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    lineno=$((lineno + 1))
    [[ "$line" =~ $FOOTER_RE ]] || continue
    checked=$((checked + 1))
    if [[ ! "$line" =~ $VALID_RE ]]; then
      echo "✖ $file:$lineno: ${line:0:100}" >&2
      fail=1
    fi
  done < "$file"
done

if (( fail )); then
  echo "" >&2
  echo "lint:last-verified failed. A codebase-map footer holds only the date:" >&2
  echo "  <!-- last-verified: YYYY-MM-DD -->" >&2
  echo "Put issue ids and other provenance in the commit message." >&2
  exit 1
fi

echo "✓ lint:last-verified passed ($checked footer lines checked)"
