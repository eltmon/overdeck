/**
 * Boot-time backfill of issue_state from local data (PAN-805).
 *
 * Seeds issue_state for every issue Panopticon already knows about
 * (review_status rows + agent state directories). Issues missed here
 * are caught by the lazy-insert clause in transitionIssueToInProgress.
 */

import { readdirSync } from 'fs';
import { join } from 'path';
import { getDatabase } from '../../database/index.js';
import { getAllReviewStatusesFromDb } from '../../database/review-status-db.js';
import { AGENTS_DIR } from '../../paths.js';
import type { CanonicalState } from './types.js';

/**
 * Derive canonical state from review status heuristics.
 */
function reviewStatusToCanonical(row: {
  mergeStatus?: string;
  prUrl?: string;
  readyForMerge?: boolean;
  reviewStatus?: string;
}): CanonicalState {
  if (row.mergeStatus === 'merged') return 'merged';
  if (row.prUrl || row.readyForMerge) return 'in_review';
  if (row.reviewStatus === 'reviewing' || row.reviewStatus === 'passed' || row.reviewStatus === 'failed' || row.reviewStatus === 'blocked') {
    return 'in_review';
  }
  return 'todo';
}

/**
 * Collect issue IDs from agent state directories.
 */
function collectAgentIssueIds(): string[] {
  try {
    const entries = readdirSync(AGENTS_DIR, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => name.includes('-'));
  } catch {
    return [];
  }
}

/**
 * Backfill issue_state from all local sources.
 * Idempotent — uses INSERT OR IGNORE.
 */
export function backfillIssueState(): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  const statuses = getAllReviewStatusesFromDb();
  const agentIds = collectAgentIssueIds();

  // Merge both sources into a unique set
  const allIssueIds = new Set<string>([
    ...Object.keys(statuses),
    ...agentIds,
  ]);

  let inserted = 0;
  let skipped = 0;

  for (const issueId of allIssueIds) {
    const normalizedId = issueId.toUpperCase();

    // Skip if already tracked
    const exists = db
      .prepare('SELECT 1 FROM issue_state WHERE issue_id = ?')
      .get(normalizedId);
    if (exists) {
      skipped++;
      continue;
    }

    const status = statuses[normalizedId];
    const canonicalState = status
      ? reviewStatusToCanonical(status)
      : 'todo';

    db.prepare(
      `INSERT INTO issue_state (issue_id, canonical_state, last_synced_at, updated_at)
       VALUES (?, ?, ?, ?)`
    ).run(normalizedId, canonicalState, now, now);
    inserted++;
  }

  if (inserted > 0 || skipped > 0) {
    console.log(
      `[reconciler:backfill] Seeded ${inserted} issue(s), skipped ${skipped} already tracked`
    );
  }
}
