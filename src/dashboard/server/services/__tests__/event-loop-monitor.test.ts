import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntervalHistogram } from 'node:perf_hooks';
import {
  EVENT_LOOP_MONITOR_WINDOW_MS,
  getEventLoopDelaySample,
  resetEventLoopMonitorForTests,
  sampleEventLoopDelay,
  startEventLoopMonitor,
} from '../event-loop-monitor.js';

function makeHistogram(values: { p50Ms: number; p99Ms: number; maxMs: number }) {
  return {
    enable: vi.fn(),
    disable: vi.fn(),
    percentile: vi.fn((percentile: number) => {
      if (percentile === 50) return values.p50Ms * 1_000_000;
      if (percentile === 99) return values.p99Ms * 1_000_000;
      return 0;
    }),
    max: values.maxMs * 1_000_000,
    reset: vi.fn(),
  } as unknown as IntervalHistogram & {
    enable: ReturnType<typeof vi.fn>;
    disable: ReturnType<typeof vi.fn>;
    percentile: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
  };
}

describe('event-loop-monitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetEventLoopMonitorForTests();
  });

  afterEach(() => {
    resetEventLoopMonitorForTests();
    vi.useRealTimers();
  });

  it('samples p50, p99, and max in milliseconds and stores the latest sample', () => {
    const histogram = makeHistogram({ p50Ms: 12.345, p99Ms: 67.891, maxMs: 123.456 });
    const sample = sampleEventLoopDelay(histogram, {
      now: () => new Date('2026-07-03T12:00:00.000Z'),
      warn: vi.fn(),
      emit: vi.fn(),
    });

    expect(sample).toEqual({
      p50: 12.35,
      p99: 67.89,
      max: 123.46,
      unit: 'ms',
      sampledAt: '2026-07-03T12:00:00.000Z',
      windowMs: EVENT_LOOP_MONITOR_WINDOW_MS,
    });
    expect(getEventLoopDelaySample()).toEqual(sample);
  });

  it('warns on console only — p99 diagnostics stay OUT of the operator feed (C-FRESH)', () => {
    const histogram = makeHistogram({ p50Ms: 20, p99Ms: 101, maxMs: 150 });
    const warn = vi.fn();

    sampleEventLoopDelay(histogram, {
      now: () => new Date('2026-07-03T12:00:00.000Z'),
      warn,
    });

    expect(warn).toHaveBeenCalledWith('[event-loop-monitor] Dashboard event loop p99 delay 101ms exceeded 100ms');
    // The sample stays available for the Health metrics endpoint.
    expect(getEventLoopDelaySample().p99).toBe(101);
  });

  it('resets the histogram after each completed sample window', () => {
    const histogram = makeHistogram({ p50Ms: 1, p99Ms: 2, maxMs: 3 });

    sampleEventLoopDelay(histogram, {
      warn: vi.fn(),
    });

    expect(histogram.reset).toHaveBeenCalledTimes(1);
  });

  it('starts a 60s sampler that enables and resets the histogram', async () => {
    const histogram = makeHistogram({ p50Ms: 5, p99Ms: 6, maxMs: 7 });

    startEventLoopMonitor({
      createHistogram: () => histogram,
      now: () => new Date('2026-07-03T12:00:00.000Z'),
      warn: vi.fn(),
      emit: vi.fn(),
    });

    expect(histogram.enable).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(EVENT_LOOP_MONITOR_WINDOW_MS);

    expect(histogram.reset).toHaveBeenCalledTimes(1);
    expect(getEventLoopDelaySample()).toMatchObject({ p50: 5, p99: 6, max: 7 });
  });
});
