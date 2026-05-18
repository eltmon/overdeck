/**
 * Merge Agent - Automatic merge conflict resolution using Claude Code
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join, dirname, basename, relative } from 'path';
import { fileURLToPath } from 'url';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { capturePaneAsync, listSessionNamesAsync, sendKeysAsync, sessionExists, sessionExistsAsync } from '../tmux.js';
import { emitActivityEntry, emitActivityTts, emitDashboardLifecycle } from '../activity-logger.js';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import {
  PANOPTICON_HOME,
} from '../paths.js';
import { resolveGitHubIssue } from '../tracker-utils.js';

import { resolveProjectFromIssue } from '../projects.js';
import { runMergeValidation, autoRevertMerge, runQualityGates } from './validation.js';
import { loadProjectsConfig } from '../projects.js';
import { cleanupStaleLocks } from '../git-utils.js';
import { gitPush, gitForcePush, MainDivergedError } from '../git/operations.js';
import { markWorkspaceStuck, setReviewStatus } from '../review-status.js';
import { appendGitOperation, type GitOperationType } from '../git-activity.js';
import { buildStashMessage, createNamedStash, dropStash, listStashes } from '../stashes.js';

const SPECIALISTS_DIR = join(PANOPTICON_HOME, 'specialists');
const MERGE_HISTORY_DIR = join(SPECIALISTS_DIR, 'merge-agent');
const MERGE_HISTORY_FILE = join(MERGE_HISTORY_DIR, 'history.jsonl');

/**
 * Context for a merge conflict resolution request
 */
export interface MergeConflictContext {
  projectPath: string;
  sourceBranch: string;
  targetBranch: string;
  conflictFiles: string[];
  issueId: string;
  testCommand?: string;
}

/**
 * Result of merge agent execution
 */
export interface MergeResult {
  success: boolean;
  resolvedFiles?: string[];
  failedFiles?: string[];
  testsStatus?: 'PASS' | 'FAIL' | 'SKIP';
  validationStatus?: 'PASS' | 'FAIL' | 'NOT_RUN';
  reason?: string;
  notes?: string;
  output?: string;
}

/**
 * Merge history entry
 */
interface MergeHistoryEntry {
  timestamp: string;
  issueId: string;
  sourceBranch: string;
  targetBranch: string;
  conflictFiles: string[];
  result: MergeResult;
  sessionId?: string;
}

/**
 * Timeout for merge agent in milliseconds (15 minutes)
 */
const MERGE_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Notify TLDR daemon to reindex changed files after merge
 */
export async function notifyTldrDaemon(projectPath: string, sourceBranch: string): Promise<void> {
  try {
    console.log(`[merge-agent] Notifying TLDR daemon to reindex changed files...`);

    // Check if TLDR daemon is available
    const venvPath = join(projectPath, '.venv');
    if (!existsSync(venvPath)) {
      console.log(`[merge-agent] No .venv found, skipping TLDR notification`);
      return;
    }

    // Get changed files from the merge
    const { stdout } = await execAsync(`git diff --name-only HEAD~1 HEAD`, {
      cwd: projectPath,
      encoding: 'utf-8'
    });

    const changedFiles = stdout
      .trim()
      .split('\n')
      .filter(f => f.trim().length > 0)
      .filter(f => {
        // Only include source code files (skip docs, configs, etc)
        const ext = f.split('.').pop()?.toLowerCase();
        return ext && ['ts', 'js', 'tsx', 'jsx', 'py', 'java', 'go', 'rs', 'cpp', 'c', 'h'].includes(ext);
      });

    if (changedFiles.length === 0) {
      console.log(`[merge-agent] No source files changed, skipping TLDR notification`);
      return;
    }

    console.log(`[merge-agent] Found ${changedFiles.length} changed source files to reindex`);

    // Get TLDR daemon service
    const { getTldrDaemonService } = await import('../tldr-daemon.js');
    const tldrService = getTldrDaemonService(projectPath, venvPath);

    // Check if daemon is running
    const status = await tldrService.getStatus();
    if (!status.running) {
      console.log(`[merge-agent] TLDR daemon not running, skipping notification`);
      return;
    }

    // Trigger warm to reindex (this will update the index incrementally)
    console.log(`[merge-agent] Triggering TLDR index warm...`);
    await tldrService.warm(true);  // background mode

    console.log(`[merge-agent] ✓ TLDR daemon notified to reindex`);
    logActivity('tldr_notified', `Notified TLDR daemon to reindex ${changedFiles.length} files`);
  } catch (error: any) {
    // Non-fatal - log warning and continue
    console.warn(`[merge-agent] Failed to notify TLDR daemon: ${error.message}`);
    logActivity('tldr_notify_error', `TLDR notification failed: ${error.message}`);
  }
}

/**
 * Post-merge cleanup: move PRD, close PR, move issue to Done, report merge, compact beads.
 *
 * Moves the issue to Done on the tracker so it appears in the Done column.
 * Does NOT tear down the workspace or apply the closed-out label — the human
 * close-out ceremony handles that separately.
 *
 * IDEMPOTENT: Safe to call multiple times for the same issueId. Tracks completed
 * issues and returns immediately on re-entry. This is defense-in-depth against
 * the infinite loop that burned 24,626 Linear API calls (PAN-328).
 */

// Defense-in-depth: track issues that have completed postMergeLifecycle.
// Prevents re-execution even if caller guards fail. Persists for server lifetime.
const _completedPostMerge = new Set<string>();

// Circuit breaker for issue tracker close operations.
// After MAX_CLOSE_RETRIES consecutive failures, stop trying to close the issue
// on the tracker. The issue can be closed manually via the dashboard close-out ceremony.
const _closeIssueFailures = new Map<string, number>();
const MAX_CLOSE_RETRIES = 3;

async function dropLingeringPreMergeStashes(issueId: string, projectPath: string): Promise<void> {
  try {
    const stashes = await listStashes(projectPath);
    const preMergeStashes = stashes.filter((entry) => entry.kind === 'pre-merge' && entry.issueId === issueId.toUpperCase());
    for (const stash of preMergeStashes) {
      await dropStash(projectPath, stash.ref);
      console.log(`[merge-agent] ✓ Dropped lingering pre-merge stash ${stash.ref}`);
    }
  } catch (error: any) {
    console.warn(`[merge-agent] Could not drop lingering pre-merge stashes: ${error.message}`);
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

async function verifyMergedBeforeLifecycle(issueId: string, projectPath: string, sourceBranch?: string): Promise<{ merged: boolean; reason: string }> {
  const branchName = sourceBranch?.trim() || `feature/${issueId.toLowerCase()}`;
  const quotedBranch = shellQuote(branchName);

  await execAsync('git fetch origin main --prune', { cwd: projectPath }).catch(() => undefined);
  await execAsync(`git fetch origin ${shellQuote(`${branchName}:refs/remotes/origin/${branchName}`)}`, { cwd: projectPath }).catch(() => undefined);

  // Check 1: branch tip is an ancestor of origin/main (regular merge case).
  const refsToCheck = [branchName, `origin/${branchName}`];
  for (const ref of refsToCheck) {
    const quotedRef = shellQuote(ref);
    const revParseResult = await execAsync(`git rev-parse --verify ${quotedRef} 2>/dev/null || true`, { cwd: projectPath });
    const refSha = typeof revParseResult?.stdout === 'string' ? revParseResult.stdout : '';
    if (!refSha.trim()) continue;
    try {
      await execAsync(`git merge-base --is-ancestor ${quotedRef} origin/main`, { cwd: projectPath });
      return { merged: true, reason: `${ref} is an ancestor of origin/main` };
    } catch {
      // Not a regular merge ancestor — fall through to GitHub API check.
    }
  }

  // Check 2: GitHub API truth — authoritative for squash and rebase merges
  // where the branch tip is intentionally not an ancestor of main. Run this
  // BEFORE the local-diff fallback so that a squash-merged PR isn't mistaken
  // for "still has unmerged changes" just because the branch retains its
  // own commits (PAN-1024 hit this 2026-05-09: merge succeeded on GitHub
  // but post-merge lifecycle was refused, leaving labels + workspace stale).
  const ghResolved = resolveGitHubIssue(issueId);
  if (ghResolved.isGitHub) {
    const { owner, repo } = ghResolved;
    const { stdout } = await execAsync(
      `gh pr list --repo ${shellQuote(`${owner}/${repo}`)} --state all --head ${quotedBranch} --json number,mergedAt,mergeCommit --limit 5`,
      { cwd: projectPath },
    ).catch(() => ({ stdout: '[]' }));
    const prs = JSON.parse(stdout || '[]') as Array<{ number: number; mergedAt: string | null; mergeCommit: unknown | null }>;
    const mergedPr = prs.find((pr) => pr.mergedAt || pr.mergeCommit);
    if (mergedPr) {
      return { merged: true, reason: `GitHub PR #${mergedPr.number} is merged` };
    }
  }

  // Check 3: local-diff fallback — for the non-GitHub case (Linear/Rally), or
  // GitHub edge cases where the PR API returned nothing. If the branch has
  // no remaining code diff against main, treat as merged.
  for (const ref of refsToCheck) {
    const quotedRef = shellQuote(ref);
    const revParseResult2 = await execAsync(`git rev-parse --verify ${quotedRef} 2>/dev/null || true`, { cwd: projectPath });
    const refSha = typeof revParseResult2?.stdout === 'string' ? revParseResult2.stdout : '';
    if (!refSha.trim()) continue;
    const diffResult = await execAsync(
      `git diff origin/main...${quotedRef} -- ':!.planning' ':!docs/prds' ':!.panopticon/prompts' 2>/dev/null || true`,
      { cwd: projectPath },
    );
    const codeDiff = typeof diffResult?.stdout === 'string' ? diffResult.stdout : '';
    if (!codeDiff.trim()) {
      return { merged: true, reason: `${ref} has no remaining code diff against origin/main` };
    }
    return { merged: false, reason: `${ref} still has unmerged changes` };
  }

  return { merged: true, reason: `No live branch or open PR found for ${branchName}; assuming post-merge cleanup already removed the source ref` };
}

/**
 * Detect a swarm slot branch like `feature/977/slot-3` or `feature/pan-977/slot-3`.
 * Slot branches merge into their parent feature branch, NOT into main, so we must NOT
 * run the full per-issue post-merge lifecycle for them. Instead we drive
 * `onSlotMergeComplete()` so the swarm runtime advances per-item.
 */
const SLOT_BRANCH_PATTERN = /^feature\/[^/]+\/slot-(\d+)$/;
function parseSlotBranch(branch: string | undefined | null): { itemSlot: number; issueLower: string } | null {
  if (!branch) return null;
  const match = SLOT_BRANCH_PATTERN.exec(branch);
  if (!match) return null;
  const slot = Number.parseInt(match[1], 10);
  if (!Number.isInteger(slot) || slot <= 0) return null;
  const issueLower = branch.split('/')[1];
  return { itemSlot: slot, issueLower };
}

export async function postMergeLifecycle(issueId: string, projectPath: string, sourceBranch?: string, options?: { skipDeploy?: boolean }): Promise<void> {
  // Slot-branch merges (feature/<parent>/slot-N → feature/<parent>) drive the
  // per-item swarm runtime, not the per-issue feature lifecycle. Route them to
  // onSlotMergeComplete and return — the issue's overall postMergeLifecycle only
  // fires when the parent feature branch itself merges to main.
  const slotInfo = parseSlotBranch(sourceBranch);
  if (slotInfo) {
    // Loopback HTTP POST to the dashboard's /api/swarm/slot-merged endpoint.
    // We deliberately do NOT static-import the swarm route module here — that would
    // force the entire dashboard-server type graph into every consumer of merge-agent
    // (lib code) and leak dashboard-only types into pure CLI builds. The HTTP edge
    // keeps the dependency direction clean: merge-agent → REST → swarm route.
    // We don't know itemId at the merge layer; the route resolves the canonical
    // itemId from runtime state by matching the slot number.
    const apiPort = process.env.API_PORT || process.env.PORT || '3011';
    const url = `http://127.0.0.1:${apiPort}/api/swarm/slot-merged`;
    let deliveryError: string | null = null;
    let deliveryStatus: number | null = null;
    try {
      const { INTERNAL_TOKEN_HEADER, ensureInternalToken } = await import('../internal-token.js');
      const token = ensureInternalToken();
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [INTERNAL_TOKEN_HEADER]: token,
        },
        body: JSON.stringify({ issueId, itemId: '', slotId: slotInfo.itemSlot }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        deliveryStatus = res.status;
        deliveryError = `HTTP ${res.status}`;
      } else {
        console.log(`[merge-agent] Slot-merge handled for ${issueId} slot ${slotInfo.itemSlot}; skipping issue lifecycle.`);
      }
    } catch (err: any) {
      deliveryError = err?.message ?? String(err);
    }
    if (deliveryError) {
      // PAN-977 round-11 blocker #3: a merged slot branch with a lost dashboard
      // callback used to vanish silently — runtime/plan state was never updated
      // and auto-advance for the issue stalled forever. Persist a durable retry
      // marker the swarm poller picks up on its next cycle, AND surface the
      // failure via the activity log so an operator can see it. The slot branch
      // is already merged at this point so we can't roll back — durable retry
      // is the only safe answer.
      console.warn(`[merge-agent] Slot-merge POST failed for ${issueId} slot ${slotInfo.itemSlot}: ${deliveryError}`);
      try {
        const retryDir = join(PANOPTICON_HOME, 'swarms', 'pending-slot-merges');
        if (!existsSync(retryDir)) mkdirSync(retryDir, { recursive: true });
        const retryFile = join(retryDir, `${issueId.toLowerCase()}-slot-${slotInfo.itemSlot}.json`);
        await writeFile(retryFile, JSON.stringify({
          issueId,
          slotId: slotInfo.itemSlot,
          sourceBranch,
          status: deliveryStatus,
          error: deliveryError,
          queuedAt: new Date().toISOString(),
        }, null, 2), 'utf-8');
        try {
          emitActivityEntry({
            source: 'ship',
            level: 'warn',
            issueId,
            message: `Slot ${slotInfo.itemSlot} merged but /api/swarm/slot-merged delivery failed (${deliveryError}); retry queued at ${retryFile}.`,
          });
        } catch { /* activity logger best-effort */ }
      } catch (writeErr: any) {
        // If we cannot even persist a retry marker, surface a hard error so the
        // outer merge result captures it instead of silently losing the slot.
        throw new Error(`[merge-agent] Slot-merge callback failed for ${issueId} slot ${slotInfo.itemSlot} (${deliveryError}) AND retry-marker write failed: ${writeErr?.message ?? writeErr}`);
      }
    }
    return;
  }

  // Guard 1: skip if already completed (defense-in-depth against infinite loops)
  if (_completedPostMerge.has(issueId)) {
    console.log(`[merge-agent] postMergeLifecycle already completed for ${issueId}, skipping`);
    return;
  }

  const mergeVerification = await verifyMergedBeforeLifecycle(issueId, projectPath, sourceBranch);
  if (!mergeVerification.merged) {
    console.warn(`[merge-agent] Refusing post-merge lifecycle for ${issueId}: ${mergeVerification.reason}`);
    return;
  }
  console.log(`[merge-agent] Verified merge before lifecycle for ${issueId}: ${mergeVerification.reason}`);

  // Set mergeStatus='merged' after verifying the branch or PR actually landed.
  try {
    setReviewStatus(issueId, { mergeStatus: 'merged', readyForMerge: false });
    console.log(`[merge-agent] ✓ mergeStatus set to 'merged' for ${issueId}`);
  } catch (err: any) {
    console.warn(`[merge-agent] Could not set mergeStatus: ${err.message}`);
  }

  // Step 0: Write pending lifecycle file and spawn detached deploy script.
  // The deploy script rebuilds dist/, kills this server, and starts a fresh process.
  // The fresh process reads the pending file on startup and runs the lifecycle steps
  // with correct module chunk references (no ERR_MODULE_NOT_FOUND after merge).
  //
  // Skip this step when we ARE the fresh process (called from processPendingLifecycle) —
  // dynamic imports already resolve correctly and spawning again would create an infinite loop.
  if (!options?.skipDeploy) {
    const pendingFile = join(PANOPTICON_HOME, 'pending-post-merge.json');
    let repoRoot = __dirname.includes('/src/')
      ? __dirname.replace(/\/src\/.*$/, '')
      : __dirname.replace(/\/dist\/.*$/, '').replace(/\/lib\/.*$/, '');
    // If running from a workspace (workspaces/feature-*/), resolve to the main repo root.
    // Without this, the deploy script builds and npm-links from the workspace, hijacking
    // the global `pan` CLI to point at stale workspace code.
    const wsMatch = repoRoot.match(/^(.+)\/workspaces\/feature-[^/]+$/);
    if (wsMatch) {
      repoRoot = wsMatch[1];
      console.log(`[merge-agent] Resolved workspace repoRoot to main repo: ${repoRoot}`);
    }
    const deployScript = join(repoRoot, 'scripts', 'post-merge-deploy.sh');

    try {
      const pendingData = JSON.stringify({
        issueId,
        projectPath,
        sourceBranch: sourceBranch ?? '',
        timestamp: Date.now(),
        reason: 'post-merge',
        trigger: 'merge-agent',
      });
      await writeFile(pendingFile, pendingData, 'utf-8');
      console.log(`[merge-agent] Wrote pending lifecycle file: ${pendingFile}`);

      // Pass 'post-merge' as the reason to the deploy script so it writes the
      // restart marker. We spawn detached and return immediately — the deploy script
      // kills this server. The new server reads the pending file on boot,
      // emits lifecycle_started, and after processing emits lifecycle_complete/failed.
      const child = spawn(deployScript, [repoRoot, issueId, projectPath, sourceBranch ?? '', 'post-merge'], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      console.log(`[merge-agent] Spawned detached deploy script (pid ${child.pid}) — server will restart with new build`);
      return;
    } catch (err: any) {
      console.warn(`[merge-agent] Failed to spawn deploy script: ${err.message}. Falling through to in-process lifecycle (may fail on stale chunks).`);
    }
  }

  console.log(`[merge-agent] Running post-merge cleanup for ${issueId}`);

  await dropLingeringPreMergeStashes(issueId, projectPath);

  // 1. Move PRD from active to completed (via lifecycle module)
  try {
    const { movePrd } = await import('../lifecycle/archive-planning.js');
    const prdResult = await movePrd({ issueId, projectPath });
    if (prdResult.success && !prdResult.skipped) {
      console.log(`[merge-agent] ✓ ${prdResult.details?.join('; ')}`);
      logActivity('prd_moved', `Moved ${issueId} PRD to completed directory`);
    } else if (prdResult.skipped) {
      console.log(`[merge-agent] PRD move skipped: ${prdResult.details?.join('; ')}`);
    } else {
      console.warn(`[merge-agent] PRD move failed: ${prdResult.error}`);
    }
  } catch (err) {
    console.warn(`[merge-agent] Could not move PRD: ${err}`);
  }

  // 2. Clean up workflow labels + apply 'merged' label (non-fatal)
  // MUST run BEFORE closing the issue — once closed on GitHub, label edits fail silently.
  // This was the root cause of in-review labels persisting after merge (PAN-453 incident).
  try {
    const { cleanupMergedLabels } = await import('../lifecycle/label-cleanup.js');
    const ghResolved = resolveGitHubIssue(issueId);
    const labelCtx = ghResolved.isGitHub
      ? { issueId, projectPath, github: { owner: ghResolved.owner, repo: ghResolved.repo, number: ghResolved.number } }
      : { issueId, projectPath };
    const labelResult = await cleanupMergedLabels(labelCtx);
    if (labelResult.success && !labelResult.skipped) {
      console.log(`[merge-agent] ✓ ${labelResult.details?.join('; ')}`);
      logActivity('labels_cleaned', labelResult.details?.join('; ') || 'Labels cleaned');
    } else if (labelResult.skipped) {
      console.log(`[merge-agent] Label cleanup skipped: ${labelResult.details?.join('; ')}`);
    } else {
      console.warn(`[merge-agent] Label cleanup failed (non-fatal): ${labelResult.error}`);
    }
  } catch (err) {
    console.warn(`[merge-agent] Could not clean labels: ${err}`);
  }

  // 3b. Close issue on tracker (fire-and-forget with circuit breaker)
  // This is decoupled from the merge lifecycle: failure to close the issue on the
  // tracker does NOT block the merge or cause retries. The close-out ceremony handles
  // any issues that weren't auto-closed.
  closeIssueWithCircuitBreaker(issueId, projectPath);

  // 4. Compact old beads (via lifecycle module)
  try {
    const { compactBeads } = await import('../lifecycle/compact-beads.js');
    const beadsResult = await compactBeads({ issueId, projectPath });
    if (beadsResult.success && !beadsResult.skipped) {
      console.log(`[merge-agent] ✓ ${beadsResult.details?.join('; ')}`);
      logActivity('beads_compaction_complete', beadsResult.details?.join('; ') || 'Beads compacted');
    }
  } catch (err) {
    console.warn(`[merge-agent] Beads compaction failed: ${err}`);
  }

  // 5. Kill work agent tmux session to free resources (non-fatal)
  // Stopped agents with live tmux sessions leak memory (Claude + MCP processes stay resident).
  // Kill the session unconditionally if it exists — don't require agentState to exist first
  // (state file may have been cleaned up already, leaving an orphaned session alive).
  try {
    const { getAgentState, markAgentStoppedState, saveAgentState } = await import('../agents.js');
    const { killSession, sessionExists } = await import('../tmux.js');
    const agentId = `agent-${issueId.toLowerCase()}`;
    // Stamp merged: true on the agent state UNCONDITIONALLY (whether or not the
    // tmux session is alive). autoResumeStoppedWorkAgents reads this flag as a
    // hard "do-not-resume" signal — without it, an old state.json that says
    // status='running' can get respawned by orphan recovery during a mergeStatus
    // flap, putting a work agent on a long-merged issue (saw 10 of these tonight).
    try {
      const agentState = getAgentState(agentId);
      if (agentState) {
        markAgentStoppedState(agentState);
        (agentState as any).merged = true;
        (agentState as any).mergedAt = new Date().toISOString();
        saveAgentState(agentState);
      }
    } catch (stateErr) {
      console.warn(`[merge-agent] Could not stamp merged flag on ${agentId}: ${stateErr}`);
    }
    if (sessionExists(agentId)) {
      killSession(agentId);
      console.log(`[merge-agent] ✓ Killed work agent session ${agentId} to free resources`);
      logActivity('agent_session_killed', `Freed resources: killed tmux session for ${agentId}`);
    }
    // Also kill planning agent if it exists
    const planningId = `planning-${issueId.toLowerCase()}`;
    if (sessionExists(planningId)) {
      killSession(planningId);
      console.log(`[merge-agent] ✓ Killed planning agent session ${planningId}`);
    }
  } catch (err) {
    console.warn(`[merge-agent] Could not kill agent sessions: ${err}`);
  }

  // 5a. Kill canonical reviewer/synthesis sessions (PAN-915).
  // Sessions persist across review rounds to preserve reviewer context, so the
  // merge is the right moment to tear them down. Issue is done — context value
  // is zero, RSS leak risk is non-zero. Resolve projectKey from the project
  // path so we don't depend on caller-supplied config.
  try {
    const { killAllReviewerSessions } = await import('./review-agent.js');
    const { resolveProjectFromIssue } = await import('../projects.js');
    const resolved = resolveProjectFromIssue(issueId);
    const projectKey = resolved?.projectKey;
    if (projectKey) {
      const { killed } = await killAllReviewerSessions(projectKey, issueId);
      if (killed.length > 0) {
        console.log(`[merge-agent] ✓ Killed ${killed.length} canonical reviewer session(s) for ${issueId}`);
        logActivity('reviewer_sessions_killed', `Killed ${killed.length} reviewer session(s) for ${issueId} on merge`);
      }
    }
  } catch (err) {
    console.warn(`[merge-agent] Could not kill canonical reviewer sessions: ${err}`);
  }

  // 5b. Delete work agent + planning state dirs from ~/.panopticon/agents/ (non-fatal)
  // Event-driven cleanup — the merge is the moment the agent state becomes useless.
  // See docs/REVIEW-AGENT-ARCHITECTURE.md "Dispatch mechanics" for the broader rule:
  // state dirs are cleaned at the event that renders them obsolete, not by retention.
  try {
    const { rm } = await import('fs/promises');
    const { AGENTS_DIR } = await import('../paths.js');
    const issueLower = issueId.toLowerCase();
    const agentDir = join(AGENTS_DIR, `agent-${issueLower}`);
    const planningDir = join(AGENTS_DIR, `planning-${issueLower}`);
    for (const dir of [agentDir, planningDir]) {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch { /* non-fatal */ }
    }
    console.log(`[merge-agent] ✓ Removed agent state dirs for ${issueId}`);
  } catch (err) {
    console.warn(`[merge-agent] Could not remove agent state dirs: ${err}`);
  }

  // 5c. vBRIEF lifecycle transition: active/ → completed/ on main (PAN-946)
  try {
    const { transitionVBriefOnMain } = await import('../vbrief/lifecycle-io.js');
    const result = await transitionVBriefOnMain(
      projectPath,
      issueId,
      'completed',
      'completed',
      `scope: complete ${issueId.toUpperCase()} vBRIEF`,
    );
    if (result.moved) {
      console.log(`[merge-agent] ✓ vBRIEF moved active → completed for ${issueId}`);
    }
    if (result.committed) {
      console.log(`[merge-agent] ✓ Committed vBRIEF completion on main for ${issueId}`);
    }
  } catch (err) {
    console.warn(`[merge-agent] vBRIEF completion transition failed (non-fatal): ${err}`);
  }

  // 6. Stop Docker containers + networks to prevent network pool exhaustion (non-fatal)
  // Orphaned Docker networks accumulate when workspaces are merged but containers are never
  // torn down, eventually exhausting Docker's address pool and blocking new workspace creation.
  try {
    const { findWorkspacePath } = await import('../lifecycle/archive-planning.js');
    const { stopWorkspaceDocker } = await import('../workspace-manager.js');
    const issueLower = issueId.toLowerCase();
    const workspacePath = findWorkspacePath(projectPath, issueLower);
    if (workspacePath) {
      const dockerResult = await stopWorkspaceDocker(workspacePath, issueLower);
      if (dockerResult.containersFound) {
        console.log(`[merge-agent] ✓ Stopped Docker containers: ${dockerResult.steps.join('; ')}`);
        logActivity('docker_cleanup', `Stopped Docker for ${issueId}: ${dockerResult.steps.join('; ')}`);
      }
    }
  } catch (err) {
    console.warn(`[merge-agent] Docker cleanup failed (non-fatal): ${err}`);
  }

  // 7. Teardown workspace directory + delete feature branches (PAN-925)
  // Uses the consolidated teardownWorkspace module which handles: tmux sessions (idempotent
  // with step 5), TLDR daemon, Docker (idempotent with step 6), worktree removal, agent
  // state cleanup, and branch deletion. Steps already performed above are no-ops.
  try {
    const { teardownWorkspace } = await import('../lifecycle/teardown-workspace.js');
    const ctx = { issueId, projectPath };
    const teardownResults = await teardownWorkspace(ctx, { deleteBranches: true });
    const completedSteps = teardownResults.filter(r => r.success && !r.skipped);
    if (completedSteps.length > 0) {
      const summary = completedSteps.map(r => r.details?.join('; ') || r.step).join(' | ');
      console.log(`[merge-agent] ✓ Workspace teardown: ${summary}`);
      logActivity('workspace_teardown', `Workspace teardown for ${issueId}: ${summary}`);
    } else {
      console.log(`[merge-agent] Workspace teardown: nothing to clean up for ${issueId}`);
    }
  } catch (err) {
    console.warn(`[merge-agent] Workspace teardown failed (non-fatal): ${err}`);
  }

  // 7b. Prune checkpoint refs for this issue's agents (non-fatal)
  // Refs are written per-turn into refs/pan/turn/<agentId>/<turnId> and accumulate in the
  // main repo's ref store (worktrees share the parent .git). Delete them on merge so they
  // don't pile up indefinitely.
  try {
    const { pruneCheckpointRefsForAgents } = await import('../checkpoint/checkpoint-manager.js');
    const issueLower = issueId.toLowerCase();
    const agentIds = [`agent-${issueLower}`, `planning-${issueLower}`];
    const pruned = await pruneCheckpointRefsForAgents(projectPath, agentIds);
    console.log(`[merge-agent] ✓ Checkpoint ref prune: ${pruned} ref(s) removed for ${issueId}`);
  } catch (err) {
    console.warn(`[merge-agent] Checkpoint ref pruning failed (non-fatal): ${err}`);
  }

  // 8. Apply 'needs-close-out' label to signal the user that close-out ceremony is pending (PAN-925)
  // The close-out ceremony is human-gated — it verifies PRD preservation, branch merge status,
  // and applies the final 'closed-out' label. We don't auto-trigger it because the user must
  // confirm the work is truly complete before final sign-off.
  try {
    const ghResolved = resolveGitHubIssue(issueId);
    if (ghResolved.isGitHub) {
      const { owner, repo, number } = ghResolved;
      // Ensure the label exists (--force is idempotent)
      await execAsync(
        `gh label create "needs-close-out" --repo ${owner}/${repo} --color "fbca04" --description "Merged — awaiting close-out ceremony" --force 2>/dev/null || true`,
      );
      await execAsync(
        `gh issue edit ${number} --repo ${owner}/${repo} --add-label "needs-close-out"`,
      );
      console.log(`[merge-agent] ✓ Applied 'needs-close-out' label on GitHub #${number}`);
    }
  } catch (err) {
    console.warn(`[merge-agent] Could not apply needs-close-out label (non-fatal): ${err}`);
  }

  // Mark completed BEFORE logging — prevents re-entry even if the log line triggers something
  _completedPostMerge.add(issueId);

  console.log(`[merge-agent] Post-merge cleanup completed for ${issueId}. Issue moved to Done — awaiting close-out.`);
  announceMerge('completed', issueId);
  logActivity('merge_complete', `Merged ${issueId}. Issue moved to Done — awaiting close-out.`);
}

/**
 * Close issue on tracker with circuit breaker protection.
 * Fire-and-forget: runs asynchronously, never blocks the caller.
 * Stops retrying after MAX_CLOSE_RETRIES consecutive failures per issue.
 */
function closeIssueWithCircuitBreaker(issueId: string, projectPath: string): void {
  const failures = _closeIssueFailures.get(issueId) || 0;
  if (failures >= MAX_CLOSE_RETRIES) {
    console.log(`[merge-agent] Circuit breaker open for ${issueId} issue close (${failures} failures). Will be closed during close-out ceremony.`);
    return;
  }

  // Fire-and-forget — errors are caught and logged, never propagated
  (async () => {
    try {
      const { closeIssue } = await import('../lifecycle/close-issue.js');
      const ghResolved = resolveGitHubIssue(issueId);
      const ctx = ghResolved.isGitHub
        ? { issueId, projectPath, github: { owner: ghResolved.owner, repo: ghResolved.repo, number: ghResolved.number } }
        : { issueId, projectPath };
      const results = await closeIssue(ctx, { applyLabel: false, comment: 'Merged to main via Panopticon merge-agent' });

      let anyFailure = false;
      for (const r of results) {
        if (r.success && !r.skipped) {
          console.log(`[merge-agent] ✓ ${r.details?.join('; ')}`);
          logActivity(r.step, r.details?.join('; ') || r.step);
        } else if (!r.skipped) {
          console.warn(`[merge-agent] ✗ ${r.step} failed: ${r.error}`);
          anyFailure = true;
        }
      }

      if (anyFailure) {
        const newCount = (_closeIssueFailures.get(issueId) || 0) + 1;
        _closeIssueFailures.set(issueId, newCount);
        if (newCount >= MAX_CLOSE_RETRIES) {
          console.warn(`[merge-agent] Circuit breaker tripped for ${issueId} after ${newCount} failures. Issue close deferred to close-out ceremony.`);
        }
      } else {
        // Success — clear failure counter
        _closeIssueFailures.delete(issueId);
      }
    } catch (err) {
      const newCount = (_closeIssueFailures.get(issueId) || 0) + 1;
      _closeIssueFailures.set(issueId, newCount);
      console.warn(`[merge-agent] Could not move issue to Done (attempt ${newCount}/${MAX_CLOSE_RETRIES}): ${err}`);
    }
  })();
}

/**
 * Reset postMergeLifecycle completion tracking for an issue (used by reopen).
 */
export function resetPostMergeState(issueId: string): void {
  _completedPostMerge.delete(issueId);
  _closeIssueFailures.delete(issueId);
}

/**
 * Parse result markers from agent output
 */
function parseAgentOutput(output: string): MergeResult {
  const lines = output.split('\n');

  let mergeResult: 'SUCCESS' | 'FAILURE' | null = null;
  let resolvedFiles: string[] = [];
  let failedFiles: string[] = [];
  let testsStatus: 'PASS' | 'FAIL' | 'SKIP' | null = null;
  let validationStatus: 'PASS' | 'FAIL' | null = null;
  let reason = '';
  let notes = '';

  for (const line of lines) {
    const trimmed = line.trim();

    // Match MERGE_RESULT
    if (trimmed.startsWith('MERGE_RESULT:')) {
      const value = trimmed.substring('MERGE_RESULT:'.length).trim();
      if (value === 'SUCCESS' || value === 'FAILURE') {
        mergeResult = value;
      }
    }

    // Match RESOLVED_FILES
    if (trimmed.startsWith('RESOLVED_FILES:')) {
      const value = trimmed.substring('RESOLVED_FILES:'.length).trim();
      resolvedFiles = value
        .split(',')
        .map((f) => f.trim())
        .filter((f) => f.length > 0);
    }

    // Match FAILED_FILES
    if (trimmed.startsWith('FAILED_FILES:')) {
      const value = trimmed.substring('FAILED_FILES:'.length).trim();
      failedFiles = value
        .split(',')
        .map((f) => f.trim())
        .filter((f) => f.length > 0);
    }

    // Match TESTS
    if (trimmed.startsWith('TESTS:')) {
      const value = trimmed.substring('TESTS:'.length).trim();
      if (value === 'PASS' || value === 'FAIL' || value === 'SKIP') {
        testsStatus = value;
      }
    }

    // Match VALIDATION
    if (trimmed.startsWith('VALIDATION:')) {
      const value = trimmed.substring('VALIDATION:'.length).trim();
      if (value === 'PASS' || value === 'FAIL') {
        validationStatus = value;
      }
    }

    // Match REASON
    if (trimmed.startsWith('REASON:')) {
      reason = trimmed.substring('REASON:'.length).trim();
    }

    // Match NOTES
    if (trimmed.startsWith('NOTES:')) {
      notes = trimmed.substring('NOTES:'.length).trim();
    }
  }

  // Build result
  if (mergeResult === 'SUCCESS') {
    return {
      success: true,
      resolvedFiles,
      testsStatus: testsStatus || 'SKIP',
      validationStatus: validationStatus || 'NOT_RUN',
      notes,
      output,
    };
  } else if (mergeResult === 'FAILURE') {
    return {
      success: false,
      failedFiles,
      validationStatus: validationStatus || 'NOT_RUN',
      reason,
      notes,
      output,
    };
  } else {
    // No structured result markers found - try to detect human-readable format
    // Agents sometimes output "MERGE TASK COMPLETE" instead of "MERGE_RESULT: SUCCESS"
    const lowerOutput = output.toLowerCase();

    // Check for success indicators
    const successIndicators = [
      'merge task complete',
      'successfully merged',
      'merge complete',
      'pushed merge commit',
      'successfully merged and pushed',
    ];

    const failureIndicators = [
      'merge failed',
      'merge task failed',
      'could not merge',
      'conflict not resolved',
    ];

    const hasSuccessIndicator = successIndicators.some(i => lowerOutput.includes(i));
    const hasFailureIndicator = failureIndicators.some(i => lowerOutput.includes(i));

    if (hasSuccessIndicator && !hasFailureIndicator) {
      // Extract test status from output if mentioned
      let detectedTestStatus: 'PASS' | 'FAIL' | 'SKIP' = 'SKIP';
      if (lowerOutput.includes('tests: pass') || lowerOutput.includes('tests passed') ||
          output.match(/\d+ passed/)) {
        detectedTestStatus = 'PASS';
      } else if (lowerOutput.includes('tests: fail') || lowerOutput.includes('tests failed')) {
        detectedTestStatus = 'FAIL';
      }

      console.log('[merge-agent] Detected success from human-readable output');
      return {
        success: true,
        testsStatus: detectedTestStatus,
        validationStatus: 'PASS',
        notes: 'Detected from human-readable output (agent did not use structured format)',
        output,
      };
    }

    if (hasFailureIndicator) {
      console.log('[merge-agent] Detected failure from human-readable output');
      return {
        success: false,
        validationStatus: 'NOT_RUN',
        reason: 'Detected merge failure from agent output',
        output,
      };
    }

    // Truly unrecognized output
    return {
      success: false,
      validationStatus: 'NOT_RUN',
      reason: 'Agent did not report result in expected format',
      output,
    };
  }
}

/**
 * Get conflict files from git status (async)
 */
async function getConflictFiles(projectPath: string): Promise<string[]> {
  try {
    const { stdout: status } = await execAsync('git diff --name-only --diff-filter=U', {
      cwd: projectPath,
      encoding: 'utf-8',
    });

    return status
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (error) {
    console.error('Failed to get conflict files:', error);
    return [];
  }
}

/**
 * Log merge to history
 */
function logMergeHistory(context: MergeConflictContext, result: MergeResult, sessionId?: string): void {
  // Ensure history directory exists
  if (!existsSync(MERGE_HISTORY_DIR)) {
    mkdirSync(MERGE_HISTORY_DIR, { recursive: true });
  }

  const entry: MergeHistoryEntry = {
    timestamp: new Date().toISOString(),
    issueId: context.issueId,
    sourceBranch: context.sourceBranch,
    targetBranch: context.targetBranch,
    conflictFiles: context.conflictFiles,
    result: {
      ...result,
      output: undefined, // Don't store full output in history
    },
    sessionId,
  };

  appendFileSync(MERGE_HISTORY_FILE, JSON.stringify(entry) + '\n', 'utf-8');
}

/**
 * Log activity to the dashboard activity log (event-sourced via emitActivityEntry)
 */
function logActivity(action: string, details: string, issueId?: string): void {
  emitActivityEntry({
    source: 'ship',
    level: action.includes('fail') || action.includes('error') ? 'error' : action.includes('warn') ? 'warn' : 'success',
    message: details,
    issueId,
  });
}

/**
 * Voice-worthy merge milestone announcement. Messages start with one of three
 * distinctive prefixes ("Merge started", "Merge completed", "Merge failed") so
 * pan-tts can filter merge-agent chatter and speak only these three events.
 *
 * Do not change these prefixes without updating the pan-tts filter
 * (~/Projects/pan-tts/src/pan_tts/__main__.py — ALLOWED_MERGE_PREFIXES).
 */
function announceMerge(
  status: 'started' | 'completed' | 'failed',
  issueId: string,
  extra?: string,
): void {
  const prefix = status === 'started'
    ? 'Merge started'
    : status === 'completed'
      ? 'Merge completed'
      : 'Merge failed';
  const tail = extra ? `. ${extra}` : '';
  emitActivityEntry({
    source: 'ship',
    level: status === 'failed' ? 'error' : 'success',
    message: `${prefix} for ${issueId}${tail}`,
    issueId,
  });
  // Upleveled TTS utterance — short, speakable, no issue prefix noise
  const ttsUtterance = status === 'started'
    ? `Starting merge for ${issueId}`
    : status === 'completed'
      ? `${issueId} merged to main`
      : `Merge failed for ${issueId}`;
  emitActivityTts({
    utterance: ttsUtterance,
    priority: status === 'failed' ? 0 : 1,
    issueId,
    source: 'merge-agent',
    eventType: `mergeStatus.${status === 'completed' ? 'merged' : status === 'started' ? 'merging' : 'failed'}`,
  });
}

/**
 * Capture tmux output and look for result markers (async)
 */
async function captureTmuxOutput(sessionName: string): Promise<string> {
  try {
    return await capturePaneAsync(sessionName);
  } catch {
    return '';
  }
}

/** Patterns to match in tmux capture-pane output (git push/fetch lines) */
export const GIT_PATTERNS: Array<{ re: RegExp; operation: GitOperationType; level: 'info' | 'warn' | 'error' }> = [
  { re: /force-with-lease/i,             operation: 'force_push_cmd',  level: 'warn' },
  { re: /git push/i,                     operation: 'push_attempt',    level: 'info' },
  { re: /git fetch/i,                    operation: 'fetch_attempt',   level: 'info' },
  { re: /\[rejected\]/i,                 operation: 'push_rejected',   level: 'error' },
  { re: /non-fast-forward/i,             operation: 'non_ff',          level: 'error' },
  { re: /retrying/i,                     operation: 'retry',           level: 'warn' },
  { re: /\[remote rejected\]/i,          operation: 'remote_rejected', level: 'error' },
  { re: /Everything up-to-date/i,        operation: 'push_noop',       level: 'info' },
];

/**
 * Scan tmux capture-pane output for git push/fetch patterns and emit each
 * as a git_operations row. Uses seenLineHashes to dedupe within a session.
 */
export function scanGitPatterns(
  output: string,
  seenLineHashes: Set<string>,
  issueId: string,
  branch?: string,
): void {
  const lines = output.split('\n');
  const ts = new Date().toISOString();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Simple hash: first 120 chars (avoids hashing megabytes)
    const hash = trimmed.slice(0, 120);
    if (seenLineHashes.has(hash)) continue;

    for (const { re, operation, level } of GIT_PATTERNS) {
      if (re.test(trimmed)) {
        seenLineHashes.add(hash);
        appendGitOperation({
          operation,
          branch,
          issueId,
          status: level === 'error' ? 'failure' : 'success',
          error: level !== 'info' ? trimmed.slice(0, 200) : undefined,
          ts,
        });
        emitActivityEntry({
          source: 'ship',
          level,
          message: `[git] ${trimmed.slice(0, 100)}`,
          issueId,
        });
        break; // only match one pattern per line
      }
    }
  }
}

/**
 * Check if specialist-merge-agent tmux session is running (async)
 */
async function isMergeAgentRunning(): Promise<boolean> {
  return sessionExistsAsync('specialist-merge-agent');
}

/**
 * Send a message to an agent's tmux session (async)
 */
async function sendMessageToAgent(issueId: string, message: string): Promise<boolean> {
  // Agent sessions are typically named agent-{issueId} (lowercase)
  const sessionName = `agent-${issueId.toLowerCase()}`;

  try {
    // Check if session exists
    if (!sessionExists(sessionName)) {
      console.log(`[merge-agent] Could not send message to ${sessionName} (session does not exist)`);
      return false;
    }

    // Send the message using centralized sendKeys
    await sendKeysAsync(sessionName, message);

    console.log(`[merge-agent] Sent message to ${sessionName}`);
    logActivity('agent_message', `Sent to ${sessionName}: ${message.slice(0, 100)}...`);
    return true;
  } catch {
    console.log(`[merge-agent] Could not send message to ${sessionName} (session may not exist)`);
    return false;
  }
}

function defaultWorkspaceForIssue(issueId: string): string | undefined {
  const project = resolveProjectFromIssue(issueId);
  if (!project?.projectPath) return undefined;
  return join(project.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
}

function buildShipPreparationPrompt(options: {
  issueId: string;
  workspacePath: string;
  featureBranch: string;
  targetBranch: string;
  apiUrl: string;
}): string {
  return `SHIP TASK for ${options.issueId}:

WORKSPACE: ${options.workspacePath}
FEATURE BRANCH: ${options.featureBranch}
TARGET BRANCH: ${options.targetBranch}

Prepare this already-reviewed branch for the dashboard's human Merge button.

Required steps:
1. Work only in ${options.workspacePath}.
2. Fetch the target branch: git fetch origin ${options.targetBranch}.
3. Rebase ${options.featureBranch} onto origin/${options.targetBranch} using non-interactive rebase only.
4. Resolve rebase conflicts if they are narrow and source-level. If conflicts are broad, abort and report SHIP BLOCKED.
5. Run the required verification gates from the project instructions (at minimum: npm run typecheck, npm run lint, npm test when present/applicable).
6. Push the prepared feature branch with --force-with-lease.
7. Mark the issue ready for the human merge button:
   curl -s -X POST ${options.apiUrl}/api/review/${options.issueId}/status \\
     -H "Content-Type: application/json" \\
     -d '{"readyForMerge":true}'
8. Report SHIP READY with the pushed commit and verification summary.

No-rescan rule:
- After resolving detected conflict files, do NOT re-scan for additional conflicts.
- If the rebase produces conflicts beyond the immediately visible set, abort and report SHIP BLOCKED for human triage.
- Do not loop: resolve once, verify once, push once.

Human-merge invariant:
- Do NOT run gh pr merge.
- Do NOT call any merge endpoint or destructive merge API POST.
- Do NOT run git merge into main/master.
- Do NOT push to main/master.
- The existing dashboard Merge button owns the actual merge and postMergeLifecycle cleanup.`;
}

function buildShipSyncMainPrompt(options: {
  issueId: string;
  workspacePath: string;
  workspaceBranch: string;
  conflictFiles: string[];
}): string {
  return `SHIP SYNC-MAIN CONFLICT TASK for ${options.issueId}:

WORKSPACE: ${options.workspacePath}
WORKSPACE BRANCH: ${options.workspaceBranch}
CONFLICT FILES:
${options.conflictFiles.map(f => `- ${f}`).join('\n')}

Resolve the in-progress sync-main conflict in the workspace branch only.

Required steps:
1. Work only in ${options.workspacePath}.
2. Inspect the listed conflict files and resolve conflict markers by preserving the feature branch intent and current main behavior.
3. Run the relevant verification gates from the project instructions.
4. Commit the sync-main conflict resolution if the merge requires a commit, then push the workspace branch with --force-with-lease if needed.
5. Report SHIP READY for the sync-main conflict resolution, or SHIP BLOCKED with exact files and reasons.

Human-merge invariant:
- Do NOT run gh pr merge.
- Do NOT call any merge endpoint or destructive merge API POST.
- Do NOT push to main/master.
- Do NOT perform post-merge cleanup.`;
}

async function spawnShipRoleForTask(options: {
  issueId: string;
  workspacePath?: string;
  prompt: string;
}): Promise<{ success: boolean; message: string; tmuxSession?: string; error?: string }> {
  const workspace = options.workspacePath ?? defaultWorkspaceForIssue(options.issueId);
  if (!workspace) {
    return {
      success: false,
      message: `Could not resolve workspace for ${options.issueId}`,
      error: 'workspace resolution failed',
    };
  }

  try {
    const { spawnRun } = await import('../agents.js');
    const run = await spawnRun(options.issueId, 'ship', {
      workspace,
      prompt: options.prompt,
    });
    return {
      success: true,
      message: `ship role started as ${run.id}`,
      tmuxSession: run.id,
    };
  } catch (error: any) {
    return {
      success: false,
      message: error?.message ?? 'Failed to start ship role',
      error: error?.message,
    };
  }
}

/**
 * Attempt merge and handle result (clean merge, conflicts, or failure)
 *
 * This function:
 * 1. Attempts to merge sourceBranch into current branch
 * 2. If clean merge: commits and optionally runs tests
 * 3. If preparation is needed: starts the ship role to rebase/verify/push
 * 4. If failure: returns error
 *
 * @param projectPath - Project root path
 * @param sourceBranch - Feature branch to merge
 * @param targetBranch - Target branch (usually main)
 * @param issueId - Issue identifier
 * @returns Promise that resolves with merge result
 */
export async function spawnMergeAgentForBranches(
  projectPath: string,
  sourceBranch: string,
  targetBranch: string,
  issueId: string,
  options?: { skipDoneReport?: boolean }
): Promise<MergeResult> {
  console.log(`[ship-role] Starting ship preparation for ${sourceBranch} against ${targetBranch}`);
  announceMerge('started', issueId);
  logActivity('ship_start', `Starting ship role for ${sourceBranch} -> ${targetBranch}`);

  try {
    const lockCleanup = await cleanupStaleLocks(projectPath);
    if (lockCleanup.errors.some(e => e.error.includes('Git processes are running'))) {
      const message = 'Git processes are still running - cannot safely start ship role';
      console.error(`[ship-role] ${message}`);
      logActivity('ship_blocked', message);
      return { success: false, reason: message };
    }

    const { stdout: remoteBranches } = await execAsync(`git ls-remote --heads origin ${sourceBranch}`, {
      cwd: projectPath,
      encoding: 'utf-8',
    });
    if (!remoteBranches.trim()) {
      const message = `Branch ${sourceBranch} is not pushed to remote.`;
      console.error(`[ship-role] ${message}`);
      logActivity('ship_blocked', message);
      return { success: false, reason: message };
    }

    await execAsync(`git fetch origin ${sourceBranch} ${targetBranch}`, {
      cwd: projectPath,
      encoding: 'utf-8',
    });
    try {
      await execAsync(
        `git merge-base --is-ancestor origin/${sourceBranch} origin/${targetBranch}`,
        { cwd: projectPath, encoding: 'utf-8' }
      );
      const message = `Branch ${sourceBranch} is already integrated into ${targetBranch} — no ship run needed`;
      console.log(`[ship-role] ${message}`);
      logActivity('ship_skipped', message);
      return { success: true, reason: message, validationStatus: 'NOT_RUN', testsStatus: 'SKIP' };
    } catch (e: any) {
      if (e.code !== 1) throw e;
    }
  } catch (error: any) {
    return { success: false, reason: `Ship pre-flight check failed: ${error.message}` };
  }

  const apiPort = process.env.API_PORT || process.env.PORT || '3011';
  const apiUrl = process.env.DASHBOARD_URL || `http://localhost:${apiPort}`;
  const workspacePath = defaultWorkspaceForIssue(issueId) ?? projectPath;
  const prompt = buildShipPreparationPrompt({
    issueId,
    workspacePath,
    featureBranch: sourceBranch,
    targetBranch,
    apiUrl,
  });

  const shipResult = await spawnShipRoleForTask({ issueId, workspacePath, prompt });
  if (!shipResult.success) {
    console.error(`[ship-role] Failed to start ship role: ${shipResult.message}`);
    announceMerge('failed', issueId, 'Could not start ship role');
    logActivity('ship_error', `Failed to start ship role: ${shipResult.message}`);
    return { success: false, reason: `Failed to start ship role: ${shipResult.message}` };
  }

  if (!options?.skipDoneReport) {
    logActivity('ship_started', shipResult.message);
  }
  return {
    success: true,
    validationStatus: 'NOT_RUN',
    testsStatus: 'SKIP',
    reason: shipResult.message,
    notes: 'Ship role started; it will rebase, verify, push, and mark readyForMerge for the human Merge button.',
  };
}

/**
 * Start the ship role to rebase a feature branch onto a base branch,
 * verify it, push it, and mark it ready for the human Merge button.
 *
 * Used by the PR-based merge flow: triggerMerge() calls this to prepare the
 * feature branch, then calls `gh pr merge --squash` once the rebase is done.
 */
export async function spawnRebaseAgentForBranch(
  workspacePath: string,
  featureBranch: string,
  baseBranch: string,
  issueId: string,
): Promise<MergeResult> {
  console.log(`[ship-role] Starting ship rebase of ${featureBranch} onto ${baseBranch} for ${issueId}`);
  logActivity('ship_rebase_start', `Starting ship role for ${featureBranch} onto ${baseBranch}`);

  try {
    const { stdout: remoteBranches } = await execAsync(
      `git ls-remote --heads origin ${featureBranch}`,
      { cwd: workspacePath, encoding: 'utf-8' },
    );
    if (!remoteBranches.trim()) {
      const message = `Branch ${featureBranch} is not pushed to remote`;
      console.error(`[ship-role] ${message}`);
      return { success: false, reason: message };
    }
  } catch {
    return { success: false, reason: `Cannot verify remote branch ${featureBranch}` };
  }

  const apiPort = process.env.API_PORT || process.env.PORT || '3011';
  const apiUrl = process.env.DASHBOARD_URL || `http://localhost:${apiPort}`;
  const prompt = buildShipPreparationPrompt({
    issueId,
    workspacePath,
    featureBranch,
    targetBranch: baseBranch,
    apiUrl,
  });

  const shipResult = await spawnShipRoleForTask({ issueId, workspacePath, prompt });
  if (!shipResult.success) {
    return {
      success: false,
      reason: `Failed to start ship role: ${shipResult.message}`,
    };
  }

  logActivity('ship_rebase_started', shipResult.message);
  return {
    success: true,
    validationStatus: 'NOT_RUN',
    testsStatus: 'SKIP',
    reason: shipResult.message,
    notes: 'Ship role started for rebase/verify/push; it will mark readyForMerge after preparation succeeds.',
  };
}

async function salvageStrandedMerge(
  projectPath: string,
  targetBranch: string,
  headBefore: string,
  issueId: string,
  logActivity: (action: string, detail: string) => void,
): Promise<{ success: boolean; reason?: string } | null> {
  try {
    const { stdout: currentHeadRaw } = await execAsync('git rev-parse HEAD', {
      cwd: projectPath,
      encoding: 'utf-8',
    });
    const currentHead = currentHeadRaw.trim();

    if (currentHead === headBefore) {
      // No local merge happened — nothing to salvage
      return null;
    }

    // Local HEAD changed — check if it's ahead of remote
    await execAsync(`git fetch origin ${targetBranch}`, {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 10000,
    }).catch(() => {});

    const { stdout: remoteHeadRaw } = await execAsync(`git rev-parse origin/${targetBranch}`, {
      cwd: projectPath,
      encoding: 'utf-8',
    });

    if (remoteHeadRaw.trim() === currentHead) {
      // Already pushed (maybe by another process)
      console.log(`[merge-agent] Salvage check: merge already pushed`);
      return { success: true };
    }

    // Stranded merge detected — push it (with divergence guard to protect hotfixes)
    console.log(`[merge-agent] SALVAGING stranded merge for ${issueId}: local HEAD ${currentHead.slice(0, 8)} != remote ${remoteHeadRaw.trim().slice(0, 8)}`);
    logActivity('merge_salvage', `Pushing stranded merge commit ${currentHead.slice(0, 8)} for ${issueId}`);

    try {
      await gitPush(projectPath, 'origin', targetBranch, { issueId });
    } catch (pushErr: unknown) {
      if (pushErr instanceof MainDivergedError) {
        // origin has advanced past our local ancestor — a hotfix landed.
        // Mark stuck so Deacon won't re-trigger, then let the caller handle it.
        markWorkspaceStuck(issueId, 'main_diverged', {
          localSha: pushErr.localSha,
          remoteSha: pushErr.remoteSha,
        });
        logActivity('merge_salvage_diverged', `Salvage aborted: origin/${targetBranch} diverged (remote ${pushErr.remoteSha.slice(0, 7)} not ancestor of local ${pushErr.localSha.slice(0, 7)})`);
        return { success: false, reason: pushErr.message };
      }
      throw pushErr;
    }

    console.log(`[merge-agent] Salvage push successful for ${issueId}`);
    logActivity('merge_salvage_success', `Stranded merge pushed successfully`);
    return { success: true };
  } catch (error: any) {
    console.error(`[merge-agent] Salvage failed: ${error.message}`);
    logActivity('merge_salvage_failed', `Salvage push failed: ${error.message}`);
    return null;
  }
}

/**
 * Result of syncing main into a workspace branch
 */
export interface SyncMainResult {
  success: boolean;
  alreadyUpToDate?: boolean;
  commitCount?: number;
  changedFiles?: string[];
  conflictFiles?: string[];
  reason?: string;
}

/**
 * Scan workspace for leftover git conflict markers (async)
 */
export async function scanForConflictMarkers(projectPath: string): Promise<string[]> {
  try {
    // git diff --check exits non-zero and prints filenames when conflict markers exist
    const { stdout } = await execAsync('git diff --check 2>&1 || true', {
      cwd: projectPath,
      encoding: 'utf-8',
    });
    const files = stdout
      .split('\n')
      .filter(line => line.includes('leftover conflict marker'))
      .map(line => line.split(':')[0].trim())
      .filter(f => f.length > 0);
    return [...new Set(files)];
  } catch {
    return [];
  }
}

/**
 * Sync the latest main branch into a workspace's feature branch.
 *
 * This performs a `git merge origin/main` in the workspace. If the merge is clean
 * it returns immediately. If conflicts arise, the ship role is started to resolve
 * them. The merge is never pushed — this is a local workspace operation.
 *
 * Auto-commits any uncommitted changes before merging (with safety verification).
 */
export async function syncMainIntoWorkspace(
  projectPath: string,
  issueId: string,
): Promise<SyncMainResult> {
  console.log(`[sync-main] Starting sync of main into workspace for ${issueId}`);
  logActivity('sync_main_start', `Starting sync for ${issueId}`);

  // Pre-flight: auto-commit uncommitted changes before merge
  try {
    const { stdout: statusOut } = await execAsync('git status --porcelain', {
      cwd: projectPath,
      encoding: 'utf-8',
    });
    if (statusOut.trim()) {
      console.log(`[sync-main] Uncommitted changes detected, auto-committing...`);
      logActivity('sync_main_auto_commit', `Auto-committing uncommitted changes before sync`);
      try {
        await execAsync('git add -A && git commit -m "chore: auto-commit before sync with main"', {
          cwd: projectPath,
          encoding: 'utf-8',
        });
        console.log(`[sync-main] Auto-commit successful`);
      } catch (commitErr: any) {
        const message = `Failed to auto-commit uncommitted changes: ${commitErr.message}`;
        console.error(`[sync-main] ${message}`);
        logActivity('sync_main_blocked', message);
        return { success: false, reason: message };
      }

      // Verify commit succeeded — abort if uncommitted changes still exist
      const { stdout: postCommitStatus } = await execAsync('git status --porcelain', {
        cwd: projectPath,
        encoding: 'utf-8',
      });
      if (postCommitStatus.trim()) {
        const message = 'Uncommitted changes remain after auto-commit — aborting sync';
        console.error(`[sync-main] ${message}`);
        logActivity('sync_main_blocked', message);
        return { success: false, reason: message };
      }
    }
  } catch (error: any) {
    return { success: false, reason: `Failed to check git status: ${error.message}` };
  }

  // Clean up stale git lock files
  try {
    const lockCleanup = await cleanupStaleLocks(projectPath);
    if (lockCleanup.found.length > 0) {
      console.log(`[sync-main] Found ${lockCleanup.found.length} lock file(s)`);
      if (lockCleanup.removed.length > 0) {
        console.log(`[sync-main] Cleaned up ${lockCleanup.removed.length} stale lock file(s)`);
        logActivity('git_lock_cleanup', `Removed ${lockCleanup.removed.length} stale lock file(s)`);
      }
      if (lockCleanup.errors.some((e: { file: string; error: string }) => e.error.includes('Git processes are running'))) {
        const message = 'Git processes are still running — cannot safely start sync';
        console.error(`[sync-main] ${message}`);
        logActivity('sync_main_blocked', message);
        return { success: false, reason: message };
      }
    }
  } catch (lockErr: any) {
    console.warn(`[sync-main] Lock cleanup warning: ${lockErr.message} (continuing)`);
  }

  // Fetch latest main
  try {
    console.log(`[sync-main] Fetching origin/main...`);
    await execAsync('git fetch origin main', { cwd: projectPath, encoding: 'utf-8' });
  } catch (error: any) {
    return { success: false, reason: `Failed to fetch origin/main: ${error.message}` };
  }

  // Attempt the merge
  let mergeOutput = '';
  let hasConflicts = false;
  try {
    const result = await execAsync('git merge origin/main', { cwd: projectPath, encoding: 'utf-8' });
    mergeOutput = (result.stdout || '') + (result.stderr || '');
  } catch (error: any) {
    mergeOutput = (error.stdout || '') + (error.stderr || '');
    hasConflicts = true;
  }

  // Already up to date?
  if (mergeOutput.includes('Already up to date') || mergeOutput.includes('Already up-to-date')) {
    console.log(`[sync-main] Already up to date`);
    logActivity('sync_main_noop', `${issueId} already up to date with main`);
    return { success: true, alreadyUpToDate: true };
  }

  if (!hasConflicts) {
    // Clean merge — collect stats
    console.log(`[sync-main] Clean merge completed`);
    logActivity('sync_main_success', `Clean merge of main into ${issueId}`);

    let changedFiles: string[] = [];
    let commitCount = 0;
    try {
      const { stdout: diffFiles } = await execAsync(
        'git diff --name-only ORIG_HEAD HEAD 2>/dev/null || git diff --name-only HEAD~1 HEAD',
        { cwd: projectPath, encoding: 'utf-8' },
      );
      changedFiles = diffFiles.trim().split('\n').filter(f => f.length > 0);
    } catch { /* non-fatal */ }
    try {
      const { stdout: logOut } = await execAsync(
        'git log ORIG_HEAD..HEAD --oneline 2>/dev/null || echo ""',
        { cwd: projectPath, encoding: 'utf-8' },
      );
      commitCount = logOut.trim().split('\n').filter(l => l.length > 0).length;
    } catch { /* non-fatal */ }

    return { success: true, commitCount, changedFiles };
  }

  // Conflict case — delegate to ship role
  const conflictFiles = await getConflictFiles(projectPath);
  console.log(`[sync-main] ${conflictFiles.length} conflict(s), starting ship role...`);
  logActivity('sync_main_conflicts', `${conflictFiles.length} conflict(s) in ${issueId}: ${conflictFiles.join(', ')}`);

  const workspaceBranch = await execAsync('git branch --show-current', { cwd: projectPath, encoding: 'utf-8' })
    .then(r => r.stdout.trim())
    .catch(() => `feature/${issueId.toLowerCase()}`);

  const prompt = buildShipSyncMainPrompt({
    issueId,
    workspacePath: projectPath,
    workspaceBranch,
    conflictFiles,
  });

  const shipResult = await spawnShipRoleForTask({ issueId, workspacePath: projectPath, prompt });
  if (!shipResult.success) {
    try { await execAsync('git merge --abort', { cwd: projectPath, encoding: 'utf-8' }); } catch {}
    const message = `Failed to start ship role for sync-main conflicts: ${shipResult.message}`;
    console.error(`[sync-main] ${message}`);
    logActivity('sync_main_error', message);
    return { success: false, conflictFiles, reason: message };
  }

  console.log(`[sync-main] Ship role started for conflict resolution: ${shipResult.message}`);
  logActivity('sync_main_ship_started', `Ship role resolving ${conflictFiles.length} conflict(s) for ${issueId}`);
  return {
    success: true,
    commitCount: 0,
    changedFiles: conflictFiles,
  };

}

/**
 * Look up and run quality gates for the project at projectPath.
 * Returns empty array if no quality gates are configured.
 *
 * In polyrepo mode (projectPath is a sub-repo of project.path), only gates
 * whose `path` field matches the relative sub-repo path are run. Gates with
 * no `path` field are skipped in polyrepo context.
 */
export async function runProjectQualityGates(
  projectPath: string,
  phase: 'pre_push' | 'post_push'
): Promise<import('./validation.js').QualityGateResult[]> {
  try {
    const config = loadProjectsConfig();
    // Find the project whose path matches
    const project = Object.values(config.projects).find(p => projectPath.startsWith(p.path));
    if (!project?.quality_gates || Object.keys(project.quality_gates).length === 0) {
      console.log(`[merge-agent] No quality gates configured for ${projectPath}`);
      return [];
    }

    // Detect polyrepo context: if projectPath is a subdirectory of project.path,
    // repoRelPath is non-empty (e.g., 'frontend' or 'backend').
    const repoRelPath = relative(project.path, projectPath);
    const matchedRepo = project.workspace?.repos?.find(repo => (
      repoRelPath === repo.path ||
      projectPath === join(project.path, repo.path)
    ));
    const repoIdentifiers = matchedRepo
      ? new Set([matchedRepo.path, matchedRepo.name])
      : new Set(repoRelPath && !repoRelPath.startsWith('..') ? [repoRelPath] : []);

    let gatesToRun = project.quality_gates;
    if (repoRelPath && !repoRelPath.startsWith('..')) {
      // Polyrepo: gates can target either the repo path ("frontend") or the
      // configured repo key/alias ("fe"). Both map to the same sub-repo.
      const filtered = Object.entries(project.quality_gates).filter(
        ([, gate]) => gate.path && repoIdentifiers.has(gate.path)
      );
      if (filtered.length === 0) {
        console.log(`[merge-agent] No quality gates configured for repo path "${repoRelPath}"`);
        return [];
      }
      gatesToRun = Object.fromEntries(filtered);
      console.log(
        `[merge-agent] Polyrepo: running ${Object.keys(gatesToRun).length} gate(s) for path "${repoRelPath}" (${[...repoIdentifiers].join(', ')})`
      );
    }

    console.log(`[merge-agent] Running ${phase} quality gates for project "${project.name}"`);
    return await runQualityGates(gatesToRun, projectPath, phase);
  } catch (error: any) {
    console.error(`[merge-agent] Failed to load quality gates: ${error.message}`);
    return [];
  }
}
