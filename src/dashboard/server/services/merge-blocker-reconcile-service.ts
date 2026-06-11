/**
 * Merge-blocker reconcile service (PAN-1620, PAN-1765).
 *
 * Closes two reactive-webhook gaps around GitHub mergeability state:
 *
 * 1. Ready rows with no known blockers can go stale (CONFLICTING / CI-red) when a
 *    webhook is delayed or dropped. Polling those rows writes newly discovered
 *    blockers before a human clicks MERGE.
 * 2. Rows that already carry merge_conflict / not_mergeable blockers can become
 *    clean again after a resolver rebases the branch. Re-checking those rows on a
 *    slower cadence lets refreshMergeStateFromGitHub clear stale flags even when
 *    no webhook arrives.
 *
 * Bounded + cheap: each issue has a throttle. Ready/no-blocker rows use the PAN-1620
 * 3-minute cadence; already-blocked mergeability rows use a 10-minute cadence.
 */
import { getAllReviewStatusesFromDb } from '../../../lib/database/review-status-db.js';
import type { BlockerReason } from '../../../lib/review-status.js';
import { refreshMergeStateFromGitHub } from '../../../lib/webhook-handlers.js';

interface ServiceState {
  timer: ReturnType<typeof setInterval> | null;
  lastChecked: Map<string, number>;
  blockerLastChecked: Map<string, number>;
}

const POLL_INTERVAL_MS = 60_000;
/** Re-check each ready-to-merge PR at most this often, to bound `gh` calls. */
const RECHECK_INTERVAL_MS = 180_000;
/** Re-check already-flagged mergeability blockers less often; they are not mergeable yet. */
const STALE_BLOCKER_RECHECK_INTERVAL_MS = 10 * 60_000;
const MERGEABILITY_BLOCKERS = new Set<BlockerReason['type']>(['merge_conflict', 'not_mergeable']);

const serviceState: ServiceState = { timer: null, lastChecked: new Map(), blockerLastChecked: new Map() };

/** Parse `https://github.com/<owner>/<repo>/pull/<n>` → `{ repo: 'owner/repo', number }`. */
function parsePrUrl(url: string | undefined | null): { repo: string; number: number } | null {
  if (!url) return null;
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!m) return null;
  return { repo: `${m[1]}/${m[2]}`, number: Number(m[3]) };
}

function hasMergeabilityBlocker(blockers: BlockerReason[] | undefined): boolean {
  return blockers?.some((blocker) => MERGEABILITY_BLOCKERS.has(blocker.type)) ?? false;
}

async function reconcileOnce(state: ServiceState): Promise<void> {
  const statuses = getAllReviewStatusesFromDb();
  const now = Date.now();
  for (const [issueId, status] of Object.entries(statuses)) {
    const ref = parsePrUrl(status.prUrl);
    if (!ref) continue;

    if (hasMergeabilityBlocker(status.blockerReasons)) {
      const last = state.blockerLastChecked.get(issueId) ?? 0;
      if (now - last < STALE_BLOCKER_RECHECK_INTERVAL_MS) continue;
      state.blockerLastChecked.set(issueId, now);
      // Fire-and-forget: refreshMergeStateFromGitHub swallows its own errors and
      // clears stale mergeability blockers when GitHub reports the PR is mergeable.
      void refreshMergeStateFromGitHub(issueId, ref.repo, ref.number);
      continue;
    }

    if (!status.readyForMerge) continue;
    if ((status.blockerReasons?.length ?? 0) > 0) continue; // non-mergeability blockers stay skipped
    const last = state.lastChecked.get(issueId) ?? 0;
    if (now - last < RECHECK_INTERVAL_MS) continue;
    state.lastChecked.set(issueId, now);
    // Fire-and-forget: refreshMergeStateFromGitHub swallows its own errors and
    // writes any discovered blocker back into review status.
    void refreshMergeStateFromGitHub(issueId, ref.repo, ref.number);
  }
  // Prune throttle entries for issues that are no longer in the population each map tracks.
  for (const id of [...state.lastChecked.keys()]) {
    const status = statuses[id];
    if (!status?.readyForMerge || (status.blockerReasons?.length ?? 0) > 0) state.lastChecked.delete(id);
  }
  for (const id of [...state.blockerLastChecked.keys()]) {
    if (!hasMergeabilityBlocker(statuses[id]?.blockerReasons)) state.blockerLastChecked.delete(id);
  }
}

export function startMergeBlockerReconcileService(): void {
  if (serviceState.timer !== null) return; // already running
  serviceState.timer = setInterval(() => {
    reconcileOnce(serviceState).catch(() => {
      // Swallow — reconcile must never crash the server.
    });
  }, POLL_INTERVAL_MS);
  serviceState.timer.unref?.();
}

export function stopMergeBlockerReconcileService(): void {
  if (serviceState.timer !== null) {
    clearInterval(serviceState.timer);
    serviceState.timer = null;
  }
  serviceState.lastChecked.clear();
  serviceState.blockerLastChecked.clear();
}

export async function __reconcileOnceForTests(): Promise<void> {
  await reconcileOnce(serviceState);
}
