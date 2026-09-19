/**
 * The post-merge release trigger (re-pointed by PAN-3917).
 *
 * The release verdict was a row field three writers raced on: the trigger stamped
 * `releasing`, the release engine stamped `passed`/`failed`, and the guard
 * against a double release read it back. The guard is the only part that has to
 * survive, and a merge only happens once per process, so a process-local set of
 * issue ids does the whole job. The release engine's own output is the record
 * of what the release did.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveProjectFromIssueSync: vi.fn(),
  getProjectSync: vi.fn(),
  runRelease: vi.fn(),
  emitActivityEntrySync: vi.fn(),
}));

vi.mock('../../projects.js', () => ({
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
  getProjectSync: mocks.getProjectSync,
}));

vi.mock('../../release/release-engine.js', () => ({
  runRelease: mocks.runRelease,
}));

vi.mock('../../activity-logger.js', () => ({
  emitActivityEntrySync: mocks.emitActivityEntrySync,
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
    mocks.resolveProjectFromIssueSync.mockReturnValue({ projectKey: 'overdeck', projectPath: '/repo/overdeck' });
    mocks.getProjectSync.mockReturnValue({
      name: 'Overdeck',
      path: '/repo/overdeck',
      release: { components: { api: { trigger: 'auto' } } },
    });
    mocks.runRelease.mockResolvedValue({ status: 'passed' });
  });

  it('runs release once for a project with release config', async () => {
    await triggerPostMergeReleaseIfConfigured('PAN-3991', '/repo/overdeck');

    expect(mocks.runRelease).toHaveBeenCalledOnce();
    expect(mocks.runRelease).toHaveBeenCalledWith('PAN-3991', '/repo/overdeck');
  });

  it('does not run release for a project without release config', async () => {
    mocks.getProjectSync.mockReturnValue({ name: 'Overdeck', path: '/repo/overdeck' });

    await triggerPostMergeReleaseIfConfigured('PAN-3992', '/repo/overdeck');

    expect(mocks.runRelease).not.toHaveBeenCalled();
  });

  it('does not run release twice for the same issue', async () => {
    await triggerPostMergeReleaseIfConfigured('PAN-3993', '/repo/overdeck');
    await triggerPostMergeReleaseIfConfigured('PAN-3993', '/repo/overdeck');

    expect(mocks.runRelease).toHaveBeenCalledOnce();
  });

  it('a failing release never throws — the merge already landed', async () => {
    mocks.runRelease.mockRejectedValue(new Error('registry unreachable'));

    await expect(triggerPostMergeReleaseIfConfigured('PAN-3994', '/repo/overdeck')).resolves.toBeUndefined();
  });
});
