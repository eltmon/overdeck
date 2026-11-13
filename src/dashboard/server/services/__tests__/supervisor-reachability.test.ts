import { describe, expect, it } from 'vitest';
import { createSupervisorReachabilityTracker } from '../supervisor-reachability.js';

describe('createSupervisorReachabilityTracker', () => {
  it('never reports when the supervisor has never answered', () => {
    const tracker = createSupervisorReachabilityTracker();
    for (let t = 0; t <= 600_000; t += 60_000) {
      expect(tracker.observe(false, t)).toBeNull();
    }
  });

  it('reports once after 60 s unreachable and nothing again until the next episode', () => {
    const tracker = createSupervisorReachabilityTracker();
    expect(tracker.observe(true, 0)).toBeNull();
    expect(tracker.observe(false, 1_000)).toBeNull();
    expect(tracker.observe(false, 59_999)).toBeNull();
    expect(tracker.observe(false, 61_000)).toEqual({ unreachableForMs: 60_000 });
    expect(tracker.observe(false, 120_000)).toBeNull();
  });

  it('reports a second time for a second down episode', () => {
    const tracker = createSupervisorReachabilityTracker();
    tracker.observe(true, 0);
    tracker.observe(false, 1_000);
    expect(tracker.observe(false, 61_000)).toEqual({ unreachableForMs: 60_000 });
    tracker.observe(true, 70_000);
    tracker.observe(false, 71_000);
    expect(tracker.observe(false, 131_000)).toEqual({ unreachableForMs: 60_000 });
  });

  it('restarts the timer after an intervening success', () => {
    const tracker = createSupervisorReachabilityTracker();
    tracker.observe(true, 0);
    tracker.observe(false, 1_000);
    tracker.observe(true, 30_000);
    expect(tracker.observe(false, 40_000)).toBeNull();
    expect(tracker.observe(false, 90_000)).toBeNull();
  });
});
