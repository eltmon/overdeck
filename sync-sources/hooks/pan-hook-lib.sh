# PAN-800 — shared library sourced by all Panopticon hook scripts.
#
# Provides:
#   pan_resolve_agent_id     — sets AGENT_ID, returns 1 if cannot attribute
#   pan_emit_event           — POST a heartbeat body; on failure buffer in pending-events.jsonl
#
# Hooks that emit runtime events go through pan_emit_event. No hook directly
# writes runtime.json — the SubscriptionRef inside AgentStateService is the
# source of truth (PAN-800).
#
# Shell: intended to be sourced, not executed. Exports no subprocesses; all
# helpers are plain bash functions.

PAN_DASHBOARD_URL="${PANOPTICON_DASHBOARD_URL:-http://localhost:3011}"
PAN_CURL_TIMEOUT="${PANOPTICON_HOOK_TIMEOUT:-0.5}"

# Resolve the current agent ID without a "main-cli" fallback (PAN-69).
# Returns 0 and sets AGENT_ID on success; returns 1 on failure so the caller
# can exit cleanly. We refuse to emit events that can't be authoritatively
# attributed — the whole point of HTTP ingestion is explicit identity.
pan_resolve_agent_id() {
  if [ -n "$PANOPTICON_AGENT_ID" ]; then
    AGENT_ID="$PANOPTICON_AGENT_ID"
  elif [ -n "$TMUX" ]; then
    AGENT_ID=$(tmux display-message -p '#S' 2>/dev/null)
  else
    return 1
  fi
  [ -z "$AGENT_ID" ] && return 1
  # Scrub to the same character class the legacy hooks accepted.
  AGENT_ID=$(printf '%s' "$AGENT_ID" | tr -cd 'A-Za-z0-9._-')
  [ -z "$AGENT_ID" ] && return 1
  return 0
}

# Emit a runtime event body to the dashboard.
#
# Order of operations:
#   1. If pending-events.jsonl has buffered events from prior failures, drain
#      them FIRST so server sequence numbers line up with wall-clock order.
#      (Posting the new event first would give it a lower sequence than the
#      older buffered events — the reducer would then pick the older event
#      as the most recent snapshot, which is wrong.)
#   2. POST the new event.
#   3. If that POST fails, append it to the buffer.
#
# Args:
#   $1 = agent id
#   $2 = JSON body
pan_emit_event() {
  local agent_id="$1"
  local body="$2"
  [ -z "$agent_id" ] || [ -z "$body" ] && return 0

  local dir="$HOME/.panopticon/agents/$agent_id"
  mkdir -p "$dir" 2>/dev/null || return 0

  local url="$PAN_DASHBOARD_URL/api/agents/$agent_id/heartbeat"
  local pending="$dir/pending-events.jsonl"
  local lockfile="$dir/pending.lock"

  # Drain any previously-buffered events before emitting the new one.
  if [ -s "$pending" ]; then
    pan__drain_pending "$agent_id" "$url" "$pending" "$lockfile"
  fi

  local http_code
  http_code=$(curl -s -m "$PAN_CURL_TIMEOUT" -o /dev/null -w '%{http_code}' \
    -X POST "$url" -H 'Content-Type: application/json' --data "$body" 2>/dev/null || echo '000')

  if [[ "$http_code" =~ ^2 ]]; then
    return 0
  fi

  # Drop on 4xx — server told us this body is invalid.
  if [[ "$http_code" =~ ^4 ]]; then
    return 0
  fi

  # Network failure / 5xx — buffer with flock.
  {
    flock -x -w 5 200 || return 0
    printf '%s\n' "$body" >> "$pending" 2>/dev/null || true
  } 200>"$lockfile"
  return 0
}

# Drain pending-events.jsonl one line at a time. Each line is POSTed with the
# same timeout; failures put the remaining lines (including the failed one)
# back into the file so we try again next time the dashboard is up.
#
# Internal — do not call directly.
pan__drain_pending() {
  local agent_id="$1"
  local url="$2"
  local pending="$3"
  local lockfile="$4"

  {
    flock -x -w 5 200 || return 0
    # Re-check size after acquiring the lock — a concurrent hook may have
    # already drained the file.
    [ ! -s "$pending" ] && return 0

    local tempfile="$pending.draining.$$"
    mv "$pending" "$tempfile" 2>/dev/null || return 0

    local failed="$pending.failed.$$"
    : > "$failed"
    local stop_on_failure=0
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      if [ "$stop_on_failure" = "1" ]; then
        printf '%s\n' "$line" >> "$failed"
        continue
      fi
      local code
      code=$(curl -s -m "$PAN_CURL_TIMEOUT" -o /dev/null -w '%{http_code}' \
        -X POST "$url" -H 'Content-Type: application/json' --data "$line" 2>/dev/null || echo '000')
      if [[ "$code" =~ ^2 ]]; then
        : # drained successfully
      elif [[ "$code" =~ ^4 ]]; then
        : # server-side rejection — drop
      else
        # Network failure — put this and the rest back, stop draining.
        printf '%s\n' "$line" >> "$failed"
        stop_on_failure=1
      fi
    done < "$tempfile"

    if [ -s "$failed" ]; then
      mv "$failed" "$pending" 2>/dev/null || true
    else
      rm -f "$failed" 2>/dev/null || true
    fi
    rm -f "$tempfile" 2>/dev/null || true
  } 200>"$lockfile"
}
