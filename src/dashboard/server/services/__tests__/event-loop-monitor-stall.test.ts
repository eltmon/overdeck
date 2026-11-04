/**
 * PAN-4645 WI-17: the event-loop stall record with an injected clock and timer.
 */
import type { IntervalHistogram } from 'node:perf_hooks';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EVENT_LOOP_STALL_PROBE_MS,
  getLastEventLoopStall,
  observeProbeGap,
  onEventLoopStall,
  resetEventLoopMonitorForTests,
  startEventLoopMonitor,
  stopEventLoopMonitor,
} from '../event-loop-monitor.js';

function fakeHistogram(): IntervalHistogram {
  return { enable: vi.fn(), disable: vi.fn(), percentile: () => 0, max: 0, reset: vi.fn() } as unknown as IntervalHistogram;
}

describe('event-loop stall record (PAN-4645 WI-17)', () => {
  let now = 1_000_000;
  let tick: (() => void) | null = null;
  const cleared: unknown[] = [];

  beforeEach(() => {
    resetEventLoopMonitorForTests();
    now = 1_000_000;
    tick = null;
    cleared.length = 0;
    startEventLoopMonitor({
      createHistogram: fakeHistogram,
      nowMs: () => now,
      setInterval: (callback) => { tick = callback; return { unref: vi.fn() }; },
      clearInterval: (handle) => { cleared.push(handle); },
    });
  });

  afterEach(() => {
    resetEventLoopMonitorForTests();
  });

  it('ac1: a 5000 ms gap records durationMs 4750 and fires the listener once', () => {
    const listener = vi.fn();
    onEventLoopStall(listener);
    expect(getLastEventLoopStall()).toBeNull();

    now += EVENT_LOOP_STALL_PROBE_MS;
    tick!();
    expect(getLastEventLoopStall()).toBeNull();

    now += 5000;
    tick!();
    expect(getLastEventLoopStall()).toEqual({ durationMs: 4750, endedAgoMs: 0 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ durationMs: 4750, endedAt: now });

    now += EVENT_LOOP_STALL_PROBE_MS;
    tick!();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ac2: a 600 ms gap records nothing', () => {
    const listener = vi.fn();
    onEventLoopStall(listener);
    now += 600;
    tick!();
    expect(getLastEventLoopStall()).toBeNull();
    expect(listener).not.toHaveBeenCalled();
  });

  it('ac3: endedAgoMs grows with the clock', () => {
    now += 5000;
    tick!();
    expect(getLastEventLoopStall()?.endedAgoMs).toBe(0);
    now += 3000;
    expect(getLastEventLoopStall()).toEqual({ durationMs: 4750, endedAgoMs: 3000 });
  });

  it('a stall between 1000 and 2000 ms is recorded but not announced; unsubscribe stops notifications', () => {
    const listener = vi.fn();
    const off = onEventLoopStall(listener);
    expect(observeProbeGap(1500 + EVENT_LOOP_STALL_PROBE_MS, now)).toEqual({ durationMs: 1500, endedAt: now });
    expect(listener).not.toHaveBeenCalled();
    off();
    expect(observeProbeGap(9000, now)).toEqual({ durationMs: 8750, endedAt: now });
    expect(listener).not.toHaveBeenCalled();
    expect(getLastEventLoopStall()?.durationMs).toBe(8750);
  });

  it('stopping the monitor clears the probe interval', () => {
    stopEventLoopMonitor();
    expect(cleared).toHaveLength(1);
    stopEventLoopMonitor();
    expect(cleared).toHaveLength(1);
  });
});
