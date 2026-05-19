import type { Agent, Issue } from '../types';

export type PipelineIssuePhase = 'ship' | 'review' | 'work' | 'plan' | 'todo';

type PipelineStateLike = {
  reviewStatus?: 'pending' | 'reviewing' | 'passed' | 'failed' | 'blocked';
  testStatus?: 'pending' | 'testing' | 'passed' | 'failed' | 'skipped' | 'dispatch_failed';
  mergeStatus?: 'pending' | 'queued' | 'merging' | 'verifying' | 'merged' | 'failed';
  inspectStatus?: 'pending' | 'inspecting' | 'passed' | 'failed';
  uatStatus?: 'pending' | 'testing' | 'passed' | 'failed';
  verificationStatus?: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  updatedAt?: string;
  reviewSpawnedAt?: string;
  readyForMerge?: boolean;
  queuePosition?: number | null;
  activeSpecialist?: string | null;
  // PAN-794: persistent stuck flag + reason set by the deacon/breaker or main-diverged flow.
  stuck?: boolean;
  stuckReason?: string;
  reviewRetryCount?: number;
  // Operator-set patrol opt-out (distinct from system-set `stuck`).
  deaconIgnored?: boolean;
  deaconIgnoredAt?: string;
  deaconIgnoredReason?: string;
};

// Keep in sync with the review coordinator's longest specialist timeout.
export const REVIEW_SPECIALIST_TIMEOUT_MS = 30 * 60 * 1000;
export const PENDING_REVIEW_STRANDED_MS = REVIEW_SPECIALIST_TIMEOUT_MS * 2;

export function hasActualPendingQuestion(agent?: Pick<Agent, 'hasPendingQuestion' | 'pendingQuestionCount' | 'pendingQuestionPrompt'> | null): boolean {
  return agent?.hasPendingQuestion === true && ((agent.pendingQuestionCount ?? 0) > 0 || !!agent.pendingQuestionPrompt?.trim());
}

export function getPendingQuestionTitle(agent?: Pick<Agent, 'pendingQuestionCount' | 'pendingQuestionPrompt' | 'pendingQuestionReason'> | null): string {
  const prompt = agent?.pendingQuestionPrompt?.trim();
  if (prompt) {
    const firstLine = prompt.split('\n').find((line) => line.trim().length > 0)?.trim() ?? prompt;
    const prefix = agent?.pendingQuestionReason === 'tool_permission'
      ? 'Permission prompt'
      : agent?.pendingQuestionReason === 'planning_done'
        ? 'Planning complete'
        : agent?.pendingQuestionReason === 'confirmation'
          ? 'Confirmation prompt'
          : 'Awaiting input';
    return `${prefix}: ${firstLine}`;
  }
  const count = agent?.pendingQuestionCount || 1;
  return `Agent is waiting for user input (${count} question${count > 1 ? 's' : ''})`;
}

export function isReviewPipelineStuck(status?: PipelineStateLike | null): boolean {
  if (!status) return false;

  return (
    status.mergeStatus === 'failed' ||
    status.reviewStatus === 'failed' ||
    status.reviewStatus === 'blocked' ||
    status.testStatus === 'failed' ||
    status.testStatus === 'dispatch_failed' ||
    status.inspectStatus === 'failed' ||
    status.uatStatus === 'failed' ||
    status.verificationStatus === 'failed'
  );
}

/**
 * PAN-794: the breaker tripped on this issue — it is parked in stuck state
 * waiting for a human to click "Retry review" (unstick). Distinct from
 * `isReviewPipelineStuck`, which reports transient failed statuses that the
 * pipeline can still recover from automatically.
 */
export function isReviewInfraStuck(status?: PipelineStateLike | null): boolean {
  return status?.stuck === true && status.stuckReason === 'review_infrastructure_failure';
}

export function isAgentRunningStatus(status?: Agent['status'] | null): boolean {
  return status === 'running' || status === 'starting' || status === 'healthy' || status === 'warning';
}

export function isAgentProblemStatus(status?: Agent['status'] | null): boolean {
  return status === 'stuck' || status === 'failed' || status === 'error' || status === 'unknown';
}

/**
 * PAN-1034: a pending review with no active queue/specialist for more than 2x
 * the longest specialist timeout is stranded. This is distinct from a fresh
 * pending state while dispatch/verification is still starting up.
 */
export function isPendingReviewStranded(status?: PipelineStateLike | null, now = Date.now()): boolean {
  if (!status) return false;
  if (status.reviewStatus !== 'pending') return false;
  if (status.stuck) return false;
  if (status.readyForMerge) return false;
  if (status.queuePosition != null || status.activeSpecialist) return false;

  const reference = status.reviewSpawnedAt ?? status.updatedAt;
  if (!reference) return false;

  const referenceMs = Date.parse(reference);
  if (!Number.isFinite(referenceMs)) return false;

  return now - referenceMs >= PENDING_REVIEW_STRANDED_MS;
}

/**
 * Operator has paused Deacon patrol for this issue via the kanban "Pause"
 * button. Separate signal from any stuck reason — an issue can be paused
 * while also healthy, stuck, or actively in a failed state.
 */
export function isDeaconIgnored(status?: PipelineStateLike | null): boolean {
  return status?.deaconIgnored === true;
}

export function getPipelineIssuePhase(
  issue: Pick<Issue, 'state' | 'status' | 'stateType' | 'hasPlan' | 'planningComplete' | 'mergeStatus'>,
  reviewStatus?: PipelineStateLike | null,
  agent?: Pick<Agent, 'role' | 'status' | 'hasPendingQuestion' | 'pendingQuestionCount' | 'pendingQuestionPrompt'> | null,
): PipelineIssuePhase {
  const state = issue.state ?? issue.status;
  if (state === 'done' || state === 'closed' || state === 'completed') {
    return 'ship';
  }

  if (
    issue.mergeStatus === 'queued' ||
    issue.mergeStatus === 'merging' ||
    issue.mergeStatus === 'verifying' ||
    issue.mergeStatus === 'failed' ||
    issue.mergeStatus === 'merged' ||
    reviewStatus?.readyForMerge === true ||
    reviewStatus?.mergeStatus === 'queued' ||
    reviewStatus?.mergeStatus === 'merging' ||
    reviewStatus?.mergeStatus === 'verifying' ||
    reviewStatus?.mergeStatus === 'failed' ||
    reviewStatus?.mergeStatus === 'merged'
  ) {
    return 'ship';
  }

  if (
    reviewStatus?.reviewStatus === 'reviewing' ||
    reviewStatus?.reviewStatus === 'passed' ||
    reviewStatus?.reviewStatus === 'failed' ||
    reviewStatus?.reviewStatus === 'blocked' ||
    reviewStatus?.testStatus === 'testing' ||
    reviewStatus?.testStatus === 'passed' ||
    reviewStatus?.testStatus === 'failed' ||
    reviewStatus?.verificationStatus === 'running' ||
    reviewStatus?.verificationStatus === 'passed' ||
    reviewStatus?.verificationStatus === 'failed' ||
    reviewStatus?.inspectStatus === 'inspecting' ||
    reviewStatus?.inspectStatus === 'passed' ||
    reviewStatus?.inspectStatus === 'failed'
  ) {
    return 'review';
  }

  if (agent?.role === 'plan' && isAgentRunningStatus(agent.status)) {
    return 'plan';
  }

  if (agent?.role === 'work' && isAgentRunningStatus(agent.status)) {
    return 'work';
  }

  const derivedState = issue.state ?? issue.status;
  if (derivedState === 'in_review') return 'review';
  if (derivedState === 'in_progress' || issue.stateType === 'started') return 'work';
  if (issue.hasPlan === true || issue.planningComplete === true) return 'plan';
  return 'todo';
}
