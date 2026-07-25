import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  ensureMergeSetForIssueMock,
  execMock,
  isGitHubAppConfiguredMock,
} = vi.hoisted(() => ({
  ensureMergeSetForIssueMock: vi.fn(),
  execMock: vi.fn<[string, any?], Promise<{ stdout: string; stderr: string }>>(),
  isGitHubAppConfiguredMock: vi.fn(),
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
  getPullRequestState: vi.fn(),
  isGitHubAppConfigured: isGitHubAppConfiguredMock,
  listPullRequestsForHead: vi.fn(() => Effect.succeed([])),
  mergePullRequestWithApp: vi.fn(),
  parsePullRequestRef: vi.fn(),
}));

vi.mock('../../../../src/lib/merge-set.js', () => ({
  ensureMergeSetForIssueSync: ensureMergeSetForIssueMock,
  upsertMergeSetSync: vi.fn(),
  withRepoArtifactUrlSync: vi.fn(),
  withRepoStateSync: vi.fn(),
}));

vi.mock('../../../../src/lib/project-repos.js', () => ({
  resolveProjectReposForIssueSync: vi.fn().mockReturnValue(null),
}));

import { assessMergeCompleteness } from '../../../../src/lib/cloister/merge-completeness.js';

describe('merge completeness forge error propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isGitHubAppConfiguredMock.mockReturnValue(false);
    ensureMergeSetForIssueMock.mockReturnValue({
      repos: [{
        repoKey: 'api',
        repoPath: '/projects/myn/api',
        forge: 'github',
        sourceBranch: 'feature/min-857',
        targetBranch: 'main',
        required: true,
      }],
    });
    execMock.mockImplementation(async (command) => {
      if (command.includes('git rev-list --count')) return { stdout: '2\n', stderr: '' };
      if (command.includes('gh pr list')) throw new Error('gh authentication failed');
      return { stdout: '', stderr: '' };
    });
  });

  it('classifies a GitHub CLI rejection as unverifiable', async () => {
    const result = await assessMergeCompleteness('MIN-857');

    expect(result.complete).toBe(false);
    expect(result.repos).toEqual([
      expect.objectContaining({
        repoKey: 'api',
        state: 'unverifiable',
        reason: expect.stringContaining('gh authentication failed'),
      }),
    ]);
    expect(execMock).toHaveBeenCalledWith(
      'gh pr list --state merged --head feature/min-857 --json url,number,mergedAt',
      expect.objectContaining({ cwd: '/projects/myn/api' }),
    );
  });
});
