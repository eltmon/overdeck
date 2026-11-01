import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  holdRequestsUntilServed,
  isAddressInUseError,
  retryDashboardBind,
} from '../../../src/dashboard/server/server-bind.js';

describe('dashboard server bind', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries a transient EADDRINUSE before succeeding', async () => {
    let attempts = 0;
    const bind = Effect.suspend(() => {
      attempts += 1;
      return attempts < 3
        ? Effect.fail({ cause: Object.assign(new Error('address in use'), { code: 'EADDRINUSE' }) })
        : Effect.succeed('bound');
    });

    const onRetry = vi.fn();
    const result = Effect.runPromise(retryDashboardBind(bind, onRetry));
    await vi.advanceTimersByTimeAsync(500);

    await expect(result).resolves.toBe('bound');
    expect(attempts).toBe(3);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, 250);
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, 250);
  });

  it('does not retry a non-address bind failure', async () => {
    const failure = { cause: Object.assign(new Error('permission denied'), { code: 'EACCES' }) };
    let attempts = 0;
    const bind = Effect.suspend(() => {
      attempts += 1;
      return Effect.fail(failure);
    });

    await expect(Effect.runPromise(retryDashboardBind(bind))).rejects.toBeDefined();
    expect(attempts).toBe(1);
    expect(isAddressInUseError(failure)).toBe(false);
  });
});

describe('dashboard requests before serve attaches', () => {
  let server: Server;
  let heldCount: () => number;

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function listen(timeoutMs?: number): Promise<string> {
    server = createServer();
    heldCount = holdRequestsUntilServed(server, timeoutMs);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it('answers a request that arrived before the handler attached', async () => {
    const base = await listen();
    const response = fetch(`${base}/conv/3335`);
    await vi.waitFor(() => expect(heldCount()).toBe(1));

    server.on('request', (req, res) => {
      res.end(`served ${req.url}`);
    });

    const body = await (await response).text();
    expect(body).toBe('served /conv/3335');
    expect(heldCount()).toBe(0);
    expect(server.listenerCount('request')).toBe(1);
  });

  it('answers 503 when no handler attaches in time', async () => {
    const base = await listen(50);
    const response = await fetch(`${base}/conv/3335`);

    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('5');
  });
});
