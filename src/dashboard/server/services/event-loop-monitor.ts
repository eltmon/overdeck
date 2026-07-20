import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { IntervalHistogram } from 'node:perf_hooks';

export const EVENT_LOOP_MONITOR_WINDOW_MS = 60_000;
export const EVENT_LOOP_P99_WARN_THRESHOLD_MS = 100;

export interface EventLoopDelaySample {
  p50: number;
  p99: number;
  max: number;
  unit: 'ms';
  sampledAt: string | null;
  windowMs: number;
}

export interface EventLoopMonitorDeps {
  createHistogram?: () => IntervalHistogram;
  intervalMs?: number;
  warnThresholdMs?: number;
  now?: () => Date;
  warn?: (message: string) => void;
}

const EMPTY_SAMPLE: EventLoopDelaySample = {
  p50: 0,
  p99: 0,
  max: 0,
  unit: 'ms',
  sampledAt: null,
  windowMs: EVENT_LOOP_MONITOR_WINDOW_MS,
};

let lastSample: EventLoopDelaySample = EMPTY_SAMPLE;
let timer: NodeJS.Timeout | null = null;
let activeHistogram: IntervalHistogram | null = null;

function nsToRoundedMs(ns: number): number {
  if (!Number.isFinite(ns) || ns <= 0) return 0;
  return Math.round((ns / 1_000_000) * 100) / 100;
}

export function sampleEventLoopDelay(
  histogram: Pick<IntervalHistogram, 'percentile' | 'max' | 'reset'>,
  deps: Omit<EventLoopMonitorDeps, 'createHistogram' | 'intervalMs'> = {},
): EventLoopDelaySample {
  const warnThresholdMs = deps.warnThresholdMs ?? EVENT_LOOP_P99_WARN_THRESHOLD_MS;
  const now = deps.now ?? (() => new Date());
  const warn = deps.warn ?? ((message) => console.warn(message));

  const sample: EventLoopDelaySample = {
    p50: nsToRoundedMs(histogram.percentile(50)),
    p99: nsToRoundedMs(histogram.percentile(99)),
    max: nsToRoundedMs(histogram.max),
    unit: 'ms',
    sampledAt: now().toISOString(),
    windowMs: EVENT_LOOP_MONITOR_WINDOW_MS,
  };

  lastSample = sample;

  if (sample.p99 > warnThresholdMs) {
    // PAN-2908 C-FRESH: event-loop diagnostics are a Health concern, not an
    // operator-feed event. No activity entry — the console line and the
    // /api/metrics sample (getEventLoopDelaySample) carry it.
    warn(`[event-loop-monitor] Dashboard event loop p99 delay ${sample.p99}ms exceeded ${warnThresholdMs}ms`);
  }

  histogram.reset();
  return sample;
}

export function getEventLoopDelaySample(): EventLoopDelaySample {
  return lastSample;
}

export function startEventLoopMonitor(deps: EventLoopMonitorDeps = {}): void {
  if (timer) return;

  const intervalMs = deps.intervalMs ?? EVENT_LOOP_MONITOR_WINDOW_MS;
  const createHistogram = deps.createHistogram ?? (() => monitorEventLoopDelay({ resolution: 20 }));
  activeHistogram = createHistogram();
  activeHistogram.enable();

  timer = setInterval(() => {
    if (!activeHistogram) return;
    sampleEventLoopDelay(activeHistogram, deps);
  }, intervalMs);
  timer.unref?.();
}

export function stopEventLoopMonitor(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  activeHistogram?.disable();
  activeHistogram = null;
}

export function resetEventLoopMonitorForTests(): void {
  stopEventLoopMonitor();
  lastSample = EMPTY_SAMPLE;
}
