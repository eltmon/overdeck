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
        updated_at, ready_for_merge, auto_requeue_count, merge_retry_count, pr_url,
        stuck, stuck_reason, stuck_at, stuck_details,
        reviewed_at_commit,
        review_spawned_at,
        test_retry_count,
        review_retry_count,
        recovery_started_at,
        deacon_ignored,
        deacon_ignored_at,
        deacon_ignored_reason
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
        merge_retry_count     = excluded.merge_retry_count,
        pr_url                = excluded.pr_url,
        stuck                 = excluded.stuck,
        stuck_reason          = excluded.stuck_reason,
        stuck_at              = excluded.stuck_at,
        stuck_details         = excluded.stuck_details,
        reviewed_at_commit    = excluded.reviewed_at_commit,
        review_spawned_at     = excluded.review_spawned_at,
        test_retry_count      = excluded.test_retry_count,
        review_retry_count    = excluded.review_retry_count,
        recovery_started_at   = excluded.recovery_started_at,
        deacon_ignored        = excluded.deacon_ignored,
        deacon_ignored_at     = excluded.deacon_ignored_at,
        deacon_ignored_reason = excluded.deacon_ignored_reason
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
      s.mergeRetryCount ?? null,
      s.prUrl ?? null,
      s.stuck ? 1 : 0,
      s.stuckReason ?? null,
      s.stuckAt ?? null,
      s.stuckDetails ?? null,
      s.reviewedAtCommit ?? null,
      s.reviewSpawnedAt ?? null,
      s.testRetryCount ?? null,
      s.reviewRetryCount ?? null,
      s.recoveryStartedAt ?? null,
      s.deaconIgnored ? 1 : 0,
      s.deaconIgnoredAt ?? null,
      s.deaconIgnoredReason ?? null,
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
  const normalizedId = issueId.toUpperCase();

  const row = db.prepare(`
    SELECT * FROM review_status WHERE issue_id = ?
  `).get(normalizedId) as DbReviewStatusRow | undefined;

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
  const normalizedId = issueId.toUpperCase();
  const rows = db.prepare(`
    SELECT type, status, timestamp, notes
    FROM status_history
    WHERE issue_id = ?
    ORDER BY timestamp ASC
  `).all(normalizedId) as Array<{ type: string; status: string; timestamp: string; notes: string | null }>;

  return rows.map(r => ({
    type: r.type as 'review' | 'test' | 'merge' | 'inspect' | 'uat',
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
  merge_retry_count: number | null;
  pr_url: string | null;
  // PAN-653: persistent stuck state
  stuck: number;
  stuck_reason: string | null;
  stuck_at: string | null;
  stuck_details: string | null;
  // PAN-653: commit SHA at which review passed
  reviewed_at_commit: string | null;
  // PAN-699: timestamp when review agents were dispatched
  review_spawned_at: string | null;
  // PAN-699: test-agent dispatch retry counter
  test_retry_count: number | null;
  // PAN-794: parallel-review re-dispatch retry counter
  review_retry_count: number | null;
  // PAN-794: ISO timestamp marking current recovery-cycle boundary
  recovery_started_at: string | null;
  // Human-requested deacon ignore (per-issue patrol opt-out)
  deacon_ignored: number;
  deacon_ignored_at: string | null;
  deacon_ignored_reason: string | null;
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
    mergeRetryCount: row.merge_retry_count ?? undefined,
    prUrl: row.pr_url ?? undefined,
    stuck: row.stuck === 1 ? true : undefined,
    stuckReason: row.stuck_reason ?? undefined,
    stuckAt: row.stuck_at ?? undefined,
    stuckDetails: row.stuck_details ?? undefined,
    reviewedAtCommit: row.reviewed_at_commit ?? undefined,
    reviewSpawnedAt: row.review_spawned_at ?? undefined,
    testRetryCount: row.test_retry_count ?? undefined,
    reviewRetryCount: row.review_retry_count ?? undefined,
    recoveryStartedAt: row.recovery_started_at ?? undefined,
    deaconIgnored: row.deacon_ignored === 1 ? true : undefined,
    deaconIgnoredAt: row.deacon_ignored_at ?? undefined,
    deaconIgnoredReason: row.deacon_ignored_reason ?? undefined,
    history: history.length > 0 ? history : undefined,
  });
}

// ============== Stuck state helpers (PAN-653) ==============

/**
 * Mark a workspace as stuck with a reason and optional JSON details.
 * Persists across dashboard restarts. Deacon will skip stuck workspaces.
 *
 * @param issueId - Issue ID (e.g. "PAN-653"), case as stored in DB
 * @param reason  - Short reason code (e.g. "main_diverged")
 * @param details - Optional structured details (stored as JSON string)
 */
export function markWorkspaceStuck(
  issueId: string,
  reason: string,
  details?: Record<string, unknown>,
): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  const detailsJson = details ? JSON.stringify(details) : null;

  // Use INSERT OR IGNORE + UPDATE so we don't reset other columns.
  // If no row exists yet, create a minimal placeholder first.
  db.prepare(`
    INSERT OR IGNORE INTO review_status (
      issue_id, review_status, test_status, updated_at, ready_for_merge,
      stuck, stuck_reason, stuck_at, stuck_details
    ) VALUES (?, 'pending', 'pending', ?, 0, 1, ?, ?, ?)
  `).run(issueId, now, reason, now, detailsJson);

  db.prepare(`
    UPDATE review_status
    SET stuck = 1, stuck_reason = ?, stuck_at = ?, stuck_details = ?, updated_at = ?
    WHERE issue_id = ?
  `).run(reason, now, detailsJson, now, issueId);
}

/**
 * Set (or clear) the human-requested deacon-ignore flag for a workspace.
 * When ignored=true, Deacon patrol skips this issue entirely — distinct from
 * `stuck`, which is a system-set failure marker. Used by the per-issue "Pause"
 * button on the kanban and by bulk-apply tooling.
 */
export function setDeaconIgnored(
  issueId: string,
  ignored: boolean,
  reason?: string,
): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  // Ensure a row exists (same pattern as markWorkspaceStuck) so setting the
  // flag on an issue that has no prior review_status row still works.
  db.prepare(`
    INSERT OR IGNORE INTO review_status (
      issue_id, review_status, test_status, updated_at, ready_for_merge,
      deacon_ignored, deacon_ignored_at, deacon_ignored_reason
    ) VALUES (?, 'pending', 'pending', ?, 0, ?, ?, ?)
  `).run(issueId, now, ignored ? 1 : 0, ignored ? now : null, ignored ? (reason ?? null) : null);

  db.prepare(`
    UPDATE review_status
    SET deacon_ignored       = ?,
        deacon_ignored_at    = ?,
        deacon_ignored_reason = ?,
        updated_at           = ?
    WHERE issue_id = ?
  `).run(
    ignored ? 1 : 0,
    ignored ? now : null,
    ignored ? (reason ?? null) : null,
    now,
    issueId,
  );
}

/**
 * Clear the stuck flag for a workspace (called when the human clicks "Unstick").
 * Re-enables Deacon patrol for this workspace.
 */
export function clearWorkspaceStuck(issueId: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE review_status
    SET stuck = 0, stuck_reason = NULL, stuck_at = NULL, stuck_details = NULL, updated_at = ?
    WHERE issue_id = ?
  `).run(now, issueId);
}
