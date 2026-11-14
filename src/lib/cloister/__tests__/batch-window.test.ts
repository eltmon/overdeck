/**
 * PAN-4753 D4: the batch window. Fake timers drive the clock (repo rule:
 * every wait-window test uses them).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadyFeature } from '../uat-generation-engine.js';
import type { UatGeneration } from '../../overdeck/merge-sync.js';
import { chooseBatch, readySinceFromRollup } from '../batch-window.js';

const MIN = 60_000;
const feature = (n: number): ReadyFeature => ({ issueId: `PAN-${n}`, title: `t${n}`, branch: `feature/pan-${n}` });
const liveGen = (ids: number[]) => ({
  name: 'uat/pan-a', status: 'ready', members: ids.map((n, i) => ({ issueId: `PAN-${n}`, branch: `feature/pan-${n}`, headSha: 'x', mergeOrder: i + 1 })),
  heldOut: [],
}) as unknown as UatGeneration;

describe('chooseBatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-14T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  function choose(features: ReadyFeature[], readyAt: number[], live: UatGeneration[] = []) {
    return chooseBatch({
      features,
      readySince: new Map(features.map((f, i) => [f.issueId, readyAt[i] ?? Date.now()])),
      live,
      size: 3,
      waitMs: 30 * MIN,
      now: Date.now(),
    });
  }

  it('waits while fewer than N are ready and the oldest has not waited M', () => {
    const start = Date.now();
    const result = choose([feature(1), feature(2)], [start, start]);
    expect(result).toEqual({ wait: '2 of 3 ready; oldest waited 0 of 30 min' });
  });

  it('assembles when N features are ready, before M elapses', () => {
    const now = Date.now();
    expect(choose([feature(1), feature(2), feature(3)], [now, now, now])).toEqual({ features: [feature(1), feature(2), feature(3)] });
  });

  it('caps a batch at N features, in merge order', () => {
    const now = Date.now();
    expect(choose([1, 2, 3, 4, 5].map(feature), [now, now, now, now, now])).toEqual({ features: [feature(1), feature(2), feature(3)] });
  });

  it('assembles a smaller batch once the oldest member has waited M', () => {
    const readyAt = Date.now();
    vi.advanceTimersByTime(29 * MIN);
    expect(choose([feature(1), feature(2)], [readyAt, Date.now()])).toHaveProperty('wait');
    vi.advanceTimersByTime(MIN);
    expect(choose([feature(1), feature(2)], [readyAt, readyAt + 29 * MIN])).toEqual({ features: [feature(1), feature(2)] });
  });

  it('makes a one-member batch for a lone feature at the timeout', () => {
    const readyAt = Date.now();
    vi.advanceTimersByTime(30 * MIN);
    expect(choose([feature(1)], [readyAt])).toEqual({ features: [feature(1)] });
  });

  it('freezes a live batch: new arrivals wait for the next batch', () => {
    const now = Date.now();
    expect(choose([1, 2, 3, 4].map(feature), [now, now, now, now], [liveGen([1, 2, 3])]))
      .toEqual({ features: [feature(1), feature(2), feature(3)] });
  });

  it('does not freeze a live batch that lost a member', () => {
    const now = Date.now();
    expect(choose([feature(1), feature(3)], [now, now], [liveGen([1, 2, 3])])).toHaveProperty('wait');
  });
});

describe('readySinceFromRollup', () => {
  it('is the newest check completion on the head', () => {
    expect(readySinceFromRollup({
      statusCheckRollup: [
        { conclusion: 'SUCCESS', completedAt: '2026-11-14T10:00:00Z' },
        { conclusion: 'SUCCESS', completedAt: '2026-11-14T10:20:00Z' },
        { state: 'SUCCESS' },
      ],
    })).toBe(Date.parse('2026-11-14T10:20:00Z'));
  });

  it('is null when no check reports a completion time', () => {
    expect(readySinceFromRollup({ statusCheckRollup: [{ state: 'SUCCESS' }] })).toBeNull();
    expect(readySinceFromRollup({})).toBeNull();
  });
});
