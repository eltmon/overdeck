/**
 * Git Activity Service (PAN-653)
 *
 * Write path and read path for git operation events persisted to the
 * git_operations SQLite table. Survives dashboard restart — unlike the
 * in-memory activityLog array which is capped at 100 and wiped on restart.
 *
 * All functions use the async-safe getDatabase() which runs under Node 22.
 * NEVER use execSync/readFileSync here — this runs in the dashboard server.
 */

import { getDatabase } from '../../../lib/database/index.js';

/** Operation types that can be recorded */
export type GitOperationType =
  | 'push'
  | 'force_push'
  | 'fetch'
  | 'merge'
  | 'rev_parse'
  | 'main_diverged'
  // Scan-pattern types detected from tmux capture-pane output
  | 'push_attempt'
  | 'fetch_attempt'
  | 'push_rejected'
  | 'non_ff'
  | 'force_push_cmd'
  | 'retry'
  | 'remote_rejected'
  | 'push_noop';

/** Status of the git operation */
export type GitOperationStatus = 'success' | 'failure' | 'aborted';

/** A single git operation record */
export interface GitOperation {
  id?: number;
  operation: GitOperationType;
  branch?: string;
  issueId?: string;
  beforeSha?: string;
  afterSha?: string;
  remoteSha?: string;
  status: GitOperationStatus;
  error?: string;
  ts: string;
}

/** Filter options for listGitOperations */
export interface GitOperationFilter {
  issueId?: string;
  operation?: GitOperationType;
  status?: GitOperationStatus;
  /** ISO timestamp — only return rows at or after this time */
  since?: string;
  limit?: number;
}

/**
 * Append a git operation event to the persistent log.
 * Called by git helper wrappers (src/lib/git/operations.ts) after each operation.
 */
export function appendGitOperation(op: Omit<GitOperation, 'id'>): number {
  const db = getDatabase();
  const result = db.prepare(`
    INSERT INTO git_operations (
      operation, branch, issue_id,
      before_sha, after_sha, remote_sha,
      status, error, ts
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    op.operation,
    op.branch ?? null,
    op.issueId ?? null,
    op.beforeSha ?? null,
    op.afterSha ?? null,
    op.remoteSha ?? null,
    op.status,
    op.error ?? null,
    op.ts,
  );
  return result.lastInsertRowid as number;
}

/**
 * List git operation events, optionally filtered.
 * Results are ordered by ts DESC (most recent first).
 */
export function listGitOperations(filter: GitOperationFilter = {}): GitOperation[] {
  const db = getDatabase();

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filter.issueId) {
    conditions.push('issue_id = ?');
    params.push(filter.issueId);
  }
  if (filter.operation) {
    conditions.push('operation = ?');
    params.push(filter.operation);
  }
  if (filter.status) {
    conditions.push('status = ?');
    params.push(filter.status);
  }
  if (filter.since) {
    conditions.push('ts >= ?');
    params.push(filter.since);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filter.limit ? `LIMIT ${filter.limit}` : 'LIMIT 500';

  const rows = db.prepare(`
    SELECT id, operation, branch, issue_id, before_sha, after_sha, remote_sha, status, error, ts
    FROM git_operations
    ${where}
    ORDER BY ts DESC
    ${limit}
  `).all(...params) as Array<{
    id: number;
    operation: string;
    branch: string | null;
    issue_id: string | null;
    before_sha: string | null;
    after_sha: string | null;
    remote_sha: string | null;
    status: string;
    error: string | null;
    ts: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    operation: row.operation as GitOperationType,
    branch: row.branch ?? undefined,
    issueId: row.issue_id ?? undefined,
    beforeSha: row.before_sha ?? undefined,
    afterSha: row.after_sha ?? undefined,
    remoteSha: row.remote_sha ?? undefined,
    status: row.status as GitOperationStatus,
    error: row.error ?? undefined,
    ts: row.ts,
  }));
}
