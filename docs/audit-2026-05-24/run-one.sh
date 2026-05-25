#!/usr/bin/env bash
set -uo pipefail
ISSUE="$1"
OUT_DIR="/tmp/audit-pass3"
CONTEXT="${OUT_DIR}/contexts/PAN-${ISSUE}.md"
RESULT="${OUT_DIR}/results/PAN-${ISSUE}.md"
ERR="${OUT_DIR}/stderr/PAN-${ISSUE}.log"
cd /home/eltmon/Projects/panopticon-cli

# Gather context (fast)
{
  echo "## ORIGINAL ISSUE BODY"
  gh issue view "$ISSUE" -R eltmon/panopticon-cli 2>&1
  echo
  echo "## MERGE COMMIT(s)"
  git log main --grep "PAN-${ISSUE}\|(#" -n 5 --format="%h %ci %s" 2>&1 | grep -iE "pan-${ISSUE}\\b|(#.*${ISSUE})" | head -5
  echo
  echo "## RECENT FILE CHANGES (look for merge commits)"
  for sha in $(git log main --grep "PAN-${ISSUE}\|(#" -n 20 --format="%H" 2>&1 | head -5); do
    echo "### $sha"
    git show "$sha" --stat 2>&1 | head -40
    echo
  done
} > "$CONTEXT" 2>&1

# Construct + dispatch
{
  cat "${OUT_DIR}/prompt-template.md"
  echo
  echo "---"
  echo "## CONTEXT FOR PAN-${ISSUE}"
  # Replace {ISSUE_NUM} placeholder
  sed "s/{ISSUE_NUM}/${ISSUE}/g" "$CONTEXT"
  echo
  echo "Now produce the audit comment for PAN-${ISSUE}. Use tools to verify each AC. Save any UI screenshots to /tmp/audit-pass3/screenshots/PAN-${ISSUE}-<view>.png."
} | ANTHROPIC_BASE_URL="http://127.0.0.1:8317" \
    ANTHROPIC_AUTH_TOKEN="panopticon-local-cliproxy-key" \
    timeout 600 claude --print --model gpt-5.5 --permission-mode bypassPermissions \
    > "$RESULT" 2> "$ERR"

EXIT=$?
echo "$(date -Iseconds) PAN-${ISSUE} exit=${EXIT} result=$(wc -c < "$RESULT") bytes" >> "${OUT_DIR}/progress.log"
exit $EXIT
