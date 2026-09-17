import { getProjectConfigFromWorkspacePath, resolveProjectForIssue } from '../../lib/pan-dir/record.js';
import { updateIssueRecord } from '../../lib/pan-dir/record-update.js';
import { STATE_GIT_LOCK_RETRY_DELAYS_MS } from '../../lib/pan-dir/state-git-lock.js';
import type { ScopeDriftRecord } from '../../lib/xbrief/continue-state.js';
import { capturePipelineStageForIssue } from '../../lib/telemetry/pipeline.js';

export interface DoneReviewIntent {
  reviewRequestedAt: string;
  scopeDrift?: ScopeDriftRecord;
  prUrl?: string;
}

/**
 * PAN-3848 (W25, FR-20): `pan done` writes its review request in ONE record
 * write — prUrl, reviewRequestedAt, completedAt, and the reviewStaleSince
 * clear land in a single mutator — retried up to three times on the state
 * lock's own backoff ladder. If every attempt throws, the caller writes the
 * completion marker anyway (the branch is pushed and the PR exists, so the
 * work is real) and records a `review-request-unrecorded` needs-you: a pushed
 * PR with no review request is never silent.
 */
export async function persistDoneReviewIntent(
  issueId: string,
  workspacePath: string,
  intent: DoneReviewIntent,
): Promise<void> {
  const project = resolveProjectForIssue(issueId) ?? getProjectConfigFromWorkspacePath(workspacePath);
  const maxRetries = 3;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      await updateIssueRecord(project, issueId, (record) => {
        record.pipeline = {
          ...record.pipeline,
          reviewStatus: 'pending',
          testStatus: 'pending',
          mergeStatus: 'pending',
          verificationStatus: 'pending',
          readyForMerge: false,
          reviewRequestedAt: intent.reviewRequestedAt,
          completedAt: intent.reviewRequestedAt,
          reviewStaleSince: undefined,
          scopeDrift: intent.scopeDrift,
          prUrl: intent.prUrl ?? record.pipeline.prUrl,
          updatedAt: intent.reviewRequestedAt,
        };
      });
      void capturePipelineStageForIssue(issueId, 'work_done');
      return;
    } catch (error) {
      lastError = error;
      const delay = STATE_GIT_LOCK_RETRY_DELAYS_MS[attempt];
      if (delay === undefined || attempt === maxRetries) break;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
