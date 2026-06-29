import { exec } from 'child_process';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { Effect } from 'effect';
import { emitActivityEntrySync } from '../activity-logger.js';
import { getAgentRuntimeStateSync, getAgentStateSync, listRunningAgents } from '../agents.js';
import { listAllAgentsSync as listAllAgents } from '../overdeck/agents.js';
import { markWorkspaceStuck } from '../overdeck/review-status-sync.js';
import { AGENTS_DIR } from '../paths.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { getReviewStatusSync, loadReviewStatuses, setReviewStatusSync, type ReviewStatus } from '../review-status.js';
import { logDeaconEventSync } from '../persistent-logger.js';
import { recordDeaconNudge } from './deacon-nudge-log.js';
import { getNoResumeMode } from './no-resume-mode.js';
import { REVIEW_SUB_ROLES } from './review-monitor.js';
import { getAllProjectSpecialistStatuses, getTmuxSessionName } from './specialists.js';
import { isPaneDead, sessionExistsSync } from '../tmux.js';
import { describeRunningAgents, releaseAdvancingSlot, tryReserveAdvancingSlot } from './concurrency.js';
import { findWorkspacePath } from '../lifecycle/archive-planning.js';
import { isIssueClosed } from './issue-closed.js';
import { getAutoCloseOutCanonicalState } from './deacon-canonical-state.js';

const execAsync = promisify(exec);

// ============================================================================
// Orphaned Review Status Detection
// ============================================================================

/**
 * Check for orphaned review/test statuses (PAN-88 follow-up)
 *
 * Detects when an issue has reviewStatus='reviewing' or testStatus='testing'
 * but the corresponding specialist isn't actually running. This can happen if:
 * - The specialist crashed mid-review
 * - The specialist was killed
 * - The wake failed but status wasn't rolled back
 *
 * Resets orphaned statuses to 'pending' so the work can be retried.
 */
/**
 * PAN-794: Circuit-breaker threshold for consecutive parallel-review re-dispatches
 * within a recovery cycle. After this many resets of reviewing → pending by the
 * orphan sweep, the workspace is flagged stuck so it stops burning agent cycles.
 * A clean review outcome (pass/blocked/fail), new commits, or manual unstick
 * resets the counter (see review-agent.ts and checkPostReviewCommits below).
 */
const REVIEW_INFRA_BREAKER_THRESHOLD = 3;

/**
 * Orphan-test self-heal state. A test role cannot spawn while the workspace
 * docker stack is unhealthy — `assertWorkspaceStackHealthyForSpawn` throws and
 * the orphan-test patrol re-fails the identical dispatch every cycle forever
 * (observed: PAN-1190 looped `dispatch_failed` for ~18h after its server/dev
 * containers exited). The deacon now rebuilds the stack before re-dispatch,
 * bounded by a cooldown + attempt cap so a stack that genuinely cannot be
 * rebuilt escalates to a human instead of looping `docker compose` forever.
 */
const testStackRebuildState: Map<string, { lastAttempt: number; attempts: number; escalated: boolean }> =
  new Map();
const TEST_STACK_REBUILD_COOLDOWN_MS = 15 * 60 * 1000;
const TEST_STACK_REBUILD_MAX_ATTEMPTS = 3;

export const stalledReviewConvoyRecoveryState: Map<string, { lastAttempt: number; attempts: number; escalated: boolean }> =
  new Map();
const STALLED_REVIEW_CONVOY_RECOVERY_COOLDOWN_MS = 15 * 60 * 1000;
const STALLED_REVIEW_CONVOY_RECOVERY_MAX_ATTEMPTS = 3;

export interface ReviewConvoyLiveness {
  anyLive: boolean;
  anyGated: boolean;
  agentIds: string[];
}

export function reviewConvoyLiveness(issueId: string): ReviewConvoyLiveness {
  const normalizedIssueId = issueId.toLowerCase();
  const agentIds = [
    `agent-${normalizedIssueId}`,
    `agent-${normalizedIssueId}-review`,
    ...REVIEW_SUB_ROLES.map((subRole) => `agent-${normalizedIssueId}-review-${subRole}`),
  ];

  let anyLive = false;
  let anyGated = false;

  for (const agentId of agentIds) {
    const agentState = getAgentStateSync(agentId);
    if (!agentState) {
      continue;
    }
    anyLive ||= agentState.status === 'running' || agentState.status === 'starting';
    anyGated ||= agentState.paused === true || agentState.troubled === true;
  }

  return { anyLive, anyGated, agentIds };
}

/**
 * Outcome of an orphan-test stack-health recovery attempt:
 * - `healthy`   — stack is already fine; dispatch can proceed.
 * - `rebuilt`   — stack was unhealthy, a rebuild ran successfully; dispatch can proceed.
 * - `cooldown`  — stack unhealthy, a rebuild was attempted recently; wait it out.
 * - `exhausted` — stack unhealthy, the rebuild cap is reached; escalate, stop retrying.
 */
type TestStackRecovery = 'healthy' | 'rebuilt' | 'cooldown' | 'exhausted';

/**
 * Ensure the workspace docker stack for a test re-dispatch is healthy,
 * rebuilding it once per cooldown window if not. Bounded by
 * TEST_STACK_REBUILD_MAX_ATTEMPTS so an unrebuildable stack escalates cleanly.
 */
async function recoverUnhealthyTestStack(
  issueId: string,
  workspacePath: string,
): Promise<TestStackRecovery> {
  const key = issueId.toUpperCase();
  const { getWorkspaceStackHealth } = await import('../workspace/stack-health.js');

  // PAN-1249: getWorkspaceStackHealth now returns an Effect — run it at this
  // Promise boundary. The Effect never fails (error channel: never), so
  // Effect.runPromise is safe and the result is the plain WorkspaceStackHealth.
  const health = await Effect.runPromise(getWorkspaceStackHealth(issueId, { workspacePath }));
  if (health.healthy) {
    testStackRebuildState.delete(key);
    return 'healthy';
  }

  const record = testStackRebuildState.get(key) ?? { lastAttempt: 0, attempts: 0, escalated: false };
  const now = Date.now();

  if (record.attempts >= TEST_STACK_REBUILD_MAX_ATTEMPTS) {
    if (!record.escalated) {
      record.escalated = true;
      testStackRebuildState.set(key, record);
      emitActivityEntrySync({
        source: 'cloister',
        level: 'error',
        issueId: key,
        message: `test-stack-rebuild-exhausted: ${key}`,
        details: `Workspace docker stack still unhealthy after ${record.attempts} rebuild attempts: ${health.reasons.join('; ')}. Manual 'pan workspace rebuild ${key}' or 'pan workspace reap' needed.`,
      });
      console.warn(
        `[deacon] Test stack for ${key} unhealthy after ${record.attempts} rebuilds — escalated; ` +
          `stop re-dispatching until a human intervenes`,
      );
    }
    return 'exhausted';
  }

  if (now - record.lastAttempt < TEST_STACK_REBUILD_COOLDOWN_MS) {
    return 'cooldown';
  }

  record.lastAttempt = now;
  record.attempts += 1;
  testStackRebuildState.set(key, record);
  console.log(
    `[deacon] Test stack for ${key} unhealthy (${health.reasons.join('; ')}) — rebuilding ` +
      `(attempt ${record.attempts}/${TEST_STACK_REBUILD_MAX_ATTEMPTS})`,
  );

  const { rebuildWorkspaceStack } = await import('../workspace/rebuild-stack.js');
  // PAN-1249: rebuildWorkspaceStack returns Effect<RebuildWorkspaceStackResult>
  // with error channel `never` — the Effect captures any failure into
  // result.error. Run at this Promise boundary so the deacon's recovery loop
  // keeps its current Promise-based shape.
  const result = await Effect.runPromise(
    rebuildWorkspaceStack(issueId, {
      onProgress: (m) => console.log(`[deacon]   ${key} stack rebuild: ${m}`),
    }),
  );
  if (!result.success) {
    console.warn(`[deacon] Test stack rebuild failed for ${key}: ${result.error}`);
    emitActivityEntrySync({
      source: 'cloister',
      level: 'error',
      issueId: key,
      message: `test-stack-rebuild-failed: ${key}`,
      details: result.error ?? 'unknown error',
    });
    return 'cooldown';
  }

  console.log(`[deacon] Test stack for ${key} rebuilt — proceeding with test dispatch`);
  return 'rebuilt';
}

// ─────────────────────────────────────────────────────────────────────────────
// PAN-1908: reactive review-status handlers (replace directory scans)
// ─────────────────────────────────────────────────────────────────────────────

interface ReviewStatusLike {
  reviewStatus?: string;
  testStatus?: string;
  mergeStatus?: string;
  readyForMerge?: boolean;
  prUrl?: string | null;
  stuck?: boolean;
  deaconIgnored?: boolean;
  stuckReason?: string;
  reviewRetryCount?: number;
  recoveryStartedAt?: string;
  history?: Array<{ type: string; status: string; notes?: string }>;
  reviewNotes?: string;
  reviewedAtCommit?: string;
  stuckAt?: string;
  stuckDetails?: string;
}

function latestHistoryEntry(
  history: Array<{ type: string; status: string; notes?: string }> | undefined,
  type: 'review' | 'test',
  terminalStatuses: readonly string[],
): { status: string; notes?: string } | null {
  if (!history || history.length === 0) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry.type === type && terminalStatuses.includes(entry.status)) {
      return { status: entry.status, notes: entry.notes };
    }
  }
  return null;
}

function latestHistoryByType(
  history: Array<{ type: string; status: string; notes?: string }> | undefined,
  type: 'review' | 'test',
): string | undefined {
  if (!history || history.length === 0) return undefined;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].type === type) return history[i].status;
  }
  return undefined;
}

async function isReviewAgentActiveForIssue(issueId: string): Promise<boolean> {
  // PAN-1048 R5: role-primitive review/test runs (agent-<id>-review, agent-<id>-test).
  try {
    const agents = await Effect.runPromise(listRunningAgents());
    for (const agent of agents) {
      if (agent.status === 'stopped' || agent.status === 'error') continue;
      const id = (agent.issueId ?? '').trim().toUpperCase();
      if (!id || id !== issueId.toUpperCase()) continue;
      const role = agent.role ?? (agent.id.endsWith('-review') ? 'review' : agent.id.endsWith('-test') ? 'test' : null);
      if (role === 'review') return true;
    }
  } catch {
    // fall through
  }

  // Global specialists
  for (const type of ['review-agent'] as const) {
    const session = getTmuxSessionName(type);
    if (sessionExistsSync(session)) {
      const rState = getAgentRuntimeStateSync(session);
      if (rState?.state === 'active' && rState.currentIssue?.toUpperCase() === issueId.toUpperCase()) {
        return true;
      }
    }
  }

  // Per-project ephemeral specialists
  try {
    const projectStatuses = await getAllProjectSpecialistStatuses();
    for (const projSpec of projectStatuses) {
      if (!projSpec.isRunning || projSpec.specialistType !== 'review-agent') continue;
      const rState = getAgentRuntimeStateSync(projSpec.tmuxSession);
      if (rState?.state === 'active' && rState.currentIssue?.toUpperCase() === issueId.toUpperCase()) {
        return true;
      }
    }
  } catch {
    // fall through
  }

  return false;
}

async function isTestAgentActiveForIssue(issueId: string): Promise<boolean> {
  try {
    const agents = await Effect.runPromise(listRunningAgents());
    for (const agent of agents) {
      if (agent.status === 'stopped' || agent.status === 'error') continue;
      const id = (agent.issueId ?? '').trim().toUpperCase();
      if (!id || id !== issueId.toUpperCase()) continue;
      const role = agent.role ?? (agent.id.endsWith('-review') ? 'review' : agent.id.endsWith('-test') ? 'test' : null);
      if (role === 'test') return true;
    }
  } catch {
    // fall through
  }

  for (const type of ['test-agent'] as const) {
    const session = getTmuxSessionName(type);
    if (sessionExistsSync(session)) {
      const rState = getAgentRuntimeStateSync(session);
      if (rState?.state === 'active' && rState.currentIssue?.toUpperCase() === issueId.toUpperCase()) {
        return true;
      }
    }
  }

  try {
    const projectStatuses = await getAllProjectSpecialistStatuses();
    for (const projSpec of projectStatuses) {
      if (!projSpec.isRunning || projSpec.specialistType !== 'test-agent') continue;
      const rState = getAgentRuntimeStateSync(projSpec.tmuxSession);
      if (rState?.state === 'active' && rState.currentIssue?.toUpperCase() === issueId.toUpperCase()) {
        return true;
      }
    }
  } catch {
    // fall through
  }

  return false;
}

/**
 * PAN-1908: react to review.coordinator.died by resetting the issue to a
 * pending review state and re-dispatching the review role. No review-status
 * DB scan — operates on the single issue ID from the event.
 */
export async function handleReviewCoordinatorDied(
  issueId: string,
  _sessionName: string,
  _reason: string,
): Promise<string[]> {
  const actions: string[] = [];
  // PAN-1980: on a no-resume boot the operator's clean slate must hold — do NOT
  // auto-re-dispatch a review convoy (mirrors recoverOrphanedAgents). Review
  // dispatch is an auto-advance just like resume; the boot gate must cover it.
  if (getNoResumeMode().active) {
    logDeaconEventSync(`handleReviewCoordinatorDied: ${issueId} skipped review re-dispatch — OVERDECK_NO_RESUME=1`);
    return actions;
  }
  const status = getReviewStatusSync(issueId);

  if (!status) {
    logDeaconEventSync(`handleReviewCoordinatorDied: ${issueId} skipped — no review-status row`);
    return actions;
  }

  if (status.stuck || status.deaconIgnored) {
    logDeaconEventSync(`handleReviewCoordinatorDied: ${issueId} skipped — stuck/deaconIgnored`);
    return actions;
  }

  if (await isIssueClosed(issueId)) {
    logDeaconEventSync(`handleReviewCoordinatorDied: ${issueId} skipped — issue closed`);
    return actions;
  }

  // Only reset from active/reviewing states; terminal/failed states should not
  // be overwritten by a coordinator death event.
  if (status.reviewStatus !== 'reviewing' && status.reviewStatus !== 'pending') {
    logDeaconEventSync(`handleReviewCoordinatorDied: ${issueId} skipped — reviewStatus=${status.reviewStatus}`);
    return actions;
  }

  const nextRetry = (status.reviewRetryCount ?? 0) + 1;
  const recoveryStart = status.recoveryStartedAt ?? new Date().toISOString();
  setReviewStatusSync(issueId, {
    reviewStatus: 'pending',
    reviewRetryCount: nextRetry,
    recoveryStartedAt: recoveryStart,
  });
  actions.push(`Reset review for ${issueId} after coordinator died (retry ${nextRetry})`);

  const resolved = resolveProjectFromIssueSync(issueId);
  const issueLower = issueId.toLowerCase();
  const workspace = findWorkspacePath(resolved?.projectPath ?? '', issueLower);

  if (!resolved || !workspace) {
    actions.push(`Skipped review re-dispatch for ${issueId}: workspace unavailable`);
    return actions;
  }

  if (!tryReserveAdvancingSlot()) {
    actions.push(`Deferred review re-dispatch for ${issueId} — advancing-role concurrency ceiling reached`);
    return actions;
  }

  try {
    const { spawnReviewRoleForIssue } = await import('./review-agent.js');
    const dispatchResult = await Effect.runPromise(
      spawnReviewRoleForIssue({ issueId, workspace, branch: `feature/${issueLower}` }),
    );
    if (dispatchResult.gated) {
      releaseAdvancingSlot();
      actions.push(`Deferred review re-dispatch for ${issueId} — ${dispatchResult.message}`);
    } else if (dispatchResult.success) {
      actions.push(`Re-dispatched review for ${issueId} after coordinator died`);
    } else {
      actions.push(`Failed to re-dispatch review for ${issueId}: ${dispatchResult.error || dispatchResult.message}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    actions.push(`Failed to re-dispatch review for ${issueId}: ${msg}`);
  }

  return actions;
}

/**
 * PAN-1908: react to work.completed by creating a review-status row if one is
 * missing. The reactive scheduler's issue-state change already dispatches the
 * review role; this handler ensures the row exists so downstream reads don't
 * fail.
 */
export async function handleWorkCompleted(issueId: string): Promise<string[]> {
  const actions: string[] = [];
  const status = getReviewStatusSync(issueId);
  if (status) {
    logDeaconEventSync(`handleWorkCompleted: ${issueId} already has review-status row`);
    return actions;
  }

  if (await isIssueClosed(issueId)) {
    logDeaconEventSync(`handleWorkCompleted: ${issueId} skipped — issue closed`);
    return actions;
  }

  setReviewStatusSync(issueId, {
    reviewStatus: 'pending',
    testStatus: 'pending',
    updatedAt: new Date().toISOString(),
  });
  actions.push(`Created missing review-status row for ${issueId} (work completed)`);
  return actions;
}

/**
 * PAN-1908: per-issue orphan reconciler for a single review-status row. Used by
 * the legacy checkOrphanedReviewStatuses safety net and by reactive handlers.
 */
async function reconcileReviewStatusOrphan(issueId: string, status: ReviewStatusLike): Promise<string[]> {
  const actions: string[] = [];

  if (status.stuck) return actions;
  if (status.deaconIgnored) return actions;
  if (await isIssueClosed(issueId)) return actions;

  const hasPassedReview = latestHistoryByType(status.history, 'review') === 'passed';
  const hasPassedTest = latestHistoryByType(status.history, 'test') === 'passed';
  const latestTerminalReview = latestHistoryEntry(status.history, 'review', ['passed', 'failed', 'blocked']);
  const latestTerminalTest = latestHistoryEntry(status.history, 'test', ['passed', 'failed', 'skipped']);

  const reviewAgentActive = await isReviewAgentActiveForIssue(issueId);

  // Orphaned reviewing status
  if (status.reviewStatus === 'reviewing' && !reviewAgentActive) {
    if (latestTerminalReview && latestTerminalReview.status === 'passed') {
      const reviewUpdate: Record<string, unknown> = {
        reviewStatus: latestTerminalReview.status,
        reviewNotes: latestTerminalReview.notes,
      };
      try {
        const project = resolveProjectFromIssueSync(issueId);
        if (project) {
          const workspacePath = join(project.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
          if (existsSync(workspacePath)) {
            const { stdout } = await execAsync('git rev-parse HEAD', { cwd: workspacePath });
            reviewUpdate['reviewedAtCommit'] = stdout.trim();
          }
        }
      } catch { /* non-fatal */ }
      if (status.stuckReason === 'review_infrastructure_failure') {
        reviewUpdate['stuck'] = false;
        reviewUpdate['stuckReason'] = undefined;
        reviewUpdate['stuckAt'] = undefined;
        reviewUpdate['stuckDetails'] = undefined;
      }
      if (latestTerminalTest) {
        reviewUpdate['testStatus'] = latestTerminalTest.status;
        reviewUpdate['testNotes'] = latestTerminalTest.notes;
      }
      if (status.mergeStatus === 'failed') {
        const isCiFailure = typeof status.reviewNotes === 'string' && status.reviewNotes.includes('failing required checks');
        if (!isCiFailure) {
          reviewUpdate['mergeStatus'] = 'pending';
        }
      }
      setReviewStatusSync(issueId, reviewUpdate);
      actions.push(
        `Restored orphaned review snapshot for ${issueId} to ${latestTerminalReview.status}` +
        (latestTerminalTest ? ` / test ${latestTerminalTest.status}` : ''),
      );
      return actions;
    }
    if (!hasPassedReview) {
      const nextRetry = (status.reviewRetryCount ?? 0) + 1;
      const recoveryStart = status.recoveryStartedAt ?? new Date().toISOString();
      setReviewStatusSync(issueId, {
        reviewStatus: 'pending',
        reviewRetryCount: nextRetry,
        recoveryStartedAt: recoveryStart,
      });
      actions.push(
        `Reset orphaned review for ${issueId} (no review-agent active; retry ${nextRetry}/${REVIEW_INFRA_BREAKER_THRESHOLD})`,
      );
    }
  }

  // Re-dispatch pending reviews
  const reviewQueuedOrActive = reviewAgentActive;
  if (
    status.reviewStatus === 'pending' &&
    !reviewQueuedOrActive &&
    !hasPassedReview &&
    status.prUrl
  ) {
    if ((status.reviewRetryCount ?? 0) >= REVIEW_INFRA_BREAKER_THRESHOLD) {
      try {
        markWorkspaceStuck(issueId, 'review_infrastructure_failure', {
          reviewRetryCount: status.reviewRetryCount ?? 0,
          recoveryStartedAt: status.recoveryStartedAt,
          lastReviewNotes: status.reviewNotes,
        });
        actions.push(
          `Tripped review-infra breaker for ${issueId} after ${status.reviewRetryCount} retries — marked stuck`,
        );
      } catch (err) {
        console.error(`[deacon] Failed to mark ${issueId} stuck after breaker trip:`, err);
      }
      return actions;
    }

    const agentIdForCheck = `agent-${issueId.toLowerCase()}`;
    const completedProcessedFile = join(AGENTS_DIR, agentIdForCheck, 'completed.processed');
    if (!existsSync(completedProcessedFile)) return actions;

    const agentState = getAgentStateSync(agentIdForCheck);
    const resolved = resolveProjectFromIssueSync(issueId);
    const issueLower = issueId.toLowerCase();
    const workspace = agentState?.workspace || (resolved ? findWorkspacePath(resolved.projectPath, issueLower) : null);

    if (getNoResumeMode().active) {
      // PAN-1980: no-resume boot — skip re-dispatching the review convoy so the
      // operator's clean slate holds. Other reconciliation above still runs.
      logDeaconEventSync(`reconcileReviewStatusOrphan: ${issueId} skipped review re-dispatch — OVERDECK_NO_RESUME=1`);
      actions.push(`Skipped review re-dispatch for ${issueId} — no-resume mode active`);
    } else if (workspace && resolved && !tryReserveAdvancingSlot()) {
      actions.push(`Deferred review re-dispatch for ${issueId} — advancing-role concurrency ceiling reached`);
    } else if (workspace && resolved) {
      try {
        const { spawnReviewRoleForIssue } = await import('./review-agent.js');
        const dispatchResult = await Effect.runPromise(
          spawnReviewRoleForIssue({ issueId, workspace, branch: `feature/${issueLower}` }),
        );
        if (dispatchResult.gated) {
          releaseAdvancingSlot();
          actions.push(`Deferred review re-dispatch for ${issueId} — ${dispatchResult.message}`);
        } else if (dispatchResult.success) {
          actions.push(`Re-dispatched pending review for ${issueId} (deacon-orphan-recovery)`);
        } else {
          actions.push(`Failed to re-dispatch pending review for ${issueId}: ${dispatchResult.error || dispatchResult.message}`);
        }
      } catch (err) {
        actions.push(`Failed to re-dispatch pending review for ${issueId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (!resolved) {
      actions.push(`Skipped pending review re-dispatch for ${issueId}: no project configured`);
    } else {
      actions.push(`Skipped pending review re-dispatch for ${issueId}: workspace unavailable`);
    }
  }

  // Orphaned testing status
  const testAgentActive = await isTestAgentActiveForIssue(issueId);
  if (
    (status.testStatus === 'testing' || status.testStatus === 'dispatch_failed') &&
    !testAgentActive &&
    !hasPassedTest &&
    !status.readyForMerge
  ) {
    const agentId = `agent-${issueId.toLowerCase()}`;
    const agentState = getAgentStateSync(agentId);
    const resolved = resolveProjectFromIssueSync(issueId);
    const issueLower = issueId.toLowerCase();
    const workspace = agentState?.workspace || (resolved ? findWorkspacePath(resolved.projectPath, issueLower) : null);

    if (workspace && resolved) {
      const branch = `feature/${issueLower}`;
      const { spawnRun } = await import('../agents.js');
      const { buildTestRolePrompt } = await import('./test-agent-queue.js');

      const stackRecovery = await recoverUnhealthyTestStack(issueId, workspace);
      if (stackRecovery === 'cooldown' || stackRecovery === 'exhausted') {
        setReviewStatusSync(issueId, { testStatus: 'dispatch_failed' });
        actions.push(
          stackRecovery === 'exhausted'
            ? `Orphaned test for ${issueId}: workspace docker stack unhealthy, rebuild cap reached — escalated to human`
            : `Orphaned test for ${issueId}: workspace docker stack rebuilding — deferring re-dispatch`,
        );
      } else if (!tryReserveAdvancingSlot()) {
        actions.push(`Deferred test re-dispatch for ${issueId} — advancing-role concurrency ceiling reached`);
      } else {
        try {
          const run = await spawnRun(issueId, 'test', {
            workspace,
            prompt: buildTestRolePrompt({ issueId, workspace, branch }),
          });
          testStackRebuildState.delete(issueId.toUpperCase());
          setReviewStatusSync(issueId, { testStatus: 'testing' });
          actions.push(`Re-dispatched orphaned test for ${issueId} via test role ${run.id} (deacon-orphan-recovery)`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('already running')) {
            setReviewStatusSync(issueId, { testStatus: 'testing' });
            actions.push(`Orphaned test for ${issueId}: test role already running`);
          } else {
            setReviewStatusSync(issueId, { testStatus: 'dispatch_failed' });
            actions.push(`Orphaned test role dispatch failed for ${issueId}: ${msg}`);
          }
        }
      }
    } else {
      setReviewStatusSync(issueId, { testStatus: 'pending' });
      actions.push(
        !resolved
          ? `Reset orphaned test for ${issueId}: no project configured`
          : `Reset orphaned test for ${issueId}: workspace unavailable`,
      );
    }
  }

  return actions;
}

export async function checkOrphanedReviewStatuses(): Promise<string[]> {
  const actions: string[] = [];

  try {
    // PAN-1908: the primary orphan recovery path is now reactive
    // (review.coordinator.died / work.completed events). This function is kept
    // as a thin SQLite-only safety net for dropped events.
    const statuses = loadReviewStatuses();
    for (const [issueId, status] of Object.entries(statuses)) {
      const result = await reconcileReviewStatusOrphan(issueId, status as ReviewStatusLike);
      actions.push(...result);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error checking orphaned review statuses:', msg);
  }

  return actions;
}

export async function recoverStalledReviewConvoys(
  getCanonicalState: (issueId: string) => Promise<string | null> = getAutoCloseOutCanonicalState,
): Promise<string[]> {
  const actions: string[] = [];

  let statuses: Record<string, ReviewStatus>;
  try {
    statuses = loadReviewStatuses();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error loading review statuses for stalled convoy recovery:', message);
    return actions;
  }

  for (const [issueId, status] of Object.entries(statuses)) {
    try {
      if (status.reviewStatus !== 'reviewing' && status.reviewStatus !== 'pending') continue;
      if (status.stuck || status.deaconIgnored) continue;

      const canonicalState = await getCanonicalState(issueId);
      if (canonicalState !== 'in_review') continue;

      const liveness = reviewConvoyLiveness(issueId);
      if (liveness.anyLive || liveness.anyGated) continue;

      const issueLower = issueId.toLowerCase();
      const resolved = resolveProjectFromIssueSync(issueId);
      if (!resolved) {
        actions.push(`Skipped stalled review convoy recovery for ${issueId}: no project configured`);
        continue;
      }

      const workspace = findWorkspacePath(resolved.projectPath, issueLower);
      if (!workspace) {
        actions.push(`Skipped stalled review convoy recovery for ${issueId}: workspace unavailable`);
        continue;
      }

      const key = issueId.toUpperCase();
      let record = stalledReviewConvoyRecoveryState.get(key) ?? { lastAttempt: 0, attempts: 0, escalated: false };
      const now = Date.now();

      // If a human un-stuck the issue, grant a fresh recovery budget.
      if (record.escalated && !status.stuck) {
        stalledReviewConvoyRecoveryState.delete(key);
        record = { lastAttempt: 0, attempts: 0, escalated: false };
      }

      if (record.attempts >= STALLED_REVIEW_CONVOY_RECOVERY_MAX_ATTEMPTS) {
        if (!record.escalated) {
          record.escalated = true;
          stalledReviewConvoyRecoveryState.set(key, record);
          const stuckDetails = JSON.stringify({
            attempts: record.attempts,
            agentIds: liveness.agentIds,
            canonicalState,
          });
          setReviewStatusSync(issueId, {
            stuck: true,
            stuckReason: 'review_convoy_unrecoverable',
            stuckAt: new Date(now).toISOString(),
            stuckDetails,
          });
          status.stuck = true;
          status.stuckReason = 'review_convoy_unrecoverable';
          status.stuckAt = new Date(now).toISOString();
          status.stuckDetails = stuckDetails;
          emitActivityEntrySync({
            source: 'cloister',
            level: 'error',
            issueId: key,
            message: `stalled-review-convoy-unrecoverable: ${key}`,
            details: `Review convoy fully stopped after ${record.attempts} recovery attempts; marked stuck for human intervention. Agents: ${liveness.agentIds.join(', ')}`,
          });
          actions.push(
            `Stalled review convoy for ${issueId}: recovery cap reached after ${record.attempts} attempts — marked stuck`,
          );
        } else {
          actions.push(
            `Stalled review convoy for ${issueId}: recovery cap already escalated after ${record.attempts} attempts`,
          );
        }
        continue;
      }

      if (now - record.lastAttempt < STALLED_REVIEW_CONVOY_RECOVERY_COOLDOWN_MS) {
        actions.push(
          `Stalled review convoy for ${issueId}: deferring — cooldown active after attempt ${record.attempts}/${STALLED_REVIEW_CONVOY_RECOVERY_MAX_ATTEMPTS}`,
        );
        continue;
      }

      // PAN-1665: honor advancing-role concurrency budget before dispatch.
      if (!tryReserveAdvancingSlot()) {
        actions.push(
          `Stalled review convoy for ${issueId}: deferring — advancing-role concurrency ceiling reached`,
        );
        continue;
      }

      record.lastAttempt = now;
      record.attempts += 1;
      stalledReviewConvoyRecoveryState.set(key, record);

      const { spawnReviewRoleForIssue } = await import('./review-agent.js');
      try {
        const result = await Effect.runPromise(spawnReviewRoleForIssue({
          issueId,
          workspace,
          branch: `feature/${issueLower}`,
          force: true,
        }));
        if (!result.success) {
          throw new Error(result.error ?? result.message);
        }
        stalledReviewConvoyRecoveryState.delete(key);
        status.reviewStatus = 'reviewing';
        actions.push(
          `Re-dispatched stalled review convoy for ${issueId} (attempt ${record.attempts}/${STALLED_REVIEW_CONVOY_RECOVERY_MAX_ATTEMPTS})`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        actions.push(`Failed to re-dispatch stalled review convoy for ${issueId}: ${message}`);
        console.error(`[deacon] Failed to re-dispatch stalled review convoy for ${issueId}:`, message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      actions.push(`Failed stalled review convoy recovery for ${issueId}: ${message}`);
      console.error(`[deacon] Failed stalled review convoy recovery for ${issueId}:`, message);
    }
  }

  return actions;
}

// ============================================================================
// PAN-699: Missing review status detection
// ============================================================================

/**
 * Check for completed work agents that have no review status entry at all.
 *
 * This catches the gap where `pan done` wrote the completion marker but the
 * HTTP trigger to the dashboard never arrived (dashboard down, network failure,
 * etc). Deacon scans the agent directories and auto-triggers review dispatch.
 */
export async function checkMissingReviewStatuses(): Promise<string[]> {
  const actions: string[] = [];

  try {
    // PAN-1908: primary missing-status creation is now reactive (work.completed
    // event). This function is kept as a thin safety net that queries the
    // agents table instead of scanning directories.
    const statuses = loadReviewStatuses();
    const agents = listAllAgents();

    for (const agent of agents) {
      if (!agent.id.startsWith('agent-')) continue;
      const issueId = agent.id.replace('agent-', '').toUpperCase();
      if (statuses[issueId]) continue;

      const completedFile = join(AGENTS_DIR, agent.id, 'completed');
      const processedFile = join(AGENTS_DIR, agent.id, 'completed.processed');
      if (!existsSync(completedFile) && !existsSync(processedFile)) continue;

      const rowCreated = await handleWorkCompleted(issueId);
      actions.push(...rowCreated);

      // PAN-1496: if the issue is closed, reap the stale markers.
      try {
        if (await isIssueClosed(issueId)) {
          try { if (existsSync(completedFile)) rmSync(completedFile); } catch { /* best-effort */ }
          try { if (existsSync(processedFile)) rmSync(processedFile); } catch { /* best-effort */ }
          actions.push(`Reaped stale completion markers for CLOSED ${issueId} (no review re-dispatch)`);
          continue;
        }
      } catch (closedErr) {
        console.warn(`[deacon] checkMissingReviewStatuses closed-check failed for ${issueId}:`, closedErr);
      }

      const resolved = resolveProjectFromIssueSync(issueId);
      const issueLower = issueId.toLowerCase();
      const workspace = findWorkspacePath(resolved?.projectPath ?? '', issueLower);
      if (!resolved || !workspace) {
        actions.push(`Skipped missing-status review for ${issueId}: ${!resolved ? 'no project configured' : 'workspace unavailable'}`);
        continue;
      }

      if (!tryReserveAdvancingSlot()) {
        actions.push(`Deferred missing-status review for ${issueId} — advancing-role concurrency ceiling reached`);
        continue;
      }

      try {
        const { spawnReviewRoleForIssue } = await import('./review-agent.js');
        await Effect.runPromise(spawnReviewRoleForIssue({
          issueId,
          workspace,
          branch: `feature/${issueLower}`,
        }));
        recordDeaconNudge({
          patrol: 'checkMissingReviewStatuses',
          issueId,
          action: 'auto-triggered review (missing status entry)',
          reason: 'work agent has a completion marker but no review was dispatched — the reactive work→review handoff (work.completed → in_review) never created/dispatched review',
        });
        actions.push(`Auto-triggered review for ${issueId} (missing status entry)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        actions.push(`Failed to auto-trigger review for ${issueId}: ${msg}`);
        console.error(`[deacon] Failed to auto-trigger review for ${issueId}:`, msg);
      }
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error checking missing review statuses:', msg);
  }

  return actions;
}


