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

LOG_FILE="/tmp/panopticon-deploy.log"
LOCK_FILE="/tmp/panopticon-deploy.lock"
HEALTH_URL="http://localhost:3011/api/health"
HEALTH_TIMEOUT=30
RESTART_MARKER="$HOME/.panopticon/dashboard-restarting.json"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [post-merge-deploy] $*" | tee -a "$LOG_FILE"
}

# --- Lock: only one deploy runs at a time ---
exec 9>"$LOCK_FILE"
if ! flock -x -n 9; then
  log "Another deploy already in progress (lock held). Skipping deploy for $ISSUE_ID — the in-progress deploy will pick up the latest build."
  exit 0
fi

log "Starting post-merge deploy for issue=$ISSUE_ID branch=$SOURCE_BRANCH reason=$REASON"
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

# --- Step 1: Build ---
log "Building project (npm run build)..."
if ! npm run build >> "$LOG_FILE" 2>&1; then
  log "ERROR: Build failed. Server stays on old code."
  exit 1
fi
log "Build complete."

# --- Step 2: Link (makes 'panopticon' CLI available globally) ---
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

# --- Step 4: Kill old server ---
log "Stopping old server processes..."
for port in 3010 3011 3012; do
  fuser -k "${port}/tcp" >> "$LOG_FILE" 2>&1 || true
done

# Also kill any orphaned dashboard processes
pkill -f "node.*dist/dashboard/server" >> "$LOG_FILE" 2>&1 || true
pkill -f "bun.*src/dashboard/server/main" >> "$LOG_FILE" 2>&1 || true
pkill -f "vite.*301" >> "$LOG_FILE" 2>&1 || true

sleep 2

# Verify ports are clear
if lsof -i :3010,:3011,:3012 > /dev/null 2>&1; then
  log "Ports still in use, force killing..."
  lsof -ti :3010,:3011,:3012 | xargs -r kill -9 >> "$LOG_FILE" 2>&1 || true
  sleep 1
fi

# --- Step 5: Start new server ---
log "Starting new server..."
NODE=/home/eltmon/.config/nvm/versions/node/v22.22.0/bin/node
setsid "$NODE" dist/dashboard/server.js >> "$LOG_FILE" 2>&1 &

# --- Step 6: Health check ---
log "Waiting for server health check (${HEALTH_TIMEOUT}s timeout)..."
for i in $(seq 1 "$HEALTH_TIMEOUT"); do
  if curl -s --max-time 2 "$HEALTH_URL" > /dev/null 2>&1; then
    log "Health check passed after ${i}s."
    # NOTE: The new server reads the pending file on boot, emits lifecycle_started,
    # processes the lifecycle (including post-merge cleanup), emits lifecycle_completed,
    # and then deletes the pending file itself. Do NOT delete it here.
    rm -f "$RESTART_MARKER" || true
    log "Cleared restart marker. New server will process pending lifecycle and emit lifecycle_complete."
    log "Post-merge deploy complete for issue=$ISSUE_ID."
    exit 0
  fi
  sleep 1
done

log "ERROR: Health check timed out after ${HEALTH_TIMEOUT}s. Check $LOG_FILE."
rm -f "$RESTART_MARKER" || true
exit 1
