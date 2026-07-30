/**
 * Titles for issues that have aged out of the tracker sync window.
 *
 * The resource tree surfaces any issue that still owns local resources
 * (workspaces, agent sessions, records, planning artifacts) — including
 * issues closed long ago, which the shared issue service no longer syncs.
 * Without a tracker row, discovery falls back to the bare identifier as the
 * row title, so the tree renders "MIN-852 — MIN-852" (PAN-3337).
 *
 * Resolve those titles per issue on demand through the tracker's own
 * getIssue door. Successes are memoized for the process lifetime (titles of
 * closed issues do not churn); failures are memoized briefly so a broken or
 * unconfigured tracker cannot be hammered by the discovery refresh loop.
 */

import { Effect } from 'effect';

import { resolveTrackerTypeSync } from '../../../lib/tracker-utils.js';
import { createTracker } from '../../../lib/tracker/factory.js';

const FAILURE_RETRY_MS = 10 * 60 * 1000;
const LOOKUP_TIMEOUT = '10 seconds';
/** Per-pass cap so one discovery pass cannot fan out unbounded tracker calls. */
const MAX_LOOKUPS_PER_PASS = 8;

const resolvedTitles = new Map<string, string>();
const failedLookupsAt = new Map<string, number>();
const inFlight = new Map<string, Promise<string | null>>();

async function lookupTitle(issueId: string): Promise<string | null> {
  const trackerType = resolveTrackerTypeSync(issueId);
  if (!trackerType) return null;
  const tracker = createTracker({ type: trackerType });
  const issue = await Effect.runPromise(
    tracker.getIssue(issueId).pipe(Effect.timeout(LOOKUP_TIMEOUT)),
  );
  const title = issue.title?.trim();
  return title && title.toUpperCase() !== issueId.toUpperCase() ? title : null;
}

/**
 * Resolve titles for issues the tracker snapshot missed. Returns only the
 * identifiers that resolved to a real title (memoized or freshly fetched).
 */
export async function resolveMissingIssueTitles(
  issueIds: readonly string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const toFetch: string[] = [];
  const now = Date.now();

  for (const raw of issueIds) {
    const issueId = raw.toUpperCase();
    const memoized = resolvedTitles.get(issueId);
    if (memoized) {
      result.set(issueId, memoized);
      continue;
    }
    const failedAt = failedLookupsAt.get(issueId);
    if (failedAt !== undefined && now - failedAt < FAILURE_RETRY_MS) continue;
    if (toFetch.length < MAX_LOOKUPS_PER_PASS) toFetch.push(issueId);
  }

  await Promise.all(toFetch.map(async (issueId) => {
    let pending = inFlight.get(issueId);
    if (!pending) {
      pending = lookupTitle(issueId)
        .catch(() => null)
        .finally(() => inFlight.delete(issueId));
      inFlight.set(issueId, pending);
    }
    const title = await pending;
    if (title) {
      resolvedTitles.set(issueId, title);
      failedLookupsAt.delete(issueId);
      result.set(issueId, title);
    } else {
      failedLookupsAt.set(issueId, Date.now());
    }
  }));

  return result;
}
