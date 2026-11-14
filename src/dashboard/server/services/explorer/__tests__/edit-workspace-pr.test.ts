import { describe, expect, it, vi } from 'vitest';
import type { ProjectConfig } from '../../../../../lib/projects.js';
import type { WorkspaceRow } from '../../../../../lib/workspaces/types.js';
import type { GhRunner } from '../edit-workspace-gh.js';
import { PR_SUPPORT_REASON } from '../edit-workspace.js';
import { EditWorkspaceError } from '../edit-workspace-errors.js';
import {
  createDirectPr,
  discardEditWorkspace,
  getEditWorkspaceStatus,
  mergeEditWorkspace,
  type EditWorkspacePrDeps,
} from '../edit-workspace-pr.js';
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

describe('mergeEditWorkspace and discardEditWorkspace', () => {
  function prGh(state: string, view: { mergeable: string; mergeStateStatus: string } = { mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' }) {
    const ghCalls: string[][] = [];
    const gh: GhRunner = async (args) => {
      ghCalls.push(args);
      if (args[1] === 'list') return { stdout: JSON.stringify([{ number: 5, url: 'https://github.com/o/r/pull/5', state }]) };
      if (args[1] === 'view') return { stdout: JSON.stringify({ ...view, headRefOid: 'head1', state, isDraft: false }) };
      return { stdout: '' };
    };
    return { gh, ghCalls };
  }

  function mergeDeps(gh: GhRunner, extra: Partial<EditWorkspacePrDeps> = {}) {
    const mergePr = vi.fn(async (..._args: unknown[]) => {});
    const removeEditWorkspace = vi.fn(async (..._args: unknown[]) => {});
    const d: EditWorkspacePrDeps = {
      ...deps({ github_repo: 'o/r' }, gh),
      isClean: async () => true,
      headSha: async () => 'head1',
      mergePr: mergePr as EditWorkspacePrDeps['mergePr'],
      removeEditWorkspace: removeEditWorkspace as EditWorkspacePrDeps['removeEditWorkspace'],
      ...extra,
    };
    return { d, mergePr, removeEditWorkspace };
  }

  it('refuses a DIRTY PR with NOT_MERGEABLE and never calls the adapter', async () => {
    const { gh } = prGh('OPEN', { mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' });
    const { d, mergePr } = mergeDeps(gh);
    await expect(mergeEditWorkspace('w1', d)).rejects.toMatchObject({
      code: 'NOT_MERGEABLE',
      status: 409,
      message: 'Conflicts with the base branch',
    });
    expect(mergePr).not.toHaveBeenCalled();
  });

  it('refuses UNPUSHED_CHANGES when the worktree is dirty', async () => {
    const { gh } = prGh('OPEN');
    const { d, mergePr } = mergeDeps(gh, { isClean: async () => false });
    await expect(mergeEditWorkspace('w1', d)).rejects.toMatchObject({ code: 'UNPUSHED_CHANGES', message: 'Commit and push your changes first.' });
    expect(mergePr).not.toHaveBeenCalled();
  });

  it('refuses UNPUSHED_CHANGES when local HEAD differs from the PR head', async () => {
    const { gh } = prGh('OPEN');
    const { d, mergePr } = mergeDeps(gh, { headSha: async () => 'local2' });
    await expect(mergeEditWorkspace('w1', d)).rejects.toMatchObject({ code: 'UNPUSHED_CHANGES' });
    expect(mergePr).not.toHaveBeenCalled();
  });

  it('squash-merges pinned to the PR head, then removes with the remote branch', async () => {
    const { gh } = prGh('OPEN');
    const { d, mergePr, removeEditWorkspace } = mergeDeps(gh);
    expect(await mergeEditWorkspace('w1', d)).toEqual({ merged: true });
    expect(mergePr).toHaveBeenCalledWith(
      expect.objectContaining({ forge: 'github', url: 'https://github.com/o/r/pull/5', method: 'squash', matchHeadCommit: 'head1', repository: 'o/r' }),
    );
    expect(removeEditWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ primaryPath: '/p' }),
      { force: false, deleteRemoteBranch: true },
    );
  });

  it('answers NO_PR when the branch has no PR', async () => {
    const gh: GhRunner = async () => ({ stdout: '[]' });
    await expect(mergeEditWorkspace('w1', mergeDeps(gh).d)).rejects.toMatchObject({ code: 'NO_PR', status: 404 });
  });

  it('reports REMOVE_FAILED with status 500 when cleanup fails after the merge', async () => {
    const { gh } = prGh('OPEN');
    const { d } = mergeDeps(gh, {
      removeEditWorkspace: (async () => {
        throw new Error('worktree locked');
      }) as EditWorkspacePrDeps['removeEditWorkspace'],
    });
    await expect(mergeEditWorkspace('w1', d)).rejects.toMatchObject({ code: 'REMOVE_FAILED', status: 500 });
  });

  it('discard with closePr closes an open PR, then removes with force and the remote branch', async () => {
    const { gh, ghCalls } = prGh('OPEN');
    const { d, removeEditWorkspace } = mergeDeps(gh);
    expect(await discardEditWorkspace('w1', { closePr: true }, d)).toEqual({ removed: true, prClosed: true });
    expect(ghCalls.some((args) => args[0] === 'pr' && args[1] === 'close' && args[2] === '5')).toBe(true);
    expect(removeEditWorkspace).toHaveBeenCalledWith(expect.anything(), { force: true, deleteRemoteBranch: true });
  });

  it('discard without closePr keeps the open PR and its remote branch', async () => {
    const { gh, ghCalls } = prGh('OPEN');
    const { d, removeEditWorkspace } = mergeDeps(gh);
    expect(await discardEditWorkspace('w1', { closePr: false }, d)).toEqual({ removed: true, prClosed: false });
    expect(ghCalls.some((args) => args[1] === 'close')).toBe(false);
    expect(removeEditWorkspace).toHaveBeenCalledWith(expect.anything(), { force: true, deleteRemoteBranch: false });
  });

  it('a PR_CLOSE_FAILED leaves the workspace in place', async () => {
    const gh: GhRunner = async (args) => {
      if (args[1] === 'list') return { stdout: JSON.stringify([{ number: 5, url: 'https://github.com/o/r/pull/5', state: 'OPEN' }]) };
      throw new Error('HTTP 502');
    };
    const { d, removeEditWorkspace } = mergeDeps(gh);
    await expect(discardEditWorkspace('w1', { closePr: true }, d)).rejects.toMatchObject({ code: 'PR_CLOSE_FAILED', status: 502 });
    expect(removeEditWorkspace).not.toHaveBeenCalled();
  });
});

describe('CodeRabbit fixes on PR #5226', () => {
  const listOpen = JSON.stringify([{ number: 5, url: 'https://github.com/o/r/pull/5', state: 'OPEN' }])
  const viewClean = JSON.stringify({ mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', headRefOid: 'head1', state: 'OPEN', isDraft: false })
  const failingList: GhRunner = async (args) => {
    if (args[1] === 'list') throw new Error('HTTP 502')
    return { stdout: '' }
  }

  it('discard with closePr stops with PR_LOOKUP_FAILED when the PR lookup fails, and removes nothing', async () => {
    const removeEditWorkspace = vi.fn(async (..._args: unknown[]) => {})
    const d = { ...deps({ github_repo: 'o/r' }, failingList), removeEditWorkspace: removeEditWorkspace as EditWorkspacePrDeps['removeEditWorkspace'] }
    await expect(discardEditWorkspace('w1', { closePr: true }, d)).rejects.toMatchObject({ code: 'PR_LOOKUP_FAILED', status: 502 })
    expect(removeEditWorkspace).not.toHaveBeenCalled()
  })

  it('discard without closePr keeps the remote branch when the PR lookup fails', async () => {
    const removeEditWorkspace = vi.fn(async (..._args: unknown[]) => {})
    const d = { ...deps({ github_repo: 'o/r' }, failingList), removeEditWorkspace: removeEditWorkspace as EditWorkspacePrDeps['removeEditWorkspace'] }
    expect(await discardEditWorkspace('w1', { closePr: false }, d)).toEqual({ removed: true, prClosed: false })
    expect(removeEditWorkspace).toHaveBeenCalledWith(expect.anything(), { force: true, deleteRemoteBranch: false })
  })

  it('status reports unpushedCommits when HEAD is not the open PR head', async () => {
    const gh: GhRunner = async (args) => ({ stdout: args[1] === 'list' ? listOpen : viewClean })
    const ahead = await getEditWorkspaceStatus('w1', { ...deps({ github_repo: 'o/r' }, gh), headSha: async () => 'local2' })
    expect(ahead.unpushedCommits).toBe(true)
    const even = await getEditWorkspaceStatus('w1', { ...deps({ github_repo: 'o/r' }, gh), headSha: async () => 'head1' })
    expect(even.unpushedCommits).toBe(false)
  })

  it('runs lifecycle operations on one workspace one at a time', async () => {
    const events: string[] = []
    let releaseMerge!: () => void
    const gh: GhRunner = async (args) => ({ stdout: args[1] === 'list' ? listOpen : args[1] === 'view' ? viewClean : '' })
    const base = deps({ github_repo: 'o/r' }, gh)
    const merging = mergeEditWorkspace('w1', {
      ...base,
      isClean: async () => true,
      headSha: async () => 'head1',
      mergePr: async () => {
        events.push('merge start')
        await new Promise<void>((resolve) => (releaseMerge = resolve))
        events.push('merge end')
      },
      removeEditWorkspace: (async () => {
        events.push('merge remove')
      }) as EditWorkspacePrDeps['removeEditWorkspace'],
    })
    const pushing = createDirectPr('w1', { title: 't', body: '', draft: false }, {
      ...base,
      commitAll: (async () => {
        events.push('commit')
        return { committed: true }
      }) as EditWorkspacePrDeps['commitAll'],
      pushHead: async () => {},
    })
    await vi.waitFor(() => expect(events).toContain('merge start'))
    expect(events).not.toContain('commit')
    releaseMerge()
    await merging
    await pushing
    expect(events).toEqual(['merge start', 'merge end', 'merge remove', 'commit'])
  })
})
