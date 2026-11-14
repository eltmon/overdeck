/**
 * Edit workspaces (PAN-5191 WI-F2).
 *
 * A `project:<key>` explorer root never writes the primary checkout. The
 * first save or file action there calls `beginEdit`, which reuses or creates
 * an edit workspace: a scratch worktree on an edit branch
 * (`scratch/edit-<MMDD-HHMM>[-n]`) cut from `origin/<default branch>`.
 *
 * Reuse (D-F13): the newest edit row whose root still resolves (D-A4) and
 * whose branch has no PR or an OPEN PR. A failed PR lookup counts as no PR.
 * Calls are serialized per project key (D-F14), so two concurrent calls never
 * race the minute-granular slug: the second one reuses the first one's row.
 *
 * `resolveEditWorkspace` is the guard every edit-workspace route runs first:
 * only a row on an edit branch passes (FR-14).
 */
import { realpath } from 'node:fs/promises';
import type { EditWorkspaceSupport, ExplorerBeginEditResult } from '@overdeck/contracts';
import { defaultBranchForRepo, inferProjectForge } from '../../../../lib/project-repos.js';
import { tryResolveProjectTrackerType } from '../../../../lib/project-tracker-type.js';
import { getIssuePrefix, listProjectsAsync, type ProjectConfig } from '../../../../lib/projects.js';
import { performWorkspaceCreate, resolveWorkspaceCreateIntent } from '../../../../lib/workspaces/create.js';
import { getWorkspaceById, getWorkspaceByName, listWorkspaces } from '../../../../lib/workspaces/resolver.js';
import type { WorkspaceRow } from '../../../../lib/workspaces/types.js';
import { EditWorkspaceError } from './edit-workspace-errors.js';
import { defaultGh, findBranchPr, type GhRunner } from './edit-workspace-gh.js';
import { explorerError } from './errors.js';
import { runGit } from './git-exec.js';
import { resolveExplorerRoot, type ExplorerRoot } from './roots.js';

/** Only a workspace row on a branch matching this is an edit workspace. */
export const EDIT_BRANCH = /^scratch\/edit-[A-Za-z0-9-]+$/;

export const PR_SUPPORT_REASON = 'Create PR needs a GitHub repository: set github_repo for this project in projects.yaml.';
export const PIPELINE_SUPPORT_REASON =
  'Send through pipeline needs a project whose tracker is GitHub Issues and that has an issue_prefix.';

/** Most `-n` suffixes tried for one minute's slug. */
const MAX_NAME_ATTEMPTS = 20;

export interface EditSupport {
  prSupport: EditWorkspaceSupport;
  pipelineSupport: EditWorkspaceSupport;
  /** `github_repo` when PR support holds, else null. */
  repo: string | null;
}

export function editSupport(config: ProjectConfig): EditSupport {
  if (inferProjectForge(config) !== 'github' || !config.github_repo) {
    const unsupported = { available: false, reason: PR_SUPPORT_REASON };
    return { prSupport: unsupported, pipelineSupport: unsupported, repo: null };
  }
  const pipeline = tryResolveProjectTrackerType(config) === 'github' && (getIssuePrefix(config)?.trim() ?? '') !== '';
  return {
    prSupport: { available: true, reason: null },
    pipelineSupport: pipeline ? { available: true, reason: null } : { available: false, reason: PIPELINE_SUPPORT_REASON },
    repo: config.github_repo,
  };
}

export interface EditWorkspaceDeps {
  listProjects?: typeof listProjectsAsync;
  listWorkspaces?: typeof listWorkspaces;
  getWorkspaceById?: typeof getWorkspaceById;
  getWorkspaceByName?: typeof getWorkspaceByName;
  resolveRoot?: typeof resolveExplorerRoot;
  resolveIntent?: typeof resolveWorkspaceCreateIntent;
  performCreate?: typeof performWorkspaceCreate;
  runGit?: typeof runGit;
  gh?: GhRunner;
  now?: () => Date;
}

export interface ResolvedEditWorkspace {
  root: ExplorerRoot;
  row: WorkspaceRow;
  project: { key: string; config: ProjectConfig };
}

/**
 * Resolves an edit workspace by id. Throws ROOT_NOT_FOUND (PanRpcError) when
 * the root does not resolve, and NOT_AN_EDIT_WORKSPACE (409) when the row is
 * not on an edit branch.
 */
export async function resolveEditWorkspace(workspaceId: string, deps: EditWorkspaceDeps = {}): Promise<ResolvedEditWorkspace> {
  const resolveRoot = deps.resolveRoot ?? resolveExplorerRoot;
  const byId = deps.getWorkspaceById ?? getWorkspaceById;
  const listProjects = deps.listProjects ?? listProjectsAsync;

  const root = await resolveRoot(`workspace:${workspaceId}`);
  const row = byId(workspaceId);
  if (!row) throw explorerError('ROOT_NOT_FOUND', `Workspace ${workspaceId} not found.`);
  if (!EDIT_BRANCH.test(row.branchName ?? '')) {
    throw new EditWorkspaceError('NOT_AN_EDIT_WORKSPACE', 409, `Workspace ${row.name} is not an explorer edit workspace.`);
  }
  const project = (await listProjects()).find((p) => p.key === row.projectId);
  if (!project) throw explorerError('ROOT_NOT_FOUND', `Project ${row.projectId} of workspace ${row.name} not found.`);
  return { root, row, project };
}

const chains = new Map<string, Promise<unknown>>();

/** Runs `fn` after every earlier call for `key` has settled (D-F14). */
function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  const result = previous.then(() => fn());
  const tail = result.catch(() => undefined);
  chains.set(key, tail);
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return result;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** `MMDD-HHMM` in server local time. */
export function editSlug(date: Date): string {
  return `${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}`;
}

async function assertGitTopLevel(key: string, path: string, git: typeof runGit): Promise<void> {
  let isTopLevel = false;
  try {
    const result = await git(path, ['rev-parse', '--show-toplevel']);
    isTopLevel = result.code === 0 && (await realpath(result.stdout.toString('utf8').trim())) === (await realpath(path));
  } catch {
    // A missing directory or an unspawnable git is not a git repository either.
  }
  if (!isTopLevel) {
    throw explorerError('NOT_A_GIT_REPO', `The main checkout of ${key} is not a git repository, so it cannot have an edit workspace.`);
  }
}

async function findReusable(
  key: string,
  repo: string | null,
  deps: Required<Pick<EditWorkspaceDeps, 'listWorkspaces' | 'resolveRoot' | 'gh'>>,
): Promise<ExplorerBeginEditResult | null> {
  const rows = deps
    .listWorkspaces({ projectId: key, kind: 'scratch' })
    .filter((row) => EDIT_BRANCH.test(row.branchName ?? ''))
    .sort((a, b) => b.createdAt - a.createdAt);
  for (const row of rows) {
    let root: ExplorerRoot;
    try {
      root = await deps.resolveRoot(`workspace:${row.id}`);
    } catch {
      continue;
    }
    const branch = row.branchName as string;
    if (repo) {
      try {
        const pr = await findBranchPr(deps.gh, repo, branch, root.absPath);
        if (pr && pr.state !== 'OPEN') continue;
      } catch (error) {
        console.warn(`[explorer-edit] PR lookup failed for ${branch}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { rootId: `workspace:${row.id}`, workspaceId: row.id, name: row.name, branch, path: row.path, created: false };
  }
  return null;
}

/**
 * Reuses or creates the project's edit workspace (FR-2). `forceNew` always
 * creates one (FR-13).
 */
export function beginEdit(projectKey: string, forceNew: boolean, deps: EditWorkspaceDeps = {}): Promise<ExplorerBeginEditResult> {
  return serialized(projectKey, () => beginEditNow(projectKey, forceNew, deps));
}

async function beginEditNow(projectKey: string, forceNew: boolean, deps: EditWorkspaceDeps): Promise<ExplorerBeginEditResult> {
  const listProjects = deps.listProjects ?? listProjectsAsync;
  const git = deps.runGit ?? runGit;
  const byName = deps.getWorkspaceByName ?? getWorkspaceByName;
  const resolveIntent = deps.resolveIntent ?? resolveWorkspaceCreateIntent;
  const performCreate = deps.performCreate ?? performWorkspaceCreate;
  const now = deps.now ?? (() => new Date());

  const project = (await listProjects()).find((p) => p.key === projectKey);
  if (!project) throw explorerError('ROOT_NOT_FOUND', `Unknown project ${projectKey}.`);
  const { config } = project;
  await assertGitTopLevel(projectKey, config.path, git);

  if (!forceNew) {
    const reusable = await findReusable(projectKey, editSupport(config).repo, {
      listWorkspaces: deps.listWorkspaces ?? listWorkspaces,
      resolveRoot: deps.resolveRoot ?? resolveExplorerRoot,
      gh: deps.gh ?? defaultGh,
    });
    if (reusable) return reusable;
  }

  const defaultBranch = defaultBranchForRepo(config, config.path);
  const slug = editSlug(now());
  for (let n = 1; n <= MAX_NAME_ATTEMPTS; n++) {
    const name = n === 1 ? `edit-${slug}` : `edit-${slug}-${n}`;
    if (byName(projectKey, name)) continue;
    const branchCheck = await git(config.path, ['rev-parse', '--verify', '--quiet', `refs/heads/scratch/${name}`]);
    if (branchCheck.code === 0) continue;
    const intent = await resolveIntent({
      kind: 'scratch',
      name,
      projectKey,
      isolated: true,
      parentBranch: defaultBranch,
      refreshParentBranch: true,
    });
    const finding = intent.findings[0];
    if (finding?.code === 'path-exists') continue;
    if (finding) throw explorerError('EXPLORER_FAILED', finding.message);
    const { id } = await performCreate(intent);
    return {
      rootId: `workspace:${id}`,
      workspaceId: id,
      name,
      branch: `scratch/${name}`,
      path: intent.path ?? '',
      created: true,
    };
  }
  throw explorerError('EXPLORER_FAILED', `No free edit workspace name for edit-${slug} after ${MAX_NAME_ATTEMPTS} attempts.`);
}
