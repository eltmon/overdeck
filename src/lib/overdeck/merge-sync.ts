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
 * NOTE: The merge-train flag key is 'flywheel.merge_train_enabled' everywhere —
 * this module, the control-settings.ts door, and the legacy panopticon.db all
 * agree. (The control-settings door briefly used an unprefixed 'merge_train_enabled'
 * during cutover; that mismatch was fixed under PAN-1979.)
 */

import { getOverdeckDatabaseSync } from './infra.js';
import type { MergeSet, MergeSetRepoState } from '../merge-set.js';
import type { ForgeType } from '../forge.js';

// ── Timestamp helpers ─────────────────────────────────────────────────────────
// overdeck stores INTEGER milliseconds; old types want ISO strings.

function isoFromMillis(value: number | null | undefined): string | undefined {
  return value == null ? undefined : new Date(value).toISOString();
}

function isoFromMillisRequired(value: number): string {
  return new Date(value).toISOString();
}

function millisFromIso(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function nowMillis(): number {
  return Date.now();
}

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
 * Drop-in for isMergeTrainEnabled() from app-settings.ts.
 *
 * Reads 'flywheel.merge_train_enabled' — the single canonical key shared by the
 * control-settings.ts door and the merge-train engine (unified in PAN-1979).
 */
export function isMergeTrainEnabled(): boolean {
  return readFlag('flywheel.merge_train_enabled');
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

/** Drop-in for markMerged() from pending-auto-merges-db.ts. */
export function markMerged(id: number): boolean {
  const db = getOverdeckDatabaseSync();
  const result = db.prepare(
    "UPDATE pending_auto_merges SET status = 'merged', merged_at = ? WHERE id = ? AND status = 'merging'",
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

export type {
  UatGeneration,
  UatGenerationMember,
  UatGenerationHeldOut,
  UatGenerationResolution,
  UatGenerationStatus,
} from './merge-types.js';

import type {
  UatGeneration,
  UatGenerationMember,
  UatGenerationHeldOut,
  UatGenerationResolution,
  UatGenerationStatus,
} from './merge-types.js';

// overdeck row shapes
interface OverdeckUatGenerationRow {
  name: string;
  worktree_path: string;
  project_root: string;
  base_sha: string;
  status: string;
  stack_started_at: number | null;
  cleaned_at: number | null;
  created_at: number;
  updated_at: number;
}

interface OverdeckUatMemberRow {
  uat_name: string;
  issue_id: string;
  role: string;
  title: string | null;
  branch: string | null;
  head_sha: string | null;
  merge_order: number | null;
  pr: number | null;
  pr_url: string | null;
  reason: string | null;
}

interface OverdeckUatResolutionRow {
  id: number;
  uat_name: string;
  issue_ids: string; // JSON-encoded string[]
  files: string;     // JSON-encoded string[]
  commit_sha: string;
}

function rowToUatGeneration(
  row: OverdeckUatGenerationRow,
  memberRows: OverdeckUatMemberRow[],
  resolutionRows: OverdeckUatResolutionRow[],
): UatGeneration {
  const members: UatGenerationMember[] = memberRows
    .filter((m) => m.role === 'member')
    .map((m) => ({
      issueId: m.issue_id,
      title: m.title ?? '',
      branch: m.branch ?? '',
      headSha: m.head_sha ?? '',
      mergeOrder: m.merge_order ?? 0,
      pr: m.pr ?? undefined,
      prUrl: m.pr_url ?? undefined,
    }));

  const heldOut: UatGenerationHeldOut[] = memberRows
    .filter((m) => m.role === 'held_out')
    .map((m) => ({
      issueId: m.issue_id,
      branch: m.branch ?? undefined,
      headSha: m.head_sha ?? undefined,
      reason: m.reason ?? '',
    }));

  const resolutions: UatGenerationResolution[] = resolutionRows.map((r) => ({
    issueIds: JSON.parse(r.issue_ids) as string[],
    files: JSON.parse(r.files) as string[],
    commitSha: r.commit_sha,
  }));

  return {
    name: row.name,
    worktreePath: row.worktree_path,
    projectRoot: row.project_root,
    baseSha: row.base_sha,
    status: row.status as UatGenerationStatus,
    members,
    heldOut,
    resolutions,
    stackStartedAt: isoFromMillis(row.stack_started_at) ?? null,
    cleanedAt: isoFromMillis(row.cleaned_at) ?? null,
    createdAt: isoFromMillisRequired(row.created_at),
    updatedAt: isoFromMillisRequired(row.updated_at),
  };
}

function loadMembersForUat(db: ReturnType<typeof getOverdeckDatabaseSync>, uatName: string): OverdeckUatMemberRow[] {
  return db.prepare('SELECT * FROM uat_generation_members WHERE uat_name = ?').all(uatName) as OverdeckUatMemberRow[];
}

function loadResolutionsForUat(db: ReturnType<typeof getOverdeckDatabaseSync>, uatName: string): OverdeckUatResolutionRow[] {
  return db.prepare('SELECT * FROM uat_generation_resolutions WHERE uat_name = ?').all(uatName) as OverdeckUatResolutionRow[];
}

/** Drop-in for insertUatGenerationSync() from uat-generations-db.ts. */
export function insertUatGenerationSync(
  gen: Omit<UatGeneration, 'createdAt' | 'updatedAt'> & { createdAt?: string },
): UatGeneration {
  const db = getOverdeckDatabaseSync();
  const nowMs = nowMillis();
  const createdAt = gen.createdAt ?? new Date(nowMs).toISOString();
  const createdAtMs = millisFromIso(createdAt) ?? nowMs;

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM uat_generation_members WHERE uat_name = ?').run(gen.name);
    db.prepare('DELETE FROM uat_generation_resolutions WHERE uat_name = ?').run(gen.name);
    db.prepare(`
      INSERT OR REPLACE INTO uat_generations (
        name, worktree_path, project_root, base_sha, status,
        stack_started_at, cleaned_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      gen.name,
      gen.worktreePath,
      gen.projectRoot,
      gen.baseSha,
      gen.status,
      gen.stackStartedAt ? millisFromIso(gen.stackStartedAt) : null,
      gen.cleanedAt ? millisFromIso(gen.cleanedAt) : null,
      createdAtMs,
      nowMs,
    );

    const insertMember = db.prepare(`
      INSERT INTO uat_generation_members (uat_name, issue_id, role, title, branch, head_sha, merge_order, pr, pr_url, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const m of gen.members) {
      insertMember.run(gen.name, m.issueId, 'member', m.title, m.branch, m.headSha, m.mergeOrder, m.pr ?? null, m.prUrl ?? null, null);
    }
    for (const h of gen.heldOut) {
      insertMember.run(gen.name, h.issueId, 'held_out', null, h.branch ?? null, h.headSha ?? null, null, null, null, h.reason);
    }

    const insertResolution = db.prepare(`
      INSERT INTO uat_generation_resolutions (uat_name, issue_ids, files, commit_sha)
      VALUES (?, ?, ?, ?)
    `);
    for (const r of gen.resolutions) {
      insertResolution.run(gen.name, JSON.stringify(r.issueIds), JSON.stringify(r.files), r.commitSha);
    }
  });

  tx();
  return { ...gen, createdAt, updatedAt: new Date(nowMs).toISOString() };
}

/** Drop-in for getUatGenerationSync() from uat-generations-db.ts. */
export function getUatGenerationSync(name: string): UatGeneration | null {
  const db = getOverdeckDatabaseSync();
  const row = db.prepare('SELECT * FROM uat_generations WHERE name = ?').get(name) as
    | OverdeckUatGenerationRow
    | undefined;
  if (!row) return null;
  return rowToUatGeneration(row, loadMembersForUat(db, name), loadResolutionsForUat(db, name));
}

/** Drop-in for listUatGenerationsSync() from uat-generations-db.ts. */
export function listUatGenerationsSync(options: {
  projectRoot?: string;
  statuses?: readonly UatGenerationStatus[];
  limit?: number;
} = {}): UatGeneration[] {
  const db = getOverdeckDatabaseSync();
  const where: string[] = [];
  const params: unknown[] = [];
  if (options.projectRoot) {
    where.push('project_root = ?');
    params.push(options.projectRoot);
  }
  if (options.statuses && options.statuses.length > 0) {
    where.push(`status IN (${options.statuses.map(() => '?').join(', ')})`);
    params.push(...options.statuses);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const limitSql = options.limit ? `LIMIT ${Math.max(1, Math.floor(options.limit))}` : '';
  const rows = db.prepare(
    `SELECT * FROM uat_generations ${whereSql} ORDER BY created_at DESC, name DESC ${limitSql}`,
  ).all(...params) as OverdeckUatGenerationRow[];

  return rows.map((row) =>
    rowToUatGeneration(row, loadMembersForUat(db, row.name), loadResolutionsForUat(db, row.name)),
  );
}

/** Drop-in for listUatGenerationNamesSync() from uat-generations-db.ts. */
export function listUatGenerationNamesSync(): string[] {
  const db = getOverdeckDatabaseSync();
  const rows = db.prepare('SELECT name FROM uat_generations').all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/** Drop-in for updateUatGenerationStatusSync() from uat-generations-db.ts. */
export function updateUatGenerationStatusSync(name: string, status: UatGenerationStatus): void {
  const db = getOverdeckDatabaseSync();
  const result = db.prepare(
    'UPDATE uat_generations SET status = ?, updated_at = ? WHERE name = ?',
  ).run(status, nowMillis(), name);
  if (result.changes === 0) {
    throw new Error(`[merge-sync] uat generation not found: ${name}`);
  }
}

/** Drop-in for updateUatGenerationSync() from uat-generations-db.ts. */
export function updateUatGenerationSync(
  name: string,
  patch: Partial<Pick<UatGeneration, 'status' | 'baseSha' | 'members' | 'heldOut' | 'resolutions' | 'cleanedAt'>>,
): void {
  const db = getOverdeckDatabaseSync();

  const tx = db.transaction(() => {
    // Update scalar fields on the generation row
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status); }
    if (patch.baseSha !== undefined) { sets.push('base_sha = ?'); params.push(patch.baseSha); }
    if (patch.cleanedAt !== undefined) { sets.push('cleaned_at = ?'); params.push(millisFromIso(patch.cleanedAt)); }

    if (sets.length > 0) {
      sets.push('updated_at = ?');
      params.push(nowMillis(), name);
      const result = db.prepare(`UPDATE uat_generations SET ${sets.join(', ')} WHERE name = ?`).run(...params);
      if (result.changes === 0) {
        throw new Error(`[merge-sync] uat generation not found: ${name}`);
      }
    } else {
      // At least stamp updated_at if we're touching members/resolutions
      db.prepare('UPDATE uat_generations SET updated_at = ? WHERE name = ?').run(nowMillis(), name);
    }

    // Rebuild members table if members or heldOut changed
    if (patch.members !== undefined || patch.heldOut !== undefined) {
      // Load existing rows BEFORE deleting them (needed when only one side is patched)
      const existing = (patch.members === undefined || patch.heldOut === undefined)
        ? (db.prepare('SELECT * FROM uat_generation_members WHERE uat_name = ?').all(name) as OverdeckUatMemberRow[])
        : [];

      db.prepare('DELETE FROM uat_generation_members WHERE uat_name = ?').run(name);
      const insertMember = db.prepare(`
        INSERT INTO uat_generation_members (uat_name, issue_id, role, title, branch, head_sha, merge_order, pr, pr_url, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const members: UatGenerationMember[] = patch.members !== undefined
        ? patch.members
        : existing.filter((r) => r.role === 'member').map((r) => ({
            issueId: r.issue_id,
            title: r.title ?? '',
            branch: r.branch ?? '',
            headSha: r.head_sha ?? '',
            mergeOrder: r.merge_order ?? 0,
            pr: r.pr ?? undefined,
            prUrl: r.pr_url ?? undefined,
          }));

      const heldOut: UatGenerationHeldOut[] = patch.heldOut !== undefined
        ? patch.heldOut
        : existing.filter((r) => r.role === 'held_out').map((r) => ({
            issueId: r.issue_id,
            branch: r.branch ?? undefined,
            headSha: r.head_sha ?? undefined,
            reason: r.reason ?? '',
          }));

      for (const m of members) {
        insertMember.run(name, m.issueId, 'member', m.title, m.branch, m.headSha, m.mergeOrder, m.pr ?? null, m.prUrl ?? null, null);
      }
      for (const h of heldOut) {
        insertMember.run(name, h.issueId, 'held_out', null, h.branch ?? null, h.headSha ?? null, null, null, null, h.reason);
      }
    }

    // Rebuild resolutions if changed
    if (patch.resolutions !== undefined) {
      db.prepare('DELETE FROM uat_generation_resolutions WHERE uat_name = ?').run(name);
      const insertRes = db.prepare(`
        INSERT INTO uat_generation_resolutions (uat_name, issue_ids, files, commit_sha)
        VALUES (?, ?, ?, ?)
      `);
      for (const r of patch.resolutions) {
        insertRes.run(name, JSON.stringify(r.issueIds), JSON.stringify(r.files), r.commitSha);
      }
    }
  });

  tx();
}

/** Drop-in for setUatGenerationStackStartedAtSync() from uat-generations-db.ts. */
export function setUatGenerationStackStartedAtSync(name: string, startedAt: string | null): void {
  const db = getOverdeckDatabaseSync();
  const result = db.prepare(
    'UPDATE uat_generations SET stack_started_at = ?, updated_at = ? WHERE name = ?',
  ).run(startedAt ? millisFromIso(startedAt) : null, nowMillis(), name);
  if (result.changes === 0) {
    throw new Error(`[merge-sync] uat generation not found: ${name}`);
  }
}

/** Drop-in for listUatGenerationsWithStacksSync() from uat-generations-db.ts. */
export function listUatGenerationsWithStacksSync(): UatGeneration[] {
  const db = getOverdeckDatabaseSync();
  const rows = db.prepare(
    'SELECT * FROM uat_generations WHERE stack_started_at IS NOT NULL ORDER BY stack_started_at ASC',
  ).all() as OverdeckUatGenerationRow[];
  return rows.map((row) =>
    rowToUatGeneration(row, loadMembersForUat(db, row.name), loadResolutionsForUat(db, row.name)),
  );
}

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
