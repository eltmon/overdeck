/**
 * PAN-3911 · what a dashboard Pause or Unpause actually did.
 *
 * Pausing an issue's work agent also stops its in-flight review and test
 * agents; unpausing re-requests that review through the guarded review route.
 * Either can fall short (a pane that would not close, a re-request the route
 * refused), and the route reports it in `warnings`. The toast says so instead
 * of a plain "paused" / "unpaused".
 */
import { toast } from 'sonner';

interface PauseRouteBody {
  warnings?: unknown;
}

interface UnpauseRouteBody extends PauseRouteBody {
  resumeTriggered?: boolean;
  restart?: {
    review?: { requested: boolean; noReviewNeeded?: boolean; reason?: string };
  };
}

export interface PauseOutcomeNotice {
  readonly level: 'success' | 'warning';
  readonly title: string;
  readonly description?: string;
}

function warningsOf(body: PauseRouteBody | undefined): string[] {
  return Array.isArray(body?.warnings) ? body.warnings.filter((line): line is string => typeof line === 'string') : [];
}

export function pauseOutcomeNotice(issueId: string, body: PauseRouteBody | undefined): PauseOutcomeNotice {
  const warnings = warningsOf(body);
  if (warnings.length > 0) {
    return { level: 'warning', title: `${issueId} paused, with problems`, description: warnings.join('\n') };
  }
  return { level: 'success', title: `${issueId} paused` };
}

export function unpauseOutcomeNotice(issueId: string, body: UnpauseRouteBody | undefined): PauseOutcomeNotice {
  // The route resumes immediately when a session exists — no more "deacon
  // resumes it on the next patrol" wait.
  const title = body?.resumeTriggered === true ? `${issueId} unpaused — resuming now` : `${issueId} unpaused`;
  const warnings = warningsOf(body);
  if (warnings.length > 0) return { level: 'warning', title, description: warnings.join('\n') };
  const review = body?.restart?.review;
  if (review?.requested === true) return { level: 'success', title, description: 'Review re-requested: the pause had stopped it.' };
  if (review?.noReviewNeeded === true && review.reason) {
    return { level: 'success', title, description: `No review re-requested: ${review.reason}` };
  }
  return { level: 'success', title };
}

export function toastPauseOutcome(notice: PauseOutcomeNotice): void {
  const options = notice.description ? { description: notice.description } : undefined;
  if (notice.level === 'warning') toast.warning(notice.title, options);
  else toast.success(notice.title, options);
}
