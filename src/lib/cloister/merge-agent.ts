/**
 * Merge Agent - Automatic merge conflict resolution using Claude Code
 */

import { existsSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { Effect } from 'effect';
import { killSession, listSessionNames } from '../tmux.js';
import { emitActivityEntrySync, emitActivityTtsSync } from '../activity-logger.js';
import { loadConfigSync } from '../config-yaml.js';
import { capturePipelineStageForIssue } from '../telemetry/pipeline.js';
import { enqueueMergedDockerCleanup } from './merged-docker-cleanup-worker.js';
import {
  completedPostMerge as _completedPostMerge,
  postMergeInFlight as _postMergeInFlight,
} from './post-merge-guard.js';
import {
  ensureSyncGitQuiescent,
  probeGitOperationHeads,
  runSyncGitCommand,
  SyncGitCommandAbortError,
  SyncGitCommandTimeoutError,
} from './sync-main-git.js';
import { syncMainAcrossWorkspaceRepos, type SyncMainRepoResult, type SyncMainResult } from './sync-main-workspace.js';
export type { SyncMainRepoResult, SyncMainResult } from './sync-main-workspace.js';

const execAsync = promisify(exec);

const SYNC_GIT_FETCH_TIMEOUT_MS = 60_000;
const SYNC_GIT_MERGE_TIMEOUT_MS = 120_000;
const SYNC_GIT_COMMIT_TIMEOUT_MS = 60_000;
const SYNC_GIT_STATUS_TIMEOUT_MS = 30_000;

/**
 * Paths that must never enter a pipeline pre-sync commit, regardless of gitignore
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
  // PAN-1899: machine-local Overdeck config copied into every workspace by
  // copyOverdeckSettingsToWorkspaceSync (config.yaml, projects.yaml,
  // settings.json). It diverges from main constantly and must never enter a
  // feature branch — that was the source of the recurring projects.yaml sync
  // conflict.
  '.overdeck/',
];

const SYNC_MAIN_MAIN_PREFERRED_PATHS = [
  '.pan/continues',
  '.pan/specs',
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
  issueId?: string,
  signal?: AbortSignal,
): Promise<{ success: boolean; committed: boolean; reason?: string }> {
  const run = (command: string, timeout = SYNC_GIT_STATUS_TIMEOUT_MS) =>
    runSyncGitCommand(command, { cwd: projectPath, timeout, signal });
  try {
    const operationHeads = await probeGitOperationHeads(projectPath, SYNC_GIT_STATUS_TIMEOUT_MS, signal);
    if (!operationHeads.success) return { success: false, committed: false, reason: operationHeads.reason };
    if (operationHeads.present.length > 0) {
      return { success: false, committed: false, reason: `Refusing to pre-sync commit while ${operationHeads.present[0]} exists; finish or abort the in-progress Git operation first` };
    }

    try {
      const { stdout: conflictMarkers } = await run("git grep -n -I -E '^(<<<<<<<( |$)|=======$|>>>>>>>( |$))' -- .");
      if (conflictMarkers.trim()) {
        const files = [...new Set(conflictMarkers.trim().split('\n').map((line) => line.split(':', 1)[0]))];
        return { success: false, committed: false, reason: `Refusing to pre-sync commit conflict markers in: ${files.join(', ')}` };
      }
    } catch (error: any) {
      if (error?.code !== 1) return { success: false, committed: false, reason: `Failed to scan for conflict markers: ${error.message}` };
    }

    const { stdout: statusOut } = await run('git status --porcelain');
    if (!statusOut.trim()) return { success: true, committed: false, reason: 'no uncommitted changes' };

    await run('git add -A');
    const resetPaths = AUTO_COMMIT_EXCLUDED_PATHS.map((p) => p.endsWith('/') ? p.slice(0, -1) : p).join(' ');
    await run(`git reset HEAD -- ${resetPaths}`);

    const { stdout: diffStat } = await run('git diff --cached --stat');
    if (!diffStat.trim()) return { success: true, committed: false, reason: 'only excluded/ignored changes remain' };

    const commitMessage = issueId ? `chore: pre-sync commit before sync with main (${issueId})` : 'chore: pre-sync commit before sync with main';
    await run(`git commit -m "${commitMessage}"`, SYNC_GIT_COMMIT_TIMEOUT_MS);
    return { success: true, committed: true };
  } catch (error: any) {
    if (error instanceof SyncGitCommandAbortError || error instanceof SyncGitCommandTimeoutError) {
      await ensureSyncGitQuiescent(projectPath, false);
    }
    const reason = error instanceof SyncGitCommandTimeoutError && error.command.startsWith('git commit ')
      ? `Auto-commit git commit timed out after ${SYNC_GIT_COMMIT_TIMEOUT_MS / 1_000}s`
      : `Failed to pre-sync commit: ${error.message}`;
    return { success: false, committed: false, reason };
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { resolveGitHubIssueSync } from '../tracker-utils.js';

import { cleanupStaleLocks } from '../git-utils.js';
import { recordFeatureRegistryLifecycle } from '../registry/feature-registry-population.js';
import { verifyMergedBeforeLifecycle, type PostMergeLifecycleOptions } from './merge-verification.js';

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
 * Timeout for merge agent in milliseconds (15 minutes)
 */
/**
 * Notify TLDR daemon to reindex changed files after merge
 */
export async function notifyTldrDaemon(projectPath: string, _sourceBranch: string): Promise<void> {
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
 * Leaves the issue, workspace, xBRIEF, branches, and agent state dirs intact.
 * The explicit close-out ceremony performs final archival and destructive cleanup.
 *
 * IDEMPOTENT: Safe to call multiple times for the same issueId. Tracks completed
 * issues and returns immediately on re-entry. This is defense-in-depth against
 * the infinite loop that burned 24,626 Linear API calls (PAN-328).
 */

// PAN-1531: dropLingeringPreMergeStashes removed. The pre-merge stash kind
// is no longer created by Overdeck, so there's nothing for the post-merge
// lifecycle to clean up. Pre-existing pre-merge:* residue in refs/stash is
// expected and inert.

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export async function postMergeLifecycle(
  issueId: string,
  projectPath: string,
  sourceBranch?: string,
  options?: PostMergeLifecycleOptions,
): Promise<void> {
  // PAN-1517: postMergeLifecycle fires only when the issue's main feature branch merges to `main`.
  // Guard 1: skip if already completed in this process (PAN-3917: there is no
  // stored mergeStep to consult and no cross-process lifecycle worker left).
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
    // Guard 2: closed-out is TERMINAL. Close-out flips the spec to completed/cancelled,
    // clears review status, and closes the tracker issue.
    // Re-running the handoff after that resurrects the review row and REOPENS
    // the closed issue — observed live on PAN-1190 (2026-06-11): the deacon's
    // stale-merge sweep saw the cleared row as "stale" 47 minutes after
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

    const mergeVerification = await verifyMergedBeforeLifecycle(issueId, projectPath, sourceBranch, options);
    if (!mergeVerification.merged) {
      console.warn(`[merge-agent] Refusing post-merge lifecycle for ${issueId}: ${mergeVerification.reason}`);
      return;
    }
    console.log(`[merge-agent] Verified merge before lifecycle for ${issueId}: ${mergeVerification.reason}`);

    // The one place the merge outcome is known for certain: the forge has been
    // asked and answered "merged". Every merge path — the MERGE door, an
    // auto-merge, an admin merge seen by the PR webhook — arrives here, and the
    // in-flight/completed guards above make it exactly once per issue.
    try {
      const { appendPipelineEntry } = await import('./pipeline-journal.js');
      const { getIssueWorkspacePath } = await import('../overdeck/issue-projects.js');
      const workspacePath = getIssueWorkspacePath(issueId);
      if (workspacePath) {
        appendPipelineEntry(workspacePath, {
          type: 'merge.completed',
          issueId: issueId.toUpperCase(),
          source: 'post-merge-lifecycle',
          data: { reason: mergeVerification.reason, ...(sourceBranch ? { sourceBranch } : {}) },
        });
      }
    } catch { /* journalling must never block the lifecycle */ }

    // PAN-3917: nothing is stamped here. The forge already says the PR merged —
    // that IS the merge state, and every reader derives it.
    // Eager Docker cleanup must run before any fatal post-merge handoff step.
    let dockerRetryReason: string | null = null;
    try {
      const { teardownWorkspaceDockerByNamePromise } = await import('../workspace-manager/docker.js');
      const teardown = await teardownWorkspaceDockerByNamePromise(issueId.toLowerCase());
      if (teardown.networkRemoved) {
        console.log(`[merge-agent] ✓ Removed Docker stack/network: ${teardown.steps.join('; ')}`);
        logActivity('docker_cleanup', `Removed Docker stack/network for ${issueId}: ${teardown.steps.join('; ')}`);
      } else {
        dockerRetryReason = teardown.steps.join('; ') || 'network remained after teardown';
      }
    } catch (err) {
      dockerRetryReason = err instanceof Error ? err.message : String(err);
    }
    if (dockerRetryReason) {
      enqueueMergedDockerCleanup(issueId, { mergeVerified: true });
      console.warn(`[merge-agent] Docker cleanup queued for retry (non-fatal): ${dockerRetryReason}`);
    }

    // PAN-3917 (D1): the post-merge deploy loop is gone. `pan reload` is the one
    // deploy path, run by the flywheel loop after an overdeck merge lands green.

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
      announceMerge('failed', issueId, `Post-merge verifying_on_main transition failed: ${message}`);
      logActivity('merge_failed', `Post-merge verifying_on_main transition failed for ${issueId}: ${message}`);
      throw err;
    }

    // Release verification runs asynchronously so post-merge cleanup is not
    // delayed by a slow external deploy. It reports itself through the release
    // engine's own output (git tags and GitHub releases, PAN-3917 D6).
    triggerPostMergeReleaseIfConfigured(issueId, projectPath).catch((err) => {
      console.warn(`[merge-agent] Async post-merge release trigger failed for ${issueId}: ${err instanceof Error ? err.message : String(err)}`);
    });

    // 3. Pause work/planning/strike agents and close their terminals to free resources.
    try {
      const { setAgentPaused, getAgentStateSync } = await import('../agents.js');
      // A failed backend close must never skip pausing the remaining agents.
      const closeAgentTerminal = async (agentId: string): Promise<boolean> => {
        try {
          const { closeAgentPane } = await import('../terminal-backends/launch.js');
          return await closeAgentPane(agentId);
        } catch (err) {
          console.warn(`[merge-agent] Could not close ${agentId} terminal: ${err}`);
          return false;
        }
      };
      const issueLower = issueId.toLowerCase();
      const reason = 'awaiting close-out (verify on main)';
      for (const agentId of [`agent-${issueLower}`, `planning-${issueLower}`, `strike-${issueLower}`]) {
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
        let verify = getAgentStateSync(agentId);
        if (verify?.paused !== true) {
          await Effect.runPromise(setAgentPaused(agentId, reason, true));
          verify = getAgentStateSync(agentId);
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
        // PAN-3947: close through the terminal backend — `kill-session` on
        // tmux, `pane.close` on Herdr. A tmux-only kill left every Herdr pane
        // (and the idle harness in it) alive, so close-out's DoD row 5 still
        // saw a running work agent.
        if (await closeAgentTerminal(agentId)) {
          console.log(`[merge-agent] ✓ Closed ${agentId} terminal to free resources`);
          logActivity('agent_session_killed', `Freed resources: closed terminal for ${agentId}`);
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
        const { killed } = await killAllReviewerSessions(projectKey, issueId);
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
    await notifyTldrDaemon(projectPath, sourceBranch ?? '');
    await maybeSpawnPostMergeKnowledgeRetro(issueId, projectPath);

    _completedPostMerge.add(issueId); void capturePipelineStageForIssue(issueId, 'merged');

    console.log(`[merge-agent] Post-merge handoff completed for ${issueId}. Awaiting close-out (verify on main).`);
    announceMerge('completed', issueId);
    logActivity('merge_complete', `Merged ${issueId}. Awaiting close-out (verify on main).`);
  })().finally(() => { _postMergeInFlight.delete(issueId); });
  _postMergeInFlight.set(issueId, run);
  return run;
}

/**
 * Run the project's release after a merge, when one is configured.
 *
 * PAN-3917 (D6): ships are git tags plus GitHub releases. There is no
 * release state to read before starting or to stamp afterwards — a repeat
 * trigger is suppressed by process memory, and the release engine's own output
 * on the forge is the record.
 */
const _releaseTriggered = new Set<string>();

export async function triggerPostMergeReleaseIfConfigured(issueId: string, projectPath: string): Promise<void> {
  if (_releaseTriggered.has(issueId)) {
    console.log(`[merge-agent] Release already triggered for ${issueId} in this process, skipping`);
    return;
  }

  const { resolveProjectFromIssueSync, getProjectSync } = await import('../projects.js');
  const resolved = resolveProjectFromIssueSync(issueId);
  const project = resolved ? getProjectSync(resolved.projectKey) : null;

  if (!project?.release) {
    console.log(`[merge-agent] No release config for ${issueId}; skipping release`);
    return;
  }

  _releaseTriggered.add(issueId);
  const { runRelease } = await import('../release/release-engine.js');
  try {
    await runRelease(issueId, projectPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Release failures never fail the merge: the merge already landed.
    console.warn(`[merge-agent] Post-merge release trigger failed for ${issueId}: ${message}`);
    logActivity('release_failed', `Post-merge release trigger failed for ${issueId}: ${message}`);
  }
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

/** Pane roles the post-merge lifecycle closes — the specialists; work/plan/strike are closed by agent id in step 3. */
const POST_MERGE_PANE_ROLES = ['review', 'test', 'uat'] as const;

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

  // PAN-3947: a Herdr pane has no tmux session name, so the scan above finds
  // none of them. Close the issue's review/test/uat panes by their stamped
  // `issue` + `role` tokens. No-op on a tmux host.
  try {
    const { closeIssuePanes } = await import('../terminal-backends/launch.js');
    const closed = await closeIssuePanes(issueId, { roles: POST_MERGE_PANE_ROLES });
    if (closed.length > 0) {
      console.log(`[merge-agent] ✓ Closed ${closed.length} review/test/uat pane(s) for ${issueId}: ${closed.join(', ')}`);
      logActivity('role_sessions_killed', `Closed ${closed.length} review/test/uat pane(s) for ${issueId} on merge`);
    }
  } catch (err) {
    console.warn(`[merge-agent] Could not close role panes for ${issueId}: ${err}`);
  }
}


function isPostMergeKnowledgeRetroEnabled(): boolean {
  try {
    return loadConfigSync().config.knowledge?.postMergeAutoRetro === true;
  } catch (err) {
    console.warn(`[merge-agent] Could not read knowledge post-merge retro config: ${err}`);
    return false;
  }
}

async function maybeSpawnPostMergeKnowledgeRetro(issueId: string, projectPath: string): Promise<void> {
  if (!isPostMergeKnowledgeRetroEnabled()) return;

  try {
    const child = spawn('pan', ['knowledge', issueId, '--retro'], {
      cwd: projectPath,
      detached: true,
      stdio: 'ignore',
    });
    child.once?.('error', (err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[merge-agent] Post-merge knowledge retro spawn failed for ${issueId}: ${message}`);
      logActivity('knowledge_retro_error', `Post-merge knowledge retro spawn failed for ${issueId}: ${message}`, issueId);
    });
    child.unref();
    console.log(`[merge-agent] Spawned post-merge knowledge retro for ${issueId} (pid ${child.pid})`);
    logActivity('knowledge_retro_spawned', `Spawned post-merge knowledge retro for ${issueId}`, issueId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[merge-agent] Post-merge knowledge retro spawn failed for ${issueId}: ${message}`);
    logActivity('knowledge_retro_error', `Post-merge knowledge retro spawn failed for ${issueId}: ${message}`, issueId);
  }
}

export { resetPostMergeState } from './post-merge-guard.js';

/**
 * Parse result markers from agent output
 */
export function parseAgentOutput(output: string): MergeResult {
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
function isSyncGitTermination(error: unknown): boolean {
  return error instanceof SyncGitCommandAbortError || error instanceof SyncGitCommandTimeoutError;
}

async function getConflictFiles(projectPath: string, signal?: AbortSignal): Promise<string[]> {
  try {
    const { stdout: status } = await runSyncGitCommand('git diff --name-only --diff-filter=U', {
      cwd: projectPath, timeout: SYNC_GIT_STATUS_TIMEOUT_MS, signal,
    });
    return status.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch (error) {
    if (isSyncGitTermination(error)) throw error;
    console.error('Failed to get conflict files:', error);
    return [];
  }
}

async function resolveMainPreferredSyncConflicts(
  projectPath: string,
  conflictFiles: string[],
  targetBranch: string, signal?: AbortSignal,
): Promise<{ success: boolean; reason?: string }> {
  if (conflictFiles.length === 0 || !conflictFiles.every(isSyncMainMainPreferredPath)) {
    return { success: false, reason: 'conflicts include non-pipeline-owned files' };
  }

  const run = (command: string, timeout = SYNC_GIT_STATUS_TIMEOUT_MS) =>
    runSyncGitCommand(command, { cwd: projectPath, timeout, signal });
  try {
    for (const path of SYNC_MAIN_MAIN_PREFERRED_PATHS) {
      await run(`git rm -r --quiet --ignore-unmatch -- ${path}`);
      await run(`git checkout origin/${targetBranch} -- ${path}`).catch((error) => {
        if (isSyncGitTermination(error)) throw error;
        // The path may not exist on the target branch. The preceding git rm
        // records that branch's deletion for this pipeline-owned path.
      });
      if ((await run(`git ls-files -- ${path}`)).stdout.trim()) await run(`git add -A -- ${path}`);
    }

    const remainingConflicts = await getConflictFiles(projectPath, signal);
    if (remainingConflicts.length > 0) {
      return { success: false, reason: `Unresolved conflicts remain: ${remainingConflicts.join(', ')}` };
    }

    await run('git commit --no-edit', SYNC_GIT_COMMIT_TIMEOUT_MS);
    return { success: true };
  } catch (error: any) {
    if (isSyncGitTermination(error)) throw error;
    return { success: false, reason: `Failed to auto-resolve pipeline-owned conflicts: ${error.message}` };
  }
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
    eventType: `mergeOutcome.${status === 'completed' ? 'merged' : status === 'started' ? 'merging' : 'failed'}`,
  });
}

// PAN-1531: ship-role machinery (buildShipPreparationPrompt, buildShipSyncMainPrompt,
// spawnShipRoleForTask, spawnMergeAgentForBranches, spawnRebaseAgentForBranch,
// defaultWorkspaceForIssue) removed. Rebase is now performed in-process via
// rebaseFeatureBranch() in src/lib/cloister/merge-rebase.ts. See docs/MERGE-WORKFLOW.md.

async function collectSyncMergeStats(projectPath: string, signal?: AbortSignal): Promise<Pick<SyncMainResult, 'commitCount' | 'changedFiles'>> {
  const run = (command: string) => runSyncGitCommand(command, {
    cwd: projectPath, timeout: SYNC_GIT_STATUS_TIMEOUT_MS, signal,
  });
  let changedFiles: string[] = [];
  let commitCount = 0;
  try {
    const { stdout } = await run('git diff --name-only ORIG_HEAD HEAD 2>/dev/null || git diff --name-only HEAD~1 HEAD');
    changedFiles = stdout.trim().split('\n').filter(Boolean);
  } catch (error) { if (isSyncGitTermination(error)) throw error; }
  try {
    const { stdout } = await run('git log ORIG_HEAD..HEAD --oneline 2>/dev/null || echo ""');
    commitCount = stdout.trim().split('\n').filter(Boolean).length;
  } catch (error) { if (isSyncGitTermination(error)) throw error; }
  return { changedFiles, commitCount };
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
async function syncMainIntoRepo(
  repoDir: string,
  issueId: string,
  targetBranch: string,
  signal?: AbortSignal,
): Promise<Omit<SyncMainRepoResult, 'repoKey' | 'skipped'>> {
  const run = (command: string, timeout = SYNC_GIT_STATUS_TIMEOUT_MS) =>
    runSyncGitCommand(command, { cwd: repoDir, timeout, signal });
  let mergeStarted = false;

  try {
    console.log(`[sync-main] Checking for uncommitted changes...`);
    logActivity('sync_main_auto_commit', `Auto-committing uncommitted changes before sync`);
    const autoCommit = await autoCommitWorkspaceChangesBeforeSync(repoDir, issueId, signal);
    if (!autoCommit.success) {
      const message = autoCommit.reason || 'Failed to pre-sync commit uncommitted changes';
      console.error(`[sync-main] ${message}`);
      logActivity('sync_main_blocked', message);
      return { success: false, reason: message };
    }
    if (autoCommit.committed) console.log(`[sync-main] Auto-commit successful`);

    const { stdout: postCommitStatus } = await run('git status --porcelain');
    if (postCommitStatus.trim()) {
      const remainingNonExcluded = postCommitStatus.trim().split('\n')
        .filter((line) => !isAutoCommitExcludedPath(parseStatusPath(line)));
      if (remainingNonExcluded.length > 0) {
        const message = 'Uncommitted changes remain after the pre-sync commit — aborting sync';
        console.error(`[sync-main] ${message}`);
        logActivity('sync_main_blocked', message);
        return { success: false, reason: message };
      }
    }

    try {
      const lockCleanup = await cleanupStaleLocks(repoDir, { signal, processProbeTimeoutMs: SYNC_GIT_STATUS_TIMEOUT_MS });
      if (lockCleanup.found.length > 0) console.log(`[sync-main] Found ${lockCleanup.found.length} lock file(s)`);
      if (lockCleanup.removed.length > 0) {
        console.log(`[sync-main] Cleaned up ${lockCleanup.removed.length} stale lock file(s)`); logActivity('git_lock_cleanup', `Removed ${lockCleanup.removed.length} stale lock file(s)`);
      }
      if (lockCleanup.errors.length > 0) {
        const details = lockCleanup.errors.map(({ file, error }) => `${file}: ${error}`).join('; ');
        const message = `Cannot safely start sync: ${details}`;
        console.error(`[sync-main] ${message}`); logActivity('sync_main_blocked', message);
        return { success: false, reason: message };
      }
    } catch (lockError) {
      const cause = lockError instanceof Error ? lockError.message : String(lockError);
      const message = `Cannot verify Git lock state: ${cause}`;
      console.error(`[sync-main] ${message}`); logActivity('sync_main_blocked', message);
      return { success: false, reason: message };
    }
    console.log(`[sync-main] Fetching origin/${targetBranch}...`);
    try {
      await run(`git fetch origin ${targetBranch}`, SYNC_GIT_FETCH_TIMEOUT_MS);
    } catch (error) {
      if (isSyncGitTermination(error)) throw error;
      return { success: false, reason: `Failed to fetch origin/${targetBranch}: ${(error as Error).message}` };
    }

    let mergeOutput = '';
    let hasConflicts = false;
    try {
      mergeStarted = true;
      const result = await run(`git merge origin/${targetBranch}`, SYNC_GIT_MERGE_TIMEOUT_MS);
      mergeStarted = false;
      mergeOutput = (result.stdout || '') + (result.stderr || '');
    } catch (error: any) {
      if (isSyncGitTermination(error)) throw error;
      mergeOutput = (error.stdout || '') + (error.stderr || '');
      hasConflicts = true;
    }

    if (mergeOutput.includes('Already up to date') || mergeOutput.includes('Already up-to-date')) {
      console.log(`[sync-main] Already up to date`);
      logActivity('sync_main_noop', `${issueId} already up to date with ${targetBranch}`);
      return { success: true, alreadyUpToDate: true };
    }

    if (!hasConflicts) {
      console.log(`[sync-main] Clean merge completed`);
      logActivity('sync_main_success', `Clean merge of ${targetBranch} into ${issueId}`);
      return { success: true, ...await collectSyncMergeStats(repoDir, signal) };
    }

    const conflictFiles = await getConflictFiles(repoDir, signal);
    const mainPreferredResolution = await resolveMainPreferredSyncConflicts(repoDir, conflictFiles, targetBranch, signal);
    if (mainPreferredResolution.success) {
      mergeStarted = false;
      console.log(`[sync-main] Auto-resolved ${conflictFiles.length} pipeline-owned conflict(s) with origin/${targetBranch}`);
      logActivity('sync_main_auto_resolved_conflicts', `Auto-resolved ${conflictFiles.length} pipeline-owned conflict(s) in ${issueId} with origin/${targetBranch}`);
      return { success: true, ...await collectSyncMergeStats(repoDir, signal) };
    }

    console.log(`[sync-main] ${conflictFiles.length} conflict(s); aborting merge for manual resolution`);
    logActivity('sync_main_conflicts', `${conflictFiles.length} conflict(s) in ${issueId}: ${conflictFiles.join(', ')}`);
    await ensureSyncGitQuiescent(repoDir, true);
    mergeStarted = false;
    return {
      success: false,
      conflictFiles,
      reason: `Sync-main produced ${conflictFiles.length} conflict(s) in ${issueId}: ${conflictFiles.join(', ')}. Resolve manually in the workspace, then re-run sync-main.`,
    };
  } catch (error) {
    if (!isSyncGitTermination(error)) throw error;
    await ensureSyncGitQuiescent(repoDir, mergeStarted);
    return {
      success: false,
      reason: error instanceof SyncGitCommandTimeoutError ? error.message : 'Sync-main cancelled after reaching its preparation deadline',
    };
  }
}

export async function syncMainIntoWorkspace(
  projectPath: string,
  issueId: string,
  signal?: AbortSignal,
): Promise<SyncMainResult> {
  return syncMainAcrossWorkspaceRepos(projectPath, issueId, signal, syncMainIntoRepo, logActivity);
}
