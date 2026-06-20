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
 *  - it is newer than the last spawn (or there was never a spawn) — i.e. a genuinely un-serviced
 *    request, not the request that produced the current review, AND
 *  - a review is not already in progress (`reviewing`), AND
 *  - the issue is not already merged.
 */
export function needsReviewDispatch(params: {
  reviewRequestedAt?: string;
  reviewSpawnedAt?: string;
  reviewStatus?: string;
  mergeStatus?: string;
}): boolean {
  if (!params.reviewRequestedAt) return false;
  if (params.reviewStatus === 'reviewing') return false;
  if (params.mergeStatus === 'merged') return false;
  return !params.reviewSpawnedAt || params.reviewRequestedAt > params.reviewSpawnedAt;
}
