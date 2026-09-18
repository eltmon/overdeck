import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DISK_PRUNE_RETRY_MS,
  DISK_PRUNE_TRIGGER_BYTES,
  patrolDiskPressure,
  resetDiskPressurePatrolForTests,
} from '../../../../src/lib/cloister/disk-pressure-patrol.js';

const GIB = 1024 ** 3;

describe('disk-pressure-patrol', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-09T12:00:00Z'));
    resetDiskPressurePatrolForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('prunes unused BuildKit cache below the safety floor and reports recovered space', async () => {
    const readDiskSpace = vi.fn()
      .mockResolvedValueOnce({ availableBytes: 4 * GIB, totalBytes: 100 * GIB })
      .mockResolvedValueOnce({ availableBytes: 24 * GIB, totalBytes: 100 * GIB });
    const pruneBuildCache = vi.fn().mockResolvedValue('Total reclaimed space: 20GB');
    const emit = vi.fn();

    const actions = await patrolDiskPressure({ readDiskSpace, pruneBuildCache, emit });

    expect(pruneBuildCache).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      level: 'info',
      source: 'cloister',
      link: '/resources',
      message: expect.stringContaining('reclaimed 20.0 GiB'),
    }));
    expect(actions).toEqual([
      'disk-pressure-patrol: pruned BuildKit cache (20.0 GiB reclaimed, 24.0 GiB available)',
    ]);
  });

  it('does nothing while available space is at the safety floor', async () => {
    const pruneBuildCache = vi.fn();

    const actions = await patrolDiskPressure({
      readDiskSpace: async () => ({ availableBytes: DISK_PRUNE_TRIGGER_BYTES, totalBytes: 100 * GIB }),
      pruneBuildCache,
    });

    expect(actions).toEqual([]);
    expect(pruneBuildCache).not.toHaveBeenCalled();
  });

  it('rate-limits failed prune attempts and retries after the cooldown', async () => {
    const pruneBuildCache = vi.fn().mockRejectedValue(new Error('Docker unavailable'));
    const emit = vi.fn();
    const deps = {
      readDiskSpace: async () => ({ availableBytes: 4 * GIB, totalBytes: 100 * GIB }),
      pruneBuildCache,
      emit,
    };

    await patrolDiskPressure(deps);
    await patrolDiskPressure(deps);
    expect(pruneBuildCache).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DISK_PRUNE_RETRY_MS);
    await patrolDiskPressure(deps);
    expect(pruneBuildCache).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('suppresses a concurrent prune while the first one is in flight', async () => {
    let finishPrune: (() => void) | undefined;
    const pruneBuildCache = vi.fn(() => new Promise<string>((resolve) => {
      finishPrune = () => resolve('Total reclaimed space: 20GB');
    }));
    const readDiskSpace = vi.fn()
      .mockResolvedValueOnce({ availableBytes: 4 * GIB, totalBytes: 100 * GIB })
      .mockResolvedValueOnce({ availableBytes: 4 * GIB, totalBytes: 100 * GIB })
      .mockResolvedValueOnce({ availableBytes: 24 * GIB, totalBytes: 100 * GIB });

    const first = patrolDiskPressure({ readDiskSpace, pruneBuildCache, emit: vi.fn() });
    await vi.waitFor(() => expect(pruneBuildCache).toHaveBeenCalledOnce());
    const second = await patrolDiskPressure({ readDiskSpace, pruneBuildCache, emit: vi.fn() });
    expect(second).toEqual([]);

    finishPrune?.();
    await first;
    expect(pruneBuildCache).toHaveBeenCalledOnce();
  });
});
