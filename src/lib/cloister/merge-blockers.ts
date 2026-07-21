import { getAllReviewStatusesFromDb } from '../overdeck/review-status-sync.js';

/**
 * PRs that passed review but cannot merge for a GitHub-native reason (PAN-1620):
 * merge_conflict / failing_checks / not_mergeable. These sit forever unless rebased.
 *
 * Reads `review_status` directly from SQLite — NO HTTP — so it works inside a
 * network-sandboxed harness (e.g. codex's bwrap sandbox) where a `curl` to the
 * dashboard's `/api/flywheel/merge-blockers` cannot reach `127.0.0.1:3011`.
 * Shared by the dashboard route and the `pan flywheel merge-blockers` CLI so the
 * two surfaces can never disagree.
 */
const MERGE_BLOCKER_TYPES = new Set(['merge_conflict', 'failing_checks', 'not_mergeable']);

export interface MergeBlocker {
  issueId: string;
  prUrl?: string;
  reasons: Array<{ type: string; summary: string }>;
}

export function getMergeBlockersPayload(): MergeBlocker[] {
  const statuses = getAllReviewStatusesFromDb();
  const out: MergeBlocker[] = [];
  for (const [issueId, status] of Object.entries(statuses)) {
    if (status.reviewStatus !== 'passed') continue;
    if (status.mergeStatus === 'merged') continue;
    const reasons = (status.blockerReasons ?? []).filter((b) => MERGE_BLOCKER_TYPES.has(b.type));
    if (reasons.length === 0) continue;
    out.push({ issueId, prUrl: status.prUrl, reasons: reasons.map((b) => ({ type: b.type, summary: b.summary })) });
  }
  return out;
}
