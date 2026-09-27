/**
 * deacon-lite's seventh recovery routine (PAN-4221).
 *
 * A dashboard restart while a detached verification worker runs kills the
 * push-and-dispatch continuation that lived in the dead process. The worker
 * still journals `verification.passed`, and `recoverStalledReviews` skips
 * every `verification.*` tail on purpose (PAN-3705), so the review was never
 * recovered — a green PR could sit forever (PAN-4198..4201 sat ~15 hours on
 * 2026-09-25). This routine recovers only a `verification.passed` tail whose
 * `source` is `request-review`: a `review` (dashboard /trigger) or
 * `merge-verify` pass belongs to a different door and is left alone. See
 * docs/PIPELINE-GATES.md.
 */
import { existsSync } from 'node:fs';

import { emitActivityEntry } from '../activity-logger.js';
import { getIssuePause } from '../agents/agent-state.js';
import { liveAgentInventory } from '../terminal-backends/inventory.js';
import { listWorkspaces } from '../workspaces/resolver.js';
import { lastPipelineEntry, readPipelineJournal } from './pipeline-journal.js';
import { isVerificationWorkerActive } from './verification-worker-supervisor.js';
import { readPrimaryHead8 } from './verified-head.js';

export const UNDISPATCHED_REVIEW_MIN_AGE_MS = 5 * 60_000;
export const UNDISPATCHED_REVIEW_COOLDOWN_MS = 60 * 60_000; // matches STALLED_REVIEW_COOLDOWN_MS
export const UNDISPATCHED_REVIEW_ATTEMPT_CAP = 3; // matches SYNTHESIS_REDISPATCH_CAP

const lastUndispatchedRecoveryAt = new Map<string, number>();
/** Issues already warned that they hit the attempt cap — warn once, not every tick. */
const loggedAttemptCapReached = new Set<string>();

/** Test seam: clear the per-issue cooldown and cap-warning state between test cases. */
export function __resetUndispatchedReviewStateForTests(): void {
  lastUndispatchedRecoveryAt.clear();
  loggedAttemptCapReached.clear();
}

/**
 * Deacon-lite `review.requested` entries since the last `review.requested`
 * from any other source — the count `UNDISPATCHED_REVIEW_ATTEMPT_CAP` bounds,
 * so an hourly re-verify that keeps coming back gated does not loop forever.
 */
function deaconLiteRequestAttempts(workspacePath: string): number {
  const entries = readPipelineJournal(workspacePath);
  let count = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.type !== 'review.requested') continue;
    if (entry.source !== 'deacon-lite') break;
    count++;
  }
  return count;
}

/**
 * Re-request a review for every workspace whose journal tail is a
 * `request-review` `verification.passed` with nobody left to dispatch it:
 * no active verification worker, no live `agent-<issue>-review` parent or
 * `agent-<issue>-review-*` lane, the issue unpaused, review mode not `none`,
 * and the primary repo's current head still matching the head the pass
 * stamped. `requestReviewThroughRoute` re-verifies against current main and
 * journals `review.requested` itself, so this routine does not.
 */
export async function recoverUndispatchedReviews(now = Date.now()): Promise<string[]> {
  const actions: string[] = [];
  // An unreadable inventory is indeterminate: recover nobody rather than risk
  // re-requesting a review whose reviewer is actually alive.
  const inventory = await liveAgentInventory();
  if (inventory === null) return actions;
  const livePaneIds = inventory.panes.map((pane) => pane.agentId);

  let workspaces: ReturnType<typeof listWorkspaces>;
  try {
    workspaces = listWorkspaces();
  } catch (err) {
    console.error('[deacon-lite] Could not list workspaces for undispatched-review recovery:', err);
    return actions;
  }

  for (const workspace of workspaces) {
    const issueId = workspace.issueId?.toUpperCase();
    if (!issueId || !workspace.path || !existsSync(workspace.path)) continue;

    const last = lastPipelineEntry(workspace.path);
    if (!last || last.type !== 'verification.passed' || last.source !== 'request-review') continue;

    const at = Date.parse(last.at);
    if (Number.isNaN(at) || now - at < UNDISPATCHED_REVIEW_MIN_AGE_MS) continue;

    const lastRecovery = lastUndispatchedRecoveryAt.get(issueId);
    if (lastRecovery !== undefined && now - lastRecovery < UNDISPATCHED_REVIEW_COOLDOWN_MS) continue;

    const head = last.data?.['head'];
    if (typeof head !== 'string' || head.length === 0) continue;

    if (isVerificationWorkerActive(issueId)) continue;

    // A live parent (quick mode writes no `review.dispatched`, so the tail
    // stays `verification.passed` for a healthy quick reviewer's whole life)
    // or any live sub-reviewer lane means the review is not actually
    // undispatched.
    const parentId = `agent-${issueId.toLowerCase()}-review`;
    const reviewerPrefix = `${parentId}-`;
    if (livePaneIds.some((agentId) => agentId === parentId || agentId.startsWith(reviewerPrefix))) continue;

    if (getIssuePause(issueId).status !== 'unpaused') continue;

    const attempts = deaconLiteRequestAttempts(workspace.path);
    if (attempts >= UNDISPATCHED_REVIEW_ATTEMPT_CAP) {
      if (!loggedAttemptCapReached.has(issueId)) {
        loggedAttemptCapReached.add(issueId);
        const message = `${issueId}: ${attempts} deacon-lite review requests already sent for this verification.passed tail — giving up; the review needs the operator`;
        console.warn(`[deacon-lite] ${message}`);
        emitActivityEntry({ source: 'review', level: 'warn', message, issueId });
      }
      continue;
    }

    const { resolveReviewMode } = await import('./review-agent.js');
    if (resolveReviewMode(issueId) === 'none') continue;

    // The wrapper-repo HEAD never matches on polyrepo; compare the same
    // primary-repo sha the runner stamped `data.head` with (verified-head.ts).
    const verifiedHead8 = await readPrimaryHead8(issueId, workspace.path);
    if (verifiedHead8 !== head) continue;

    // The cooldown starts BEFORE the request so a refused or unreachable
    // route is not retried every tick.
    lastUndispatchedRecoveryAt.set(issueId, now);

    const { requestReviewThroughRoute } = await import('./review-request-route.js');
    const outcome = await requestReviewThroughRoute(issueId, {
      message: 'a dashboard restart during verification left the review undispatched',
      source: 'deacon-lite',
    });
    if (outcome.requested) {
      actions.push(`recoverUndispatchedReviews: re-requested the undispatched ${issueId} review`);
    } else if (outcome.noReviewNeeded) {
      console.log(`[deacon-lite] ${issueId}: undispatched review not re-requested — ${outcome.reason}`);
    } else {
      console.warn(`[deacon-lite] ${issueId}: could not re-request the undispatched review — ${outcome.reason}`);
    }
  }

  return actions;
}
