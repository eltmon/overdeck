import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityEmitOutcome } from '../../../../lib/activity-logger.js';
import type { GateStarvationRecord } from '../../../../lib/cloister/gate-starvation.js';
import { readQualityGateQueue } from '../../../../lib/cloister/quality-gate-admission.js';
import {
  GATE_STARVATION_POLL_MS,
  pollGateStarvationOnceForTests,
  startGateStarvationService,
  stopGateStarvationService,
  type GateStarvationServiceDeps,
} from '../gate-starvation-service.js';

const GiB = 1024 ** 3;

function head(extra: Record<string, unknown> = {}) {
  return {
    workspacePath: '/ws/pan-5489', gateName: 'tsc:tsconfig.json', createdAt: 0,
    ticketId: 't1', footprintKey: 'gate:typecheck:npm run typecheck', memoryBlockedSince: 0, ...extra,
  };
}

/** Flush the pending microtask chain of the just-started poll without advancing time. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe('gate starvation service (PAN-5621)', () => {
  let record: GateStarvationRecord | null = null;
  let readQueue: ReturnType<typeof vi.fn>;
  let readMemory: ReturnType<typeof vi.fn>;
  let readHardReserveBytes: ReturnType<typeof vi.fn>;
  let readEstimate: ReturnType<typeof vi.fn>;
  let readStarvationMs: ReturnType<typeof vi.fn>;
  let collectHolders: ReturnType<typeof vi.fn>;
  let push: ReturnType<typeof vi.fn>;
  let emitOnce: ReturnType<typeof vi.fn>;

  function makeDeps(overrides: Partial<GateStarvationServiceDeps> = {}): Partial<GateStarvationServiceDeps> {
    return {
      readQueue: readQueue as unknown as GateStarvationServiceDeps['readQueue'],
      readMemory: readMemory as unknown as GateStarvationServiceDeps['readMemory'],
      readHardReserveBytes: readHardReserveBytes as unknown as GateStarvationServiceDeps['readHardReserveBytes'],
      readEstimate: readEstimate as unknown as GateStarvationServiceDeps['readEstimate'],
      readStarvationMs: readStarvationMs as unknown as GateStarvationServiceDeps['readStarvationMs'],
      readRecord: async () => record,
      writeRecord: async (r) => { record = r; },
      clearRecord: async () => { record = null; },
      collectHolders: collectHolders as unknown as GateStarvationServiceDeps['collectHolders'],
      push: push as unknown as GateStarvationServiceDeps['push'],
      emitOnce: emitOnce as unknown as GateStarvationServiceDeps['emitOnce'],
      now: () => Date.now(),
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 10, 23, 9, 0, 0));
    record = null;
    readQueue = vi.fn(async () => ({ slots: 1, owners: [], waiters: [] }));
    readMemory = vi.fn(async () => ({ memAvailableBytes: 10.4e9, memTotalBytes: 62 * GiB }));
    readHardReserveBytes = vi.fn(async () => 8 * GiB);
    readEstimate = vi.fn(async () => 2_864_852_992);
    readStarvationMs = vi.fn(async () => 15 * 60_000);
    collectHolders = vi.fn(async () => []);
    push = vi.fn();
    emitOnce = vi.fn(async (): Promise<ActivityEmitOutcome> => 'appended');
  });

  afterEach(() => {
    stopGateStarvationService();
    vi.useRealTimers();
  });

  it('announces exactly once when the head crosses the threshold, and a handover keeps it quiet', async () => {
    const base = Date.now();
    readQueue.mockImplementation(async () => ({ slots: 1, owners: [], waiters: [head({ memoryBlockedSince: base - 14 * 60_000 })] }));
    startGateStarvationService(makeDeps());
    await flush();
    expect(emitOnce).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(emitOnce).toHaveBeenCalledTimes(1);
    expect(emitOnce.mock.calls[0][0].id).toBe(`gate-starvation:${(record as { since: string }).since}:opened`);
    expect(push).toHaveBeenCalledTimes(1);
    expect((record as { announced: boolean }).announced).toBe(true);

    emitOnce.mockClear();
    push.mockClear();
    await vi.advanceTimersByTimeAsync(5 * GATE_STARVATION_POLL_MS);
    expect(emitOnce).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('retries a failed opening emit with the same id until it settles', async () => {
    const base = Date.now();
    readQueue.mockImplementation(async () => ({ slots: 1, owners: [], waiters: [head({ memoryBlockedSince: base - 15 * 60_000 })] }));
    emitOnce.mockResolvedValueOnce('failed').mockResolvedValueOnce('appended');
    startGateStarvationService(makeDeps());
    await flush();
    expect(emitOnce).toHaveBeenCalledTimes(1);
    expect((record as { announced: boolean }).announced).toBe(false);

    await pollGateStarvationOnceForTests();
    expect(emitOnce).toHaveBeenCalledTimes(2);
    expect(emitOnce.mock.calls[0][0].id).toBe(emitOnce.mock.calls[1][0].id);
    expect(push.mock.calls[0][0].tag).toBe(push.mock.calls[1][0].tag);
    expect((record as { announced: boolean }).announced).toBe(true);
  });

  it('retries the opening notice on the first poll after a restart', async () => {
    const base = Date.now();
    record = {
      version: 1, since: new Date(base).toISOString(), openedAtMs: base, announced: false,
      head: head(), memAvailableBytes: 10.4e9, hardReserveBytes: 8 * GiB, footprintBytes: 2_864_852_992, holders: [],
    };
    readQueue.mockImplementation(async () => ({ slots: 1, owners: [], waiters: [head()] }));
    startGateStarvationService(makeDeps());
    await flush();
    expect(emitOnce).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledTimes(1);
    expect((record as { announced: boolean }).announced).toBe(true);
  });

  it('changes nothing on a real unreadable queue', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pan-5621-service-'));
    const brokenRoot = join(root, 'not-a-dir');
    writeFileSync(brokenRoot, 'x');
    try {
      const base = Date.now();
      record = {
        version: 1, since: new Date(base).toISOString(), openedAtMs: base, announced: true,
        head: head(), memAvailableBytes: 10.4e9, hardReserveBytes: 8 * GiB, footprintBytes: 2_864_852_992, holders: [],
      };
      const before = record;
      startGateStarvationService(makeDeps({ readQueue: () => readQualityGateQueue({ rootDir: brokenRoot, slots: 2 }) }));
      await flush();
      await vi.advanceTimersByTimeAsync(2 * GATE_STARVATION_POLL_MS);
      expect(emitOnce).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
      expect(record).toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('closes the episode when a gate is admitted between two polls', async () => {
    const base = Date.now();
    record = {
      version: 1, since: new Date(base).toISOString(), openedAtMs: base, announced: true,
      head: head(), memAvailableBytes: 10.4e9, hardReserveBytes: 8 * GiB, footprintBytes: 2_864_852_992, holders: [],
    };
    readQueue.mockImplementation(async () => ({
      slots: 1, owners: [], waiters: [head({ ticketId: 't2' })], lastAdmittedAt: base + 10_000,
    }));
    startGateStarvationService(makeDeps());
    await flush();
    expect(emitOnce).toHaveBeenCalledTimes(1);
    expect(emitOnce.mock.calls[0][0].message).toContain('a gate was admitted');
    expect(record).toBeNull();
  });

  it('retries a failed recovery emit until it settles, then clears the record', async () => {
    const base = Date.now();
    record = {
      version: 1, since: new Date(base).toISOString(), openedAtMs: base, announced: true,
      head: head(), memAvailableBytes: 10.4e9, hardReserveBytes: 8 * GiB, footprintBytes: 2_864_852_992, holders: [],
    };
    readQueue.mockImplementation(async () => ({ slots: 1, owners: [], waiters: [] }));
    emitOnce.mockResolvedValueOnce('failed').mockResolvedValueOnce('appended');
    startGateStarvationService(makeDeps());
    await flush();
    expect(emitOnce).toHaveBeenCalledTimes(1);
    expect(record).not.toBeNull();
    expect((record as { closing?: unknown }).closing).toBeDefined();

    await pollGateStarvationOnceForTests();
    expect(emitOnce).toHaveBeenCalledTimes(2);
    expect(record).toBeNull();
  });

  it('refreshes the head and footprint on handover, without emitting', async () => {
    const base = Date.now();
    record = {
      version: 1, since: new Date(base).toISOString(), openedAtMs: base, announced: true,
      head: head({ ticketId: 't1', footprintKey: 'gate:a' }),
      memAvailableBytes: 10.4e9, hardReserveBytes: 8 * GiB, footprintBytes: 2_864_852_992, holders: [],
    };
    const newHead = head({ ticketId: 't2', footprintKey: 'gate:b', createdAt: 100 });
    readQueue.mockImplementation(async () => ({ slots: 1, owners: [], waiters: [newHead] }));
    readEstimate.mockImplementation(async (key: string) => (key === 'gate:b' ? 1_073_741_824 : 2_864_852_992));
    startGateStarvationService(makeDeps());
    await flush();
    expect(emitOnce).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect((record as { head: { ticketId: string } }).head.ticketId).toBe('t2');
    expect((record as { footprintBytes: number }).footprintBytes).toBe(1_073_741_824);
  });

  it('stays open through flapping memory with no owner and no newer admission', async () => {
    const base = Date.now();
    record = {
      version: 1, since: new Date(base).toISOString(), openedAtMs: base, announced: true,
      head: head(), memAvailableBytes: 10.4e9, hardReserveBytes: 8 * GiB, footprintBytes: 2_864_852_992, holders: [],
    };
    readQueue.mockImplementation(async () => ({ slots: 1, owners: [], waiters: [head()] }));
    readMemory.mockImplementation(async () => ({ memAvailableBytes: 50e9, memTotalBytes: 62 * GiB }));
    startGateStarvationService(makeDeps());
    await flush();
    await vi.advanceTimersByTimeAsync(3 * GATE_STARVATION_POLL_MS);
    expect(emitOnce).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(record).not.toBeNull();
    expect((record as { closing?: unknown }).closing).toBeUndefined();
  });

  it('closes the episode when the queue is confirmed empty', async () => {
    const base = Date.now();
    record = {
      version: 1, since: new Date(base).toISOString(), openedAtMs: base, announced: true,
      head: head(), memAvailableBytes: 10.4e9, hardReserveBytes: 8 * GiB, footprintBytes: 2_864_852_992, holders: [],
    };
    readQueue.mockImplementation(async () => ({ slots: 1, owners: [], waiters: [] }));
    startGateStarvationService(makeDeps());
    await flush();
    expect(emitOnce).toHaveBeenCalledTimes(1);
    expect(emitOnce.mock.calls[0][0].message).toContain('the queue emptied');
    expect(record).toBeNull();
  });

  it('a rejected readQueue throws nothing and leaves the record untouched', async () => {
    const base = Date.now();
    record = {
      version: 1, since: new Date(base).toISOString(), openedAtMs: base, announced: true,
      head: head(), memAvailableBytes: 10.4e9, hardReserveBytes: 8 * GiB, footprintBytes: 2_864_852_992, holders: [],
    };
    const before = record;
    readQueue.mockImplementation(async () => { throw new Error('boom'); });
    startGateStarvationService(makeDeps());
    await flush();
    expect(emitOnce).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(record).toBe(before);
  });

  it('opens the episode with empty holders when collectHolders rejects', async () => {
    const base = Date.now();
    readQueue.mockImplementation(async () => ({ slots: 1, owners: [], waiters: [head({ memoryBlockedSince: base - 15 * 60_000 })] }));
    collectHolders.mockImplementation(async () => { throw new Error('census failed'); });
    startGateStarvationService(makeDeps());
    await flush();
    expect(record).not.toBeNull();
    expect((record as { holders: unknown[] }).holders).toEqual([]);
  });
});
