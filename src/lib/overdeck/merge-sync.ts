/**
 * merge-sync.ts — Sync accessors for merge/uat/auto-merge/settings domain.
 *
 * Replaces direct `getDatabase()` calls in:
 *   src/lib/database/app-settings.ts         (isFlywheelGloballyPaused, isMergeTrainEnabled)
 *   src/lib/database/merge-queue-db.ts        (getAllActiveQueues)
 *   src/lib/database/pending-auto-merges-db.ts (listDuePendingAutoMerges, transitions)
 *   src/lib/database/uat-generations-db.ts    (insert/get/list/update)
 *   src/lib/database/merge-set-db.ts          (upsert/get/getAll/delete)
 *
 * Pattern: follows src/lib/overdeck/agent-state-sync.ts.
 *   - Uses getOverdeckDatabaseSync() (cached sync handle).
 *   - Types re-exported match OLD shapes exactly (ISO string dates, etc.)
 *     so cloister consumers need no structural changes.
 *
 * NOTE: The merge-train flag keys — as of PAN-1696, the primary key is
 * 'merge_train.enabled'. For backward compatibility, isMergeTrainEnabled()
 * falls back to 'flywheel.merge_train_enabled' when the new key is absent.
 */

import { getOverdeckDatabaseSync } from './infra.js';
import type { MergeSet, MergeSetRepoState } from '../merge-set.js';
import type { ForgeType } from '../forge.js';

// ── Timestamp helpers ─────────────────────────────────────────────────────────
// overdeck stores INTEGER milliseconds; old types want ISO strings. Shared with
// merge-sync-uat.ts, so they live in their own module to avoid an import cycle.

import {
  isoFromMillis,
  isoFromMillisRequired,
  millisFromIso,
  nowMillis,
} from './merge-sync-time.js';

// ── Settings ──────────────────────────────────────────────────────────────────

function readFlag(key: string): boolean {
  const db = getOverdeckDatabaseSync();
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value === 'true';
}

/** Drop-in for isFlywheelGloballyPaused() from app-settings.ts. */
export function isFlywheelGloballyPaused(): boolean {
  return readFlag('flywheel.globally_paused');
}

/**
 * Drop-in for isMergeTrainEnabled() from app-settings.ts (PAN-1696).
 *
 * Reads 'merge_train.enabled' (new key), falling back to
 * 'flywheel.merge_train_enabled' (legacy) when the new key is absent.
 */
export function isMergeTrainEnabled(): boolean {
  const db = getOverdeckDatabaseSync();
  const newRow = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('merge_train.enabled') as
    | { value: string }
    | undefined;
  if (newRow?.value === 'true' || newRow?.value === 'false') {
    return newRow.value === 'true';
  }
  return readFlag('flywheel.merge_train_enabled');
}

/**
 * PAN-1696: Check if merge train is enabled for a project, respecting the
 * per-project override in projects.yaml if set, otherwise falling back to
 * the global merge_train.enabled flag.
 *
 * @param project - ProjectConfig from projects.yaml with merge_train field. If not set, uses global.
 * @returns true if merge train is enabled for this project, false otherwise.
 */
export function isMergeTrainEnabledForProject(project?: { merge_train?: 'enabled' | 'disabled' }): boolean {
  // Check per-project override first
  if (project?.merge_train === 'enabled') {
    return true;
  }
  if (project?.merge_train === 'disabled') {
    return false;
  }

  // Fall back to global flag if no project override
  return isMergeTrainEnabled();
}

// ── PendingAutoMerge ──────────────────────────────────────────────────────────

export type { PendingAutoMergeStatus } from './merge-types.js';
export type { PendingAutoMerge } from './merge-types.js';

// Local row shape for overdeck pending_auto_merges (snake_case, integer ms)
interface OverdeckPendingAutoMergeRow {
  id: number;
  issue_id: string;
  pr_url: string;
  project_key: string;
  forge: string;
  status: string;
  scheduled_merge_at: number;
  scheduled_at: number;
  merged_at: number | null;
  failure_reason: string | null;
  cancelled_at: number | null;
  cancelled_by: string | null;
}

import type { PendingAutoMerge } from './merge-types.js';

function rowToPendingAutoMerge(row: OverdeckPendingAutoMergeRow): PendingAutoMerge {
  return {
    id: row.id,
    issueId: row.issue_id,
    prUrl: row.pr_url,
    // overdeck has no pr_number column — field is optional
    prNumber: undefined,
    projectKey: row.project_key,
    forge: (row.forge ?? 'github') as ForgeType,
    status: row.status as PendingAutoMerge['status'],
    scheduledMergeAt: isoFromMillisRequired(row.scheduled_merge_at),
    scheduledAt: isoFromMillisRequired(row.scheduled_at),
    mergedAt: isoFromMillis(row.merged_at),
    failureReason: row.failure_reason ?? undefined,
    cancelledAt: isoFromMillis(row.cancelled_at),
    cancelledBy: row.cancelled_by ?? undefined,
  };
}

function truncateReason(reason: string): string {
  return reason.length > 1024 ? reason.slice(0, 1024) : reason;
}

/** Drop-in for listDuePendingAutoMerges() from pending-auto-merges-db.ts. */
export function listDuePendingAutoMerges(nowIso: string): PendingAutoMerge[] {
  const db = getOverdeckDatabaseSync();
  const nowMs = millisFromIso(nowIso) ?? Date.now();
  const rows = db.prepare(
    "SELECT * FROM pending_auto_merges WHERE status = 'pending' AND scheduled_merge_at <= ? ORDER BY scheduled_merge_at ASC, id ASC",
  ).all(nowMs) as OverdeckPendingAutoMergeRow[];
  return rows.map(rowToPendingAutoMerge);
}

/** Drop-in for transitionToMerging() from pending-auto-merges-db.ts. */
export function transitionToMerging(id: number): boolean {
  const db = getOverdeckDatabaseSync();
  const result = db.prepare(
    "UPDATE pending_auto_merges SET status = 'merging' WHERE id = ? AND status = 'pending'",
  ).run(id);
  return result.changes === 1;
}

/** Drop-in for markFailed() from pending-auto-merges-db.ts. */
export function markFailed(id: number, reason: string): boolean {
  const db = getOverdeckDatabaseSync();
  const result = db.prepare(
    "UPDATE pending_auto_merges SET status = 'failed', failure_reason = ? WHERE id = ? AND status = 'merging'",
  ).run(truncateReason(reason), id);
  return result.changes === 1;
}

/** Drop-in for requeueToPending() from pending-auto-merges-db.ts. */
export function requeueToPending(id: number, nextScheduledMergeAt: string): boolean {
  const db = getOverdeckDatabaseSync();
  const nextMs = millisFromIso(nextScheduledMergeAt);
  if (nextMs == null) return false;
  const result = db.prepare(
    "UPDATE pending_auto_merges SET status = 'pending', scheduled_merge_at = ? WHERE id = ? AND status = 'merging'",
  ).run(nextMs, id);
  return result.changes === 1;
}

/** Drop-in for markBlocked() from pending-auto-merges-db.ts. */
export function markBlocked(id: number, reason: string): boolean {
  const db = getOverdeckDatabaseSync();
  const result = db.prepare(
    "UPDATE pending_auto_merges SET status = 'blocked', failure_reason = ? WHERE id = ? AND status = 'pending'",
  ).run(truncateReason(reason), id);
  return result.changes === 1;
}

/** Atomically stop an in-progress auto-merge after its retry circuit breaker opens. */
export function markMergingBlocked(id: number, reason: string): boolean {
  const db = getOverdeckDatabaseSync();
  const result = db.prepare(
    "UPDATE pending_auto_merges SET status = 'blocked', failure_reason = ? WHERE id = ? AND status = 'merging'",
  ).run(truncateReason(reason), id);
  return result.changes === 1;
}

/** Drop-in for markMerged() from pending-auto-merges-db.ts. */
export function markMerged(id: number): boolean {
  const db = getOverdeckDatabaseSync();
  const result = db.prepare(
    "UPDATE pending_auto_merges SET status = 'merged', merged_at = ? WHERE id = ? AND status IN ('pending','blocked','failed','merging')",
  ).run(nowMillis(), id);
  return result.changes === 1;
}

/** Drop-in for cancelPending() from pending-auto-merges-db.ts. */
export function cancelPending(id: number, cancelledBy: string): boolean {
  const db = getOverdeckDatabaseSync();
  const result = db.prepare(
    "UPDATE pending_auto_merges SET status = 'cancelled', cancelled_at = ?, cancelled_by = ? WHERE id = ? AND status IN ('pending','blocked','failed')",
  ).run(nowMillis(), cancelledBy, id);
  return result.changes === 1;
}

/** Drop-in for getActionableAutoMerge() from pending-auto-merges-db.ts. */
export function getActionableAutoMerge(issueId: string): PendingAutoMerge | null {
  const db = getOverdeckDatabaseSync();
  const row = db.prepare(
    "SELECT * FROM pending_auto_merges WHERE issue_id = ? AND status IN ('pending','merging','blocked','failed') ORDER BY id DESC LIMIT 1",
  ).get(issueId) as OverdeckPendingAutoMergeRow | undefined;
  return row ? rowToPendingAutoMerge(row) : null;
}

export function countActionableAutoMerges(issueId: string): number {
  const db = getOverdeckDatabaseSync();
  const row = db.prepare(
    "SELECT COUNT(*) AS n FROM pending_auto_merges WHERE issue_id = ? AND status IN ('pending','merging','blocked','failed')",
  ).get(issueId) as { n: number } | undefined;
  return row?.n ?? 0;
}

/** Drop-in for listActiveAutoMerges() from pending-auto-merges-db.ts. */
export function listActiveAutoMerges(limit = 100): PendingAutoMerge[] {
  const db = getOverdeckDatabaseSync();
  const rows = db.prepare(
    "SELECT * FROM pending_auto_merges WHERE status IN ('pending','merging') ORDER BY scheduled_merge_at ASC, id ASC LIMIT ?",
  ).all(limit) as OverdeckPendingAutoMergeRow[];
  return rows.map(rowToPendingAutoMerge);
}

/** Drop-in for listProblemAutoMerges() from pending-auto-merges-db.ts. */
export function listProblemAutoMerges(limit = 100): PendingAutoMerge[] {
  const db = getOverdeckDatabaseSync();
  const rows = db.prepare(
    "SELECT * FROM pending_auto_merges WHERE status IN ('blocked','failed') ORDER BY scheduled_merge_at ASC, id ASC LIMIT ?",
  ).all(limit) as OverdeckPendingAutoMergeRow[];
  return rows.map(rowToPendingAutoMerge);
}

export interface ScheduleAutoMergeInput {
  issueId: string;
  prUrl: string;
  prNumber?: number;
  projectKey: string;
  forge?: import('../forge.js').ForgeType;
  scheduledMergeAt: string;
  scheduledAt?: string;
}

export interface ScheduleAutoMergeResult {
  entry: PendingAutoMerge;
  created: boolean;
}

/** Drop-in for scheduleAutoMergeWithResult() from pending-auto-merges-db.ts. */
export function scheduleAutoMergeWithResult(input: ScheduleAutoMergeInput): ScheduleAutoMergeResult {
  const db = getOverdeckDatabaseSync();
  // Check for active entry first
  const existing = db.prepare(
    "SELECT * FROM pending_auto_merges WHERE issue_id = ? AND status IN ('pending','merging') ORDER BY id DESC LIMIT 1",
  ).get(input.issueId) as OverdeckPendingAutoMergeRow | undefined;
  if (existing) return { entry: rowToPendingAutoMerge(existing), created: false };

  const scheduledAtMs = millisFromIso(input.scheduledAt ?? new Date().toISOString()) ?? nowMillis();
  const scheduledMergeAtMs = millisFromIso(input.scheduledMergeAt) ?? nowMillis();
  try {
    const result = db.prepare(`
      INSERT INTO pending_auto_merges (issue_id, pr_url, project_key, forge, status, scheduled_merge_at, scheduled_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      input.issueId,
      input.prUrl,
      input.projectKey,
      input.forge ?? 'github',
      scheduledMergeAtMs,
      scheduledAtMs,
    );
    const newRow = db.prepare('SELECT * FROM pending_auto_merges WHERE id = ?').get(Number(result.lastInsertRowid)) as OverdeckPendingAutoMergeRow;
    return { entry: rowToPendingAutoMerge(newRow), created: true };
  } catch {
    // Race: another insert beat us
    const raced = db.prepare(
      "SELECT * FROM pending_auto_merges WHERE issue_id = ? AND status IN ('pending','merging') ORDER BY id DESC LIMIT 1",
    ).get(input.issueId) as OverdeckPendingAutoMergeRow | undefined;
    if (raced) return { entry: rowToPendingAutoMerge(raced), created: false };
    throw new Error(`[merge-sync] scheduleAutoMergeWithResult failed for ${input.issueId}`);
  }
}

// ── Merge Queue ───────────────────────────────────────────────────────────────

/** Drop-in for getAllActiveQueues() from merge-queue-db.ts. */
export function getAllActiveQueues(): Array<{
  projectKey: string;
  current: string | null;
  queue: string[];
  queueLength: number;
}> {
  const db = getOverdeckDatabaseSync();
  const rows = db.prepare(
    "SELECT project_key, issue_id, status FROM merge_queue WHERE status IN ('queued', 'processing') ORDER BY project_key, position ASC",
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

/** Drop-in for resetProcessingToQueued() from merge-queue-db.ts. */
export function resetProcessingToQueued(): number {
  const db = getOverdeckDatabaseSync();
  const result = db.prepare(
    "UPDATE merge_queue SET status = 'queued', started_at = NULL WHERE status = 'processing'",
  ).run();
  return result.changes;
}

// ── UAT Generations ───────────────────────────────────────────────────────────
// Split into merge-sync-uat.ts (PAN-3093) when per-repo generation state pushed
// this file over the size ceiling. Re-exported so callers keep importing from
// merge-sync.js.

export * from './merge-sync-uat.js';

// ── Merge Sets ────────────────────────────────────────────────────────────────

// overdeck merge_sets row (integer timestamps)
interface OverdeckMergeSetRow {
  issue_id: string;
  project_key: string;
  project_path: string;
  workspace_type: string;
  status: string;
  created_at: number;
  updated_at: number;
}

interface OverdeckMergeSetRepoRow {
  repo_key: string;
  repo_path: string;
  forge: string;
  source_branch: string;
  target_branch: string;
  artifact_url: string | null;
  artifact_id: string | null;
  review_status: string;
  test_status: string;
  rebase_status: string;
  verification_status: string;
  merge_status: string;
  merge_order: number;
  required: number;
}

function rowToMergeSetRepos(rows: OverdeckMergeSetRepoRow[]): MergeSetRepoState[] {
  return rows.map((r) => ({
    repoKey: r.repo_key,
    repoPath: r.repo_path,
    forge: r.forge as MergeSetRepoState['forge'],
    sourceBranch: r.source_branch,
    targetBranch: r.target_branch,
    artifactUrl: r.artifact_url ?? undefined,
    artifactId: r.artifact_id ?? undefined,
    reviewStatus: r.review_status as MergeSetRepoState['reviewStatus'],
    testStatus: r.test_status as MergeSetRepoState['testStatus'],
    rebaseStatus: r.rebase_status as MergeSetRepoState['rebaseStatus'],
    verificationStatus: r.verification_status as MergeSetRepoState['verificationStatus'],
    mergeStatus: r.merge_status as MergeSetRepoState['mergeStatus'],
    mergeOrder: r.merge_order,
    required: r.required === 1,
  }));
}

function rowToMergeSet(row: OverdeckMergeSetRow, repos: MergeSetRepoState[]): MergeSet {
  return {
    issueId: row.issue_id,
    projectKey: row.project_key,
    projectPath: row.project_path,
    workspaceType: row.workspace_type as MergeSet['workspaceType'],
    status: row.status as MergeSet['status'],
    createdAt: isoFromMillisRequired(row.created_at),
    updatedAt: isoFromMillisRequired(row.updated_at),
    repos,
  };
}

function loadReposForMergeSet(db: ReturnType<typeof getOverdeckDatabaseSync>, issueId: string): MergeSetRepoState[] {
  const rows = db.prepare(`
    SELECT repo_key, repo_path, forge, source_branch, target_branch, artifact_url, artifact_id,
           review_status, test_status, rebase_status, verification_status, merge_status, merge_order, required
    FROM merge_set_repos WHERE issue_id = ? ORDER BY merge_order ASC, repo_key ASC
  `).all(issueId) as OverdeckMergeSetRepoRow[];
  return rowToMergeSetRepos(rows);
}

/** Drop-in for upsertMergeSet() from merge-set-db.ts. */
export function upsertMergeSet(mergeSet: MergeSet): void {
  const db = getOverdeckDatabaseSync();
  const createdAtMs = millisFromIso(mergeSet.createdAt) ?? nowMillis();
  const updatedAtMs = millisFromIso(mergeSet.updatedAt) ?? nowMillis();

  const tx = db.transaction((set: MergeSet) => {
    db.prepare(`
      INSERT INTO merge_sets (
        issue_id, project_key, project_path, workspace_type, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(issue_id) DO UPDATE SET
        project_key = excluded.project_key,
        project_path = excluded.project_path,
        workspace_type = excluded.workspace_type,
        status = excluded.status,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `).run(
      set.issueId,
      set.projectKey,
      set.projectPath,
      set.workspaceType,
      set.status,
      createdAtMs,
      updatedAtMs,
    );

    db.prepare('DELETE FROM merge_set_repos WHERE issue_id = ?').run(set.issueId);

    const insertRepo = db.prepare(`
      INSERT INTO merge_set_repos (
        issue_id, repo_key, repo_path, forge, source_branch, target_branch,
        artifact_url, artifact_id, review_status, test_status, rebase_status,
        verification_status, merge_status, merge_order, required
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const repo of set.repos) {
      insertRepo.run(
        set.issueId,
        repo.repoKey,
        repo.repoPath,
        repo.forge,
        repo.sourceBranch,
        repo.targetBranch,
        repo.artifactUrl ?? null,
        repo.artifactId ?? null,
        repo.reviewStatus,
        repo.testStatus,
        repo.rebaseStatus,
        repo.verificationStatus,
        repo.mergeStatus,
        repo.mergeOrder,
        repo.required ? 1 : 0,
      );
    }
  });

  tx(mergeSet);
}

export interface MergeSetRepoPatch {
  repoKey: string;
  expected: Pick<MergeSetRepoState, 'sourceBranch' | 'targetBranch' | 'artifactUrl' | 'artifactId'>;
  patch: Partial<Pick<MergeSetRepoState, 'artifactUrl' | 'artifactId' | 'mergeStatus'>>;
}

const MERGE_SET_REPO_CAS_FAILED = new Error('merge-set-repo-cas-failed');

export function patchMergeSetRepos(issueId: string, patches: MergeSetRepoPatch[]): boolean {
  const db = getOverdeckDatabaseSync();
  const effective = patches.filter(({ patch }) => Object.values(patch).some((value) => value !== undefined));
  if (effective.length === 0) return true;

  try {
    db.transaction(() => {
      for (const { repoKey, expected, patch } of effective) {
        const assignments: string[] = [];
        const values: unknown[] = [];
        if (patch.artifactUrl !== undefined) { assignments.push('artifact_url = ?'); values.push(patch.artifactUrl); }
        if (patch.artifactId !== undefined) { assignments.push('artifact_id = ?'); values.push(patch.artifactId); }
        if (patch.mergeStatus !== undefined) { assignments.push('merge_status = ?'); values.push(patch.mergeStatus); }
        const result = db.prepare(`
          UPDATE merge_set_repos SET ${assignments.join(', ')}
          WHERE issue_id = ? AND repo_key = ? AND source_branch = ? AND target_branch = ?
            AND artifact_url IS ? AND artifact_id IS ?
        `).run(
          ...values,
          issueId,
          repoKey,
          expected.sourceBranch,
          expected.targetBranch,
          expected.artifactUrl ?? null,
          expected.artifactId ?? null,
        );
        if (result.changes !== 1) throw MERGE_SET_REPO_CAS_FAILED;
      }
      db.prepare('UPDATE merge_sets SET updated_at = ? WHERE issue_id = ?').run(nowMillis(), issueId);
    })();
    return true;
  } catch (error) {
    if (error === MERGE_SET_REPO_CAS_FAILED) return false;
    throw error;
  }
}

export function patchMergeSetRepo(
  issueId: string,
  repoKey: string,
  expected: MergeSetRepoPatch['expected'],
  patch: MergeSetRepoPatch['patch'],
): boolean {
  return patchMergeSetRepos(issueId, [{ repoKey, expected, patch }]);
}

/** Drop-in for getMergeSetFromDb() from merge-set-db.ts. */
export function getMergeSetFromDb(issueId: string): MergeSet | null {
  const db = getOverdeckDatabaseSync();
  const row = db.prepare(
    'SELECT issue_id, project_key, project_path, workspace_type, status, created_at, updated_at FROM merge_sets WHERE issue_id = ?',
  ).get(issueId) as OverdeckMergeSetRow | undefined;
  if (!row) return null;
  return rowToMergeSet(row, loadReposForMergeSet(db, issueId));
}

/** Drop-in for getAllMergeSetsFromDb() from merge-set-db.ts. */
export function getAllMergeSetsFromDb(projectKey?: string): MergeSet[] {
  const db = getOverdeckDatabaseSync();
  const rows = (
    projectKey
      ? db.prepare(
          'SELECT issue_id, project_key, project_path, workspace_type, status, created_at, updated_at FROM merge_sets WHERE project_key = ? ORDER BY updated_at DESC',
        ).all(projectKey)
      : db.prepare(
          'SELECT issue_id, project_key, project_path, workspace_type, status, created_at, updated_at FROM merge_sets ORDER BY updated_at DESC',
        ).all()
  ) as OverdeckMergeSetRow[];

  return rows.map((row) => rowToMergeSet(row, loadReposForMergeSet(db, row.issue_id)));
}

/** Drop-in for deleteMergeSet() from merge-set-db.ts. */
export function deleteMergeSet(issueId: string): void {
  const db = getOverdeckDatabaseSync();
  // Delete repos first — FK to merge_sets has ON DELETE no action
  db.prepare('DELETE FROM merge_set_repos WHERE issue_id = ?').run(issueId);
  db.prepare('DELETE FROM merge_sets WHERE issue_id = ?').run(issueId);
}
