import { isDeepStrictEqual } from 'node:util';
import { Effect } from 'effect';
import { enrichReviewStatus } from '../../lib/review-status-enrichment.js';
import { getReviewStatusSync, type ReviewStatus } from '../../lib/review-status.js';

/** Minimal structural append — satisfied by both EventStore.append and the deacon event client. */
export type ReviewStatusEventAppend = (event: {
  type: 'review.status_changed';
  timestamp: string;
  payload: { issueId: string; status: unknown };
}) => void;

function canonicalStatus(status: ReviewStatus): Record<string, unknown> {
  const canonical = { ...status } as Record<string, unknown>;
  delete canonical.reviewCoordinatorSessionName;
  delete canonical.reviewSessionNames;
  delete canonical.reviewSubStatuses;
  return canonical;
}

export function emitReviewStatusChanged(
  append: ReviewStatusEventAppend,
  issueId: string,
  status: ReviewStatus,
): void {
  // PAN-2988 — durable append first, unenriched. A status transition must never
  // be lost because tmux was slow; reviewSessionNames are TerminalTabs sugar only.
  append({
    type: 'review.status_changed',
    timestamp: new Date().toISOString(),
    payload: { issueId, status },
  });

  // Best-effort enrichment patch. Skip it when enrichment fails or times out,
  // produces no sugar, or a newer transition lands while enrichment is running.
  void (async () => {
    const enriched = await Effect.runPromise(
      enrichReviewStatus(issueId, status).pipe(
        Effect.timeout('5 seconds'),
        Effect.catch(() => Effect.succeed(null)),
      ),
    );
    if (!enriched) {
      console.warn(
        `[pipeline] review-status enrichment timed out or failed for ${issueId}; unenriched event already appended`,
      );
      return;
    }

    const hasSugar =
      (enriched.reviewSessionNames?.length ?? 0) > 0 ||
      !!enriched.reviewCoordinatorSessionName ||
      !!enriched.reviewSubStatuses;
    if (!hasSugar) return;

    const current = getReviewStatusSync(issueId);
    if (!current || !isDeepStrictEqual(canonicalStatus(current), canonicalStatus(status))) return;

    append({
      type: 'review.status_changed',
      timestamp: new Date().toISOString(),
      payload: { issueId, status: enriched },
    });
  })().catch((err) => {
    console.warn(`[pipeline] review-status enrichment patch failed for ${issueId}:`, err);
  });
}
