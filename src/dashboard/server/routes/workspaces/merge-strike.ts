import { Effect } from 'effect';

import { getAgentState, messageAgent, spawnAgent } from '../../../../lib/agents.js';
import {
  clearYieldForResumeSync,
  decideResumeGate,
  getAgentResumeGateBlockReason,
  getAgentStateSync,
  saveAgentStateSync,
} from '../../../../lib/agents/agent-state.js';
import { getWorkAgentLifecycleStateSync } from '../../../../lib/work-agent-lifecycle.js';
import type { VerificationRunnerOptions } from '../../../../lib/cloister/verification-types.js';
import type { ReviewStatus, ReviewStatusUpdate } from '../../../../lib/review-status.js';

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
 * PAN-3067: the PAN-2487 CI-green skip bypasses the verification runner — which
 * is what records verificationStatus on local runs — and that skip is the exact
 * path every strike merge takes (its CI is already green). Record the verdict
 * here so DoD row 3 has evidence and close-out can proceed.
 */
export async function recordCiGreenVerificationVerdict(issueId: string, workspacePath: string): Promise<void> {
  try {
    const { snapshotWorkspaceHeadsPromise } = await import('../../../../lib/git-utils.js');
    const verifiedAnchor = await snapshotWorkspaceHeadsPromise(issueId, workspacePath).catch(() => undefined);
    const { setReviewStatusSync } = await import('../../../../lib/review-status.js');
    setReviewStatusSync(issueId, {
      verificationStatus: 'passed',
      verificationNotes: 'merge-verify: CI green on the merged tip (PAN-2487 local-gate skip)',
      ...(verifiedAnchor ? { lastVerifiedCommit: verifiedAnchor } : {}),
    });
  } catch (recordErr) {
    const message = recordErr instanceof Error ? recordErr.message : String(recordErr);
    console.warn(`[merge] Could not record CI-green verification verdict for ${issueId}: ${message}`);
  }
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
  setStatus: (update: ReviewStatusUpdate) => void;
}): Promise<{ ok: true; detail: string } | { ok: false; error: string }> {
  const { appendShipLog } = await import('../../../../lib/cloister/ship-log.js');
  opts.setStatus({ mergeStep: 'preparing-work-agent', mergeNotes: `Preparing work agent ${opts.agentId} to rebase ${opts.scopeNote}…` });
  appendShipLog(opts.issueId, `Preparing work agent ${opts.agentId} for rebase…`, 'rebasing');
  try {
    const recovery = await ensureAgentReadyForMerge(opts.issueId, opts.workspacePath, opts.rebaseMsg, {
      agentId: opts.agentId,
      ...(opts.allowFreshStart === undefined ? {} : { allowFreshStart: opts.allowFreshStart }),
    });
    opts.setStatus({ mergeStep: 'rebasing', mergeNotes: `${recovery.detail} Waiting for ${opts.scopeNote} to be rebased and pushed.` });
    appendShipLog(opts.issueId, `✓ ${recovery.detail}`, 'rebasing');
    console.log(`[merge] ${recovery.detail}`);
    return { ok: true, detail: recovery.detail };
  } catch (prepError) {
    const message = prepError instanceof Error ? prepError.message : String(prepError);
    const error = `Work agent ${opts.agentId} could not be prepared for the rebase: ${message}`;
    opts.setStatus({ mergeStatus: 'failed', readyForMerge: false, mergeNotes: error });
    appendShipLog(opts.issueId, `✗ ${error}`, 'rebasing');
    return { ok: false, error };
  }
}

export interface TriggerMergeResult {
  success: boolean;
  statusCode: number;
  error?: string;
  message?: string;
  reviewStatus?: string;
  testStatus?: string;
  mergeStatus?: string;
  prUrl?: string;
  remote?: boolean;
  repos?: Array<{ repo: string; success: boolean; message: string; testsStatus?: string }>;
  testsStatus?: string;
  note?: string;
  mergeResult?: unknown;
}

export function parseStrikeMergeRequest(raw: unknown): StrikeMergeRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const request = raw as Record<string, unknown>;
  return request.kind === 'strike'
    && typeof request.markerHead === 'string'
    && typeof request.workspacePath === 'string'
    && typeof request.branchName === 'string'
    && typeof request.recoveryTarget === 'string'
    ? request as unknown as StrikeMergeRequest
    : null;
}

export function mergeCompletionStatus(request: TriggerMergeRequest): Pick<ReviewStatus, 'strikeLandingState' | 'strikeReadyHead' | 'strikeReadyAt' | 'strikeTransportRetryCount' | 'strikeNextAttemptAt'> | Record<string, never> {
  return request.kind === 'strike'
    ? {
        strikeLandingState: 'landed',
        strikeReadyHead: undefined,
        strikeReadyAt: undefined,
        strikeTransportRetryCount: undefined,
        strikeNextAttemptAt: undefined,
      }
    : {};
}
export function activeStrikeMerge(currentMerge: string | null, pendingOperation?: { type: string; status: string } | null): boolean {
  return currentMerge !== null || (pendingOperation?.type === 'merge' && pendingOperation.status === 'running');
}
export interface MergeEligibilityResult {
  success: false; statusCode: number; error: string; reviewStatus?: string; testStatus?: string; mergeStatus?: string;
}

export function normalMergeEligibility(status: ReviewStatus | null, activelyMerging = false): MergeEligibilityResult | null {
  if (!status?.readyForMerge) return { success: false, statusCode: 400, error: 'Cannot merge: review and tests have not passed yet', reviewStatus: status?.reviewStatus || 'pending', testStatus: status?.testStatus || 'pending' };
  if (status.mergeStatus === 'merging' && activelyMerging) return { success: false, statusCode: 400, error: 'Merge already in progress', mergeStatus: 'merging' };
  if (status.mergeStatus === 'merged') return { success: false, statusCode: 400, error: 'Already merged', mergeStatus: 'merged' };
  return null;
}

export async function validateStrikeMergeRequest(
  issueId: string,
  request: StrikeMergeRequest,
  status: ReviewStatus | null,
  deps: { projectPath: string; git: (args: string[], cwd: string) => Promise<string> },
): Promise<string | null> {
  const issueLower = issueId.toLowerCase();
  const expectedBranch = `strike/${issueLower}`;
  const expectedWorkspace = `${deps.projectPath}/workspaces/feature-${issueLower}-strike`;
  if (status?.strikeLandingState !== 'ready' && status?.strikeLandingState !== 'landing') return `Strike landing state is ${status?.strikeLandingState ?? 'missing'}, expected ready or landing`;
  if (status.strikeReadyHead !== request.markerHead) return `Strike marker HEAD changed from ${request.markerHead} to ${status.strikeReadyHead ?? 'missing'}`;
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
  const state = getAgentStateSync(agentId);
  if (!state) return null;
  const decision = decideResumeGate(getAgentResumeGateBlockReason(state), 'merge-preparation');
  if (decision.decision === 'block') throw new Error(decision.reason);
  if (decision.decision !== 'proceed') return null;

  if (decision.clearYield) {
    clearYieldForResumeSync(agentId);
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
  const agentState = await Effect.runPromise(getAgentState(agentId));
  if (agentState) try {
    assertDelivered(agentId, await messageAgent(agentId, rebaseMsg));
    const updatedLifecycle = getWorkAgentLifecycleStateSync(agentId);
    const verb = updatedLifecycle.canResumeSession ? 'Resumed' : 'Restarted';
    return { recovered: true, agentId, detail: `${verb} work agent and sent merge preparation request${gateSuffix}.` };
  } catch (error) {
    if (!lifecycle.canStartFresh) throw error;
  }
  if (options?.allowFreshStart === false || !lifecycle.canStartFresh) throw new Error(lifecycle.reason || `Work agent ${agentId} cannot be resumed or started for merge preparation.`);
  const state = await spawnAgent({ issueId, workspace: workspacePath, role: 'work', prompt: rebaseMsg });
  return { recovered: true, agentId, detail: `Started fresh work agent ${state.id} and sent merge preparation request.` };
}
