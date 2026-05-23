import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  execMock,
  getPullRequestStateMock,
  isGitHubAppConfiguredMock,
  mergePullRequestWithAppMock,
  parsePullRequestRefMock,
} = vi.hoisted(() => ({
  execMock: vi.fn<[string, any?], Promise<{ stdout: string; stderr: string }>>(),
  getPullRequestStateMock: vi.fn(),
  isGitHubAppConfiguredMock: vi.fn(),
  mergePullRequestWithAppMock: vi.fn(),
  parsePullRequestRefMock: vi.fn(),
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

vi.mock('../../../src/lib/github-app.js', () => ({
  getPullRequestState: getPullRequestStateMock,
  isGitHubAppConfigured: isGitHubAppConfiguredMock,
  mergePullRequestWithApp: mergePullRequestWithAppMock,
  parsePullRequestRef: parsePullRequestRefMock,
}));

import { getForgeAdapter, GITHUB_MERGE_TIMEOUT_MS } from '../../../src/lib/forge.js';

describe('forge adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    isGitHubAppConfiguredMock.mockReturnValue(false);
    parsePullRequestRefMock.mockReturnValue({ owner: 'org', repo: 'repo', number: 42 });
  });

  it('creates GitHub review artifacts using the configured target branch', async () => {
    execMock
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'https://github.com/org/repo/pull/42\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '{"url":"https://github.com/org/repo/pull/42","number":42}', stderr: '' });

    const result = await getForgeAdapter('github').createReviewArtifact({
      title: 'PAN-632',
      body: 'Body',
      sourceBranch: 'feature/pan-632',
      targetBranch: 'release',
      cwd: '/tmp/repo',
    });

    expect(execMock).toHaveBeenCalledWith(
      expect.stringContaining('gh pr create --head feature/pan-632 --base release'),
      expect.objectContaining({ cwd: '/tmp/repo' })
    );
    expect(result).toMatchObject({
      forge: 'github',
      created: true,
      url: 'https://github.com/org/repo/pull/42',
      id: '42',
    });
  });

  it('creates GitLab review artifacts using merge requests', async () => {
    execMock
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'https://gitlab.example.com/group/repo/-/merge_requests/7\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '[{"iid":7,"web_url":"https://gitlab.example.com/group/repo/-/merge_requests/7"}]', stderr: '' });

    const result = await getForgeAdapter('gitlab').createReviewArtifact({
      title: 'MIN-632',
      body: 'Body',
      sourceBranch: 'feature/min-632',
      targetBranch: 'qa',
      cwd: '/tmp/repo',
    });

    expect(execMock).toHaveBeenCalledWith(
      expect.stringContaining('glab mr create --source-branch feature/min-632 --target-branch qa'),
      expect.objectContaining({ cwd: '/tmp/repo' })
    );
    expect(result).toMatchObject({
      forge: 'gitlab',
      created: true,
      url: 'https://gitlab.example.com/group/repo/-/merge_requests/7',
      id: '7',
    });
  });

  it('falls back to gh for GitHub merges when the app is not configured', async () => {
    execMock.mockResolvedValueOnce({ stdout: '', stderr: '' });

    await getForgeAdapter('github').mergeReviewArtifact({
      forge: 'github',
      url: 'https://github.com/org/repo/pull/42',
      cwd: '/tmp/repo',
      method: 'squash',
    });

    expect(execMock).toHaveBeenCalledWith(
      'gh pr merge https://github.com/org/repo/pull/42 --squash',
      expect.objectContaining({ cwd: '/tmp/repo' }),
    );
    expect(mergePullRequestWithAppMock).not.toHaveBeenCalled();
  });

  it('merges GitHub PRs through the GitHub App once checks settle', async () => {
    vi.useFakeTimers();
    isGitHubAppConfiguredMock.mockReturnValue(true);
    getPullRequestStateMock
      .mockReturnValueOnce(Effect.succeed({
        owner: 'org',
        repo: 'repo',
        number: 42,
        state: 'OPEN',
        merged: false,
        mergeable: null,
        mergeableState: 'unknown',
        draft: false,
        headSha: 'abc123',
        baseBranch: 'main',
        checksPending: true,
        checksFailed: false,
      }))
      .mockReturnValueOnce(Effect.succeed({
        owner: 'org',
        repo: 'repo',
        number: 42,
        state: 'OPEN',
        merged: false,
        mergeable: true,
        mergeableState: 'clean',
        draft: false,
        headSha: 'abc123',
        baseBranch: 'main',
        checksPending: false,
        checksFailed: false,
      }));
    mergePullRequestWithAppMock.mockReturnValue(Effect.succeed({ merged: true }));

    const mergePromise = getForgeAdapter('github').mergeReviewArtifact({
      forge: 'github',
      url: 'https://github.com/org/repo/pull/42',
      cwd: '/tmp/repo',
      method: 'squash',
    });
    await vi.runAllTimersAsync();
    await mergePromise;

    expect(getPullRequestStateMock).toHaveBeenCalledTimes(2);
    expect(mergePullRequestWithAppMock).toHaveBeenCalledWith('org', 'repo', 42, 'squash', 'abc123');
    expect(execMock).not.toHaveBeenCalled();
  });

  it('treats already merged GitHub PRs as success', async () => {
    isGitHubAppConfiguredMock.mockReturnValue(true);
    getPullRequestStateMock.mockReturnValue(Effect.succeed({
      owner: 'org',
      repo: 'repo',
      number: 42,
      state: 'CLOSED',
      merged: true,
      mergeable: false,
      mergeableState: 'clean',
      draft: false,
      headSha: 'abc123',
      baseBranch: 'main',
      checksPending: false,
      checksFailed: false,
    }));

    await expect(
      getForgeAdapter('github').mergeReviewArtifact({
        forge: 'github',
        url: 'https://github.com/org/repo/pull/42',
        cwd: '/tmp/repo',
        method: 'squash',
      })
    ).resolves.toBeUndefined();

    expect(mergePullRequestWithAppMock).not.toHaveBeenCalled();
  });

  it('has a GitHub merge timeout of at least 15 minutes', () => {
    expect(GITHUB_MERGE_TIMEOUT_MS).toBe(15 * 60 * 1000);
  });
});
