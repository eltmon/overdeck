/**
 * PAN-1988 auto-heal — decide whether a review needs to be (re-)dispatched from the durable
 * journal intent, as a PURE function so it is locked by tests.
 *
 * The work agent's `pan done` writes a durable `reviewRequestedAt` into the journal/record (always
 * writable, even sandboxed) BEFORE it tries to reach the dashboard. If that reactive trigger is
 * dropped — the dashboard was mid-reload, the network blipped, the deacon is frozen — the intent
 * survives in the journal. The host reconciles on read: when a request is newer than the last
 * dispatch and nothing is currently reviewing, it dispatches review. This heals with NO deacon and
 * NO live dashboard event, on the next status read.
 *
 * Returns true when a review dispatch is owed:
 *  - a request exists (`reviewRequestedAt` set), AND
 *  - the request is no more than seven days old, AND
 *  - it is newer than the last spawn (or there was never a spawn) — i.e. a genuinely un-serviced
 *    request, not the request that produced the current review, AND
 *  - review is pending rather than already reviewing or terminal, AND
 *  - the issue is not already ready to merge or merged.
 *
 * Genuine re-review paths reset `reviewStatus` to `pending` before recording a fresh request: `pan
 * done` does this for a new commit, and the operator force-review route does it explicitly.
 */
export const REVIEW_REQUEST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function isReviewRequestStale(params: {
  reviewRequestedAt?: string;
  now?: number;
  maxAgeMs?: number;
}): boolean {
  if (!params.reviewRequestedAt) return false;
  const now = params.now ?? Date.now();
  const maxAgeMs = params.maxAgeMs ?? REVIEW_REQUEST_MAX_AGE_MS;
  return now - Date.parse(params.reviewRequestedAt) > maxAgeMs;
}

export function needsReviewDispatch(params: {
  reviewRequestedAt?: string;
  reviewSpawnedAt?: string | number;
  reviewStatus?: string;
  mergeStatus?: string;
  readyForMerge?: boolean;
  now?: number;
  maxRequestAgeMs?: number;
}): boolean {
  if (!params.reviewRequestedAt) return false;
  if (isReviewRequestStale({
    reviewRequestedAt: params.reviewRequestedAt,
    now: params.now,
    maxAgeMs: params.maxRequestAgeMs,
  })) return false;
  if (params.reviewStatus === 'reviewing') return false;
  if (params.reviewStatus === 'passed' || params.reviewStatus === 'skipped') return false;
  if (params.readyForMerge) return false;
  if (params.mergeStatus === 'merged') return false;
  return !params.reviewSpawnedAt || Date.parse(params.reviewRequestedAt) > new Date(params.reviewSpawnedAt).getTime();
}
