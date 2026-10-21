/**
 * PAN-4578 W10 — the dashboard's operator memory sync timer. Fake timers drive
 * the boot delay and the interval; the sync itself is injected, so nothing
 * touches git, the network or ~/.overdeck.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OperatorMemorySyncOutcome } from '../../../../lib/memory/facts/operator-sync.js';
import {
  OPERATOR_MEMORY_SYNC_BOOT_DELAY_MS,
  OPERATOR_MEMORY_SYNC_INTERVAL_MS,
  runOperatorMemorySyncTick,
  startOperatorMemorySyncService,
  stopOperatorMemorySyncService,
} from '../operator-memory-sync-service.js';

const SYNCED: OperatorMemorySyncOutcome = {
  status: 'synced',
  dir: '/op/memory',
  committed: false,
  pulled: [],
  pushed: false,
  conflicts: [],
  heldBack: [],
};

describe('operator memory sync service (PAN-4578)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    stopOperatorMemorySyncService();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('runs once at 60 s, again 15 min later, and never before 60 s', async () => {
    const sync = vi.fn(async () => SYNCED);
    startOperatorMemorySyncService({ deps: { isSynced: () => true, sync } });

    await vi.advanceTimersByTimeAsync(OPERATOR_MEMORY_SYNC_BOOT_DELAY_MS - 1);
    expect(sync).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(sync).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(OPERATOR_MEMORY_SYNC_INTERVAL_MS);
    expect(sync).toHaveBeenCalledTimes(2);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not run when the store is not synced', async () => {
    const sync = vi.fn(async () => SYNCED);
    startOperatorMemorySyncService({ deps: { isSynced: () => false, sync } });

    await vi.advanceTimersByTimeAsync(OPERATOR_MEMORY_SYNC_BOOT_DELAY_MS + OPERATOR_MEMORY_SYNC_INTERVAL_MS);
    expect(sync).not.toHaveBeenCalled();
    await expect(runOperatorMemorySyncTick()).resolves.toBeNull();
  });

  it('a tick during an in-flight run returns null and does not sync twice', async () => {
    let release: (outcome: OperatorMemorySyncOutcome) => void = () => {};
    const sync = vi.fn(() => new Promise<OperatorMemorySyncOutcome>((resolve) => {
      release = resolve;
    }));
    startOperatorMemorySyncService({ deps: { isSynced: () => true, sync } });

    const first = runOperatorMemorySyncTick();
    await vi.advanceTimersByTimeAsync(0);
    await expect(runOperatorMemorySyncTick()).resolves.toBeNull();
    expect(sync).toHaveBeenCalledTimes(1);

    release(SYNCED);
    await expect(first).resolves.toEqual(SYNCED);
  });

  it('stop clears both timers', async () => {
    const sync = vi.fn(async () => SYNCED);
    startOperatorMemorySyncService({ deps: { isSynced: () => true, sync } });
    expect(vi.getTimerCount()).toBe(2);

    stopOperatorMemorySyncService();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(OPERATOR_MEMORY_SYNC_BOOT_DELAY_MS + OPERATOR_MEMORY_SYNC_INTERVAL_MS);
    expect(sync).not.toHaveBeenCalled();
  });

  it('warns for offline, failed, conflicts and held-back files, and survives a throw', async () => {
    startOperatorMemorySyncService({
      deps: { isSynced: () => true, sync: async () => ({ status: 'offline', dir: '/op', error: 'fetch failed: x', committed: false, heldBack: [] }) },
    });
    await runOperatorMemorySyncTick();
    stopOperatorMemorySyncService();

    startOperatorMemorySyncService({
      deps: {
        isSynced: () => true,
        sync: async () => ({ ...SYNCED, conflicts: ['a-conflict-beta'], heldBack: [{ path: 'gpu.md', reason: 'machine-specific path' }] }),
      },
    });
    await runOperatorMemorySyncTick();
    stopOperatorMemorySyncService();

    startOperatorMemorySyncService({
      deps: {
        isSynced: () => true,
        sync: async () => {
          throw new Error('boom');
        },
      },
    });
    await expect(runOperatorMemorySyncTick()).resolves.toBeNull();

    const warnings = warnSpy.mock.calls.map((call) => String(call[0]));
    expect(warnings).toEqual([
      '[operator-memory-sync] offline: fetch failed: x',
      '[operator-memory-sync] conflict copies written: a-conflict-beta',
      '[operator-memory-sync] held back: gpu.md (machine-specific path)',
      '[operator-memory-sync] error: boom',
    ]);
  });
});
