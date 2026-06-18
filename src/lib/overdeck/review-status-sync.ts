/**
 * Sync CRUD for review_status in overdeck.db.
 *
 * Mirrors the surface of database/review-status-db.ts but reads/writes
 * overdeck.db via getOverdeckDatabaseSync() instead of panopticon.db.
 *
 * The overdeck review_status table has the same column set as the old DB
 * (added in the 0000_overdeck_init.sql migration). status_history is shared
 * between the old and new domains — both tables exist in overdeck.db.
 */
import { Effect } from 'effect';
import type { BlockerReason, ReviewStatus, StatusHistoryEntry } from '../review-status.js';
import { normalizeReviewStatusSync } from '../review-status-normalize.js';
import { getOverdeckDatabaseSync } from './infra.js';

// ── Timestamp helpers — overdeck stores timestamps as integer epoch-MILLISECONDS;
//    the ReviewStatus domain type exposes them as ISO strings, so convert at the
//    storage boundary (PAN-1961). ─────────────────────────────────────────────
function isoToMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
function msToIso(value: number | null | undefined): string | undefined {
  return value == null ? undefined : new Date(value).toISOString();
}

// ── Internal row type ────────────────────────────────────────────────────────

interface DbRow {
  issue_id: string;
  review_status: string;
  test_status: string;
  merge_status: string | null;
  inspect_status: string | null;
  inspect_notes: string | null;
  inspect_started_at: number | null;
  inspect_bead_id: string | null;
  verification_status: string | null;
  verification_notes: string | null;
  verification_cycle_count: number | null;
  verification_max_cycles: number | null;
  review_notes: string | null;
  test_notes: string | null;
  merge_notes: string | null;
  updated_at: number;
  ready_for_merge: number;
  auto_requeue_count: number | null;
  merge_retry_count: number | null;
  pr_url: string | null;
  pr_head_sha: string | null;
  pr_number: number | null;
  stuck: number;
  stuck_reason: string | null;
  stuck_at: number | null;
  stuck_details: string | null;
  reviewed_at_commit: string | null;
  review_spawned_at: number | null;
  conflict_resolution_dispatched_at: number | null;
  test_retry_count: number | null;
  review_retry_count: number | null;
  recovery_started_at: number | null;
  deacon_ignored: number;
  deacon_ignored_at: number | null;
  deacon_ignored_reason: string | null;
  blocker_reasons: string | null;
  last_verified_commit: string | null;
  merge_step: string | null;
  auto_merge: number | null;
}

function rowToReviewStatus(row: DbRow, history: StatusHistoryEntry[]): ReviewStatus {
  return normalizeReviewStatusSync({
    issueId: row.issue_id.toUpperCase(),
    reviewStatus: row.review_status as ReviewStatus['reviewStatus'],
    testStatus: row.test_status as ReviewStatus['testStatus'],
    mergeStatus: (row.merge_status as ReviewStatus['mergeStatus']) ?? undefined,
    inspectStatus: (row.inspect_status as ReviewStatus['inspectStatus']) ?? undefined,
    inspectNotes: row.inspect_notes ?? undefined,
    inspectStartedAt: msToIso(row.inspect_started_at),
    inspectBeadId: row.inspect_bead_id ?? undefined,
    verificationStatus:
      (row.verification_status as ReviewStatus['verificationStatus']) ?? undefined,
    verificationNotes: row.verification_notes ?? undefined,
    verificationCycleCount: row.verification_cycle_count ?? undefined,
    verificationMaxCycles: row.verification_max_cycles ?? undefined,
    reviewNotes: row.review_notes ?? undefined,
    testNotes: row.test_notes ?? undefined,
    mergeNotes: row.merge_notes ?? undefined,
    updatedAt: msToIso(row.updated_at) ?? new Date(0).toISOString(),
    readyForMerge: row.ready_for_merge === 1,
    autoRequeueCount: row.auto_requeue_count ?? undefined,
    mergeRetryCount: row.merge_retry_count ?? undefined,
    prUrl: row.pr_url ?? undefined,
    prHeadSha: row.pr_head_sha ?? undefined,
    prNumber: row.pr_number ?? undefined,
    stuck: row.stuck === 1 ? true : undefined,
    stuckReason: row.stuck_reason ?? undefined,
    stuckAt: msToIso(row.stuck_at),
    stuckDetails: row.stuck_details ?? undefined,
    reviewedAtCommit: row.reviewed_at_commit ?? undefined,
    reviewSpawnedAt: msToIso(row.review_spawned_at),
    conflictResolutionDispatchedAt: msToIso(row.conflict_resolution_dispatched_at),
    testRetryCount: row.test_retry_count ?? undefined,
    reviewRetryCount: row.review_retry_count ?? undefined,
    recoveryStartedAt: msToIso(row.recovery_started_at),
    deaconIgnored: row.deacon_ignored === 1 ? true : undefined,
    deaconIgnoredAt: msToIso(row.deacon_ignored_at),
    deaconIgnoredReason: row.deacon_ignored_reason ?? undefined,
    blockerReasons: row.blocker_reasons
      ? (JSON.parse(row.blocker_reasons) as BlockerReason[])
      : undefined,
    lastVerifiedCommit: row.last_verified_commit ?? undefined,
    mergeStep: row.merge_step ?? undefined,
    autoMerge:
      row.auto_merge === null || row.auto_merge === undefined
        ? undefined
        : row.auto_merge === 1,
    history: history.length > 0 ? history : undefined,
  });
}

function getHistorySync(issueId: string): StatusHistoryEntry[] {
  const db = getOverdeckDatabaseSync();
  const rows = db
    .prepare(
      `SELECT type, status, timestamp, notes FROM status_history
       WHERE issue_id = ? ORDER BY timestamp ASC`,
    )
    .all(issueId.toUpperCase()) as Array<{
    type: string;
    status: string;
    timestamp: number;
    notes: string | null;
  }>;
  return rows.map((r) => ({
    type: r.type as StatusHistoryEntry['type'],
    status: r.status,
    timestamp: new Date(r.timestamp).toISOString(),
    ...(r.notes ? { notes: r.notes } : {}),
  }));
}

// ── Write operations ─────────────────────────────────────────────────────────

export function upsertReviewStatusSync(status: ReviewStatus): void {
  const db = getOverdeckDatabaseSync();
  const s = { ...status, issueId: status.issueId.toUpperCase() };

  const upsert = db.transaction(() => {
    // Ensure the issues row exists so status_history FK is satisfied.
    db.prepare(
      `INSERT OR IGNORE INTO issues (id, stage, updated_at) VALUES (?, 'working', ?)`,
    ).run(s.issueId, Date.now());

    db.prepare(`
      INSERT INTO review_status (
        issue_id, review_status, test_status, merge_status,
        inspect_status, inspect_notes, inspect_started_at, inspect_bead_id,
        verification_status, verification_notes,
        verification_cycle_count, verification_max_cycles,
        review_notes, test_notes, merge_notes,
        updated_at, ready_for_merge, auto_requeue_count, merge_retry_count, pr_url,
        pr_head_sha, pr_number,
        stuck, stuck_reason, stuck_at, stuck_details,
        reviewed_at_commit, review_spawned_at, conflict_resolution_dispatched_at,
        test_retry_count, review_retry_count, recovery_started_at,
        deacon_ignored, deacon_ignored_at, deacon_ignored_reason,
        blocker_reasons, last_verified_commit, merge_step, auto_merge
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(issue_id) DO UPDATE SET
        review_status = excluded.review_status,
        test_status = excluded.test_status,
        merge_status = excluded.merge_status,
        inspect_status = excluded.inspect_status,
        inspect_notes = excluded.inspect_notes,
        inspect_started_at = excluded.inspect_started_at,
        inspect_bead_id = excluded.inspect_bead_id,
        verification_status = excluded.verification_status,
        verification_notes = excluded.verification_notes,
        verification_cycle_count = excluded.verification_cycle_count,
        verification_max_cycles = excluded.verification_max_cycles,
        review_notes = excluded.review_notes,
        test_notes = excluded.test_notes,
        merge_notes = excluded.merge_notes,
        updated_at = excluded.updated_at,
        ready_for_merge = excluded.ready_for_merge,
        auto_requeue_count = excluded.auto_requeue_count,
        merge_retry_count = excluded.merge_retry_count,
        pr_url = excluded.pr_url,
        pr_head_sha = excluded.pr_head_sha,
        pr_number = excluded.pr_number,
        stuck = excluded.stuck,
        stuck_reason = excluded.stuck_reason,
        stuck_at = excluded.stuck_at,
        stuck_details = excluded.stuck_details,
        reviewed_at_commit = excluded.reviewed_at_commit,
        review_spawned_at = excluded.review_spawned_at,
        conflict_resolution_dispatched_at = excluded.conflict_resolution_dispatched_at,
        test_retry_count = excluded.test_retry_count,
        review_retry_count = excluded.review_retry_count,
        recovery_started_at = excluded.recovery_started_at,
        deacon_ignored = excluded.deacon_ignored,
        deacon_ignored_at = excluded.deacon_ignored_at,
        deacon_ignored_reason = excluded.deacon_ignored_reason,
        blocker_reasons = excluded.blocker_reasons,
        last_verified_commit = excluded.last_verified_commit,
        merge_step = excluded.merge_step,
        auto_merge = excluded.auto_merge
    `).run(
      s.issueId,
      s.reviewStatus,
      s.testStatus,
      s.mergeStatus ?? null,
      s.inspectStatus ?? null,
      s.inspectNotes ?? null,
      isoToMs(s.inspectStartedAt),
      s.inspectBeadId ?? null,
      s.verificationStatus ?? null,
      s.verificationNotes ?? null,
      s.verificationCycleCount ?? null,
      s.verificationMaxCycles ?? null,
      s.reviewNotes ?? null,
      s.testNotes ?? null,
      s.mergeNotes ?? null,
      isoToMs(s.updatedAt) ?? Date.now(),
      s.readyForMerge ? 1 : 0,
      s.autoRequeueCount ?? null,
      s.mergeRetryCount ?? null,
      s.prUrl ?? null,
      s.prHeadSha ?? null,
      s.prNumber ?? null,
      s.stuck ? 1 : 0,
      s.stuckReason ?? null,
      isoToMs(s.stuckAt),
      s.stuckDetails ?? null,
      s.reviewedAtCommit ?? null,
      isoToMs(s.reviewSpawnedAt),
      isoToMs(s.conflictResolutionDispatchedAt),
      s.testRetryCount ?? null,
      s.reviewRetryCount ?? null,
      isoToMs(s.recoveryStartedAt),
      s.deaconIgnored ? 1 : 0,
      isoToMs(s.deaconIgnoredAt),
      s.deaconIgnoredReason ?? null,
      s.blockerReasons ? JSON.stringify(s.blockerReasons) : null,
      s.lastVerifiedCommit ?? null,
      s.mergeStep ?? null,
      s.autoMerge === undefined ? null : s.autoMerge ? 1 : 0,
    );

    if (s.history && s.history.length > 0) {
      const insertHistory = db.prepare(
        `INSERT OR IGNORE INTO status_history (issue_id, type, status, timestamp, notes)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const entry of s.history) {
        insertHistory.run(s.issueId, entry.type, entry.status, new Date(entry.timestamp).getTime(), entry.notes ?? null);
      }
    }
  });

  upsert();
}

export function deleteReviewStatus(issueId: string): void {
  const db = getOverdeckDatabaseSync();
  db.prepare('DELETE FROM review_status WHERE issue_id = ?').run(issueId.toUpperCase());
}

// ── Read operations ──────────────────────────────────────────────────────────

export function getReviewStatusFromDbSync(issueId: string): ReviewStatus | null {
  const db = getOverdeckDatabaseSync();
  const normalizedId = issueId.toUpperCase();
  const row = db
    .prepare('SELECT * FROM review_status WHERE issue_id = ?')
    .get(normalizedId) as DbRow | undefined;
  if (!row) return null;
  return rowToReviewStatus(row, getHistorySync(normalizedId));
}

export function getAllReviewStatusesFromDb(): Record<string, ReviewStatus> {
  const db = getOverdeckDatabaseSync();
  const rows = db
    .prepare('SELECT * FROM review_status ORDER BY updated_at DESC')
    .all() as DbRow[];

  const historyRows = db
    .prepare(
      `SELECT issue_id, type, status, timestamp, notes FROM status_history
       ORDER BY issue_id, timestamp ASC`,
    )
    .all() as Array<{
    issue_id: string;
    type: string;
    status: string;
    timestamp: string;
    notes: string | null;
  }>;

  const historyByIssue = new Map<string, StatusHistoryEntry[]>();
  for (const row of historyRows) {
    const bucket = historyByIssue.get(row.issue_id) ?? [];
    bucket.push({
      type: row.type as StatusHistoryEntry['type'],
      status: row.status,
      timestamp: row.timestamp,
      ...(row.notes ? { notes: row.notes } : {}),
    });
    historyByIssue.set(row.issue_id, bucket);
  }

  const result: Record<string, ReviewStatus> = {};
  for (const row of rows) {
    result[row.issue_id] = rowToReviewStatus(row, historyByIssue.get(row.issue_id) ?? []);
  }
  return result;
}

export function getReviewStatusesFromDb(issueIds: string[]): Record<string, ReviewStatus> {
  const normalizedIds = [...new Set(issueIds.map((id) => id.toUpperCase()).filter(Boolean))];
  if (normalizedIds.length === 0) return {};
  const db = getOverdeckDatabaseSync();
  const placeholders = normalizedIds.map(() => '?').join(', ');

  const rows = db
    .prepare(
      `SELECT * FROM review_status WHERE issue_id IN (${placeholders}) ORDER BY updated_at DESC`,
    )
    .all(...normalizedIds) as DbRow[];
  if (rows.length === 0) return {};

  const historyRows = db
    .prepare(
      `SELECT issue_id, type, status, timestamp, notes FROM status_history
       WHERE issue_id IN (${placeholders}) ORDER BY issue_id, timestamp ASC`,
    )
    .all(...normalizedIds) as Array<{
    issue_id: string;
    type: string;
    status: string;
    timestamp: string;
    notes: string | null;
  }>;

  const historyByIssue = new Map<string, StatusHistoryEntry[]>();
  for (const row of historyRows) {
    const bucket = historyByIssue.get(row.issue_id) ?? [];
    bucket.push({
      type: row.type as StatusHistoryEntry['type'],
      status: row.status,
      timestamp: row.timestamp,
      ...(row.notes ? { notes: row.notes } : {}),
    });
    historyByIssue.set(row.issue_id, bucket);
  }

  const result: Record<string, ReviewStatus> = {};
  for (const row of rows) {
    result[row.issue_id] = rowToReviewStatus(row, historyByIssue.get(row.issue_id) ?? []);
  }
  return result;
}

// ── Stuck state helpers ──────────────────────────────────────────────────────

export function markWorkspaceStuck(
  issueId: string,
  reason: string,
  details?: Record<string, unknown>,
): void {
  const db = getOverdeckDatabaseSync();
  const now = Date.now();
  const detailsJson = details ? JSON.stringify(details) : null;
  db.prepare(`
    INSERT OR IGNORE INTO review_status
      (issue_id, review_status, test_status, updated_at, ready_for_merge,
       stuck, stuck_reason, stuck_at, stuck_details)
    VALUES (?, 'pending', 'pending', ?, 0, 1, ?, ?, ?)
  `).run(issueId.toUpperCase(), now, reason, now, detailsJson);
  db.prepare(`
    UPDATE review_status
    SET stuck = 1, stuck_reason = ?, stuck_at = ?, stuck_details = ?, updated_at = ?
    WHERE issue_id = ?
  `).run(reason, now, detailsJson, now, issueId.toUpperCase());
}

export function clearWorkspaceStuck(issueId: string): void {
  const db = getOverdeckDatabaseSync();
  const now = Date.now();
  db.prepare(`
    UPDATE review_status
    SET stuck = 0, stuck_reason = NULL, stuck_at = NULL, stuck_details = NULL, updated_at = ?
    WHERE issue_id = ?
  `).run(now, issueId.toUpperCase());
}

export function setDeaconIgnored(
  issueId: string,
  ignored: boolean,
  reason?: string,
): void {
  const db = getOverdeckDatabaseSync();
  const now = Date.now();
  db.prepare(`
    INSERT OR IGNORE INTO review_status
      (issue_id, review_status, test_status, updated_at, ready_for_merge, deacon_ignored)
    VALUES (?, 'pending', 'pending', ?, 0, 0)
  `).run(issueId.toUpperCase(), now);
  db.prepare(`
    UPDATE review_status
    SET deacon_ignored = ?, deacon_ignored_at = ?, deacon_ignored_reason = ?, updated_at = ?
    WHERE issue_id = ?
  `).run(ignored ? 1 : 0, ignored ? now : null, reason ?? null, now, issueId.toUpperCase());
}

export function setAutoMerge(issueId: string, autoMerge: boolean | null): void {
  const db = getOverdeckDatabaseSync();
  const now = Date.now();
  db.prepare(`
    INSERT OR IGNORE INTO review_status
      (issue_id, review_status, test_status, updated_at, ready_for_merge)
    VALUES (?, 'pending', 'pending', ?, 0)
  `).run(issueId.toUpperCase(), now);
  db.prepare(`
    UPDATE review_status SET auto_merge = ?, updated_at = ? WHERE issue_id = ?
  `).run(
    autoMerge === null ? null : autoMerge ? 1 : 0,
    now,
    issueId.toUpperCase(),
  );
}

// ── Merge-blocker reconcile candidates ───────────────────────────────────────

export interface MergeBlockerReconcileCandidate {
  issueId: string;
  prUrl: string | undefined;
  blockerReasons: BlockerReason[] | undefined;
  readyForMerge: boolean;
}

/**
 * Sync query for merge-blocker reconcile service.
 * Drop-in for getMergeBlockerReconcileCandidatesSync() from review-status-db.ts.
 */
export function getMergeBlockerReconcileCandidatesSync(): MergeBlockerReconcileCandidate[] {
  const db = getOverdeckDatabaseSync();
  const rows = db.prepare(`
    SELECT issue_id, pr_url, blocker_reasons, ready_for_merge
    FROM review_status
    WHERE ready_for_merge = 1
      OR blocker_reasons LIKE '%merge_conflict%'
      OR blocker_reasons LIKE '%not_mergeable%'
  `).all() as Array<{
    issue_id: string;
    pr_url: string | null;
    blocker_reasons: string | null;
    ready_for_merge: number;
  }>;

  return rows.map((row) => ({
    issueId: row.issue_id.toUpperCase(),
    prUrl: row.pr_url ?? undefined,
    blockerReasons: row.blocker_reasons ? JSON.parse(row.blocker_reasons) : undefined,
    readyForMerge: row.ready_for_merge === 1,
  }));
}

/**
 * Effect wrapper for getMergeBlockerReconcileCandidatesSync.
 * Drop-in for getMergeBlockerReconcileCandidates() from review-status-db.ts.
 */
export const getMergeBlockerReconcileCandidates = (): Effect.Effect<MergeBlockerReconcileCandidate[]> =>
  Effect.promise(() =>
    new Promise<MergeBlockerReconcileCandidate[]>((resolve, reject) => {
      setImmediate(() => {
        try {
          resolve(getMergeBlockerReconcileCandidatesSync());
        } catch (err) {
          reject(err);
        }
      });
    }),
  );
