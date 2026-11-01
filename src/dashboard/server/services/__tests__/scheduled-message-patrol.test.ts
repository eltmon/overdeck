/**
 * PAN-4641 WI-7: the scheduled-message patrol's host: crash recovery and one
 * tick at start, then one tick per 60 s; none while the Deacon is frozen, none
 * on a peer dashboard or with the env disable, and no overlapping tick.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bootGates = vi.hoisted(() => ({ isPeerDashboardProcess: vi.fn(() => false) }));
vi.mock('../../../../lib/boot-gates.js', () => bootGates);
vi.mock('../../../../lib/overdeck/control-settings.js', () => ({ isDeaconGloballyPaused: vi.fn(() => false) }));
vi.mock('../../../../lib/overdeck/conversation-scheduled-messages.js', () => ({
  recoverInterruptedScheduledMessages: vi.fn(() => 0),
}));
vi.mock('../../../../lib/overdeck/scheduled-message-delivery.js', () => ({
  SCHEDULED_MESSAGES_INTERVAL_MS: 60_000,
  tickScheduledMessages: vi.fn(async () => []),
}));

import { startScheduledMessagePatrol, stopScheduledMessagePatrol } from '../scheduled-message-patrol.js';

const originalDisable = process.env.OVERDECK_DISABLE_SCHEDULED_MESSAGES;

beforeEach(() => {
  vi.useFakeTimers();
  delete process.env.OVERDECK_DISABLE_SCHEDULED_MESSAGES;
  bootGates.isPeerDashboardProcess.mockReturnValue(false);
});

afterEach(() => {
  stopScheduledMessagePatrol();
  vi.useRealTimers();
  if (originalDisable === undefined) delete process.env.OVERDECK_DISABLE_SCHEDULED_MESSAGES;
  else process.env.OVERDECK_DISABLE_SCHEDULED_MESSAGES = originalDisable;
});

describe('startScheduledMessagePatrol', () => {
  it('recovers interrupted sends once, ticks at start, then once per 60 s', async () => {
    const tick = vi.fn(async () => ['conv-a: #1 sent']);
    const recover = vi.fn(() => 2);
    const log = vi.fn();
    expect(startScheduledMessagePatrol({ tick, recover, isFrozen: () => false, log })).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(recover).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith('[scheduled-messages] 2 interrupted send(s) marked unknown');
    expect(tick).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith('[scheduled-messages] conv-a: #1 sent');

    await vi.advanceTimersByTimeAsync(59_000);
    expect(tick).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tick).toHaveBeenCalledTimes(3);
    expect(recover).toHaveBeenCalledOnce();
  });

  it('does not tick while the Deacon is frozen', async () => {
    const tick = vi.fn(async () => []);
    startScheduledMessagePatrol({ tick, recover: () => 0, isFrozen: () => true });
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(tick).not.toHaveBeenCalled();
  });

  it('does not start when disabled by the environment', () => {
    process.env.OVERDECK_DISABLE_SCHEDULED_MESSAGES = '1';
    const recover = vi.fn(() => 0);
    expect(startScheduledMessagePatrol({ tick: vi.fn(async () => []), recover })).toBe(false);
    expect(recover).not.toHaveBeenCalled();
  });

  it('does not start on a peer dashboard', () => {
    bootGates.isPeerDashboardProcess.mockReturnValue(true);
    expect(startScheduledMessagePatrol({ tick: vi.fn(async () => []), recover: () => 0 })).toBe(false);
  });

  it('does not start a second timer', () => {
    expect(startScheduledMessagePatrol({ tick: vi.fn(async () => []), recover: () => 0, isFrozen: () => false })).toBe(true);
    expect(startScheduledMessagePatrol({ tick: vi.fn(async () => []), recover: () => 0 })).toBe(false);
  });

  it('skips an interval while the previous tick is still running', async () => {
    let finish: (actions: string[]) => void = () => undefined;
    const tick = vi.fn(() => new Promise<string[]>((resolve) => { finish = resolve; }));
    const log = vi.fn();
    startScheduledMessagePatrol({ tick, recover: () => 0, isFrozen: () => false, log });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(tick).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith('[scheduled-messages] previous tick still running, skipping tick');

    finish([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tick).toHaveBeenCalledTimes(2);
    finish([]);
    await vi.advanceTimersByTimeAsync(0);
  });
});
