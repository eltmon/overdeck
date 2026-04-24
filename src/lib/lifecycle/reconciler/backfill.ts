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
 * Valid issue ID pattern: PREFIX-NUMBER (e.g., PAN-805, MIN-123).
 */
const ISSUE_ID_RE = /^[A-Z]+-\d+$/;

/**
 * Collect issue IDs from agent state directories.
 * Filters out non-issue directories (e.g., AGENT-pan-805 configs).
 */
function collectAgentIssueIds(): string[] {
  try {
    const entries = readdirSync(AGENTS_DIR, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name.toUpperCase())
      .filter((name) => ISSUE_ID_RE.test(name));
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

  // Batch existence check to avoid N+1 queries
  const normalizedIds = Array.from(allIssueIds).map((id) => id.toUpperCase());
  const placeholders = normalizedIds.map(() => '?').join(',');
  const existingRows = db
    .prepare(`SELECT issue_id FROM issue_state WHERE issue_id IN (${placeholders})`)
    .all(...normalizedIds) as Array<{ issue_id: string }>;
  const existingSet = new Set(existingRows.map((r) => r.issue_id));

  let inserted = 0;
  let skipped = 0;

  // Batch insert in a single transaction for atomicity and performance.
  const insert = db.prepare(
    `INSERT INTO issue_state (issue_id, canonical_state, last_synced_at, updated_at)
     VALUES (?, ?, ?, ?)`
  );
  const insertMany = db.transaction((rows: Array<[string, string, string, string]>) => {
    for (const row of rows) {
      insert.run(...row);
    }
  });

  const toInsert: Array<[string, string, string, string]> = [];
  for (const normalizedId of normalizedIds) {
    if (existingSet.has(normalizedId)) {
      skipped++;
      continue;
    }

    const status = statuses[normalizedId];
    const canonicalState = status
      ? reviewStatusToCanonical(status)
      : 'todo';

    toInsert.push([normalizedId, canonicalState, '1970-01-01T00:00:00.000Z', now]);
    inserted++;
  }

  if (toInsert.length > 0) {
    insertMany(toInsert);
  }

  if (inserted > 0 || skipped > 0) {
    console.log(
      `[reconciler:backfill] Seeded ${inserted} issue(s), skipped ${skipped} already tracked`
    );
  }
}
