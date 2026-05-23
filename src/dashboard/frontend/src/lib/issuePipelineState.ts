import type { ReviewStatus, WorkspaceInfo } from './workspace-types';
import type { Agent, WorkAgentLifecycle } from '../types';

export type PipelineReviewStatus = Pick<Partial<ReviewStatus>, 'reviewStatus' | 'testStatus' | 'mergeStatus' | 'verificationStatus' | 'readyForMerge'>;

export interface PipelineStateInput {
  reviewStatus?: PipelineReviewStatus | null;
  agent?: Pick<Agent, 'status' | 'role' | 'agentPhase' | 'git'> | null;
  lifecycle?: Pick<WorkAgentLifecycle, 'canResumeSession'> | null;
  workspace?: Pick<WorkspaceInfo, 'exists'> | null;
  hasPlan: boolean;
  hasBeads: boolean;
  issueCanonicalState?: string | null;
  isMerged?: boolean;
}

export type PipelineState =
  | 'planning_active'
  | 'planning_done_awaiting_work'
  | 'in_progress_work_running'
  | 'in_progress_work_idle'
  | 'verification_failing'
  | 'in_review_reviewers_running'
  | 'in_review_changes_requested'
  | 'in_review_approved'
  | 'testing_running'
  | 'testing_failures'
  | 'ready_to_merge'
  | 'merging'
  | 'verifying'
  | 'merged'
  | 'done'
  | 'canceled'
  | 'generic';

export function normalizeCanonicalState(state?: string | null): string | null {
  if (!state) return null;
  return state.trim().toLowerCase().replace(/[-\s]+/g, '_');
}

export function isIssueAgentRunning(agent?: Pick<Agent, 'status'> | null): boolean {
  return !!agent && agent.status !== 'stopped' && agent.status !== 'failed' && agent.status !== 'dead';
}

export function derivePipelineState(input: PipelineStateInput): PipelineState {
  const { reviewStatus, agent } = input;
  const issueCanonicalState = normalizeCanonicalState(input.issueCanonicalState);
  const merged = input.isMerged === true || reviewStatus?.mergeStatus === 'merged';
  const verifying = issueCanonicalState === 'verifying_on_main' || issueCanonicalState === 'verifying';
  const agentRunning = isIssueAgentRunning(agent);

  if (issueCanonicalState === 'done') return 'done';
  if (issueCanonicalState === 'canceled') return 'canceled';
  if (verifying) return 'verifying';
  if (merged) return 'merged';
  if (reviewStatus?.mergeStatus === 'merging' || reviewStatus?.mergeStatus === 'verifying') return 'merging';
  if (reviewStatus?.readyForMerge) return 'ready_to_merge';
  if (reviewStatus?.reviewStatus === 'reviewing') return 'in_review_reviewers_running';
  if (reviewStatus?.reviewStatus === 'failed' || reviewStatus?.reviewStatus === 'blocked') return 'in_review_changes_requested';
  if (reviewStatus?.reviewStatus === 'passed') return 'in_review_approved';
  if (reviewStatus?.testStatus === 'testing') return 'testing_running';
  if (reviewStatus?.testStatus === 'failed' || reviewStatus?.testStatus === 'dispatch_failed') return 'testing_failures';
  if (reviewStatus?.verificationStatus === 'failed') return 'verification_failing';
  if (agentRunning && agent?.role === 'plan') return 'planning_active';
  if (!agentRunning && input.hasPlan && (issueCanonicalState === 'todo' || issueCanonicalState === 'backlog')) return 'planning_done_awaiting_work';
  if (agentRunning && issueCanonicalState === 'in_progress') return 'in_progress_work_running';
  if (!agentRunning && issueCanonicalState === 'in_progress') return 'in_progress_work_idle';
  return 'generic';
}
