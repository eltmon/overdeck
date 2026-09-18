#!/bin/bash
# Post-merge deploy script: rebuild + restart dashboard after merge to main.
# Called as a detached process by postMergeLifecycle() in merge-agent.ts.
#
# Usage: post-merge-deploy.sh <REPO_ROOT> <ISSUE_ID> <PROJECT_PATH> <SOURCE_BRANCH> [REASON]
#
# On success: exits 0 after health check passes.
# On failure: exits 1 with error in log file.

set -euo pipefail

REPO_ROOT="${1:?REPO_ROOT required}"
ISSUE_ID="${2:?ISSUE_ID required}"
PROJECT_PATH="${3:?PROJECT_PATH required}"
SOURCE_BRANCH="${4:-}"
REASON="${5:-post-merge}"

LOG_FILE="/tmp/overdeck-deploy.log"
LOCK_FILE="/tmp/overdeck-deploy.lock"
RESTART_MARKER="$HOME/.overdeck/dashboard-restarting.json"

log() {
  # Under systemd supervision the unit's StandardOutput already appends to
  # LOG_FILE, so tee-ing the file too would land every line twice.
  if [[ "${OVERDECK_POST_MERGE_DEPLOY_SUPERVISED:-}" == "1" ]]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [post-merge-deploy] $*"
  else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [post-merge-deploy] $*" | tee -a "$LOG_FILE"
  fi
}

# The outer systemd unit retries this script forever by design (PAN-3386). Once
# it accumulates five failures, surface one durable operator alert while retries
# continue. Best-effort notification must never replace the retry.
ESCALATION_THRESHOLD=5
maybe_escalate_repeated_failures() {
  local unit="${OVERDECK_DEPLOY_UNIT:-}"
  [[ -z "$unit" ]] && return 0
  local restarts
  restarts="$(systemctl --user show "$unit" --property=NRestarts --value 2>/dev/null || true)"
  [[ "$restarts" =~ ^[0-9]+$ ]] || return 0
  (( restarts < ESCALATION_THRESHOLD )) && return 0
  local marker="/tmp/overdeck-deploy-escalated-${unit}"
  [[ -e "$marker" ]] && return 0
  local token_file="${OVERDECK_HOME:-$HOME/.overdeck}/internal-token"
  if [[ ! -r "$token_file" ]]; then
    log "WARN: $restarts consecutive deploy failures, but no internal token at $token_file to escalate with."
    return 0
  fi
  if ! command -v jq >/dev/null 2>&1; then
    log "WARN: $restarts consecutive deploy failures, but jq is unavailable to build the escalation payload."
    return 0
  fi
  local dash_url="${OVERDECK_INTERNAL_DASHBOARD_URL:-http://127.0.0.1:${API_PORT:-${PORT:-3011}}}"
  local ts log_tail entry tts response
  ts="$(date -u '+%Y-%m-%dT%H:%M:%S.%3NZ')"
  log_tail="$(tail -n 40 "$LOG_FILE" 2>/dev/null || true)"
  entry="$(jq -n \
    --arg ts "$ts" --arg issue "$ISSUE_ID" --arg unit "$unit" \
    --arg n "$restarts" --arg tail "$log_tail" \
    '{event: {type: "activity.entry", timestamp: $ts, payload: {
        id: ("post-merge-deploy-needs-you-" + $unit),
        source: "deploy-script", level: "error", status: "failed",
        message: ("Post-merge deploy for " + $issue + " has failed " + $n + " consecutive times and will keep retrying every 10 seconds until it succeeds. The dashboard keeps serving the previous build until a deploy completes. The failing step is in /tmp/overdeck-deploy.log (systemd unit " + $unit + ")."),
        details: $tail, issueId: $issue, desktop: true}},
      idempotencyKey: ("post-merge-deploy-needs-you-" + $unit)}')"
  response="$(curl -sS -m 10 -X POST "$dash_url/api/internal/events/append-once" \
    -H 'content-type: application/json' \
    -H "x-overdeck-internal-token: $(cat "$token_file")" \
    --data-binary "$entry" 2>>"$LOG_FILE" || true)"
  if [[ "$response" == *'"outcome"'* ]]; then
    tts="$(jq -n \
      --arg ts "$ts" --arg issue "$ISSUE_ID" --arg unit "$unit" \
      '{event: {type: "activity.tts", timestamp: $ts, payload: {
          id: ("post-merge-deploy-needs-you-tts-" + $unit),
          utterance: ("Post-merge deploy for " + $issue + " is failing repeatedly and needs attention."),
          priority: 0, issueId: $issue, source: "deploy-script"}},
        idempotencyKey: ("post-merge-deploy-needs-you-tts-" + $unit)}')"
    curl -sS -m 10 -X POST "$dash_url/api/internal/events/append-once" \
      -H 'content-type: application/json' \
      -H "x-overdeck-internal-token: $(cat "$token_file")" \
      --data-binary "$tts" >/dev/null 2>>"$LOG_FILE" || true
    touch "$marker"
    log "Escalated $restarts consecutive deploy failures to the operator (unit $unit)."
  else
    log "WARN: escalation POST did not confirm (response: ${response:-none}); will retry on the next run."
  fi
}

# A detached child still belongs to the dashboard's systemd cgroup. Re-exec in
# an independent retrying unit before the shared reload door can stop the server.
if [[ "${OVERDECK_POST_MERGE_DEPLOY_SUPERVISED:-}" != "1" ]]; then
  if [[ "$(uname -s)" != "Linux" ]] || ! command -v systemd-run >/dev/null 2>&1; then
    log "ERROR: post-merge deploy requires systemd supervision; old dashboard left running."
    exit 1
  fi
  UNIT="overdeck-post-merge-deploy-$(date +%s%N)"
  log "Handing deploy to independent systemd unit: $UNIT"
  exec systemd-run \
    --user --unit "$UNIT" --collect --quiet \
    --property=Restart=on-failure \
    --property=RestartSec=10s \
    --property=StartLimitIntervalSec=0 \
    "--property=StandardOutput=append:$LOG_FILE" \
    "--property=StandardError=append:$LOG_FILE" \
    "--property=WorkingDirectory=$REPO_ROOT" \
    --setenv OVERDECK_POST_MERGE_DEPLOY_SUPERVISED=1 \
    --setenv "OVERDECK_DEPLOY_UNIT=$UNIT" \
    --setenv OVERDECK_RESTART_INITIATOR=merge-step0 \
    --setenv "OVERDECK_ISSUE_ID=$ISSUE_ID" \
    "$0" "$@"
fi

# The systemd user unit does not inherit the interactive shell's nvm PATH.
NODE=/home/eltmon/.config/nvm/versions/node/v22.22.0/bin/node
export PATH="$(dirname "$NODE"):$PATH"

exec 9>"$LOCK_FILE"
if ! flock -x -n 9; then
  log "Another deploy already holds the deploy lock. It will pick up the latest origin/main, so this deploy for $ISSUE_ID can stop."
  exit 0
fi

log "Starting post-merge deploy for issue=$ISSUE_ID branch=$SOURCE_BRANCH reason=$REASON"
maybe_escalate_repeated_failures
log "Repo root (raw): $REPO_ROOT"

if [[ "$REPO_ROOT" =~ (.+)/workspaces/feature-[^/]+$ ]]; then
  REPO_ROOT="${BASH_REMATCH[1]}"
  log "Resolved workspace path to main repo: $REPO_ROOT"
fi

# A built server can pass its own generation as REPO_ROOT. Use that generation's
# CLI so live-process discovery pins it, but use the shared primary checkout as
# cwd so reload is allowed to create the other fixed generation (PAN-3329).
GIT_COMMON_DIR="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir)"
PRIMARY_REPO_ROOT="$(dirname "$GIT_COMMON_DIR")"
log "Reload command cwd: $PRIMARY_REPO_ROOT"

# The fresh server consumes this marker and pending-post-merge.json on boot.
mkdir -p "$(dirname "$RESTART_MARKER")"
cat > "$RESTART_MARKER" << EOF
{
  "reason": "$REASON",
  "issueId": "$ISSUE_ID",
  "trigger": "deploy-script",
  "timestamp": $(date +%s000)
}
EOF
log "Restart marker written: $RESTART_MARKER"

# `pan reload` is the one deployment door. It selects a generation from the
# live process set, builds origin/main there, activates it, waits for restart
# approval, restarts through the shared lifecycle, verifies health, and repoints
# the global CLI. It never stages files inside the live generation.
log "Starting generation-safe dashboard reload..."
if ! ( cd "$PRIMARY_REPO_ROOT" && OVERDECK_SKIP_SUPERVISOR_CYCLE=1 \
  "$NODE" "$REPO_ROOT/dist/cli/index.js" reload --health-timeout 120000 \
  ) >> "$LOG_FILE" 2>&1; then
  log "ERROR: Shared dashboard reload failed; systemd will retry the deploy."
  exit 1
fi

log "Restart marker left for the new server to process. Pending lifecycle will emit lifecycle_complete."
log "Post-merge deploy complete for issue=$ISSUE_ID."
