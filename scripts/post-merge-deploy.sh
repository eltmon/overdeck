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
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [post-merge-deploy] $*" | tee -a "$LOG_FILE"
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

# --- Step 5: Restart through the shared lifecycle door ---
# pan restart owns the restart lock, writes the initiator + stopping phase before
# SIGTERM, starts the replacement in its own systemd unit, and verifies health.
# The outer systemd unit retries this entire script on failure, so a post-kill
# failure cannot abandon the machine with no successor.
log "Restarting dashboard through pan restart..."
GIT_COMMON_DIR="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir)"
PRIMARY_REPO_ROOT="$(dirname "$GIT_COMMON_DIR")"
log "Restart command cwd: $PRIMARY_REPO_ROOT"
if ! ( cd "$PRIMARY_REPO_ROOT" && OVERDECK_SKIP_SUPERVISOR_CYCLE=1 \
  "$NODE" "$REPO_ROOT/dist/cli/index.js" restart --dashboard --resume \
  --health-timeout 120000 ) >> "$LOG_FILE" 2>&1; then
  log "ERROR: Shared dashboard restart failed; systemd will retry the deploy."
  exit 1
fi

# NOTE: The new server reads the restart marker and pending file on boot,
# emits lifecycle_started, processes the lifecycle (including post-merge cleanup),
# emits lifecycle_completed, and then deletes the files itself. Do NOT delete
# the restart marker here: the health endpoint can respond before startup code
# reaches processPendingLifecycle(), and deleting it here races away the only
# signal that should populate the Activity Feed.
log "Restart marker left for new server to process. Pending lifecycle will emit lifecycle_complete."
log "Post-merge deploy complete for issue=$ISSUE_ID built_sha=$BUILT_SHA."
