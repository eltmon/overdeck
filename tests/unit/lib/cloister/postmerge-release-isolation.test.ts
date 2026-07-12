import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSetReviewStatusSync = vi.hoisted(() => vi.fn());
const mockGetReviewStatusSync = vi.hoisted(() => vi.fn(() => null));
const mockRunRelease = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  spawn: vi.fn(() => ({ unref: vi.fn(), once: vi.fn() })),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
  };
});

vi.mock('../../../../src/lib/merge-set.js', () => ({
  getMergeSetSync: vi.fn(() => ({
    issueId: 'PAN-399',
    projectKey: 'overdeck',
    projectPath: '/repo/overdeck',
    workspaceType: 'polyrepo',
    status: 'merged',
    createdAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-05T00:00:00.000Z',
    repos: [],
  })),
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: mockGetReviewStatusSync,
  setReviewStatusSync: mockSetReviewStatusSync,
  setReviewStatus: vi.fn(),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: vi.fn(() => ({ projectKey: 'overdeck' })),
  getProjectSync: vi.fn(() => ({
    name: 'Overdeck',
    path: '/repo/overdeck',
    release: {
      components: {
        api: { trigger: 'auto', smoke_test: 'npm run smoke:api' },
      },
    },
  })),
  findProjectByPathSync: vi.fn(() => null),
}));

vi.mock('../../../../src/lib/release/release-engine.js', () => ({
  runRelease: mockRunRelease,
}));

import { triggerPostMergeReleaseIfConfigured } from '../../../../src/lib/cloister/merge-agent.js';

describe('triggerPostMergeReleaseIfConfigured', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetReviewStatusSync.mockReturnValue(null);
  });

  it('persists releaseStatus failed and does not corrupt mergeStatus when runRelease throws', async () => {
    mockRunRelease.mockRejectedValue(new Error('release engine blew up'));

    await triggerPostMergeReleaseIfConfigured('PAN-399', '/repo/overdeck');

    expect(mockRunRelease).toHaveBeenCalledWith('PAN-399', '/repo/overdeck');
    expect(mockSetReviewStatusSync).toHaveBeenCalledTimes(1);
    expect(mockSetReviewStatusSync).toHaveBeenCalledWith('PAN-399', {
      releaseStatus: 'failed',
      releaseNotes: 'Post-merge release trigger failed: release engine blew up',
    });

    const mergeStatusCalls = mockSetReviewStatusSync.mock.calls.filter(
      ([, update]: [string, any]) => update.mergeStatus !== undefined,
    );
    expect(mergeStatusCalls).toHaveLength(0);
  });

  it('skips when release status is already non-pending', async () => {
    mockGetReviewStatusSync.mockReturnValue({ releaseStatus: 'passed' });

    await triggerPostMergeReleaseIfConfigured('PAN-399', '/repo/overdeck');

    expect(mockRunRelease).not.toHaveBeenCalled();
    expect(mockSetReviewStatusSync).not.toHaveBeenCalled();
  });
});
