#!/usr/bin/env bash
#
# guard-agent-main-push.sh — block agent-context code pushes directly to main.
# Agents land code via PR (`pan done`); operator-directed local main pushes must
# opt in with OVERDECK_OPERATOR_PUSH=1.
#
# Operator-supervised conversations (OVERDECK_AGENT_ID prefixed `conv-`) are
# exempt without the manual opt-in — see sync-sources/rules/operator-authorized-merges.md.
# The incident this guard exists for (PAN-2194) was the unsupervised flywheel
# orchestrator, not a conversation; `conv-` is already the codebase's standing
# marker for the human-supervised category (src/lib/agents/identity.ts
# AGENT_PREFIXES, src/lib/conversations/current.ts).
#
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${OVERDECK_OPERATOR_PUSH:-}" == "1" ]]; then
  exit 0
fi

if [[ "${OVERDECK_AGENT_ID:-}" == conv-* ]]; then
  exit 0
fi

if [[ "${1:-}" != "--range" || $# -ne 2 || -z "${2:-}" ]]; then
  echo "✖ agent main-push guard: missing push range; refusing because this is a trust gate." >&2
  echo "Agents land code via PR — run pan done. Operator escape hatch: OVERDECK_OPERATOR_PUSH=1 git push ..." >&2
  exit 1
fi

RANGE="$2"
if [[ "$RANGE" != *..* || "$RANGE" == ..* || "$RANGE" == *.. ]]; then
  echo "✖ agent main-push guard: undeterminable push range '$RANGE'; refusing because this is a trust gate." >&2
  echo "Agents land code via PR — run pan done. Operator escape hatch: OVERDECK_OPERATOR_PUSH=1 git push ..." >&2
  exit 1
fi

is_agent=0
if [[ -n "${OVERDECK_AGENT_ID:-}" ]]; then
  is_agent=1
fi

git_user_name=$(git config user.name 2>/dev/null || true)
if [[ "$git_user_name" == "panopticon-agent[bot]" ]]; then
  is_agent=1
fi

if [[ "$is_agent" -eq 0 ]]; then
  exit 0
fi

changed_paths=$(git diff --name-only "$RANGE" -- 2>/dev/null || true)
if [[ -z "$changed_paths" ]]; then
  if ! git rev-parse -q --verify "${RANGE%%..*}" >/dev/null || ! git rev-parse -q --verify "${RANGE##*..}" >/dev/null; then
    echo "✖ agent main-push guard: cannot resolve push range '$RANGE'; refusing because this is a trust gate." >&2
    echo "Agents land code via PR — run pan done. Operator escape hatch: OVERDECK_OPERATOR_PUSH=1 git push ..." >&2
    exit 1
  fi
  exit 0
fi

if [[ "${OVERDECK_AGENT_ID:-}" == "flywheel-orchestrator" ]]; then
  offending_paths=$(printf '%s\n' "$changed_paths" | grep -Ev '^(docs/FLYWHEEL-STATE\.md$|\.pan/records/|\.pan/continues/|\.pan/backlog/|\.beads/)' || true)
  if [[ -z "$offending_paths" ]]; then
    exit 0
  fi

  echo "✖ agent main-push guard: flywheel-orchestrator may only push flywheel state/checkpoint paths" >&2
  echo "Refusing flywheel-orchestrator push to refs/heads/main because this range touches disallowed paths:" >&2
  printf '%s\n' "$offending_paths" >&2
  echo "" >&2
  echo "Allowed flywheel-orchestrator paths are:" >&2
  echo "  docs/FLYWHEEL-STATE.md" >&2
  echo "  .pan/records/" >&2
  echo "  .pan/continues/" >&2
  echo "  .pan/backlog/" >&2
  echo "  .beads/" >&2
  exit 1
fi

offending_paths=$(printf '%s\n' "$changed_paths" | grep -E '^(src|packages|roles|skills|scripts)/' || true)
if [[ -z "$offending_paths" ]]; then
  exit 0
fi

echo "✖ agent main-push guard: agents land code via PR — pan done" >&2
echo "Refusing agent-context push to refs/heads/main because this range touches code paths:" >&2
printf '%s\n' "$offending_paths" >&2
echo "" >&2
echo "Operator-directed escape hatch: OVERDECK_OPERATOR_PUSH=1 git push ..." >&2
exit 1
