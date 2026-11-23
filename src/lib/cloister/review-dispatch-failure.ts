/**
 * PAN-4506. A review kickoff that the terminal backend rejected outright
 * (invalid_request) never started — there is no reviewer to recover, so this
 * is journaled as a dead end rather than a stall, and the operator is told
 * directly. Called from spawnReviewRoleForIssue's catch; must never throw,
 * or a dispatch-failure record would turn into a second failure.
 */
import { appendPipelineEntry, readPipelineJournal } from './pipeline-journal.js';

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

/** PAN-5619: the journal source of a review-request pipeline failure. */
export const REVIEW_PIPELINE_FAILURE_SOURCE = 'request-review';

/**
 * PAN-5619. The review-request pipeline (verify → push → dispatch) runs in the
 * background, and a throw from it used to reach only the dashboard log. It is
 * journalled as `review.dispatch-failed` (source `request-review`) with the
 * error and the head it failed at, so `pan show` reports it and deacon-lite
 * stops re-requesting a review that fails the same way every time
 * (`isRepeatedPipelineFailure`). Returns the error text for the caller's own
 * report. Never throws.
 */
export function recordReviewPipelineFailure(issueId: string, workspacePath: string, error: unknown): string {
  const detail = (error instanceof Error ? error.message : '') || String(error);
  const canonicalIssueId = issueId.toUpperCase();
  console.error(`[request-review] Background pipeline failed for ${canonicalIssueId}: ${detail}`);
  void (async () => {
    try {
      const { readPrimaryHead8 } = await import('./verified-head.js');
      const head = await readPrimaryHead8(canonicalIssueId, workspacePath).catch(() => undefined);
      const entry = {
        type: 'review.dispatch-failed' as const,
        issueId: canonicalIssueId,
        source: REVIEW_PIPELINE_FAILURE_SOURCE,
        data: { reviewer: 'review', error: detail, ...(head ? { head } : {}) },
      };
      const repeated = isRepeatedPipelineFailure(readPipelineJournal(workspacePath), entry);
      appendPipelineEntry(workspacePath, entry);
      if (repeated) {
        const { surfaceIssueFeedbackNeedsYou } = await import('./feedback-target.js');
        await surfaceIssueFeedbackNeedsYou(
          canonicalIssueId,
          `review dispatch failed twice with the same error${head ? ` at ${head}` : ''}; it is not retried until review is requested again: ${detail}`,
          { error: detail, ...(head ? { head } : {}) },
        );
      }
    } catch (err) {
      console.warn(`[review-dispatch-failure] Could not record pipeline failure for ${canonicalIssueId}:`, err);
    }
  })();
  return detail;
}

type FailureEntry = { type: string; source?: string; data?: Record<string, unknown> };

/**
 * True when `failure` repeats the previous review-pipeline failure in
 * `entries`: the same error at the same head. deacon-lite re-requests a
 * failed review once, so a transient failure (a network error on the push, a
 * forge 5xx) gets another try, and stops when the retry fails identically.
 * A dispatch that launched reviewers in between starts the comparison over;
 * a request-route re-request does not. `failure` is
 * either not in `entries` yet, or is the very object from `entries` (compared
 * by identity, so it is never compared with itself).
 */
export function isRepeatedPipelineFailure(entries: readonly FailureEntry[], failure: FailureEntry): boolean {
  let previous: FailureEntry | undefined;
  for (const entry of entries) {
    if (entry === failure) break;
    // Only a run that launched reviewers starts over. A request-route
    // re-request (`via: 'request-review'`) launched nothing by itself.
    if (entry.type === 'review.dispatched'
      || (entry.type === 'review.redispatched' && entry.data?.['via'] !== 'request-review')) previous = undefined;
    if (entry.type === 'review.dispatch-failed' && entry.source === REVIEW_PIPELINE_FAILURE_SOURCE) previous = entry;
  }
  if (!previous) return false;
  return previous.data?.['error'] === failure.data?.['error'] && previous.data?.['head'] === failure.data?.['head'];
}
