import type { AgentSnapshot, SessionNode } from '@overdeck/contracts';
import type { ReviewStatusData } from '../CommandDeck/ZoneCOverviewTabs/queries';
import type { IssueShipModel, OperatorNeedsYou, ShipLogModel } from './types';

/**
 * Issue-view derivations (PAN-2499).
 *
 * These four derivations were previously inlined across Console, Cockpit, and Rail.
 * They now live in one place and feed the unified IssueViewModel.
 */

/** True when the agent/session is actively running right now. */
export function isAgentRunning(session: SessionNode, agent?: AgentSnapshot): boolean {
  if (agent?.status === 'running' || agent?.status === 'starting') return true;
  if (session.status === 'running' || session.status === 'starting') {
    return session.presence !== 'ended';
  }
  return false;
}

/** True when review + test gates have passed and the issue is cleared for merge. */
export function readyForMerge(reviewStatus: ReviewStatusData | undefined): boolean {
  return reviewStatus?.readyForMerge === true;
}

/**
 * Granular merge pipeline step. Returns the explicit mergeStep when available,
 * otherwise falls back to mergeStatus, or null when there is no merge activity.
 */
export function mergeStep(reviewStatus: ReviewStatusData | undefined): string | null {
  const rs = reviewStatus as (ReviewStatusData & { mergeStep?: string }) | undefined;
  return rs?.mergeStep ?? rs?.mergeStatus ?? null;
}

/** Review cycle history as a formatted series string (e.g., "12 → 7 → 5 → 4"). */
export function reviewCycleSeries(reviewStatus: ReviewStatusData | undefined): string | null {
  const rs = reviewStatus as (ReviewStatusData & { reviewCycleHistory?: Array<{ blockingCount: number }> }) | undefined;
  const history = rs?.reviewCycleHistory;
  if (!history || history.length === 0) return null;
  return history.map(e => String(e.blockingCount)).join(' → ');
}

/** Human-readable reason the issue is stuck or blocked. */
export function stuckReason(reviewStatus: ReviewStatusData | undefined): string {
  const explicitReason = (reviewStatus as (ReviewStatusData & { stuckReason?: string }) | undefined)?.stuckReason;
  if (explicitReason) return explicitReason;
  if (reviewStatus?.blockerReasons?.[0]) return reviewStatus.blockerReasons[0].summary;
  if (reviewStatus?.reviewStatus === 'blocked') return 'Review blocked';
  if (reviewStatus?.reviewStatus === 'failed') return 'Review failed';
  if (reviewStatus?.testStatus === 'dispatch_failed') return 'Test dispatch failed';
  if (reviewStatus?.testStatus === 'failed') return 'Tests failed';
  if (reviewStatus?.mergeStatus === 'failed') return 'Merge failed';
  if (reviewStatus?.verificationStatus === 'failed') return 'Verification failed';
  return 'Needs attention';
}

const OPERATOR_NEED_PRIORITY: Record<OperatorNeedsYou['kind'], number> = {
  awaiting_input: 0,
  stuck: 1,
  troubled: 2,
  paused: 3,
  stale_review: 4,
  blocker: 5,
  pickup_gate: 6,
  ready_for_merge: 7,
  stopped: 8,
};

/** Sort operator signals into the cockpit's single-slot priority ladder. */
export function sortOperatorNeeds(items: readonly OperatorNeedsYou[]): OperatorNeedsYou[] {
  return items.map((item, index) => ({ item, index }))
    .sort((a, b) => OPERATOR_NEED_PRIORITY[a.item.kind] - OPERATOR_NEED_PRIORITY[b.item.kind] || a.index - b.index)
    .map(({ item }) => item);
}

/** Derive the unified ship model from review status and the optional ship log. */
export function deriveShip(
  reviewStatus: ReviewStatusData | undefined,
  log?: ShipLogModel | null,
): IssueShipModel {
  let status: IssueShipModel['status'] = 'pending';
  if (reviewStatus?.mergeStatus === 'merged') status = 'merged';
  else if (readyForMerge(reviewStatus)) status = 'ready';
  else if (reviewStatus?.mergeStatus === 'queued') status = 'queued';
  else if (reviewStatus?.mergeStatus === 'merging') status = 'merging';
  else if (reviewStatus?.mergeStatus === 'verifying') status = 'verifying';
  else if (reviewStatus?.mergeStatus === 'failed') status = 'failed';

  return {
    status,
    readyForMerge: readyForMerge(reviewStatus),
    mergeStep: mergeStep(reviewStatus),
    blockerReason: status === 'ready' || status === 'merged' ? undefined : stuckReason(reviewStatus),
    log: log ?? null,
  };
}
