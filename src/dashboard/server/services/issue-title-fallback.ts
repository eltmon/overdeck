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
 * closed issues do not churn); failures are memoized briefly, with their
 * kind (not-found vs unavailable), so a broken or unconfigured tracker
 * cannot be hammered by the discovery refresh loop, and so the per-issue
 * route (PAN-5171) can tell a real 404 from a tracker outage.
 */

import { Effect } from 'effect';

import { resolveGitHubIssue, resolveTrackerType } from '../../../lib/tracker-utils.js';
import { createJiraTrackerForIssue, createTracker } from '../../../lib/tracker/factory.js';
import type { Issue, IssueTracker } from '../../../lib/tracker/interface.js';

const FAILURE_RETRY_MS = 10 * 60 * 1000;
const LOOKUP_TIMEOUT = '10 seconds';
/** Per-pass cap so one discovery pass cannot fan out unbounded tracker calls. */
const MAX_LOOKUPS_PER_PASS = 8;

export type IssueLookupFailure = 'not-found' | 'unavailable';
type LookupResult = { kind: 'found'; issue: Issue } | { kind: IssueLookupFailure };

const resolvedIssues = new Map<string, Issue>();
const failedLookups = new Map<string, { at: number; kind: IssueLookupFailure }>();
const inFlight = new Map<string, Promise<LookupResult>>();

/**
 * Build a tracker bound to the repo/project the issue belongs to.
 * createTracker({ type }) alone is not enough for trackers whose config is
 * per-repo: GitHub needs owner/repo (resolved from the issue prefix), and
 * without them the factory throws — which silently broke this fallback for
 * every GitHub-tracked issue (PAN-3659).
 */
function trackerForIssue(issueId: string): IssueTracker | null {
  const trackerType = resolveTrackerType(issueId);
  if (!trackerType) return null;
  if (trackerType === 'github') {
    const resolution = resolveGitHubIssue(issueId);
    if (!resolution.isGitHub) return null;
    return createTracker({ type: 'github', owner: resolution.owner, repo: resolution.repo });
  }
  // PAN-5152: a Jira tracker is bound to the issue's project (key, site, status map).
  if (trackerType === 'jira') return createJiraTrackerForIssue(issueId);
  return createTracker({ type: trackerType });
}

async function lookupIssue(issueId: string): Promise<LookupResult> {
  const tracker = trackerForIssue(issueId);
  if (!tracker) return { kind: 'unavailable' };
  return Effect.runPromise(
    tracker.getIssue(issueId).pipe(
      Effect.timeout(LOOKUP_TIMEOUT),
      Effect.map((issue): LookupResult => ({ kind: 'found', issue })),
      Effect.catchTag('IssueNotFoundError', () => Effect.succeed<LookupResult>({ kind: 'not-found' })),
      Effect.catch(() => Effect.succeed<LookupResult>({ kind: 'unavailable' })),
    ),
  );
}

/**
 * Resolve one issue through its tracker door, memoized: successes for the
 * process lifetime, failures for FAILURE_RETRY_MS, concurrent callers share
 * one in-flight request. Returns null when the issue cannot be resolved —
 * use `missingIssueFailureKind` to tell a 404 from a tracker outage.
 */
export async function resolveMissingIssue(issueId: string): Promise<Issue | null> {
  const key = issueId.toUpperCase();
  const memoized = resolvedIssues.get(key);
  if (memoized) return memoized;
  const failedAt = failedLookups.get(key)?.at;
  if (failedAt !== undefined && Date.now() - failedAt < FAILURE_RETRY_MS) return null;

  let pending = inFlight.get(key);
  if (!pending) {
    pending = lookupIssue(key)
      .catch((): LookupResult => ({ kind: 'unavailable' }))
      .finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  const result = await pending;
  if (result.kind === 'found') {
    resolvedIssues.set(key, result.issue);
    failedLookups.delete(key);
    return result.issue;
  }
  failedLookups.set(key, { at: Date.now(), kind: result.kind });
  return null;
}

/** The memoized failure kind for an issue the tracker door could not resolve, or null when none is fresh. */
export function missingIssueFailureKind(issueId: string): IssueLookupFailure | null {
  const failed = failedLookups.get(issueId.toUpperCase());
  return failed && Date.now() - failed.at < FAILURE_RETRY_MS ? failed.kind : null;
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
    const failedAt = failedLookups.get(issueId)?.at;
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
