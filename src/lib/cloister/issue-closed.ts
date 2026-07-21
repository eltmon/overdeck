import { execFile } from 'child_process';
import { promisify } from 'util';
import { Effect } from 'effect';

import { getShadowState } from '../shadow-state.js';
import { getLinearApiKey } from '../shadow-utils.js';
import {
  resolveGitHubIssueSync,
  resolveTrackerTypeSync,
} from '../tracker-utils.js';
import { getIssueState, isGitHubAppConfigured } from '../github-app.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { createTracker } from '../tracker/factory.js';
import { LinearTracker } from '../tracker/linear.js';
import type { IssueTracker } from '../tracker/interface.js';

const execFileAsync = promisify(execFile);
export const TRACKER_CLOSED_CACHE_TTL_MS = 5 * 60 * 1000;
const trackerClosedCache = new Map<string, { closed: boolean; checkedAt: number }>();

export function clearIssueClosedCache(issueId?: string): void {
  if (issueId) {
    trackerClosedCache.delete(issueId);
    return;
  }

  trackerClosedCache.clear();
}

export async function isTrackerIssueClosed(issueId: string): Promise<boolean> {
  const cached = trackerClosedCache.get(issueId);
  const now = Date.now();
  if (cached && now - cached.checkedAt < TRACKER_CLOSED_CACHE_TTL_MS) return cached.closed;

  const resolved = resolveGitHubIssueSync(issueId);
  if (!resolved.isGitHub) {
    const closed = await isLinearIssueClosed(issueId);
    trackerClosedCache.set(issueId, { closed, checkedAt: now });
    return closed;
  }

  try {
    if (isGitHubAppConfigured()) {
      const issue = await Effect.runPromise(getIssueState(resolved.owner, resolved.repo, resolved.number));
      const closed = issue.state === 'closed';
      trackerClosedCache.set(issueId, { closed, checkedAt: now });
      return closed;
    }

    const { stdout } = await execFileAsync('gh', [
      'issue',
      'view',
      String(resolved.number),
      '--repo',
      `${resolved.owner}/${resolved.repo}`,
      '--json',
      'state',
    ], { encoding: 'utf-8', timeout: 10_000 });
    const parsed = JSON.parse(stdout) as { state?: unknown };
    const closed = typeof parsed.state === 'string' && parsed.state.toLowerCase() === 'closed';
    trackerClosedCache.set(issueId, { closed, checkedAt: now });
    return closed;
  } catch {
    trackerClosedCache.set(issueId, { closed: false, checkedAt: now });
    return false;
  }
}

/**
 * Ask Linear whether a Linear-tracked issue is closed.
 *
 * Runs only when the issue resolves to a Linear-tracked, configured project;
 * otherwise it returns false so non-Linear trackers keep their pre-existing
 * behavior. Mirrors the GitHub branch's false-on-failure posture: any error,
 * timeout, or ref mismatch yields false (the reaper is destructive, so a
 * fuzzy-search hit on the wrong issue must never read as closed).
 */
async function isLinearIssueClosed(issueId: string): Promise<boolean> {
  if (resolveTrackerTypeSync(issueId) !== 'linear') return false;
  if (!resolveProjectFromIssueSync(issueId)) return false;

  let tracker: IssueTracker | null = null;
  try {
    tracker = createTracker({ type: 'linear' });
  } catch {
    const key = await Effect.runPromise(getLinearApiKey());
    tracker = key ? new LinearTracker(key) : null;
  }
  if (!tracker) return false;

  try {
    const issue = await Effect.runPromise(
      tracker.getIssue(issueId).pipe(Effect.timeout('10 seconds')),
    );
    return issue.state === 'closed'
      && issue.ref?.toUpperCase() === issueId.toUpperCase();
  } catch {
    return false;
  }
}

export async function isIssueClosed(issueId: string, closedIssueIds?: Set<string>): Promise<boolean> {
  if (closedIssueIds) return closedIssueIds.has(issueId);

  const shadowState = await Effect.runPromise(getShadowState(issueId).pipe(Effect.catch(() => Effect.succeed(null))));
  return shadowState?.trackerStatus === 'closed'
    || shadowState?.shadowStatus === 'closed'
    || shadowState?.targetCanonicalState === 'done'
    || shadowState?.targetCanonicalState === 'canceled'
    || await isTrackerIssueClosed(issueId);
}
