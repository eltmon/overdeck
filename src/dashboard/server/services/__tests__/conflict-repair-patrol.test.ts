/**
 * PAN-4384: the conflict-repair patrol's host: one tick per interval, none
 * while the Deacon is frozen, none on a peer dashboard or with the env
 * disable, and no overlapping tick.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bootGates = vi.hoisted(() => ({ isPeerDashboardProcess: vi.fn(() => false) }));
vi.mock('../../../../lib/boot-gates.js', () => bootGates);
vi.mock('../../../../lib/overdeck/control-settings.js', () => ({ isDeaconGloballyPaused: vi.fn(() => false) }));
vi.mock('../../../../lib/cloister/conflict-repair.js', () => ({
  CONFLICT_REPAIR_INTERVAL_MS: 60_000,
  tickConflictRepair: vi.fn(async () => []),
}));

import { startConflictRepairPatrol, stopConflictRepairPatrol } from '../conflict-repair-patrol.js';

const originalDisable = process.env.OVERDECK_DISABLE_CONFLICT_REPAIR;

beforeEach(() => {
  vi.useFakeTimers();
  delete process.env.OVERDECK_DISABLE_CONFLICT_REPAIR;
  bootGates.isPeerDashboardProcess.mockReturnValue(false);
});

afterEach(() => {
  stopConflictRepairPatrol();
  vi.useRealTimers();
  if (originalDisable === undefined) delete process.env.OVERDECK_DISABLE_CONFLICT_REPAIR;
  else process.env.OVERDECK_DISABLE_CONFLICT_REPAIR = originalDisable;
});

describe('startConflictRepairPatrol', () => {
  it('runs one tick per interval', async () => {
    const tick = vi.fn(async () => ['PAN-1: repair-requested']);
    const log = vi.fn();
    expect(startConflictRepairPatrol({ tick, isFrozen: () => false, log })).toBe(true);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(tick).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith('[conflict-repair] PAN-1: repair-requested');
  });

  it('does not tick while the Deacon is frozen', async () => {
    const tick = vi.fn(async () => []);
    startConflictRepairPatrol({ tick, isFrozen: () => true });

    await vi.advanceTimersByTimeAsync(3 * 60_000);

    expect(tick).not.toHaveBeenCalled();
  });

  it('does not start when disabled by the environment', () => {
    process.env.OVERDECK_DISABLE_CONFLICT_REPAIR = '1';
    expect(startConflictRepairPatrol({ tick: vi.fn(async () => []) })).toBe(false);
  });

  it('does not start on a peer dashboard', () => {
    bootGates.isPeerDashboardProcess.mockReturnValue(true);
    expect(startConflictRepairPatrol({ tick: vi.fn(async () => []) })).toBe(false);
  });

  it('does not start a second timer', () => {
    expect(startConflictRepairPatrol({ tick: vi.fn(async () => []) })).toBe(true);
    expect(startConflictRepairPatrol({ tick: vi.fn(async () => []) })).toBe(false);
  });

  it('skips an interval while the previous tick is still running', async () => {
    let finish: (actions: string[]) => void = () => undefined;
    const tick = vi.fn(() => new Promise<string[]>((resolve) => { finish = resolve; }));
    const log = vi.fn();
    startConflictRepairPatrol({ tick, isFrozen: () => false, log });

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(tick).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith('[conflict-repair] previous tick still running, skipping tick');

    finish([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tick).toHaveBeenCalledTimes(2);
    finish([]);
    await vi.advanceTimersByTimeAsync(0);
  });
});
