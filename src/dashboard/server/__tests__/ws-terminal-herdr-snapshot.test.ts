import http from 'node:http';

import { WebSocket as WsClient } from 'ws';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { _resetInternalTokenCacheForTests } from '../../../lib/internal-token.js';
import { _resetDashboardSessionTokenForTests, dashboardSessionCookieHeader } from '../routes/dashboard-auth.js';
import { _resetTrustedOriginsForTests } from '../routes/origin-validation.js';
import { setupTerminalWebSocket } from '../ws-terminal.js';

const TRUSTED_ORIGIN = 'http://localhost:3011';

const { FakeHerdrTerminalProcess } = vi.hoisted(() => {
  class FakeHerdrTerminalProcess {
    static instances: FakeHerdrTerminalProcess[] = [];
    readonly writes: string[] = [];
    readonly resizes: Array<{ cols: number; rows: number }> = [];
    closed = false;
    private readonly dataListeners = new Set<(data: string) => void>();
    private readonly exitListeners = new Set<(exitCode: number) => void>();

    constructor(
      public readonly terminalId: string,
      public cols: number,
      public rows: number,
    ) {
      FakeHerdrTerminalProcess.instances.push(this);
    }

    write(data: string): void {
      this.writes.push(data);
    }

    resize(cols: number, rows: number): void {
      this.cols = cols;
      this.rows = rows;
      this.resizes.push({ cols, rows });
    }

    onData(cb: (data: string) => void): () => void {
      this.dataListeners.add(cb);
      return () => {
        this.dataListeners.delete(cb);
      };
    }

    onExit(cb: (exitCode: number) => void): () => void {
      this.exitListeners.add(cb);
      return () => {
        this.exitListeners.delete(cb);
      };
    }

    close(): void {
      this.closed = true;
    }

    emit(data: string): void {
      for (const listener of this.dataListeners) listener(data);
    }
  }
  return { FakeHerdrTerminalProcess };
});

vi.mock('../services/terminal-service.js', () => ({
  resolveHerdrTerminalId: vi.fn(async () => 'term_test'),
  resolveTerminalAttachTarget: vi.fn(async () => ({ kind: 'herdr', terminalId: 'term_test' })),
  HerdrTerminalProcess: FakeHerdrTerminalProcess,
}));

/** Resolve once `predicate()` is true, polling on a short real tick (test sync only, not production retry/backoff logic). */
async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Queues incoming WS messages as strings so tests can `await` the next one in order. */
function createMessageQueue(client: WsClient): { next(): Promise<string> } {
  const queue: string[] = [];
  const waiters: Array<(msg: string) => void> = [];
  client.on('message', (data) => {
    const text = data.toString();
    if (waiters.length) waiters.shift()!(text);
    else queue.push(text);
  });
  return {
    next(): Promise<string> {
      if (queue.length) return Promise.resolve(queue.shift()!);
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}

/** Extract the `name=value` pair from a Set-Cookie header for use as a request cookie. */
function requestCookie(setCookieHeader: string): string {
  return setCookieHeader.split(';')[0];
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('expected an AddressInfo');
      resolve(address.port);
    });
  });
}

describe('serveHerdrTerminal snapshot bracketed paste (PAN-4557)', () => {
  let server: http.Server;

  beforeEach(() => {
    delete process.env.OVERDECK_DASHBOARD_SESSION_TOKEN;
    process.env.OVERDECK_INTERNAL_TOKEN = 'stable-internal-token';
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
    _resetTrustedOriginsForTests();
    FakeHerdrTerminalProcess.instances.length = 0;
    server = http.createServer();
    setupTerminalWebSocket(server);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    delete process.env.OVERDECK_INTERNAL_TOKEN;
    delete process.env.OVERDECK_DASHBOARD_SESSION_TOKEN;
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
    _resetTrustedOriginsForTests();
  });

  async function connectAndAttach(): Promise<{ client: WsClient; queue: ReturnType<typeof createMessageQueue> }> {
    const port = await listen(server);
    const cookie = requestCookie(dashboardSessionCookieHeader());
    const client = new WsClient(`ws://127.0.0.1:${port}/ws/terminal?session=x`, {
      headers: { origin: TRUSTED_ORIGIN, cookie },
    });
    const queue = createMessageQueue(client);
    await new Promise<void>((resolve, reject) => {
      client.once('open', () => resolve());
      client.once('error', (err) => reject(err));
    });
    client.send(JSON.stringify({ type: 'attach', cols: 80, rows: 24 }));
    await waitUntil(() => FakeHerdrTerminalProcess.instances.length > 0);
    return { client, queue };
  }

  it('prefixes the first snapshot frame with bracketed-paste-on, leaves later frames unchanged', async () => {
    const { client, queue } = await connectAndAttach();
    const bridge = FakeHerdrTerminalProcess.instances[0];

    bridge.emit('\x1b[2J\x1b[1;1Hhello');
    const snapshotMessage = await queue.next();
    expect(snapshotMessage.startsWith('\u0000')).toBe(true);
    const snapshot = JSON.parse(snapshotMessage.slice(1)) as { type: string; data: string };
    expect(snapshot.type).toBe('snapshot');
    expect(snapshot.data).toBe('\x1b[?2004h\x1b[2J\x1b[1;1Hhello');

    bridge.emit('\x1b[?2004lplain');
    const laterMessage = await queue.next();
    expect(laterMessage).toBe('\x1b[?2004lplain');

    client.terminate();
  });

  it('forwards a bracketed-paste payload to the Herdr write path unchanged', async () => {
    const { client, queue } = await connectAndAttach();
    const bridge = FakeHerdrTerminalProcess.instances[0];

    bridge.emit('\x1b[2J\x1b[1;1Hhello');
    await queue.next();

    client.send(JSON.stringify({ type: 'ready' }));
    const pasted = '\x1b[200~a\rb\x1b[201~';
    client.send(pasted);
    await waitUntil(() => bridge.writes.length > 0);

    expect(bridge.writes).toEqual([pasted]);

    client.terminate();
  });
});
