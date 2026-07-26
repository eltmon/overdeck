import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  execMock,
  isGitHubAppConfiguredMock,
  listPullRequestsForHeadMock,
} = vi.hoisted(() => ({
  execMock: vi.fn<[string, any?], Promise<{ stdout: string; stderr: string }>>(),
  isGitHubAppConfiguredMock: vi.fn(),
  listPullRequestsForHeadMock: vi.fn(),
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
  getPullRequestState: vi.fn(),
  isGitHubAppConfigured: isGitHubAppConfiguredMock,
  listPullRequestsForHead: listPullRequestsForHeadMock,
  mergePullRequestWithApp: vi.fn(),
  parsePullRequestRef: vi.fn(),
}));

import { getForgeAdapter } from '../../../src/lib/forge.js';

describe('findMergedArtifact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isGitHubAppConfiguredMock.mockReturnValue(false);
    listPullRequestsForHeadMock.mockReturnValue(Effect.succeed([]));
  });

  it('returns a merged GitHub artifact through the GitHub App', async () => {
    isGitHubAppConfiguredMock.mockReturnValue(true);
    listPullRequestsForHeadMock.mockReturnValue(Effect.succeed([
      {
        number: 42,
        state: 'closed',
        merged: true,
        mergedAt: '2026-07-25T12:00:00Z',
        mergeCommit: 'abc123',
        url: 'https://github.com/org/repo/pull/42',
      },
    ]));

    const result = await getForgeAdapter('github').findMergedArtifact({
      sourceBranch: 'feature/pan-2467',
      repository: 'org/repo',
      cwd: '/tmp/repo',
    });

    expect(listPullRequestsForHeadMock).toHaveBeenCalledWith('org', 'repo', 'feature/pan-2467', 'all');
    expect(result).toEqual({
      forge: 'github',
      created: false,
      url: 'https://github.com/org/repo/pull/42',
      id: '42',
    });
  });

  it('returns null for an open GitHub artifact through the GitHub App', async () => {
    isGitHubAppConfiguredMock.mockReturnValue(true);
    listPullRequestsForHeadMock.mockReturnValue(Effect.succeed([
      {
        number: 42,
        state: 'open',
        merged: false,
        mergedAt: null,
        mergeCommit: 'temporary-test-merge-sha',
        url: 'https://github.com/org/repo/pull/42',
      },
    ]));

    await expect(getForgeAdapter('github').findMergedArtifact({
      sourceBranch: 'feature/pan-2467',
      repository: 'org/repo',
      cwd: '/tmp/repo',
    })).resolves.toBeNull();
  });

  it('returns a merged GitHub artifact through the gh fallback', async () => {
    execMock.mockResolvedValueOnce({
      stdout: '[{"url":"https://github.com/org/repo/pull/42","number":42,"mergedAt":"2026-07-25T12:00:00Z"}]',
      stderr: '',
    });

    const result = await getForgeAdapter('github').findMergedArtifact({
      sourceBranch: 'feature/pan-2467',
      repository: 'org/repo',
      cwd: '/tmp/repo',
    });

    expect(execMock).toHaveBeenCalledWith(
      'gh pr list --state merged --head feature/pan-2467 --repo org/repo --json url,number,mergedAt',
      expect.objectContaining({ cwd: '/tmp/repo' }),
    );
    expect(result).toEqual({
      forge: 'github',
      created: false,
      url: 'https://github.com/org/repo/pull/42',
      id: '42',
    });
  });

  it('returns the merged GitLab artifact and ignores open artifacts', async () => {
    execMock.mockResolvedValueOnce({
      stdout: JSON.stringify([
        { iid: 71, web_url: 'https://gitlab.com/org/repo/-/merge_requests/71', state: 'opened' },
        { iid: 70, web_url: 'https://gitlab.com/org/repo/-/merge_requests/70', state: 'merged' },
      ]),
      stderr: '',
    });

    const result = await getForgeAdapter('gitlab').findMergedArtifact({
      sourceBranch: 'feature/min-857',
      repository: 'org/repo',
      cwd: '/tmp/repo',
    });

    expect(execMock).toHaveBeenCalledWith(
      'glab mr list --source-branch feature/min-857 --repo org/repo --all --output json',
      expect.objectContaining({ cwd: '/tmp/repo' }),
    );
    expect(result).toEqual({
      forge: 'gitlab',
      created: false,
      url: 'https://gitlab.com/org/repo/-/merge_requests/70',
      id: '70',
    });
  });

  it.each(['opened', 'closed'])('returns null for a GitLab artifact with state %s', async (state) => {
    execMock.mockResolvedValueOnce({
      stdout: JSON.stringify([
        { iid: 71, web_url: 'https://gitlab.com/org/repo/-/merge_requests/71', state },
      ]),
      stderr: '',
    });

    await expect(getForgeAdapter('gitlab').findMergedArtifact({
      sourceBranch: 'feature/min-857',
      repository: 'org/repo',
      cwd: '/tmp/repo',
    })).resolves.toBeNull();
  });

  it('propagates GitHub CLI failures', async () => {
    execMock.mockRejectedValueOnce(new Error('gh authentication failed'));

    await expect(getForgeAdapter('github').findMergedArtifact({
      sourceBranch: 'feature/pan-2467',
      repository: 'org/repo',
      cwd: '/tmp/repo',
    })).rejects.toThrow('gh authentication failed');
  });

  it('propagates GitLab CLI failures', async () => {
    execMock.mockRejectedValueOnce(new Error('glab network unavailable'));

    await expect(getForgeAdapter('gitlab').findMergedArtifact({
      sourceBranch: 'feature/min-857',
      repository: 'org/repo',
      cwd: '/tmp/repo',
    })).rejects.toThrow('glab network unavailable');
  });

  it('returns null when no merged artifact exists', async () => {
    execMock.mockResolvedValueOnce({ stdout: '[]', stderr: '' });

    await expect(getForgeAdapter('github').findMergedArtifact({
      sourceBranch: 'feature/pan-2467',
      repository: 'org/repo',
      cwd: '/tmp/repo',
    })).resolves.toBeNull();
  });
});
