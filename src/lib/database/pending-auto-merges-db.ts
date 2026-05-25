import { Effect } from 'effect';
import { DatabaseError, getDatabase } from './index.js';

export type PendingAutoMergeStatus = 'pending' | 'merging' | 'blocked' | 'failed' | 'merged' | 'cancelled';

export interface PendingAutoMerge {
  id: number;
  issueId: string;
  prUrl: string;
  prNumber?: number;
  projectKey: string;
  status: PendingAutoMergeStatus;
  /** Absolute ISO timestamp for when the server may attempt the merge; survives process sleep. */
  scheduledMergeAt: string;
  /** Absolute ISO timestamp for when this cooldown entry was scheduled; survives process sleep. */
  scheduledAt: string;
  mergedAt?: string;
  /** Free-text failure/blocker detail, truncated to 1024 characters. */
  failureReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;
}

export interface ScheduleAutoMergeInput {
  issueId: string;
  prUrl: string;
  prNumber?: number;
  projectKey: string;
  scheduledMergeAt: string;
  scheduledAt?: string;
}

interface PendingAutoMergeRow {
  id: number;
  issueId: string;
  prUrl: string;
  prNumber: number | null;
  projectKey: string;
  status: PendingAutoMergeStatus;
  scheduledMergeAt: string;
  scheduledAt: string;
  mergedAt: string | null;
  failureReason: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
}

function toPendingAutoMerge(row: PendingAutoMergeRow): PendingAutoMerge {
  return {
    id: row.id,
    issueId: row.issueId,
    prUrl: row.prUrl,
    prNumber: row.prNumber ?? undefined,
    projectKey: row.projectKey,
    status: row.status,
    scheduledMergeAt: row.scheduledMergeAt,
    scheduledAt: row.scheduledAt,
    mergedAt: row.mergedAt ?? undefined,
    failureReason: row.failureReason ?? undefined,
    cancelledAt: row.cancelledAt ?? undefined,
    cancelledBy: row.cancelledBy ?? undefined,
  };
}

function truncateReason(reason: string): string {
  return reason.length > 1024 ? reason.slice(0, 1024) : reason;
}

const selectById = (id: number): PendingAutoMerge | null => {
  const row = getDatabase()
    .prepare('SELECT * FROM pending_auto_merges WHERE id = ?')
    .get(id) as PendingAutoMergeRow | undefined;
  return row ? toPendingAutoMerge(row) : null;
};

const selectActiveByIssue = (issueId: string): PendingAutoMerge | null => {
  const row = getDatabase()
    .prepare("SELECT * FROM pending_auto_merges WHERE issueId = ? AND \"status\" IN ('pending','merging') ORDER BY id DESC LIMIT 1")
    .get(issueId) as PendingAutoMergeRow | undefined;
  return row ? toPendingAutoMerge(row) : null;
};

function runDb<T>(operation: string, fn: () => T): T {
  return Effect.runSync(
    Effect.try({
      try: fn,
      catch: (cause) => new DatabaseError({ operation, cause }),
    }),
  );
}

export function scheduleAutoMerge(input: ScheduleAutoMergeInput): PendingAutoMerge {
  return runDb('scheduleAutoMerge', () => {
    const existing = selectActiveByIssue(input.issueId);
    if (existing) return existing;

    const db = getDatabase();
    const scheduledAt = input.scheduledAt ?? new Date().toISOString();
    try {
      const result = db.prepare(`
        INSERT INTO pending_auto_merges (
          issueId, prUrl, prNumber, projectKey, "status", scheduledMergeAt, scheduledAt
        ) VALUES (?, ?, ?, ?, 'pending', ?, ?)
      `).run(input.issueId, input.prUrl, input.prNumber ?? null, input.projectKey, input.scheduledMergeAt, scheduledAt);
      return selectById(Number(result.lastInsertRowid))!;
    } catch (error) {
      const raced = selectActiveByIssue(input.issueId);
      if (raced) return raced;
      throw error;
    }
  });
}

export function getPendingAutoMerge(issueId: string): PendingAutoMerge | null {
  return runDb('getPendingAutoMerge', () => selectActiveByIssue(issueId));
}

export function listPendingAutoMerges(): PendingAutoMerge[] {
  return runDb('listPendingAutoMerges', () => {
    const rows = getDatabase()
      .prepare('SELECT * FROM pending_auto_merges ORDER BY scheduledMergeAt ASC, id ASC')
      .all() as PendingAutoMergeRow[];
    return rows.map(toPendingAutoMerge);
  });
}

export function transitionToMerging(id: number): boolean {
  return runDb('transitionToMerging', () => {
    const result = getDatabase()
      .prepare('UPDATE pending_auto_merges SET "status" = \'merging\' WHERE id = ? AND "status" = \'pending\'')
      .run(id);
    return result.changes === 1;
  });
}

export function markFailed(id: number, reason: string): boolean {
  return runDb('markFailed', () => {
    const result = getDatabase()
      .prepare('UPDATE pending_auto_merges SET "status" = \'failed\', failureReason = ? WHERE id = ?')
      .run(truncateReason(reason), id);
    return result.changes === 1;
  });
}

export function markBlocked(id: number, reason: string): boolean {
  return runDb('markBlocked', () => {
    const result = getDatabase()
      .prepare('UPDATE pending_auto_merges SET "status" = \'blocked\', failureReason = ? WHERE id = ?')
      .run(truncateReason(reason), id);
    return result.changes === 1;
  });
}

export function markMerged(id: number): boolean {
  return runDb('markMerged', () => {
    const result = getDatabase()
      .prepare('UPDATE pending_auto_merges SET "status" = \'merged\', mergedAt = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
    return result.changes === 1;
  });
}

export function cancelPending(id: number, cancelledBy: string): boolean {
  return runDb('cancelPending', () => {
    const result = getDatabase()
      .prepare('UPDATE pending_auto_merges SET "status" = \'cancelled\', cancelledAt = ?, cancelledBy = ? WHERE id = ? AND "status" = \'pending\'')
      .run(new Date().toISOString(), cancelledBy, id);
    return result.changes === 1;
  });
}

export function clearAllPending(): number {
  return runDb('clearAllPending', () => {
    const result = getDatabase()
      .prepare("DELETE FROM pending_auto_merges WHERE \"status\" = 'pending'")
      .run();
    return result.changes;
  });
}
