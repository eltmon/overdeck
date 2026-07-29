import { describe, expect, it, vi } from 'vitest';

import { getDeployBlockReason } from '../../../../src/lib/deploy/deploy-window.js';

function clearDependencies() {
  return {
    isMergeAgentRunning: vi.fn(async () => false),
    pendingPostMergeExists: vi.fn(async () => false),
    readRestartLockHolder: vi.fn(async () => null),
    readDevSupervisorMarker: vi.fn(() => null),
  };
}

describe('getDeployBlockReason', () => {
  it('blocks while a merge specialist session is active', async () => {
    const deps = clearDependencies();
    deps.isMergeAgentRunning.mockResolvedValue(true);

    await expect(getDeployBlockReason(deps)).resolves.toBe(
      'Deployment deferred because a merge specialist session is active.',
    );
  });

  it('blocks while the post-merge lifecycle is pending', async () => {
    const deps = clearDependencies();
    deps.pendingPostMergeExists.mockResolvedValue(true);

    await expect(getDeployBlockReason(deps)).resolves.toBe(
      'Deployment deferred because the post-merge lifecycle is pending.',
    );
  });

  it('identifies the process holding the restart lock', async () => {
    const deps = clearDependencies();
    deps.readRestartLockHolder.mockResolvedValue({
      pid: 1234,
      caller: 'pan reload',
      acquiredAt: '2026-07-15T12:00:00.000Z',
    });

    await expect(getDeployBlockReason(deps)).resolves.toBe(
      'Deployment deferred because a restart is already in progress (pid 1234, pan reload).',
    );
  });

  it('blocks while pan dev owns the dashboard', async () => {
    const deps = clearDependencies();
    deps.readDevSupervisorMarker.mockReturnValue({
      pid: 5678,
      dashboardPort: 5173,
      apiPort: 3011,
      startedAt: '2026-07-15T12:00:00.000Z',
    });

    await expect(getDeployBlockReason(deps)).resolves.toBe(
      'Deployment deferred because a pan dev session owns the dashboard.',
    );
  });

  it('returns null when the full deploy window is clear', async () => {
    await expect(getDeployBlockReason(clearDependencies())).resolves.toBeNull();
  });
});
