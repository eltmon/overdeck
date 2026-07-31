/**
 * Workspaces/projects write door (PAN-1990).
 *
 * The ONLY module that INSERT/UPDATE/DELETEs the projects/workspaces/
 * project_targets/pinned_docs tables. See docs/PIPELINE-MEMBERSHIP.md's
 * two-doors tenet — every write to these tables goes through this writer.
 *
 * Identity-record mirroring into a workspace's memory-home metadata.json is a
 * best-effort recovery hint, not canonical state (the workspaces table row
 * remains the source of truth) — createWorkspace/archiveWorkspace are async
 * only to await that mirror write; the SQLite row write itself stays sync.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getOverdeckDatabaseSync } from '../overdeck/infra.js';
import { writeWorkspaceIdentity } from '../memory/identity-record.js';
import { mirrorPin, unmirrorPin } from '../memory/state-mirror.js';
import type { ProjectConfig } from '../projects.js';
import type { PinScope, WorkspaceKind } from './types.js';
import { getMainWorkspace, getProjectByKey, getWorkspaceById, listPinnedDocs } from './resolver.js';

// ─── Projects ──────────────────────────────────────────────────────────────

/** Upsert a projects.yaml entry into the projects table, keyed by its yaml key. */
export function upsertProjectFromConfig(key: string, config: ProjectConfig): void {
  const db = getOverdeckDatabaseSync();
  const now = Date.now();
  if (getProjectByKey(key)) {
    db.prepare(`UPDATE projects SET name = ?, primary_path = ? WHERE id = ?`).run(config.name, config.path, key);
    return;
  }
  db.prepare(`
    INSERT INTO projects (id, name, primary_path, created_at, last_accessed_at, is_system)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(key, config.name, config.path, now, now);
}

/** Add (or update) a secondary target path for a project. isPrimary demotes any existing primary. */
export function addProjectTarget(projectId: string, path: string, isPrimary: boolean): void {
  const db = getOverdeckDatabaseSync();
  const now = Date.now();
  const run = db.transaction(() => {
    if (isPrimary) {
      db.prepare(`UPDATE project_targets SET is_primary = 0 WHERE project_id = ? AND is_primary = 1`).run(projectId);
    }
    db.prepare(`
      INSERT INTO project_targets (project_id, path, is_primary, created_at, last_used_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (project_id, path) DO UPDATE SET is_primary = excluded.is_primary, last_used_at = excluded.last_used_at
    `).run(projectId, path, isPrimary ? 1 : 0, now, now);
  });
  run();
}

// ─── Workspaces ────────────────────────────────────────────────────────────

export interface CreateWorkspaceOptions {
  projectId: string;
  kind: WorkspaceKind;
  name: string;
  path: string;
  branchName?: string | null;
  parentBranch?: string | null;
  parentBranchGuessed?: boolean;
  isGitRepository?: boolean;
  issueId?: string | null;
  title?: string | null;
  /** Preserve a specific id (rebuild only — otherwise a fresh UUID is generated). */
  id?: string;
  /** Preserve the original creation time (rebuild only — otherwise now is used). */
  createdAt?: number;
}

/** Create a workspace row. Generates a fresh UUID and enforces main-singleton per project. */
export async function createWorkspace(opts: CreateWorkspaceOptions): Promise<string> {
  const db = getOverdeckDatabaseSync();
  if (opts.kind === 'main' && getMainWorkspace(opts.projectId)) {
    throw new Error(`Project ${opts.projectId} already has a main workspace`);
  }
  const id = opts.id ?? randomUUID();
  const now = opts.createdAt ?? Date.now();
  db.prepare(`
    INSERT INTO workspaces (
      id, project_id, kind, name, path, branch_name, parent_branch, parent_branch_guessed,
      is_git_repository, issue_id, layout_config, is_favorite, is_archived, title,
      created_at, last_accessed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 0, ?, ?, ?)
  `).run(
    id,
    opts.projectId,
    opts.kind,
    opts.name,
    opts.path,
    opts.branchName ?? null,
    opts.parentBranch ?? null,
    opts.parentBranchGuessed ? 1 : 0,
    opts.isGitRepository === false ? 0 : 1,
    opts.issueId ?? null,
    opts.title ?? null,
    now,
    now,
  );
  await writeWorkspaceIdentity({
    id,
    projectId: opts.projectId,
    kind: opts.kind,
    name: opts.name,
    path: opts.path,
    branchName: opts.branchName ?? null,
    parentBranch: opts.parentBranch ?? null,
    issueId: opts.issueId ?? null,
    createdAt: now,
  }).catch(() => {});
  return id;
}

export function touchWorkspaceAccessed(id: string): void {
  getOverdeckDatabaseSync().prepare(`UPDATE workspaces SET last_accessed_at = ? WHERE id = ?`).run(Date.now(), id);
}

export function updateWorkspaceLayout(id: string, layoutConfig: string): void {
  getOverdeckDatabaseSync().prepare(`UPDATE workspaces SET layout_config = ? WHERE id = ?`).run(layoutConfig, id);
}

/** Set (or clear, with null) the workspace's run command — PAN-3331 quick-action band. */
export function setWorkspaceRunCommand(id: string, command: string | null): void {
  getOverdeckDatabaseSync().prepare(`UPDATE workspaces SET run_command = ? WHERE id = ?`).run(command, id);
}

export function setWorkspaceFavorite(id: string, isFavorite: boolean): void {
  getOverdeckDatabaseSync().prepare(`UPDATE workspaces SET is_favorite = ? WHERE id = ?`).run(isFavorite ? 1 : 0, id);
}

export async function archiveWorkspace(id: string): Promise<void> {
  getOverdeckDatabaseSync().prepare(`UPDATE workspaces SET is_archived = 1 WHERE id = ?`).run(id);
  const workspace = getWorkspaceById(id);
  if (workspace) {
    await writeWorkspaceIdentity({
      id: workspace.id,
      projectId: workspace.projectId,
      kind: workspace.kind,
      name: workspace.name,
      path: workspace.path,
      branchName: workspace.branchName,
      parentBranch: workspace.parentBranch,
      issueId: workspace.issueId,
      createdAt: workspace.createdAt,
    }).catch(() => {});
  }
}

export function unarchiveWorkspace(id: string): void {
  getOverdeckDatabaseSync().prepare(`UPDATE workspaces SET is_archived = 0 WHERE id = ?`).run(id);
}

export interface RelocateWorkspaceOptions {
  /** Required to relocate a kind='main' workspace (diverges it from projects.yaml's primary path). */
  force?: boolean;
}

/**
 * Point a workspace at a new path (Subspace `workspaces update --relocate` parity,
 * PAN-3286 WI-2/D-2/D-5). Refuses `kind='issue'` (pipeline-owned, not a user
 * relocation target) and archived workspaces. `kind='main'` requires
 * `force: true` since it diverges the row from projects.yaml's primary path.
 * Re-writes the memory-home metadata.json recovery hint (best-effort — the
 * workspaces row remains the source of truth).
 */
export async function relocateWorkspace(id: string, path: string, options: RelocateWorkspaceOptions = {}): Promise<void> {
  const workspace = getWorkspaceById(id);
  if (!workspace) throw new Error(`No workspace found with id '${id}'`);
  if (workspace.isArchived) throw new Error(`Cannot relocate archived workspace '${workspace.name}'`);
  if (workspace.kind === 'issue') throw new Error(`Cannot relocate an issue-kind workspace — it is owned by the pipeline worktree`);
  if (workspace.kind === 'main' && !options.force) {
    throw new Error(`Relocating the main workspace diverges it from projects.yaml's primary path; pass --force to proceed anyway`);
  }

  const isGitRepository = existsSync(join(path, '.git'));
  const now = Date.now();
  getOverdeckDatabaseSync()
    .prepare(`UPDATE workspaces SET path = ?, is_git_repository = ?, last_accessed_at = ? WHERE id = ?`)
    .run(path, isGitRepository ? 1 : 0, now, id);

  await writeWorkspaceIdentity({
    id: workspace.id,
    projectId: workspace.projectId,
    kind: workspace.kind,
    name: workspace.name,
    path,
    branchName: workspace.branchName,
    parentBranch: workspace.parentBranch,
    issueId: workspace.issueId,
    createdAt: workspace.createdAt,
  }).catch(() => {});
}

/**
 * Delete a non-main workspace row. Conversations attributed to it are
 * preserved with workspace_id set to NULL — never deleted. Workspace-scoped
 * pins are removed, including their committed overdeck-state mirror
 * descriptors (FR-10/FR-11 — the mirror is the durable representation, so a
 * pin row deleted here without unmirroring it would let a future recovery
 * from state resurrect a pin the workspace deletion was supposed to remove).
 * Project-scoped pins are untouched. Never touches JSONL transcripts or the
 * memory home (memory purge is a separate explicit flag on the CLI destroy
 * verb).
 *
 * Review fix (durability): the durable mirror is unmirrored FIRST, before
 * the SQLite rows are ever touched. If a state-door commit/push fails here,
 * the function throws and the workspace + pin rows are untouched — a caller
 * retry re-lists the same pins from the unharmed DB row and re-attempts.
 * Doing the DB delete first (the previous ordering) would forget the pin
 * list before the mirror cleanup could be retried, permanently stranding it.
 * unmirrorPin/removeMemoryStateMirror already no-op on an already-removed
 * target, so retrying an already-unmirrored pin is safe.
 */
export async function deleteWorkspace(id: string): Promise<void> {
  const db = getOverdeckDatabaseSync();
  const workspace = getWorkspaceById(id);
  if (!workspace) return;
  if (workspace.kind === 'main') {
    throw new Error(`Cannot delete the main workspace for project ${workspace.projectId}`);
  }
  const workspacePins = listPinnedDocs('workspace', id);
  await Promise.all(workspacePins.map((pin) => unmirrorPin(workspace.projectId, 'workspace', id, pin.docPath)));

  const run = db.transaction(() => {
    db.prepare(`UPDATE conversations SET workspace_id = NULL WHERE workspace_id = ?`).run(id);
    db.prepare(`DELETE FROM pinned_docs WHERE scope = 'workspace' AND scope_id = ?`).run(id);
    db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(id);
  });
  run();
}

// ─── Pinned docs ───────────────────────────────────────────────────────────

/** The classic projects.yaml key that owns a pin scope, for memory-state mirroring. */
function pinProjectId(scope: PinScope, scopeId: string): string | null {
  if (scope === 'project') return scopeId;
  return getWorkspaceById(scopeId)?.projectId ?? null;
}

export async function pinDoc(scope: PinScope, scopeId: string, docPath: string): Promise<void> {
  const createdAt = Date.now();
  getOverdeckDatabaseSync().prepare(`
    INSERT INTO pinned_docs (id, scope, scope_id, doc_path, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (scope, scope_id, doc_path) DO NOTHING
  `).run(randomUUID(), scope, scopeId, docPath, createdAt);
  const projectId = pinProjectId(scope, scopeId);
  if (projectId) await mirrorPin(projectId, scope, scopeId, docPath, createdAt);
}

export async function unpinDoc(scope: PinScope, scopeId: string, docPath: string): Promise<void> {
  getOverdeckDatabaseSync()
    .prepare(`DELETE FROM pinned_docs WHERE scope = ? AND scope_id = ? AND doc_path = ?`)
    .run(scope, scopeId, docPath);
  const projectId = pinProjectId(scope, scopeId);
  if (projectId) await unmirrorPin(projectId, scope, scopeId, docPath);
}
