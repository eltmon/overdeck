import { afterEach, describe, expect, it, vi } from 'vitest';

import type { callDashboard } from '../dashboard-call.js';
import { checkAnywhereRelay } from '../doctor-anywhere-relay.js';

function statusResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const ONLINE_WITH_RELAY = { directory: { state: 'online' }, relay: { using: false, bytesUsed: 0, capBytes: 0, stopped: false } };

afterEach(() => {
  vi.useRealTimers();
});

describe('checkAnywhereRelay (PAN-5242 WI-9)', () => {
  it('returns [] when the dashboard is unreachable', async () => {
    const call = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(await checkAnywhereRelay({ call })).toEqual([]);
  });

  it('returns [] when the plan has no relay', async () => {
    const call = vi.fn(async () => statusResponse({ directory: { state: 'online' }, relay: null }));
    expect(await checkAnywhereRelay({ call })).toEqual([]);
  });

  it('returns [] when the relay check answers skipped', async () => {
    const call = vi.fn(async (path: string) =>
      path === '/api/anywhere/status' ? statusResponse(ONLINE_WITH_RELAY) : statusResponse({ state: 'skipped', reason: 'directory-offline', detail: 'x' }));
    expect(await checkAnywhereRelay({ call })).toEqual([]);
  });

  it('returns an ok row naming the candidate count and turnUrl', async () => {
    const call = vi.fn(async (path: string) =>
      path === '/api/anywhere/status'
        ? statusResponse(ONLINE_WITH_RELAY)
        : statusResponse({ state: 'ok', relayCandidates: 2, turnUrl: 'turns:turn.example:443', elapsedMs: 300 }));
    const rows = await checkAnywhereRelay({ call });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'TURN relay', status: 'ok' });
    expect(rows[0]!.message).toContain('2');
    expect(rows[0]!.message).toContain('turns:turn.example:443');
  });

  it('names the TURN host:port in the fix for a failed check with a turnUrl', async () => {
    const call = vi.fn(async (path: string) =>
      path === '/api/anywhere/status'
        ? statusResponse(ONLINE_WITH_RELAY)
        : statusResponse({ state: 'failed', relayCandidates: 0, turnUrl: 'turns:turn.example:443?transport=tcp', elapsedMs: 10, detail: 'x' }));
    const rows = await checkAnywhereRelay({ call });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'TURN relay', status: 'warn' });
    expect(rows[0]!.fix).toContain('turn.example:443');
  });

  it('says it is an overdeck.ai service problem and names no host for a failed check with no turnUrl', async () => {
    const call = vi.fn(async (path: string) =>
      path === '/api/anywhere/status'
        ? statusResponse(ONLINE_WITH_RELAY)
        : statusResponse({ state: 'failed', relayCandidates: 0, turnUrl: null, elapsedMs: 0, detail: 'the relay list has no TURN server' }));
    const rows = await checkAnywhereRelay({ call });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'TURN relay', status: 'warn' });
    expect(rows[0]!.fix).toContain("overdeck.ai service problem");
    expect(rows[0]!.fix).not.toMatch(/turn\.[a-z]/);
  });

  it('reports refused and unanswered as warn rows', async () => {
    const refusedCall = vi.fn(async (path: string) =>
      path === '/api/anywhere/status' ? statusResponse(ONLINE_WITH_RELAY) : statusResponse({ state: 'refused', detail: 'the relay needs the relay plan' }));
    const refused = await checkAnywhereRelay({ call: refusedCall });
    expect(refused[0]).toMatchObject({ name: 'TURN relay', status: 'warn' });
    expect(refused[0]!.message).toContain('refused relay credentials');

    const unansweredCall = vi.fn(async (path: string) =>
      path === '/api/anywhere/status'
        ? statusResponse(ONLINE_WITH_RELAY)
        : statusResponse({ state: 'unanswered', detail: 'the directory did not answer the ICE server request' }));
    const unanswered = await checkAnywhereRelay({ call: unansweredCall });
    expect(unanswered[0]).toMatchObject({ name: 'TURN relay', status: 'warn' });
    expect(unanswered[0]!.message).toContain('did not send relay credentials');
  });

  it('warns on a non-200 relay-check answer', async () => {
    const call = vi.fn(async (path: string) => (path === '/api/anywhere/status' ? statusResponse(ONLINE_WITH_RELAY) : statusResponse({}, 500)));
    const rows = await checkAnywhereRelay({ call });
    expect(rows).toEqual([{ name: 'TURN relay', status: 'warn', message: 'The relay check answered HTTP 500' }]);
  });

  it('warns with the error message when the POST throws before the deadline', async () => {
    const call = vi.fn(async (path: string) => {
      if (path === '/api/anywhere/status') return statusResponse(ONLINE_WITH_RELAY);
      throw new Error('socket hang up');
    });
    const rows = await checkAnywhereRelay({ call });
    expect(rows).toEqual([{ name: 'TURN relay', status: 'warn', message: 'The relay check failed: socket hang up' }]);
  });

  it('warns with a 25 s deadline message when the relay check only settles on abort', async () => {
    vi.useFakeTimers();
    const call = vi.fn((path: string, init: { signal?: AbortSignal }) => {
      if (path === '/api/anywhere/status') return Promise.resolve(statusResponse(ONLINE_WITH_RELAY));
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    const promise = checkAnywhereRelay({ call: call as unknown as typeof callDashboard });
    await vi.advanceTimersByTimeAsync(25_000);
    const rows = await promise;
    expect(rows).toEqual([{ name: 'TURN relay', status: 'warn', message: 'The relay check did not answer within 25 s' }]);
  });
});
