import { describe, expect, it } from 'vitest';
import { computePollDelay, MAX_SUSPENSION_MS, POLL_INTERVALS, unchangedBackoffMs } from '../poll-cadence.js';

const github = POLL_INTERVALS.github;
const base = { intervals: github, unchangedStreak: 0, rateBackoffMs: 0, suspendMs: 0, quotaPauseMs: 0 };

describe('unchangedBackoffMs', () => {
  it('doubles the default per unchanged poll and caps at max', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((n) => unchangedBackoffMs(github, n)))
      .toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000]);
  });

  it('treats a negative streak as zero', () => {
    expect(unchangedBackoffMs(github, -1)).toBe(30_000);
  });
});

describe('computePollDelay', () => {
  it('returns the default interval with no backoff', () => {
    expect(computePollDelay(base)).toEqual({ delayMs: 30_000, reason: 'default' });
  });

  it('applies the unchanged backoff', () => {
    expect(computePollDelay({ ...base, unchangedStreak: 2 })).toEqual({ delayMs: 120_000, reason: 'unchanged-backoff' });
  });

  it('lets a longer rate-limit backoff win', () => {
    expect(computePollDelay({ ...base, unchangedStreak: 1, rateBackoffMs: 120_000 }))
      .toEqual({ delayMs: 150_000, reason: 'rate-limit-backoff' });
  });

  it('gives a tie to the rate-limit backoff', () => {
    expect(computePollDelay({ ...base, unchangedStreak: 1, rateBackoffMs: 30_000 }))
      .toEqual({ delayMs: 60_000, reason: 'rate-limit-backoff' });
  });

  it('lets a longer unchanged backoff win over a rate-limit backoff', () => {
    expect(computePollDelay({ ...base, unchangedStreak: 3, rateBackoffMs: 30_000 }))
      .toEqual({ delayMs: 240_000, reason: 'unchanged-backoff' });
  });

  it('caps a suspension at one hour', () => {
    expect(computePollDelay({ ...base, suspendMs: 10_000_000 }))
      .toEqual({ delayMs: MAX_SUSPENSION_MS, reason: 'rate-limit-suspended' });
  });

  it('replaces the backoff with a shorter suspension', () => {
    expect(computePollDelay({ ...base, unchangedStreak: 4, suspendMs: 45_000 }))
      .toEqual({ delayMs: 45_000, reason: 'rate-limit-suspended' });
  });

  it('extends the delay to a longer quota pause', () => {
    expect(computePollDelay({ ...base, unchangedStreak: 4, quotaPauseMs: 500_000 }))
      .toEqual({ delayMs: 500_000, reason: 'quota-pause' });
  });

  it('ignores a quota pause shorter than the delay', () => {
    expect(computePollDelay({ ...base, unchangedStreak: 4, quotaPauseMs: 1_000 }))
      .toEqual({ delayMs: 300_000, reason: 'unchanged-backoff' });
  });
});
