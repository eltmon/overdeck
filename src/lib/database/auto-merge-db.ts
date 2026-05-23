import { getDatabase, DatabaseError } from './index.js';
export { DatabaseError };

export type AutoMergeStatus = 'pending' | 'executing' | 'cancelled' | 'executed' | 'aborted' | 'failed';

export interface AutoMergeRow {
  issueId: string;
  scheduledAt: string;
  executeAt: string;
  status: AutoMergeStatus;
  cancelReason: string | null;
  abortReason: string | null;
}

interface DbAutoMergeRow {
  issue_id: string;
  scheduled_at: string;
  execute_at: string;
  status: AutoMergeStatus;
  cancel_reason: string | null;
  abort_reason: string | null;
}

export function schedulePendingAutoMerge(issueId: string, executeAt: string): boolean {
  const db = getDatabase();
  const result = db.prepare(`
    INSERT INTO auto_merge (issue_id, scheduled_at, execute_at, status, cancel_reason, abort_reason)
    VALUES (?, ?, ?, 'pending', NULL, NULL)
    ON CONFLICT(issue_id) DO UPDATE SET
      scheduled_at = excluded.scheduled_at,
      execute_at = excluded.execute_at,
      status = 'pending',
      cancel_reason = NULL,
      abort_reason = NULL
    WHERE auto_merge.status != 'pending'
  `).run(issueId.toUpperCase(), new Date().toISOString(), executeAt);

  return result.changes === 1;
}

export function cancelPendingAutoMerge(issueId: string, reason: string): boolean {
  const db = getDatabase();
  const result = db.prepare(`
    UPDATE auto_merge
    SET status = 'cancelled', cancel_reason = ?
    WHERE issue_id = ? AND status = 'pending'
  `).run(reason, issueId.toUpperCase());

  return result.changes === 1;
}

export function markAutoMergeExecuting(issueId: string): boolean {
  const db = getDatabase();
  const result = db.prepare(`
    UPDATE auto_merge
    SET status = 'executing'
    WHERE issue_id = ? AND status = 'pending'
  `).run(issueId.toUpperCase());

  return result.changes === 1;
}

export function markAutoMergeExecuted(issueId: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE auto_merge
    SET status = 'executed'
    WHERE issue_id = ? AND status = 'executing'
  `).run(issueId.toUpperCase());
}

export function markAutoMergeAborted(issueId: string, reason: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE auto_merge
    SET status = 'aborted', abort_reason = ?
    WHERE issue_id = ? AND status IN ('pending', 'executing')
  `).run(reason, issueId.toUpperCase());
}

export function markAutoMergeFailed(issueId: string, reason: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE auto_merge
    SET status = 'failed', abort_reason = ?
    WHERE issue_id = ? AND status = 'executing'
  `).run(reason, issueId.toUpperCase());
}

export function getPendingAutoMerges(): AutoMergeRow[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT issue_id, scheduled_at, execute_at, status, cancel_reason, abort_reason
    FROM auto_merge
    WHERE status = 'pending'
    ORDER BY execute_at ASC, issue_id ASC
  `).all() as DbAutoMergeRow[];

  return rows.map(rowToAutoMerge);
}

export function getAutoMergeStatus(issueId: string): AutoMergeRow | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT issue_id, scheduled_at, execute_at, status, cancel_reason, abort_reason
    FROM auto_merge
    WHERE issue_id = ?
  `).get(issueId.toUpperCase()) as DbAutoMergeRow | undefined;

  return row ? rowToAutoMerge(row) : null;
}

function rowToAutoMerge(row: DbAutoMergeRow): AutoMergeRow {
  return {
    issueId: row.issue_id,
    scheduledAt: row.scheduled_at,
    executeAt: row.execute_at,
    status: row.status,
    cancelReason: row.cancel_reason,
    abortReason: row.abort_reason,
  };
}
