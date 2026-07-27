import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  discoverArtifactMock,
  ensureMergeSetForIssueMock,
  execMock,
  findMergedArtifactMock,
  getForgeAdapterMock,
  getMergeSetMock,
  patchMergeSetRepoMock,
  patchMergeSetReposMock,
  resolveProjectReposForIssueMock,
  upsertMergeSetMock,
  withRepoArtifactUrlMock,
  withRepoStateMock,
} = vi.hoisted(() => ({
  discoverArtifactMock: vi.fn(),
  ensureMergeSetForIssueMock: vi.fn(),
  execMock: vi.fn<[string, any?], Promise<{ stdout: string; stderr: string }>>(),
  findMergedArtifactMock: vi.fn(),
  getForgeAdapterMock: vi.fn(),
  getMergeSetMock: vi.fn(),
  patchMergeSetRepoMock: vi.fn(),
  patchMergeSetReposMock: vi.fn(),
  resolveProjectReposForIssueMock: vi.fn(),
  upsertMergeSetMock: vi.fn(),
  withRepoArtifactUrlMock: vi.fn(),
  withRepoStateMock: vi.fn(),
}));

vi.mock('child_process', () => {
  const kCustom = Symbol.for('nodejs.util.promisify.custom');

  function exec(cmd: string, optionsOrCb: any, maybeCallback?: any) {
    const callback = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCallback;
    execMock(cmd, typeof optionsOrCb === 'object' ? optionsOrCb : undefined)
      .then(({ stdout, stderr }) => callback(null, stdout, stderr))
      .catch((err: any) => callback(err, err.stdout || '', err.stderr || ''));
  }

  (exec as any)[kCustom] = execMock;
  return { exec };
});

vi.mock('../../../../src/lib/merge-set.js', () => ({
  ensureMergeSetForIssueSync: ensureMergeSetForIssueMock,
  getMergeSetSync: getMergeSetMock,
  patchMergeSetRepoSync: patchMergeSetRepoMock,
  patchMergeSetReposSync: patchMergeSetReposMock,
  upsertMergeSetSync: upsertMergeSetMock,
  withRepoArtifactUrlSync: withRepoArtifactUrlMock,
  withRepoStateSync: withRepoStateMock,
}));

vi.mock('../../../../src/lib/project-repos.js', () => ({
  resolveProjectReposForIssueSync: resolveProjectReposForIssueMock,
}));

vi.mock('../../../../src/lib/forge.js', () => ({
  getForgeAdapter: getForgeAdapterMock,
}));

import {
  assessMergeCompleteness,
  observeForgeMergeState,
  reconcileStrandedRepos,
} from '../../../../src/lib/cloister/merge-completeness.js';

function repo(
  repoKey: string,
  forge: 'github' | 'gitlab' = 'github',
  required = true,
) {
  return {
    repoKey,
    repoPath: `/projects/myn/${repoKey}`,
    forge,
    sourceBranch: 'feature/min-857',
    targetBranch: 'main',
    required,
  };
}

let storedMergeSet: any = null;

function mergeSet(repos: ReturnType<typeof repo>[]) {
  return { issueId: 'MIN-857', repos };
}

function seedMergeSet(repos: ReturnType<typeof repo>[]) {
  storedMergeSet = mergeSet(repos);
  return storedMergeSet;
}

const currentHead = 'current-head-sha\n';

function gitResult(stdout = '') {
  return { stdout, stderr: '' };
}

function repoGitResult(command: string, aheadCount: string): { stdout: string; stderr: string } {
  if (command.includes('rev-list --count')) return gitResult(aheadCount);
  if (command.includes('rev-parse')) return gitResult(currentHead);
  return gitResult();
}

function missingBranchError(branch: string) {
  const error = new Error(`Command failed: fatal: couldn't find remote ref ${branch}`) as Error & { stderr: string };
  error.stderr = `fatal: couldn't find remote ref ${branch}`;
  return error;
}

describe('assessMergeCompleteness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureMergeSetForIssueMock.mockReturnValue(mergeSet([]));
    resolveProjectReposForIssueMock.mockReturnValue(null);
    getForgeAdapterMock.mockReturnValue({
      discoverArtifact: discoverArtifactMock,
      findMergedArtifact: findMergedArtifactMock,
    });
    execMock.mockResolvedValue(gitResult());
    discoverArtifactMock.mockResolvedValue(null);
    findMergedArtifactMock.mockResolvedValue(null);
    withRepoArtifactUrlMock.mockImplementation((current, repoKey, artifactUrl, artifactId) => ({
      ...current,
      repos: current.repos.map((entry) => (
        entry.repoKey === repoKey ? { ...entry, artifactUrl, artifactId } : entry
      )),
    }));
    withRepoStateMock.mockImplementation((current, repoKey, patch) => ({
      ...current,
      repos: current.repos.map((entry) => (
        entry.repoKey === repoKey ? { ...entry, ...patch } : entry
      )),
    }));
  });

  it('returns complete when every changed required repo has a merged artifact', async () => {
    ensureMergeSetForIssueMock.mockReturnValue(mergeSet([
      repo('fe', 'github'),
      repo('api', 'gitlab'),
    ]));
    execMock.mockImplementation(async (command, options) => {
      if (command.includes('rev-list --count')) {
        return gitResult(options.cwd.endsWith('/fe') ? '1\n' : '2\n');
      }
      if (command.includes('rev-parse')) return gitResult(currentHead);
      return gitResult();
    });
    findMergedArtifactMock
      .mockResolvedValueOnce({ forge: 'github', created: false, url: 'https://github/pr/1', id: '1' })
      .mockResolvedValueOnce({ forge: 'gitlab', created: false, url: 'https://gitlab/mr/2', id: '2' });

    const result = await assessMergeCompleteness('MIN-857');

    expect(result.complete).toBe(true);
    expect(result.repos).toEqual([
      expect.objectContaining({ repoKey: 'fe', state: 'merged', aheadCount: 1 }),
      expect.objectContaining({ repoKey: 'api', state: 'merged', aheadCount: 2 }),
    ]);
    expect(getForgeAdapterMock).toHaveBeenNthCalledWith(1, 'github');
    expect(getForgeAdapterMock).toHaveBeenNthCalledWith(2, 'gitlab');
    expect(findMergedArtifactMock).toHaveBeenNthCalledWith(1, {
      sourceBranch: 'feature/min-857',
      cwd: '/projects/myn/fe',
    });
    expect(findMergedArtifactMock).toHaveBeenNthCalledWith(2, {
      sourceBranch: 'feature/min-857',
      targetBranch: 'main',
      headSha: currentHead.trim(),
      artifactUrl: undefined,
      artifactId: undefined,
      cwd: '/projects/myn/api',
    });
  });

  it('returns unmerged when a required sibling has commits but no merged artifact', async () => {
    ensureMergeSetForIssueMock.mockReturnValue(mergeSet([
      repo('fe'),
      repo('api', 'gitlab'),
      repo('docs', 'github', false),
    ]));
    execMock.mockImplementation(async (command, options) => {
      if (command.includes('rev-list --count')) {
        return gitResult(options.cwd.endsWith('/fe') ? '0\n' : '2\n');
      }
      if (command.includes('rev-parse')) return gitResult(currentHead);
      return gitResult();
    });

    const result = await assessMergeCompleteness('MIN-857');

    expect(result.complete).toBe(false);
    expect(result.repos).toEqual([
      expect.objectContaining({ repoKey: 'fe', state: 'no-changes', aheadCount: 0 }),
      expect.objectContaining({
        repoKey: 'api',
        state: 'unmerged',
        aheadCount: 2,
        reason: expect.stringContaining('api has 2 commits'),
      }),
      expect.objectContaining({ repoKey: 'docs', state: 'no-changes', aheadCount: 0 }),
    ]);
    expect(result.summary).toContain('api has 2 commits');
  });

  it('recognizes a squash-merged branch through its merged artifact', async () => {
    ensureMergeSetForIssueMock.mockReturnValue(mergeSet([repo('api', 'gitlab')]));
    execMock.mockImplementation(async (command) => repoGitResult(command, '2\n'));
    findMergedArtifactMock.mockResolvedValue({
      forge: 'gitlab',
      created: false,
      url: 'https://gitlab.com/org/api/-/merge_requests/56',
      id: '56',
    });

    const result = await assessMergeCompleteness('MIN-857');

    expect(result.complete).toBe(true);
    expect(result.repos[0]).toEqual(expect.objectContaining({
      repoKey: 'api',
      state: 'merged',
      aheadCount: 2,
      artifactUrl: 'https://gitlab.com/org/api/-/merge_requests/56',
    }));
  });

  it('fails closed when git fetch cannot verify a required repo', async () => {
    ensureMergeSetForIssueMock.mockReturnValue(mergeSet([repo('api', 'gitlab')]));
    execMock.mockRejectedValue(new Error('network unavailable'));

    const result = await assessMergeCompleteness('MIN-857');

    expect(result.complete).toBe(false);
    expect(result.repos[0]).toEqual(expect.objectContaining({
      repoKey: 'api',
      state: 'unverifiable',
      reason: expect.stringContaining('network unavailable'),
    }));
    expect(findMergedArtifactMock).not.toHaveBeenCalled();
  });

  it('fails closed when the forge cannot verify a changed required repo', async () => {
    ensureMergeSetForIssueMock.mockReturnValue(mergeSet([repo('api', 'gitlab')]));
    execMock.mockImplementation(async (command) => repoGitResult(command, '2\n'));
    findMergedArtifactMock.mockRejectedValue(new Error('glab authentication failed'));

    const result = await assessMergeCompleteness('MIN-857');

    expect(result.complete).toBe(false);
    expect(result.repos[0]).toEqual(expect.objectContaining({
      repoKey: 'api',
      state: 'unverifiable',
      reason: expect.stringContaining('glab authentication failed'),
    }));
  });

  it('falls back to the monorepo resolver and treats an absent source branch as no changes', async () => {
    ensureMergeSetForIssueMock.mockReturnValue(null);
    resolveProjectReposForIssueMock.mockReturnValue([repo('overdeck')]);
    execMock
      .mockRejectedValueOnce(missingBranchError('feature/min-857'))
      .mockResolvedValueOnce(gitResult());

    const result = await assessMergeCompleteness('MIN-857', ['project:overdeck']);

    expect(resolveProjectReposForIssueMock).toHaveBeenCalledWith('MIN-857', ['project:overdeck']);
    expect(result.complete).toBe(true);
    expect(result.repos).toEqual([
      expect.objectContaining({ repoKey: 'overdeck', state: 'no-changes', aheadCount: 0 }),
    ]);
    expect(execMock).toHaveBeenCalledTimes(2);
    expect(findMergedArtifactMock).not.toHaveBeenCalled();
  });
});

describe('observeForgeMergeState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveProjectReposForIssueMock.mockReturnValue(null);
    getForgeAdapterMock.mockReturnValue({
      discoverArtifact: discoverArtifactMock,
      findMergedArtifact: findMergedArtifactMock,
    });
    execMock.mockImplementation(async (command) => repoGitResult(command, ''));
    findMergedArtifactMock.mockResolvedValue(null);
    getMergeSetMock.mockReturnValue(null);
    patchMergeSetRepoMock.mockReturnValue(true);
  });

  it('persists current artifact-backed evidence through the conditional repo write door', async () => {
    const pending = {
      ...repo('api', 'gitlab'),
      artifactUrl: 'https://gitlab.com/org/api/-/merge_requests/56',
      artifactId: '56',
      mergeStatus: 'pending',
    };
    const initial = mergeSet([pending]);
    const persisted = mergeSet([{ ...pending, mergeStatus: 'merged' }]);
    ensureMergeSetForIssueMock.mockReturnValue(initial);
    getMergeSetMock.mockReturnValue(persisted);
    execMock.mockImplementation(async (command) => repoGitResult(command, '2\n'));
    findMergedArtifactMock.mockResolvedValue({
      forge: 'gitlab',
      created: false,
      url: pending.artifactUrl,
      id: pending.artifactId,
    });

    const result = await observeForgeMergeState('MIN-857');

    expect(findMergedArtifactMock).toHaveBeenCalledWith({
      sourceBranch: pending.sourceBranch,
      targetBranch: pending.targetBranch,
      headSha: currentHead.trim(),
      artifactUrl: pending.artifactUrl,
      artifactId: pending.artifactId,
      cwd: pending.repoPath,
    });
    expect(patchMergeSetRepoMock).toHaveBeenCalledWith('MIN-857', 'api', pending, {
      artifactId: '56',
      artifactUrl: pending.artifactUrl,
      mergeStatus: 'merged',
    });
    expect(result.complete).toBe(true);
    expect(result.hasPositiveMergedEvidence).toBe(true);
    expect(result.mergeSet?.repos[0]).toEqual(expect.objectContaining({ mergeStatus: 'merged' }));
    expect(upsertMergeSetMock).not.toHaveBeenCalled();
  });

  it('does not write merge state without positive merged evidence', async () => {
    const pending = { ...repo('api', 'gitlab'), mergeStatus: 'pending' };
    ensureMergeSetForIssueMock.mockReturnValue(mergeSet([pending]));
    execMock.mockImplementation(async (command) => (
      command.includes('rev-list --count') ? gitResult('0\n') : gitResult()
    ));

    const result = await observeForgeMergeState('MIN-857');

    expect(result.complete).toBe(true);
    expect(result.hasPositiveMergedEvidence).toBe(false);
    expect(result.repos).toEqual([
      expect.objectContaining({ repoKey: 'api', state: 'no-changes' }),
    ]);
    expect(patchMergeSetRepoMock).not.toHaveBeenCalled();
    expect(upsertMergeSetMock).not.toHaveBeenCalled();
  });

  it('does not rewrite an already-confirmed merged repo on each patrol', async () => {
    const merged = {
      ...repo('api', 'gitlab'),
      artifactUrl: 'https://gitlab.com/org/api/-/merge_requests/56',
      artifactId: '56',
      mergeStatus: 'merged',
    };
    const current = mergeSet([merged]);
    ensureMergeSetForIssueMock.mockReturnValue(current);
    getMergeSetMock.mockReturnValue(current);
    execMock.mockImplementation(async (command) => repoGitResult(command, '2\n'));
    findMergedArtifactMock.mockResolvedValue({
      forge: 'gitlab', created: false, url: merged.artifactUrl, id: merged.artifactId,
    });

    const result = await observeForgeMergeState('MIN-857');

    expect(result.complete).toBe(true);
    expect(result.hasPositiveMergedEvidence).toBe(true);
    expect(patchMergeSetRepoMock).not.toHaveBeenCalled();
  });

  it('rereads the merge set so concurrent sibling progress survives observation', async () => {
    const observed = {
      ...repo('fe', 'github'),
      artifactUrl: 'https://github.com/org/fe/pull/42',
      artifactId: '42',
      mergeStatus: 'pending',
    };
    const sibling = { ...repo('api', 'gitlab'), required: false, mergeStatus: 'pending' };
    ensureMergeSetForIssueMock.mockReturnValue(mergeSet([observed, sibling]));
    getMergeSetMock.mockReturnValue(mergeSet([
      { ...observed, mergeStatus: 'merged' },
      { ...sibling, mergeStatus: 'merging', rebaseStatus: 'passed', verificationStatus: 'passed' },
    ]));
    execMock.mockImplementation(async (command) => repoGitResult(command, '2\n'));
    findMergedArtifactMock.mockResolvedValue({
      forge: 'github', created: false, url: observed.artifactUrl, id: observed.artifactId,
    });

    const result = await observeForgeMergeState('MIN-857');

    expect(result.mergeSet?.repos.find((entry) => entry.repoKey === 'api')).toEqual(expect.objectContaining({
      mergeStatus: 'merging',
      rebaseStatus: 'passed',
      verificationStatus: 'passed',
    }));
    expect(upsertMergeSetMock).not.toHaveBeenCalled();
  });

  it('fails closed when the observed repo changes before the writeback', async () => {
    const pending = {
      ...repo('api', 'gitlab'),
      artifactUrl: 'https://gitlab.com/org/api/-/merge_requests/56',
      artifactId: '56',
      mergeStatus: 'pending',
    };
    ensureMergeSetForIssueMock.mockReturnValue(mergeSet([pending]));
    getMergeSetMock.mockReturnValue(mergeSet([{ ...pending, artifactId: '57' }]));
    patchMergeSetRepoMock.mockReturnValue(false);
    execMock.mockImplementation(async (command) => repoGitResult(command, '2\n'));
    findMergedArtifactMock.mockResolvedValue({
      forge: 'gitlab', created: false, url: pending.artifactUrl, id: pending.artifactId,
    });

    const result = await observeForgeMergeState('MIN-857');

    expect(result.complete).toBe(false);
    expect(result.hasPositiveMergedEvidence).toBe(false);
    expect(result.repos[0]).toEqual(expect.objectContaining({
      state: 'unverifiable',
      reason: expect.stringContaining('changed during forge observation'),
    }));
  });

  it('does not mark a historical artifact for an earlier source head as merged', async () => {
    const pending = {
      ...repo('api', 'gitlab'),
      artifactUrl: 'https://gitlab.com/org/api/-/merge_requests/55',
      artifactId: '55',
      mergeStatus: 'pending',
    };
    ensureMergeSetForIssueMock.mockReturnValue(mergeSet([pending]));
    execMock.mockImplementation(async (command) => repoGitResult(command, '2\n'));
    findMergedArtifactMock.mockResolvedValue(null);

    const result = await observeForgeMergeState('MIN-857');

    expect(result.complete).toBe(false);
    expect(result.hasPositiveMergedEvidence).toBe(false);
    expect(result.repos[0]).toEqual(expect.objectContaining({ state: 'unmerged' }));
    expect(patchMergeSetRepoMock).not.toHaveBeenCalled();
  });
});

describe('reconcileStrandedRepos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storedMergeSet = null;
    getForgeAdapterMock.mockReturnValue({
      discoverArtifact: discoverArtifactMock,
      findMergedArtifact: findMergedArtifactMock,
    });
    execMock.mockResolvedValue(gitResult());
    discoverArtifactMock.mockResolvedValue(null);
    findMergedArtifactMock.mockResolvedValue(null);
    getMergeSetMock.mockImplementation(() => storedMergeSet);
    patchMergeSetReposMock.mockImplementation((_issueId, patches) => {
      const matches = patches.every(({ repoKey, expected }) => {
        const current = storedMergeSet?.repos.find((entry) => entry.repoKey === repoKey);
        return current
          && current.sourceBranch === expected.sourceBranch
          && current.targetBranch === expected.targetBranch
          && current.artifactUrl === expected.artifactUrl
          && current.artifactId === expected.artifactId;
      });
      if (!matches) return false;
      storedMergeSet = {
        ...storedMergeSet,
        repos: storedMergeSet.repos.map((entry) => {
          const planned = patches.find(({ repoKey }) => repoKey === entry.repoKey);
          return planned ? { ...entry, ...planned.patch } : entry;
        }),
      };
      return true;
    });
  });

  it('self-heals an unrecorded review artifact', async () => {
    const stranded = { ...repo('api', 'gitlab'), mergeStatus: 'pending' };
    discoverArtifactMock.mockResolvedValue({
      forge: 'gitlab',
      created: false,
      url: 'https://gitlab.com/org/api/-/merge_requests/56',
      id: '56',
    });
    execMock.mockImplementation(async (command) => repoGitResult(command, '2\n'));

    const result = await reconcileStrandedRepos(seedMergeSet([stranded]) as any);

    expect(result.blockers).toEqual([]);
    expect(result.mergeSet.repos[0]).toEqual(expect.objectContaining({
      artifactUrl: 'https://gitlab.com/org/api/-/merge_requests/56',
      artifactId: '56',
    }));
    expect(patchMergeSetReposMock).toHaveBeenCalledTimes(1);
    expect(upsertMergeSetMock).not.toHaveBeenCalled();
  });

  it('marks a stranded change-free repo as skipped', async () => {
    const stranded = { ...repo('api', 'gitlab'), mergeStatus: 'pending' };
    execMock.mockImplementation(async (command) => (
      command.includes('rev-list --count') ? gitResult('0\n') : gitResult()
    ));

    const result = await reconcileStrandedRepos(seedMergeSet([stranded]) as any);

    expect(result.blockers).toEqual([]);
    expect(result.mergeSet.repos[0]).toEqual(expect.objectContaining({ mergeStatus: 'skipped' }));
    expect(patchMergeSetReposMock).toHaveBeenCalledTimes(1);
    expect(upsertMergeSetMock).not.toHaveBeenCalled();
  });

  it('returns a repo-naming blocker for commits without an artifact', async () => {
    const stranded = { ...repo('api', 'gitlab'), mergeStatus: 'pending' };
    execMock.mockImplementation(async (command) => repoGitResult(command, '2\n'));

    const result = await reconcileStrandedRepos(seedMergeSet([stranded]) as any);

    expect(result.blockers).toEqual([
      expect.objectContaining({
        repoKey: 'api',
        state: 'unmerged',
        reason: expect.stringContaining('api has 2 commits'),
      }),
    ]);
    expect(upsertMergeSetMock).not.toHaveBeenCalled();
  });

  it.each(['pending', 'failed', 'merging'] as const)(
    'marks an artifact-backed %s repo as merged when the forge proves it landed',
    async (mergeStatus) => {
      const stranded = {
        ...repo('api', 'gitlab'),
        artifactUrl: 'https://gitlab.com/org/api/-/merge_requests/56',
        mergeStatus,
      };
      execMock.mockImplementation(async (command) => repoGitResult(command, '2\n'));
      findMergedArtifactMock.mockResolvedValue({
        forge: 'gitlab',
        created: false,
        url: 'https://gitlab.com/org/api/-/merge_requests/56',
        id: '56',
      });

      const result = await reconcileStrandedRepos(seedMergeSet([stranded]) as any);

      expect(result.blockers).toEqual([]);
      expect(result.mergeSet.repos[0]).toEqual(expect.objectContaining({
        artifactId: '56',
        artifactUrl: 'https://gitlab.com/org/api/-/merge_requests/56',
        mergeStatus: 'merged',
      }));
      expect(patchMergeSetReposMock).toHaveBeenCalledTimes(1);
      expect(upsertMergeSetMock).not.toHaveBeenCalled();
    },
  );

  it('leaves an artifact-backed repo unchanged when the forge has no merged evidence', async () => {
    const stranded = {
      ...repo('api', 'gitlab'),
      artifactUrl: 'https://gitlab.com/org/api/-/merge_requests/56',
      mergeStatus: 'failed',
    };
    execMock.mockImplementation(async (command) => repoGitResult(command, '2\n'));

    const result = await reconcileStrandedRepos(seedMergeSet([stranded]) as any);

    expect(result.blockers).toEqual([]);
    expect(result.mergeSet.repos[0]).toEqual(stranded);
    expect(upsertMergeSetMock).not.toHaveBeenCalled();
  });

  it('preserves an observer update while reconciliation advances a sibling repo', async () => {
    const repoA = {
      ...repo('fe', 'gitlab'),
      artifactUrl: 'https://gitlab.com/org/fe/-/merge_requests/55',
      artifactId: '55',
      mergeStatus: 'pending',
    };
    const repoB = {
      ...repo('api', 'gitlab'),
      artifactUrl: 'https://gitlab.com/org/api/-/merge_requests/56',
      artifactId: '56',
      mergeStatus: 'pending',
    };
    const initial = seedMergeSet([repoA, repoB]);
    execMock.mockImplementation(async (command) => repoGitResult(command, '2\n'));
    findMergedArtifactMock.mockImplementation(async ({ cwd }) => {
      if (cwd.endsWith('/fe')) {
        storedMergeSet = {
          ...storedMergeSet,
          repos: storedMergeSet.repos.map((entry) => (
            entry.repoKey === 'fe' ? { ...entry, mergeStatus: 'merged' } : entry
          )),
        };
        return null;
      }
      return {
        forge: 'gitlab', created: false, url: repoB.artifactUrl, id: repoB.artifactId,
      };
    });

    const result = await reconcileStrandedRepos(initial as any);

    expect(result.blockers).toEqual([]);
    expect(result.mergeSet.repos).toEqual([
      expect.objectContaining({ repoKey: 'fe', mergeStatus: 'merged' }),
      expect.objectContaining({ repoKey: 'api', mergeStatus: 'merged' }),
    ]);
    expect(patchMergeSetReposMock).toHaveBeenCalledTimes(1);
    expect(patchMergeSetReposMock).toHaveBeenCalledWith('MIN-857', [{
      repoKey: 'api',
      expected: repoB,
      patch: {
        artifactId: '56',
        artifactUrl: repoB.artifactUrl,
        mergeStatus: 'merged',
      },
    }]);
    expect(upsertMergeSetMock).not.toHaveBeenCalled();
  });

  it('writes nothing when one repo succeeds and a sibling is unverifiable', async () => {
    const repoA = { ...repo('fe', 'gitlab'), mergeStatus: 'pending' };
    const repoB = { ...repo('api', 'gitlab'), mergeStatus: 'pending' };
    const initial = seedMergeSet([repoA, repoB]);
    execMock.mockImplementation(async (command) => repoGitResult(command, '2\n'));
    discoverArtifactMock.mockImplementation(async ({ cwd }) => {
      if (cwd.endsWith('/api')) throw new Error('forge unavailable');
      return {
        forge: 'gitlab',
        created: false,
        url: 'https://gitlab.com/org/fe/-/merge_requests/55',
        id: '55',
      };
    });
    findMergedArtifactMock.mockResolvedValue({
      forge: 'gitlab',
      created: false,
      url: 'https://gitlab.com/org/fe/-/merge_requests/55',
      id: '55',
    });

    const result = await reconcileStrandedRepos(initial as any);

    expect(result.blockers).toEqual([
      expect.objectContaining({ repoKey: 'api', state: 'unverifiable' }),
    ]);
    expect(patchMergeSetReposMock).not.toHaveBeenCalled();
    expect(storedMergeSet).toEqual(initial);
    expect(upsertMergeSetMock).not.toHaveBeenCalled();
  });

  it('fails closed when artifact discovery cannot be verified', async () => {
    const stranded = { ...repo('api', 'gitlab'), mergeStatus: 'pending' };
    discoverArtifactMock.mockRejectedValue(new Error('forge unavailable'));

    const result = await reconcileStrandedRepos(seedMergeSet([stranded]) as any);

    expect(result.blockers).toEqual([
      expect.objectContaining({
        repoKey: 'api',
        state: 'unverifiable',
        reason: expect.stringContaining('forge unavailable'),
      }),
    ]);
    expect(execMock).not.toHaveBeenCalled();
    expect(upsertMergeSetMock).not.toHaveBeenCalled();
  });
});
