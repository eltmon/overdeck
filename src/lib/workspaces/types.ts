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
  isFavorite: boolean;
  isArchived: boolean;
  title: string | null;
  createdAt: number;
  lastAccessedAt: number;
}

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
