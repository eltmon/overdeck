import { beforeEach, describe, expect, it, vi } from 'vitest';

const repoRootsMock = vi.hoisted(() => ({
  resolveWorkspaceRepoRootsSync: vi.fn(),
}));

vi.mock('../../../src/lib/project-repos.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/lib/project-repos.js')>('../../../src/lib/project-repos.js');
  return {
    ...actual,
    resolveWorkspaceRepoRootsSync: repoRootsMock.resolveWorkspaceRepoRootsSync,
  };
});

import {
  parseWorkspaceHeadAnchor,
  renderWorkspaceGitShowPromise,
} from '../../../src/lib/git-utils.js';

const FE_SHA = 'a'.repeat(40);
const API_SHA = 'b'.repeat(40);

describe('polyrepo workspace head anchors', () => {
  beforeEach(() => {
    repoRootsMock.resolveWorkspaceRepoRootsSync.mockReset();
  });

  it('keeps a plain sha on the single workspace git-show path', async () => {
    const gitShow = vi.fn().mockResolvedValue('plain diff\n');

    expect(parseWorkspaceHeadAnchor(FE_SHA)).toBeNull();
    await expect(renderWorkspaceGitShowPromise(
      'PAN-2956',
      '/workspace',
      FE_SHA,
      ['--stat'],
      gitShow,
    )).resolves.toBe('plain diff\n');

    expect(repoRootsMock.resolveWorkspaceRepoRootsSync).not.toHaveBeenCalled();
    expect(gitShow).toHaveBeenCalledWith('/workspace', FE_SHA, ['--stat']);
  });

  it('runs git show once per sub-repo and labels the concatenated diffs', async () => {
    repoRootsMock.resolveWorkspaceRepoRootsSync.mockReturnValue([
      {
        repoKey: 'fe',
        dir: '/workspace/fe',
        sourceBranch: 'feature/min-882',
        targetBranch: 'main',
        isPolyrepo: true,
      },
      {
        repoKey: 'api',
        dir: '/workspace/api',
        sourceBranch: 'feature/min-882',
        targetBranch: 'main',
        isPolyrepo: true,
      },
    ]);
    const gitShow = vi.fn(async (repoPath: string) => `${repoPath} diff\n`);
    const anchor = `fe@${FE_SHA} api@${API_SHA}`;

    expect(parseWorkspaceHeadAnchor(anchor)).toEqual([
      { repoKey: 'fe', sha: FE_SHA },
      { repoKey: 'api', sha: API_SHA },
    ]);
    await expect(renderWorkspaceGitShowPromise(
      'MIN-882',
      '/workspace',
      anchor,
      [],
      gitShow,
    )).resolves.toBe(
      '── fe ──\n/workspace/fe diff\n── api ──\n/workspace/api diff',
    );

    expect(gitShow).toHaveBeenNthCalledWith(1, '/workspace/fe', FE_SHA, []);
    expect(gitShow).toHaveBeenNthCalledWith(2, '/workspace/api', API_SHA, []);
  });

  it('rejects malformed composites before invoking git', async () => {
    const gitShow = vi.fn();

    await expect(renderWorkspaceGitShowPromise(
      'MIN-882',
      '/workspace',
      `fe@${FE_SHA} invalid`,
      [],
      gitShow,
    )).rejects.toThrow("Invalid workspace head anchor token 'invalid'");
    expect(gitShow).not.toHaveBeenCalled();
  });

  it('reports an unresolved repo instead of passing the composite to git', async () => {
    repoRootsMock.resolveWorkspaceRepoRootsSync.mockReturnValue([]);
    const gitShow = vi.fn();

    await expect(renderWorkspaceGitShowPromise(
      'MIN-882',
      '/workspace',
      `fe@${FE_SHA}`,
      [],
      gitShow,
    )).rejects.toThrow("Composite workspace head anchor repo 'fe' was not found");
    expect(gitShow).not.toHaveBeenCalled();
  });
});
