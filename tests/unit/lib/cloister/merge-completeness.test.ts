import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  discoverArtifactMock,
  ensureMergeSetForIssueMock,
  execMock,
  findMergedArtifactMock,
  getForgeAdapterMock,
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

function mergeSet(repos: ReturnType<typeof repo>[]) {
  return { repos };
}

function gitResult(stdout = '') {
  return { stdout, stderr: '' };
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
    execMock.mockImplementation(async (command) => (
      command.includes('rev-list --count') ? gitResult('2\n') : gitResult()
    ));
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
    execMock.mockImplementation(async (command) => (
      command.includes('rev-list --count') ? gitResult('2\n') : gitResult()
    ));
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

describe('reconcileStrandedRepos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('self-heals an unrecorded review artifact', async () => {
    const stranded = { ...repo('api', 'gitlab'), mergeStatus: 'pending' };
    discoverArtifactMock.mockResolvedValue({
      forge: 'gitlab',
      created: false,
      url: 'https://gitlab.com/org/api/-/merge_requests/56',
      id: '56',
    });

    const result = await reconcileStrandedRepos(mergeSet([stranded]) as any);

    expect(result.blockers).toEqual([]);
    expect(result.mergeSet.repos[0]).toEqual(expect.objectContaining({
      artifactUrl: 'https://gitlab.com/org/api/-/merge_requests/56',
      artifactId: '56',
    }));
    expect(upsertMergeSetMock).toHaveBeenCalledTimes(1);
  });

  it('marks a stranded change-free repo as skipped', async () => {
    const stranded = { ...repo('api', 'gitlab'), mergeStatus: 'pending' };
    execMock.mockImplementation(async (command) => (
      command.includes('rev-list --count') ? gitResult('0\n') : gitResult()
    ));

    const result = await reconcileStrandedRepos(mergeSet([stranded]) as any);

    expect(result.blockers).toEqual([]);
    expect(result.mergeSet.repos[0]).toEqual(expect.objectContaining({ mergeStatus: 'skipped' }));
    expect(upsertMergeSetMock).toHaveBeenCalledTimes(1);
  });

  it('returns a repo-naming blocker for commits without an artifact', async () => {
    const stranded = { ...repo('api', 'gitlab'), mergeStatus: 'pending' };
    execMock.mockImplementation(async (command) => (
      command.includes('rev-list --count') ? gitResult('2\n') : gitResult()
    ));

    const result = await reconcileStrandedRepos(mergeSet([stranded]) as any);

    expect(result.blockers).toEqual([
      expect.objectContaining({
        repoKey: 'api',
        state: 'unmerged',
        reason: expect.stringContaining('api has 2 commits'),
      }),
    ]);
    expect(upsertMergeSetMock).not.toHaveBeenCalled();
  });

  it('fails closed when artifact discovery cannot be verified', async () => {
    const stranded = { ...repo('api', 'gitlab'), mergeStatus: 'pending' };
    discoverArtifactMock.mockRejectedValue(new Error('forge unavailable'));

    const result = await reconcileStrandedRepos(mergeSet([stranded]) as any);

    expect(result.blockers).toEqual([
      expect.objectContaining({
        repoKey: 'api',
        state: 'unverifiable',
        reason: expect.stringContaining('forge unavailable'),
      }),
    ]);
    expect(execMock).not.toHaveBeenCalled();
  });
});
