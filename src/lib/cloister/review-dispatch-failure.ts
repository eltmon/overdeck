/**
 * PAN-4506. A review kickoff that the terminal backend rejected outright
 * (invalid_request) never started — there is no reviewer to recover, so this
 * is journaled as a dead end rather than a stall, and the operator is told
 * directly. Called from spawnReviewRoleForIssue's catch; must never throw,
 * or a dispatch-failure record would turn into a second failure.
 */
import { appendPipelineEntry } from './pipeline-journal.js';

export interface ReviewDispatchFailureInput {
  readonly issueId: string;
  readonly workspace: string;
  readonly reviewer: string;
  readonly error: string;
}

export async function recordReviewDispatchFailure(input: ReviewDispatchFailureInput): Promise<void> {
  const issueId = input.issueId.toUpperCase();
  try {
    appendPipelineEntry(input.workspace, {
      type: 'review.dispatch-failed',
      issueId,
      source: 'review-agent',
      data: { reviewer: input.reviewer, error: input.error },
    });
    const { surfaceIssueFeedbackNeedsYou } = await import('./feedback-target.js');
    await surfaceIssueFeedbackNeedsYou(issueId, `review kickoff rejected: ${input.error}`, {
      reviewer: input.reviewer,
      error: input.error,
    });
  } catch (err) {
    console.warn(`[review-dispatch-failure] Could not record dispatch failure for ${issueId}:`, err);
  }
}
