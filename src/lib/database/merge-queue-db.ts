/**
 * Merge Queue SQLite Storage (PAN-632)
 *
 * Persistent merge queue backed by SQLite. Serializes merges per-project
 * and survives server restarts. Replaces the in-memory _mergeQueues Map.
 *
 * PAN-1249: Effect migration pass — public API stays synchronous to keep
 * the existing call sites unchanged. The DatabaseError tagged error is
 * re-exported from ./index.js so callers can surface typed SQLite
 * failures. Full conversion to @effect/sql-sqlite-bun is deferred to
 * PAN-447.
 */

import { getDatabase, DatabaseError } from './index.js';
export { DatabaseError };

export interface MergeQueueEntry {
  id: number;
  projectKey: string;
  issueId: string;
  position: number;
  queuedAt: string;
  startedAt: string | null;
  status: 'queued' | 'processing' | 'completed' | 'failed';
}

/**
 * Enqueue an issue for merge. Returns the queue position.
 * If the issue is already queued, returns its existing position.
 */
export function enqueueMerge(projectKey: string, issueId: string): number {
  const db = getDatabase();
  const normalized = issueId.toUpperCase();

  // Check if already queued
  const existing = db.prepare(
    `SELECT position FROM merge_queue WHERE issue_id = ? AND status IN ('queued', 'processing')`
  ).get(normalized) as { position: number } | undefined;
  if (existing) return existing.position;

  // Get max position for this project
  const maxRow = db.prepare(
    `SELECT COALESCE(MAX(position), 0) as max_pos FROM merge_queue WHERE project_key = ? AND status IN ('queued', 'processing')`
  ).get(projectKey) as { max_pos: number };
  const position = maxRow.max_pos + 1;

  db.prepare(
    `INSERT INTO merge_queue (project_key, issue_id, position, queued_at, status) VALUES (?, ?, ?, ?, 'queued')`
  ).run(projectKey, normalized, position, new Date().toISOString());

  return position;
}

/**
 * Mark a queued merge as processing (currently being merged).
 */
export function markMergeProcessing(projectKey: string, issueId: string): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE merge_queue SET status = 'processing', started_at = ? WHERE issue_id = ? AND status = 'queued'`
  ).run(new Date().toISOString(), issueId.toUpperCase());
}

/**
 * Get the currently processing merge for a project, or null.
 */
export function getCurrentMerge(projectKey: string): string | null {
  const db = getDatabase();
  const row = db.prepare(
    `SELECT issue_id FROM merge_queue WHERE project_key = ? AND status = 'processing' ORDER BY position ASC LIMIT 1`
  ).get(projectKey) as { issue_id: string } | undefined;
  return row?.issue_id ?? null;
}

/**
 * Advance the queue for a project after the current issue completes.
 * Optionally removes the completed issue, then returns the next queued issue.
 */
export function dequeueMerge(projectKey: string, completedIssueId?: string): string | null {
  const db = getDatabase();

  if (completedIssueId) {
    db.prepare(
      `DELETE FROM merge_queue WHERE project_key = ? AND issue_id = ?`
    ).run(projectKey, completedIssueId.toUpperCase());
  }

  // Get next queued entry
  const next = db.prepare(
    `SELECT issue_id FROM merge_queue WHERE project_key = ? AND status = 'queued' ORDER BY position ASC LIMIT 1`
  ).get(projectKey) as { issue_id: string } | undefined;

  return next?.issue_id ?? null;
}

/**
 * Remove a specific issue from the merge queue (any status).
 */
export function removeMerge(issueId: string): void {
  const db = getDatabase();
  db.prepare(`DELETE FROM merge_queue WHERE issue_id = ?`).run(issueId.toUpperCase());
}

/**
 * Get the full queue for a project.
 */
export function getQueueForProject(projectKey: string): MergeQueueEntry[] {
  const db = getDatabase();
  const rows = db.prepare(
    `SELECT id, project_key, issue_id, position, queued_at, started_at, status
     FROM merge_queue
     WHERE project_key = ? AND status IN ('queued', 'processing')
     ORDER BY position ASC`
  ).all(projectKey) as Array<{
    id: number; project_key: string; issue_id: string; position: number;
    queued_at: string; started_at: string | null; status: string;
  }>;

  return rows.map(r => ({
    id: r.id,
    projectKey: r.project_key,
    issueId: r.issue_id,
    position: r.position,
    queuedAt: r.queued_at,
    startedAt: r.started_at,
    status: r.status as MergeQueueEntry['status'],
  }));
}

/**
 * Get all active queues across all projects.
 */
export function getAllActiveQueues(): Array<{
  projectKey: string;
  current: string | null;
  queue: string[];
  queueLength: number;
}> {
  const db = getDatabase();
  const rows = db.prepare(
    `SELECT project_key, issue_id, status
     FROM merge_queue
     WHERE status IN ('queued', 'processing')
     ORDER BY project_key, position ASC`
  ).all() as Array<{ project_key: string; issue_id: string; status: string }>;

  const byProject = new Map<string, { current: string | null; queue: string[] }>();
  for (const row of rows) {
    let entry = byProject.get(row.project_key);
    if (!entry) {
      entry = { current: null, queue: [] };
      byProject.set(row.project_key, entry);
    }
    if (row.status === 'processing') {
      entry.current = row.issue_id;
    } else {
      entry.queue.push(row.issue_id);
    }
  }

  return [...byProject.entries()].map(([projectKey, data]) => ({
    projectKey,
    current: data.current,
    queue: data.queue,
    queueLength: data.queue.length,
  }));
}

/**
 * Startup recovery: reset any 'processing' entries back to 'queued'.
 * These were in-flight when the server died.
 */
export function resetProcessingToQueued(): number {
  const db = getDatabase();
  const result = db.prepare(
    `UPDATE merge_queue SET status = 'queued', started_at = NULL WHERE status = 'processing'`
  ).run();
  return result.changes;
}

/**
 * Clean up completed/failed entries older than the given age.
 */
export function cleanupOldEntries(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
  const db = getDatabase();
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const result = db.prepare(
    `DELETE FROM merge_queue WHERE status IN ('completed', 'failed') AND queued_at < ?`
  ).run(cutoff);
  return result.changes;
}
