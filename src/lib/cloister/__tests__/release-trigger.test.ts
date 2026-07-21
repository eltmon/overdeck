import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getReviewStatusSync: vi.fn(),
  setReviewStatusSync: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
  getProjectSync: vi.fn(),
  runRelease: vi.fn(),
}));

vi.mock('../../review-status.js', () => ({
  getReviewStatusSync: mocks.getReviewStatusSync,
  setReviewStatusSync: mocks.setReviewStatusSync,
  markWorkspaceStuck: vi.fn(),
}));

vi.mock('../../projects.js', () => ({
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
  getProjectSync: mocks.getProjectSync,
}));

vi.mock('../../release/release-engine.js', () => ({
  runRelease: mocks.runRelease,
}));

vi.mock('../../activity-logger.js', () => ({
  emitActivityEntrySync: vi.fn(),
  emitActivityTtsSync: vi.fn(),
  emitDashboardLifecycleSync: vi.fn(),
}));

vi.mock('../../tmux.js', () => ({
  capturePane: vi.fn(),
  killSession: vi.fn(),
  listSessionNames: vi.fn(),
  sendKeys: vi.fn(),
  sessionExists: vi.fn(),
}));

import { triggerPostMergeReleaseIfConfigured } from '../merge-agent.js';

describe('post-merge release trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getReviewStatusSync.mockReturnValue({ releaseStatus: undefined });
    mocks.resolveProjectFromIssueSync.mockReturnValue({ projectKey: 'overdeck', projectPath: '/repo/overdeck' });
    mocks.getProjectSync.mockReturnValue({
      name: 'Overdeck',
      path: '/repo/overdeck',
      release: { components: { api: { trigger: 'auto' } } },
    });
    mocks.runRelease.mockResolvedValue({ status: 'passed' });
  });

  it('runs release once for a project with release config', async () => {
    await triggerPostMergeReleaseIfConfigured('PAN-399', '/repo/overdeck');

    expect(mocks.runRelease).toHaveBeenCalledOnce();
    expect(mocks.runRelease).toHaveBeenCalledWith('PAN-399', '/repo/overdeck');
    expect(mocks.setReviewStatusSync).not.toHaveBeenCalledWith('PAN-399', expect.objectContaining({ releaseStatus: 'skipped' }));
  });

  it('marks release skipped when no release config exists', async () => {
    mocks.getProjectSync.mockReturnValue({ name: 'Overdeck', path: '/repo/overdeck' });

    await triggerPostMergeReleaseIfConfigured('PAN-399', '/repo/overdeck');

    expect(mocks.runRelease).not.toHaveBeenCalled();
    expect(mocks.setReviewStatusSync).toHaveBeenCalledWith('PAN-399', {
      releaseStatus: 'skipped',
      releaseNotes: 'No release config found for project.',
    });
  });

  it('does not run release again for an already released issue', async () => {
    mocks.getReviewStatusSync.mockReturnValue({ releaseStatus: 'passed' });

    await triggerPostMergeReleaseIfConfigured('PAN-399', '/repo/overdeck');

    expect(mocks.runRelease).not.toHaveBeenCalled();
    expect(mocks.setReviewStatusSync).not.toHaveBeenCalled();
  });

  it('does not run release again while a release is already in progress', async () => {
    mocks.getReviewStatusSync.mockReturnValue({ releaseStatus: 'releasing' });

    await triggerPostMergeReleaseIfConfigured('PAN-399', '/repo/overdeck');

    expect(mocks.runRelease).not.toHaveBeenCalled();
    expect(mocks.setReviewStatusSync).not.toHaveBeenCalled();
  });
});
