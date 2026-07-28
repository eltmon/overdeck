import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDeaconEventClient } from '../../../../src/lib/cloister/deacon-event-client.js';

function event(index: number) {
  return {
    type: 'activity.entry' as const,
    timestamp: `2026-07-03T00:00:${String(index).padStart(2, '0')}.000Z`,
    payload: { index },
  };
}

describe('deacon event client', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('flushes a debounced batch to the internal events endpoint', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 } as Response));
    const client = createDeaconEventClient({
      dashboardUrl: 'http://127.0.0.1:3011',
      token: 'test-token',
      fetchImpl,
    });

    client.append(event(1));
    client.append(event(2));
    expect(fetchImpl).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      events: [event(1), event(2)],
    });
    expect(client.bufferedCount()).toBe(0);
  });

  it('flushes immediately when the batch reaches 50 events', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 } as Response));
    const client = createDeaconEventClient({
      dashboardUrl: 'http://127.0.0.1:3011',
      token: 'test-token',
      fetchImpl,
    });

    for (let i = 0; i < 50; i++) client.append(event(i));
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((fetchImpl.mock.calls[0]![1] as RequestInit).body)).events).toHaveLength(50);
  });

  it('retries with exponential backoff after a failed flush', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    const warn = vi.fn();
    const client = createDeaconEventClient({
      dashboardUrl: 'http://127.0.0.1:3011',
      token: 'test-token',
      fetchImpl,
      warn,
      baseRetryMs: 1000,
    });

    client.append(event(1));
    await vi.advanceTimersByTimeAsync(250);
    expect(client.bufferedCount()).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('retrying in 1000ms'));

    await vi.advanceTimersByTimeAsync(1000);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(client.bufferedCount()).toBe(0);
  });

  it('drops oldest buffered events on overflow and warns with a dropped count', () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 } as Response));
    const warn = vi.fn();
    const client = createDeaconEventClient({
      dashboardUrl: 'http://127.0.0.1:3011',
      token: 'test-token',
      fetchImpl,
      warn,
      maxBufferSize: 3,
      batchSize: 50,
    });

    client.append(event(1));
    client.append(event(2));
    client.append(event(3));
    client.append(event(4));

    expect(client.bufferedCount()).toBe(3);
    expect(warn).toHaveBeenCalledWith('[deacon-event-client] buffer overflow: dropped 1 oldest event');
  });

  it('subscribes to internal events with cursor-based polling', async () => {
    const frame = (item: { sequence: number; type: string; timestamp: string; payload: unknown }) =>
      `event: ${item.type}\n` +
      `id: ${item.sequence}\n` +
      `data: ${JSON.stringify(item)}\n\n`;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ latestSequence: 10 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: new Response(
          frame({ ...event(11), sequence: 11 }) + frame({ ...event(12), sequence: 12 }),
        ).body,
      } as Response);
    const received: Array<{ sequence: number; type: string; timestamp: string; payload: unknown }> = [];
    const client = createDeaconEventClient({
      dashboardUrl: 'http://127.0.0.1:3011',
      token: 'test-token',
      fetchImpl,
    });

    let unsubscribe = () => {};
    unsubscribe = client.subscribe((event) => {
      received.push(event);
      if (received.length === 2) unsubscribe();
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(received).toEqual([
      { ...event(11), sequence: 11 },
      { ...event(12), sequence: 12 },
    ]);
  });
});

/**
 * PAN-3092: the batching append path resolves on local enqueue, before any HTTP
 * request or SQLite commit, so it cannot back an at-most-once guarantee. This
 * path awaits the server's settled transaction outcome instead.
 */
describe('deacon event client appendOnce (PAN-3092)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function client(fetchImpl: typeof fetch) {
    return createDeaconEventClient({
      dashboardUrl: 'http://127.0.0.1:3011',
      token: 'test-token',
      fetchImpl,
    });
  }

  it('posts to the append-once endpoint and returns the server outcome', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ outcome: 'appended', sequence: 7 }),
    } as unknown as Response));

    const outcome = await client(fetchImpl).appendOnce(event(1), 'episode-1');

    expect(outcome).toBe('appended');
    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe('http://127.0.0.1:3011/api/internal/events/append-once');
    expect(JSON.parse(String(init.body))).toMatchObject({ idempotencyKey: 'episode-1' });
  });

  it('relays a server-detected duplicate rather than appending again', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ outcome: 'duplicate', sequence: 7 }),
    } as unknown as Response));

    expect(await client(fetchImpl).appendOnce(event(1), 'episode-1')).toBe('duplicate');
  });

  it('reports failed on an HTTP error instead of claiming the event landed', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 } as Response));

    expect(await client(fetchImpl).appendOnce(event(1), 'episode-1')).toBe('failed');
  });

  it('reports failed when the request never completes', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); });

    expect(await client(fetchImpl).appendOnce(event(1), 'episode-1')).toBe('failed');
  });

  it('does not queue the event — a failure must not silently retry as a batch', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 } as Response));
    const c = client(fetchImpl);

    await c.appendOnce(event(1), 'episode-1');

    // Nothing buffered: the caller owns the retry, and a queued copy would
    // resurface the warning without the caller ever knowing.
    expect(c.bufferedCount()).toBe(0);
  });

  it('reports failed on an unrecognised outcome', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ outcome: 'weird' }),
    } as unknown as Response));

    expect(await client(fetchImpl).appendOnce(event(1), 'episode-1')).toBe('failed');
  });
});
