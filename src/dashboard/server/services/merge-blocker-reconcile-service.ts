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
import { Effect } from 'effect';
import { getMergeBlockerReconcileCandidates } from '../../../lib/database/review-status-db.js';
import type { BlockerReason } from '../../../lib/review-status.js';
import { refreshMergeStateFromGitHub } from '../../../lib/webhook-handlers.js';

interface RefreshTask {
  issueId: string;
  repo: string;
  number: number;
}

interface ServiceState {
  timer: ReturnType<typeof setInterval> | null;
  lastChecked: Map<string, number>;
  blockerLastChecked: Map<string, number>;
  refreshQueue: RefreshTask[];
  refreshInFlight: Set<string>;
  activeRefreshes: number;
}

const POLL_INTERVAL_MS = 60_000;
/** Re-check each ready-to-merge PR at most this often, to bound `gh` calls. */
const RECHECK_INTERVAL_MS = 180_000;
/** Re-check already-flagged mergeability blockers less often; they are not mergeable yet. */
const STALE_BLOCKER_RECHECK_INTERVAL_MS = 10 * 60_000;
const MERGEABILITY_BLOCKERS = new Set<BlockerReason['type']>(['merge_conflict', 'not_mergeable']);
const MAX_REFRESH_CONCURRENCY = 4;

const serviceState: ServiceState = {
  timer: null,
  lastChecked: new Map(),
  blockerLastChecked: new Map(),
  refreshQueue: [],
  refreshInFlight: new Set(),
  activeRefreshes: 0,
};

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
  // Fetch candidates off the main event loop via the async wrapper; the
  // selective query avoids hydrating the full table and history.
  const candidates = await Effect.runPromise(getMergeBlockerReconcileCandidates());
  const now = Date.now();

  for (const candidate of candidates) {
    const ref = parsePrUrl(candidate.prUrl);
    if (!ref) continue;

    if (hasMergeabilityBlocker(candidate.blockerReasons)) {
      const last = state.blockerLastChecked.get(candidate.issueId) ?? 0;
      if (now - last < STALE_BLOCKER_RECHECK_INTERVAL_MS) continue;
      state.blockerLastChecked.set(candidate.issueId, now);
      enqueueRefresh(state, { issueId: candidate.issueId, repo: ref.repo, number: ref.number });
      continue;
    }

    if (!candidate.readyForMerge) continue;
    if ((candidate.blockerReasons?.length ?? 0) > 0) continue; // non-mergeability blockers stay skipped
    const last = state.lastChecked.get(candidate.issueId) ?? 0;
    if (now - last < RECHECK_INTERVAL_MS) continue;
    state.lastChecked.set(candidate.issueId, now);
    enqueueRefresh(state, { issueId: candidate.issueId, repo: ref.repo, number: ref.number });
  }

  // Prune throttle entries for issues that are no longer in the population each map tracks.
  const candidateById = new Map(candidates.map((c) => [c.issueId, c]));
  for (const id of [...state.lastChecked.keys()]) {
    const candidate = candidateById.get(id);
    if (!candidate?.readyForMerge || (candidate.blockerReasons?.length ?? 0) > 0) state.lastChecked.delete(id);
  }
  for (const id of [...state.blockerLastChecked.keys()]) {
    if (!hasMergeabilityBlocker(candidateById.get(id)?.blockerReasons)) state.blockerLastChecked.delete(id);
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
  serviceState.refreshQueue.length = 0;
  serviceState.refreshInFlight.clear();
  serviceState.activeRefreshes = 0;
}

function enqueueRefresh(state: ServiceState, task: RefreshTask): void {
  if (state.refreshInFlight.has(task.issueId)) return;
  if (state.refreshQueue.some((queued) => queued.issueId === task.issueId)) return;
  state.refreshQueue.push(task);
  drainRefreshQueue(state);
}

function drainRefreshQueue(state: ServiceState): void {
  while (state.activeRefreshes < MAX_REFRESH_CONCURRENCY && state.refreshQueue.length > 0) {
    const task = state.refreshQueue.shift();
    if (!task) return;
    if (state.refreshInFlight.has(task.issueId)) continue;

    state.activeRefreshes++;
    state.refreshInFlight.add(task.issueId);
    void refreshMergeStateFromGitHub(task.issueId, task.repo, task.number)
      .catch(() => {
        // refreshMergeStateFromGitHub should swallow errors, but the queue must
        // keep draining even if that contract regresses.
      })
      .finally(() => {
        state.activeRefreshes = Math.max(0, state.activeRefreshes - 1);
        state.refreshInFlight.delete(task.issueId);
        drainRefreshQueue(state);
      });
  }
}

export async function __reconcileOnceForTests(): Promise<void> {
  await reconcileOnce(serviceState);
}
