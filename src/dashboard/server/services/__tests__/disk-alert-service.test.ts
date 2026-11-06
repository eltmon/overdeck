import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiskAlertHolders } from '@overdeck/contracts';
import {
  getDiskAlertSnapshot,
  startDiskAlertService,
  stopDiskAlertService,
  type DiskAlertServiceDeps,
} from '../disk-alert-service.js';
import { DISK_ALERT_POLL_MS, type DiskAlertThresholds } from '../../../../lib/disk-alert.js';

const GIB = 1024 ** 3;
const THRESHOLDS: DiskAlertThresholds = { warningBytes: 5 * GIB, criticalBytes: 2 * GIB };
const PATH = '/home/op/.overdeck';

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

const EMPTY_HOLDERS: DiskAlertHolders = { measuredAt: new Date(0).toISOString(), incomplete: false, holders: [] };

/** Flush the pending microtask chain (readThresholds/readSpace/scan .then() hops) without advancing time. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe('disk alert service (PAN-5093)', () => {
  let push: ReturnType<typeof vi.fn>;
  let emit: ReturnType<typeof vi.fn>;
  let availableBytes: number;
  let readSpace: ReturnType<typeof vi.fn>;
  let readThresholds: ReturnType<typeof vi.fn>;
  let collectHolders: ReturnType<typeof vi.fn>;

  function makeDeps(overrides: Partial<DiskAlertServiceDeps> = {}): Partial<DiskAlertServiceDeps> {
    return {
      path: PATH,
      readSpace: readSpace as unknown as DiskAlertServiceDeps['readSpace'],
      readThresholds: readThresholds as unknown as DiskAlertServiceDeps['readThresholds'],
      collectHolders: collectHolders as unknown as DiskAlertServiceDeps['collectHolders'],
      push: push as unknown as DiskAlertServiceDeps['push'],
      emit: emit as unknown as DiskAlertServiceDeps['emit'],
      now: () => Date.now(),
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 10, 6, 17, 0, 0));
    push = vi.fn();
    emit = vi.fn();
    availableBytes = 10 * GIB;
    readSpace = vi.fn(async () => ({ availableBytes, totalBytes: 100 * GIB }));
    readThresholds = vi.fn(async () => THRESHOLDS);
    collectHolders = vi.fn(async () => EMPTY_HOLDERS);
  });

  afterEach(() => {
    stopDiskAlertService();
    vi.useRealTimers();
  });

  it('pushes exactly one warning notification on the first crossing, then nothing while it stays there', async () => {
    availableBytes = 4 * GIB;
    startDiskAlertService(makeDeps());
    await flush();
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0].tag).toMatch(/^disk:warning:/);

    push.mockClear();
    await vi.advanceTimersByTimeAsync(DISK_ALERT_POLL_MS);
    expect(push).not.toHaveBeenCalled();
    expect(getDiskAlertSnapshot().level).toBe('warning');
  });

  it('crosses warning -> critical -> warning -> ok with the right pushes and activity entries', async () => {
    availableBytes = 4 * GIB;
    startDiskAlertService(makeDeps());
    await flush();
    expect(push).toHaveBeenCalledTimes(1);

    push.mockClear();
    emit.mockClear();
    availableBytes = 1.5 * GIB;
    await vi.advanceTimersByTimeAsync(DISK_ALERT_POLL_MS);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0].tag).toMatch(/^disk:critical:/);

    push.mockClear();
    emit.mockClear();
    availableBytes = 3 * GIB;
    await vi.advanceTimersByTimeAsync(DISK_ALERT_POLL_MS);
    expect(push).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(getDiskAlertSnapshot().level).toBe('warning');

    push.mockClear();
    emit.mockClear();
    availableBytes = 5.6 * GIB;
    await vi.advanceTimersByTimeAsync(DISK_ALERT_POLL_MS);
    expect(push).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0].level).toBe('info');
    expect(getDiskAlertSnapshot().level).toBe('ok');
  });

  it('pushes again with a different tag after a recovery and a new crossing', async () => {
    availableBytes = 4 * GIB;
    startDiskAlertService(makeDeps());
    await flush();
    expect(push).toHaveBeenCalledTimes(1);
    const firstTag = push.mock.calls[0][0].tag as string;

    availableBytes = 6 * GIB;
    await vi.advanceTimersByTimeAsync(DISK_ALERT_POLL_MS);
    expect(getDiskAlertSnapshot().level).toBe('ok');

    push.mockClear();
    availableBytes = 4 * GIB;
    await vi.advanceTimersByTimeAsync(DISK_ALERT_POLL_MS);
    expect(push).toHaveBeenCalledTimes(1);
    const secondTag = push.mock.calls[0][0].tag as string;
    expect(secondTag).not.toBe(firstTag);
  });

  it('keeps the level unchanged and pushes nothing when readSpace rejects', async () => {
    availableBytes = 4 * GIB;
    startDiskAlertService(makeDeps());
    await flush();
    expect(push).toHaveBeenCalledTimes(1);
    expect(getDiskAlertSnapshot().level).toBe('warning');

    push.mockClear();
    readSpace.mockRejectedValueOnce(new Error('statfs failed'));
    await vi.advanceTimersByTimeAsync(DISK_ALERT_POLL_MS);
    expect(push).not.toHaveBeenCalled();
    expect(getDiskAlertSnapshot().level).toBe('warning');
  });

  it('applies the previous thresholds when readThresholds rejects', async () => {
    availableBytes = 4 * GIB;
    startDiskAlertService(makeDeps());
    await flush();
    expect(push).toHaveBeenCalledTimes(1);
    expect(getDiskAlertSnapshot().warningBytes).toBe(THRESHOLDS.warningBytes);

    readThresholds.mockRejectedValueOnce(new Error('config read failed'));
    availableBytes = 3 * GIB;
    await vi.advanceTimersByTimeAsync(DISK_ALERT_POLL_MS);
    expect(getDiskAlertSnapshot().warningBytes).toBe(THRESHOLDS.warningBytes);
  });

  it('runs one holder scan across an overlapping warning -> critical crossing', async () => {
    const holderDeferred = deferred<DiskAlertHolders>();
    collectHolders.mockReturnValue(holderDeferred.promise);

    availableBytes = 4 * GIB;
    startDiskAlertService(makeDeps());
    await flush();
    expect(push).toHaveBeenCalledTimes(1);
    expect(getDiskAlertSnapshot().measuring).toBe(true);

    availableBytes = 1.5 * GIB;
    await vi.advanceTimersByTimeAsync(DISK_ALERT_POLL_MS);
    expect(collectHolders).toHaveBeenCalledTimes(1);

    const resolved: DiskAlertHolders = { measuredAt: new Date().toISOString(), incomplete: false, holders: [] };
    holderDeferred.resolve(resolved);
    await flush();
    expect(getDiskAlertSnapshot().measuring).toBe(false);
    expect(getDiskAlertSnapshot().holders).toEqual(resolved);
    expect(getDiskAlertSnapshot().level).toBe('critical');
  });

  it('discards a stale scan after a recovery and starts a fresh one on re-crossing', async () => {
    const firstScan = deferred<DiskAlertHolders>();
    collectHolders.mockReturnValueOnce(firstScan.promise);

    availableBytes = 4 * GIB;
    startDiskAlertService(makeDeps());
    await flush();
    expect(push).toHaveBeenCalledTimes(1);

    // Recover to ok while the first scan is still in flight.
    availableBytes = 6 * GIB;
    await vi.advanceTimersByTimeAsync(DISK_ALERT_POLL_MS);
    expect(getDiskAlertSnapshot().level).toBe('ok');
    expect(getDiskAlertSnapshot().holders).toBeNull();

    // A new crossing happens before the stale scan settles: the scan is still
    // "in flight" from the service's point of view, so no second call yet.
    const secondScan = deferred<DiskAlertHolders>();
    collectHolders.mockReturnValueOnce(secondScan.promise);
    availableBytes = 4 * GIB;
    await vi.advanceTimersByTimeAsync(DISK_ALERT_POLL_MS);
    expect(collectHolders).toHaveBeenCalledTimes(1);

    // The stale scan now resolves; its result must be discarded, and because
    // the level is no longer ok, a fresh scan starts.
    firstScan.resolve({ measuredAt: new Date().toISOString(), incomplete: false, holders: [] });
    await flush();
    expect(collectHolders).toHaveBeenCalledTimes(2);
    expect(getDiskAlertSnapshot().holders).toBeNull();

    const secondResult: DiskAlertHolders = { measuredAt: new Date().toISOString(), incomplete: false, holders: [] };
    secondScan.resolve(secondResult);
    await flush();
    expect(getDiskAlertSnapshot().holders).toEqual(secondResult);
  });

  it('stops polling after stopDiskAlertService', async () => {
    availableBytes = 4 * GIB;
    startDiskAlertService(makeDeps());
    await flush();
    expect(readSpace).toHaveBeenCalledTimes(1);

    stopDiskAlertService();
    readSpace.mockClear();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(readSpace).not.toHaveBeenCalled();
  });

  it('is a no-op before start and reports level ok with checkedAt null', () => {
    const snapshot = getDiskAlertSnapshot();
    expect(snapshot.level).toBe('ok');
    expect(snapshot.checkedAt).toBeNull();
  });
});
