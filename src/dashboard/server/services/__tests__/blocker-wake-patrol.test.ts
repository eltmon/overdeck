/**
 * PAN-4451: the blocker-wake patrol's host: one tick per interval, none
 * while the Deacon is frozen, none on a peer dashboard or with the env
 * disable, and no overlapping tick.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bootGates = vi.hoisted(() => ({ isPeerDashboardProcess: vi.fn(() => false) }));
vi.mock('../../../../lib/boot-gates.js', () => bootGates);
vi.mock('../../../../lib/overdeck/control-settings.js', () => ({ isDeaconGloballyPaused: vi.fn(() => false) }));
vi.mock('../../../../lib/cloister/blocker-wake.js', () => ({
  BLOCKER_WAKE_INTERVAL_MS: 120_000,
  tickBlockerWake: vi.fn(async () => []),
}));

import { startBlockerWakePatrol, stopBlockerWakePatrol } from '../blocker-wake-patrol.js';

const originalDisable = process.env.OVERDECK_DISABLE_BLOCKER_WAKE;

beforeEach(() => {
  vi.useFakeTimers();
  delete process.env.OVERDECK_DISABLE_BLOCKER_WAKE;
  bootGates.isPeerDashboardProcess.mockReturnValue(false);
});

afterEach(() => {
  stopBlockerWakePatrol();
  vi.useRealTimers();
  if (originalDisable === undefined) delete process.env.OVERDECK_DISABLE_BLOCKER_WAKE;
  else process.env.OVERDECK_DISABLE_BLOCKER_WAKE = originalDisable;
});

describe('startBlockerWakePatrol', () => {
  it('runs one tick per interval', async () => {
    const tick = vi.fn(async () => ['PAN-1: woke agent-pan-1 for PAN-1-a']);
    const log = vi.fn();
    expect(startBlockerWakePatrol({ tick, isFrozen: () => false, log })).toBe(true);

    await vi.advanceTimersByTimeAsync(120_000);

    expect(tick).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith('[blocker-wake] PAN-1: woke agent-pan-1 for PAN-1-a');
  });

  it('does not tick while the Deacon is frozen', async () => {
    const tick = vi.fn(async () => []);
    startBlockerWakePatrol({ tick, isFrozen: () => true });

    await vi.advanceTimersByTimeAsync(3 * 120_000);

    expect(tick).not.toHaveBeenCalled();
  });

  it('does not start when disabled by the environment', () => {
    process.env.OVERDECK_DISABLE_BLOCKER_WAKE = '1';
    expect(startBlockerWakePatrol({ tick: vi.fn(async () => []) })).toBe(false);
  });

  it('does not start on a peer dashboard', () => {
    bootGates.isPeerDashboardProcess.mockReturnValue(true);
    expect(startBlockerWakePatrol({ tick: vi.fn(async () => []) })).toBe(false);
  });

  it('does not start a second timer', () => {
    expect(startBlockerWakePatrol({ tick: vi.fn(async () => []) })).toBe(true);
    expect(startBlockerWakePatrol({ tick: vi.fn(async () => []) })).toBe(false);
  });

  it('stops ticking after stopBlockerWakePatrol', async () => {
    const tick = vi.fn(async () => []);
    startBlockerWakePatrol({ tick, isFrozen: () => false });
    await vi.advanceTimersByTimeAsync(120_000);
    stopBlockerWakePatrol();
    await vi.advanceTimersByTimeAsync(3 * 120_000);
    expect(tick).toHaveBeenCalledOnce();
  });

  it('skips an interval while the previous tick is still running', async () => {
    let finish: (actions: string[]) => void = () => undefined;
    const tick = vi.fn(() => new Promise<string[]>((resolve) => { finish = resolve; }));
    const log = vi.fn();
    startBlockerWakePatrol({ tick, isFrozen: () => false, log });

    await vi.advanceTimersByTimeAsync(120_000);
    await vi.advanceTimersByTimeAsync(120_000);

    expect(tick).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith('[blocker-wake] previous tick still running, skipping tick');

    finish([]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(tick).toHaveBeenCalledTimes(2);
    finish([]);
    await vi.advanceTimersByTimeAsync(0);
  });
});
