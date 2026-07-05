#!/usr/bin/env bash
#
# guard-flywheel-orchestrator-commit.sh - block flywheel orchestrator artifact
# authoring at commit time while allowing its state/checkpoint writes.
#
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${OVERDECK_AGENT_ID:-}" != "flywheel-orchestrator" ]]; then
  exit 0
fi

staged_paths=$(git diff --cached --name-only --)
if [[ -z "$staged_paths" ]]; then
  exit 0
fi

offending_paths=$(printf '%s\n' "$staged_paths" | grep -Ev '^(docs/FLYWHEEL-STATE\.md$|\.pan/records/|\.pan/continues/|\.pan/backlog/|\.beads/)' || true)
if [[ -z "$offending_paths" ]]; then
  exit 0
fi

echo "Refusing flywheel-orchestrator commit: orchestrators dispatch work; they do not author repo artifacts." >&2
echo "Offending staged paths:" >&2
printf '%s\n' "$offending_paths" | sed 's/^/  /' >&2
echo "" >&2
echo "Allowed flywheel-orchestrator commit paths are:" >&2
echo "  docs/FLYWHEEL-STATE.md" >&2
echo "  .pan/records/" >&2
echo "  .pan/continues/" >&2
echo "  .pan/backlog/" >&2
echo "  .beads/" >&2
exit 1
