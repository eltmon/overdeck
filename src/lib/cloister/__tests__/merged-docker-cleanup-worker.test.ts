import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  emitActivityEntrySync: vi.fn(),
  teardownWorkspaceDockerByNamePromise: vi.fn(),
}));

vi.mock('../../activity-logger.js', () => ({
  emitActivityEntrySync: mocks.emitActivityEntrySync,
}));

vi.mock('../../workspace-manager/docker.js', () => ({
  teardownWorkspaceDockerByNamePromise: mocks.teardownWorkspaceDockerByNamePromise,
}));

import {
  enqueueMergedDockerCleanup,
  getMergedDockerCleanupStateForTests,
  resetMergedDockerCleanupWorkerForTests,
  waitForMergedDockerCleanupIdleForTests,
} from '../merged-docker-cleanup-worker.js';

describe('merged Docker cleanup worker', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T12:00:00.000Z'));
    await resetMergedDockerCleanupWorkerForTests();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await resetMergedDockerCleanupWorkerForTests();
    vi.useRealTimers();
  });

  it('deduplicates issues and drains Docker teardown serially', async () => {
    let active = 0;
    let maxActive = 0;
    mocks.teardownWorkspaceDockerByNamePromise.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return { networkRemoved: true, steps: ['Removed network'] };
    });

    expect(enqueueMergedDockerCleanup('PAN-5559')).toBe('Queued merged-issue Docker cleanup for PAN-5559');
    expect(enqueueMergedDockerCleanup('pan-5559')).toBeNull();
    expect(enqueueMergedDockerCleanup('PAN-5560')).toBe('Queued merged-issue Docker cleanup for PAN-5560');
    await waitForMergedDockerCleanupIdleForTests();

    expect(mocks.teardownWorkspaceDockerByNamePromise.mock.calls).toEqual([
      ['pan-5559'],
      ['pan-5560'],
    ]);
    expect(maxActive).toBe(1);
    expect(getMergedDockerCleanupStateForTests('PAN-5559')).toBeNull();
    expect(getMergedDockerCleanupStateForTests('PAN-5560')).toBeNull();
  });

  it('backs off failed cleanup and retries on a later patrol', async () => {
    mocks.teardownWorkspaceDockerByNamePromise
      .mockResolvedValueOnce({ networkRemoved: false, steps: ['Network still present'] })
      .mockResolvedValueOnce({ networkRemoved: true, steps: ['Removed network'] });

    enqueueMergedDockerCleanup('PAN-5559');
    await waitForMergedDockerCleanupIdleForTests();

    expect(getMergedDockerCleanupStateForTests('PAN-5559')).toMatchObject({
      attempts: 1,
      nextAttemptAt: Date.parse('2026-07-26T12:01:00.000Z'),
      running: false,
    });
    expect(enqueueMergedDockerCleanup('PAN-5559')).toBeNull();
    expect(mocks.teardownWorkspaceDockerByNamePromise).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(enqueueMergedDockerCleanup('PAN-5559')).toBeNull();
    await waitForMergedDockerCleanupIdleForTests();

    expect(mocks.teardownWorkspaceDockerByNamePromise).toHaveBeenCalledTimes(2);
    expect(getMergedDockerCleanupStateForTests('PAN-5559')).toBeNull();
  });
});
