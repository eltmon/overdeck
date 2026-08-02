import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptWatchProbe } from '../../transcript-landing.js';
import { watchForEatenAgentMessage } from '../eaten-message-watcher.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function watcherArgs(overrides: Partial<Parameters<typeof watchForEatenAgentMessage>[0]>) {
  return {
    agentId: 'agent-min-931',
    workspace: '/tmp/workspace',
    sessionId: 'session-1',
    message: 'read the verification feedback and continue',
    caller: 'messageAgent:internal',
    fromByteOffset: 0,
    timeoutMs: 60_000,
    intervalMs: 1_000,
    graceMs: 5_000,
    ...overrides,
  };
}

describe('watchForEatenAgentMessage', () => {
  it('finishes without redelivery when the message reaches the transcript', async () => {
    const deliver = vi.fn();
    const probes: TranscriptWatchProbe[] = [
      { matchedUserRecord: false, compactBoundaryCount: 0 },
      { matchedUserRecord: true, compactBoundaryCount: 0 },
    ];
    const probe = vi.fn(async () => probes.shift() ?? { matchedUserRecord: true, compactBoundaryCount: 0 });

    const outcome = watchForEatenAgentMessage(watcherArgs({ deliver, probe }));
    await vi.advanceTimersByTimeAsync(2_500);

    await expect(outcome).resolves.toBe('landed');
    expect(deliver).not.toHaveBeenCalled();
  });

  it('redelivers once without the completed dedup key after compaction eats the message', async () => {
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

    const outcome = watchForEatenAgentMessage(watcherArgs({ deliver, probe }));
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(outcome).resolves.toBe('redelivered');
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(
      'agent-min-931',
      'read the verification feedback and continue',
      'messageAgent:internal:compaction-redelivery',
      undefined,
    );
  });

  it('does not redeliver when the queued message lands during the grace period', async () => {
    const deliver = vi.fn();
    const probes: TranscriptWatchProbe[] = [
      { matchedUserRecord: false, compactBoundaryCount: 1 },
      { matchedUserRecord: true, compactBoundaryCount: 1 },
    ];
    const probe = vi.fn(async () => probes.shift() ?? { matchedUserRecord: true, compactBoundaryCount: 1 });

    const outcome = watchForEatenAgentMessage(watcherArgs({ deliver, probe }));
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(outcome).resolves.toBe('landed');
    expect(deliver).not.toHaveBeenCalled();
  });

  it('does not redeliver on a timeout without a compact boundary', async () => {
    const deliver = vi.fn();
    const probe = vi.fn(async (): Promise<TranscriptWatchProbe> => ({
      matchedUserRecord: false,
      compactBoundaryCount: 0,
    }));

    const outcome = watchForEatenAgentMessage(watcherArgs({ deliver, probe, timeoutMs: 5_000 }));
    await vi.advanceTimersByTimeAsync(6_000);

    await expect(outcome).resolves.toBe('unverified');
    expect(deliver).not.toHaveBeenCalled();
  });

  it('reports a failed repair delivery', async () => {
    const deliver = vi.fn(async () => {
      throw new Error('socket gone');
    });
    const probe = vi.fn(async (): Promise<TranscriptWatchProbe> => ({
      matchedUserRecord: false,
      compactBoundaryCount: 1,
    }));

    const outcome = watchForEatenAgentMessage(watcherArgs({ deliver, probe }));
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(outcome).resolves.toBe('redelivery-failed');
    expect(deliver).toHaveBeenCalledTimes(1);
  });
});
