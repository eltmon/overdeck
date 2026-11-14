import { describe, expect, it, vi } from 'vitest';
import type { ProjectConfig } from '../../../../../lib/projects.js';
import type { WorkspaceRow } from '../../../../../lib/workspaces/types.js';
import type { GhRunner } from '../edit-workspace-gh.js';
import { PR_SUPPORT_REASON } from '../edit-workspace.js';
import { EditWorkspaceError } from '../edit-workspace-errors.js';
import { createDirectPr, getEditWorkspaceStatus, type EditWorkspacePrDeps } from '../edit-workspace-pr.js';
import type { ExplorerRoot } from '../roots.js';

const PATH = '/p/workspaces/scratch-edit-1113-1405';

function row(branch: string): WorkspaceRow {
  return {
    id: 'w1', projectId: 'p', kind: 'scratch', name: branch.replace(/^scratch\//, ''), path: PATH, branchName: branch,
    parentBranch: 'main', parentBranchGuessed: false, isGitRepository: true, issueId: null, layoutConfig: null,
    runCommand: null, isFavorite: false, isArchived: false, title: null, createdAt: 1, lastAccessedAt: 1,
  };
}

function deps(config: Partial<ProjectConfig>, gh: GhRunner, branch = 'scratch/edit-1113-1405'): EditWorkspacePrDeps {
  const root: ExplorerRoot = { kind: 'workspace', id: 'workspace:w1', absPath: PATH, writable: true, projectKey: 'p', workspaceId: 'w1', defaultBranch: 'main' };
  return {
    resolveRoot: async () => root,
    getWorkspaceById: () => row(branch),
    listProjects: async () => [{ key: 'p', config: { name: 'p', path: '/p', ...config } as ProjectConfig }],
    gh,
    sleep: async () => {},
  };
}

const openCleanGh: GhRunner = async (args) => {
  if (args[1] === 'list') return { stdout: JSON.stringify([{ number: 3, url: 'https://github.com/o/r/pull/3', state: 'OPEN' }]) };
  return { stdout: JSON.stringify({ mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', headRefOid: 'abc', state: 'OPEN', isDraft: false }) };
};

describe('getEditWorkspaceStatus', () => {
  it('reports no PR support without github_repo and makes no gh call', async () => {
    const gh = vi.fn(openCleanGh);
    const status = await getEditWorkspaceStatus('w1', deps({}, gh));
    expect(status.prSupport).toEqual({ available: false, reason: PR_SUPPORT_REASON });
    expect(status.pipelineSupport).toEqual({ available: false, reason: PR_SUPPORT_REASON });
    expect(status.pr).toBeNull();
    expect(gh).not.toHaveBeenCalled();
    expect(status.workspace).toEqual({
      id: 'w1', rootId: 'workspace:w1', name: 'edit-1113-1405', branch: 'scratch/edit-1113-1405',
      projectKey: 'p', defaultBranch: 'main', path: PATH,
    });
  });

  it('reports an open CLEAN PR as mergeable', async () => {
    const status = await getEditWorkspaceStatus('w1', deps({ github_repo: 'o/r' }, openCleanGh));
    expect(status.pr).toMatchObject({ number: 3, state: 'OPEN', canMerge: true, reason: null, headSha: 'abc' });
    expect(status.prSupport.available).toBe(true);
  });

  it('returns pr null when the gh lookup fails', async () => {
    const failing: GhRunner = async () => { throw new Error('gh: network down'); };
    const status = await getEditWorkspaceStatus('w1', deps({ github_repo: 'o/r' }, failing));
    expect(status.pr).toBeNull();
  });

  it('rejects a row that is not on an edit branch', async () => {
    await expect(getEditWorkspaceStatus('w1', deps({}, openCleanGh, 'scratch/notes'))).rejects.toMatchObject({ code: 'NOT_AN_EDIT_WORKSPACE' });
  });
});

describe('createDirectPr', () => {
  const input = { title: 'chore: edit README.md', body: 'Body', draft: true };

  function directDeps(prState: string | null, extra: Partial<EditWorkspacePrDeps> = {}) {
    const calls: string[] = [];
    const ghCalls: string[][] = [];
    const gh: GhRunner = async (args) => {
      ghCalls.push(args);
      if (args[1] === 'list') {
        return { stdout: JSON.stringify(prState ? [{ number: 8, url: 'https://github.com/o/r/pull/8', state: prState }] : []) };
      }
      return { stdout: 'https://github.com/o/r/pull/9\n' };
    };
    const commitAll = vi.fn(async (..._args: unknown[]) => {
      calls.push('commit');
      return { committed: true };
    });
    const pushHead = vi.fn(async (..._args: unknown[]) => {
      calls.push('push');
    });
    const d: EditWorkspacePrDeps = {
      ...deps({ github_repo: 'o/r' }, gh),
      commitAll: commitAll as EditWorkspacePrDeps['commitAll'],
      pushHead: pushHead as EditWorkspacePrDeps['pushHead'],
      ...extra,
    };
    return { d, calls, ghCalls, commitAll, pushHead };
  }

  it('commits with the title, pushes with upstream and opens a draft PR', async () => {
    const { d, calls, ghCalls, commitAll, pushHead } = directDeps(null);
    const result = await createDirectPr('w1', input, d);
    expect(result).toEqual({ mode: 'direct', url: 'https://github.com/o/r/pull/9', number: 9, created: true });
    expect(calls).toEqual(['commit', 'push']);
    expect(commitAll).toHaveBeenCalledWith(PATH, 'chore: edit README.md', 'refs/remotes/origin/main');
    expect(pushHead).toHaveBeenCalledWith(PATH, 'scratch/edit-1113-1405', { setUpstream: true });
    const create = ghCalls.find((args) => args[1] === 'create');
    expect(create).toContain('--draft');
    expect(create?.slice(create.indexOf('--base'), create.indexOf('--base') + 2)).toEqual(['--base', 'main']);
  });

  it('pushes to an open PR and returns created false without gh pr create', async () => {
    const { d, ghCalls, pushHead } = directDeps('OPEN');
    const result = await createDirectPr('w1', input, d);
    expect(result).toEqual({ mode: 'direct', url: 'https://github.com/o/r/pull/8', number: 8, created: false });
    expect(pushHead).toHaveBeenCalledTimes(1);
    expect(ghCalls.some((args) => args[1] === 'create')).toBe(false);
  });

  it('propagates NOTHING_TO_COMMIT and pushes nothing', async () => {
    const { d, pushHead } = directDeps(null, {
      commitAll: (async () => {
        throw new EditWorkspaceError('NOTHING_TO_COMMIT', 409, 'There are no changes to commit.');
      }) as EditWorkspacePrDeps['commitAll'],
    });
    await expect(createDirectPr('w1', input, d)).rejects.toMatchObject({ code: 'NOTHING_TO_COMMIT', status: 409 });
    expect(pushHead).not.toHaveBeenCalled();
  });

  it('rejects PR_UNSUPPORTED without github_repo before committing', async () => {
    const { d, commitAll } = directDeps(null);
    const noRepo = { ...d, listProjects: async () => [{ key: 'p', config: { name: 'p', path: '/p' } as ProjectConfig }] };
    await expect(createDirectPr('w1', input, noRepo)).rejects.toMatchObject({ code: 'PR_UNSUPPORTED', status: 409 });
    expect(commitAll).not.toHaveBeenCalled();
  });

  it('maps a failing gh pr create to PR_CREATE_FAILED', async () => {
    const { d } = directDeps(null);
    const failing: GhRunner = async (args) => {
      if (args[1] === 'list') return { stdout: '[]' };
      throw new Error('GraphQL: something broke');
    };
    await expect(createDirectPr('w1', input, { ...d, gh: failing })).rejects.toMatchObject({ code: 'PR_CREATE_FAILED', status: 502 });
  });
});
