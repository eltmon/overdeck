#!/usr/bin/env bash
#
# pusher-identity.sh — who is pushing? Sourced by the push guards
# (guard-agent-main-push.sh, guard-allowlist-raise.sh).
#
# overdeck_pusher_is_agent → 0 when the push runs in an agent context, 1 otherwise.
#   - The Flywheel (conv-flywheel, PAN-2194 / docs/FLYWHEEL.md) is always an agent,
#     whatever its git identity: OVERDECK_AGENT_ID=conv-flywheel,
#     OVERDECK_CONVERSATION=conv-flywheel, or OVERDECK_AGENT_STARTED_BY=flywheel:*.
#   - Other operator conversations (OVERDECK_AGENT_ID=conv-*) are not agents.
#   - Any other non-empty OVERDECK_AGENT_ID is an agent.
#   - A `[bot]` git identity is an agent's (#4066 review). The primary checkout
#     also commits as overdeck-agent[bot], so an operator at a plain terminal
#     uses OVERDECK_OPERATOR_PUSH=1, which each guard checks itself.
overdeck_pusher_is_agent() {
  local agent_id="${OVERDECK_AGENT_ID:-}"
  if [[ "$agent_id" == "conv-flywheel" \
     || "${OVERDECK_CONVERSATION:-}" == "conv-flywheel" \
     || "${OVERDECK_AGENT_STARTED_BY:-}" == flywheel:* ]]; then
    return 0
  fi
  if [[ "$agent_id" == conv-* ]]; then
    return 1
  fi
  if [[ -n "$agent_id" ]]; then
    return 0
  fi
  local git_user_name
  git_user_name=$(git config user.name 2>/dev/null || true)
  if [[ "$git_user_name" == *"[bot]" ]]; then
    return 0
  fi
  return 1
}
