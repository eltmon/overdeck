import type { Agent } from '../types';

type PipelineStateLike = {
  reviewStatus?: 'pending' | 'reviewing' | 'passed' | 'failed' | 'blocked';
  testStatus?: 'pending' | 'testing' | 'passed' | 'failed' | 'skipped' | 'dispatch_failed';
  mergeStatus?: 'pending' | 'queued' | 'merging' | 'verifying' | 'merged' | 'failed';
  inspectStatus?: 'pending' | 'inspecting' | 'passed' | 'failed';
  uatStatus?: 'pending' | 'testing' | 'passed' | 'failed';
  verificationStatus?: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  // PAN-794: persistent stuck flag + reason set by the deacon/breaker or main-diverged flow.
  stuck?: boolean;
  stuckReason?: string;
  reviewRetryCount?: number;
  // Operator-set patrol opt-out (distinct from system-set `stuck`).
  deaconIgnored?: boolean;
  deaconIgnoredAt?: string;
  deaconIgnoredReason?: string;
};

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

/**
 * Operator has paused Deacon patrol for this issue via the kanban "Pause"
 * button. Separate signal from any stuck reason — an issue can be paused
 * while also healthy, stuck, or actively in a failed state.
 */
export function isDeaconIgnored(status?: PipelineStateLike | null): boolean {
  return status?.deaconIgnored === true;
}
