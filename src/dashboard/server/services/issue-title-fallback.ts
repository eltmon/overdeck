/**
 * Fallback resolution for issues that have aged out of the tracker sync
 * window.
 *
 * The resource tree surfaces any issue that still owns local resources
 * (workspaces, agent sessions, records, planning artifacts) — including
 * issues closed long ago, which the shared issue service no longer syncs.
 * Without a tracker row, discovery falls back to the bare identifier as the
 * row title, so the tree renders "MIN-852 — MIN-852" (PAN-3337). The issue
 * view (drawer/cockpit) has the same hole: its header reads the read-model
 * issue list, which drops closed issues older than `closedWindowDays`, so
 * the header falls back to "Issue details" (PAN-3659).
 *
 * Resolve those issues per issue on demand through the tracker's own
 * getIssue door. Successes are memoized for the process lifetime (rows of
 * closed issues do not churn); failures are memoized briefly so a broken or
 * unconfigured tracker cannot be hammered by the discovery refresh loop.
 */

import { Effect } from 'effect';

import { resolveGitHubIssueSync, resolveTrackerTypeSync } from '../../../lib/tracker-utils.js';
import { createTracker } from '../../../lib/tracker/factory.js';
import type { Issue, IssueTracker } from '../../../lib/tracker/interface.js';

const FAILURE_RETRY_MS = 10 * 60 * 1000;
const LOOKUP_TIMEOUT = '10 seconds';
/** Per-pass cap so one discovery pass cannot fan out unbounded tracker calls. */
const MAX_LOOKUPS_PER_PASS = 8;

const resolvedIssues = new Map<string, Issue>();
const failedLookupsAt = new Map<string, number>();
const inFlight = new Map<string, Promise<Issue | null>>();

/**
 * Build a tracker bound to the repo/project the issue belongs to.
 * createTracker({ type }) alone is not enough for trackers whose config is
 * per-repo: GitHub needs owner/repo (resolved from the issue prefix), and
 * without them the factory throws — which silently broke this fallback for
 * every GitHub-tracked issue (PAN-3659).
 */
function trackerForIssue(issueId: string): IssueTracker | null {
  const trackerType = resolveTrackerTypeSync(issueId);
  if (!trackerType) return null;
  if (trackerType === 'github') {
    const resolution = resolveGitHubIssueSync(issueId);
    if (!resolution.isGitHub) return null;
    return createTracker({ type: 'github', owner: resolution.owner, repo: resolution.repo });
  }
  return createTracker({ type: trackerType });
}

async function lookupIssue(issueId: string): Promise<Issue | null> {
  const tracker = trackerForIssue(issueId);
  if (!tracker) return null;
  return Effect.runPromise(
    tracker.getIssue(issueId).pipe(Effect.timeout(LOOKUP_TIMEOUT)),
  );
}

/**
 * Resolve one issue through its tracker door, memoized: successes for the
 * process lifetime, failures for FAILURE_RETRY_MS, concurrent callers share
 * one in-flight request. Returns null when the issue cannot be resolved.
 */
export async function resolveMissingIssue(issueId: string): Promise<Issue | null> {
  const key = issueId.toUpperCase();
  const memoized = resolvedIssues.get(key);
  if (memoized) return memoized;
  const failedAt = failedLookupsAt.get(key);
  if (failedAt !== undefined && Date.now() - failedAt < FAILURE_RETRY_MS) return null;

  let pending = inFlight.get(key);
  if (!pending) {
    pending = lookupIssue(key)
      .catch(() => null)
      .finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  const issue = await pending;
  if (issue) {
    resolvedIssues.set(key, issue);
    failedLookupsAt.delete(key);
    return issue;
  }
  failedLookupsAt.set(key, Date.now());
  return null;
}

function usableTitle(issue: Issue, issueId: string): string | null {
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
    const memoized = resolvedIssues.get(issueId);
    if (memoized) {
      const title = usableTitle(memoized, issueId);
      if (title) result.set(issueId, title);
      continue;
    }
    const failedAt = failedLookupsAt.get(issueId);
    if (failedAt !== undefined && now - failedAt < FAILURE_RETRY_MS) continue;
    if (toFetch.length < MAX_LOOKUPS_PER_PASS) toFetch.push(issueId);
  }

  await Promise.all(toFetch.map(async (issueId) => {
    const issue = await resolveMissingIssue(issueId);
    const title = issue ? usableTitle(issue, issueId) : null;
    if (title) result.set(issueId, title);
  }));

  return result;
}
