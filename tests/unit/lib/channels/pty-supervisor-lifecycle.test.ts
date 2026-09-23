/**
 * PAN-3849 (W33): the PTY supervisor's lifecycle-event posts.
 *
 * Fake-timer tested (NFR-2): the retry backoff must never burn real
 * wall-clock in tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { postAgentLifecycleEvent } from '../../../../src/lib/channels/pty-supervisor.js';

const AGENT = 'agent-pan-3849';
const URL_BASE = 'http://127.0.0.1:3999';

function depsWith(fetchImpl: ReturnType<typeof vi.fn>) {
  return {
    fetchImpl: fetchImpl as never,
    readToken: async () => 'test-token',
    dashboardUrl: URL_BASE,
  };
}

describe('postAgentLifecycleEvent (PAN-3849)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('posts the event with the pty-token header to the agent lifecycle route', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await expect(postAgentLifecycleEvent(AGENT, 'session-started', {}, depsWith(fetchImpl))).resolves.toBe(true);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string; method: string; signal: AbortSignal }];
    expect(url).toBe(`${URL_BASE}/api/agents/${AGENT}/lifecycle`);
    expect(init.method).toBe('POST');
    expect(init.headers['x-overdeck-pty-token']).toBe('test-token');
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body['event']).toBe('session-started');
    expect(typeof body['at']).toBe('string');
    // Every attempt carries a per-attempt timeout signal: a dashboard that
    // accepts the connection but never responds must not hang the supervisor.
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('falls back to the loopback API port, never the public DASHBOARD_URL', async () => {
    vi.stubEnv('OVERDECK_DASHBOARD_URL', '');
    vi.stubEnv('DASHBOARD_URL', 'https://overdeck.localhost');
    vi.stubEnv('API_PORT', '4555');
    try {
      const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      const { dashboardUrl: _omit, ...deps } = depsWith(fetchImpl);

      await expect(postAgentLifecycleEvent(AGENT, 'session-started', {}, deps)).resolves.toBe(true);

      const [url] = fetchImpl.mock.calls[0] as unknown as [string];
      expect(url).toBe(`http://127.0.0.1:4555/api/agents/${AGENT}/lifecycle`);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('includes exitCode for the exited event', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await expect(postAgentLifecycleEvent(AGENT, 'exited', { exitCode: 1 }, depsWith(fetchImpl))).resolves.toBe(true);

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(init.body)['exitCode']).toBe(1);
  });

  it('retries with backoff and posts once the dashboard recovers', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValue({ ok: true, status: 200 });

    const promise = postAgentLifecycleEvent(AGENT, 'exited', { exitCode: 0 }, depsWith(fetchImpl));
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1500);

    await expect(promise).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('returns false after the retry budget without throwing — the child is never blocked', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('dashboard down'));
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const promise = postAgentLifecycleEvent(AGENT, 'session-started', {}, depsWith(fetchImpl));
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1500);

    await expect(promise).resolves.toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('failed after 3 attempts'));
    stderrSpy.mockRestore();
  });

  it('treats a non-2xx response as a failure and retries it', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValue({ ok: true, status: 200 });

    const promise = postAgentLifecycleEvent(AGENT, 'turn-started', {}, depsWith(fetchImpl));
    await vi.advanceTimersByTimeAsync(500);

    await expect(promise).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not post at all when the agent has no pty-token', async () => {
    const fetchImpl = vi.fn();
    const deps = {
      fetchImpl: fetchImpl as never,
      readToken: async () => null,
      dashboardUrl: URL_BASE,
    };
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(postAgentLifecycleEvent(AGENT, 'session-started', {}, deps)).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  it('aborts a hung attempt and retries within the budget', async () => {
    // First attempt hangs until its per-attempt timeout fires; the retry then
    // succeeds. AbortSignal.timeout runs on real timers outside vitest fake
    // timers, so this case runs on real timers (~550ms wall-clock).
    vi.useRealTimers();
    try {
      const seen: AbortSignal[] = [];
      const fetchImpl = vi.fn(async (_url: string, init: { signal: AbortSignal }) => {
        seen.push(init.signal);
        if (seen.length === 1) {
          await new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(init.signal.reason));
          });
        }
        return { ok: true, status: 200 };
      });

      await expect(postAgentLifecycleEvent(AGENT, 'exited', {}, {
        ...depsWith(fetchImpl),
        postTimeoutMs: 50,
      })).resolves.toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(seen[0].aborted).toBe(true);
    } finally {
      vi.useFakeTimers();
    }
  });
});
