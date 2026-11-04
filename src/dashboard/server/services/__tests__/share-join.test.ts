import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { IceServer, JoinEvent, JoinState, ServiceToViewerFrame, SignalData } from '@overdeck/contracts';

import type { AccountRecord } from '../../../../lib/account/store.js';
import { PONG_TIMEOUT_MS, type ShareSocket } from '../share-host.js';
import {
  JOIN_CLOSE_FALLBACK_MS,
  JOIN_ICE_TIMEOUT_MS,
  JOIN_MAX_PENDING_SIGNALS,
  JOIN_UNSUBSCRIBED_GRACE_MS,
  JoinManager,
  type JoinManagerDeps,
} from '../share-join.js';

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
    [1006, 'reconnecting', 'connection_lost'],
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
    expect(h.manager.get(CODE)).toMatchObject({ state: 'reconnecting', error: 'connection_lost' });
  });

  it('leave sends exactly the leave frame and a close with any code gives left', async () => {
    const h = harness();
    const socket = await joined(h);
    socket.deliver({ type: 'status', status: 'admitted' });
    socket.sent.length = 0;
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

  it('an unseated join never reconnects', async () => {
    const refused = harness();
    await refused.manager.join(CODE);
    (refused.sockets[0] as FakeSocket).emit('unexpected-response', {}, { statusCode: 503 });
    const errored = harness();
    await errored.manager.join(CODE);
    (errored.sockets[0] as FakeSocket).emit('error', new Error('ECONNREFUSED'));
    const dropped = harness();
    (await joined(dropped)).drop(1006);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refused.manager.get(CODE)).toMatchObject({ state: 'disconnected', error: 'http_503' });
    expect(errored.manager.get(CODE)).toMatchObject({ state: 'disconnected', error: 'unreachable' });
    expect(dropped.manager.get(CODE)).toMatchObject({ state: 'disconnected', error: 'connection_lost' });
    expect([refused.sockets.length, errored.sockets.length, dropped.sockets.length]).toEqual([1, 1, 1]);
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

const OFFER: SignalData = { sdp: { type: 'offer', sdp: 'v=0 offer' } };
const ANSWER: SignalData = { sdp: { type: 'answer', sdp: 'v=0 answer' } };
const ICE: IceServer[] = [{ urls: ['turn:turn.example:3478'], username: 'u', credential: 'c' }];

function candidate(n: number): SignalData {
  return { candidate: { candidate: `candidate:${n}`, sdpMid: '0', sdpMLineIndex: 0 } };
}

function record(h: Harness): { events: JoinEvent[]; unsubscribe: () => void } {
  const events: JoinEvent[] = [];
  const unsubscribe = h.manager.subscribe(CODE, (event) => events.push(event));
  if (!unsubscribe) throw new Error('no join');
  return { events, unsubscribe };
}

function signals(events: readonly JoinEvent[]): SignalData[] {
  return events.flatMap((event) => (event.type === 'signal' ? [event.data] : []));
}

function states(events: readonly JoinEvent[]): JoinState[] {
  return events.flatMap((event) => (event.type === 'state' ? [event.view.state] : []));
}

async function admitted(h: Harness): Promise<FakeSocket> {
  const socket = await joined(h);
  socket.deliver({ type: 'status', status: 'admitted' });
  socket.deliver({ type: 'ice-servers', iceServers: ICE });
  socket.sent.length = 0;
  return socket;
}

describe('JoinManager relay', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribe on an unknown code answers null', () => {
    expect(harness().manager.subscribe(CODE, () => undefined)).toBeNull();
  });

  it('a subscriber gets the current state at once and every change after', async () => {
    const h = harness();
    const socket = await joined(h);
    const { events } = record(h);
    expect(events).toEqual([{ type: 'state', view: h.manager.get(CODE) }]);
    socket.deliver({ type: 'status', status: 'lobby' });
    expect(states(events)).toEqual(['connecting', 'lobby']);
  });

  it('a lobby subscriber never receives a signal event', async () => {
    const h = harness();
    const socket = await joined(h);
    socket.deliver({ type: 'status', status: 'lobby' });
    const { events } = record(h);
    socket.deliver({ type: 'signal', data: OFFER });
    expect(signals(events)).toEqual([]);
    expect(states(events)).toEqual(['lobby']);
  });

  it('buffers signals without a subscriber and flushes them in order to the first one', async () => {
    const h = harness();
    const socket = await admitted(h);
    socket.deliver({ type: 'signal', data: OFFER });
    socket.deliver({ type: 'signal', data: candidate(1) });
    const { events } = record(h);
    expect(signals(events)).toEqual([OFFER, candidate(1)]);
    expect(h.sockets).toHaveLength(1);
    expect(socket.closedWith).toBeUndefined();
    // Live signals go straight to the subscriber.
    socket.deliver({ type: 'signal', data: candidate(2) });
    expect(signals(events)).toEqual([OFFER, candidate(1), candidate(2)]);
  });

  it('drops signals past the buffer limit', async () => {
    const h = harness();
    const socket = await admitted(h);
    for (let n = 0; n <= JOIN_MAX_PENDING_SIGNALS; n += 1) socket.deliver({ type: 'signal', data: candidate(n) });
    const { events } = record(h);
    const got = signals(events);
    expect(got).toHaveLength(JOIN_MAX_PENDING_SIGNALS);
    expect(got.at(-1)).toEqual(candidate(JOIN_MAX_PENDING_SIGNALS - 1));
  });

  it('a second subscriber replaces the first', async () => {
    const h = harness();
    const socket = await joined(h);
    socket.deliver({ type: 'status', status: 'lobby' });
    const first = record(h);
    const second = record(h);
    expect(first.events.at(-1)).toEqual({ type: 'replaced' });
    socket.deliver({ type: 'status', status: 'admitted' });
    expect(first.events.at(-1)).toEqual({ type: 'replaced' });
    expect(states(second.events)).toEqual(['lobby', 'admitted']);
    // The replaced subscriber's unsubscribe does not detach the new one.
    first.unsubscribe();
    socket.deliver({ type: 'status', status: 'host-disconnected' });
    expect(states(second.events).at(-1)).toBe('host-disconnected');
  });

  it('a second subscriber on an admitted join restarts the socket after its close event', async () => {
    const h = harness();
    const socket = await admitted(h);
    const first = record(h);
    first.unsubscribe();
    const second = record(h);
    expect(socket.closedWith).toBe(1000);
    expect(socket.sent).toEqual([]);
    expect(h.sockets).toHaveLength(1);
    socket.drop(1000);
    expect(h.sockets).toHaveLength(2);
    expect(state(h)).toBe('connecting');
    const next = h.sockets[1] as FakeSocket;
    expect(next.url).toBe(socket.url);
    next.open();
    next.deliver({ type: 'status', status: 'admitted' });
    next.deliver({ type: 'signal', data: OFFER });
    expect(states(second.events)).toEqual(['admitted', 'connecting', 'admitted']);
    expect(signals(second.events)).toEqual([OFFER]);
    // A late frame from the old socket is ignored.
    socket.emit('message', Buffer.from(JSON.stringify({ type: 'signal', data: candidate(9) })), false);
    expect(signals(second.events)).toEqual([OFFER]);
  });

  it('a restart without a close event terminates the old socket after the fallback', async () => {
    const h = harness();
    const socket = await admitted(h);
    record(h).unsubscribe();
    record(h);
    await vi.advanceTimersByTimeAsync(JOIN_CLOSE_FALLBACK_MS - 1);
    expect(h.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.terminated).toBe(true);
    expect(h.sockets).toHaveLength(2);
    expect(state(h)).toBe('connecting');
  });

  it('a live join with no subscriber for 60 s closes and becomes away', async () => {
    const h = harness();
    const socket = await joined(h);
    socket.deliver({ type: 'status', status: 'lobby' });
    record(h).unsubscribe();
    await vi.advanceTimersByTimeAsync(JOIN_UNSUBSCRIBED_GRACE_MS - 1);
    expect(socket.closedWith).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.closedWith).toBe(1000);
    expect(socket.sent).toEqual([]);
    socket.drop(1000);
    expect(state(h)).toBe('away');
  });

  it('a subscriber attached before the grace period ends cancels it', async () => {
    const h = harness();
    const socket = await joined(h);
    socket.deliver({ type: 'status', status: 'lobby' });
    record(h).unsubscribe();
    await vi.advanceTimersByTimeAsync(JOIN_UNSUBSCRIBED_GRACE_MS - 1_000);
    record(h);
    socket.emit('pong');
    await vi.advanceTimersByTimeAsync(JOIN_UNSUBSCRIBED_GRACE_MS);
    expect(socket.closedWith).toBeUndefined();
    expect(state(h)).toBe('lobby');
  });

  it('join on an away join opens a new socket and keeps the subscriber', async () => {
    const h = harness();
    const socket = await joined(h);
    socket.deliver({ type: 'status', status: 'lobby' });
    record(h).unsubscribe();
    await vi.advanceTimersByTimeAsync(JOIN_UNSUBSCRIBED_GRACE_MS);
    socket.drop(1000);
    expect(state(h)).toBe('away');
    const { events } = record(h);
    const again = await h.manager.join(CODE);
    expect(again.kind).toBe('created');
    expect(h.sockets).toHaveLength(2);
    expect(states(events)).toEqual(['away', 'connecting']);
  });

  it('status admitted sends one ice-servers frame and iceServers answers its list', async () => {
    const h = harness();
    const socket = await joined(h);
    socket.deliver({ type: 'status', status: 'admitted' });
    expect(socket.sent).toEqual(['{"type":"ice-servers"}']);
    const pending = h.manager.iceServers(CODE);
    socket.deliver({ type: 'ice-servers', iceServers: ICE });
    expect(await pending).toEqual({ ok: true, iceServers: ICE });
    // Cached: no new frame.
    expect(await h.manager.iceServers(CODE)).toEqual({ ok: true, iceServers: ICE });
    socket.deliver({ type: 'status', status: 'host-reconnected' });
    expect(socket.sent).toEqual(['{"type":"ice-servers"}']);
  });

  it('iceServers answers [] after turn_unavailable', async () => {
    const h = harness();
    const socket = await joined(h);
    socket.deliver({ type: 'status', status: 'admitted' });
    const pending = h.manager.iceServers(CODE);
    socket.deliver({ type: 'error', code: 'turn_unavailable' });
    expect(await pending).toEqual({ ok: true, iceServers: [] });
  });

  it('iceServers answers [] after the timeout', async () => {
    const h = harness();
    const socket = await joined(h);
    socket.deliver({ type: 'status', status: 'admitted' });
    const pending = h.manager.iceServers(CODE);
    await vi.advanceTimersByTimeAsync(JOIN_ICE_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: true, iceServers: [] });
  });

  it('iceServers and signal in the lobby answer not_admitted and send nothing', async () => {
    const h = harness();
    const socket = await joined(h);
    socket.deliver({ type: 'status', status: 'lobby' });
    expect(await h.manager.iceServers(CODE)).toEqual({ ok: false, reason: 'not_admitted' });
    expect(h.manager.signal(CODE, ANSWER)).toBe('not_admitted');
    expect(socket.sent).toEqual([]);
    expect(h.manager.signal('LMNPQRST', ANSWER)).toBe('not_found');
    expect(await h.manager.iceServers('LMNPQRST')).toEqual({ ok: false, reason: 'not_found' });
  });

  it('signal when admitted sends the signal frame', async () => {
    const h = harness();
    const socket = await admitted(h);
    expect(h.manager.signal(CODE, ANSWER)).toBe('sent');
    expect(socket.sent).toEqual([JSON.stringify({ type: 'signal', data: ANSWER })]);
  });

  it('never exposes the device token in an event', async () => {
    const h = harness();
    const socket = await joined(h);
    const { events } = record(h);
    socket.deliver({ type: 'status', status: 'admitted' });
    socket.deliver({ type: 'signal', data: OFFER });
    socket.drop(4010);
    expect(JSON.stringify(events)).not.toContain('odd_');
  });
});

describe('JoinManager reconnect (PAN-4479)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a seated join reconnects after 1 s with the same URL and token and is admitted again on status admitted', async () => {
    const h = harness();
    const first = await admitted(h);
    const { events } = record(h);
    first.drop(1006);
    expect(h.manager.get(CODE)).toMatchObject({ state: 'reconnecting', error: 'connection_lost' });
    await vi.advanceTimersByTimeAsync(999);
    expect(h.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sockets).toHaveLength(2);
    const second = h.sockets[1] as FakeSocket;
    expect(second.url).toBe(first.url);
    expect(second.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
    expect(state(h)).toBe('reconnecting');
    second.open();
    second.deliver({ type: 'status', status: 'admitted' });
    expect(h.manager.get(CODE)).toMatchObject({ state: 'admitted', error: null });
    expect(states(events)).toEqual(['admitted', 'reconnecting', 'admitted']);
    expect([...first.sent, ...second.sent]).not.toContain('{"type":"leave"}');
  });

  it('a seated join backs off 1, 2, 4 s across failed attempts and resets after a status frame', async () => {
    const h = harness();
    (await joined(h)).deliver({ type: 'status', status: 'lobby' });
    for (const [i, delay] of [1_000, 2_000, 4_000].entries()) {
      (h.sockets.at(-1) as FakeSocket).drop(1006);
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(h.sockets).toHaveLength(i + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.sockets).toHaveLength(i + 2);
    }
    const newest = h.sockets.at(-1) as FakeSocket;
    newest.open();
    newest.deliver({ type: 'status', status: 'lobby' });
    expect(state(h)).toBe('lobby');
    newest.drop(1006);
    await vi.advanceTimersByTimeAsync(999);
    expect(h.sockets).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sockets).toHaveLength(5);
  });

  it('a seated 503 upgrade refusal or socket error reconnects', async () => {
    const h = harness();
    (await joined(h)).deliver({ type: 'status', status: 'admitted' });
    (h.sockets[0] as FakeSocket).drop(1006);
    await vi.advanceTimersByTimeAsync(1_000);
    (h.sockets[1] as FakeSocket).emit('unexpected-response', {}, { statusCode: 503 });
    expect(h.manager.get(CODE)).toMatchObject({ state: 'reconnecting', error: 'http_503' });
    expect(h.sockets[1]?.terminated).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.sockets).toHaveLength(3);
    (h.sockets[2] as FakeSocket).emit('error', new Error('ECONNREFUSED'));
    expect(h.manager.get(CODE)).toMatchObject({ state: 'reconnecting', error: 'unreachable' });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(h.sockets).toHaveLength(4);
  });

  it('404 on a reconnect attempt ends the join and stops retrying', async () => {
    const h = harness();
    (await admitted(h)).drop(1006);
    await vi.advanceTimersByTimeAsync(1_000);
    (h.sockets[1] as FakeSocket).emit('unexpected-response', {}, { statusCode: 404 });
    expect(state(h)).toBe('ended');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sockets).toHaveLength(2);
  });

  it('leave while reconnecting gives left and opens no socket', async () => {
    const h = harness();
    (await admitted(h)).drop(1006);
    expect(h.manager.leave(CODE)).toBe('left');
    expect(state(h)).toBe('left');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sockets).toHaveLength(1);
  });

  it('stop while reconnecting opens no socket', async () => {
    const h = harness();
    (await admitted(h)).drop(1006);
    h.manager.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sockets).toHaveLength(1);
  });

  it('no subscriber for 60 s while waiting to reconnect gives away and opens no socket', async () => {
    const h = harness({ reconnectDelaysMs: [90_000] });
    const socket = await admitted(h);
    record(h).unsubscribe();
    socket.drop(1006);
    expect(state(h)).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(JOIN_UNSUBSCRIBED_GRACE_MS);
    expect(state(h)).toBe('away');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sockets).toHaveLength(1);
  });

  it('iceServers and signal answer not_admitted while reconnecting', async () => {
    const h = harness();
    (await admitted(h)).drop(1006);
    expect(await h.manager.iceServers(CODE)).toEqual({ ok: false, reason: 'not_admitted' });
    expect(h.manager.signal(CODE, ANSWER)).toBe('not_admitted');
  });
});
