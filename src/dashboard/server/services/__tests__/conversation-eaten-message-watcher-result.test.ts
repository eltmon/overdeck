/**
 * PAN-4278 — the eaten-message watcher counts a redelivery only when the
 * delivery door reported ok; a returned failure is a failed redelivery.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchForEatenConversationMessage } from '../conversation-eaten-message-watcher.js';
import type { TranscriptWatchProbe } from '../../../../lib/transcript-landing.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('watchForEatenConversationMessage delivery result', () => {
  it('watcher does not report redelivered when redelivery returns ok:false', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const deliver = vi.fn(async () => ({ ok: false, path: 'herdr', failure: 'refused: agent_blocked' }) as never);
    const probe = vi.fn(async (): Promise<TranscriptWatchProbe> => ({ matchedUserRecord: false, compactBoundaryCount: 1 }));

    const outcome = watchForEatenConversationMessage({
      conversationName: 'conv-test',
      tmuxSession: 'conv-test',
      cwd: '/tmp/ws',
      sessionId: 'session-1',
      message: 'deploy the fix now',
      fromByteOffset: 0,
      timeoutMs: 60_000,
      intervalMs: 1_000,
      graceMs: 5_000,
      deliver,
      probe,
    });
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(outcome).resolves.toBe('redelivery-failed');
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('[conversation-eaten-message-watcher] conv-test: redelivery failed: refused: agent_blocked');
  });
});
