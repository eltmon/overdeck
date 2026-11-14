import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PanRpcError } from '@overdeck/contracts';
import type { ProjectConfig } from '../../../../../lib/projects.js';
import type { ResolvedWorkspaceIntent, WorkspaceCreateInput } from '../../../../../lib/workspaces/create.js';
import type { WorkspaceRow } from '../../../../../lib/workspaces/types.js';
import {
  beginEdit,
  editSupport,
  PIPELINE_SUPPORT_REASON,
  PR_SUPPORT_REASON,
  resolveEditWorkspace,
  type EditWorkspaceDeps,
} from '../edit-workspace.js';
import { EditWorkspaceError } from '../edit-workspace-errors.js';
import type { GhRunner } from '../edit-workspace-gh.js';
import type { GitRunResult } from '../git-exec.js';
import type { ExplorerRoot } from '../roots.js';

let projectDir: string;

beforeAll(async () => {
  projectDir = await realpath(await mkdtemp(join(tmpdir(), 'edit-workspace-')));
});

afterAll(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

const NOW = new Date(2026, 10, 13, 14, 5);

function gitResult(code: number, stdout = ''): GitRunResult {
  return { code, stdout: Buffer.from(stdout), stderr: '', timedOut: false, truncated: false };
}

function row(id: string, branch: string, createdAt: number): WorkspaceRow {
  return {
    id,
    projectId: 'p',
    kind: 'scratch',
    name: branch.replace(/^scratch\//, ''),
    path: join(projectDir, 'workspaces', `scratch-${id}`),
    branchName: branch,
    parentBranch: 'main',
    parentBranchGuessed: false,
    isGitRepository: true,
    issueId: null,
    layoutConfig: null,
    runCommand: null,
    isFavorite: false,
    isArchived: false,
    title: null,
    createdAt,
    lastAccessedAt: createdAt,
  };
}

interface Harness {
  deps: EditWorkspaceDeps;
  rows: WorkspaceRow[];
  performCreate: ReturnType<typeof vi.fn>;
  gitCalls: string[][];
}

/**
 * Every dep faked. `prStates` maps a branch to the state the fake gh reports
 * for it (absent → no PR). `pathExists` and `localBranches` name slugs that
 * collide.
 */
function harness(opts: {
  config?: Partial<ProjectConfig>;
  rows?: WorkspaceRow[];
  prStates?: Record<string, string>;
  pathExists?: string[];
  localBranches?: string[];
  gitTopLevel?: string | null;
} = {}): Harness {
  const config = { name: 'p', path: projectDir, ...opts.config } as ProjectConfig;
  const rows = [...(opts.rows ?? [])];
  const gitCalls: string[][] = [];
  let created = 0;
  const runGit = (async (_cwd: string, args: readonly string[]) => {
    gitCalls.push([...args]);
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
      return opts.gitTopLevel === null ? gitResult(128) : gitResult(0, `${opts.gitTopLevel ?? projectDir}\n`);
    }
    if (args[0] === 'rev-parse' && args[1] === '--verify') {
      const ref = String(args[3]);
      return gitResult((opts.localBranches ?? []).some((b) => ref === `refs/heads/${b}`) ? 0 : 1);
    }
    throw new Error(`unexpected git ${args.join(' ')}`);
  }) as EditWorkspaceDeps['runGit'];
  const gh: GhRunner = async (args) => {
    const branch = args[args.indexOf('--head') + 1] as string;
    const state = opts.prStates?.[branch];
    return { stdout: JSON.stringify(state ? [{ number: 1, url: 'https://github.com/o/r/pull/1', state }] : []) };
  };
  const resolveIntent = vi.fn(async (input: WorkspaceCreateInput): Promise<ResolvedWorkspaceIntent> => {
    const name = input.name as string;
    const path = join(projectDir, 'workspaces', `scratch-${name}`);
    const collides = (opts.pathExists ?? []).includes(name);
    return {
      projectId: 'p',
      kind: 'scratch',
      name,
      path: collides ? null : path,
      branchName: collides ? null : `scratch/${name}`,
      parentBranch: input.parentBranch ?? null,
      parentBranchGuessed: false,
      isGitRepository: true,
      wouldCreateWorktree: !collides,
      unregisteredTargetPath: false,
      branchCandidates: [],
      findings: collides ? [{ field: 'name', code: 'path-exists', message: `Path already exists: ${path}` }] : [],
    };
  });
  const performCreate = vi.fn(async (intent: ResolvedWorkspaceIntent) => {
    const id = `new-${++created}`;
    rows.push({ ...row(id, intent.branchName as string, 10_000 + created), name: intent.name, path: intent.path as string });
    return { id };
  });
  const deps: EditWorkspaceDeps = {
    listProjects: async () => [{ key: 'p', config }],
    listWorkspaces: () => rows,
    getWorkspaceById: (id) => rows.find((r) => r.id === id) ?? null,
    getWorkspaceByName: (_project, name) => rows.find((r) => r.name === name) ?? null,
    resolveRoot: async (rootId) => {
      const id = rootId.replace(/^workspace:/, '');
      const found = rows.find((r) => r.id === id);
      if (!found) throw new PanRpcError({ code: 'ROOT_NOT_FOUND', message: `no ${rootId}` });
      return { kind: 'workspace', id: rootId, absPath: found.path, writable: true, projectKey: 'p', workspaceId: id, defaultBranch: 'main' } satisfies ExplorerRoot;
    },
    resolveIntent: resolveIntent as EditWorkspaceDeps['resolveIntent'],
    performCreate: performCreate as EditWorkspaceDeps['performCreate'],
    runGit,
    gh,
    now: () => NOW,
  };
  return { deps, rows, performCreate, gitCalls };
}

const GITHUB = { github_repo: 'o/r' };

describe('beginEdit', () => {
  it('reuses the newest edit row whose PR is OPEN', async () => {
    const h = harness({
      config: GITHUB,
      rows: [row('old', 'scratch/edit-1101-0900', 1), row('new', 'scratch/edit-1112-0900', 2)],
      prStates: { 'scratch/edit-1112-0900': 'OPEN', 'scratch/edit-1101-0900': 'OPEN' },
    });
    const result = await beginEdit('p', false, h.deps);
    expect(result).toMatchObject({ rootId: 'workspace:new', workspaceId: 'new', branch: 'scratch/edit-1112-0900', created: false });
    expect(h.performCreate).not.toHaveBeenCalled();
  });

  it('skips a row whose PR is MERGED and creates edit-1113-1405', async () => {
    const h = harness({ config: GITHUB, rows: [row('done', 'scratch/edit-1112-0900', 2)], prStates: { 'scratch/edit-1112-0900': 'MERGED' } });
    const result = await beginEdit('p', false, h.deps);
    expect(result).toEqual({
      rootId: 'workspace:new-1',
      workspaceId: 'new-1',
      name: 'edit-1113-1405',
      branch: 'scratch/edit-1113-1405',
      path: join(projectDir, 'workspaces', 'scratch-edit-1113-1405'),
      created: true,
    });
  });

  it('ignores scratch rows that are not on an edit branch', async () => {
    const h = harness({ rows: [row('notes', 'scratch/notes', 5)] });
    const result = await beginEdit('p', false, h.deps);
    expect(result.created).toBe(true);
  });

  it('creates even when a reusable row exists if forceNew is set', async () => {
    const h = harness({ rows: [row('reuse', 'scratch/edit-1112-0900', 2)] });
    const result = await beginEdit('p', true, h.deps);
    expect(result).toMatchObject({ name: 'edit-1113-1405', created: true });
    expect(h.performCreate).toHaveBeenCalledTimes(1);
  });

  it('moves to edit-1113-1405-2 when the path for edit-1113-1405 exists', async () => {
    const h = harness({ pathExists: ['edit-1113-1405'] });
    const result = await beginEdit('p', false, h.deps);
    expect(result).toMatchObject({ name: 'edit-1113-1405-2', branch: 'scratch/edit-1113-1405-2' });
  });

  it('skips a name whose local branch already exists', async () => {
    const h = harness({ localBranches: ['scratch/edit-1113-1405'] });
    const result = await beginEdit('p', false, h.deps);
    expect(result.name).toBe('edit-1113-1405-2');
  });

  it('cuts the workspace from the default branch with an isolated scratch intent', async () => {
    const h = harness({ config: { workspace: { default_branch: 'trunk' } } as Partial<ProjectConfig> });
    await beginEdit('p', false, h.deps);
    expect(h.deps.resolveIntent).toHaveBeenCalledWith({
      kind: 'scratch',
      name: 'edit-1113-1405',
      projectKey: 'p',
      isolated: true,
      parentBranch: 'trunk',
      refreshParentBranch: true,
    });
  });

  it('creates once for two concurrent calls on one project, and both return the same workspace', async () => {
    const h = harness();
    const [a, b] = await Promise.all([beginEdit('p', false, h.deps), beginEdit('p', false, h.deps)]);
    expect(h.performCreate).toHaveBeenCalledTimes(1);
    expect(a.workspaceId).toBe(b.workspaceId);
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
  });

  it('rejects a non-git project path with NOT_A_GIT_REPO', async () => {
    const h = harness({ gitTopLevel: null });
    await expect(beginEdit('p', false, h.deps)).rejects.toMatchObject({ code: 'NOT_A_GIT_REPO' });
  });

  it('rejects a project nested inside another repository with NOT_A_GIT_REPO', async () => {
    const h = harness({ gitTopLevel: tmpdir() });
    await expect(beginEdit('p', false, h.deps)).rejects.toMatchObject({ code: 'NOT_A_GIT_REPO' });
  });

  it('rejects an unknown project with ROOT_NOT_FOUND', async () => {
    const h = harness();
    await expect(beginEdit('nope', false, h.deps)).rejects.toMatchObject({ code: 'ROOT_NOT_FOUND' });
  });
});

describe('resolveEditWorkspace', () => {
  it('rejects a row on branch scratch/notes with NOT_AN_EDIT_WORKSPACE', async () => {
    const h = harness({ rows: [row('notes', 'scratch/notes', 1)] });
    const error = await resolveEditWorkspace('notes', h.deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EditWorkspaceError);
    expect(error).toMatchObject({ code: 'NOT_AN_EDIT_WORKSPACE', status: 409 });
  });

  it('resolves an edit row with its root and project', async () => {
    const h = harness({ rows: [row('e1', 'scratch/edit-1113-1405', 1)] });
    const resolved = await resolveEditWorkspace('e1', h.deps);
    expect(resolved.root.id).toBe('workspace:e1');
    expect(resolved.row.id).toBe('e1');
    expect(resolved.project.key).toBe('p');
  });
});

describe('editSupport', () => {
  const base = { name: 'p', path: '/p' } as ProjectConfig;

  it('has neither PR nor pipeline support without github_repo', () => {
    expect(editSupport(base)).toEqual({
      prSupport: { available: false, reason: PR_SUPPORT_REASON },
      pipelineSupport: { available: false, reason: PR_SUPPORT_REASON },
      repo: null,
    });
  });

  it('has PR support but no pipeline support without an issue prefix', () => {
    const support = editSupport({ ...base, github_repo: 'o/r' });
    expect(support.prSupport).toEqual({ available: true, reason: null });
    expect(support.pipelineSupport).toEqual({ available: false, reason: PIPELINE_SUPPORT_REASON });
    expect(support.repo).toBe('o/r');
  });

  it('has pipeline support for a GitHub-tracked project with an issue prefix', () => {
    const support = editSupport({ ...base, github_repo: 'o/r', issue_prefix: 'PAN' });
    expect(support.pipelineSupport).toEqual({ available: true, reason: null });
  });

  it('has no PR support when the project also names a GitLab repo', () => {
    expect(editSupport({ ...base, github_repo: 'o/r', gitlab_repo: 'g/r' } as ProjectConfig).repo).toBeNull();
  });
});
