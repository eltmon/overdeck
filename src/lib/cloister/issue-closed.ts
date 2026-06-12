import { execFile } from 'child_process';
import { promisify } from 'util';
import { Effect } from 'effect';

import { getShadowState } from '../shadow-state.js';
import { resolveGitHubIssueSync } from '../tracker-utils.js';

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
    trackerClosedCache.set(issueId, { closed: false, checkedAt: now });
    return false;
  }

  try {
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

export async function isIssueClosed(issueId: string, closedIssueIds?: Set<string>): Promise<boolean> {
  if (closedIssueIds) return closedIssueIds.has(issueId);

  const shadowState = await Effect.runPromise(getShadowState(issueId).pipe(Effect.catch(() => Effect.succeed(null))));
  return shadowState?.trackerStatus === 'closed'
    || shadowState?.shadowStatus === 'closed'
    || shadowState?.targetCanonicalState === 'done'
    || shadowState?.targetCanonicalState === 'canceled'
    || await isTrackerIssueClosed(issueId);
}
