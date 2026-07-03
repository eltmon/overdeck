import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getAgentDir } from '../agents/agent-state.js';
import { getReviewStatusSync } from '../review-status.js';

export type BootReconciliationSkipReason = 'workspace_missing' | 'merged' | 'completed';

interface BootReconciliationAgent {
  id: string;
  issueId: string;
  workspace?: string | null;
  merged?: boolean;
}

export function bootReconciliationSkipReason(agent: BootReconciliationAgent): BootReconciliationSkipReason | null {
  if (!agent.workspace || !existsSync(agent.workspace)) return 'workspace_missing';

  const review = getReviewStatusSync(agent.issueId);
  if (
    review?.mergeStatus === 'merged' ||
    agent.merged === true ||
    (review?.readyForMerge === true && review.reviewStatus === 'passed' && review.testStatus === 'passed')
  ) {
    return 'merged';
  }

  const completedMarkerExists =
    existsSync(join(getAgentDir(agent.id), 'completed')) ||
    existsSync(join(getAgentDir(agent.id), 'completed.processed'));
  if (
    completedMarkerExists &&
    review?.reviewStatus === 'passed' &&
    review.testStatus === 'passed'
  ) {
    return 'completed';
  }

  return null;
}
