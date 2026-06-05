/**
 * Merge-blocker reconcile service (PAN-1620).
 *
 * Closes the reactive-webhook gap that let the Awaiting-Merge page show a live
 * MERGE button on a PR that had since gone CONFLICTING / CI-red. `blockerReasons`
 * is otherwise populated ONLY by GitHub webhooks; if a webhook is delayed or
 * dropped after a `readyForMerge` PR goes stale, the row keeps a clickable button
 * until someone clicks it (which then churns the rebase loop or fails).
 *
 * Every tick this polls live GitHub mergeability for issues that are
 * `readyForMerge` with no known blockers, and `refreshMergeStateFromGitHub`
 * writes any discovered merge_conflict / draft blocker back into review status —
 * so the row drops out of "Awaiting Merge" and into "Blocked from Merge"
 * proactively, before any click, and the flywheel can pick it up to rebase.
 *
 * Bounded + cheap: typically 0–3 ready PRs; each is re-checked at most once per
 * RECHECK_INTERVAL_MS via a per-issue throttle. One `gh pr view` per due PR;
 * errors are swallowed inside `refreshMergeStateFromGitHub`.
 */
import { getAllReviewStatusesFromDb } from '../../../lib/database/review-status-db.js';
import { refreshMergeStateFromGitHub } from '../../../lib/webhook-handlers.js';

interface ServiceState {
  timer: ReturnType<typeof setInterval> | null;
  lastChecked: Map<string, number>;
}

const POLL_INTERVAL_MS = 60_000;
/** Re-check each ready-to-merge PR at most this often, to bound `gh` calls. */
const RECHECK_INTERVAL_MS = 180_000;

const serviceState: ServiceState = { timer: null, lastChecked: new Map() };

/** Parse `https://github.com/<owner>/<repo>/pull/<n>` → `{ repo: 'owner/repo', number }`. */
function parsePrUrl(url: string | undefined | null): { repo: string; number: number } | null {
  if (!url) return null;
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!m) return null;
  return { repo: `${m[1]}/${m[2]}`, number: Number(m[3]) };
}

async function reconcileOnce(state: ServiceState): Promise<void> {
  const statuses = getAllReviewStatusesFromDb();
  const now = Date.now();
  for (const [issueId, status] of Object.entries(statuses)) {
    if (!status.readyForMerge) continue;
    if ((status.blockerReasons?.length ?? 0) > 0) continue; // already flagged — leave it
    const ref = parsePrUrl(status.prUrl);
    if (!ref) continue;
    const last = state.lastChecked.get(issueId) ?? 0;
    if (now - last < RECHECK_INTERVAL_MS) continue;
    state.lastChecked.set(issueId, now);
    // Fire-and-forget: refreshMergeStateFromGitHub swallows its own errors and
    // writes any discovered blocker back into review status.
    void refreshMergeStateFromGitHub(issueId, ref.repo, ref.number);
  }
  // Prune throttle entries for issues that are no longer ready-to-merge.
  for (const id of [...state.lastChecked.keys()]) {
    if (!statuses[id]?.readyForMerge) state.lastChecked.delete(id);
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
}
