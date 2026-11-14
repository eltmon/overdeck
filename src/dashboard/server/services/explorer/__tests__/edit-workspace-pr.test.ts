import { describe, expect, it, vi } from 'vitest';
import type { ProjectConfig } from '../../../../../lib/projects.js';
import type { WorkspaceRow } from '../../../../../lib/workspaces/types.js';
import type { GhRunner } from '../edit-workspace-gh.js';
import { PR_SUPPORT_REASON } from '../edit-workspace.js';
import { getEditWorkspaceStatus, type EditWorkspacePrDeps } from '../edit-workspace-pr.js';
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
