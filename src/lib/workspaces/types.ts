/**
 * Types for the projects/workspaces runtime-plane tables (PAN-1990).
 * Mirrors the DDL in src/lib/database/schema.ts (projects, workspaces,
 * project_targets, pinned_docs).
 */

export type WorkspaceKind = 'main' | 'issue' | 'scratch';

export type PinScope = 'workspace' | 'project';

export interface ProjectRow {
  id: string;
  name: string;
  primaryPath: string;
  createdAt: number;
  lastAccessedAt: number;
  isSystem: boolean;
}

export interface WorkspaceRow {
  id: string;
  projectId: string;
  kind: WorkspaceKind;
  name: string;
  path: string;
  branchName: string | null;
  parentBranch: string | null;
  parentBranchGuessed: boolean;
  isGitRepository: boolean;
  issueId: string | null;
  layoutConfig: string | null;
  /** Operator-set run command for the quick-action band; null falls back to project service config. */
  runCommand: string | null;
  isFavorite: boolean;
  isArchived: boolean;
  title: string | null;
  createdAt: number;
  lastAccessedAt: number;
}

/** One commit present on the comparison ref but not on HEAD (PAN-3331). */
export interface RemoteCommit {
  sha: string;
  subject: string;
  author: string;
  /** ISO 8601 author date. */
  date: string;
}

/**
 * Git state for one workspace checkout, compared against the checked-out
 * branch's OWN upstream (`@{u}`) rather than unconditionally against
 * `origin/HEAD` — see PAN-3331. When no upstream is configured the counts fall
 * back to `origin/HEAD` and `hasUpstream` is false so the UI can say so.
 */
export interface WorkspaceGitState {
  /** Branch name, or null when HEAD is detached. */
  branch: string | null;
  detached: boolean;
  /** Count of `git status --porcelain` entries. */
  dirtyFiles: number;
  /** Commits on HEAD that the comparison ref lacks. */
  ahead: number;
  /** Commits on the comparison ref that HEAD lacks. */
  behind: number;
  /** True when the branch has its own configured upstream. */
  hasUpstream: boolean;
  /** The ref the counts were computed against (`origin/main`, `origin/HEAD`), or null when none resolved. */
  upstreamRef: string | null;
  recentRemoteCommits: RemoteCommit[];
  /** Epoch ms of the fetch this call performed, or null when it did not fetch. */
  fetchedAt: number | null;
}

/** Why a fast-forward pull was refused. Returned, never thrown. */
export type PullRefusalReason =
  | 'dirty'
  | 'operation-in-progress'
  | 'not-fast-forward'
  | 'no-upstream'
  | 'detached'
  | 'error';

export type PullResult =
  | { ok: true; state: WorkspaceGitState }
  | { ok: false; reason: PullRefusalReason; detail: string };

export interface ProjectTargetRow {
  projectId: string;
  path: string;
  isPrimary: boolean;
  createdAt: number;
  lastUsedAt: number;
}

export interface PinnedDocRow {
  id: string;
  scope: PinScope;
  scopeId: string;
  docPath: string;
  createdAt: number;
}
