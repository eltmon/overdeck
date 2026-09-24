#!/usr/bin/env bash
#
# lint-harness-storage.sh — one owner per harness for transcript/session/home
# paths (PAN-3958 CH-7, W9/D11). Where a harness keeps its transcripts is known
# only by src/lib/runtimes/storage/<harness>.ts; every other file asks those
# modules. This guard fails when a storage path literal (a Claude project dir, a
# Codex sessions dir, a Kimi home or wire file, the ACP transcript file name, a
# Muse data dir, a Pi sessions dir) appears in src/ outside that directory.
#
# Tests and comment lines are ignored. A line that must keep a literal for a
# reason other than finding a transcript goes in ALLOWLIST below as
# "file:line # PAN-3958 reason". An allowlist row whose line no longer matches
# fails too, so the list only shrinks.
set -euo pipefail

cd "$(dirname "$0")/.."

# --- allowlist ---
ALLOWLIST=$(cat <<'ALLOW'
src/lib/claude-settings-overlay.ts:73 # PAN-3958 permission deny rule protecting transcripts, not a lookup
src/lib/claude-settings-overlay.ts:74 # PAN-3958 permission deny rule protecting transcripts, not a lookup
src/lib/claude-settings-overlay.ts:75 # PAN-3958 permission deny rule protecting transcripts, not a lookup
src/lib/claude-settings-overlay.ts:93 # PAN-3958 permission deny rule protecting transcripts, not a lookup
src/lib/claude-settings-overlay.ts:94 # PAN-3958 permission deny rule protecting transcripts, not a lookup
src/lib/remote/remote-completion.ts:198 # PAN-3958 shell glob run on a remote Fly VM, not a local path
src/lib/harness-binary.ts:193 # PAN-3958 Kimi binary install dir, not transcript storage
src/cli/commands/conversations/index.ts:31 # PAN-3958 CLI help text
src/cli/commands/conversations/index.ts:33 # PAN-3958 CLI help text
ALLOW
)
# --- end allowlist ---

PATTERN="[\"']\\.claude[\"'][[:space:]]*,[[:space:]]*[\"']projects[\"']"
PATTERN+="|\\.claude/projects"
PATTERN+="|[\"']\\.codex[\"'][[:space:]]*,[[:space:]]*[\"']sessions[\"']"
PATTERN+="|\\.codex/sessions"
PATTERN+="|[\"']\\.kimi-code[\"']"
PATTERN+="|[\"']agents[\"'][[:space:]]*,[[:space:]]*[\"']main[\"'][[:space:]]*,[[:space:]]*[\"']wire\\.jsonl[\"']"
PATTERN+="|agents/main/wire\\.jsonl"
PATTERN+="|acp-session\\.jsonl"
PATTERN+="|muse-data"
PATTERN+="|[\"']\\.pi[\"'][[:space:]]*,[[:space:]]*[\"']agent[\"'][[:space:]]*,[[:space:]]*[\"']sessions[\"']"
PATTERN+="|\\.pi/agent/sessions"

allowed_keys=$(printf '%s\n' "$ALLOWLIST" | sed -E 's/[[:space:]]*#.*$//' | sed '/^$/d' | sort -u)

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
hit_keys=$(printf '%s\n' "$hits" | sed '/^$/d' | cut -d: -f1,2 | sort -u)

while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  key=$(printf '%s' "$line" | cut -d: -f1,2)
  if ! grep -qxF "$key" <<<"$allowed_keys"; then
    echo "✗ harness storage path outside src/lib/runtimes/storage/: $line"
    fail=1
  fi
done <<<"$hits"

while IFS= read -r key; do
  [[ -z "$key" ]] && continue
  if ! grep -qxF "$key" <<<"$hit_keys"; then
    echo "✗ stale allowlist row in scripts/lint-harness-storage.sh: $key no longer holds a storage path; delete the row"
    fail=1
  fi
done <<<"$allowed_keys"

if (( fail )); then
  echo "Ask src/lib/runtimes/storage/<harness>.ts for the path instead of rebuilding it (PAN-3958 CH-7)."
  exit 1
fi

echo "✓ harness storage paths live only in src/lib/runtimes/storage/"
