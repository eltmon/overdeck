/**
 * UAT Generations SQLite Storage (PAN-1737: UAT batch trains)
 *
 * Persistent record of assembled UAT batch branches (`uat/<codename>-<mmdd>`).
 * The deterministic per-day branch name is reused across rebuilds, so inserting
 * a generation resets that row to the latest assembly attempt.
 *
 * Public API stays synchronous to match the established database module style
 * (see merge-queue-db.ts / review-status-db.ts). Full conversion to
 * @effect/sql-sqlite-bun is deferred to PAN-447.
 */

import { getDatabase, DatabaseError } from './index.js';
export { DatabaseError };

/**
 * Lifecycle of a generation:
 *   assembling  — engine is building the branch (merges/conflict resolution in flight)
 *   ready       — branch pushed; testable and promotable
 *   superseded  — a newer generation reached ready; still testable and promotable
 *   invalidated — base moved / member changed / out-of-band merge; branch is stale
 *   promoted    — merged to main as the tested batch
 *   failed      — assembly aborted (e.g. could not create the worktree)
 */
export type UatGenerationStatus =
  | 'assembling'
  | 'ready'
  | 'superseded'
  | 'invalidated'
  | 'promoted'
  | 'failed';

/** A feature bundled into (or queued for) a generation. */
export interface UatGenerationMember {
  issueId: string;
  title: string;
  /** Feature branch, e.g. feature/pan-1704. */
  branch: string;
  /** Head SHA of the feature branch at assembly time — staleness detection. */
  headSha: string;
  /** 1-based position in the merge order. */
  mergeOrder: number;
  pr?: number;
  prUrl?: string;
}

/** A feature excluded from a generation, with the human-readable reason. */
export interface UatGenerationHeldOut {
  issueId: string;
  /** Feature branch attempted when the generation held this issue out. */
  branch?: string;
  /** Head SHA of the attempted feature branch at assembly time. */
  headSha?: string;
  reason: string;
}

/** A cross-feature conflict resolved on the batch branch by the assembly agent. */
export interface UatGenerationResolution {
  /** The member being merged plus the already-merged members it collided with. */
  issueIds: string[];
  files: string[];
  commitSha: string;
}

export interface UatGeneration {
  /** Branch name doubles as the identifier, e.g. uat/calm-otter-0610. */
  name: string;
  worktreePath: string;
  projectRoot: string;
  /** SHA of origin/main the branch was assembled off. */
  baseSha: string;
  status: UatGenerationStatus;
  members: UatGenerationMember[];
  heldOut: UatGenerationHeldOut[];
  resolutions: UatGenerationResolution[];
  /** ISO timestamp while this generation's live stack is up, else null. */
  stackStartedAt: string | null;
  /** ISO timestamp once branch/worktree/stack artifacts have been cleaned. */
  cleanedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface UatGenerationRow {
  name: string;
  worktree_path: string;
  project_root: string;
  base_sha: string;
  status: string;
  members: string;
  held_out: string;
  resolutions: string;
  stack_started_at: string | null;
  cleaned_at?: string | null;
  created_at: string;
  updated_at: string;
}

function rowToGeneration(row: UatGenerationRow): UatGeneration {
  return {
    name: row.name,
    worktreePath: row.worktree_path,
    projectRoot: row.project_root,
    baseSha: row.base_sha,
    status: row.status as UatGenerationStatus,
    members: JSON.parse(row.members) as UatGenerationMember[],
    heldOut: JSON.parse(row.held_out) as UatGenerationHeldOut[],
    resolutions: JSON.parse(row.resolutions) as UatGenerationResolution[],
    stackStartedAt: row.stack_started_at,
    cleanedAt: row.cleaned_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Insert or reset a generation row (typically status 'assembling'). */
export function insertUatGenerationSync(
  gen: Omit<UatGeneration, 'createdAt' | 'updatedAt'> & { createdAt?: string },
): UatGeneration {
  const db = getDatabase();
  const now = new Date().toISOString();
  const createdAt = gen.createdAt ?? now;
  db.prepare(`
    INSERT OR REPLACE INTO uat_generations (
      name, worktree_path, project_root, base_sha, status,
      members, held_out, resolutions, stack_started_at, cleaned_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    gen.name,
    gen.worktreePath,
    gen.projectRoot,
    gen.baseSha,
    gen.status,
    JSON.stringify(gen.members),
    JSON.stringify(gen.heldOut),
    JSON.stringify(gen.resolutions),
    gen.stackStartedAt,
    gen.cleanedAt ?? null,
    createdAt,
    now,
  );
  return { ...gen, createdAt, updatedAt: now };
}

export function getUatGenerationSync(name: string): UatGeneration | null {
  const db = getDatabase();
  const row = db.prepare(`SELECT * FROM uat_generations WHERE name = ?`).get(name) as
    | UatGenerationRow
    | undefined;
  return row ? rowToGeneration(row) : null;
}

/**
 * The generation chain, newest first. Optionally filtered by status.
 */
export function listUatGenerationsSync(options: {
  projectRoot?: string;
  statuses?: readonly UatGenerationStatus[];
  limit?: number;
} = {}): UatGeneration[] {
  const db = getDatabase();
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
  const rows = db.prepare(`
    SELECT * FROM uat_generations ${whereSql}
    ORDER BY created_at DESC, name DESC ${limitSql}
  `).all(...params) as UatGenerationRow[];
  return rows.map(rowToGeneration);
}

/** Names of existing generation rows. */
export function listUatGenerationNamesSync(): string[] {
  const db = getDatabase();
  const rows = db.prepare(`SELECT name FROM uat_generations`).all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

export function updateUatGenerationStatusSync(name: string, status: UatGenerationStatus): void {
  const db = getDatabase();
  const result = db.prepare(`
    UPDATE uat_generations SET status = ?, updated_at = ? WHERE name = ?
  `).run(status, new Date().toISOString(), name);
  if (result.changes === 0) {
    throw new DatabaseError({
      operation: 'updateUatGenerationStatus',
      cause: new Error(`uat generation not found: ${name}`),
    });
  }
}

/**
 * Patch assembly results onto a generation (members/heldOut/resolutions
 * accumulate while the engine works; status flips when it concludes).
 */
export function updateUatGenerationSync(
  name: string,
  patch: Partial<Pick<UatGeneration, 'status' | 'baseSha' | 'members' | 'heldOut' | 'resolutions' | 'cleanedAt'>>,
): void {
  const db = getDatabase();
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status); }
  if (patch.baseSha !== undefined) { sets.push('base_sha = ?'); params.push(patch.baseSha); }
  if (patch.members !== undefined) { sets.push('members = ?'); params.push(JSON.stringify(patch.members)); }
  if (patch.heldOut !== undefined) { sets.push('held_out = ?'); params.push(JSON.stringify(patch.heldOut)); }
  if (patch.resolutions !== undefined) { sets.push('resolutions = ?'); params.push(JSON.stringify(patch.resolutions)); }
  if (patch.cleanedAt !== undefined) { sets.push('cleaned_at = ?'); params.push(patch.cleanedAt); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  params.push(new Date().toISOString(), name);
  const result = db.prepare(`UPDATE uat_generations SET ${sets.join(', ')} WHERE name = ?`).run(...params);
  if (result.changes === 0) {
    throw new DatabaseError({
      operation: 'updateUatGeneration',
      cause: new Error(`uat generation not found: ${name}`),
    });
  }
}

/** Record that the generation's live stack started (ISO timestamp) or stopped (null). */
export function setUatGenerationStackStartedAtSync(name: string, startedAt: string | null): void {
  const db = getDatabase();
  const result = db.prepare(`
    UPDATE uat_generations SET stack_started_at = ?, updated_at = ? WHERE name = ?
  `).run(startedAt, new Date().toISOString(), name);
  if (result.changes === 0) {
    throw new DatabaseError({
      operation: 'setUatGenerationStackStartedAt',
      cause: new Error(`uat generation not found: ${name}`),
    });
  }
}

/** Generations whose live stack is currently up, oldest stack first. */
export function listUatGenerationsWithStacksSync(): UatGeneration[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM uat_generations
    WHERE stack_started_at IS NOT NULL
    ORDER BY stack_started_at ASC
  `).all() as UatGenerationRow[];
  return rows.map(rowToGeneration);
}
