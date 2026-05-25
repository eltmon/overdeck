import { Effect } from 'effect';
import { DatabaseError, getDatabase } from './index.js';

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

interface FlywheelSubstrateBugRow {
  issue_id: string;
  filed_at: string;
  run_id: string | null;
  filed_by: FlywheelSubstrateBugFiledBy;
  discovered_in_issue_id: string | null;
  severity: string;
  status: FlywheelSubstrateBugStatus;
  fix_merged_at: string | null;
  fix_commit_sha: string | null;
  updated_at: string;
}

function mapRow(row: FlywheelSubstrateBugRow): FlywheelSubstrateBug {
  return {
    issueId: row.issue_id,
    filedAt: row.filed_at,
    runId: row.run_id,
    filedBy: row.filed_by,
    discoveredInIssueId: row.discovered_in_issue_id,
    severity: row.severity,
    status: row.status,
    fixMergedAt: row.fix_merged_at,
    fixCommitSha: row.fix_commit_sha,
    updatedAt: row.updated_at,
  };
}

export function upsert(input: UpsertFlywheelSubstrateBugInput): FlywheelSubstrateBug {
  return Effect.runSync(
    Effect.try({
      try: () => {
        const db = getDatabase();
        db.prepare(`
          INSERT INTO flywheel_substrate_bugs (
            issue_id,
            filed_at,
            run_id,
            filed_by,
            discovered_in_issue_id,
            severity,
            status,
            fix_merged_at,
            fix_commit_sha,
            updated_at
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
          SELECT issue_id, filed_at, run_id, filed_by, discovered_in_issue_id, severity, status, fix_merged_at, fix_commit_sha, updated_at
          FROM flywheel_substrate_bugs
          WHERE issue_id = ?
        `).get(input.issueId) as FlywheelSubstrateBugRow;
        return mapRow(row);
      },
      catch: (cause) => new DatabaseError({ operation: 'upsertFlywheelSubstrateBug', cause }),
    }),
  );
}

export function getByIssueId(issueId: string): FlywheelSubstrateBug | null {
  return Effect.runSync(
    Effect.try({
      try: () => {
        const row = getDatabase().prepare(`
          SELECT issue_id, filed_at, run_id, filed_by, discovered_in_issue_id, severity, status, fix_merged_at, fix_commit_sha, updated_at
          FROM flywheel_substrate_bugs
          WHERE issue_id = ?
        `).get(issueId) as FlywheelSubstrateBugRow | undefined;
        return row ? mapRow(row) : null;
      },
      catch: (cause) => new DatabaseError({ operation: 'getFlywheelSubstrateBugByIssueId', cause }),
    }),
  );
}

export function listInWindow(since: string, until = new Date().toISOString()): FlywheelSubstrateBug[] {
  return Effect.runSync(
    Effect.try({
      try: () => {
        const rows = getDatabase().prepare(`
          SELECT issue_id, filed_at, run_id, filed_by, discovered_in_issue_id, severity, status, fix_merged_at, fix_commit_sha, updated_at
          FROM flywheel_substrate_bugs
          WHERE filed_at >= ? AND filed_at <= ?
          ORDER BY filed_at ASC, issue_id ASC
        `).all(since, until) as FlywheelSubstrateBugRow[];
        return rows.map(mapRow);
      },
      catch: (cause) => new DatabaseError({ operation: 'listFlywheelSubstrateBugsInWindow', cause }),
    }),
  );
}

export function markFixed(issueId: string, commitSha: string, mergedAt: string): FlywheelSubstrateBug | null {
  return Effect.runSync(
    Effect.try({
      try: () => {
        const db = getDatabase();
        db.prepare(`
          UPDATE flywheel_substrate_bugs
          SET status = 'fixed', fix_commit_sha = ?, fix_merged_at = ?, updated_at = ?
          WHERE issue_id = ?
        `).run(commitSha, mergedAt, mergedAt, issueId);

        const row = db.prepare(`
          SELECT issue_id, filed_at, run_id, filed_by, discovered_in_issue_id, severity, status, fix_merged_at, fix_commit_sha, updated_at
          FROM flywheel_substrate_bugs
          WHERE issue_id = ?
        `).get(issueId) as FlywheelSubstrateBugRow | undefined;
        return row ? mapRow(row) : null;
      },
      catch: (cause) => new DatabaseError({ operation: 'markFlywheelSubstrateBugFixed', cause }),
    }),
  );
}
