# PAN-800 — shared library sourced by all Overdeck hook scripts.
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

PAN_DASHBOARD_URL="${OVERDECK_DASHBOARD_URL:-http://localhost:3011}"
PAN_CURL_TIMEOUT="${OVERDECK_HOOK_TIMEOUT:-0.5}"

# Acquire a portable single-flight lock. A tiny Python helper holds the kernel
# advisory lock for the caller's lifetime; the directory is ownership metadata,
# not the synchronization primitive. Publishing the kernel lock before creating
# the metadata closes the mkdir-to-PID initialization race (PAN-3294).
pan_acquire_singleflight_lock() {
  local lock_dir="$1"
  local guard_file="${lock_dir}.flock"
  local ready_file="${guard_file}.ready.$$.$RANDOM"
  local lock_parent
  lock_parent=$(dirname "$lock_dir")
  mkdir -p "$lock_parent" 2>/dev/null || return 1

  python3 - "$guard_file" "$ready_file" "$$" >/dev/null 2>&1 <<'PY' &
import fcntl
import os
import sys
import time

guard_file, ready_file, parent_pid_text = sys.argv[1:]
parent_pid = int(parent_pid_text)
fd = os.open(guard_file, os.O_CREAT | os.O_RDWR, 0o600)
try:
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    with open(ready_file, "w", encoding="utf-8") as ready:
        ready.write("busy\n")
    raise SystemExit(0)

with open(ready_file, "w", encoding="utf-8") as ready:
    ready.write("acquired\n")

while True:
    try:
        os.kill(parent_pid, 0)
    except OSError:
        break
    if os.getppid() == 1:
        break
    time.sleep(0.1)
PY
  local helper_pid=$!

  local attempts=0
  while [ ! -s "$ready_file" ] && kill -0 "$helper_pid" 2>/dev/null && [ "$attempts" -lt 100 ]; do
    /bin/sleep 0.01
    attempts=$((attempts + 1))
  done

  local lock_status
  lock_status=$(cat "$ready_file" 2>/dev/null || true)
  rm -f "$ready_file" 2>/dev/null || true
  if [ "$lock_status" != "acquired" ]; then
    kill "$helper_pid" 2>/dev/null || true
    wait "$helper_pid" 2>/dev/null || true
    return 1
  fi

  # The kernel lock is already held, so stale metadata can be replaced without
  # exposing an unowned interval to contenders.
  rm -rf "$lock_dir" 2>/dev/null || {
    kill "$helper_pid" 2>/dev/null || true
    wait "$helper_pid" 2>/dev/null || true
    return 1
  }
  mkdir "$lock_dir" 2>/dev/null || {
    kill "$helper_pid" 2>/dev/null || true
    wait "$helper_pid" 2>/dev/null || true
    return 1
  }
  printf '%s\n' "$$" > "$lock_dir/pid" || {
    rm -rf "$lock_dir" 2>/dev/null || true
    kill "$helper_pid" 2>/dev/null || true
    wait "$helper_pid" 2>/dev/null || true
    return 1
  }
  printf '%s\n' "$helper_pid" > "$lock_dir/helper-pid" || {
    rm -rf "$lock_dir" 2>/dev/null || true
    kill "$helper_pid" 2>/dev/null || true
    wait "$helper_pid" 2>/dev/null || true
    return 1
  }
  return 0
}

pan_release_singleflight_lock() {
  local lock_dir="$1"
  local owner_pid helper_pid
  owner_pid=$(cat "$lock_dir/pid" 2>/dev/null || true)
  helper_pid=$(cat "$lock_dir/helper-pid" 2>/dev/null || true)

  # A caller may release only metadata it owns. Remove that metadata before
  # dropping the kernel lock; a successor cannot acquire until the helper exits,
  # and this owner performs no destructive filesystem action after that point.
  [ "$owner_pid" = "$$" ] || return 0
  rm -rf "$lock_dir" 2>/dev/null || return 0
  if [[ "$helper_pid" =~ ^[1-9][0-9]*$ ]]; then
    kill "$helper_pid" 2>/dev/null || true
    wait "$helper_pid" 2>/dev/null || true
  fi
  return 0
}

# Run a command with a hard deadline while preserving its stdin, stdout, and
# ordinary exit code. GNU timeout is preferred when installed; stock macOS uses
# the pure-bash watchdog fallback. Expiry is always reported as 124.
pan_run_with_timeout() {
  local timeout_seconds="$1"
  shift

  if command -v timeout >/dev/null 2>&1; then
    if timeout -k 5 "$timeout_seconds" "$@"; then
      return 0
    else
      return $?
    fi
  fi
  if command -v gtimeout >/dev/null 2>&1; then
    if gtimeout -k 5 "$timeout_seconds" "$@"; then
      return 0
    else
      return $?
    fi
  fi

  local expired_file="${TMPDIR:-/tmp}/pan-hook-timeout.$$.$RANDOM"
  "$@" &
  local command_pid=$!
  (
    local sleep_pid=""
    trap '[ -n "$sleep_pid" ] && kill "$sleep_pid" 2>/dev/null; exit 0' TERM INT

    /bin/sleep "$timeout_seconds" &
    sleep_pid=$!
    wait "$sleep_pid" 2>/dev/null || exit 0
    sleep_pid=""

    if kill -0 "$command_pid" 2>/dev/null; then
      : > "$expired_file"
      kill -TERM "$command_pid" 2>/dev/null || true
      /bin/sleep 5 &
      sleep_pid=$!
      wait "$sleep_pid" 2>/dev/null || exit 0
      sleep_pid=""
      kill -KILL "$command_pid" 2>/dev/null || true
    fi
  ) &
  local watchdog_pid=$!

  local command_rc
  if wait "$command_pid"; then
    command_rc=0
  else
    command_rc=$?
  fi

  kill "$watchdog_pid" 2>/dev/null || true
  wait "$watchdog_pid" 2>/dev/null || true

  if [ -f "$expired_file" ]; then
    /bin/rm -f "$expired_file" 2>/dev/null || true
    return 124
  fi

  return "$command_rc"
}

# Admit at most OVERDECK_HOOK_LLM_RATE_LIMIT hook-initiated LLM calls in a
# rolling 60-second machine-wide window. Returns 0 after recording an allowed
# call and 1 when the bucket is full or cannot be locked safely.
pan_llm_rate_check() {
  local overdeck_home="${OVERDECK_HOME:-$HOME/.overdeck}"
  local bucket_file="$overdeck_home/hook-llm-calls.log"
  local lock_dir="$overdeck_home/hook-llm-calls.lock.d"
  local limit="${OVERDECK_HOOK_LLM_RATE_LIMIT:-6}"
  [[ "$limit" =~ ^[0-9]+$ ]] || limit=6

  mkdir -p "$overdeck_home" 2>/dev/null || return 1

  local attempt=0
  local acquired=0
  while [ "$attempt" -lt 10 ]; do
    if pan_acquire_singleflight_lock "$lock_dir"; then
      acquired=1
      break
    fi
    attempt=$((attempt + 1))
    [ "$attempt" -lt 10 ] && /bin/sleep 0.1
  done
  [ "$acquired" = "1" ] || return 1

  local now cutoff timestamp count=0
  now=$(date +%s 2>/dev/null) || {
    pan_release_singleflight_lock "$lock_dir"
    return 1
  }
  cutoff=$((now - 60))

  local bucket_tmp="${bucket_file}.tmp.$$"
  : > "$bucket_tmp" 2>/dev/null || {
    pan_release_singleflight_lock "$lock_dir"
    return 1
  }

  if [ -f "$bucket_file" ]; then
    while IFS= read -r timestamp; do
      if [[ "$timestamp" =~ ^[0-9]+$ ]] && [ "$timestamp" -ge "$cutoff" ]; then
        printf '%s\n' "$timestamp" >> "$bucket_tmp"
        count=$((count + 1))
      fi
    done < "$bucket_file"
  fi

  local allowed=1
  if [ "$count" -lt "$limit" ]; then
    printf '%s\n' "$now" >> "$bucket_tmp"
    allowed=0
  fi

  if ! mv "$bucket_tmp" "$bucket_file" 2>/dev/null; then
    rm -f "$bucket_tmp" 2>/dev/null || true
    allowed=1
  fi
  pan_release_singleflight_lock "$lock_dir"
  return "$allowed"
}

# Internal token for authenticated HTTP ingestion (PAN-1596). The
# /api/agents/:id/heartbeat route is token-gated — without this header every
# hook POST gets 403 and is dropped on 4xx, so hook-emitted runtime activity
# (thinking/working/idle/waiting) never reaches the AgentStateService mirror.
# No launcher exports OVERDECK_INTERNAL_TOKEN, so source it from the on-disk
# token as the primary path. Empty token => same 403/drop as before (no
# regression).
PAN_INTERNAL_TOKEN="${OVERDECK_INTERNAL_TOKEN:-}"
if [ -z "$PAN_INTERNAL_TOKEN" ]; then
  _pan_token_path="${OVERDECK_HOME:-$HOME/.overdeck}/internal-token"
  [ -f "$_pan_token_path" ] && PAN_INTERNAL_TOKEN=$(cat "$_pan_token_path" 2>/dev/null || true)
fi

# Resolve the current agent ID without a "main-cli" fallback (PAN-69).
# Returns 0 and sets AGENT_ID on success; returns 1 on failure so the caller
# can exit cleanly. We refuse to emit events that can't be authoritatively
# attributed — the whole point of HTTP ingestion is explicit identity.
pan_resolve_agent_id() {
  if [ -n "$OVERDECK_AGENT_ID" ]; then
    AGENT_ID="$OVERDECK_AGENT_ID"
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

  local dir="$HOME/.overdeck/agents/$agent_id"
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
    -X POST "$url" -H 'Content-Type: application/json' \
    -H "x-overdeck-internal-token: $PAN_INTERNAL_TOKEN" --data "$body" 2>/dev/null || echo '000')

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
        -X POST "$url" -H 'Content-Type: application/json' \
        -H "x-overdeck-internal-token: $PAN_INTERNAL_TOKEN" --data "$line" 2>/dev/null || echo '000')
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
