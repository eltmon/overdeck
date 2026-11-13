import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExplorerWatchEvent } from '@overdeck/contracts';
import { coalesceEvents, createWatchBatcher, type RawWatchEvent } from '../watch-batch.js';

let flushes: Array<{ at: number; events: ExplorerWatchEvent[] }>;
let start: number;

function batcher() {
  return createWatchBatcher({ flush: (events) => flushes.push({ at: Date.now() - start, events }) });
}

const update = (path: string): RawWatchEvent => ({ type: 'update', path });

beforeEach(() => {
  vi.useFakeTimers();
  // A realistic clock: watchBatchFlushDelayMs treats lastFlushAt = 0 as "never flushed".
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  start = Date.now();
  flushes = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createWatchBatcher', () => {
  it('flushes the first push after 75 ms', async () => {
    const b = batcher();
    b.push([update('a')]);
    await vi.advanceTimersByTimeAsync(74);
    expect(flushes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(flushes).toEqual([{ at: 75, events: [{ kind: 'update', path: 'a' }] }]);
  });

  it('flushes every 100 ms under continuous pushes', async () => {
    const b = batcher();
    for (let t = 0; t < 1000; t += 10) {
      b.push([update(`f${t}`)]);
      await vi.advanceTimersByTimeAsync(10);
    }
    await vi.advanceTimersByTimeAsync(200);
    const times = flushes.map((f) => f.at);
    expect(times[0]).toBe(75);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBe(100);
    expect(flushes.flatMap((f) => f.events)).toHaveLength(100);
  });

  it('never moves an armed timer', async () => {
    const b = batcher();
    b.push([update('a')]);
    await vi.advanceTimersByTimeAsync(50);
    b.push([update('b')]);
    await vi.advanceTimersByTimeAsync(25);
    expect(flushes).toEqual([
      {
        at: 75,
        events: [
          { kind: 'update', path: 'a' },
          { kind: 'update', path: 'b' },
        ],
      },
    ]);
  });

  it('drops create then delete of one path within a window', async () => {
    const b = batcher();
    b.push([{ type: 'create', path: 'x' }, { type: 'delete', path: 'x' }, update('y')]);
    await vi.advanceTimersByTimeAsync(75);
    expect(flushes[0]?.events).toEqual([{ kind: 'update', path: 'y' }]);
  });

  it('keeps delete then create, delete first', async () => {
    const b = batcher();
    b.push([{ type: 'delete', path: 'x' }, { type: 'create', path: 'x' }]);
    await vi.advanceTimersByTimeAsync(75);
    expect(flushes[0]?.events).toEqual([
      { kind: 'delete', path: 'x' },
      { kind: 'create', path: 'x' },
    ]);
  });

  it('flushes a single overflow past 5000 buffered events', async () => {
    const b = batcher();
    b.push(Array.from({ length: 5001 }, (_, i) => update(`f${i}`)));
    b.push([update('late')]);
    await vi.advanceTimersByTimeAsync(75);
    expect(flushes).toEqual([{ at: 75, events: [{ kind: 'overflow', path: '' }] }]);
    b.push([update('next')]);
    await vi.advanceTimersByTimeAsync(100);
    expect(flushes[1]?.events).toEqual([{ kind: 'update', path: 'next' }]);
  });

  it('never flushes after dispose', async () => {
    const b = batcher();
    b.push([update('a')]);
    await vi.advanceTimersByTimeAsync(50);
    b.dispose();
    b.push([update('b')]);
    await vi.advanceTimersByTimeAsync(500);
    expect(flushes).toHaveLength(0);
  });
});

describe('coalesceEvents', () => {
  it('lets a later update supersede delete then create', () => {
    expect(
      coalesceEvents([
        { type: 'delete', path: 'x' },
        { type: 'create', path: 'x' },
        { type: 'update', path: 'x' },
      ]),
    ).toEqual([{ type: 'update', path: 'x' }]);
  });
});
