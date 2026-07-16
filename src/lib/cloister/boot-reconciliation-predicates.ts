import { existsSync } from 'fs';
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

  // Must mirror handleAgentStoppedEvent's mid-flight gate in deacon-auto-resume.ts:
  // a handed-off agent is resumable only when review or test found something to fix.
  // Any weaker rule here makes the boot dialog offer candidates the executor then
  // refuses, so the operator is asked a question whose answer is already decided.
  const completedMarkerExists =
    existsSync(join(getAgentDir(agent.id), 'completed')) ||
    existsSync(join(getAgentDir(agent.id), 'completed.processed'));
  if (completedMarkerExists) {
    const needsFix =
      review?.reviewStatus === 'blocked' ||
      review?.reviewStatus === 'failed' ||
      review?.testStatus === 'failed';
    if (!needsFix) return 'completed';
  }

  return null;
}
