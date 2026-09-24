#!/usr/bin/env bash
#
# lint-harness-storage.sh — one owner per harness for transcript/session/home
# paths (PAN-3958 CH-7, W9/D11). Where a harness keeps its transcripts is known
# only by src/lib/runtimes/storage/<harness>.ts; every other file asks those
# modules. This guard fails when a storage path literal (a Claude project dir, a
# Codex sessions dir or per-agent codex-home, a Kimi home or wire file, the ACP
# transcript file name, a Muse data dir, a Pi sessions dir) appears in src/
# outside that directory.
#
# Tests and comment lines are ignored. A line that must keep a literal for a
# reason other than finding a transcript goes in ALLOWLIST below as
# "file|anchor # PAN-3958 reason": the row allows any flagged line in that file
# whose text contains the anchor (a fixed substring, not a regex), so edits
# elsewhere in the file never break it. A row whose anchor no longer appears on
# any flagged line of its file fails too, so the list only shrinks.
set -euo pipefail

cd "$(dirname "$0")/.."

# --- allowlist ---
ALLOWLIST=$(cat <<'ALLOW'
src/lib/claude-settings-overlay.ts|'Bash(rm # PAN-3958 rm deny rules protecting transcripts, not a lookup
src/lib/remote/remote-completion.ts|fly.ssh(vmName, 'ls /.claude/projects/ # PAN-3958 shell glob run on a remote Fly VM, not a local path
src/lib/harness-binary.ts|join(home, '.kimi-code', 'bin') # PAN-3958 Kimi binary install dir, not transcript storage
src/cli/commands/conversations/index.ts|.description('Scan ~/.claude/projects/ # PAN-3958 CLI help text
src/cli/commands/conversations/index.ts|.option('--system', 'Scan system-wide ~/.claude/projects/ # PAN-3958 CLI help text
ALLOW
)
# --- end allowlist ---

PATTERN="[\"']\\.claude[\"'][[:space:]]*,[[:space:]]*[\"']projects[\"']"
PATTERN+="|\\.claude/projects"
PATTERN+="|[\"']\\.codex[\"'][[:space:]]*,[[:space:]]*[\"']sessions[\"']"
PATTERN+="|\\.codex/sessions"
PATTERN+="|,[[:space:]]*[\"']codex-home[\"']"
PATTERN+="|[\"']\\.kimi-code[\"']"
PATTERN+="|[\"']agents[\"'][[:space:]]*,[[:space:]]*[\"']main[\"'][[:space:]]*,[[:space:]]*[\"']wire\\.jsonl[\"']"
PATTERN+="|agents/main/wire\\.jsonl"
PATTERN+="|acp-session\\.jsonl"
PATTERN+="|muse-data"
PATTERN+="|[\"']\\.pi[\"'][[:space:]]*,[[:space:]]*[\"']agent[\"'][[:space:]]*,[[:space:]]*[\"']sessions[\"']"
PATTERN+="|\\.pi/agent/sessions"

# Parallel arrays of allowlist rows: file and anchor.
allow_files=()
allow_anchors=()
while IFS= read -r row; do
  [[ -z "$row" ]] && continue
  row="${row%% # PAN-*}"
  allow_files+=("${row%%|*}")
  allow_anchors+=("${row#*|}")
done <<<"$ALLOWLIST"

hits=""
if [[ -d src ]]; then
  hits=$(
    grep -rnE --include='*.ts' --include='*.tsx' "$PATTERN" src 2>/dev/null |
      grep -vE '^src/lib/runtimes/storage/' |
      grep -vE '^[^:]*(\.test\.tsx?|/__tests__/)' |
      grep -vE '^[^:]+:[0-9]+:[[:space:]]*(\*|//|/\*)' || true
  )
fi

fail=0
declare -a row_used
for i in "${!allow_files[@]}"; do row_used[$i]=0; done

while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  file="${line%%:*}"
  rest="${line#*:}"
  content="${rest#*:}"
  allowed=0
  for i in "${!allow_files[@]}"; do
    if [[ "${allow_files[$i]}" == "$file" && "$content" == *"${allow_anchors[$i]}"* ]]; then
      allowed=1
      row_used[$i]=1
    fi
  done
  if (( ! allowed )); then
    echo "✗ harness storage path outside src/lib/runtimes/storage/: $line"
    fail=1
  fi
done <<<"$hits"

for i in "${!allow_files[@]}"; do
  if (( ! row_used[$i] )); then
    echo "✗ stale allowlist row in scripts/lint-harness-storage.sh: ${allow_files[$i]}|${allow_anchors[$i]} matches no storage path in that file; delete the row"
    fail=1
  fi
done

if (( fail )); then
  echo "Ask src/lib/runtimes/storage/<harness>.ts for the path instead of rebuilding it (PAN-3958 CH-7)."
  exit 1
fi

echo "✓ harness storage paths live only in src/lib/runtimes/storage/"
