import {
  clearWorkspaceStuck,
  FEEDBACK_DELIVERY_STUCK_REASON,
  loadReviewStatuses,
} from '../review-status.js';

/**
 * Retire feedback-delivery stuck flags whose triggering condition can no longer
 * block progress. Successful feedback delivery clears the flag at the delivery
 * site; this patrol safety net handles rows that became terminal without another
 * delivery attempt.
 */
export function retireResolvedFeedbackDeliveryStuckFlags(): string[] {
  const actions: string[] = [];
  for (const status of Object.values(loadReviewStatuses())) {
    if (
      status.stuck === true
      && status.stuckReason === FEEDBACK_DELIVERY_STUCK_REASON
      && status.mergeStatus === 'merged'
    ) {
      clearWorkspaceStuck(status.issueId);
      actions.push(`Retired stale feedback-delivery stuck flag for ${status.issueId}: issue is merged`);
    }
  }
  return actions;
}
