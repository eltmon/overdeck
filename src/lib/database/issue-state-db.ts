/**
 * Issue-state database accessors (PAN-805).
 *
 * Strictly-typed getters/setters for the issue_state and label_sync_audit tables.
 */

import { getDatabase } from './index.js';

export type CanonicalState = 'todo' | 'in_progress' | 'in_review' | 'merged' | 'closed_wontfix';

export interface IssueStateRow {
  issue_id: string;
  canonical_state: CanonicalState;
  last_synced_at: string;
  pending_mutation: string | null;
  updated_at: string;
}

export interface AuditRow {
  issue_id: string;
  attempted_at: string;
  target_label: string;
  action: 'add' | 'remove';
  outcome: 'success' | 'failure' | 'rate_limited' | 'skipped';
  reason: string | null;
  retry_count: number;
  http_status: number | null;
}

/** Read a single issue_state row (returns undefined if not tracked). */
export function getIssueState(issueId: string): IssueStateRow | undefined {
  const db = getDatabase();
  return db
    .prepare('SELECT * FROM issue_state WHERE issue_id = ?')
    .get(issueId) as IssueStateRow | undefined;
}

/** Upsert an issue_state row. */
export function upsertIssueState(row: Omit<IssueStateRow, 'updated_at'> & { updated_at?: string }): void {
  const db = getDatabase();
  const now = row.updated_at ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO issue_state (issue_id, canonical_state, last_synced_at, pending_mutation, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(issue_id) DO UPDATE SET
       canonical_state = excluded.canonical_state,
       last_synced_at = excluded.last_synced_at,
       pending_mutation = COALESCE(excluded.pending_mutation, pending_mutation),
       updated_at = excluded.updated_at`
  ).run(row.issue_id, row.canonical_state, row.last_synced_at, row.pending_mutation ?? null, now);
}

/** Write a single audit row to label_sync_audit. */
export function writeAuditRow(entry: AuditRow): void {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO label_sync_audit (
      issue_id, attempted_at, target_label, action, outcome, reason, retry_count, http_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.issue_id,
    entry.attempted_at,
    entry.target_label,
    entry.action,
    entry.outcome,
    entry.reason ?? null,
    entry.retry_count,
    entry.http_status ?? null,
  );
}
