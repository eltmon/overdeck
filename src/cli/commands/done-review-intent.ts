import { getProjectConfigFromWorkspacePath, resolveProjectForIssue } from '../../lib/pan-dir/record.js';
import { updateIssueRecord } from '../../lib/pan-dir/record-update.js';
import type { ScopeDriftRecord } from '../../lib/xbrief/continue-state.js';
import { capturePipelineStageForIssue } from '../../lib/telemetry/pipeline.js';

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
      // PAN-3847 (FR-8): pan done is one of the two doors that clear the stale
      // marker — and only here, once the re-review intent is durable (PR #3872).
      reviewStaleSince: undefined,
      reviewRequestedAt: intent.reviewRequestedAt,
      scopeDrift: intent.scopeDrift,
      prUrl: intent.prUrl ?? record.pipeline.prUrl,
      updatedAt: intent.reviewRequestedAt,
    };
  });
  void capturePipelineStageForIssue(issueId, 'work_done');
}
