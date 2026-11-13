/**
 * Explorer roots (PAN-5183, FR-1, FR-A2).
 *
 * A root id names the directory tree the explorer shows:
 *   - `project:<key>`  the project's primary checkout, read-only;
 *   - `issue:<ID>`     the issue's feature workspace, writable;
 *   - `workspace:<id>` a scratch edit workspace, writable, accepted only
 *     under the D-A4 rule (see resolveWorkspaceRoot).
 * Any failure to resolve is ROOT_NOT_FOUND.
 */
import { realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';
import { parseIssueId } from '../../../../lib/issue-id.js';
import { defaultBranchForRepo } from '../../../../lib/project-repos.js';
import { listProjectsAsync, resolveProjectFromIssue } from '../../../../lib/projects.js';
import { getWorkspaceById } from '../../../../lib/workspaces/resolver.js';
import { getWorkspacePathForIssue } from '../../workspace-paths.js';
import { isInsidePath } from '../file-at-path.js';
import { explorerError } from './errors.js';

export interface ExplorerRoot {
  kind: 'project' | 'issue' | 'workspace';
  /** Canonical root id: project:<key> | issue:<UPPER-ID> | workspace:<id>. */
  id: string;
  /** realpath of the root directory. */
  absPath: string;
  /** false only for project roots. */
  writable: boolean;
  projectKey: string;
  issueId?: string;
  workspaceId?: string;
  defaultBranch: string;
}

function notFound(message: string): never {
  throw new Error(message);
}

async function realDirectory(path: string): Promise<string> {
  const real = await realpath(path);
  if (!(await stat(real)).isDirectory()) notFound(`${path} is not a directory`);
  return real;
}

async function findProject(key: string) {
  return (await listProjectsAsync()).find((p) => p.key === key) ?? null;
}

async function resolveProjectRoot(key: string): Promise<ExplorerRoot> {
  const project = await findProject(key);
  if (!project) notFound(`unknown project ${key}`);
  const absPath = await realDirectory(project.config.path);
  return {
    kind: 'project',
    id: `project:${key}`,
    absPath,
    writable: false,
    projectKey: key,
    defaultBranch: defaultBranchForRepo(project.config, absPath),
  };
}

async function resolveIssueRoot(rawId: string): Promise<ExplorerRoot> {
  if (!parseIssueId(rawId)) notFound(`invalid issue id ${rawId}`);
  const resolved = await Effect.runPromise(resolveProjectFromIssue(rawId));
  if (!resolved) notFound(`no project for ${rawId}`);
  const { workspacePath } = getWorkspacePathForIssue(resolved.projectPath, rawId);
  const absPath = await realDirectory(workspacePath);
  const issueId = rawId.toUpperCase();
  const project = await findProject(resolved.projectKey);
  return {
    kind: 'issue',
    id: `issue:${issueId}`,
    absPath,
    writable: true,
    projectKey: resolved.projectKey,
    issueId,
    defaultBranch: defaultBranchForRepo(project?.config ?? null, absPath),
  };
}

/**
 * D-A4: a scratch row may point at the project's primary checkout or at any
 * directory. Only an active scratch row on a `scratch/` branch whose path is
 * a real directory strictly inside the project's workspaces dir, and is not
 * the primary checkout, becomes a writable root.
 */
async function resolveWorkspaceRoot(id: string): Promise<ExplorerRoot> {
  const row = getWorkspaceById(id);
  if (!row) notFound(`unknown workspace ${id}`);
  if (row.kind !== 'scratch') notFound(`workspace ${id} is not a scratch workspace`);
  if (row.isArchived) notFound(`workspace ${id} is archived`);
  if (!row.branchName?.startsWith('scratch/')) notFound(`workspace ${id} is not on a scratch/ branch`);
  const project = await findProject(row.projectId);
  if (!project) notFound(`unknown project ${row.projectId}`);
  const absPath = await realDirectory(row.path);
  const primary = await realpath(project.config.path);
  if (absPath === primary) notFound(`workspace ${id} is the primary checkout`);
  const workspacesDir = await realpath(join(project.config.path, project.config.workspace?.workspaces_dir || 'workspaces'));
  if (absPath === workspacesDir || !isInsidePath(workspacesDir, absPath)) {
    notFound(`workspace ${id} is outside ${workspacesDir}`);
  }
  return {
    kind: 'workspace',
    id: `workspace:${id}`,
    absPath,
    writable: true,
    projectKey: row.projectId,
    workspaceId: id,
    defaultBranch: row.parentBranch ?? defaultBranchForRepo(project.config, absPath),
  };
}

export async function resolveExplorerRoot(rootId: string): Promise<ExplorerRoot> {
  const colon = rootId.indexOf(':');
  const prefix = colon < 0 ? '' : rootId.slice(0, colon);
  const rest = colon < 0 ? '' : rootId.slice(colon + 1);
  try {
    if (rest === '') notFound('empty root id');
    switch (prefix) {
      case 'project':
        return await resolveProjectRoot(rest);
      case 'issue':
        return await resolveIssueRoot(rest);
      case 'workspace':
        return await resolveWorkspaceRoot(rest);
      default:
        return notFound(`unknown root kind ${JSON.stringify(prefix)}`);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw explorerError('ROOT_NOT_FOUND', `Explorer root ${JSON.stringify(rootId)} not found: ${reason}`);
  }
}
