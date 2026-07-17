import { Effect } from 'effect';

import { getAgentState, messageAgent, spawnAgent } from '../../../../lib/agents.js';
import { getWorkAgentLifecycleStateSync } from '../../../../lib/work-agent-lifecycle.js';
import type { ReviewStatus } from '../../../../lib/review-status.js';

export interface StrikeMergeRequest {
  kind: 'strike'; markerHead: string; workspacePath: string; branchName: string; recoveryTarget: string;
}
export type TriggerMergeRequest = { kind: 'normal' } | StrikeMergeRequest;

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

export function mergeCompletionStatus(request: TriggerMergeRequest): Pick<ReviewStatus, 'strikeLandingState' | 'strikeReadyHead' | 'strikeReadyAt'> | Record<string, never> {
  return request.kind === 'strike' ? { strikeLandingState: 'landed', strikeReadyHead: undefined, strikeReadyAt: undefined } : {};
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

export async function ensureAgentReadyForMerge(issueId: string, workspacePath: string, rebaseMsg: string, options?: { agentId?: string; allowFreshStart?: boolean }): Promise<{ recovered: boolean; agentId: string; detail: string }> {
  const agentId = options?.agentId ?? `agent-${issueId.toLowerCase()}`;
  const lifecycle = getWorkAgentLifecycleStateSync(agentId);
  if (lifecycle.hasLiveTmuxSession) {
    await messageAgent(agentId, rebaseMsg);
    return { recovered: true, agentId, detail: 'Work agent already running; sent merge preparation request.' };
  }
  const agentState = await Effect.runPromise(getAgentState(agentId));
  if (agentState) try {
    await messageAgent(agentId, rebaseMsg);
    const updatedLifecycle = getWorkAgentLifecycleStateSync(agentId);
    return { recovered: true, agentId, detail: updatedLifecycle.canResumeSession ? 'Resumed work agent and sent merge preparation request.' : 'Restarted work agent and sent merge preparation request.' };
  } catch (error) {
    if (!lifecycle.canStartFresh) throw error;
  }
  if (options?.allowFreshStart === false || !lifecycle.canStartFresh) throw new Error(lifecycle.reason || `Work agent ${agentId} cannot be resumed or started for merge preparation.`);
  const state = await spawnAgent({ issueId, workspace: workspacePath, role: 'work', prompt: rebaseMsg });
  return { recovered: true, agentId, detail: `Started fresh work agent ${state.id} and sent merge preparation request.` };
}
