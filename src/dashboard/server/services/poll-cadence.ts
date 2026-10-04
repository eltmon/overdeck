/**
 * Poll cadence for IssueDataService (PAN-4507).
 *
 * Pure delay math: no I/O, no timers. The service feeds in the current
 * unchanged streak and the rate-limit inputs from CacheService, and arms its
 * timer with the returned delay. The reason names the term that set the delay,
 * for `GET /api/cache-status`.
 */

/** Per-tracker poll intervals (ms). */
export const POLL_INTERVALS = {
  github:  { default: 30_000, min: 15_000, max: 300_000 },
  linear:  { default: 30_000, min: 15_000, max: 300_000 },
  rally:   { default: 120_000, min: 60_000, max: 600_000 },
};

export type PollIntervals = { default: number; min: number; max: number };
export type PollIntervalReason = 'default' | 'unchanged-backoff' | 'rate-limit-backoff' | 'rate-limit-suspended' | 'quota-pause';

/** Longest wait for a rate-limit reset before polling again. */
export const MAX_SUSPENSION_MS = 3_600_000;

/** Unchanged backoff: default doubled once per consecutive unchanged poll, capped at max. */
export function unchangedBackoffMs(intervals: PollIntervals, unchangedStreak: number): number {
  return Math.min(intervals.default * 2 ** Math.max(0, unchangedStreak), intervals.max);
}

/**
 * The longer of the unchanged backoff and the rate-limit backoff wins. A
 * rate-limit suspension then replaces the delay, and a quota pause can only
 * lengthen it. Rate limit wins a tie with the unchanged backoff.
 */
export function computePollDelay(input: {
  intervals: PollIntervals;
  unchangedStreak: number;
  rateBackoffMs: number;
  suspendMs: number;
  quotaPauseMs: number;
}): { delayMs: number; reason: PollIntervalReason } {
  const { intervals, unchangedStreak, rateBackoffMs, suspendMs, quotaPauseMs } = input;
  const unchangedMs = unchangedBackoffMs(intervals, unchangedStreak);
  const rateMs = Math.min(Math.max(intervals.default + rateBackoffMs, intervals.min), intervals.max);

  let delayMs = Math.max(unchangedMs, rateMs);
  let reason: PollIntervalReason =
    rateMs > intervals.default && rateMs >= unchangedMs ? 'rate-limit-backoff'
      : unchangedMs > intervals.default ? 'unchanged-backoff'
        : 'default';

  if (suspendMs > 0) {
    delayMs = Math.min(suspendMs, MAX_SUSPENSION_MS);
    reason = 'rate-limit-suspended';
  }
  if (quotaPauseMs > delayMs) {
    delayMs = quotaPauseMs;
    reason = 'quota-pause';
  }
  return { delayMs, reason };
}
