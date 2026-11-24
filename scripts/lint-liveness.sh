#!/usr/bin/env bash
# PAN-3849 (W32, FR-23): one liveness oracle. Every "is this agent alive" or
# "is this agent idle" decision goes through src/lib/agents/liveness.ts; the
# migrated consumers must not re-introduce private predicates built on
# sessionExists(/sessionExistsSync(/pane_dead, and the retired
# cloister/agent-idle.ts module must not be re-imported.
#
# PAN-5652: tmux `sessionExists`/`sessionExistsSync` from src/lib/tmux.ts is
# false for every Herdr agent, so an agent-liveness check built on it reads a
# live agent as stopped. Each src/ file that imports it is counted against
# scripts/tmux-session-exists-baseline.txt (rows: <count> <path>, where count is
# the file's non-comment lines naming sessionExists). A new file, or a higher
# count, fails. Ask agent liveness through src/lib/agents/liveness.ts (isAlive)
# or pane presence through terminal-backends/launch.ts (agentPaneExists). Keep a
# tmux call only for a genuinely tmux-only session (an upgrade or login session,
# a terminal attach, the tmux backend adapter) and raise its row by hand in a
# commit with an issue reference (scripts/lint-ratchet-audit.sh enforces that).
#
#   bash scripts/lint-liveness.sh              check
#   bash scripts/lint-liveness.sh --update     lower the tmux sessionExists baseline
#   bash scripts/lint-liveness.sh --self-test  prove the guards reject seeded violations
set -euo pipefail
export LC_ALL=C

cd "$(dirname "$0")/.."

fail=0

LIVENESS_MODULE="src/lib/agents/liveness.ts"

CONSUMERS=(
  src/lib/parked/resolver.ts
  src/lib/cloister/feedback-target.ts
  src/lib/work-agent-lifecycle.ts
  src/lib/agents/messaging.ts
  src/lib/work-agent-conflicts.ts
)

# #4109: modules that used to filter on the tmux-only `tmuxActive` flag (false
# for every Herdr agent). Each now reads the backend-aware door — the liveness
# oracle or the terminal backend's live inventory — and must not read
# `.tmuxActive` again. Compatibility fields may still be WRITTEN elsewhere.
TMUX_FLAG_CONSUMERS=(
  src/lib/cloister/memory-governor.ts
  src/lib/cloister/service-health.ts
  src/lib/cloister/service-status.ts
  src/lib/cloister/service.ts
  src/lib/health.ts
  src/lib/memory/transcript-source.ts
  src/lib/reconstruct/reconstruct-cache.ts
  src/cli/commands/workspace-maintenance.ts
  src/dashboard/server/routes/agents/lifecycle-restart.ts
  src/dashboard/server/routes/misc/health.ts
  src/dashboard/server/services/agent-output-service.ts
  src/dashboard/server/services/cloister-control-surface.ts
  src/dashboard/server/telemetry.ts
)

BACKEND_DOOR_PATTERN="['\"][./]*(lib/)?(agents/|terminal-backends/)?(liveness|inventory)\\.js['\"]"
TMUX_FLAG_READ_PATTERN='\.tmuxActive\b'

require_reference() {
  local file="$1" pattern="$2" label="$3"
  if ! rg -q "$pattern" "$file"; then
    echo "✗ liveness boundary: $label no longer delegates through the liveness oracle ($file)"
    fail=1
  fi
}

ban_pattern() {
  local file="$1" pattern="$2" label="$3"
  if rg -n "$pattern" "$file"; then
    echo "✗ liveness boundary: $label reintroduced a private liveness predicate ($file)"
    fail=1
  fi
}

TMUX_PROBE_BASELINE="scripts/tmux-session-exists-baseline.txt"
TMUX_PROBE_HEADER_1="# tmux sessionExists ratchet baseline (PAN-5652). Rows: <count> <path>."
TMUX_PROBE_HEADER_2="# Lower with: bash scripts/lint-liveness.sh --update"

# The specifier of src/lib/tmux.ts from anywhere in src/ ('./tmux.js',
# '../tmux.js', '../../../lib/tmux.js'), never '../terminal-backends/tmux.js'.
TMUX_SPEC="['\"](\\.{1,2}/)+(lib/)?tmux\\.js['\"]"
TMUX_PROBE_NAME='\bsessionExists(Sync)?\b'
# Static import (aliases and multi-line lists included), a dynamic-import
# destructure, and the TmuxService member.
TMUX_PROBE_IMPORT="import[[:space:]]*\\{[^}]*${TMUX_PROBE_NAME}[^}]*\\}[[:space:]]*from[[:space:]]*${TMUX_SPEC}"
TMUX_PROBE_DYNAMIC="\\{[^}]*${TMUX_PROBE_NAME}[^}]*\\}[[:space:]]*=[[:space:]]*await[[:space:]]+import\\([[:space:]]*${TMUX_SPEC}"
TMUX_PROBE_MEMBER='\btmux\.sessionExists(Sync)?\b'

# The oracle itself and the module that defines the probe are not consumers.
tmux_probe_files() {
  local root="$1"
  rg -l -U --multiline-dotall -g '*.ts' -g '*.tsx' -g '!*.test.ts' -g '!*.test.tsx' -g '!**/__tests__/**' \
    -e "$TMUX_PROBE_IMPORT" -e "$TMUX_PROBE_DYNAMIC" -e "$TMUX_PROBE_MEMBER" "$root" 2>/dev/null \
    | grep -v -x -e "$root/lib/agents/liveness.ts" -e "$root/lib/tmux.ts" | sort || true
}

# One "<count> <path>" row per importing file: its non-comment lines that name
# sessionExists or sessionExistsSync (imports, calls and seams alike).
tmux_probe_counts() {
  local root="$1" file n
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    n=$(grep -E "$TMUX_PROBE_NAME" "$file" | grep -cvE '^[[:space:]]*(//|\*|/\*)' || true)
    echo "${n:-0} $file"
  done < <(tmux_probe_files "$root") | sort -k2
}

tmux_probe_baseline_rows() { sed -E '/^[[:space:]]*(#|$)/d' "$1" | sort -k2; }

# Prints one line per violation: a file missing from the baseline, or a count above its row.
tmux_probe_report() {
  local current="$1" baseline="$2"
  awk '
    NR == FNR { if (NF >= 2) known[$2] = $1; next }
    NF >= 2 {
      if (!($2 in known)) print "✗ liveness boundary: " $2 " is a NEW user of tmux sessionExists (" $1 " lines) — ask isAlive (agents/liveness.ts) or agentPaneExists (terminal-backends/launch.ts)"
      else if ($1 + 0 > known[$2] + 0) print "✗ liveness boundary: " $2 " names tmux sessionExists on " $1 " lines (baseline " known[$2] ") — ask isAlive (agents/liveness.ts) or agentPaneExists (terminal-backends/launch.ts)"
    }
  ' <(printf '%s\n' "$baseline") <(printf '%s\n' "$current")
}

check_tmux_probe() {
  if [[ ! -f "$TMUX_PROBE_BASELINE" ]]; then
    echo "✗ liveness boundary: missing $TMUX_PROBE_BASELINE"
    fail=1
    return
  fi
  local report
  report=$(tmux_probe_report "$(tmux_probe_counts src)" "$(tmux_probe_baseline_rows "$TMUX_PROBE_BASELINE")")
  if [[ -n "$report" ]]; then
    printf '%s\n' "$report"
    fail=1
  fi
}

update_tmux_probe_baseline() {
  local current base lowered
  current=$(tmux_probe_counts src)
  base=$(tmux_probe_baseline_rows "$TMUX_PROBE_BASELINE")
  # Per path: min(baseline, current); rows whose file no longer imports the
  # probe are dropped; paths absent from the baseline are never added.
  lowered=$(awk '
    NR == FNR { if (NF >= 2) cur[$2] = $1; next }
    NF >= 2 {
      if (!($2 in cur)) next
      n = (cur[$2] + 0 < $1 + 0) ? cur[$2] : $1
      if (n + 0 > 0) print n " " $2
    }
  ' <(printf '%s\n' "$current") <(printf '%s\n' "$base") | sort -k2)
  {
    echo "$TMUX_PROBE_HEADER_1"
    echo "$TMUX_PROBE_HEADER_2"
    if [[ -n "$lowered" ]]; then printf '%s\n' "$lowered"; fi
  } > "$TMUX_PROBE_BASELINE"
  echo "✓ tmux sessionExists baseline lowered to $(printf '%s\n' "$lowered" | awk 'NF >= 2 { f++ } END { print f + 0 }') files"
}

check_all() {
  # The oracle module must exist and export the three entry points.
  require_reference "$LIVENESS_MODULE" 'export async function isAlive' 'liveness module'
  require_reference "$LIVENESS_MODULE" 'export function isIdle' 'liveness module'
  require_reference "$LIVENESS_MODULE" 'export function idleAgeMs' 'liveness module'

  # PAN-3926: no synchronous liveness door. A sync probe can only ask tmux
  # (Herdr answers over an async socket), so it reads every Herdr agent dead.
  if rg -n 'function isAliveSync' "$LIVENESS_MODULE"; then
    echo "✗ liveness boundary: a sync liveness door is tmux-only — await isAlive instead (PAN-3926)"
    fail=1
  fi

  # Each migrated consumer delegates to the oracle (specifier is
  # './liveness.js' from inside src/lib/agents, '../agents/liveness.js' elsewhere)...
  local file
  for file in "${CONSUMERS[@]}"; do
    require_reference "$file" "['\"](\\./|\\.\\./)(agents/)?liveness\\.js['\"]" "$file"
  done

  # ...and none of them keeps a private predicate.
  for file in "${CONSUMERS[@]}"; do
    ban_pattern "$file" 'sessionExists\(|sessionExistsSync\(|pane_dead' "$file"
  done

  # #4109: the former tmuxActive filters read the backend-aware door and never
  # the tmux-only flag.
  for file in "${TMUX_FLAG_CONSUMERS[@]}"; do
    require_reference "$file" "$BACKEND_DOOR_PATTERN" "$file"
    ban_pattern "$file" "$TMUX_FLAG_READ_PATTERN" "$file (reads the tmux-only tmuxActive flag)"
  done

  # The retired idle module must not be re-imported anywhere.
  if rg -n "agent-idle\.js" src/ tests/ 2>/dev/null; then
    echo "✗ liveness boundary: cloister/agent-idle.ts was retired into agents/liveness.ts — re-import is forbidden"
    fail=1
  fi

  # PAN-5652: no new users of the tmux-only session probe.
  check_tmux_probe
}

if [[ "${1:-}" == "--self-test" ]]; then
  fixture_dir="$(mktemp -d)"
  trap 'rm -rf "$fixture_dir"' EXIT
  printf '%s\n' "import { sessionExistsSync } from './tmux.js';" > "$fixture_dir/consumer.ts"
  printf '%s\n' 'const alive = sessionExistsSync(agentId);' >> "$fixture_dir/consumer.ts"

  fail=0
  require_reference "$fixture_dir/consumer.ts" "['\"](\\./|\\.\\./)(agents/)?liveness\\.js['\"]" 'seeded consumer'
  ban_pattern "$fixture_dir/consumer.ts" 'sessionExists\(|sessionExistsSync\(|pane_dead' 'seeded consumer'
  if (( fail == 0 )); then
    echo "liveness self-test failed to reject seeded violations" >&2
    exit 2
  fi

  printf '%s\n' 'const live = agents.filter((agent) => agent.tmuxActive);' > "$fixture_dir/flag-consumer.ts"
  fail=0
  require_reference "$fixture_dir/flag-consumer.ts" "$BACKEND_DOOR_PATTERN" 'seeded tmuxActive consumer'
  ban_pattern "$fixture_dir/flag-consumer.ts" "$TMUX_FLAG_READ_PATTERN" 'seeded tmuxActive consumer'
  if (( fail == 0 )); then
    echo "liveness self-test failed to reject a seeded tmuxActive filter" >&2
    exit 2
  fi
  # PAN-5652: every import form of the tmux probe is caught in a file the
  # baseline does not know, and a higher count in a known file is caught.
  mkdir -p "$fixture_dir/src/lib/cloister" "$fixture_dir/src/dashboard/server/routes"
  printf '%s\n' "import { isPaneDead, sessionExists } from '../tmux.js';" > "$fixture_dir/src/lib/cloister/static.ts"
  printf '%s\n' 'import {' '  listSessionNames,' '  sessionExistsSync as hasSession,' "} from '../../../lib/tmux.js';" > "$fixture_dir/src/dashboard/server/routes/alias.ts"
  printf '%s\n' "const { createSession, sessionExists } = await import('../tmux.js');" > "$fixture_dir/src/lib/cloister/dynamic.ts"
  printf '%s\n' 'const alive = (id: string) => tmux.sessionExists(id);' > "$fixture_dir/src/lib/cloister/member.ts"
  printf '%s\n' "import { sessionExists } from '../terminal-backends/tmux.js';" > "$fixture_dir/src/lib/cloister/adapter.ts"
  seeded_counts=$(tmux_probe_counts "$fixture_dir/src")
  for form in static alias dynamic member; do
    if ! grep -q "/$form.ts\$" <<< "$seeded_counts"; then
      echo "liveness self-test missed the seeded $form import of tmux sessionExists" >&2
      exit 2
    fi
  done
  if grep -q '/adapter.ts$' <<< "$seeded_counts"; then
    echo "liveness self-test flagged the terminal-backends tmux adapter, which is not src/lib/tmux.ts" >&2
    exit 2
  fi
  static_row=$(grep '/static.ts$' <<< "$seeded_counts")
  if [[ -z "$(tmux_probe_report "$seeded_counts" "")" ]] \
    || [[ -z "$(tmux_probe_report "$static_row" "0 ${static_row#* }")" ]] \
    || [[ -n "$(tmux_probe_report "$static_row" "$static_row")" ]]; then
    echo "liveness self-test: the tmux sessionExists baseline comparison is wrong" >&2
    exit 2
  fi

  echo "liveness self-test caught seeded delegation, private-predicate and tmux sessionExists violations"
  exit 1
fi

if [[ "${1:-}" == "--update" && $# -eq 1 ]]; then
  update_tmux_probe_baseline
  exit 0
fi

if [[ $# -gt 0 ]]; then
  echo "usage: bash scripts/lint-liveness.sh [--self-test | --update]" >&2
  exit 2
fi

check_all

if (( fail )); then
  exit 1
fi

echo "✓ liveness boundary passed: ${#CONSUMERS[@]} consumers delegate through src/lib/agents/liveness.ts, ${#TMUX_FLAG_CONSUMERS[@]} former tmuxActive filters read the backend-aware door, no private predicates remain, and no new file asks tmux sessionExists"
