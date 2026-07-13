import type { AgentSnapshot, SessionNode } from '@overdeck/contracts';
import type { ReviewStatusData } from '../CommandDeck/ZoneCOverviewTabs/queries';
import type { IssueShipModel, ShipLogModel } from './types';

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

/** Human-readable reason the issue is stuck or blocked. */
export function stuckReason(reviewStatus: ReviewStatusData | undefined): string {
  if (reviewStatus?.stuckReason) return reviewStatus.stuckReason;
  if (reviewStatus?.blockerReasons?.[0]) return reviewStatus.blockerReasons[0].summary;
  if (reviewStatus?.reviewStatus === 'blocked') return 'Review blocked';
  if (reviewStatus?.reviewStatus === 'failed') return 'Review failed';
  if (reviewStatus?.testStatus === 'dispatch_failed') return 'Test dispatch failed';
  if (reviewStatus?.testStatus === 'failed') return 'Tests failed';
  if (reviewStatus?.mergeStatus === 'failed') return 'Merge failed';
  if (reviewStatus?.verificationStatus === 'failed') return 'Verification failed';
  return 'Needs attention';
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
