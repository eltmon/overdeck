/**
 * Workspaces/projects read door (PAN-1990).
 *
 * The ONLY module that SELECTs the projects/workspaces/project_targets/
 * pinned_docs tables. See docs/PIPELINE-MEMBERSHIP.md's two-doors tenet —
 * every read of these tables goes through this resolver, never a store
 * directly.
 */
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { getOverdeckDatabaseSync } from '../overdeck/infra.js';
import type { PinnedDocRow, PinScope, ProjectRow, ProjectTargetRow, WorkspaceKind, WorkspaceRow } from './types.js';

const PROJECT_COLUMNS = `id, name, primary_path, created_at, last_accessed_at, is_system`;
const WORKSPACE_COLUMNS = `id, project_id, kind, name, path, branch_name, parent_branch,
  parent_branch_guessed, is_git_repository, issue_id, layout_config, run_command, is_favorite,
  is_archived, title, created_at, last_accessed_at`;
const PROJECT_TARGET_COLUMNS = `project_id, path, is_primary, created_at, last_used_at`;
const PINNED_DOC_COLUMNS = `id, scope, scope_id, doc_path, created_at`;

function rowToProject(row: Record<string, unknown>): ProjectRow {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    primaryPath: row['primary_path'] as string,
    createdAt: row['created_at'] as number,
    lastAccessedAt: row['last_accessed_at'] as number,
    isSystem: (row['is_system'] as number) === 1,
  };
}

function rowToWorkspace(row: Record<string, unknown>): WorkspaceRow {
  return {
    id: row['id'] as string,
    projectId: row['project_id'] as string,
    kind: row['kind'] as WorkspaceKind,
    name: row['name'] as string,
    path: row['path'] as string,
    branchName: (row['branch_name'] as string | null) ?? null,
    parentBranch: (row['parent_branch'] as string | null) ?? null,
    parentBranchGuessed: (row['parent_branch_guessed'] as number) === 1,
    isGitRepository: (row['is_git_repository'] as number) === 1,
    issueId: (row['issue_id'] as string | null) ?? null,
    layoutConfig: (row['layout_config'] as string | null) ?? null,
    runCommand: (row['run_command'] as string | null) ?? null,
    isFavorite: (row['is_favorite'] as number) === 1,
    isArchived: (row['is_archived'] as number) === 1,
    title: (row['title'] as string | null) ?? null,
    createdAt: row['created_at'] as number,
    lastAccessedAt: row['last_accessed_at'] as number,
  };
}

function rowToProjectTarget(row: Record<string, unknown>): ProjectTargetRow {
  return {
    projectId: row['project_id'] as string,
    path: row['path'] as string,
    isPrimary: (row['is_primary'] as number) === 1,
    createdAt: row['created_at'] as number,
    lastUsedAt: row['last_used_at'] as number,
  };
}

function rowToPinnedDoc(row: Record<string, unknown>): PinnedDocRow {
  return {
    id: row['id'] as string,
    scope: row['scope'] as PinScope,
    scopeId: row['scope_id'] as string,
    docPath: row['doc_path'] as string,
    createdAt: row['created_at'] as number,
  };
}

// ─── Workspaces ────────────────────────────────────────────────────────────

export function getWorkspaceById(id: string): WorkspaceRow | null {
  const db = getOverdeckDatabaseSync();
  const row = db.prepare(`SELECT ${WORKSPACE_COLUMNS} FROM workspaces WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToWorkspace(row) : null;
}

export function getWorkspaceByName(projectId: string, name: string): WorkspaceRow | null {
  const db = getOverdeckDatabaseSync();
  const row = db
    .prepare(`SELECT ${WORKSPACE_COLUMNS} FROM workspaces WHERE project_id = ? AND name = ?`)
    .get(projectId, name) as Record<string, unknown> | undefined;
  return row ? rowToWorkspace(row) : null;
}

export type WorkspaceRefResolution =
  | { workspace: WorkspaceRow; ambiguous: false }
  | { workspace: null; ambiguous: true; matches: WorkspaceRow[] }
  | { workspace: null; ambiguous: false };

/**
 * Resolve a workspace by id first, falling back to a cross-project name
 * lookup (D-3: `--workspace <id|name>`). A name is not guaranteed unique
 * across projects, so more than one match is reported as `ambiguous` rather
 * than silently picking one — the caller decides how to surface that.
 */
export function resolveWorkspaceRef(ref: string): WorkspaceRefResolution {
  const byId = getWorkspaceById(ref);
  if (byId) return { workspace: byId, ambiguous: false };

  const matches = listWorkspaces({}).filter((workspace) => workspace.name === ref);
  if (matches.length === 1) return { workspace: matches[0]!, ambiguous: false };
  if (matches.length > 1) return { workspace: null, ambiguous: true, matches };
  return { workspace: null, ambiguous: false };
}

/** The non-archived kind='issue' workspace row for an issue, or null. */
export function getWorkspaceForIssue(issueId: string): WorkspaceRow | null {
  const db = getOverdeckDatabaseSync();
  const row = db
    .prepare(
      `SELECT ${WORKSPACE_COLUMNS} FROM workspaces
       WHERE kind = 'issue' AND issue_id = ? AND is_archived = 0`,
    )
    .get(issueId) as Record<string, unknown> | undefined;
  return row ? rowToWorkspace(row) : null;
}

/** The singleton kind='main' workspace row for a project, or null. */
export function getMainWorkspace(projectId: string): WorkspaceRow | null {
  const db = getOverdeckDatabaseSync();
  const row = db
    .prepare(`SELECT ${WORKSPACE_COLUMNS} FROM workspaces WHERE project_id = ? AND kind = 'main'`)
    .get(projectId) as Record<string, unknown> | undefined;
  return row ? rowToWorkspace(row) : null;
}

export function listWorkspaces(options?: {
  projectId?: string;
  kind?: WorkspaceKind;
  includeArchived?: boolean;
}): WorkspaceRow[] {
  const db = getOverdeckDatabaseSync();
  const conditions: string[] = [];
  const params: string[] = [];
  if (options?.projectId) {
    conditions.push('project_id = ?');
    params.push(options.projectId);
  }
  if (options?.kind) {
    conditions.push('kind = ?');
    params.push(options.kind);
  }
  if (!options?.includeArchived) {
    conditions.push('is_archived = 0');
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT ${WORKSPACE_COLUMNS} FROM workspaces ${where} ORDER BY last_accessed_at DESC`)
    .all(...params) as Record<string, unknown>[];
  return rows.map(rowToWorkspace);
}

// ─── Projects ──────────────────────────────────────────────────────────────

/** A project by its stable key (projects.yaml key / the row's id). */
export function getProjectByKey(key: string): ProjectRow | null {
  const db = getOverdeckDatabaseSync();
  const row = db.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ?`).get(key) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToProject(row) : null;
}

export function getProjectByPath(path: string): ProjectRow | null {
  const db = getOverdeckDatabaseSync();
  const row = db.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE primary_path = ?`).get(path) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToProject(row) : null;
}

export function listProjects(): ProjectRow[] {
  const db = getOverdeckDatabaseSync();
  const rows = db.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects ORDER BY name`).all() as Record<
    string,
    unknown
  >[];
  return rows.map(rowToProject);
}

export function listProjectTargets(projectId: string): ProjectTargetRow[] {
  const db = getOverdeckDatabaseSync();
  const rows = db
    .prepare(`SELECT ${PROJECT_TARGET_COLUMNS} FROM project_targets WHERE project_id = ? ORDER BY path`)
    .all(projectId) as Record<string, unknown>[];
  return rows.map(rowToProjectTarget);
}

// ─── Pinned docs ───────────────────────────────────────────────────────────

export function listPinnedDocs(scope: PinScope, scopeId: string): PinnedDocRow[] {
  const db = getOverdeckDatabaseSync();
  const rows = db
    .prepare(`SELECT ${PINNED_DOC_COLUMNS} FROM pinned_docs WHERE scope = ? AND scope_id = ? ORDER BY doc_path`)
    .all(scope, scopeId) as Record<string, unknown>[];
  return rows.map(rowToPinnedDoc);
}

// ─── cwd resolution ────────────────────────────────────────────────────────

function isPathPrefixMatch(cwd: string, candidate: string): boolean {
  return cwd === candidate || cwd.startsWith(candidate.endsWith('/') ? candidate : `${candidate}/`);
}

/** realpath a path for identity comparison; falls back to a resolved (non-symlink-followed) path if it doesn't exist. */
function realpathOrResolve(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * All non-archived workspaces (across every project) whose `path` targets
 * the given directory — Subspace `target-search` parity (PAN-3286 FR-4).
 * Both sides are realpath'd so a symlinked path and its target resolve to
 * the same workspace.
 */
export function listWorkspacesForPath(path: string): WorkspaceRow[] {
  const resolvedPath = realpathOrResolve(path);
  const db = getOverdeckDatabaseSync();
  const rows = db
    .prepare(`SELECT ${WORKSPACE_COLUMNS} FROM workspaces WHERE is_archived = 0`)
    .all() as Record<string, unknown>[];
  return rows.map(rowToWorkspace).filter((workspace) => realpathOrResolve(workspace.path) === resolvedPath);
}

/**
 * Resolve the workspace owning a cwd via longest-path-prefix match: first
 * over workspace paths, then over project primary paths (used by memory
 * capture to attribute a session with no workspace_id yet, FR-8).
 */
export function resolveWorkspaceForCwd(cwd: string): WorkspaceRow | null {
  const db = getOverdeckDatabaseSync();

  const workspaceRows = db.prepare(`SELECT ${WORKSPACE_COLUMNS} FROM workspaces`).all() as Record<
    string,
    unknown
  >[];
  let bestWorkspace: WorkspaceRow | null = null;
  let bestWorkspaceLength = -1;
  for (const row of workspaceRows) {
    const workspace = rowToWorkspace(row);
    if (isPathPrefixMatch(cwd, workspace.path) && workspace.path.length > bestWorkspaceLength) {
      bestWorkspace = workspace;
      bestWorkspaceLength = workspace.path.length;
    }
  }
  if (bestWorkspace) return bestWorkspace;

  const projectRows = db.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects`).all() as Record<
    string,
    unknown
  >[];
  let bestProject: ProjectRow | null = null;
  let bestProjectLength = -1;
  for (const row of projectRows) {
    const project = rowToProject(row);
    if (isPathPrefixMatch(cwd, project.primaryPath) && project.primaryPath.length > bestProjectLength) {
      bestProject = project;
      bestProjectLength = project.primaryPath.length;
    }
  }
  return bestProject ? getMainWorkspace(bestProject.id) : null;
}
