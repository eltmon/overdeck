/**
 * Merge Agent - Automatic merge conflict resolution using Claude Code
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join, dirname, basename, relative } from 'path';
import { fileURLToPath } from 'url';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { Effect } from 'effect';
import { capturePane, killSession, listSessionNames, sendKeys, sessionExists } from '../tmux.js';
import { emitActivityEntrySync, emitActivityTtsSync, emitDashboardLifecycleSync } from '../activity-logger.js';

const execAsync = promisify(exec);

/**
 * Paths that must never enter a pipeline auto-commit, regardless of gitignore
 * state. These are workspace-local or machine-local state files and sync-target
 * directories; committing them pollutes feature branches and main.
 */
export const AUTO_COMMIT_EXCLUDED_PATHS = [
  '.pan/kickoff.md',
  '.pan/continue.json',
  '.pan/handoff-*.md',
  '.pan/spec.vbrief.json',
  '.claude/rules/',
  '.claude/skills/',
  // PAN-1899: machine-local Panopticon config copied into every workspace by
  // copyPanopticonSettingsToWorkspaceSync (config.yaml, projects.yaml,
  // settings.json). It diverges from main constantly and must never enter a
  // feature branch — that was the source of the recurring projects.yaml sync
  // conflict.
  '.panopticon/',
];

const SYNC_MAIN_MAIN_PREFERRED_PATHS = [
  '.pan/continues',
  '.pan/specs',
  '.beads',
];

export function isSyncMainMainPreferredPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  return SYNC_MAIN_MAIN_PREFERRED_PATHS.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

export function isAutoCommitExcludedPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  for (const pattern of AUTO_COMMIT_EXCLUDED_PATHS) {
    if (pattern.endsWith('/')) {
      if (normalized.startsWith(pattern) || normalized === pattern.slice(0, -1)) {
        return true;
      }
    } else if (pattern.includes('*')) {
      const regex = new RegExp(
        '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '[^/]*') + '$'
      );
      if (regex.test(normalized)) return true;
    } else if (normalized === pattern) {
      return true;
    }
  }
  return false;
}

function parseStatusPath(line: string): string {
  // git status --porcelain lines are "XY PATH" or "XY ORIG -> DEST" for renames.
  const body = line.slice(3);
  if (line[0] === 'R' || line[1] === 'R') {
    const parts = body.split(' -> ');
    return parts[parts.length - 1];
  }
  return body;
}

/**
 * Auto-commit non-excluded workspace changes before a sync-main merge.
 * Respects .gitignore (no -f), unstages excluded paths, and leaves excluded
 * paths dirty so the sync can proceed. Returns success=false on git errors.
 */
export async function autoCommitWorkspaceChangesBeforeSync(
  projectPath: string,
): Promise<{ success: boolean; committed: boolean; reason?: string }> {
  try {
    const { stdout: statusOut } = await execAsync('git status --porcelain', {
      cwd: projectPath,
      encoding: 'utf-8',
    });
    if (!statusOut.trim()) {
      return { success: true, committed: false, reason: 'no uncommitted changes' };
    }

    // PAN-1819: plain `git add -A` respects .gitignore; never use -f.
    await execAsync('git add -A', { cwd: projectPath, encoding: 'utf-8' });

    // Belt-and-suspenders: unstage excluded paths regardless of ignore state.
    const resetPaths = AUTO_COMMIT_EXCLUDED_PATHS.map((p) =>
      p.endsWith('/') ? p.slice(0, -1) : p
    ).join(' ');
    await execAsync(`git reset HEAD -- ${resetPaths}`, {
      cwd: projectPath,
      encoding: 'utf-8',
    });

    const { stdout: diffStat } = await execAsync('git diff --cached --stat', {
      cwd: projectPath,
      encoding: 'utf-8',
    });
    if (!diffStat.trim()) {
      return { success: true, committed: false, reason: 'only excluded/ignored changes remain' };
    }

    await execAsync('git commit -m "chore: auto-commit before sync with main"', {
      cwd: projectPath,
      encoding: 'utf-8',
    });
    return { success: true, committed: true };
  } catch (error: any) {
    return { success: false, committed: false, reason: `Failed to auto-commit: ${error.message}` };
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import {
  OVERDECK_HOME,
} from '../paths.js';
import { resolveGitHubIssueSync } from '../tracker-utils.js';

import { resolveProjectFromIssueSync } from '../projects.js';
import { restoreTrackedBeadsExport } from '../beads-restore.js';
import { runMergeValidation, autoRevertMerge, runQualityGates } from './validation.js';
import { loadProjectsConfigSync } from '../projects.js';
import { cleanupStaleLocks } from '../git-utils.js';
import { gitPush, gitForcePush, MainDivergedError } from '../git/operations.js';
import { markWorkspaceStuck, setReviewStatusSync } from '../review-status.js';
import { appendGitOperationSync, type GitOperationType } from '../git-activity.js';
import { recordFeatureRegistryLifecycle } from '../registry/feature-registry-population.js';

const SPECIALISTS_DIR = join(OVERDECK_HOME, 'specialists');
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
    const { getTldrDaemonServiceSync } = await import('../tldr-daemon.js');
    const tldrService = getTldrDaemonServiceSync(projectPath, venvPath);

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
 * Post-merge handoff: mark merged work as verifying on main and free runtime resources.
 *
 * Leaves the issue, workspace, vBRIEF, branches, and agent state dirs intact.
 * The explicit close-out ceremony performs final archival and destructive cleanup.
 *
 * IDEMPOTENT: Safe to call multiple times for the same issueId. Tracks completed
 * issues and returns immediately on re-entry. This is defense-in-depth against
 * the infinite loop that burned 24,626 Linear API calls (PAN-328).
 */

// Defense-in-depth: track issues that have completed postMergeLifecycle.
// Prevents re-execution even if caller guards fail. Persists for server lifetime.
const _completedPostMerge = new Set<string>();
const _postMergeInFlight = new Map<string, Promise<void>>();

// PAN-1531: dropLingeringPreMergeStashes removed. The pre-merge stash kind
// is no longer created by Panopticon, so there's nothing for the post-merge
// lifecycle to clean up. Pre-existing pre-merge:* residue in refs/stash is
// expected and inert.

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

async function verifyMergedBeforeLifecycle(issueId: string, projectPath: string, sourceBranch?: string): Promise<{ merged: boolean; reason: string }> {
  // PAN-1531: single merge oracle — GitHub PR API is the authoritative answer
  // for "is this PR merged." The prior ancestor-of-main and diff-fallback
  // heuristics were retired because they produced "the oracles disagree"
  // bugs (PAN-1024) and made the meaning of "merged" muddy. For non-GitHub
  // projects the operator confirms manually.
  const branchName = sourceBranch?.trim() || `feature/${issueId.toLowerCase()}`;
  const quotedBranch = shellQuote(branchName);

  const ghResolved = resolveGitHubIssueSync(issueId);
  if (!ghResolved.isGitHub) {
    return { merged: false, reason: `Non-GitHub project for ${issueId}; merge state cannot be auto-verified` };
  }

  const { owner, repo } = ghResolved;
  try {
    const { stdout } = await execAsync(
      `gh pr list --repo ${shellQuote(`${owner}/${repo}`)} --state all --head ${quotedBranch} --json number,mergedAt,mergeCommit --limit 5`,
      { cwd: projectPath },
    );
    const prs = JSON.parse(stdout || '[]') as Array<{ number: number; mergedAt: string | null; mergeCommit: unknown | null }>;
    const mergedPr = prs.find((pr) => pr.mergedAt || pr.mergeCommit);
    if (mergedPr) {
      return { merged: true, reason: `GitHub PR #${mergedPr.number} is merged` };
    }
    if (prs.length === 0) {
      return { merged: true, reason: `No PR found for ${branchName}; assuming post-merge cleanup already removed the source ref` };
    }
    return { merged: false, reason: `GitHub PR for ${branchName} is open and not merged` };
  } catch (err: any) {
    return { merged: false, reason: `Unable to verify merge state for ${branchName} via GitHub PR API: ${err?.message?.slice(0, 200) || 'unknown'}` };
  }
}

export async function postMergeLifecycle(issueId: string, projectPath: string, sourceBranch?: string, options?: { skipDeploy?: boolean }): Promise<void> {
  // PAN-1517: the per-slot swarm runtime is gone. Slot branches no longer exist
  // — parallelism is an in-context concern owned by the work agent (see
  // roles/work.md "Parallel work via subagents"). postMergeLifecycle fires only
  // for the issue's main feature branch merging to `main`.

  // Guard 1: skip if already completed (defense-in-depth against infinite loops)
  if (_completedPostMerge.has(issueId)) {
    console.log(`[merge-agent] postMergeLifecycle already completed for ${issueId}, skipping`);
    return;
  }

  const inFlight = _postMergeInFlight.get(issueId);
  if (inFlight) {
    console.log(`[merge-agent] postMergeLifecycle already running for ${issueId}, joining in-flight run`);
    return inFlight;
  }

  const run = (async () => {
    // Guard 2: closed-out is TERMINAL. Close-out flips the spec on main to
    // completed/cancelled, clears review status, and closes the tracker issue.
    // Re-running the handoff after that resurrects the review row and REOPENS
    // the closed issue — observed live on PAN-1190 (2026-06-11): the deacon's
    // stale-mergeStatus sweep saw the cleared row as "stale" 47 minutes after
    // close-out and the handoff reopened it into verifying-on-main forever.
    try {
      const { findSpecByIssue } = await import('../pan-dir/specs.js');
      const spec = await Effect.runPromise(findSpecByIssue(projectPath, issueId));
      if (spec && (spec.status === 'completed' || spec.status === 'cancelled')) {
        console.log(`[merge-agent] ${issueId} is closed out (spec ${spec.status}) — skipping post-merge lifecycle`);
        _completedPostMerge.add(issueId);
        return;
      }
    } catch {
      // Spec unreadable — proceed; the guard is best-effort.
    }

    const mergeVerification = await verifyMergedBeforeLifecycle(issueId, projectPath, sourceBranch);
    if (!mergeVerification.merged) {
      console.warn(`[merge-agent] Refusing post-merge lifecycle for ${issueId}: ${mergeVerification.reason}`);
      return;
    }
    console.log(`[merge-agent] Verified merge before lifecycle for ${issueId}: ${mergeVerification.reason}`);

    // Set mergeStatus='merged' after verifying the branch or PR actually landed.
    try {
      setReviewStatusSync(issueId, { mergeStatus: 'merged', readyForMerge: false });
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
      const pendingFile = join(OVERDECK_HOME, 'pending-post-merge.json');
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

    console.log(`[merge-agent] Running post-merge verify handoff for ${issueId}`);

    // 1. Clean up stale workflow labels and keep the legacy merged marker for history.
    // verifying-on-main is applied next and takes precedence in canonical state mapping.
    try {
      const { cleanupMergedLabels } = await import('../lifecycle/label-cleanup.js');
      const ghResolved = resolveGitHubIssueSync(issueId);
      const labelCtx = ghResolved.isGitHub
        ? { issueId, projectPath, github: { owner: ghResolved.owner, repo: ghResolved.repo, number: ghResolved.number } }
        : { issueId, projectPath };
      // PAN-1249: cleanupMergedLabels returns Effect<StepResult>; bridge to Promise.
      const labelResult = await Effect.runPromise(cleanupMergedLabels(labelCtx));
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

    try {
      await transitionIssueToVerifyingOnMain(issueId, projectPath);
      void recordFeatureRegistryLifecycle({ issueId, status: 'merged' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[merge-agent] Could not transition issue to verifying_on_main: ${message}`);
      try {
        setReviewStatusSync(issueId, {
          mergeStatus: 'failed',
          readyForMerge: false,
          mergeNotes: `Post-merge verifying_on_main transition failed: ${message}`,
        });
      } catch (statusErr: any) {
        console.warn(`[merge-agent] Could not persist verifying_on_main transition failure: ${statusErr?.message ?? statusErr}`);
      }
      announceMerge('failed', issueId, `Post-merge verifying_on_main transition failed: ${message}`);
      logActivity('merge_failed', `Post-merge verifying_on_main transition failed for ${issueId}: ${message}`);
      throw err;
    }

    // 2. Compact old beads (via lifecycle module)
    try {
      const { compactBeads } = await import('../lifecycle/compact-beads.js');
      // PAN-1249: compactBeads returns Effect<StepResult>; bridge to Promise.
      const beadsResult = await Effect.runPromise(compactBeads({ issueId, projectPath }));
      if (beadsResult.success && !beadsResult.skipped) {
        console.log(`[merge-agent] ✓ ${beadsResult.details?.join('; ')}`);
        logActivity('beads_compaction_complete', beadsResult.details?.join('; ') || 'Beads compacted');
      }
    } catch (err) {
      console.warn(`[merge-agent] Beads compaction failed: ${err}`);
    }

    // 3. Pause work/planning agents and kill their tmux panes to free resources.
    try {
      const { setAgentPaused, getAgentState } = await import('../agents.js');
      const { killSession, sessionExists } = await import('../tmux.js');
      const issueLower = issueId.toLowerCase();
      const reason = 'awaiting close-out (verify on main)';
      for (const agentId of [`agent-${issueLower}`, `planning-${issueLower}`]) {
        // Pause, then VERIFY the gate actually persisted to state.json. A server
        // restart mid-lifecycle (the PAN-1723 deploy re-runs this from
        // pending-post-merge.json) or a concurrent deacon read-modify-write on
        // state.json can silently drop the pause. An unpaused merged work agent
        // sits idle at its prompt yet still counts against the PAN-1665 work
        // ceiling, throttling dispatch for every live issue (PAN-1726). Assert
        // paused=true after the write; retry once, then fail loudly.
        const initial = await Effect.runPromise(setAgentPaused(agentId, reason, true));
        if (initial === null) {
          // No state.json for this agent — nothing to pause (e.g. planning never ran).
          continue;
        }
        let verify = await Effect.runPromise(getAgentState(agentId));
        if (verify?.paused !== true) {
          await Effect.runPromise(setAgentPaused(agentId, reason, true));
          verify = await Effect.runPromise(getAgentState(agentId));
        }
        if (verify?.paused === true) {
          console.log(`[merge-agent] ✓ Paused ${agentId}: ${reason}`);
        } else {
          console.error(
            `[merge-agent] ✗ FAILED to persist pause for ${agentId} after merge — state.json paused=${verify?.paused}. ` +
            `Idle merged work agent may hold a PAN-1665 work slot and throttle dispatch (PAN-1726).`,
          );
          logActivity('agent_pause_failed', `Could not persist pause for ${agentId} after merge — may throttle dispatch (PAN-1726)`);
        }
        if (await Effect.runPromise(sessionExists(agentId))) {
          await Effect.runPromise(killSession(agentId));
          console.log(`[merge-agent] ✓ Killed ${agentId} tmux session to free resources`);
          logActivity('agent_session_killed', `Freed resources: killed tmux session for ${agentId}`);
        }
      }
    } catch (err) {
      console.warn(`[merge-agent] Could not pause or kill agent sessions: ${err}`);
    }

    // 5a. Kill canonical reviewer/synthesis sessions (PAN-915).
    // Sessions persist across review rounds to preserve reviewer context, so the
    // merge is the right moment to tear them down. Issue is done — context value
    // is zero, RSS leak risk is non-zero. Resolve projectKey from the project
    // path so we don't depend on caller-supplied config.
    try {
      const { killAllReviewerSessions } = await import('./review-agent.js');
      const { resolveProjectFromIssueSync } = await import('../projects.js');
      const resolved = resolveProjectFromIssueSync(issueId);
      const projectKey = resolved?.projectKey;
      if (projectKey) {
        const { killed } = await Effect.runPromise(killAllReviewerSessions(projectKey, issueId));
        if (killed.length > 0) {
          console.log(`[merge-agent] ✓ Killed ${killed.length} canonical reviewer session(s) for ${issueId}`);
          logActivity('reviewer_sessions_killed', `Killed ${killed.length} reviewer session(s) for ${issueId} on merge`);
        }
      }
    } catch (err) {
      console.warn(`[merge-agent] Could not kill canonical reviewer sessions: ${err}`);
    }

    await killPostMergeRoleSessions(issueId);

    // 3c. Create a workspace-scoped memory reset marker so old review-blocker noise stays archived but out of retrieval.
    try {
      const { createResetMarker } = await import('../memory/cli.js');
      const timestamp = new Date().toISOString();
      const marker = await createResetMarker({
        projectId: basename(projectPath),
        scope: 'workspace',
        scopeId: `feature-${issueId.toLowerCase()}`,
        reason: 'post-merge cleanup',
        fromTimestamp: timestamp,
        createdAt: timestamp,
      });
      console.log(`[merge-agent] ✓ Created memory reset marker ${marker.id} for ${marker.scope}:${marker.scopeId}`);
    } catch (err) {
      console.warn(`[merge-agent] Memory reset marker creation failed (non-fatal): ${err}`);
    }

    // 4. Stop Docker containers + networks to prevent network pool exhaustion (non-fatal)
    // Orphaned Docker networks accumulate when workspaces are merged but containers are never
    // torn down, eventually exhausting Docker's address pool and blocking new workspace creation.
    try {
      const { findWorkspacePath } = await import('../lifecycle/archive-planning.js');
      const { stopWorkspaceDocker } = await import('../workspace-manager.js');
      const issueLower = issueId.toLowerCase();
      const workspacePath = findWorkspacePath(projectPath, issueLower);
      if (workspacePath) {
        const dockerResult = await Effect.runPromise(stopWorkspaceDocker(workspacePath, issueLower));
        if (dockerResult.containersFound) {
          console.log(`[merge-agent] ✓ Stopped Docker containers: ${dockerResult.steps.join('; ')}`);
          logActivity('docker_cleanup', `Stopped Docker for ${issueId}: ${dockerResult.steps.join('; ')}`);
        }
      }
    } catch (err) {
      console.warn(`[merge-agent] Docker cleanup failed (non-fatal): ${err}`);
    }

    await notifyTldrDaemon(projectPath, sourceBranch ?? '');

    // Mark completed BEFORE logging — prevents re-entry even if the log line triggers something
    _completedPostMerge.add(issueId);

    console.log(`[merge-agent] Post-merge handoff completed for ${issueId}. Awaiting close-out (verify on main).`);
    announceMerge('completed', issueId);
    logActivity('merge_complete', `Merged ${issueId}. Awaiting close-out (verify on main).`);
  })().finally(() => {
    _postMergeInFlight.delete(issueId);
  });
  _postMergeInFlight.set(issueId, run);
  return run;
}

async function transitionIssueToVerifyingOnMain(issueId: string, projectPath: string): Promise<void> {
  const [effectModule, issueLifecycleModule, githubModule, linearModule, rallyModule, errorsModule] = await Promise.all([
    import('effect'),
    import('../../dashboard/server/services/issue-lifecycle.js'),
    import('../../dashboard/server/services/github-client.js'),
    import('../../dashboard/server/services/linear-client.js'),
    import('../../dashboard/server/services/rally-client.js'),
    import('../../dashboard/server/services/typed-errors.js'),
  ]);
  const { Effect, Layer } = effectModule;
  const { IssueLifecycle, IssueLifecycleLive } = issueLifecycleModule;
  const { GitHubClient } = githubModule;
  const { LinearClientOptionalLive } = linearModule;
  const { RallyClientOptionalLive } = rallyModule;
  const { IssueNotFound } = errorsModule;
  const gitHubRepo = (owner: string, repo: string) => shellQuote(`${owner}/${repo}`);
  const githubLayer = Layer.succeed(GitHubClient, {
    getIssue: (_owner: string, _repo: string, number: number) => Effect.fail(new IssueNotFound({ id: String(number) })),
    closeIssue: (owner: string, repo: string, number: number) => Effect.promise(() => execAsync(`gh issue close ${number} --repo ${gitHubRepo(owner, repo)}`, { cwd: projectPath, encoding: 'utf-8' }).then(() => undefined)),
    reopenIssue: (owner: string, repo: string, number: number) => Effect.promise(() => execAsync(`gh issue reopen ${number} --repo ${gitHubRepo(owner, repo)} 2>/dev/null || true`, { cwd: projectPath, encoding: 'utf-8' }).then(() => undefined)),
    addLabel: (owner: string, repo: string, number: number, label: string) => Effect.promise(async () => {
      if (label === 'verifying-on-main') {
        await execAsync(`gh label create ${shellQuote(label)} --repo ${gitHubRepo(owner, repo)} --color "fbca04" --description "Merged — awaiting verification on main" --force 2>/dev/null || true`, { cwd: projectPath, encoding: 'utf-8' });
      }
      await execAsync(`gh issue edit ${number} --repo ${gitHubRepo(owner, repo)} --add-label ${shellQuote(label)}`, { cwd: projectPath, encoding: 'utf-8' });
    }),
    removeLabel: (owner: string, repo: string, number: number, label: string) => Effect.promise(() => execAsync(`gh issue edit ${number} --repo ${gitHubRepo(owner, repo)} --remove-label ${shellQuote(label)} 2>/dev/null || true`, { cwd: projectPath, encoding: 'utf-8' }).then(() => undefined)),
    ensureLabel: (owner: string, repo: string, label: string, color = '0075ca', description = '') => Effect.promise(async () => {
      await execAsync(`gh label create ${shellQuote(label)} --repo ${gitHubRepo(owner, repo)} --color ${shellQuote(color)} --description ${shellQuote(description)} --force 2>/dev/null || true`, { cwd: projectPath, encoding: 'utf-8' });
      return { id: 0, name: label, color };
    }),
    addComment: () => Effect.void,
    getComments: () => Effect.succeed([]),
  });
  const layer = IssueLifecycleLive.pipe(
    Layer.provide(LinearClientOptionalLive),
    Layer.provide(githubLayer),
    Layer.provide(RallyClientOptionalLive),
  );
  await Effect.runPromise(
    Effect.gen(function* () {
      const lifecycle = yield* IssueLifecycle;
      yield* lifecycle.transitionTo(issueId, 'verifying_on_main');
    }).pipe(Effect.provide(layer)),
  );
  console.log(`[merge-agent] ✓ Transitioned ${issueId} to verifying_on_main`);
}

function isPostMergeRoleSession(sessionName: string, issueLower: string): boolean {
  if ([`agent-${issueLower}-test`, `agent-${issueLower}-ship`, `agent-${issueLower}-merge`].includes(sessionName)) {
    return true;
  }
  if (sessionName.startsWith(`agent-${issueLower}-review-`)) {
    return true;
  }
  return sessionName.startsWith('specialist-')
    && sessionName.includes(`-${issueLower}-`)
    && /-(review|test|merge|ship)(?:-|$)/.test(sessionName);
}

async function killPostMergeRoleSessions(issueId: string): Promise<void> {
  try {
    const issueLower = issueId.toLowerCase();
    const sessions = await Effect.runPromise(listSessionNames());
    const targets = sessions.filter((session) => isPostMergeRoleSession(session, issueLower));
    for (const session of targets) {
      await Effect.runPromise(killSession(session));
    }
    if (targets.length > 0) {
      console.log(`[merge-agent] ✓ Killed ${targets.length} review/test/ship session(s) for ${issueId}`);
      logActivity('role_sessions_killed', `Killed ${targets.length} review/test/ship session(s) for ${issueId} on merge`);
    }
  } catch (err) {
    console.warn(`[merge-agent] Could not kill role sessions for ${issueId}: ${err}`);
  }
}

/**
 * Reset postMergeLifecycle completion tracking for an issue (used by reopen).
 */
export function resetPostMergeState(issueId: string): void {
  _completedPostMerge.delete(issueId);
  _postMergeInFlight.delete(issueId);
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

async function resolveMainPreferredSyncConflicts(
  projectPath: string,
  conflictFiles: string[],
): Promise<{ success: boolean; reason?: string }> {
  if (conflictFiles.length === 0 || !conflictFiles.every(isSyncMainMainPreferredPath)) {
    return { success: false, reason: 'conflicts include non-pipeline-owned files' };
  }

  try {
    for (const path of SYNC_MAIN_MAIN_PREFERRED_PATHS) {
      await execAsync(`git rm -r --quiet --ignore-unmatch -- ${path}`, {
        cwd: projectPath,
        encoding: 'utf-8',
      });
      await execAsync(`git checkout origin/main -- ${path}`, {
        cwd: projectPath,
        encoding: 'utf-8',
      }).catch(() => {
        // The path may not exist on origin/main. In that case, the preceding
        // git rm records main's deletion for this pipeline-owned path.
      });
      await execAsync(`git add -A -- ${path}`, {
        cwd: projectPath,
        encoding: 'utf-8',
      });
    }

    const remainingConflicts = await getConflictFiles(projectPath);
    if (remainingConflicts.length > 0) {
      return {
        success: false,
        reason: `Unresolved conflicts remain: ${remainingConflicts.join(', ')}`,
      };
    }

    await execAsync('git commit --no-edit', {
      cwd: projectPath,
      encoding: 'utf-8',
    });
    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      reason: `Failed to auto-resolve pipeline-owned conflicts: ${error.message}`,
    };
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
  emitActivityEntrySync({
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
  emitActivityEntrySync({
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
  emitActivityTtsSync({
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
    return await Effect.runPromise(capturePane(sessionName));
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
        appendGitOperationSync({
          operation,
          branch,
          issueId,
          status: level === 'error' ? 'failure' : 'success',
          error: level !== 'info' ? trimmed.slice(0, 200) : undefined,
          ts,
        });
        emitActivityEntrySync({
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
  return Effect.runPromise(sessionExists('specialist-merge-agent'));
}

/**
 * Send a message to an agent's tmux session (async)
 */
async function sendMessageToAgent(issueId: string, message: string): Promise<boolean> {
  // Agent sessions are typically named agent-{issueId} (lowercase)
  const sessionName = `agent-${issueId.toLowerCase()}`;

  try {
    // Check if session exists
    if (!await Effect.runPromise(sessionExists(sessionName))) {
      console.log(`[merge-agent] Could not send message to ${sessionName} (session does not exist)`);
      return false;
    }

    // Send the message using centralized sendKeys
    await Effect.runPromise(sendKeys(sessionName, message));

    console.log(`[merge-agent] Sent message to ${sessionName}`);
    logActivity('agent_message', `Sent to ${sessionName}: ${message.slice(0, 100)}...`);
    return true;
  } catch {
    console.log(`[merge-agent] Could not send message to ${sessionName} (session may not exist)`);
    return false;
  }
}

// PAN-1531: ship-role machinery (buildShipPreparationPrompt, buildShipSyncMainPrompt,
// spawnShipRoleForTask, spawnMergeAgentForBranches, spawnRebaseAgentForBranch,
// defaultWorkspaceForIssue) removed. Rebase is now performed in-process via
// rebaseFeatureBranch() in src/lib/cloister/merge-rebase.ts. See docs/MERGE-WORKFLOW.md.

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
      await Effect.runPromise(gitPush(projectPath, 'origin', targetBranch, { issueId }));
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
 * it returns immediately. If conflicts arise, the conflict details are surfaced
 * for manual workspace resolution. The merge is never pushed — this is a local
 * workspace operation.
 *
 * Auto-commits any uncommitted changes before merging (with safety verification).
 */
export async function syncMainIntoWorkspace(
  projectPath: string,
  issueId: string,
): Promise<SyncMainResult> {
  console.log(`[sync-main] Starting sync of main into workspace for ${issueId}`);
  logActivity('sync_main_start', `Starting sync for ${issueId}`);

  // PAN-1158 safety net: a workspace bd dolt DB that briefly went empty can
  // leave `.beads/issues.jsonl` reported as deleted by `git status`. The
  // auto-commit below would then propagate that deletion onto the feature
  // branch. Restore the tracked export first so the auto-commit only sees
  // intentional changes.
  await Effect.runPromise(restoreTrackedBeadsExport(projectPath));

  // Pre-flight: auto-commit uncommitted changes before merge
  console.log(`[sync-main] Checking for uncommitted changes...`);
  logActivity('sync_main_auto_commit', `Auto-committing uncommitted changes before sync`);
  const autoCommit = await autoCommitWorkspaceChangesBeforeSync(projectPath);
  if (!autoCommit.success) {
    const message = autoCommit.reason || 'Failed to auto-commit uncommitted changes';
    console.error(`[sync-main] ${message}`);
    logActivity('sync_main_blocked', message);
    return { success: false, reason: message };
  }
  if (autoCommit.committed) {
    console.log(`[sync-main] Auto-commit successful`);
  }

  // Verify no non-excluded uncommitted changes remain.
  try {
    const { stdout: postCommitStatus } = await execAsync('git status --porcelain', {
      cwd: projectPath,
      encoding: 'utf-8',
    });
    if (postCommitStatus.trim()) {
      const remainingNonExcluded = postCommitStatus
        .trim()
        .split('\n')
        .filter((line) => !isAutoCommitExcludedPath(parseStatusPath(line)));
      if (remainingNonExcluded.length > 0) {
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
    const lockCleanup = await Effect.runPromise(cleanupStaleLocks(projectPath));
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

  // PAN-1531: sync-main conflict case — surface to operator instead of
  // delegating to an LLM ship role. Abort the merge so the working tree is
  // clean, then return the conflict files for the caller to display.
  const conflictFiles = await getConflictFiles(projectPath);
  const mainPreferredResolution = await resolveMainPreferredSyncConflicts(projectPath, conflictFiles);
  if (mainPreferredResolution.success) {
    console.log(`[sync-main] Auto-resolved ${conflictFiles.length} pipeline-owned conflict(s) with origin/main`);
    logActivity('sync_main_auto_resolved_conflicts', `Auto-resolved ${conflictFiles.length} pipeline-owned conflict(s) in ${issueId} with origin/main`);

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

  console.log(`[sync-main] ${conflictFiles.length} conflict(s); aborting merge for manual resolution`);
  logActivity('sync_main_conflicts', `${conflictFiles.length} conflict(s) in ${issueId}: ${conflictFiles.join(', ')}`);

  try { await execAsync('git merge --abort', { cwd: projectPath, encoding: 'utf-8' }); } catch { /* non-fatal */ }

  return {
    success: false,
    conflictFiles,
    reason: `Sync-main produced ${conflictFiles.length} conflict(s) in ${issueId}: ${conflictFiles.join(', ')}. Resolve manually in the workspace, then re-run sync-main.`,
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
    const config = loadProjectsConfigSync();
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
    return await Effect.runPromise(runQualityGates(gatesToRun, projectPath, phase));
  } catch (error: any) {
    console.error(`[merge-agent] Failed to load quality gates: ${error.message}`);
    return [];
  }
}
