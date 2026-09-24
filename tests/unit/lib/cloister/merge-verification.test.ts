import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  assessMergeCompletenessMock,
  execMock,
  getMergeSetMock,
  isGitHubAppConfiguredMock,
  listPullRequestsForHeadMock,
  resolveGitHubIssueMock,
  resolveProjectMock,
} = vi.hoisted(() => ({
  assessMergeCompletenessMock: vi.fn(),
  execMock: vi.fn<[string, any?], Promise<{ stdout: string; stderr: string }>>(),
  getMergeSetMock: vi.fn(),
  isGitHubAppConfiguredMock: vi.fn(),
  listPullRequestsForHeadMock: vi.fn(),
  resolveGitHubIssueMock: vi.fn(),
  resolveProjectMock: vi.fn(),
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

vi.mock('../../../../src/lib/github-app.js', () => ({
  isGitHubAppConfigured: isGitHubAppConfiguredMock,
  listPullRequestsForHead: listPullRequestsForHeadMock,
}));

vi.mock('../../../../src/lib/merge-set.js', () => ({
  getMergeSet: getMergeSetMock,
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: resolveProjectMock,
}));

vi.mock('../../../../src/lib/tracker-utils.js', () => ({
  resolveGitHubIssue: resolveGitHubIssueMock,
}));

vi.mock('../../../../src/lib/cloister/merge-completeness.js', () => ({
  assessMergeCompleteness: assessMergeCompletenessMock,
  hasPositiveMergedEvidence: (repos: Array<{ state: string }>) => repos.some((repo) => repo.state === 'merged'),
}));

import {
  shouldSkipDispatchAsMerged,
  verifyMergedBeforeLifecycle,
} from '../../../../src/lib/cloister/merge-verification.js';

function mergeSet(repoCount: number) {
  return {
    repos: Array.from({ length: repoCount }, (_, index) => ({ repoKey: `repo-${index}` })),
  };
}

describe('verifyMergedBeforeLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isGitHubAppConfiguredMock.mockReturnValue(true);
    resolveGitHubIssueMock.mockReturnValue({ isGitHub: true, owner: 'eltmon', repo: 'overdeck' });
    listPullRequestsForHeadMock.mockResolvedValue([
      {
        number: 2467,
        merged: true,
        mergedAt: '2026-07-25T12:00:00Z',
        mergeCommit: 'abc123',
      },
    ]);
    getMergeSetMock.mockReturnValue(mergeSet(1));
    assessMergeCompletenessMock.mockResolvedValue({
      complete: true,
      repos: [],
      summary: 'Merge complete across 2 repositories',
    });
    execMock.mockResolvedValue({ stdout: '[]', stderr: '' });
  });

  it('accepts a complete non-GitHub merge with positive per-repo evidence', async () => {
    resolveGitHubIssueMock.mockReturnValue({ isGitHub: false });
    assessMergeCompletenessMock.mockResolvedValue({
      complete: true,
      repos: [
        { repoKey: 'fe', state: 'merged', aheadCount: 1 },
        { repoKey: 'api', state: 'no-changes', aheadCount: 0 },
      ],
      summary: 'Merge complete across 2 repositories',
    });

    const result = await verifyMergedBeforeLifecycle('MIN-898', '/projects/myn');

    expect(result).toEqual({
      merged: true,
      reason: 'Forge confirms merge complete for fe',
    });
    expect(assessMergeCompletenessMock).toHaveBeenCalledWith('MIN-898');
    expect(listPullRequestsForHeadMock).not.toHaveBeenCalled();
  });

  it('rejects a partially merged non-GitHub issue with the sibling reason', async () => {
    resolveGitHubIssueMock.mockReturnValue({ isGitHub: false });
    assessMergeCompletenessMock.mockResolvedValue({
      complete: false,
      repos: [
        { repoKey: 'fe', state: 'merged', aheadCount: 1 },
        { repoKey: 'api', state: 'unmerged', aheadCount: 2 },
      ],
      summary: 'api has 2 commits with no merged review artifact',
    });

    const result = await verifyMergedBeforeLifecycle('MIN-898', '/projects/myn');

    expect(result).toEqual({
      merged: false,
      reason: 'api has 2 commits with no merged review artifact',
    });
  });

  it('fails open for an unverifiable non-GitHub forge verdict', async () => {
    resolveGitHubIssueMock.mockReturnValue({ isGitHub: false });
    resolveProjectMock.mockReturnValue({ projectPath: '/projects/myn' });
    assessMergeCompletenessMock.mockResolvedValue({
      complete: false,
      repos: [{
        repoKey: 'api',
        state: 'unverifiable',
        aheadCount: 0,
        reason: 'glab authentication failed',
      }],
      summary: 'api merge state is unverifiable: glab authentication failed',
    });

    const verified = await verifyMergedBeforeLifecycle('MIN-898', '/projects/myn');
    const dispatch = await shouldSkipDispatchAsMerged('MIN-898');

    expect(verified).toEqual({
      merged: false,
      reason: 'api merge state is unverifiable: glab authentication failed',
    });
    expect(dispatch).toEqual({
      skip: false,
      reason: 'api merge state is unverifiable: glab authentication failed',
    });
  });

  it('does not infer a non-GitHub merge from all-no-changes evidence', async () => {
    resolveGitHubIssueMock.mockReturnValue({ isGitHub: false });
    assessMergeCompletenessMock.mockResolvedValue({
      complete: true,
      repos: [{ repoKey: 'api', state: 'no-changes', aheadCount: 0 }],
      summary: 'Merge complete across 1 repository',
    });

    const result = await verifyMergedBeforeLifecycle('MIN-898', '/projects/myn');

    expect(result).toEqual({
      merged: false,
      reason: 'Merge complete across 1 repository',
    });
  });

  it('blocks a merged tracker PR when a sibling repo is unmerged', async () => {
    getMergeSetMock.mockReturnValue(mergeSet(2));
    assessMergeCompletenessMock.mockResolvedValue({
      complete: false,
      repos: [{ repoKey: 'api', state: 'unmerged', aheadCount: 2 }],
      summary: 'api has 2 commits on feature/min-857 ahead of main with no merged review artifact',
    });

    const result = await verifyMergedBeforeLifecycle('MIN-857', '/projects/myn');

    expect(result).toEqual({
      merged: false,
      reason: expect.stringContaining('sibling repo(s) unmerged: api has 2 commits'),
    });
    expect(assessMergeCompletenessMock).toHaveBeenCalledWith('MIN-857');
  });

  it('preserves the merged result when every sibling is complete through the CLI path', async () => {
    isGitHubAppConfiguredMock.mockReturnValue(false);
    getMergeSetMock.mockReturnValue(mergeSet(2));
    execMock.mockResolvedValue({
      stdout: '[{"number":2467,"state":"MERGED","mergedAt":"2026-07-25T12:00:00Z"}]',
      stderr: '',
    });

    const result = await verifyMergedBeforeLifecycle('PAN-2467', '/projects/overdeck');

    expect(result).toEqual({ merged: true, reason: 'GitHub PR #2467 is merged' });
    expect(assessMergeCompletenessMock).toHaveBeenCalledWith('PAN-2467');
  });

  it('does not invoke the completeness assessor for a monorepo', async () => {
    getMergeSetMock.mockReturnValue(mergeSet(1));

    const result = await verifyMergedBeforeLifecycle('PAN-2467', '/projects/overdeck');

    expect(result).toEqual({ merged: true, reason: 'GitHub PR #2467 is merged' });
    expect(assessMergeCompletenessMock).not.toHaveBeenCalled();
  });

  it('fails closed when sibling merge state cannot be read', async () => {
    getMergeSetMock.mockImplementation(() => { throw new Error('database unavailable'); });

    const result = await verifyMergedBeforeLifecycle('PAN-2467', '/projects/overdeck');

    expect(result).toEqual({
      merged: false,
      reason: 'sibling repo merge state is unverifiable: database unavailable',
    });
  });
});

describe('shouldSkipDispatchAsMerged', () => {
  it('returns skip:true with the merge reason when the PR is merged', async () => {
    const result = await shouldSkipDispatchAsMerged('PAN-2420', {
      resolveProject: () => ({ projectPath: '/tmp/project' }),
      verifyMerged: async () => ({ merged: true, reason: 'GitHub PR #2420 is merged' }),
    });

    expect(result.skip).toBe(true);
    expect(result.reason).toContain('GitHub PR #2420 is merged');
  });

  it('returns skip:false when the PR is open', async () => {
    const result = await shouldSkipDispatchAsMerged('PAN-2420', {
      resolveProject: () => ({ projectPath: '/tmp/project' }),
      verifyMerged: async () => ({ merged: false, reason: 'GitHub PR for feature/pan-2420 is open and not merged' }),
    });

    expect(result.skip).toBe(false);
    expect(result.reason).toContain('open and not merged');
  });

  it('returns skip:false when the project is unresolved', async () => {
    const result = await shouldSkipDispatchAsMerged('PAN-2420', {
      resolveProject: () => null,
    });

    expect(result.skip).toBe(false);
    expect(result.reason).toContain('Project unresolved');
  });

  it('fails open when the GitHub read throws', async () => {
    const result = await shouldSkipDispatchAsMerged('PAN-2420', {
      resolveProject: () => ({ projectPath: '/tmp/project' }),
      verifyMerged: async () => { throw new Error('GitHub API rate limited'); },
    });

    expect(result.skip).toBe(false);
    expect(result.reason).toContain('rate limited');
  });

  it('uses the default branch naming convention', async () => {
    let capturedBranch: string | undefined;
    await shouldSkipDispatchAsMerged('MIN-123', {
      resolveProject: () => ({ projectPath: '/tmp/project' }),
      verifyMerged: async (_issueId, _projectPath, branch) => {
        capturedBranch = branch;
        return { merged: false, reason: 'open' };
      },
    });

    expect(capturedBranch).toBe('feature/min-123');
  });
});
