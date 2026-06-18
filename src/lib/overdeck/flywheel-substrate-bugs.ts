/**
 * flywheel-substrate-bugs.ts — Sync accessors for flywheel_substrate_bugs in overdeck.db.
 *
 * Replaces direct `getDatabase()` calls in:
 *   src/lib/database/flywheel-substrate-bugs-db.ts
 *
 * Live consumers:
 *   - substrate-bug-poller.ts: upsert, getByIssueId, markFixed
 *   - flywheel-telemetry.ts:   listInWindow
 *
 * The table uses TEXT timestamps (ISO-8601 strings) to match the old panopticon.db
 * contract so callers need no structural changes.
 *
 * NOTE: This door calls CREATE TABLE IF NOT EXISTS on first use so that
 * existing overdeck.db instances (created before the table was added to
 * 0000_overdeck_init.sql) get the table automatically.
 */

import { getOverdeckDatabaseSync } from './infra.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type FlywheelSubstrateBugFiledBy = 'agent' | 'operator';
export type FlywheelSubstrateBugStatus = 'open' | 'fixed';

export interface FlywheelSubstrateBug {
  issueId: string;
  filedAt: string;
  runId: string | null;
  filedBy: FlywheelSubstrateBugFiledBy;
  discoveredInIssueId: string | null;
  severity: string;
  status: FlywheelSubstrateBugStatus;
  fixMergedAt: string | null;
  fixCommitSha: string | null;
  updatedAt: string;
}

export interface UpsertFlywheelSubstrateBugInput {
  issueId: string;
  filedAt: string;
  runId?: string | null;
  filedBy: FlywheelSubstrateBugFiledBy;
  discoveredInIssueId?: string | null;
  severity?: string;
  status?: FlywheelSubstrateBugStatus;
  fixMergedAt?: string | null;
  fixCommitSha?: string | null;
  updatedAt: string;
}

// ── Internal ─────────────────────────────────────────────────────────────────

interface Row {
  issue_id: string;
  filed_at: string;
  run_id: string | null;
  filed_by: string;
  discovered_in_issue_id: string | null;
  severity: string;
  status: string;
  fix_merged_at: string | null;
  fix_commit_sha: string | null;
  updated_at: string;
}

function mapRow(row: Row): FlywheelSubstrateBug {
  return {
    issueId: row.issue_id,
    filedAt: row.filed_at,
    runId: row.run_id,
    filedBy: row.filed_by as FlywheelSubstrateBugFiledBy,
    discoveredInIssueId: row.discovered_in_issue_id,
    severity: row.severity,
    status: row.status as FlywheelSubstrateBugStatus,
    fixMergedAt: row.fix_merged_at,
    fixCommitSha: row.fix_commit_sha,
    updatedAt: row.updated_at,
  };
}

/** Ensure the table exists for databases created before this table was added. */
function ensureTable(): ReturnType<typeof getOverdeckDatabaseSync> {
  const db = getOverdeckDatabaseSync();
  db.exec(`
    CREATE TABLE IF NOT EXISTS flywheel_substrate_bugs (
      issue_id TEXT PRIMARY KEY NOT NULL,
      filed_at TEXT NOT NULL,
      run_id TEXT,
      filed_by TEXT NOT NULL,
      discovered_in_issue_id TEXT,
      severity TEXT NOT NULL DEFAULT 'P2',
      status TEXT NOT NULL DEFAULT 'open',
      fix_merged_at TEXT,
      fix_commit_sha TEXT,
      updated_at TEXT NOT NULL
    )
  `);
  return db;
}

// ── Write ─────────────────────────────────────────────────────────────────────

/** Drop-in for upsert() from database/flywheel-substrate-bugs-db.ts. */
export function upsert(input: UpsertFlywheelSubstrateBugInput): FlywheelSubstrateBug {
  const db = ensureTable();
  db.prepare(`
    INSERT INTO flywheel_substrate_bugs (
      issue_id, filed_at, run_id, filed_by, discovered_in_issue_id,
      severity, status, fix_merged_at, fix_commit_sha, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(issue_id) DO UPDATE SET
      filed_at = excluded.filed_at,
      run_id = excluded.run_id,
      filed_by = excluded.filed_by,
      discovered_in_issue_id = excluded.discovered_in_issue_id,
      severity = excluded.severity,
      status = CASE WHEN ? = 1 THEN excluded.status ELSE flywheel_substrate_bugs.status END,
      fix_merged_at = CASE WHEN ? = 1 THEN excluded.fix_merged_at ELSE flywheel_substrate_bugs.fix_merged_at END,
      fix_commit_sha = CASE WHEN ? = 1 THEN excluded.fix_commit_sha ELSE flywheel_substrate_bugs.fix_commit_sha END,
      updated_at = excluded.updated_at
  `).run(
    input.issueId,
    input.filedAt,
    input.runId ?? null,
    input.filedBy,
    input.discoveredInIssueId ?? null,
    input.severity ?? 'P2',
    input.status ?? 'open',
    input.fixMergedAt ?? null,
    input.fixCommitSha ?? null,
    input.updatedAt,
    input.status === undefined ? 0 : 1,
    input.fixMergedAt === undefined ? 0 : 1,
    input.fixCommitSha === undefined ? 0 : 1,
  );

  const row = db.prepare(`
    SELECT issue_id, filed_at, run_id, filed_by, discovered_in_issue_id,
           severity, status, fix_merged_at, fix_commit_sha, updated_at
    FROM flywheel_substrate_bugs WHERE issue_id = ?
  `).get(input.issueId) as Row;
  return mapRow(row);
}

/** Drop-in for markFixed() from database/flywheel-substrate-bugs-db.ts. */
export function markFixed(issueId: string, commitSha: string, mergedAt: string): FlywheelSubstrateBug | null {
  const db = ensureTable();
  db.prepare(`
    UPDATE flywheel_substrate_bugs
    SET status = 'fixed', fix_commit_sha = ?, fix_merged_at = ?, updated_at = ?
    WHERE issue_id = ?
  `).run(commitSha, mergedAt, mergedAt, issueId);

  const row = db.prepare(`
    SELECT issue_id, filed_at, run_id, filed_by, discovered_in_issue_id,
           severity, status, fix_merged_at, fix_commit_sha, updated_at
    FROM flywheel_substrate_bugs WHERE issue_id = ?
  `).get(issueId) as Row | undefined;
  return row ? mapRow(row) : null;
}

// ── Read ──────────────────────────────────────────────────────────────────────

/** Drop-in for getByIssueId() from database/flywheel-substrate-bugs-db.ts. */
export function getByIssueId(issueId: string): FlywheelSubstrateBug | null {
  const db = ensureTable();
  const row = db.prepare(`
    SELECT issue_id, filed_at, run_id, filed_by, discovered_in_issue_id,
           severity, status, fix_merged_at, fix_commit_sha, updated_at
    FROM flywheel_substrate_bugs WHERE issue_id = ?
  `).get(issueId) as Row | undefined;
  return row ? mapRow(row) : null;
}

/** Drop-in for listInWindow() from database/flywheel-substrate-bugs-db.ts. */
export function listInWindow(since: string, until = new Date().toISOString()): FlywheelSubstrateBug[] {
  const db = ensureTable();
  const rows = db.prepare(`
    SELECT issue_id, filed_at, run_id, filed_by, discovered_in_issue_id,
           severity, status, fix_merged_at, fix_commit_sha, updated_at
    FROM flywheel_substrate_bugs
    WHERE filed_at >= ? AND filed_at <= ?
    ORDER BY filed_at ASC, issue_id ASC
  `).all(since, until) as Row[];
  return rows.map(mapRow);
}
