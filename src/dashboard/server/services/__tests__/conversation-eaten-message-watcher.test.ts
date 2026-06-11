/**
 * Tests for the eaten-by-compaction watcher (PAN-1635 / PAN-1769): a
 * conversation message delivered into a near-full context can be dropped by
 * Claude Code's submit-time compaction. The watcher redelivers exactly once
 * when a compact boundary lands without the message, and never redelivers on
 * a plain timeout or when the message (eventually) lands.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchForEatenConversationMessage } from '../conversation-eaten-message-watcher.js';
import type { TranscriptWatchProbe } from '../../../../lib/transcript-landing.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function watcherArgs(overrides: Partial<Parameters<typeof watchForEatenConversationMessage>[0]>) {
  return {
    conversationName: 'conv-test',
    tmuxSession: 'conv-test',
    cwd: '/tmp/ws',
    sessionId: 'session-1',
    message: 'deploy the fix now',
    fromByteOffset: 0,
    timeoutMs: 60_000,
    intervalMs: 1_000,
    graceMs: 5_000,
    ...overrides,
  };
}

describe('watchForEatenConversationMessage', () => {
  it('resolves landed without redelivery when the message reaches the transcript', async () => {
    const deliver = vi.fn();
    const probes: TranscriptWatchProbe[] = [
      { matchedUserRecord: false, compactBoundaryCount: 0 },
      { matchedUserRecord: true, compactBoundaryCount: 0 },
    ];
    const probe = vi.fn(async () => probes.shift() ?? { matchedUserRecord: true, compactBoundaryCount: 0 });

    const outcome = watchForEatenConversationMessage(watcherArgs({ deliver, probe }));
    await vi.advanceTimersByTimeAsync(2_500);

    await expect(outcome).resolves.toBe('landed');
    expect(deliver).not.toHaveBeenCalled();
  });

  it('redelivers once after the grace when a compact boundary lands without the message', async () => {
    const deliver = vi.fn(async () => ({ ok: true }) as never);
    let matchedAfterRedelivery = false;
    const probe = vi.fn(async (): Promise<TranscriptWatchProbe> => ({
      matchedUserRecord: matchedAfterRedelivery,
      compactBoundaryCount: 1,
    }));
    deliver.mockImplementation(async () => {
      matchedAfterRedelivery = true;
      return { ok: true } as never;
    });

    const outcome = watchForEatenConversationMessage(watcherArgs({ deliver, probe }));
    // boundary seen at first probe (1s); grace 5s; redelivery on the probe after 6s.
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(outcome).resolves.toBe('redelivered');
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith('conv-test', 'deploy the fix now', 'conversation-message-redelivery', undefined);
  });

  it('does not redeliver when the queued message lands within the grace window', async () => {
    const deliver = vi.fn();
    const probes: TranscriptWatchProbe[] = [
      { matchedUserRecord: false, compactBoundaryCount: 1 },
      { matchedUserRecord: true, compactBoundaryCount: 1 },
    ];
    const probe = vi.fn(async () => probes.shift() ?? { matchedUserRecord: true, compactBoundaryCount: 1 });

    const outcome = watchForEatenConversationMessage(watcherArgs({ deliver, probe }));
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(outcome).resolves.toBe('landed');
    expect(deliver).not.toHaveBeenCalled();
  });

  it('never redelivers on a plain timeout without a compact boundary', async () => {
    const deliver = vi.fn();
    const probe = vi.fn(async (): Promise<TranscriptWatchProbe> => ({
      matchedUserRecord: false,
      compactBoundaryCount: 0,
    }));

    const outcome = watchForEatenConversationMessage(watcherArgs({ deliver, probe, timeoutMs: 5_000 }));
    await vi.advanceTimersByTimeAsync(6_000);

    await expect(outcome).resolves.toBe('unverified');
    expect(deliver).not.toHaveBeenCalled();
  });

  it('reports redelivery-failed when the redelivery itself throws', async () => {
    const deliver = vi.fn(async () => {
      throw new Error('socket gone');
    });
    const probe = vi.fn(async (): Promise<TranscriptWatchProbe> => ({
      matchedUserRecord: false,
      compactBoundaryCount: 1,
    }));

    const outcome = watchForEatenConversationMessage(watcherArgs({ deliver, probe }));
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(outcome).resolves.toBe('redelivery-failed');
    expect(deliver).toHaveBeenCalledTimes(1);
  });
});
