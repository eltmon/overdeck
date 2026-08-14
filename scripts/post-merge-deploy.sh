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

# --- Repeated-failure escalation (PAN-3601) ---
# The outer systemd unit retries this script forever by design (PAN-3386): the
# machine must never be left without a dashboard successor. The operator still
# has to hear about a deploy that cannot succeed, so once the unit accumulates
# ESCALATION_THRESHOLD consecutive failed runs, surface a durable activity
# entry (with desktop notification) plus a TTS announcement through the
# dashboard's internal events door. Best-effort: escalation never fails the
# deploy, and the skip-marker is written only after the server confirms the
# append — so a POST that fails (e.g. dashboard down mid-restart) is retried
# on the next unit restart.
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

# A detached child still belongs to the dashboard's systemd cgroup. The old
# flow killed its parent dashboard below, systemd reaped this script with the
# rest of the cgroup, and no successor reached the start step (PAN-3386).
# Re-exec in an independent retrying unit before doing any destructive work.
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

# The systemd user unit does not inherit the interactive shell's nvm PATH, so
# `npm run build` would resolve the system Node (v18) and rolldown crashes on
# the missing node:util styleText export. Pin Node 22 for every child below.
NODE=/home/eltmon/.config/nvm/versions/node/v22.22.0/bin/node
export PATH="$(dirname "$NODE"):$PATH"

# --- Lock: only one deploy runs at a time ---
exec 9>"$LOCK_FILE"
if ! flock -x -n 9; then
  log "Another deploy already in progress (lock held). Skipping deploy for $ISSUE_ID — the in-progress deploy will pick up the latest build."
  exit 0
fi

log "Starting post-merge deploy for issue=$ISSUE_ID branch=$SOURCE_BRANCH reason=$REASON"
maybe_escalate_repeated_failures
log "Repo root (raw): $REPO_ROOT"

# If REPO_ROOT points inside a workspace, resolve to the main repo.
# Workspace paths look like: /path/to/repo/workspaces/feature-pan-123
# Without this, the build and npm link run from the workspace, hijacking
# the global `pan` CLI to point at stale workspace code.
if [[ "$REPO_ROOT" =~ (.+)/workspaces/feature-[^/]+$ ]]; then
  REPO_ROOT="${BASH_REMATCH[1]}"
  log "Resolved workspace path to main repo: $REPO_ROOT"
fi

log "Repo root: $REPO_ROOT"

cd "$REPO_ROOT"

# --- Step 1: Build from a pristine origin/main worktree (PAN-1723) ---
# The primary worktree at REPO_ROOT is shared with conversation agents that may
# have unpushed commits or a dirty tree, so it is routinely diverged from
# origin/main at merge time. Building it directly deploys a server that is
# MISSING the just-merged change while reporting success ("landed != live").
#
# Instead, fetch origin/main, build in a throwaway detached worktree checked out
# at exactly the merged sha, then swap the built dist/ into REPO_ROOT. This both
# guarantees the merged sha is built and removes all contention with conv agents
# on the primary worktree (no pull, dirty tree irrelevant).
BUILD_WT=""
cleanup_build_wt() {
  if [[ -n "$BUILD_WT" && -d "$BUILD_WT" ]]; then
    git -C "$REPO_ROOT" worktree remove --force "$BUILD_WT" >> "$LOG_FILE" 2>&1 || true
    rm -rf "$BUILD_WT" >> "$LOG_FILE" 2>&1 || true
  fi
  rm -rf "$REPO_ROOT/dist.incoming" >> "$LOG_FILE" 2>&1 || true
  rm -rf "$REPO_ROOT/scripts.incoming" >> "$LOG_FILE" 2>&1 || true
}
trap cleanup_build_wt EXIT

log "Fetching origin/main..."
if ! git -C "$REPO_ROOT" fetch origin main >> "$LOG_FILE" 2>&1; then
  log "ERROR: git fetch origin main failed. Server stays on old code."
  exit 1
fi

# Sibling of REPO_ROOT to guarantee the same filesystem (fast hardlinked
# bun install + atomic dist rename below).
BUILD_WT="$(dirname "$REPO_ROOT")/.pan-deploy-build-$$"
log "Creating pristine build worktree at origin/main: $BUILD_WT"
if ! git -C "$REPO_ROOT" worktree add --detach "$BUILD_WT" origin/main >> "$LOG_FILE" 2>&1; then
  log "ERROR: git worktree add failed. Server stays on old code."
  exit 1
fi

BUILT_SHA="$(git -C "$BUILD_WT" rev-parse HEAD)"
log "Building project (npm run build) from sha=$BUILT_SHA ..."

BUN="$(command -v bun || echo "$HOME/.bun/bin/bun")"
if ! ( cd "$BUILD_WT" && "$BUN" install && npm run build ) >> "$LOG_FILE" 2>&1; then
  log "ERROR: Build failed in pristine worktree. Server stays on old code."
  exit 1
fi

# Stage the freshly built dist into REPO_ROOT (same filesystem) so the final
# swap before restart is a near-atomic directory rename.
rm -rf "$REPO_ROOT/dist.incoming"
cp -a "$BUILD_WT/dist" "$REPO_ROOT/dist.incoming"
rm -rf "$REPO_ROOT/scripts.incoming"
cp -a "$BUILD_WT/scripts" "$REPO_ROOT/scripts.incoming"

# Worktree no longer needed once dist is staged — remove it now.
git -C "$REPO_ROOT" worktree remove --force "$BUILD_WT" >> "$LOG_FILE" 2>&1 || true
rm -rf "$BUILD_WT" >> "$LOG_FILE" 2>&1 || true
BUILD_WT=""
log "Build complete. Built sha=$BUILT_SHA staged at dist.incoming."

# --- Step 2: Link (makes 'overdeck' CLI available globally) ---
log "Running npm link..."
npm link >> "$LOG_FILE" 2>&1 || log "WARN: npm link failed (non-fatal)"

# --- Step 3: Write restart marker (BEFORE killing server) ---
# The new server reads this on boot to emit dashboard.lifecycle_started.
# This is the signal that the restart is planned, not a crash.
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

# --- Step 4: Swap in the freshly built dist (PAN-1723) ---
# Near-atomic directory rename (same filesystem). The old server still has its
# loaded modules in memory and any open file descriptors stay valid; the new
# server below boots from the fresh dist.
log "Swapping in freshly built dist (sha=$BUILT_SHA)..."
rm -rf "$REPO_ROOT/dist.old.$$"
mv "$REPO_ROOT/dist" "$REPO_ROOT/dist.old.$$" 2>/dev/null || true
mv "$REPO_ROOT/dist.incoming" "$REPO_ROOT/dist"
rm -rf "$REPO_ROOT/dist.old.$$" >> "$LOG_FILE" 2>&1 || true

# PAN-3601: a deployed generation keeps its scripts/ forever unless a deploy
# refreshes it — a broken deploy script could never heal itself through the
# very pipeline it implements. Swap scripts/ alongside dist/ so the generation
# always carries the scripts matching its built sha. Safe while this very
# script runs: bash keeps reading the old (now unlinked) inode. Never do this
# to a primary git checkout — it would clobber working-tree edits under
# scripts/ — so gate on the deployments path.
if [[ "$REPO_ROOT" == *"/.overdeck/deployments/"* ]]; then
  log "Refreshing deployment scripts/ from built sha..."
  rm -rf "$REPO_ROOT/scripts.old.$$"
  mv "$REPO_ROOT/scripts" "$REPO_ROOT/scripts.old.$$" 2>/dev/null || true
  mv "$REPO_ROOT/scripts.incoming" "$REPO_ROOT/scripts"
  rm -rf "$REPO_ROOT/scripts.old.$$" >> "$LOG_FILE" 2>&1 || true
fi

# --- Step 4b: Wait for the operator to approve the restart (PAN-3729) ---
# A voluntary restart — a deploy, `pan reload`, or `pan restart` — must never
# interrupt the operator mid-work, so it registers with the dashboard's restart
# gate and blocks until the operator approves from the dashboard banner or with
# `pan restart --now`. One approval satisfies every request waiting at that
# moment: exactly one of them restarts and the rest skip their restart step.
#
# Blocking indefinitely is safe here. The unit this script re-execs into is
# Type=simple with Restart=on-failure, which fires only on a nonzero exit and
# never while the script is still running, and it sets no TimeoutStartSec or
# WatchdogSec.
#
# Compat: a 404 (a dashboard build without the gate) or a health endpoint that
# fails continuously for 60s proceeds ungated — that is what lets this change
# deploy through today's server, and a dashboard that is not answering has no
# live work to interrupt.
GATE_URL="${OVERDECK_INTERNAL_DASHBOARD_URL:-http://127.0.0.1:${API_PORT:-${PORT:-3011}}}"
GATE_REQUESTER_ID="deploy:${ISSUE_ID}:$$"
GATE_POLL_SECONDS=5
GATE_UNHEALTHY_LIMIT_SECONDS=60

# Pull one scalar field out of a gate response — jq when it is installed, a
# grep/sed fallback otherwise, the same way the escalation path degrades.
gate_field() {
  local body="$1" field="$2"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$body" | jq -r --arg f "$field" '.[$f] // empty' 2>/dev/null || true
  else
    printf '%s' "$body" | grep -o "\"$field\"[[:space:]]*:[^,}]*" \
      | sed -e 's/^[^:]*:[[:space:]]*//' -e 's/[" ]//g' | head -n1 || true
  fi
}

gate_dashboard_healthy() {
  local code
  code="$(curl -sS -m 5 -o /dev/null -w '%{http_code}' "$GATE_URL/api/health" 2>/dev/null || true)"
  [[ "$code" == "200" ]]
}

# Returns 0 when this deploy must perform the restart, 1 when an approved
# restart by another requester already covered it.
wait_for_restart_approval() {
  local announced=0 unhealthy_since=0 raw code body status may_claim granted now
  while true; do
    raw="$(curl -sS -m 10 -w $'\n%{http_code}' -X POST "$GATE_URL/api/restart-gate/requests" \
      -H 'content-type: application/json' \
      --data "{\"requesterId\":\"$GATE_REQUESTER_ID\",\"kind\":\"deploy\",\"reason\":\"post-merge deploy for $ISSUE_ID\",\"builtSha\":\"$BUILT_SHA\"}" \
      2>/dev/null || true)"
    code="$(printf '%s' "$raw" | tail -n1)"
    body="$(printf '%s' "$raw" | sed '$d')"

    if [[ "$code" == "404" ]]; then
      log "This dashboard build has no restart gate, so the deploy restarts without waiting for approval."
      return 0
    fi

    if [[ "$code" != "200" ]]; then
      if gate_dashboard_healthy; then
        unhealthy_since=0
      else
        now="$(date +%s)"
        if (( unhealthy_since == 0 )); then unhealthy_since="$now"; fi
        if (( now - unhealthy_since >= GATE_UNHEALTHY_LIMIT_SECONDS )); then
          log "The dashboard has not answered its health endpoint for $(( now - unhealthy_since ))s, so there is no live session to interrupt — restarting without waiting for approval."
          return 0
        fi
      fi
      sleep "$GATE_POLL_SECONDS"
      continue
    fi

    status="$(gate_field "$body" status)"
    if [[ "$status" == "satisfied" ]]; then
      return 1
    fi

    if [[ "$status" == "approved" ]]; then
      may_claim="$(gate_field "$body" mayClaim)"
      if [[ "$may_claim" == "true" ]]; then
        granted="$(gate_field "$(curl -sS -m 10 -X POST "$GATE_URL/api/restart-gate/claim" \
          -H 'content-type: application/json' \
          --data "{\"requesterId\":\"$GATE_REQUESTER_ID\"}" 2>/dev/null || true)" granted)"
        if [[ "$granted" == "true" ]]; then
          log "Operator approved the restart — proceeding."
          return 0
        fi
      fi
    fi

    if (( announced == 0 )); then
      announced=1
      log "Waiting for operator approval before restarting the dashboard."
      log "The deploy for $ISSUE_ID (sha $BUILT_SHA) is built and staged; the restart that puts it live now waits for you, so it cannot interrupt live work."
      log "To let it run, either click \"Restart now\" in the banner at the top of any dashboard view, or run \`pan restart --now\` in a terminal. There is no timeout — this deploy waits until you do one of them."
    fi
    sleep "$GATE_POLL_SECONDS"
  done
}

GATE_DECISION=restart
if ! wait_for_restart_approval; then
  GATE_DECISION=skip
fi

# --- Step 5: Restart through the shared lifecycle door ---
# pan restart owns the restart lock, writes the initiator + stopping phase before
# SIGTERM, starts the replacement in its own systemd unit, and verifies health.
# The outer systemd unit retries this entire script on failure, so a post-kill
# failure cannot abandon the machine with no successor.
if [[ "$GATE_DECISION" == "skip" ]]; then
  # Another approved requester restarted the dashboard while this deploy waited,
  # and that one restart covers this one too. The freshly built dist is already
  # swapped in, so the running server is on the new code; the restart marker
  # stays for the new server to process, exactly as it would after our own
  # restart.
  log "Another approved restart already replaced the dashboard, so this deploy skipped its own restart (built sha=$BUILT_SHA is live in $REPO_ROOT/dist)."
else
  log "Restarting dashboard through pan restart..."
  GIT_COMMON_DIR="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir)"
  PRIMARY_REPO_ROOT="$(dirname "$GIT_COMMON_DIR")"
  log "Restart command cwd: $PRIMARY_REPO_ROOT"
  # OVERDECK_RESTART_GATE_CLAIMED tells the child that this restart already
  # cleared the gate. Without it the child registers a second request and waits
  # for a second approval — one deploy, two operator clicks.
  if ! ( cd "$PRIMARY_REPO_ROOT" && OVERDECK_SKIP_SUPERVISOR_CYCLE=1 \
    OVERDECK_RESTART_GATE_CLAIMED=1 \
    "$NODE" "$REPO_ROOT/dist/cli/index.js" restart --dashboard --resume \
    --health-timeout 120000 ) >> "$LOG_FILE" 2>&1; then
    log "ERROR: Shared dashboard restart failed; systemd will retry the deploy."
    exit 1
  fi
fi

# NOTE: The new server reads the restart marker and pending file on boot,
# emits lifecycle_started, processes the lifecycle (including post-merge cleanup),
# emits lifecycle_completed, and then deletes the files itself. Do NOT delete
# the restart marker here: the health endpoint can respond before startup code
# reaches processPendingLifecycle(), and deleting it here races away the only
# signal that should populate the Activity Feed.
log "Restart marker left for new server to process. Pending lifecycle will emit lifecycle_complete."
log "Post-merge deploy complete for issue=$ISSUE_ID built_sha=$BUILT_SHA."
