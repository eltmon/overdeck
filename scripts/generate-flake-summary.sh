#!/usr/bin/env bash
#
# generate-flake-summary.sh — emit a markdown summary of quarantined flaky tests.
# Reads scripts/flaky-quarantine.txt and prints a markdown table to stdout.
# The flake-lane CI job posts this summary as a PR comment.
#
set -euo pipefail
cd "$(dirname "$0")/.."

QUARANTINE="scripts/flaky-quarantine.txt"
MARKER='<!-- flake-lane-summary -->'

printf '%s\n\n' "$MARKER"
printf '## 🧪 Flake Lane Summary\n\n'
printf 'Tests in this table are quarantined: they are excluded from blocking CI runs and run instead in the non-blocking flake-lane job with retry enabled.\n\n'

if [[ ! -s "$QUARANTINE" ]]; then
  printf '*No tests are currently quarantined.*\n'
  exit 0
fi

printf '| Test file | Tracking issue |\n'
printf '|-----------|----------------|\n'

while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "${line// /}" ]] && continue
  [[ "$line" =~ ^[[:space:]]*# ]] && continue

  # Split path and comment/ref.
  path="${line%%#*}"
  path="${path%%[[:space:]]}"
  # Trim all trailing whitespace from the path (the format allows multiple
  # spaces before the inline comment).
  path="$(printf '%s' "$path" | sed 's/[[:space:]]*$//')"
  rest="${line#*#}"
  rest="${rest##[[:space:]]}"

  # Extract the first issue ref from the comment.
  issue_ref=''
  if [[ "$rest" =~ ([A-Z]+-[0-9]+|#[0-9]+) ]]; then
    issue_ref="${BASH_REMATCH[1]}"
  fi

  issue_link="$issue_ref"
  if [[ "$issue_ref" =~ ^PAN-[0-9]+$ ]]; then
    issue_link="[${issue_ref}](https://github.com/eltmon/overdeck/issues/${issue_ref#PAN-})"
  elif [[ "$issue_ref" =~ ^#[0-9]+$ ]]; then
    issue_link="[${issue_ref}](https://github.com/eltmon/overdeck/issues/${issue_ref# #})"
  fi

  printf '| `%s` | %s |\n' "$path" "$issue_link"
done < "$QUARANTINE"
