/**
 * Overdeck door for git_operations — persistent log of git push/fetch/merge
 * events. Replaces database/git-operations-db.ts.
 *
 * Uses getOverdeckDatabaseSync() with CREATE TABLE IF NOT EXISTS guards for
 * existing overdeck.db instances that predate this migration addition.
 */

import { getOverdeckDatabaseSync } from './infra.js';

// ─── Schema bootstrap ─────────────────────────────────────────────────────────

let _schemaBootstrapped = false;

function ensureSchema(): void {
  if (_schemaBootstrapped) return;
  const db = getOverdeckDatabaseSync();
  db.exec(`
    CREATE TABLE IF NOT EXISTS git_operations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      operation  TEXT    NOT NULL,
      branch     TEXT,
      issue_id   TEXT,
      before_sha TEXT,
      after_sha  TEXT,
      remote_sha TEXT,
      status     TEXT    NOT NULL,
      error      TEXT,
      ts         TEXT    NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_git_ops_ts ON git_operations(ts)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_git_ops_issue ON git_operations(issue_id, ts)`);
  _schemaBootstrapped = true;
}

function overdeckDb() {
  ensureSchema();
  return getOverdeckDatabaseSync();
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type GitOperationType =
  | 'push'
  | 'force_push'
  | 'fetch'
  | 'merge'
  | 'rev_parse'
  | 'main_diverged'
  | 'push_attempt'
  | 'fetch_attempt'
  | 'push_rejected'
  | 'non_ff'
  | 'force_push_cmd'
  | 'retry'
  | 'remote_rejected'
  | 'push_noop';

export type GitOperationStatus = 'success' | 'failure' | 'aborted';

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

export interface GitOperationFilter {
  issueId?: string;
  operation?: GitOperationType;
  status?: GitOperationStatus;
  since?: string;
  limit?: number;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function appendGitOperationSync(op: Omit<GitOperation, 'id'>): number {
  const result = overdeckDb().prepare(`
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

export function listGitOperationsSync(filter: GitOperationFilter = {}): GitOperation[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filter.issueId) { conditions.push('issue_id = ?'); params.push(filter.issueId); }
  if (filter.operation) { conditions.push('operation = ?'); params.push(filter.operation); }
  if (filter.status) { conditions.push('status = ?'); params.push(filter.status); }
  if (filter.since) { conditions.push('ts >= ?'); params.push(filter.since); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filter.limit ? `LIMIT ${filter.limit}` : 'LIMIT 500';

  const rows = overdeckDb().prepare(`
    SELECT id, operation, branch, issue_id, before_sha, after_sha, remote_sha, status, error, ts
    FROM git_operations ${where} ORDER BY ts DESC ${limit}
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
