/**
 * PAN-4655 WI-6: the idle-settle patrol's host: the first sweep 2 minutes
 * after start, then one per 15 minutes; none while the Deacon is frozen, none
 * on a peer dashboard or with the env disable, and no overlapping sweep.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bootGates = vi.hoisted(() => ({ isPeerDashboardProcess: vi.fn(() => false) }));
vi.mock('../../../../lib/boot-gates.js', () => bootGates);
vi.mock('../../../../lib/overdeck/control-settings.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/overdeck/control-settings.js')>()),
  isDeaconGloballyPaused: vi.fn(() => false),
}));

import {
  IDLE_SETTLE_BOOT_DELAY_MS,
  IDLE_SETTLE_INTERVAL_MS,
  startConversationIdleSettleService,
  stopConversationIdleSettleService,
} from '../conversation-idle-settle-service.js';

const originalDisable = process.env.OVERDECK_DISABLE_IDLE_SETTLE;

beforeEach(() => {
  vi.useFakeTimers();
  delete process.env.OVERDECK_DISABLE_IDLE_SETTLE;
  bootGates.isPeerDashboardProcess.mockReturnValue(false);
});

afterEach(() => {
  stopConversationIdleSettleService();
  vi.useRealTimers();
  if (originalDisable === undefined) delete process.env.OVERDECK_DISABLE_IDLE_SETTLE;
  else process.env.OVERDECK_DISABLE_IDLE_SETTLE = originalDisable;
});

describe('startConversationIdleSettleService', () => {
  it('sweeps first at 120 s, then every 900 s', async () => {
    expect(IDLE_SETTLE_BOOT_DELAY_MS).toBe(120_000);
    expect(IDLE_SETTLE_INTERVAL_MS).toBe(900_000);
    const sweep = vi.fn(async () => []);
    expect(startConversationIdleSettleService({ sweep, isFrozen: () => false, log: vi.fn() })).toBe(true);

    await vi.advanceTimersByTimeAsync(119_000);
    expect(sweep).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sweep).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(899_000);
    expect(sweep).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sweep).toHaveBeenCalledTimes(2);
  });

  it('does not sweep while the Deacon is frozen', async () => {
    const sweep = vi.fn(async () => []);
    startConversationIdleSettleService({ sweep, isFrozen: () => true, log: vi.fn() });
    await vi.advanceTimersByTimeAsync(IDLE_SETTLE_BOOT_DELAY_MS + IDLE_SETTLE_INTERVAL_MS);
    expect(sweep).not.toHaveBeenCalled();
  });

  it('returns false on a peer dashboard', () => {
    bootGates.isPeerDashboardProcess.mockReturnValue(true);
    expect(startConversationIdleSettleService({ sweep: vi.fn(async () => []) })).toBe(false);
  });

  it('returns false with OVERDECK_DISABLE_IDLE_SETTLE=1', () => {
    process.env.OVERDECK_DISABLE_IDLE_SETTLE = '1';
    expect(startConversationIdleSettleService({ sweep: vi.fn(async () => []) })).toBe(false);
  });

  it('returns false on a second start', () => {
    expect(startConversationIdleSettleService({ sweep: vi.fn(async () => []) })).toBe(true);
    expect(startConversationIdleSettleService({ sweep: vi.fn(async () => []) })).toBe(false);
  });

  it('skips a sweep while the previous one is still running', async () => {
    let finish: (names: string[]) => void = () => {};
    const sweep = vi.fn(() => new Promise<string[]>((resolve) => { finish = resolve; }));
    const log = vi.fn();
    startConversationIdleSettleService({ sweep, isFrozen: () => false, log });
    await vi.advanceTimersByTimeAsync(IDLE_SETTLE_BOOT_DELAY_MS + IDLE_SETTLE_INTERVAL_MS);
    expect(sweep).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith('[idle-settle] previous sweep still running, skipping');
    finish([]);
    await vi.advanceTimersByTimeAsync(0);
  });

  it('invalidates the list cache and logs after a sweep that settled something', async () => {
    const invalidate = vi.fn();
    const log = vi.fn();
    startConversationIdleSettleService({ sweep: async () => ['conv-a'], invalidate, isFrozen: () => false, log });
    await vi.advanceTimersByTimeAsync(IDLE_SETTLE_BOOT_DELAY_MS);
    expect(invalidate).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith('[idle-settle] settled 1 idle conversation(s): conv-a');
  });

  it('does not invalidate after a sweep that settled nothing', async () => {
    const invalidate = vi.fn();
    startConversationIdleSettleService({ sweep: async () => [], invalidate, isFrozen: () => false, log: vi.fn() });
    await vi.advanceTimersByTimeAsync(IDLE_SETTLE_BOOT_DELAY_MS);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
