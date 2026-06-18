import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forkConversationViaServer, isForkResultInProgress } from '../../../src/cli/commands/fork-client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('isForkResultInProgress', () => {
  it('is true only for timeout or non-failed in-flight fork statuses', () => {
    expect(isForkResultInProgress({ id: 1, name: 'a', tmuxSession: 'conv-a', timedOut: true, forkStatus: 'spawning' })).toBe(true);
    expect(isForkResultInProgress({ id: 2, name: 'b', tmuxSession: 'conv-b', forkStatus: 'handoff' })).toBe(true);
    expect(isForkResultInProgress({ id: 3, name: 'c', tmuxSession: 'conv-c', forkStatus: null })).toBe(false);
    expect(isForkResultInProgress({ id: 4, name: 'd', tmuxSession: 'conv-d', forkStatus: 'failed' })).toBe(false);
  });
});

describe('forkConversationViaServer', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    process.env['OVERDECK_DASHBOARD_URL'] = 'http://127.0.0.1:3011';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
    delete process.env['OVERDECK_DASHBOARD_URL'];
  });

  it('reports timedOut=true when the poll deadline expires while forkStatus is still in-flight', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ conversation: { id: 1, name: 'forked', tmuxSession: 'conv-forked', forkStatus: 'spawning' } }))
      .mockResolvedValue(jsonResponse({ id: 1, name: 'forked', tmuxSession: 'conv-forked', forkStatus: 'spawning' }));
    globalThis.fetch = fetchMock as typeof fetch;

    const resultPromise = forkConversationViaServer('source', { forkMode: 'summary' }, { timeoutMs: 2_000, pollMs: 1_000 });

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(resultPromise).resolves.toMatchObject({
      id: 1,
      name: 'forked',
      forkStatus: 'spawning',
      timedOut: true,
    });
  });

  it('reports timedOut=false when forkStatus clears before the deadline', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ conversation: { id: 2, name: 'done', tmuxSession: 'conv-done', forkStatus: 'spawning' } }))
      .mockResolvedValueOnce(jsonResponse({ id: 2, name: 'done', tmuxSession: 'conv-done', forkStatus: null }));
    globalThis.fetch = fetchMock as typeof fetch;

    const resultPromise = forkConversationViaServer('source', { forkMode: 'summary' }, { timeoutMs: 5_000, pollMs: 1_000 });

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(resultPromise).resolves.toMatchObject({
      id: 2,
      name: 'done',
      forkStatus: null,
      timedOut: false,
    });
  });

  it('reports timedOut=false when the fork fails before the deadline', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ conversation: { id: 3, name: 'failed', tmuxSession: 'conv-failed', forkStatus: 'spawning' } }))
      .mockResolvedValueOnce(jsonResponse({ id: 3, name: 'failed', tmuxSession: 'conv-failed', forkStatus: 'failed', forkError: 'boom' }));
    globalThis.fetch = fetchMock as typeof fetch;

    const resultPromise = forkConversationViaServer('source', { forkMode: 'summary' }, { timeoutMs: 5_000, pollMs: 1_000 });

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(resultPromise).resolves.toMatchObject({
      id: 3,
      name: 'failed',
      forkStatus: 'failed',
      forkError: 'boom',
      timedOut: false,
    });
  });
});
