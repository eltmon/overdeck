#!/bin/bash
# Post-merge deploy script: rebuild + restart dashboard after merge to main.
# Called as a detached process by postMergeLifecycle() in merge-agent.ts.
#
# Usage: post-merge-deploy.sh <REPO_ROOT> <ISSUE_ID> <PROJECT_PATH> <SOURCE_BRANCH>
#
# On success: exits 0 after health check passes.
# On failure: exits 1 with error in log file.

set -euo pipefail

REPO_ROOT="${1:?REPO_ROOT required}"
ISSUE_ID="${2:?ISSUE_ID required}"
PROJECT_PATH="${3:?PROJECT_PATH required}"
SOURCE_BRANCH="${4:?SOURCE_BRANCH required}"

LOG_FILE="/tmp/panopticon-deploy.log"
HEALTH_URL="http://localhost:3011/api/health"
HEALTH_TIMEOUT=30

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [post-merge-deploy] $*" | tee -a "$LOG_FILE"
}

log "Starting post-merge deploy for issue=$ISSUE_ID branch=$SOURCE_BRANCH"
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

# --- Step 3: Detect runtime mode before killing ---
# Check if server is running under bun (dev) or node (prod)
RUNTIME_MODE="prod"
if pgrep -f "bun.*src/dashboard/server/main" > /dev/null 2>&1; then
  RUNTIME_MODE="dev"
elif pgrep -f "bun.*dashboard.*main" > /dev/null 2>&1; then
  RUNTIME_MODE="dev"
fi
log "Detected runtime mode: $RUNTIME_MODE"

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
log "Starting new server in $RUNTIME_MODE mode..."
if [ "$RUNTIME_MODE" = "dev" ]; then
  # Dev mode: bun runs main.ts directly via npm run dev equivalent
  setsid npm run dev >> "$LOG_FILE" 2>&1 &
else
  # Prod mode: node runs compiled server
  setsid node dist/dashboard/server.js >> "$LOG_FILE" 2>&1 &
fi

# --- Step 6: Health check ---
log "Waiting for server health check (${HEALTH_TIMEOUT}s timeout)..."
for i in $(seq 1 "$HEALTH_TIMEOUT"); do
  if curl -s --max-time 2 "$HEALTH_URL" > /dev/null 2>&1; then
    log "Health check passed after ${i}s."
    log "Post-merge deploy complete for issue=$ISSUE_ID."
    exit 0
  fi
  sleep 1
done

log "ERROR: Health check timed out after ${HEALTH_TIMEOUT}s. Check $LOG_FILE."
exit 1
