import { Effect } from 'effect';
import { DatabaseError, getDatabase } from './index.js';
import type { ForgeType } from '../forge.js';

export type PendingAutoMergeStatus = 'pending' | 'merging' | 'blocked' | 'failed' | 'merged' | 'cancelled';

export interface PendingAutoMerge {
  id: number;
  issueId: string;
  prUrl: string;
  prNumber?: number;
  projectKey: string;
  forge: ForgeType;
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
  /** Number of expensive merge attempts consumed; cheap eligibility deferrals do NOT increment this. */
  attempts: number;
}

export interface ScheduleAutoMergeInput {
  issueId: string;
  prUrl: string;
  prNumber?: number;
  projectKey: string;
  forge?: ForgeType;
  scheduledMergeAt: string;
  scheduledAt?: string;
}

interface PendingAutoMergeRow {
  id: number;
  issueId: string;
  prUrl: string;
  prNumber: number | null;
  projectKey: string;
  forge: string;
  status: PendingAutoMergeStatus;
  scheduledMergeAt: string;
  scheduledAt: string;
  mergedAt: string | null;
  failureReason: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  attempts: number;
}

function toPendingAutoMerge(row: PendingAutoMergeRow): PendingAutoMerge {
  return {
    id: row.id,
    issueId: row.issueId,
    prUrl: row.prUrl,
    prNumber: row.prNumber ?? undefined,
    projectKey: row.projectKey,
    forge: (row.forge ?? 'github') as ForgeType,
    status: row.status,
    scheduledMergeAt: row.scheduledMergeAt,
    scheduledAt: row.scheduledAt,
    mergedAt: row.mergedAt ?? undefined,
    failureReason: row.failureReason ?? undefined,
    cancelledAt: row.cancelledAt ?? undefined,
    cancelledBy: row.cancelledBy ?? undefined,
    attempts: row.attempts ?? 0,
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

const selectActionableByIssue = (issueId: string): PendingAutoMerge | null => {
  const row = getDatabase()
    .prepare("SELECT * FROM pending_auto_merges WHERE issueId = ? AND \"status\" IN ('pending','merging','blocked','failed') ORDER BY id DESC LIMIT 1")
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

export interface ScheduleAutoMergeResult {
  entry: PendingAutoMerge;
  created: boolean;
}

export function scheduleAutoMergeWithResult(input: ScheduleAutoMergeInput): ScheduleAutoMergeResult {
  return runDb('scheduleAutoMergeWithResult', () => {
    const existing = selectActiveByIssue(input.issueId);
    if (existing) return { entry: existing, created: false };

    const db = getDatabase();
    const scheduledAt = input.scheduledAt ?? new Date().toISOString();
    try {
      const result = db.prepare(`
        INSERT INTO pending_auto_merges (
          issueId, prUrl, prNumber, projectKey, forge, "status", scheduledMergeAt, scheduledAt
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
      `).run(input.issueId, input.prUrl, input.prNumber ?? null, input.projectKey, input.forge ?? 'github', input.scheduledMergeAt, scheduledAt);
      return { entry: selectById(Number(result.lastInsertRowid))!, created: true };
    } catch (error) {
      const raced = selectActiveByIssue(input.issueId);
      if (raced) return { entry: raced, created: false };
      throw error;
    }
  });
}

export function scheduleAutoMerge(input: ScheduleAutoMergeInput): PendingAutoMerge {
  return scheduleAutoMergeWithResult(input).entry;
}

export function getPendingAutoMerge(issueId: string): PendingAutoMerge | null {
  return runDb('getPendingAutoMerge', () => selectActiveByIssue(issueId));
}

export function getActionableAutoMerge(issueId: string): PendingAutoMerge | null {
  return runDb('getActionableAutoMerge', () => selectActionableByIssue(issueId));
}

export function listPendingAutoMerges(): PendingAutoMerge[] {
  return runDb('listPendingAutoMerges', () => {
    const rows = getDatabase()
      .prepare('SELECT * FROM pending_auto_merges ORDER BY scheduledMergeAt ASC, id ASC')
      .all() as PendingAutoMergeRow[];
    return rows.map(toPendingAutoMerge);
  });
}

export function listActiveAutoMerges(limit = 100): PendingAutoMerge[] {
  return runDb('listActiveAutoMerges', () => {
    const rows = getDatabase()
      .prepare("SELECT * FROM pending_auto_merges WHERE \"status\" IN ('pending','merging') ORDER BY scheduledMergeAt ASC, id ASC LIMIT ?")
      .all(limit) as PendingAutoMergeRow[];
    return rows.map(toPendingAutoMerge);
  });
}

export function listProblemAutoMerges(limit = 100): PendingAutoMerge[] {
  return runDb('listProblemAutoMerges', () => {
    const rows = getDatabase()
      .prepare("SELECT * FROM pending_auto_merges WHERE \"status\" IN ('blocked','failed') ORDER BY scheduledMergeAt ASC, id ASC LIMIT ?")
      .all(limit) as PendingAutoMergeRow[];
    return rows.map(toPendingAutoMerge);
  });
}

export function listActionableAutoMerges(limit = 100): PendingAutoMerge[] {
  return runDb('listActionableAutoMerges', () => {
    const rows = getDatabase()
      .prepare("SELECT * FROM pending_auto_merges WHERE \"status\" IN ('pending','merging','blocked','failed') ORDER BY scheduledMergeAt ASC, id ASC LIMIT ?")
      .all(limit) as PendingAutoMergeRow[];
    return rows.map(toPendingAutoMerge);
  });
}

export function listDuePendingAutoMerges(nowIso: string): PendingAutoMerge[] {
  return runDb('listDuePendingAutoMerges', () => {
    const rows = getDatabase()
      .prepare("SELECT * FROM pending_auto_merges WHERE \"status\" = 'pending' AND scheduledMergeAt <= ? ORDER BY scheduledMergeAt ASC, id ASC")
      .all(nowIso) as PendingAutoMergeRow[];
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

export function incrementAttempts(id: number): boolean {
  return runDb('incrementAttempts', () => {
    const result = getDatabase()
      .prepare('UPDATE pending_auto_merges SET attempts = attempts + 1 WHERE id = ?')
      .run(id);
    return result.changes === 1;
  });
}

export function markFailed(id: number, reason: string): boolean {
  return runDb('markFailed', () => {
    const result = getDatabase()
      .prepare('UPDATE pending_auto_merges SET "status" = \'failed\', failureReason = ? WHERE id = ? AND "status" = \'merging\'')
      .run(truncateReason(reason), id);
    return result.changes === 1;
  });
}

export function deferPendingAutoMerge(id: number, nextScheduledMergeAt: string): boolean {
  return runDb('deferPendingAutoMerge', () => {
    const result = getDatabase()
      .prepare('UPDATE pending_auto_merges SET scheduledMergeAt = ? WHERE id = ? AND "status" = \'pending\'')
      .run(nextScheduledMergeAt, id);
    return result.changes === 1;
  });
}

export function resurrectStrandedAutoMerge(id: number, nextScheduledMergeAt: string): boolean {
  return runDb('resurrectStrandedAutoMerge', () => {
    const result = getDatabase()
      .prepare('UPDATE pending_auto_merges SET "status" = \'pending\', scheduledMergeAt = ? WHERE id = ? AND "status" IN (\'blocked\',\'failed\')')
      .run(nextScheduledMergeAt, id);
    return result.changes === 1;
  });
}

export function requeueToPending(id: number, nextScheduledMergeAt: string): boolean {
  return runDb('requeueToPending', () => {
    const result = getDatabase()
      .prepare('UPDATE pending_auto_merges SET "status" = \'pending\', scheduledMergeAt = ? WHERE id = ? AND "status" = \'merging\'')
      .run(nextScheduledMergeAt, id);
    return result.changes === 1;
  });
}

export function markBlocked(id: number, reason: string): boolean {
  return runDb('markBlocked', () => {
    const result = getDatabase()
      .prepare('UPDATE pending_auto_merges SET "status" = \'blocked\', failureReason = ? WHERE id = ? AND "status" = \'pending\'')
      .run(truncateReason(reason), id);
    return result.changes === 1;
  });
}

export function markMerged(id: number): boolean {
  return runDb('markMerged', () => {
    const result = getDatabase()
      .prepare('UPDATE pending_auto_merges SET "status" = \'merged\', mergedAt = ? WHERE id = ? AND "status" = \'merging\'')
      .run(new Date().toISOString(), id);
    return result.changes === 1;
  });
}

export function cancelPending(id: number, cancelledBy: string): boolean {
  return runDb('cancelPending', () => {
    const result = getDatabase()
      .prepare('UPDATE pending_auto_merges SET "status" = \'cancelled\', cancelledAt = ?, cancelledBy = ? WHERE id = ? AND "status" IN (\'pending\',\'blocked\',\'failed\')')
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
