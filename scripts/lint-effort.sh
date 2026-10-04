#!/usr/bin/env bash
#
# lint-effort.sh — ratchet against new ad hoc `effort ?? 'high'` fallbacks and
# copies of the effort-level enum (PAN-4249). resolveEffort
# (src/lib/agents/resolve-effort.ts) is now the single resolver, and
# EFFORT_LEVELS (packages/contracts/src/effort.ts) is the single enum; new
# code should call the former and import the latter instead of adding another
# instance of either. Shrink-only: a baselined file's count may drop freely
# but must never rise, and no new, unbaselined offender file may appear.
#
# Every current baseline row exists because the code fixing it lives in a
# sibling issue (#4253, #4255-#4259) outside PAN-4249's own scope, or — the
# conversation-runtime.ts row — because it is the lane-door SAFE_EFFORT_PATTERN,
# deliberately kept in scope (PAN-4223 D20, PAN-4254 D11); each row names its
# issue. Two rows (ContextWindowMeter.tsx, and the pi/ohmypi extension
# ThinkingLevel unions) are false matches, not effort-enum copies: the former
# is an unrelated 'low'|'medium'|'high' tone enum, and the latter two model
# the Pi runtime's own native API vocabulary (it has 'off' and 'minimal',
# which are not canonical effort levels) — a translation target, not a copy
# of EFFORT_LEVELS.
set -euo pipefail
cd "$(dirname "$0")/.."

# Excluded entirely: the canonical enum definition, and the per-model/
# per-harness CAPABILITY DATA files (backend, not UI) whose 'low'..'max'
# arrays are data, not copies of the enum — counting them would fail this
# lint every time a model or harness is added or dropped. ModelPicker.tsx
# (dashboard UI, not a data file) now derives its lists from EFFORT_LEVELS
# (PAN-4254) and carries no baseline row — a new match there should surface.
EXCLUDE_FILES=(
  "packages/contracts/src/effort.ts"
  "src/lib/model-capabilities.ts"
  "src/lib/model-capability-additions.ts"
  "packages/contracts/src/harness-behavior.ts"
)

# <path> => count. See the header comment above for what removes each row.
declare -A BASELINE=(
  ["src/cli/commands/strike.ts"]=1                              # PAN-4259
  ["src/lib/overdeck/conversation-runtime.ts"]=1                 # lane door SAFE_EFFORT_PATTERN (PAN-4223 D20), kept by PAN-4254 D11
  ["packages/pi-extension/src/index.ts"]=1                       # Pi native thinking-level union (off/minimal/…), not an effort-enum copy — see header
  ["packages/ohmypi-extension/src/index.ts"]=1                   # Pi native thinking-level union (off/minimal/…), not an effort-enum copy — see header
  ["src/lib/planning/spawn-planning-session.ts"]=2               # PAN-4258
  ["src/cli/commands/plan.ts"]=1                                 # PAN-4258
  ["src/dashboard/frontend/src/components/PlanDialog.tsx"]=2     # PAN-4258
  ["src/dashboard/frontend/src/components/chat/ContextWindowMeter.tsx"]=1  # false match, not effort — see header
  ["src/dashboard/frontend/src/components/Settings/RolesPanel.tsx"]=1      # PAN-4256
)

PATTERNS=(
  "[Ee]ffort[A-Za-z]*\)?\s*\?\?\s*['\"](low|medium|high|xhigh|max)['\"]"
  "['\"]low['\"]\s*\|\s*['\"]medium['\"]"
  "\[\s*['\"]low['\"]\s*,\s*['\"]medium['\"]"
  "low\|medium\|high"
)

glob_args=(-g '!*.test.ts' -g '!*.test.tsx' -g '!**/__tests__/**')
for f in "${EXCLUDE_FILES[@]}"; do
  glob_args+=(-g "!$f")
done

count_for() {
  local file="$1" total=0 n
  for pattern in "${PATTERNS[@]}"; do
    n=$(rg -c --no-heading "$pattern" "$file" 2>/dev/null || true)
    total=$((total + ${n:-0}))
  done
  echo "$total"
}

matched=$(rg -l --type ts "${glob_args[@]}" \
  -e "${PATTERNS[0]}" -e "${PATTERNS[1]}" -e "${PATTERNS[2]}" -e "${PATTERNS[3]}" \
  src packages/*/src 2>/dev/null || true)

all_files=$(printf '%s\n' "${!BASELINE[@]}" $matched | sed '/^$/d' | sort -u)

fail=0
while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  count=$(count_for "$file")
  allowed="${BASELINE[$file]:-}"
  if [[ -z "$allowed" ]]; then
    echo "✖ $file has $count effort-fallback/enum-copy match(es) but is not in BASELINE." >&2
    fail=1
  elif (( count > allowed )); then
    echo "✖ $file has $count match(es), exceeding its baseline of $allowed." >&2
    fail=1
  elif (( count < allowed )); then
    echo "note: lower BASELINE[$file] to $count"
  fi
done <<< "$all_files"

if (( fail )); then
  echo "" >&2
  echo "lint:effort failed. Resolve effort through resolveEffort() (src/lib/agents/resolve-effort.ts) or" >&2
  echo "import EFFORT_LEVELS (packages/contracts/src/effort.ts) instead of adding a new '?? \"high\"'" >&2
  echo "fallback or another copy of the effort-level union." >&2
  exit 1
fi

echo "✓ lint:effort passed (no new effort fallbacks or enum copies)"
