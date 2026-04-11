/**
 * Review Status SQLite Storage
 *
 * Provides SQLite-backed CRUD for ReviewStatus, matching the interface in
 * src/lib/review-status.ts. Atomic single-transaction writes eliminate the
 * TOCTOU race in the JSON-backed implementation.
 */

import { getDatabase } from './index.js';
import type { ReviewStatus, StatusHistoryEntry } from '../review-status.js';
import { normalizeReviewStatus } from '../review-status-normalize.js';

// ============== Write operations ==============

/**
 * Upsert a review status record atomically.
 * Replaces the JSON read-modify-write cycle with a single transaction.
 */
export function upsertReviewStatus(status: ReviewStatus): void {
  const db = getDatabase();

  const upsert = db.transaction((s: ReviewStatus) => {
    // Upsert main record
    db.prepare(`
      INSERT INTO review_status (
        issue_id, review_status, test_status, merge_status,
        verification_status, verification_notes,
        verification_cycle_count, verification_max_cycles,
        review_notes, test_notes, merge_notes,
        updated_at, ready_for_merge, auto_requeue_count, pr_url
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(issue_id) DO UPDATE SET
        review_status         = excluded.review_status,
        test_status           = excluded.test_status,
        merge_status          = excluded.merge_status,
        verification_status   = excluded.verification_status,
        verification_notes    = excluded.verification_notes,
        verification_cycle_count = excluded.verification_cycle_count,
        verification_max_cycles  = excluded.verification_max_cycles,
        review_notes          = excluded.review_notes,
        test_notes            = excluded.test_notes,
        merge_notes           = excluded.merge_notes,
        updated_at            = excluded.updated_at,
        ready_for_merge       = excluded.ready_for_merge,
        auto_requeue_count    = excluded.auto_requeue_count,
        pr_url                = excluded.pr_url
    `).run(
      s.issueId,
      s.reviewStatus,
      s.testStatus,
      s.mergeStatus ?? null,
      s.verificationStatus ?? null,
      s.verificationNotes ?? null,
      s.verificationCycleCount ?? null,
      s.verificationMaxCycles ?? null,
      s.reviewNotes ?? null,
      s.testNotes ?? null,
      s.mergeNotes ?? null,
      s.updatedAt,
      s.readyForMerge ? 1 : 0,
      s.autoRequeueCount ?? null,
      s.prUrl ?? null,
    );

    // Append new history entries (deduplicate by timestamp to avoid re-inserting)
    if (s.history && s.history.length > 0) {
      const insertHistory = db.prepare(`
        INSERT OR IGNORE INTO status_history (issue_id, type, status, timestamp, notes)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const entry of s.history) {
        insertHistory.run(s.issueId, entry.type, entry.status, entry.timestamp, entry.notes ?? null);
      }
    }
  });

  upsert(status);
}

/**
 * Delete a review status record and its history.
 */
export function deleteReviewStatus(issueId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM review_status WHERE issue_id = ?').run(issueId);
}

// ============== Read operations ==============

/**
 * Get a single review status by issue ID.
 */
export function getReviewStatusFromDb(issueId: string): ReviewStatus | null {
  const db = getDatabase();

  const row = db.prepare(`
    SELECT * FROM review_status WHERE issue_id = ?
  `).get(issueId) as DbReviewStatusRow | undefined;

  if (!row) return null;

  const history = getHistoryFromDb(issueId);
  return rowToReviewStatus(row, history);
}

/**
 * Get all review statuses.
 */
export function getAllReviewStatusesFromDb(): Record<string, ReviewStatus> {
  const db = getDatabase();

  const rows = db.prepare('SELECT * FROM review_status ORDER BY updated_at DESC').all() as DbReviewStatusRow[];
  const result: Record<string, ReviewStatus> = {};

  for (const row of rows) {
    const history = getHistoryFromDb(row.issue_id);
    result[row.issue_id] = rowToReviewStatus(row, history);
  }

  return result;
}

/**
 * Get history entries for an issue.
 */
function getHistoryFromDb(issueId: string): StatusHistoryEntry[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT type, status, timestamp, notes
    FROM status_history
    WHERE issue_id = ?
    ORDER BY timestamp ASC
  `).all(issueId) as Array<{ type: string; status: string; timestamp: string; notes: string | null }>;

  return rows.map(r => ({
    type: r.type as 'review' | 'test' | 'merge',
    status: r.status,
    timestamp: r.timestamp,
    ...(r.notes ? { notes: r.notes } : {}),
  }));
}

// ============== Row mapping ==============

interface DbReviewStatusRow {
  issue_id: string;
  review_status: string;
  test_status: string;
  merge_status: string | null;
  verification_status: string | null;
  verification_notes: string | null;
  verification_cycle_count: number | null;
  verification_max_cycles: number | null;
  review_notes: string | null;
  test_notes: string | null;
  merge_notes: string | null;
  updated_at: string;
  ready_for_merge: number;
  auto_requeue_count: number | null;
  pr_url: string | null;
}

function rowToReviewStatus(row: DbReviewStatusRow, history: StatusHistoryEntry[]): ReviewStatus {
  return normalizeReviewStatus({
    issueId: row.issue_id,
    reviewStatus: row.review_status as ReviewStatus['reviewStatus'],
    testStatus: row.test_status as ReviewStatus['testStatus'],
    mergeStatus: row.merge_status as ReviewStatus['mergeStatus'] ?? undefined,
    verificationStatus: row.verification_status as ReviewStatus['verificationStatus'] ?? undefined,
    verificationNotes: row.verification_notes ?? undefined,
    verificationCycleCount: row.verification_cycle_count ?? undefined,
    verificationMaxCycles: row.verification_max_cycles ?? undefined,
    reviewNotes: row.review_notes ?? undefined,
    testNotes: row.test_notes ?? undefined,
    mergeNotes: row.merge_notes ?? undefined,
    updatedAt: row.updated_at,
    readyForMerge: row.ready_for_merge === 1,
    autoRequeueCount: row.auto_requeue_count ?? undefined,
    prUrl: row.pr_url ?? undefined,
    history: history.length > 0 ? history : undefined,
  });
}
