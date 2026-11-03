/** PAN-4833 WI-7: the phone's directory socket, on a fake WebSocket and fake timers. */
import { CLIENT_LIMIT_MESSAGE, CONNECT_PROTOCOL_VERSION, CONNECTOR_LIMIT_MESSAGE, type DirectoryMachine } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DirectoryWebClient, type DirectoryWebDeps } from '../directory-web.js';

const TOKEN = 'odd_' + 'a1'.repeat(32);
const PROTOCOL = 'overdeck.bearer.' + TOKEN;

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  protocol = '';
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  open(protocol = this.protocols[0] ?? ''): void {
    this.protocol = protocol;
    this.readyState = 1;
    this.emit('open', {});
  }

  receive(data: unknown): void {
    this.emit('message', { data: typeof data === 'string' ? data : JSON.stringify(data) });
  }

  serverClose(code: number): void {
    this.readyState = 3;
    this.emit('close', { code });
  }

  frames(): Array<Record<string, unknown>> {
    return this.sent.filter((s) => s !== 'ping').map((s) => JSON.parse(s) as Record<string, unknown>);
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const MACHINE: DirectoryMachine = {
  environmentId: 'env-1',
  label: 'desk',
  publicKeyHex: 'ab'.repeat(32),
  fingerprint: 'abab-abab-abab-abab-abab',
  online: true,
  lastSeenAt: '2026-11-03T00:00:00.000Z',
  serverVersion: '0.73.1',
  endpoints: [],
};

const WELCOME = { type: 'welcome-client', protocol: CONNECT_PROTOCOL_VERSION, plan: 'tester', relayAllowed: true, machines: [MACHINE] };

function client(overrides: Partial<DirectoryWebDeps> = {}): DirectoryWebClient {
  return new DirectoryWebClient({
    baseUrl: 'https://connect.example',
    token: async () => TOKEN,
    clientId: '0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0f9',
    label: '  Pixel\u0007 9  ',
    publicKeyHex: 'cd'.repeat(32),
    appVersion: '1.0.0',
    platform: 'android',
    WebSocket: FakeSocket as unknown as typeof WebSocket,
    random: () => 0.5,
    ...overrides,
  });
}

function latest(): FakeSocket {
  const socket = FakeSocket.instances.at(-1);
  if (!socket) throw new Error('no socket opened');
  return socket;
}

async function online(c: DirectoryWebClient): Promise<FakeSocket> {
  await c.start();
  const socket = latest();
  socket.open();
  socket.receive(WELCOME);
  return socket;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DirectoryWebClient', () => {
  it('opens the directory socket with the bearer subprotocol and says hello-client', async () => {
    const c = client();
    await c.start();
    const socket = latest();
    expect(socket.url).toBe('wss://connect.example/v1/directory');
    expect(socket.protocols).toEqual([PROTOCOL]);
    expect(c.state).toBe('connecting');

    socket.open();
    expect(socket.frames()).toEqual([
      {
        type: 'hello-client',
        protocol: CONNECT_PROTOCOL_VERSION,
        clientId: '0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0f9',
        label: 'Pixel 9',
        publicKeyHex: 'cd'.repeat(32),
        appVersion: '1.0.0',
        platform: 'android',
      },
    ]);
    c.stop();
  });

  it('goes online with the machines from welcome-client', async () => {
    const c = client();
    await online(c);
    expect(c.state).toBe('online');
    expect(c.machines).toEqual([MACHINE]);
    expect(c.plan).toBe('tester');
    expect(c.relayAllowed).toBe(true);
    c.stop();
  });

  it('closes a socket whose accepted protocol is not the bearer token and reconnects', async () => {
    const c = client();
    await c.start();
    latest().open('something-else');
    expect(latest().readyState).toBe(3);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeSocket.instances).toHaveLength(2);
    c.stop();
  });

  it('reconnects after close 1006 with doubling back-off capped at 300 s', async () => {
    const c = client();
    await c.start();
    for (const delay of [1_000, 2_000, 4_000]) {
      const count = FakeSocket.instances.length;
      latest().serverClose(1006);
      expect(c.state).toBe('connecting');
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(FakeSocket.instances).toHaveLength(count);
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeSocket.instances).toHaveLength(count + 1);
    }
    for (let i = 0; i < 12; i++) {
      const count = FakeSocket.instances.length;
      latest().serverClose(1006);
      await vi.advanceTimersByTimeAsync(300_000);
      expect(FakeSocket.instances).toHaveLength(count + 1);
    }
    c.stop();
  });

  it('stops retrying on close 4013 with the client-limit message', async () => {
    const c = client();
    const socket = await online(c);
    socket.serverClose(4013);
    expect(c.state).toBe('refused');
    expect(c.refusal).toBe(CLIENT_LIMIT_MESSAGE);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('sends hello-client with platform node and stops retrying on 4013 with the connector message (PAN-4927 D-18)', async () => {
    const c = client({ platform: 'node' });
    const socket = await online(c);
    expect(socket.frames()[0]).toMatchObject({ type: 'hello-client', platform: 'node' });
    socket.serverClose(4013);
    expect(c.state).toBe('refused');
    expect(c.refusal).toBe(CONNECTOR_LIMIT_MESSAGE);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('drops a socket that answers no ping for 75 s and reconnects', async () => {
    const c = client();
    const socket = await online(c);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(socket.sent.at(-1)).toBe('ping');
    await vi.advanceTimersByTimeAsync(59_999);
    expect(socket.readyState).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.readyState).toBe(3);
    expect(c.state).toBe('connecting');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeSocket.instances).toHaveLength(2);
    c.stop();
  });

  it('keeps a socket that answers pong', async () => {
    const c = client();
    const socket = await online(c);
    await vi.advanceTimersByTimeAsync(60_000);
    socket.receive('pong');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(socket.readyState).toBe(1);
    expect(c.state).toBe('online');
    c.stop();
  });

  it('resolves iceServers on the matching requestId and rejects after 10 s', async () => {
    const c = client();
    const socket = await online(c);

    const answered = c.iceServers(true);
    const request = socket.frames().at(-1) as { type: string; requestId: string; relay: boolean };
    expect(request.type).toBe('ice-servers');
    expect(request.requestId).toMatch(/^[0-9a-f]{32}$/);
    expect(request.relay).toBe(true);
    const servers = [{ urls: ['turn:turn.example:3478'], username: 'u', credential: 'c' }];
    socket.receive({ type: 'ice-servers', requestId: '0'.repeat(32), iceServers: [] });
    socket.receive({ type: 'ice-servers', requestId: request.requestId, iceServers: servers });
    await expect(answered).resolves.toEqual(servers);

    const silent = c.iceServers(false).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await silent).toBeInstanceOf(Error);
    c.stop();
  });

  it('opens no socket without a token', async () => {
    const c = client({ token: async () => null });
    await c.start();
    expect(c.state).toBe('off');
    expect(FakeSocket.instances).toHaveLength(0);
    expect(c.send({ type: 'forget-client' })).toBe(false);
  });

  describe('onStateChange', () => {
    it('hears connecting, then online after welcome-client', async () => {
      const c = client();
      const states: string[] = [];
      c.onStateChange((state) => states.push(state));
      await online(c);
      expect(states).toEqual(['connecting', 'online']);
      expect(c.machines).toEqual([MACHINE]);
    });

    it('hears refused with the refusal set on close 4013', async () => {
      const c = client();
      const socket = await online(c);
      const seen: Array<[string, string | null]> = [];
      c.onStateChange((state) => seen.push([state, c.refusal]));
      socket.serverClose(4013);
      expect(seen).toEqual([['refused', CLIENT_LIMIT_MESSAGE]]);
    });

    it('is called with the unchanged state when a directory frame updates the machines', async () => {
      const c = client();
      const socket = await online(c);
      const listener = vi.fn();
      c.onStateChange(listener);
      const offline = { ...MACHINE, online: false };
      socket.receive({ type: 'directory', machines: [offline] });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith('online');
      expect(c.machines).toEqual([offline]);
    });

    it('stops calling after unsubscribe', async () => {
      const c = client();
      const listener = vi.fn();
      const off = c.onStateChange(listener);
      off();
      const socket = await online(c);
      socket.receive({ type: 'directory', machines: [] });
      c.stop();
      expect(listener).not.toHaveBeenCalled();
    });

    it('hears connecting again when a dropped socket schedules a reconnect', async () => {
      const c = client();
      const socket = await online(c);
      const states: string[] = [];
      c.onStateChange((state) => states.push(state));
      socket.serverClose(1006);
      expect(states).toEqual(['connecting']);
      await vi.advanceTimersByTimeAsync(1_000);
      latest().open();
      latest().receive(WELCOME);
      expect(states).toEqual(['connecting', 'online']);
    });
  });
});
