import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileMock, isGitHubAppConfiguredMock, listPullRequestsForHeadMock } = vi.hoisted(() => ({
  execFileMock: vi.fn<[string, string[], any?], Promise<{ stdout: string; stderr: string }>>(),
  isGitHubAppConfiguredMock: vi.fn(),
  listPullRequestsForHeadMock: vi.fn(),
}));

vi.mock('node:child_process', () => {
  const kCustom = Symbol.for('nodejs.util.promisify.custom');
  const execFile = vi.fn();
  (execFile as any)[kCustom] = execFileMock;
  return { execFile };
});

vi.mock('../../../src/lib/github-app.js', () => ({
  isGitHubAppConfigured: isGitHubAppConfiguredMock,
  listPullRequestsForHead: listPullRequestsForHeadMock,
}));

import { lookupPullRequestForBranch } from '../../../src/lib/github-pr-lookup.js';

const closed3670 = {
  number: 3670,
  state: 'closed' as const,
  merged: false,
  mergedAt: null,
  mergeCommit: null,
  updatedAt: '2026-09-26T00:00:00Z',
};
const open4251 = {
  number: 4251,
  state: 'open' as const,
  merged: false,
  mergedAt: null,
  mergeCommit: null,
  updatedAt: '2026-09-20T00:00:00Z',
};

describe('lookupPullRequestForBranch (PAN-4263)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the open PR on the App path when a newer closed PR is listed first', async () => {
    isGitHubAppConfiguredMock.mockReturnValue(true);
    listPullRequestsForHeadMock.mockResolvedValue([closed3670, open4251]);

    await expect(lookupPullRequestForBranch('eltmon', 'overdeck', 'feature/pan-3668'))
      .resolves.toEqual({ number: 4251, state: 'OPEN', mergedAt: null });
  });

  it('returns the open PR on the gh path when a newer closed PR is listed first', async () => {
    isGitHubAppConfiguredMock.mockReturnValue(false);
    execFileMock.mockResolvedValue({
      stdout: JSON.stringify([
        { number: 3670, state: 'CLOSED', mergedAt: null, updatedAt: '2026-09-26T00:00:00Z' },
        { number: 4251, state: 'OPEN', mergedAt: null, updatedAt: '2026-09-20T00:00:00Z' },
      ]),
      stderr: '',
    });

    await expect(lookupPullRequestForBranch('eltmon', 'overdeck', 'feature/pan-3668'))
      .resolves.toEqual({ number: 4251, state: 'OPEN', mergedAt: null });
    expect(execFileMock).toHaveBeenCalledWith(
      'gh',
      expect.arrayContaining(['--json', 'number,state,mergedAt,updatedAt', '--limit', '20']),
      expect.anything(),
    );
  });

  it('reports MERGED for a merged-only branch', async () => {
    isGitHubAppConfiguredMock.mockReturnValue(false);
    execFileMock.mockResolvedValue({
      stdout: JSON.stringify([
        { number: 3670, state: 'CLOSED', mergedAt: null, updatedAt: '2026-09-26T00:00:00Z' },
        { number: 3900, state: 'MERGED', mergedAt: '2026-09-25T00:00:00Z', updatedAt: '2026-09-25T00:00:00Z' },
      ]),
      stderr: '',
    });

    await expect(lookupPullRequestForBranch('eltmon', 'overdeck', 'feature/pan-3668'))
      .resolves.toEqual({ number: 3900, state: 'MERGED', mergedAt: '2026-09-25T00:00:00Z' });
  });

  it('returns null when gh lists no PRs', async () => {
    isGitHubAppConfiguredMock.mockReturnValue(false);
    execFileMock.mockResolvedValue({ stdout: '[]', stderr: '' });

    await expect(lookupPullRequestForBranch('eltmon', 'overdeck', 'feature/none')).resolves.toBeNull();
  });
});
