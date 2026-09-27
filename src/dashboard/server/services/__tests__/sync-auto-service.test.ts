import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AUTO_SYNC_BOOT_DELAY_MS,
  evaluateSyncStatus,
  getSyncStatus,
  runSyncNow,
  startSyncAutoService,
  stopSyncAutoService,
  type SyncInputStatusRead,
  type SyncRunResult,
} from '../sync-auto-service.js';

function neededStatus(key: string): SyncInputStatusRead {
  return {
    needed: true,
    reason: 'inputs changed or no manifest',
    attemptKey: key,
    summary: '1 skill changed',
    changedKeys: ['sync-sources/skills/foo/SKILL.md'],
  };
}

const notNeeded: SyncInputStatusRead = {
  needed: false,
  reason: 'inputs unchanged',
  attemptKey: 'K',
  summary: '',
  changedKeys: [],
};

let status: SyncInputStatusRead;
let enabled: boolean;
let runPanSync: ReturnType<typeof vi.fn<(args: string[]) => Promise<SyncRunResult>>>;

function start(autoRun = true): void {
  startSyncAutoService({
    autoRun,
    deps: {
      readStatus: async () => status,
      runPanSync,
      autoSyncEnabled: () => enabled,
    },
  });
}

describe('sync auto service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    status = neededStatus('K');
    enabled = true;
    runPanSync = vi.fn(async () => ({ ok: true, output: 'synced' }));
  });

  afterEach(() => {
    stopSyncAutoService();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reports not evaluated yet before the first evaluation', () => {
    expect(getSyncStatus()).toMatchObject({ needed: false, reason: 'not evaluated yet', banner: false });
  });

  it('waits out the boot delay, then runs the light sync exactly once', async () => {
    start();
    await vi.advanceTimersByTimeAsync(0);

    expect(getSyncStatus()).toMatchObject({ needed: true, banner: false, autoSync: { state: 'pending' } });
    expect(runPanSync).not.toHaveBeenCalled();

    runPanSync.mockImplementation(async () => {
      status = notNeeded;
      return { ok: true, output: 'synced' };
    });
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_BOOT_DELAY_MS);

    expect(runPanSync).toHaveBeenCalledTimes(1);
    expect(runPanSync).toHaveBeenCalledWith(['sync', '--if-changed']);
    expect(getSyncStatus()).toMatchObject({ needed: false, banner: false, autoSync: { state: 'idle' } });
  });

  it('shows the banner after a failure and retries only for a new attempt key', async () => {
    runPanSync.mockImplementation(async () => ({ ok: false, error: 'pan sync failed: boom' }));
    start();
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_BOOT_DELAY_MS);

    expect(runPanSync).toHaveBeenCalledTimes(1);
    expect(getSyncStatus()).toMatchObject({
      banner: true,
      autoSync: { state: 'failed', lastError: 'pan sync failed: boom' },
    });

    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(runPanSync).toHaveBeenCalledTimes(1);

    status = neededStatus('K2');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runPanSync).toHaveBeenCalledTimes(2);
  });

  it('marks a successful sync that leaves inputs changed as unresolved', async () => {
    start();
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_BOOT_DELAY_MS);

    expect(runPanSync).toHaveBeenCalledTimes(1);
    expect(getSyncStatus()).toMatchObject({ banner: true, autoSync: { state: 'unresolved', lastError: null } });

    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(runPanSync).toHaveBeenCalledTimes(1);
  });

  it('runs again on the next tick when inputs moved during the run', async () => {
    runPanSync.mockImplementation(async () => {
      status = neededStatus('K2');
      return { ok: true, output: 'synced' };
    });
    start();
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_BOOT_DELAY_MS);

    expect(runPanSync).toHaveBeenCalledTimes(1);
    expect(getSyncStatus().autoSync.state).toBe('pending');

    await vi.advanceTimersByTimeAsync(60_000);
    expect(runPanSync).toHaveBeenCalledTimes(2);
  });

  it('shows the banner without running when auto-sync is turned off', async () => {
    enabled = false;
    start();
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_BOOT_DELAY_MS * 3);

    expect(runPanSync).not.toHaveBeenCalled();
    expect(getSyncStatus()).toMatchObject({ banner: true, autoSync: { enabled: false, state: 'disabled' } });
  });

  it('never auto-runs on a peer dashboard', async () => {
    start(false);
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_BOOT_DELAY_MS * 3);

    expect(runPanSync).not.toHaveBeenCalled();
    expect(getSyncStatus()).toMatchObject({ banner: true, autoSync: { state: 'disabled' } });
  });

  it('shares an in-flight auto run with a manual request', async () => {
    let finish: (result: SyncRunResult) => void = () => {};
    runPanSync.mockImplementation(
      () =>
        new Promise<SyncRunResult>((resolve) => {
          finish = resolve;
        }),
    );
    start();
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_BOOT_DELAY_MS);
    expect(getSyncStatus()).toMatchObject({ banner: false, autoSync: { state: 'running' } });

    const manual = runSyncNow('manual');
    status = notNeeded;
    finish({ ok: true, output: 'synced' });

    await expect(manual).resolves.toEqual({ ok: true, output: 'synced' });
    expect(runPanSync).toHaveBeenCalledTimes(1);
    expect(getSyncStatus().autoSync.state).toBe('idle');
  });

  it('runs a manual sync without --if-changed and records a failure', async () => {
    enabled = false;
    runPanSync.mockImplementation(async () => ({ ok: false, error: 'pan sync failed: nope' }));
    start();
    await evaluateSyncStatus();

    await expect(runSyncNow('manual')).resolves.toEqual({ ok: false, error: 'pan sync failed: nope' });
    expect(runPanSync).toHaveBeenCalledWith(['sync']);
    expect(getSyncStatus()).toMatchObject({ banner: true, autoSync: { state: 'failed', lastError: 'pan sync failed: nope' } });
  });
});
