/**
 * Workspace identity mirror (PAN-1990, memory-paths-rekey).
 *
 * Memory storage is keyed by workspaceId (resolveWorkspaceMemoryRoot), which
 * is an opaque UUID with no human-readable trace back to the workspace it
 * belonged to if the overdeck.db row is ever lost. metadata.json at the
 * workspace's memory root is that trace: a best-effort recovery hint, not
 * canonical state. The workspaces table row remains the source of truth.
 */
import { readFile, rename, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';
import type { WorkspaceKind } from '../workspaces/types.js';
import { ensureParentDir, resolveWorkspaceMemoryRoot } from './paths.js';

export interface WorkspaceIdentitySource {
  id: string;
  projectId: string;
  kind: WorkspaceKind;
  name: string;
  path: string;
  branchName: string | null;
  parentBranch: string | null;
  issueId: string | null;
  createdAt: number;
}

export type WorkspaceIdentityRecord = WorkspaceIdentitySource & Record<string, unknown>;

export function resolveWorkspaceIdentityPath(projectId: string, workspaceId: string): string {
  return join(resolveWorkspaceMemoryRoot(projectId, workspaceId), 'metadata.json');
}

/** Write (or merge over) the identity fields at the workspace's memory-home metadata.json. */
export async function writeWorkspaceIdentity(row: WorkspaceIdentitySource): Promise<string> {
  const path = resolveWorkspaceIdentityPath(row.projectId, row.id);
  await ensureParentDir(path);

  const existing = await readWorkspaceIdentity(path);
  const merged: WorkspaceIdentityRecord = {
    ...existing,
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    name: row.name,
    path: row.path,
    branchName: row.branchName,
    parentBranch: row.parentBranch,
    issueId: row.issueId,
    createdAt: row.createdAt,
  };

  const tempPath = join(dirname(path), `.${randomUUID()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  await rename(tempPath, path);
  return path;
}

/** Parse a workspace's metadata.json for rebuild. Returns null if missing or unreadable. */
export async function readWorkspaceIdentity(path: string): Promise<WorkspaceIdentityRecord | null> {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as WorkspaceIdentityRecord;
  } catch {
    return null;
  }
}
