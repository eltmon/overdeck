import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntervalHistogram } from 'node:perf_hooks';
import type { EmitActivityOptions } from '../../../../lib/activity-logger.js';
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

  it('emits console warning and activity entry when sampled p99 exceeds 100ms', () => {
    const histogram = makeHistogram({ p50Ms: 20, p99Ms: 101, maxMs: 150 });
    const warn = vi.fn();
    const emitted: EmitActivityOptions[] = [];

    sampleEventLoopDelay(histogram, {
      now: () => new Date('2026-07-03T12:00:00.000Z'),
      warn,
      emit: (entry) => emitted.push(entry),
    });

    expect(warn).toHaveBeenCalledWith('[event-loop-monitor] Dashboard event loop p99 delay 101ms exceeded 100ms');
    expect(emitted).toEqual([{
      source: 'dashboard',
      level: 'warn',
      message: 'Dashboard event loop p99 delay 101ms exceeded 100ms',
      details: 'p50=20ms p99=101ms max=150ms over 60000ms',
    }]);
  });

  it('resets the histogram after each completed sample window', () => {
    const histogram = makeHistogram({ p50Ms: 1, p99Ms: 2, maxMs: 3 });

    sampleEventLoopDelay(histogram, {
      warn: vi.fn(),
      emit: vi.fn(),
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
