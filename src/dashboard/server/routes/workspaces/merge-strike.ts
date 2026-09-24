import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { Effect } from 'effect';

import { messageAgent, spawnAgent } from '../../../../lib/agents.js';
import { isAlive } from '../../../../lib/agents/liveness.js';
import {
  clearYieldForResume,
  decideResumeGate,
  getAgentResumeGateBlockReason,
  getAgentState,
  saveAgentStateSync,
} from '../../../../lib/agents/agent-state.js';
import { getWorkAgentLifecycleStateSync } from '../../../../lib/work-agent-lifecycle.js';
import { evaluateIssueMergeGate } from '../../../../lib/cloister/merge-gate.js';
import type { MergeReadiness } from '../../../../lib/cloister/pr-facts.js';
import type { VerificationRunnerOptions } from '../../../../lib/cloister/verification-types.js';
import type { DerivedIssueState } from '@overdeck/contracts';
import { rebaseFeatureBranch } from '../../../../lib/cloister/merge-rebase.js';
import { sessionExists } from '../../../../lib/tmux.js';
import type { MergeRunPatch, MergeRunPhase } from '../../services/merge-queue-service.js';

const execAsync = promisify(exec);

export interface StrikeMergeRequest {
  kind: 'strike'; markerHead: string; workspacePath: string; branchName: string; recoveryTarget: string;
}
export type TriggerMergeRequest = { kind: 'normal' } | StrikeMergeRequest;

export function mergeVerificationOptions(
  request: TriggerMergeRequest,
): Pick<VerificationRunnerOptions, 'syncTargetBranch' | 'skipPlanChecklist'> {
  return {
    syncTargetBranch: false,
    ...(request.kind === 'strike' ? { skipPlanChecklist: true } : {}),
  };
}

/**
 * PAN-3120: resume the work agent for a merge-requested rebase and narrate it to
 * the operator (Awaiting Merge tracker + ship log), so a scheduler-yielded agent
 * shows as "Preparing work agent" rather than a silent step or a dead end.
 * Status writes go through the caller's `setStatus` to keep this module free of
 * the workspaces-route import cycle.
 */
export async function prepareWorkAgentForRebase(opts: {
  issueId: string;
  workspacePath: string;
  agentId: string;
  rebaseMsg: string;
  allowFreshStart?: boolean;
  scopeNote: string;
  setStatus: (update: MergeRunPatch) => void;
  deferFailureStatus?: boolean;
}): Promise<{ ok: true; detail: string } | { ok: false; error: string }> {
  const { appendShipLog } = await import('../../../../lib/cloister/ship-log.js');
  opts.setStatus({ step: 'preparing-work-agent', notes: `Preparing work agent ${opts.agentId} to rebase ${opts.scopeNote}…` });
  appendShipLog(opts.issueId, `Preparing work agent ${opts.agentId} for rebase…`, 'rebasing');
  try {
    const recovery = await ensureAgentReadyForMerge(opts.issueId, opts.workspacePath, opts.rebaseMsg, {
      agentId: opts.agentId,
      ...(opts.allowFreshStart === undefined ? {} : { allowFreshStart: opts.allowFreshStart }),
    });
    opts.setStatus({ step: 'rebasing', notes: `${recovery.detail} Waiting for ${opts.scopeNote} to be rebased and pushed.` });
    appendShipLog(opts.issueId, `✓ ${recovery.detail}`, 'rebasing');
    console.log(`[merge] ${recovery.detail}`);
    return { ok: true, detail: recovery.detail };
  } catch (prepError) {
    const message = prepError instanceof Error ? prepError.message : String(prepError);
    const error = `Work agent ${opts.agentId} could not be prepared for the rebase: ${message}`;
    opts.setStatus(opts.deferFailureStatus
      ? { notes: error }
      : { phase: 'failed', notes: error });
    appendShipLog(opts.issueId, `✗ ${error}`, 'rebasing');
    return { ok: false, error };
  }
}

export interface TriggerMergeResult {
  success: boolean;
  statusCode: number;
  error?: string;
  retryable?: boolean;
  deferred?: boolean;
  message?: string;
  /** The issue's derived pipeline state at the moment the merge was refused. */
  state?: DerivedIssueState['state'];
  /** Phase of THIS merge run (in-memory), never a stored pipeline status. */
  outcome?: MergeRunPhase;
  prUrl?: string;
  remote?: boolean;
  repos?: Array<{ repo: string; success: boolean; message: string; testsStatus?: string }>;
  testsStatus?: string;
  note?: string;
  mergeResult?: unknown;
}

export function activeStrikeMerge(currentMerge: string | null, pendingOperation?: { type: string; status: string } | null): boolean {
  return currentMerge !== null || (pendingOperation?.type === 'merge' && pendingOperation.status === 'running');
}
export interface MergeEligibilityResult {
  success: false; statusCode: number; error: string; state?: DerivedIssueState['state']; outcome?: MergeRunPhase;
}

export interface MergeQueueAdvanceDeps {
  dequeue: (projectKey: string, completedIssueId?: string) => string | null;
  /** The issue's derived pipeline state — approvals, checks, and mergeability. */
  getDerivedState: (issueId: string) => Promise<DerivedIssueState>;
  /**
   * The merge gate over the forge's PR facts (`cloister/merge-gate.ts`): the
   * CI test job in a `verification.tests: ci` project (#4021) and a failed
   * required UAT at the head (#4036), on top of FR-9.
   */
  checkMergeGate?: (issueId: string) => Promise<MergeGateVerdict>;
  triggerMerge: (issueId: string) => Promise<unknown>;
  log: (message: string) => void;
  warn: (message: string) => void;
}

/** What `evaluateIssueMergeGate` answers, narrowed to what the merge doors read. */
export interface MergeGateVerdict extends MergeReadiness {
  facts?: { headBranch: string | null };
}

/**
 * Advance a project's merge queue: drop entries that cannot start, then trigger
 * the first one that can.
 *
 * PAN-3328: the queue used to advance by handing its single head entry to
 * `triggerMerge()` and stopping. `triggerMerge()` rejects an issue whose PR is
 * not approved-green-mergeable *before* it ever claims the queue, so a dead head
 * bounced on every advance and was never removed. One such row wedged the whole
 * queue permanently: 12 entries stacked up behind it over 26 days with every
 * `started_at` still NULL, and live work parked silently forever. Walking past
 * unstartable heads is what makes the queue self-draining; a dropped issue
 * re-enqueues itself if it becomes mergeable later.
 *
 * #4016: every entry passes the same gate. The queue used to turn an entry
 * into a strike landing whenever `origin/strike/<issue>` existed and skip the
 * gate for it, so a strike branch merged without approval or green checks.
 * Only `triggerMerge` enqueues, and only for a normal merge; since PAN-3973 a
 * strike opens its own PR that the operator merges, so the queue no longer
 * looks for strike branches at all.
 */
export async function advanceMergeQueue(
  deps: MergeQueueAdvanceDeps,
  projectKey: string,
  completedIssueId?: string,
): Promise<void> {
  // `dropped` guarantees termination even if a dequeue keeps handing back the
  // same entry — the queue must never be able to spin this loop.
  const dropped = new Set<string>();
  const checkMergeGate = deps.checkMergeGate ?? evaluateIssueMergeGate;
  let nextIssueId = deps.dequeue(projectKey, completedIssueId);
  while (nextIssueId && !dropped.has(nextIssueId)) {
    const unstartable = normalMergeEligibility(await deps.getDerivedState(nextIssueId))
      ?? mergeGateRefusal(await checkMergeGate(nextIssueId));
    if (!unstartable) {
      deps.log(`[merge] Dequeuing next merge: ${nextIssueId}`);
      const issueId = nextIssueId;
      void deps.triggerMerge(issueId).catch((err: unknown) =>
        deps.warn(`[merge] Queue error for ${issueId}: ${err}`),
      );
      return;
    }
    deps.warn(`[merge] Dropped ${nextIssueId} from the ${projectKey} merge queue: ${unstartable.error}`);
    dropped.add(nextIssueId);
    nextIssueId = deps.dequeue(projectKey, nextIssueId);
  }
}

/**
 * #4016/#4021/#4036: `triggerMerge`'s gate over the forge's PR facts, for
 * every merge, strike or normal — approval, green checks, the CI test job in a
 * `verification.tests: ci` project, and no failed required UAT at the head. A
 * strike is gated on its own `strike/<issue>` PR (`expectedBranch`).
 */
export async function forgeMergeGateRefusal(
  issueId: string,
  expectedBranch?: string,
  gate: (issueId: string, options?: { preferBranch?: string }) => Promise<MergeGateVerdict>
    = (id, options) => evaluateIssueMergeGate(id, {}, options),
): Promise<MergeEligibilityResult | null> {
  const verdict = expectedBranch ? await gate(issueId, { preferBranch: expectedBranch }) : await gate(issueId);
  return mergeGateRefusal(verdict, expectedBranch);
}

/**
 * The merge gate's refusal, or null when it lets the merge through.
 *
 * `expectedBranch` pins the PR the gate judged: a strike landing must be
 * gated on the `strike/<issue>` PR, never on the issue's feature PR.
 */
export function mergeGateRefusal(
  gate: MergeGateVerdict,
  expectedBranch?: string,
): MergeEligibilityResult | null {
  if (!gate.ready) {
    return { success: false, statusCode: 400, error: `Cannot merge: ${gate.reason ?? 'the merge gate refused'}` };
  }
  if (expectedBranch && gate.facts?.headBranch !== expectedBranch) {
    return {
      success: false,
      statusCode: 400,
      error: `Cannot merge: the open pull request is on ${gate.facts?.headBranch ?? 'no branch'}, not ${expectedBranch}`,
    };
  }
  return null;
}

/**
 * The merge gate (FR-9): approvals, green checks, and forge mergeability, which
 * together are exactly `DerivedIssueState.state === 'ready'`.
 */
export function normalMergeEligibility(
  derived: DerivedIssueState | null,
  activelyMerging = false,
  run?: { phase: MergeRunPhase } | null,
): MergeEligibilityResult | null {
  if (derived?.state === 'merged') {
    return { success: false, statusCode: 400, error: 'Already merged', state: 'merged' };
  }
  if (derived?.state !== 'ready') {
    const reason = mergeBlockReason(derived);
    return {
      success: false,
      statusCode: 400,
      error: `Cannot merge: ${reason}`,
      ...(derived?.state ? { state: derived.state } : {}),
    };
  }
  if (run?.phase === 'merging' && activelyMerging) {
    return { success: false, statusCode: 400, error: 'Merge already in progress', outcome: 'merging' };
  }
  return null;
}

/** Which of the three forge conditions is missing, in the operator's words. */
export function mergeBlockReason(derived: DerivedIssueState | null): string {
  const pr = derived?.pr;
  if (!pr) return 'no open pull request for this issue';
  if (pr.reviewState === 'changes-requested') return 'the latest review requested changes';
  if (pr.reviewState !== 'approved') return 'the pull request is not approved yet';
  if (pr.checks === 'red') return 'checks are failing';
  if (pr.checks !== 'green') return 'checks have not finished';
  if (pr.mergeable === false) return 'the forge reports the pull request as conflicting';
  return 'the forge has not finished computing mergeability';
}

/**
 * Validate a strike landing against git, which owns it. The marker HEAD the
 * caller recorded must still be `origin/strike/<issue>`, and the workspace and
 * branch identity must match — a stale signal or a moved branch aborts.
 */
export async function validateStrikeMergeRequest(
  issueId: string,
  request: StrikeMergeRequest,
  deps: { projectPath: string; git: (args: string[], cwd: string) => Promise<string> },
): Promise<string | null> {
  const issueLower = issueId.toLowerCase();
  const expectedBranch = `strike/${issueLower}`;
  const expectedWorkspace = `${deps.projectPath}/workspaces/feature-${issueLower}-strike`;
  if (request.branchName !== expectedBranch || request.workspacePath !== expectedWorkspace || request.recoveryTarget !== `strike-${issueLower}`) return `Strike request identity does not match ${expectedWorkspace} on ${expectedBranch}`;
  try {
    const root = await deps.git(['rev-parse', '--show-toplevel'], request.workspacePath);
    const branch = await deps.git(['branch', '--show-current'], request.workspacePath);
    await deps.git(['fetch', 'origin', expectedBranch], request.workspacePath);
    const remoteHead = await deps.git(['rev-parse', `origin/${expectedBranch}`], request.workspacePath);
    if (root !== expectedWorkspace || branch !== expectedBranch) return 'Strike workspace or branch identity changed before landing';
    if (remoteHead !== request.markerHead) return `Stale strike signal: recorded HEAD ${request.markerHead} differs from origin/${expectedBranch} at ${remoteHead}`;
  } catch (error) {
    return `Could not validate strike branch: ${error instanceof Error ? error.message : String(error)}`;
  }
  return null;
}

/**
 * PAN-3120: clear whatever gate would stop THIS merge from reaching the work
 * agent. The preemptive scheduler yields idle work agents to free slots, so the
 * agent a merge needs is routinely paused by the system itself — and a paused
 * agent silently diverts `messageAgent` into a mail queue nothing drains, which
 * the merge then waits 30 minutes on. Returns a human-readable note when a gate
 * was cleared so the operator sees why the agent came back.
 */
async function clearMergePreparationGate(agentId: string): Promise<string | null> {
  const state = getAgentState(agentId);
  if (!state) return null;
  const decision = decideResumeGate(getAgentResumeGateBlockReason(state), 'merge-preparation');
  if (decision.decision === 'block') throw new Error(decision.reason);
  if (decision.decision !== 'proceed') return null;

  if (decision.clearYield) {
    clearYieldForResume(agentId);
    return `cleared scheduler yield (${state.pausedReason ?? 'yielded'})`;
  }
  if (decision.clearStoppedByUser) {
    delete state.stoppedByUser;
    saveAgentStateSync(state);
    return 'cleared operator-stop gate for the requested merge';
  }
  return null;
}

/** A message diverted to the mail queue never reaches the agent — treat it as a failure, not a resume. */
function assertDelivered(agentId: string, outcome: { delivered: boolean; queuedToMail?: boolean; reason?: string }): void {
  if (outcome.delivered) return;
  throw new Error(
    `Merge preparation request for ${agentId} was not delivered${outcome.reason ? ` (${outcome.reason})` : ''}` +
    `${outcome.queuedToMail ? ' — it went to the mail queue, so no rebase would ever happen' : ''}.`,
  );
}

export async function ensureAgentReadyForMerge(issueId: string, workspacePath: string, rebaseMsg: string, options?: { agentId?: string; allowFreshStart?: boolean }): Promise<{ recovered: boolean; agentId: string; detail: string }> {
  const agentId = options?.agentId ?? `agent-${issueId.toLowerCase()}`;
  const gateNote = await clearMergePreparationGate(agentId);
  const gateSuffix = gateNote ? ` (${gateNote})` : '';
  const lifecycle = getWorkAgentLifecycleStateSync(agentId);
  if (lifecycle.hasLiveTmuxSession) {
    assertDelivered(agentId, await messageAgent(agentId, rebaseMsg));
    return { recovered: true, agentId, detail: `Work agent already running; sent merge preparation request${gateSuffix}.` };
  }
  const agentState = getAgentState(agentId);
  if (agentState) try {
    assertDelivered(agentId, await messageAgent(agentId, rebaseMsg));
    const updatedLifecycle = getWorkAgentLifecycleStateSync(agentId);
    const verb = updatedLifecycle.canResumeSession ? 'Resumed' : 'Restarted';
    return { recovered: true, agentId, detail: `${verb} work agent and sent merge preparation request${gateSuffix}.` };
  } catch (error) {
    if (!lifecycle.canStartFresh) throw error;
  }
  if (options?.allowFreshStart === false || !lifecycle.canStartFresh) throw new Error(lifecycle.reason || `Work agent ${agentId} cannot be resumed or started for merge preparation.`);
  const state = await spawnAgent({ issueId, workspace: workspacePath, role: 'work', prompt: rebaseMsg, startedBy: 'merge-strike' });
  return { recovered: true, agentId, detail: `Started fresh work agent ${state.id} and sent merge preparation request.` };
}

export interface RebaseEscalationResult {
  success: boolean;
  reason?: string;
  conflictFiles?: string[];
  newHead?: string;
  retryable?: boolean;
}

export async function rebaseWithAgentFallback(options: {
  issueId: string;
  workspacePath: string;
  branchName: string;
  targetBranch: string;
  agentId: string;
  rebaseMsg: string;
  allowFreshStart: boolean;
  /**
   * Hand the request only to an agent the liveness oracle confirms is running
   * now; never resume one that has exited or whose state cannot be told. A
   * finished strike sits idle at its prompt and still takes a PR update
   * request, but once its session has exited, resuming it would revive an
   * agent whose contract ended with the PR URL.
   */
  liveAgentOnly?: boolean;
  setStatus: (update: MergeRunPatch) => void;
}): Promise<RebaseEscalationResult> {
  const { issueId, workspacePath, branchName, targetBranch, agentId, rebaseMsg, allowFreshStart, liveAgentOnly, setStatus } = options;
  let serverRebaseReason: string | undefined;
  let conflictFiles: string[] = [];

  if (existsSync(workspacePath)) {
    try {
      const result = await Effect.runPromise(rebaseFeatureBranch(workspacePath, branchName, targetBranch, issueId));
      console.log(`[merge] Server-side rebase completed for ${issueId}`);
      return { success: true, newHead: result.newHead };
    } catch (error: unknown) {
      const detail = error as { conflictedFiles?: unknown; message?: unknown };
      conflictFiles = Array.isArray(detail.conflictedFiles)
        ? detail.conflictedFiles.filter((file): file is string => typeof file === 'string')
        : [];
      const message = error instanceof Error ? error.message : typeof detail.message === 'string' ? detail.message : undefined;
      serverRebaseReason = conflictFiles.length > 0
        ? `Rebase conflicts in: ${conflictFiles.join(', ')}`
        : message || 'Server-side rebase failed';
      console.warn(`[merge] ${serverRebaseReason} — escalating to the work agent for ${issueId}`);
    }
  }

  // Positive evidence only: an indeterminate probe (a Herdr socket that does
  // not answer, a failed ps) is not "live", or the resume path below would
  // revive an exited strike.
  const verdict = liveAgentOnly ? await isAlive(agentId) : null;
  if (verdict && !verdict.alive) {
    const state = verdict.reason === 'runtime-indeterminate' ? 'cannot be confirmed running' : 'has exited';
    const agentReason = `${agentId} ${state}, so no agent can update ${branchName}; `
      + `update its pull request by hand or run \`pan strike ${issueId}\` again`;
    console.log(`[merge] ${agentReason} — not resuming it`);
    return {
      success: false,
      reason: serverRebaseReason ? `${serverRebaseReason}; ${agentReason}` : agentReason,
      conflictFiles,
      retryable: false,
    };
  }

  try {
    const preparation = await prepareWorkAgentForRebase({
      issueId, workspacePath, agentId, rebaseMsg, allowFreshStart, scopeNote: branchName, setStatus,
      deferFailureStatus: true,
    });
    if (!preparation.ok) throw new Error(preparation.error);
    const { stdout: headBefore } = await execAsync(
      `git rev-parse origin/${branchName} 2>/dev/null || echo NONE`,
      { cwd: workspacePath, encoding: 'utf-8', timeout: 10000 }
    );
    const timeoutMs = 30 * 60 * 1000;
    const startTime = Date.now();
    let newHead: string | null = null;

    while (Date.now() - startTime < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      try {
        await execAsync('git fetch origin', { cwd: workspacePath, encoding: 'utf-8', timeout: 15000 });
        const { stdout: headNow } = await execAsync(`git rev-parse origin/${branchName}`, { cwd: workspacePath, encoding: 'utf-8', timeout: 5000 });
        if (headNow.trim() !== headBefore.trim()) {
          newHead = headNow.trim();
          console.log(`[merge] Work agent pushed rebased branch for ${issueId} (new HEAD: ${newHead.slice(0, 8)})`);
          break;
        }
      } catch { /* fetch failed, retry */ }
      if (!await Effect.runPromise(sessionExists(agentId))) {
        console.log(`[merge] Work agent ${agentId} stopped during rebase`);
        break;
      }
    }

    if (newHead) return { success: true, newHead };
    if (!await Effect.runPromise(sessionExists(agentId))) {
      const agentReason = `Work agent ${agentId} stopped before completing the rebase onto ${targetBranch}`;
      return {
        success: false,
        reason: serverRebaseReason ? `${serverRebaseReason}; ${agentReason}` : agentReason,
        conflictFiles,
        retryable: conflictFiles.length === 0,
      };
    }
    return {
      success: false,
      reason: `Work agent did not push the rebased branch within ${timeoutMs / 60000} minutes`,
      conflictFiles,
      retryable: conflictFiles.length === 0,
    };
  } catch (error: unknown) {
    const agentReason = error instanceof Error ? error.message : `Work agent ${agentId} could not be prepared for merge`;
    return {
      success: false,
      reason: serverRebaseReason ? `${serverRebaseReason}; ${agentReason}` : agentReason,
      conflictFiles,
      retryable: conflictFiles.length === 0,
    };
  }
}
