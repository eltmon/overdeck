import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { JoinState, ServiceToViewerFrame } from '@overdeck/contracts';

import type { AccountRecord } from '../../../../lib/account/store.js';
import { PONG_TIMEOUT_MS, type ShareSocket } from '../share-host.js';
import { JOIN_CLOSE_FALLBACK_MS, JoinManager, type JoinManagerDeps } from '../share-join.js';

const BASE = 'https://share.overdeck.ai';
const CODE = 'BCDFGHJK';
const TOKEN = `odd_${'v'.repeat(64)}`;
const ACCOUNT: AccountRecord = {
  v: 1,
  baseUrl: 'https://overdeck.ai',
  accessToken: TOKEN,
  deviceId: 'd-2',
  label: 'laptop',
  githubLogin: 'alice',
  githubId: 100,
  signedInAt: '2026-11-01T00:00:00.000Z',
};

/** A scripted socket: the test drives open/message/close; sends are recorded. */
class FakeSocket extends EventEmitter implements ShareSocket {
  readyState: number = WebSocket.CONNECTING;
  readonly sent: string[] = [];
  pings = 0;
  terminated = false;
  closedWith: number | undefined;

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

  deliver(frame: ServiceToViewerFrame): void {
    this.emit('message', Buffer.from(JSON.stringify(frame)), false);
  }

  drop(code: number): void {
    this.readyState = WebSocket.CLOSED;
    this.emit('close', code, Buffer.from(''));
  }

  send(data: string): void {
    this.sent.push(data);
  }

  ping(): void {
    this.pings += 1;
  }

  close(code?: number): void {
    this.closedWith = code;
    this.readyState = WebSocket.CLOSING;
  }

  terminate(): void {
    this.terminated = true;
    this.readyState = WebSocket.CLOSED;
  }
}

interface Harness {
  manager: JoinManager;
  sockets: FakeSocket[];
}

function harness(overrides: Partial<JoinManagerDeps> = {}): Harness {
  const sockets: FakeSocket[] = [];
  const deps: JoinManagerDeps = {
    readAccount: async () => ACCOUNT,
    readShareUrl: async () => ({ url: BASE }),
    openSocket: (url, headers) => {
      const socket = new FakeSocket(url, headers);
      sockets.push(socket);
      return socket;
    },
    now: () => Date.now(),
    ...overrides,
  };
  return { manager: new JoinManager(deps), sockets };
}

async function joined(h: Harness): Promise<FakeSocket> {
  const outcome = await h.manager.join(CODE);
  expect(outcome.kind).toBe('created');
  const socket = h.sockets.at(-1) as FakeSocket;
  socket.open();
  return socket;
}

function state(h: Harness): JoinState | undefined {
  return h.manager.get(CODE)?.state;
}

describe('JoinManager lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers 412 without an account and opens no socket', async () => {
    const h = harness({ readAccount: async () => null });
    expect(await h.manager.join(CODE)).toEqual({
      kind: 'error',
      status: 412,
      body: { error: 'not_signed_in', message: 'Sign in with pan account login to join shared conversations.' },
    });
    expect(h.sockets).toHaveLength(0);
    expect(h.manager.get(CODE)).toBeNull();
  });

  it('answers 500 account_unreadable when the account cannot be read', async () => {
    const h = harness({ readAccount: async () => { throw new Error('bad json'); } });
    expect(await h.manager.join(CODE)).toEqual({ kind: 'error', status: 500, body: { error: 'account_unreadable', message: 'bad json' } });
    expect(h.sockets).toHaveLength(0);
  });

  it('answers 500 share_url_invalid for a bad share URL', async () => {
    const h = harness({ readShareUrl: async () => ({ error: 'share_url must be https' }) });
    expect(await h.manager.join(CODE)).toEqual({ kind: 'error', status: 500, body: { error: 'share_url_invalid', message: 'share_url must be https' } });
    expect(h.sockets).toHaveLength(0);
  });

  it('opens the join socket with the device token and answers created', async () => {
    const h = harness();
    const outcome = await h.manager.join(CODE);
    expect(outcome).toEqual({
      kind: 'created',
      view: {
        shortCode: CODE,
        joinUrl: `${BASE}/s/${CODE}`,
        state: 'connecting',
        contributor: false,
        login: 'alice',
        closeCode: null,
        error: null,
      },
    });
    expect(h.sockets).toHaveLength(1);
    expect(h.sockets[0]?.url).toBe('wss://share.overdeck.ai/v1/rooms/BCDFGHJK/join?v=1');
    expect(h.sockets[0]?.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
  });

  it('a second join while live answers existing and opens no second socket', async () => {
    const h = harness();
    const socket = await joined(h);
    socket.deliver({ type: 'status', status: 'lobby' });
    const again = await h.manager.join(CODE);
    expect(again.kind).toBe('existing');
    expect(again.kind !== 'error' && again.view.state).toBe('lobby');
    expect(h.sockets).toHaveLength(1);
  });

  it('two concurrent joins share one socket', async () => {
    const h = harness();
    const [a, b] = await Promise.all([h.manager.join(CODE), h.manager.join(CODE)]);
    expect(a.kind).toBe('created');
    expect(b.kind).toBe('created');
    expect(h.sockets).toHaveLength(1);
  });

  it('maps every status frame to its state', async () => {
    const h = harness();
    const socket = await joined(h);
    expect(state(h)).toBe('connecting');
    socket.deliver({ type: 'status', status: 'lobby' });
    expect(state(h)).toBe('lobby');
    socket.deliver({ type: 'status', status: 'admitted', contributor: true });
    expect(state(h)).toBe('admitted');
    expect(h.manager.get(CODE)?.contributor).toBe(true);
    socket.deliver({ type: 'status', status: 'host-disconnected' });
    expect(state(h)).toBe('host-disconnected');
    socket.deliver({ type: 'status', status: 'host-reconnected' });
    expect(state(h)).toBe('admitted');
    socket.deliver({ type: 'status', status: 'admitted' });
    expect(h.manager.get(CODE)?.contributor).toBe(false);
  });

  it.each([
    [1000, 'left', null],
    [4003, 'revoked', null],
    [4004, 'ended', null],
    [4008, 'replaced', null],
    [4009, 'is-host', null],
    [4010, 'kicked', null],
    [4011, 'revoked', null],
    [4013, 'full', null],
    [1006, 'disconnected', 'connection_lost'],
  ] as const)('close code %i gives %s', async (code, expected, error) => {
    const h = harness();
    const socket = await joined(h);
    socket.deliver({ type: 'status', status: 'admitted' });
    socket.drop(code);
    expect(h.manager.get(CODE)).toMatchObject({ state: expected, closeCode: code, error });
  });

  it.each([
    [404, 'ended', null],
    [401, 'rejected', null],
    [403, 'rejected', null],
    [503, 'disconnected', 'http_503'],
  ] as const)('an upgrade refusal %i gives %s and terminates', async (status, expected, error) => {
    const h = harness();
    await h.manager.join(CODE);
    const socket = h.sockets[0] as FakeSocket;
    socket.emit('unexpected-response', {}, { statusCode: status });
    expect(h.manager.get(CODE)).toMatchObject({ state: expected, error });
    expect(socket.terminated).toBe(true);
  });

  it('a socket error gives disconnected unreachable', async () => {
    const h = harness();
    await h.manager.join(CODE);
    const socket = h.sockets[0] as FakeSocket;
    socket.emit('error', new Error('ECONNREFUSED'));
    expect(h.manager.get(CODE)).toMatchObject({ state: 'disconnected', error: 'unreachable' });
    expect(socket.terminated).toBe(true);
    // A late close from the terminated socket changes nothing.
    socket.drop(1006);
    expect(h.manager.get(CODE)).toMatchObject({ state: 'disconnected', error: 'unreachable', closeCode: null });
  });

  it('pings every 30 s and terminates after 75 s without a pong', async () => {
    const h = harness();
    const socket = await joined(h);
    socket.deliver({ type: 'status', status: 'lobby' });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(socket.pings).toBe(1);
    socket.emit('pong');
    await vi.advanceTimersByTimeAsync(PONG_TIMEOUT_MS - 1);
    expect(state(h)).toBe('lobby');
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.terminated).toBe(true);
    expect(h.manager.get(CODE)).toMatchObject({ state: 'disconnected', error: 'connection_lost' });
  });

  it('leave sends exactly the leave frame and a close with any code gives left', async () => {
    const h = harness();
    const socket = await joined(h);
    socket.deliver({ type: 'status', status: 'admitted' });
    expect(h.manager.leave(CODE)).toBe('left');
    expect(socket.sent).toEqual(['{"type":"leave"}']);
    expect(state(h)).toBe('admitted');
    socket.drop(4010);
    expect(h.manager.get(CODE)).toMatchObject({ state: 'left', closeCode: 4010 });
  });

  it('leave without a close terminates after the fallback and gives left', async () => {
    const h = harness();
    const socket = await joined(h);
    socket.deliver({ type: 'status', status: 'lobby' });
    h.manager.leave(CODE);
    await vi.advanceTimersByTimeAsync(JOIN_CLOSE_FALLBACK_MS - 1);
    expect(socket.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.terminated).toBe(true);
    expect(state(h)).toBe('left');
  });

  it('leave before the socket opens gives left at once', async () => {
    const h = harness();
    await h.manager.join(CODE);
    expect(h.manager.leave(CODE)).toBe('left');
    expect(state(h)).toBe('left');
    expect(h.sockets[0]?.terminated).toBe(true);
    expect(h.sockets[0]?.sent).toEqual([]);
  });

  it('leave on an unknown code answers not_found', () => {
    expect(harness().manager.leave(CODE)).toBe('not_found');
  });

  it('never exposes the device token in a view', async () => {
    const h = harness();
    const socket = await joined(h);
    for (const status of ['lobby', 'admitted', 'host-disconnected'] as const) {
      socket.deliver({ type: 'status', status });
      expect(JSON.stringify(h.manager.get(CODE))).not.toContain('odd_');
    }
    socket.drop(4010);
    expect(JSON.stringify(h.manager.get(CODE))).not.toContain('odd_');
  });

  it('join after kicked opens a new socket', async () => {
    const h = harness();
    const first = await joined(h);
    first.drop(4010);
    expect(state(h)).toBe('kicked');
    const again = await h.manager.join(CODE);
    expect(again.kind).toBe('created');
    expect(h.sockets).toHaveLength(2);
    expect(state(h)).toBe('connecting');
  });
});
