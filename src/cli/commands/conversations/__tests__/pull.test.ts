/** PAN-4650 WI-11: `pan conv pull` prints each step and the new URL; `pan conv reclaim` refusals. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('chalk', () => {
  const identity = (s: unknown) => String(s);
  const chalk = new Proxy(identity, { get: () => new Proxy(identity, { get: () => identity }) });
  return { default: chalk };
});

const { PULL_POLL_MS, pullConversation, reclaimConversation } = await import('../pull.js');

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function harness(statuses: unknown[], start = json({ pullId: 'pull-1' }, 202)) {
  const out: string[] = [];
  const err: string[] = [];
  const queue = [...statuses];
  const call = vi.fn(async (path: string, init: { method: string; body?: unknown }) => {
    if (init.method === 'POST' && path === '/api/linked-conversations/pull') return start;
    if (path.startsWith('/api/linked-conversations/pull/')) return json(queue.length > 1 ? queue.shift() : queue[0]);
    throw new Error(`unexpected ${init.method} ${path}`);
  });
  const deps = {
    call: call as never,
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    log: (line: string) => out.push(line),
    error: (line: string) => err.push(line),
  };
  return { call, deps, out, err };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('pan conv pull (PAN-4650 WI-11)', () => {
  it('ac1: prints release, transfer, adopt, finish and the new URL, polling once a second', async () => {
    const h = harness([
      { step: 'release', state: 'running' },
      { step: 'transfer', state: 'running' },
      { step: 'adopt', state: 'running' },
      { step: 'finish', state: 'done', conversation: { id: 812, name: 'conv-new' } },
    ]);
    const result = pullConversation('@desk/conv-x', { stopTurn: true }, h.deps);
    await vi.advanceTimersByTimeAsync(PULL_POLL_MS * 3);

    expect(await result).toBe(0);
    expect(h.out).toEqual(['release', 'transfer', 'adopt', 'finish', 'Pulled: /conv/812']);
    expect(h.call).toHaveBeenCalledWith('/api/linked-conversations/pull', { method: 'POST', body: { conversation: '@desk/conv-x', whenTurnRunning: 'stop' } });
  });

  it('waits for a running turn by default', async () => {
    const h = harness([{ step: 'finish', state: 'done', conversation: { id: 1, name: 'c' } }]);
    await pullConversation('@desk/conv-x', {}, h.deps);
    expect(h.call.mock.calls[0]![1]).toMatchObject({ body: { whenTurnRunning: 'wait' } });
  });

  it('ac2: a failed job prints its error and exits 1', async () => {
    const h = harness([
      { step: 'transfer', state: 'running' },
      { step: 'adopt', state: 'failed', code: 'no-target', error: 'No checkout of overdeck on this machine' },
    ]);
    const result = pullConversation('@desk/conv-x', {}, h.deps);
    await vi.advanceTimersByTimeAsync(PULL_POLL_MS);
    expect(await result).toBe(1);
    expect(h.out).toEqual(['release', 'transfer']);
    expect(h.err).toEqual(['Error (adopt, no-target): No checkout of overdeck on this machine']);
  });

  it('refuses a local name and reports a refused start', async () => {
    const h = harness([], json({ error: 'No machine link named desk', code: 'no-link' }, 404));
    expect(await pullConversation('conv-x', {}, h.deps)).toBe(1);
    expect(await pullConversation('@desk/conv-x', {}, h.deps)).toBe(2);
    expect(h.err.at(-1)).toBe('Error: No machine link named desk');
  });
});

describe('pan conv reclaim (PAN-4650 WI-11)', () => {
  function reclaim(answer: Response) {
    const out: string[] = [];
    const err: string[] = [];
    const call = vi.fn(async () => answer);
    return { call, out, err, deps: { call: call as never, log: (l: string) => out.push(l), error: (l: string) => err.push(l) } };
  }

  it('ac3: still-running-there exits 1', async () => {
    const h = reclaim(json({ error: 'It is still running there as conv-y; pull it back instead', code: 'still-running-there' }, 409));
    expect(await reclaimConversation('conv-x', {}, h.deps)).toBe(1);
    expect(h.err[0]).toContain('still-running-there');
  });

  it('ac4: target-offline exits 1 without --force; --force is passed through', async () => {
    const h = reclaim(json({ error: 'cannot be asked', code: 'target-offline' }, 409));
    expect(await reclaimConversation('conv-x', {}, h.deps)).toBe(1);
    expect(h.err[0]).toContain('target-offline');

    const forced = reclaim(json({ ok: true }));
    expect(await reclaimConversation('conv-x', { force: true }, forced.deps)).toBe(0);
    expect(forced.call).toHaveBeenCalledWith('/api/conversations/conv-x/reclaim', { method: 'POST', body: { force: true } });
  });
});
