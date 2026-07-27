/**
 * merge-sync-uat.ts — Sync accessors for the UAT batch-train domain.
 *
 * Split out of merge-sync.ts (PAN-3093), which re-exports everything here so
 * existing `from './merge-sync.js'` imports keep working unchanged. The split
 * is what keeps merge-sync.ts under the file-size ceiling now that a
 * generation carries per-repo state.
 *
 * Per-repo model: a polyrepo generation spans N member repos, each with its own
 * uat branch, base SHA, worktree, and publish stamp, held in
 * `uat_generation_repos` / `uat_generation_member_repos`. The `uat_generations`
 * row keeps the composite anchor in `base_sha`. Monorepo generations write no
 * child rows and read back as a synthesized single entry, so consumers loop
 * `repos` without branching on project type.
 */

import { getOverdeckDatabaseSync } from './infra.js';
import {
  isoFromMillis,
  isoFromMillisRequired,
  millisFromIso,
  nowMillis,
} from './merge-sync-time.js';


export type {
  UatGeneration,
  UatGenerationMember,
  UatGenerationMemberRepo,
  UatGenerationHeldOut,
  UatGenerationRepo,
  UatGenerationResolution,
  UatGenerationStatus,
} from './merge-types.js';

import type {
  UatGeneration,
  UatGenerationMember,
  UatGenerationMemberRepo,
  UatGenerationHeldOut,
  UatGenerationRepo,
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
  /** PAN-3166: null on rows written before assembly had a union lint. */
  kind: string | null;
  note: string | null;
}

interface OverdeckUatRepoRow {
  uat_name: string;
  repo_key: string;
  repo_path: string;
  branch: string;
  base_sha: string;
  target_branch: string;
  worktree_path: string;
  merge_order: number;
  promoted_at: number | null;
  merge_sha: string | null;
}

interface OverdeckUatMemberRepoRow {
  uat_name: string;
  issue_id: string;
  repo_key: string;
  branch: string;
  head_sha: string;
  merge_order_in_repo: number;
}

/**
 * The repo list for a generation that stored no per-repo rows — every monorepo
 * generation, plus any row written before PAN-3093 added the child tables. The
 * single entry mirrors the generation's own branch/base/worktree so consumers
 * can loop `repos` uniformly instead of branching on project type.
 *
 * `repoKey` is the project-root basename: a stable, non-empty display label for
 * the one repo involved, not an authoritative config key. Code that needs the
 * configured key resolves it through src/lib/project-repos.ts.
 */
function synthesizeSingleRepo(row: OverdeckUatGenerationRow): UatGenerationRepo {
  const trimmed = row.project_root.replace(/\/+$/, '');
  const basename = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  return {
    repoKey: basename || row.project_root,
    repoPath: row.project_root,
    branch: row.name,
    baseSha: row.base_sha,
    targetBranch: 'main',
    worktreePath: row.worktree_path,
    mergeOrder: 0,
    promotedAt: null,
    mergeSha: null,
  };
}

function rowToUatGeneration(
  row: OverdeckUatGenerationRow,
  memberRows: OverdeckUatMemberRow[],
  resolutionRows: OverdeckUatResolutionRow[],
  repoRows: OverdeckUatRepoRow[] = [],
  memberRepoRows: OverdeckUatMemberRepoRow[] = [],
): UatGeneration {
  const memberReposByIssue = new Map<string, UatGenerationMemberRepo[]>();
  for (const mr of [...memberRepoRows].sort((a, b) => a.merge_order_in_repo - b.merge_order_in_repo)) {
    const list = memberReposByIssue.get(mr.issue_id) ?? [];
    list.push({
      repoKey: mr.repo_key,
      branch: mr.branch,
      headSha: mr.head_sha,
      mergeOrderInRepo: mr.merge_order_in_repo,
    });
    memberReposByIssue.set(mr.issue_id, list);
  }

  const members: UatGenerationMember[] = memberRows
    .filter((m) => m.role === 'member')
    .map((m) => {
      const repos = memberReposByIssue.get(m.issue_id);
      return {
        issueId: m.issue_id,
        title: m.title ?? '',
        branch: m.branch ?? '',
        headSha: m.head_sha ?? '',
        mergeOrder: m.merge_order ?? 0,
        pr: m.pr ?? undefined,
        prUrl: m.pr_url ?? undefined,
        ...(repos && repos.length > 0 ? { repos } : {}),
      };
    });

  const repos: UatGenerationRepo[] = repoRows.length > 0
    ? [...repoRows]
        .sort((a, b) => a.merge_order - b.merge_order || a.repo_key.localeCompare(b.repo_key))
        .map((r) => ({
          repoKey: r.repo_key,
          repoPath: r.repo_path,
          branch: r.branch,
          baseSha: r.base_sha,
          targetBranch: r.target_branch ?? 'main',
          worktreePath: r.worktree_path,
          mergeOrder: r.merge_order,
          promotedAt: isoFromMillis(r.promoted_at) ?? null,
          mergeSha: r.merge_sha ?? null,
        }))
    : [synthesizeSingleRepo(row)];

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
    // A row predating PAN-3166 has no kind, and every one of those was an
    // assembly-agent conflict fix — the only kind that existed.
    kind: (r.kind as UatGenerationResolution['kind']) ?? 'conflict',
    ...(r.note ? { note: r.note } : {}),
  }));

  return {
    name: row.name,
    worktreePath: row.worktree_path,
    projectRoot: row.project_root,
    baseSha: row.base_sha,
    status: row.status as UatGenerationStatus,
    repos,
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

function loadReposForUat(db: ReturnType<typeof getOverdeckDatabaseSync>, uatName: string): OverdeckUatRepoRow[] {
  return db.prepare('SELECT * FROM uat_generation_repos WHERE uat_name = ?').all(uatName) as OverdeckUatRepoRow[];
}

function loadMemberReposForUat(db: ReturnType<typeof getOverdeckDatabaseSync>, uatName: string): OverdeckUatMemberRepoRow[] {
  return db.prepare('SELECT * FROM uat_generation_member_repos WHERE uat_name = ?').all(uatName) as OverdeckUatMemberRepoRow[];
}

/**
 * Load many generations with a FIXED number of statements: one per child table
 * with an `IN (…)` filter, grouped in memory.
 *
 * The per-generation loader below costs four synchronous SQLite round-trips
 * each, so listing G generations cost 1 + 4G statements on the Node event loop
 * — and these lists are read by the generations HTTP route, the minute
 * reconciler, and cleanup, which walks the full retained history.
 */
function loadUatGenerations(
  db: ReturnType<typeof getOverdeckDatabaseSync>,
  rows: OverdeckUatGenerationRow[],
): UatGeneration[] {
  if (rows.length === 0) return [];

  const names = rows.map((r) => r.name);
  const placeholders = names.map(() => '?').join(', ');
  const childRows = <T>(table: string): T[] =>
    db.prepare(`SELECT * FROM ${table} WHERE uat_name IN (${placeholders})`).all(...names) as T[];

  const groupBy = <T extends { uat_name: string }>(all: T[]): Map<string, T[]> => {
    const byName = new Map<string, T[]>();
    for (const row of all) {
      const list = byName.get(row.uat_name);
      if (list) list.push(row);
      else byName.set(row.uat_name, [row]);
    }
    return byName;
  };

  const members = groupBy(childRows<OverdeckUatMemberRow>('uat_generation_members'));
  const resolutions = groupBy(childRows<OverdeckUatResolutionRow>('uat_generation_resolutions'));
  const repos = groupBy(childRows<OverdeckUatRepoRow>('uat_generation_repos'));
  const memberRepos = groupBy(childRows<OverdeckUatMemberRepoRow>('uat_generation_member_repos'));

  return rows.map((row) =>
    rowToUatGeneration(
      row,
      members.get(row.name) ?? [],
      resolutions.get(row.name) ?? [],
      repos.get(row.name) ?? [],
      memberRepos.get(row.name) ?? [],
    ),
  );
}

/** Load one generation with every child table it owns. */
function loadUatGeneration(
  db: ReturnType<typeof getOverdeckDatabaseSync>,
  row: OverdeckUatGenerationRow,
): UatGeneration {
  return rowToUatGeneration(
    row,
    loadMembersForUat(db, row.name),
    loadResolutionsForUat(db, row.name),
    loadReposForUat(db, row.name),
    loadMemberReposForUat(db, row.name),
  );
}

/**
 * Rewrite `uat_generation_repos` for a generation. Callers run this inside the
 * generation's write transaction, after the parent row exists, so a partial
 * write can never leave repo rows pointing at a missing generation.
 */
function writeUatGenerationRepoRows(
  db: ReturnType<typeof getOverdeckDatabaseSync>,
  name: string,
  repos: UatGenerationRepo[] | undefined,
): void {
  db.prepare('DELETE FROM uat_generation_repos WHERE uat_name = ?').run(name);
  if (!repos || repos.length === 0) return;

  const insertRepo = db.prepare(`
    INSERT INTO uat_generation_repos
      (uat_name, repo_key, repo_path, branch, base_sha, target_branch, worktree_path, merge_order, promoted_at, merge_sha)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const r of repos) {
    insertRepo.run(
      name,
      r.repoKey,
      r.repoPath,
      r.branch,
      r.baseSha,
      r.targetBranch ?? 'main',
      r.worktreePath,
      r.mergeOrder,
      r.promotedAt ? millisFromIso(r.promotedAt) : null,
      r.mergeSha ?? null,
    );
  }
}

/**
 * Rewrite `uat_generation_member_repos` from an explicit member list. Only call
 * this when the caller supplied real members: the update path reconstructs
 * members from `uat_generation_members`, which carries no per-repo data, so
 * rebuilding from a reconstructed list would silently drop every contribution.
 */
function writeUatMemberRepoRows(
  db: ReturnType<typeof getOverdeckDatabaseSync>,
  name: string,
  members: UatGenerationMember[],
): void {
  db.prepare('DELETE FROM uat_generation_member_repos WHERE uat_name = ?').run(name);

  const insertMemberRepo = db.prepare(`
    INSERT INTO uat_generation_member_repos
      (uat_name, issue_id, repo_key, branch, head_sha, merge_order_in_repo)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const m of members) {
    for (const mr of m.repos ?? []) {
      insertMemberRepo.run(name, m.issueId, mr.repoKey, mr.branch, mr.headSha, mr.mergeOrderInRepo);
    }
  }
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
    // Children first: INSERT OR REPLACE below deletes and re-inserts the parent
    // row, which a surviving child FK reference (ON DELETE no action) rejects.
    db.prepare('DELETE FROM uat_generation_member_repos WHERE uat_name = ?').run(gen.name);
    db.prepare('DELETE FROM uat_generation_repos WHERE uat_name = ?').run(gen.name);
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
      INSERT INTO uat_generation_resolutions (uat_name, issue_ids, files, commit_sha, kind, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const r of gen.resolutions) {
      insertResolution.run(gen.name, JSON.stringify(r.issueIds), JSON.stringify(r.files), r.commitSha, r.kind ?? 'conflict', r.note ?? null);
    }

    writeUatGenerationRepoRows(db, gen.name, gen.repos);
    writeUatMemberRepoRows(db, gen.name, gen.members);
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
  return loadUatGeneration(db, row);
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

  return loadUatGenerations(db, rows);
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
  patch: Partial<Pick<UatGeneration, 'status' | 'baseSha' | 'members' | 'heldOut' | 'resolutions' | 'cleanedAt' | 'repos'>>,
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

      // Only an explicit member list carries per-repo contributions; the
      // reconstructed list above does not, so leave those rows alone.
      if (patch.members !== undefined) {
        writeUatMemberRepoRows(db, name, patch.members);
      }
    }

    if (patch.repos !== undefined) {
      writeUatGenerationRepoRows(db, name, patch.repos);
    }

    // Rebuild resolutions if changed
    if (patch.resolutions !== undefined) {
      db.prepare('DELETE FROM uat_generation_resolutions WHERE uat_name = ?').run(name);
      const insertRes = db.prepare(`
        INSERT INTO uat_generation_resolutions (uat_name, issue_ids, files, commit_sha, kind, note)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const r of patch.resolutions) {
        insertRes.run(name, JSON.stringify(r.issueIds), JSON.stringify(r.files), r.commitSha, r.kind ?? 'conflict', r.note ?? null);
      }
    }
  });

  tx();
}

/**
 * Record that one member repo's merge landed on its target branch (PAN-3093).
 * Promote publishes repos one at a time, so this per-repo stamp is what makes a
 * partially-published generation resumable: a retry skips every repo that
 * already carries a `promoted_at`.
 */
export function markUatGenerationRepoPromotedSync(
  name: string,
  repoKey: string,
  promotedAt: string,
  mergeSha?: string,
): void {
  const db = getOverdeckDatabaseSync();
  // The merge SHA is stamped with the timestamp, not separately: a promote
  // interrupted between the two would otherwise leave a landed repo whose merge
  // commit is unknown, and finalization needs that ref.
  const result = db.prepare(
    'UPDATE uat_generation_repos SET promoted_at = ?, merge_sha = COALESCE(?, merge_sha) WHERE uat_name = ? AND repo_key = ?',
  ).run(millisFromIso(promotedAt), mergeSha ?? null, name, repoKey);
  if (result.changes === 0) {
    throw new Error(`[merge-sync] uat generation repo not found: ${name} / ${repoKey}`);
  }
  db.prepare('UPDATE uat_generations SET updated_at = ? WHERE name = ?').run(nowMillis(), name);
}

/**
 * Does this project have a terminal generation that still owns artifacts?
 *
 * The idle reconciler tick asks only this, and generation rows are retained as
 * an audit trail — hydrating every promoted/failed/invalidated row plus its four
 * child tables to answer a yes/no question means the cost of an idle minute
 * grows with history forever, on the event loop.
 */
export function hasUncleanedTerminalUatGenerationSync(projectRoot: string): boolean {
  const db = getOverdeckDatabaseSync();
  const row = db.prepare(
    `SELECT 1 FROM uat_generations
      WHERE project_root = ?
        AND status IN ('promoted', 'failed', 'invalidated')
        AND cleaned_at IS NULL
      LIMIT 1`,
  ).get(projectRoot);
  return row !== undefined;
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
  return loadUatGenerations(db, rows);
}

