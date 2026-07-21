import { getProjectConfigFromWorkspacePath, resolveProjectForIssue } from '../../lib/pan-dir/record.js';
import { updateIssueRecord } from '../../lib/pan-dir/record-update.js';
import type { ScopeDriftRecord } from '../../lib/xbrief/continue-state.js';

export interface DoneReviewIntent {
  reviewRequestedAt: string;
  scopeDrift?: ScopeDriftRecord;
  prUrl?: string;
}

export async function persistDoneReviewIntent(
  issueId: string,
  workspacePath: string,
  intent: DoneReviewIntent,
): Promise<void> {
  const project = resolveProjectForIssue(issueId) ?? getProjectConfigFromWorkspacePath(workspacePath);
  await updateIssueRecord(project, issueId, (record) => {
    record.pipeline = {
      ...record.pipeline,
      reviewStatus: 'pending',
      testStatus: 'pending',
      mergeStatus: 'pending',
      verificationStatus: 'pending',
      readyForMerge: false,
      reviewRequestedAt: intent.reviewRequestedAt,
      scopeDrift: intent.scopeDrift,
      prUrl: intent.prUrl ?? record.pipeline.prUrl,
      updatedAt: intent.reviewRequestedAt,
    };
  });
}
