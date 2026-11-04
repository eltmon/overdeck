/**
 * Event-loop health for the dashboard: a delay histogram sampled every minute
 * (p50/p99/max for /api/metrics), and since PAN-4645 WI-17 a stall record.
 *
 * Stall probe (D-4645-7, D-4645-8): a 250 ms interval notes how late it ran.
 * A gap at least 1000 ms over the interval is a stall of `gap - 250` ms, kept
 * as the last stall with its end time; stalls of 2000 ms or more also fire
 * `onEventLoopStall` listeners. The link heartbeat sends the last stall as
 * `{ durationMs, endedAgoMs }` so another machine can tell "this dashboard
 * froze" from "the network dropped" without sharing a clock.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { IntervalHistogram } from 'node:perf_hooks';

export const EVENT_LOOP_MONITOR_WINDOW_MS = 60_000;
export const EVENT_LOOP_P99_WARN_THRESHOLD_MS = 100;
/** How often the stall probe runs. */
export const EVENT_LOOP_STALL_PROBE_MS = 250;
/** A probe this late (beyond its interval) records a stall. */
export const EVENT_LOOP_STALL_RECORD_MS = 1_000;
/** A stall this long also fires the listeners. */
export const EVENT_LOOP_STALL_NOTIFY_MS = 2_000;

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
  /** Stall probe clock and timer, injectable for tests. */
  nowMs?: () => number;
  setInterval?: (callback: () => void, ms: number) => IntervalHandle;
  clearInterval?: (handle: IntervalHandle) => void;
  probeIntervalMs?: number;
}

export type IntervalHandle = { unref?: () => unknown } | NodeJS.Timeout;

export interface EventLoopStall {
  /** How long timers did not run, beyond the probe interval. */
  durationMs: number;
  /** Clock reading (`nowMs`) when the stall ended. */
  endedAt: number;
}

export type EventLoopStallListener = (stall: EventLoopStall) => void;

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

let lastStall: EventLoopStall | null = null;
let stallProbe: { handle: IntervalHandle; clear: (handle: IntervalHandle) => void } | null = null;
let stallNow: () => number = () => Date.now();
const stallListeners = new Set<EventLoopStallListener>();

/** Note how late the probe ran; record a stall and notify when it is long enough. Exported for tests. */
export function observeProbeGap(gapMs: number, endedAt: number, probeIntervalMs: number = EVENT_LOOP_STALL_PROBE_MS): EventLoopStall | null {
  const late = gapMs - probeIntervalMs;
  if (late < EVENT_LOOP_STALL_RECORD_MS) return null;
  const stall: EventLoopStall = { durationMs: late, endedAt };
  lastStall = stall;
  if (late >= EVENT_LOOP_STALL_NOTIFY_MS) {
    for (const listener of stallListeners) {
      try {
        listener(stall);
      } catch (error) {
        console.error(`[event-loop-monitor] stall listener failed: ${(error as Error).message}`);
      }
    }
  }
  return stall;
}

/** The last recorded stall, relative to now (D-4645-8), or null when none happened since start. */
export function getLastEventLoopStall(): { durationMs: number; endedAgoMs: number } | null {
  if (!lastStall) return null;
  return { durationMs: lastStall.durationMs, endedAgoMs: Math.max(0, stallNow() - lastStall.endedAt) };
}

/** Be told about stalls of at least 2000 ms. Returns the unsubscribe function. */
export function onEventLoopStall(listener: EventLoopStallListener): () => void {
  stallListeners.add(listener);
  return () => {
    stallListeners.delete(listener);
  };
}

function startStallProbe(deps: EventLoopMonitorDeps): void {
  if (stallProbe) return;
  const probeIntervalMs = deps.probeIntervalMs ?? EVENT_LOOP_STALL_PROBE_MS;
  stallNow = deps.nowMs ?? (() => Date.now());
  const schedule = deps.setInterval ?? ((callback: () => void, ms: number) => setInterval(callback, ms));
  const clear = deps.clearInterval ?? ((handle: IntervalHandle) => clearInterval(handle as NodeJS.Timeout));
  let lastTick = stallNow();
  const handle = schedule(() => {
    const tick = stallNow();
    observeProbeGap(tick - lastTick, tick, probeIntervalMs);
    lastTick = tick;
  }, probeIntervalMs);
  handle.unref?.();
  stallProbe = { handle, clear };
}

function stopStallProbe(): void {
  if (!stallProbe) return;
  stallProbe.clear(stallProbe.handle);
  stallProbe = null;
}

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
  startStallProbe(deps);
}

export function stopEventLoopMonitor(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  activeHistogram?.disable();
  activeHistogram = null;
  stopStallProbe();
}

export function resetEventLoopMonitorForTests(): void {
  stopEventLoopMonitor();
  lastSample = EMPTY_SAMPLE;
  lastStall = null;
  stallListeners.clear();
  stallNow = () => Date.now();
}
