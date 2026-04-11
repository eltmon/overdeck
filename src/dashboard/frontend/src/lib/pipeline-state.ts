import type { Agent } from '../types';

type PipelineStateLike = {
  reviewStatus?: 'pending' | 'reviewing' | 'passed' | 'failed' | 'blocked';
  testStatus?: 'pending' | 'testing' | 'passed' | 'failed' | 'skipped' | 'dispatch_failed';
  mergeStatus?: 'pending' | 'queued' | 'merging' | 'verifying' | 'merged' | 'failed';
  inspectStatus?: 'pending' | 'inspecting' | 'passed' | 'failed';
  uatStatus?: 'pending' | 'testing' | 'passed' | 'failed';
  verificationStatus?: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
};

export function hasActualPendingQuestion(agent?: Pick<Agent, 'hasPendingQuestion' | 'pendingQuestionCount'> | null): boolean {
  return agent?.hasPendingQuestion === true && (agent.pendingQuestionCount ?? 0) > 0;
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
