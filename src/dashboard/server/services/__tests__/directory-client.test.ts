import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import type { AdvertisedEndpoint, DirectoryToMachineFrame } from '@overdeck/contracts';

import type { AccountRecord } from '../../../../lib/account/store.js';
import {
  ACCOUNT_CHECK_MS,
  DirectoryClient,
  defaultOpenSocket,
  directoryLabel,
  type DirectoryClientDeps,
  type DirectorySocket,
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
} from '../directory-client.js';

const ENV = '00000000-0000-4000-8000-0000000000aa';
const PEER = '00000000-0000-4000-8000-0000000000bb';
const ACCOUNT: AccountRecord = {
  v: 1,
  baseUrl: 'https://overdeck.ai',
  accessToken: `odd_${'a'.repeat(64)}`,
  deviceId: 'd-1',
  label: 'desk',
  githubLogin: 'me',
  githubId: 1,
  signedInAt: '2026-11-01T00:00:00.000Z',
};

/** Timers and the clock are fake; socket I/O (where real) stays real. */
const FAKE_TIMERS = { toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] as const };

function welcome(machines = [peerMachine()]): DirectoryToMachineFrame {
  return {
    type: 'welcome',
    protocol: 1,
    plan: 'tester',
    maxMachines: null,
    relayAllowed: true,
    inboxAllowed: true,
    relay: { month: '2026-11', bytesUsed: 0, capBytes: 50_000_000_000, stopped: false },
    machines,
  };
}

function peerMachine() {
  return {
    environmentId: PEER,
    label: 'vps',
    publicKeyHex: 'bb'.repeat(32),
    fingerprint: 'bbbb-bbbb-bbbb-bbbb-bbbb',
    online: true,
    lastSeenAt: '2026-11-01T00:00:00.000Z',
    serverVersion: '0.72.0',
    endpoints: [],
  };
}

/** A scripted socket: the test drives open/message/close; sends are recorded. */
class FakeSocket extends EventEmitter implements DirectorySocket {
  readyState: number = WebSocket.CONNECTING;
  readonly sent: string[] = [];

  constructor(readonly url: string, readonly headers: Record<string, string>) {
    super();
  }

  override on(event: string, listener: (...args: never[]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  open(): void {
    this.readyState = WebSocket.OPEN;
    this.emit('open');
  }

  deliver(frame: DirectoryToMachineFrame | 'pong'): void {
    this.emit('message', Buffer.from(frame === 'pong' ? 'pong' : JSON.stringify(frame)), false);
  }

  drop(code: number, reason = ''): void {
    this.readyState = WebSocket.CLOSED;
    this.emit('close', code, Buffer.from(reason));
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
  }

  terminate(): void {
    this.readyState = WebSocket.CLOSED;
  }

  frames(): Array<Record<string, unknown>> {
    return this.sent.filter((s) => s !== 'ping').map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

function harness(over: Partial<DirectoryClientDeps> = {}) {
  const sockets: FakeSocket[] = [];
  let account: AccountRecord | null = ACCOUNT;
  let endpoints: AdvertisedEndpoint[] = [{ kind: 'lan', url: 'tcp://192.168.1.4:3011' }];
  const deps: DirectoryClientDeps = {
    readAccount: async () => account,
    readDirectoryUrl: async () => ({ url: 'https://connect.test' }),
    identity: async () => ({ environmentId: ENV, label: 'desk' }),
    machineKey: async () => ({ publicKey: Buffer.alloc(32, 0xaa), secretKey: Buffer.alloc(32, 1) }),
    endpoints: () => endpoints,
    endpointsHash: () => JSON.stringify(endpoints),
    serverVersion: '0.72.0',
    linkedEnvironmentIds: () => new Set([PEER]),
    openSocket: (url, headers) => {
      const socket = new FakeSocket(url, headers);
      sockets.push(socket);
      return socket;
    },
    random: () => 0.5,
    ...over,
  };
  const client = new DirectoryClient(deps);
  return {
    client,
    sockets,
    setAccount: (next: AccountRecord | null) => {
      account = next;
    },
    setEndpoints: (next: AdvertisedEndpoint[]) => {
      endpoints = next;
    },
  };
}

/** Lets the client's awaited hello (identity + key) settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('DirectoryClient (PAN-2356 WI-9)', () => {
  it('opens no socket without account.json and reports signed out', async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    const h = harness();
    h.setAccount(null);
    await h.client.start();
    expect(h.sockets).toEqual([]);
    expect(h.client.status()).toMatchObject({ signedIn: false, state: 'off', machines: [] });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.sockets).toEqual([]);
    h.client.stop();
  });

  it('sends a label the directory accepts: no control characters, at most 64 characters, never empty', () => {
    expect(directoryLabel('  desk\u0007\n  ', ENV)).toBe('desk');
    expect(directoryLabel('\u0001\t ', ENV)).toBe(ENV.slice(0, 8));
    expect([...directoryLabel('é'.repeat(80), ENV)]).toHaveLength(64);
  });

  it('connects with the device token, sends hello and fills status from welcome', async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    const h = harness();
    await h.client.start();
    const socket = h.sockets[0]!;
    expect(socket.url).toBe('wss://connect.test/v1/directory');
    expect(socket.headers).toEqual({ Authorization: `Bearer ${ACCOUNT.accessToken}` });
    socket.open();
    await flush();
    expect(socket.frames()[0]).toEqual({
      type: 'hello',
      protocol: 1,
      environmentId: ENV,
      label: 'desk',
      publicKeyHex: 'aa'.repeat(32),
      serverVersion: '0.72.0',
      linkProtocol: 1,
      endpoints: [{ kind: 'lan', url: 'tcp://192.168.1.4:3011' }],
    });
    socket.deliver(welcome());
    expect(h.client.status()).toMatchObject({
      signedIn: true,
      state: 'online',
      url: 'https://connect.test',
      plan: 'tester',
      machines: [{ environmentId: PEER, linked: true }],
    });
    expect(h.client.machine(PEER)?.label).toBe('vps');
    expect(h.client.relayEntitled()).toBe(true);
    h.client.stop();
  });

  it('stops retrying after close 4009 and shows the free-plan refusal for at least 10 minutes', async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    const h = harness();
    await h.client.start();
    h.sockets[0]!.open();
    await flush();
    h.sockets[0]!.drop(4009, 'machine limit');
    expect(h.client.status()).toMatchObject({ state: 'refused', refusal: 'The free account includes 3 machines' });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.sockets).toHaveLength(1);
    h.client.stop();
  });

  it('retries a refused machine once account.json changes', async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    const h = harness();
    await h.client.start();
    h.sockets[0]!.drop(4001);
    expect(h.client.status().state).toBe('refused');
    h.setAccount({ ...ACCOUNT, accessToken: `odd_${'b'.repeat(64)}` });
    await vi.advanceTimersByTimeAsync(ACCOUNT_CHECK_MS);
    expect(h.sockets).toHaveLength(2);
    expect(h.sockets[1]!.headers['Authorization']).toBe(`Bearer odd_${'b'.repeat(64)}`);
    h.client.stop();
  });

  it('reconnects a dropped socket after 1 s, then 2 s, and resets on welcome', async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    const h = harness();
    await h.client.start();
    h.sockets[0]!.drop(1006);
    await vi.advanceTimersByTimeAsync(999);
    expect(h.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sockets).toHaveLength(2);

    h.sockets[1]!.drop(1006);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(h.sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sockets).toHaveLength(3);

    h.sockets[2]!.open();
    await flush();
    h.sockets[2]!.deliver(welcome());
    h.sockets[2]!.drop(1006);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.sockets).toHaveLength(4);
    h.client.stop();
  });

  it('pings every 30 s and reconnects after 75 s without a pong', async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    const h = harness();
    await h.client.start();
    const socket = h.sockets[0]!;
    socket.open();
    await flush();
    socket.deliver(welcome());
    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS);
    expect(socket.sent.filter((s) => s === 'ping')).toHaveLength(1);
    socket.deliver('pong');
    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS * 2);
    expect(h.sockets).toHaveLength(1);
    // No pong since 30 s: at 30 + 90 = 120 s the gap passes 75 s.
    await vi.advanceTimersByTimeAsync(PONG_TIMEOUT_MS);
    expect(socket.readyState).toBe(WebSocket.CLOSED);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.sockets).toHaveLength(2);
    h.client.stop();
  });

  it('sends endpoints when the advertised hash changes', async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    const h = harness();
    await h.client.start();
    const socket = h.sockets[0]!;
    socket.open();
    await flush();
    socket.deliver(welcome());
    h.setEndpoints([{ kind: 'tailnet', url: 'tcp://100.64.0.2:3011' }]);
    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS);
    expect(socket.frames().at(-1)).toEqual({ type: 'endpoints', endpoints: [{ kind: 'tailnet', url: 'tcp://100.64.0.2:3011' }] });
    h.client.stop();
  });

  it('dispatches frames to subscribers and keeps the relay status current', async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    const h = harness();
    await h.client.start();
    const socket = h.sockets[0]!;
    socket.open();
    await flush();
    socket.deliver(welcome());
    const seen: string[] = [];
    const off = h.client.on('signal', (f) => seen.push(f.from));
    socket.deliver({ type: 'signal', from: PEER, session: '0'.repeat(32), purpose: 'link', relay: false, data: { sdp: { type: 'offer', sdp: 'v=0' } } });
    off();
    socket.deliver({ type: 'signal', from: ENV, session: '0'.repeat(32), purpose: 'link', relay: false, data: { sdp: { type: 'offer', sdp: 'v=0' } } });
    expect(seen).toEqual([PEER]);
    socket.deliver({ type: 'relay-status', month: '2026-11', bytesUsed: 50_000_000_000, capBytes: 50_000_000_000, stopped: true });
    expect(h.client.status().relay).toEqual({ month: '2026-11', bytesUsed: 50_000_000_000, capBytes: 50_000_000_000, stopped: true });
    expect(h.client.send({ type: 'relay-usage', bytes: 1 })).toBe(true);
    h.client.stop();
  });
});

describe('DirectoryClient over a real loopback ws server', () => {
  it('goes online on welcome and is refused, without reconnecting for 10 minutes, after close 4009', async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    let connections = 0;
    const hellos: unknown[] = [];
    const connected: Array<WebSocket> = [];
    server.on('connection', (ws, req) => {
      connections += 1;
      connected.push(ws);
      expect(req.headers['authorization']).toBe(`Bearer ${ACCOUNT.accessToken}`);
      ws.on('message', (data) => {
        hellos.push(JSON.parse(data.toString()));
        ws.send(JSON.stringify(welcome()));
      });
    });

    vi.useFakeTimers(FAKE_TIMERS);
    const h = harness({ readDirectoryUrl: async () => ({ url: `http://127.0.0.1:${port}` }), openSocket: defaultOpenSocket });
    const online = new Promise<void>((resolve) => h.client.on('welcome', () => resolve()));
    await h.client.start();
    await online;
    expect(hellos).toHaveLength(1);
    expect(h.client.status()).toMatchObject({ state: 'online', machines: [{ environmentId: PEER }] });

    connected[0]!.close(4009, 'machine limit');
    await vi.waitFor(() => expect(h.client.status().state).toBe('refused'));
    expect(h.client.status().refusal).toBe('The free account includes 3 machines');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(connections).toBe(1);

    h.client.stop();
    vi.useRealTimers();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
