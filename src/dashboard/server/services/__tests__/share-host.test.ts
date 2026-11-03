import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type {
  CreateRoomResponse,
  IceServer,
  RoomParticipant,
  RoomSnapshot,
  SendSharePromptRequest,
  ServiceToHostFrame,
  ShareDraftView,
  ShareIdentity,
  ShareQueueView,
  ShareScope,
  SignalData,
} from '@overdeck/contracts';

import type { AccountRecord } from '../../../../lib/account/store.js';
import type { ShareRecord } from '../../../../lib/sharing/share-record.js';
import type { ControllerSendResult, HostHub, PeerHubContext } from '../../sharing/peer-hub.js';
import {
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
  SHARE_RECONNECT_DELAYS_MS,
  ShareManager,
  type ShareManagerDeps,
  type ShareSocket,
} from '../share-host.js';

const BASE = 'https://share.overdeck.ai';
const ACCOUNT: AccountRecord = {
  v: 1,
  baseUrl: 'https://overdeck.ai',
  accessToken: `odd_${'a'.repeat(64)}`,
  deviceId: 'd-1',
  label: 'desk',
  githubLogin: 'owner',
  githubId: 1,
  signedInAt: '2026-11-01T00:00:00.000Z',
};
const SCOPE: ShareScope = { kind: 'conversation', conversationId: 'conv-a' };
const OWNER = { githubId: 1, login: 'owner', avatarUrl: 'https://avatars.githubusercontent.com/u/1' };
const CODES = ['BCDFGHJK', 'LMNPQRST', 'VWXZ2345'];

function hostToken(n: number): string {
  return `odh_${String(n).repeat(64).slice(0, 64)}`;
}

function snapshot(code: string, overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    shortCode: code,
    scope: SCOPE,
    dataOwner: OWNER,
    controllerGithubId: 1,
    hostConnected: true,
    participants: [],
    blocked: [],
    ...overrides,
  };
}

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

  deliver(frame: ServiceToHostFrame): void {
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
    this.readyState = WebSocket.CLOSED;
  }

  terminate(): void {
    this.terminated = true;
    this.readyState = WebSocket.CLOSED;
  }
}

interface Harness {
  manager: ShareManager;
  deps: ShareManagerDeps;
  store: Record<string, ShareRecord>;
  sockets: FakeSocket[];
  events: string[];
  createRoom: ReturnType<typeof vi.fn>;
  deleteRoom: ReturnType<typeof vi.fn>;
}

function harness(overrides: Partial<ShareManagerDeps> = {}): Harness {
  const store: Record<string, ShareRecord> = {};
  const sockets: FakeSocket[] = [];
  const events: string[] = [];
  let next = 0;
  const createRoom = vi.fn(async (): Promise<{ ok: true; room: CreateRoomResponse }> => {
    const code = CODES[next] as string;
    const token = hostToken(next + 1);
    next += 1;
    return { ok: true, room: { shortCode: code, hostToken: token, joinUrl: `${BASE}/s/${code}`, snapshot: snapshot(code, { hostConnected: false }) } };
  });
  const deleteRoom = vi.fn(async () => ({ ok: true as const }));
  const deps: ShareManagerDeps = {
    readAccount: async () => ACCOUNT,
    readShareUrl: async () => ({ url: BASE }),
    createRoom: createRoom as unknown as ShareManagerDeps['createRoom'],
    deleteRoom: deleteRoom as unknown as ShareManagerDeps['deleteRoom'],
    records: {
      read: async () => ({ ...store }),
      put: async (code, record) => {
        events.push(`put:${code}`);
        store[code] = record;
      },
      remove: async (code) => {
        events.push(`remove:${code}`);
        const had = code in store;
        delete store[code];
        return had;
      },
    },
    openSocket: (url, headers) => {
      events.push(`open:${url}`);
      const socket = new FakeSocket(url, headers);
      sockets.push(socket);
      return socket;
    },
    now: () => new Date('2026-11-02T00:00:00.000Z'),
    ...overrides,
  };
  return { manager: new ShareManager(deps), deps, store, sockets, events, createRoom, deleteRoom };
}

function storedRecord(code: string, n: number, conversationId: string): ShareRecord {
  return { scopeKind: 'conversation', scopeId: conversationId, hostToken: hostToken(n), joinUrl: `${BASE}/s/${code}`, createdAt: `2026-11-01T00:00:0${n}.000Z` };
}

function participant(githubId: number, state: RoomParticipant['state']): RoomParticipant {
  return { githubId, login: `u${githubId}`, avatarUrl: `https://avatars.githubusercontent.com/u/${githubId}`, state, contributor: false, connected: true };
}

async function createConnected(h: Harness): Promise<FakeSocket> {
  const outcome = await h.manager.create(SCOPE);
  expect(outcome.kind).toBe('created');
  const socket = h.sockets.at(-1) as FakeSocket;
  socket.open();
  socket.deliver({ type: 'room', snapshot: snapshot('BCDFGHJK') });
  return socket;
}

describe('ShareManager', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes the record before opening the host socket with the host token (ac1)', async () => {
    const h = harness();
    const outcome = await h.manager.create(SCOPE);

    expect(outcome).toMatchObject({ kind: 'created', view: { shortCode: 'BCDFGHJK', joinUrl: `${BASE}/s/BCDFGHJK`, connection: 'connecting' } });
    expect(h.events).toEqual(['put:BCDFGHJK', `open:wss://share.overdeck.ai/v1/rooms/BCDFGHJK/host?v=1`]);
    const socket = h.sockets[0] as FakeSocket;
    expect(socket.headers.Authorization).toMatch(/^Bearer odh_[0-9a-f]{64}$/);
    expect(socket.url).toMatch(/\/host\?v=1$/);
    expect(h.store.BCDFGHJK).toEqual({
      scopeKind: 'conversation',
      scopeId: 'conv-a',
      hostToken: hostToken(1),
      joinUrl: `${BASE}/s/BCDFGHJK`,
      createdAt: '2026-11-02T00:00:00.000Z',
    });
    expect(h.createRoom).toHaveBeenCalledWith(BASE, ACCOUNT.accessToken, SCOPE);
  });

  it('a room frame flips the view to connected with that snapshot', async () => {
    const h = harness();
    await createConnected(h);
    const [view] = await h.manager.list();
    expect(view).toMatchObject({ connection: 'connected', snapshot: snapshot('BCDFGHJK') });
  });

  it('returns the existing share for a second create while live, calling createRoom once', async () => {
    const h = harness();
    await createConnected(h);
    const again = await h.manager.create(SCOPE);
    expect(again).toMatchObject({ kind: 'existing', view: { shortCode: 'BCDFGHJK' } });
    expect(h.createRoom).toHaveBeenCalledTimes(1);
  });

  it('two concurrent creates for the same scope mint one room (ac2)', async () => {
    const h = harness();
    const [a, b] = await Promise.all([h.manager.create(SCOPE), h.manager.create(SCOPE)]);
    expect(h.createRoom).toHaveBeenCalledTimes(1);
    expect(a.kind === 'error' || b.kind === 'error').toBe(false);
    if (a.kind !== 'error' && b.kind !== 'error') expect(b.view.shortCode).toBe(a.view.shortCode);
  });

  it('ends a stale record best-effort and replaces it with a new room', async () => {
    const h = harness();
    h.store.VWXZ2345 = { scopeKind: 'conversation', scopeId: 'conv-a', hostToken: hostToken(9), joinUrl: `${BASE}/s/VWXZ2345`, createdAt: '2026-11-01T00:00:00.000Z' };
    h.deleteRoom.mockResolvedValueOnce({ ok: false, status: null, error: 'unreachable' } as never);

    const outcome = await h.manager.create(SCOPE);

    expect(outcome).toMatchObject({ kind: 'created', view: { shortCode: 'BCDFGHJK' } });
    expect(h.deleteRoom).toHaveBeenCalledWith(BASE, 'VWXZ2345', hostToken(9));
    expect(Object.keys(h.store)).toEqual(['BCDFGHJK']);
  });

  it('answers 412 not_signed_in without an account and 500 when it is unreadable', async () => {
    const signedOut = harness({ readAccount: async () => null });
    expect(await signedOut.manager.create(SCOPE)).toEqual({
      kind: 'error',
      status: 412,
      body: { error: 'not_signed_in', message: 'Sign in with pan account login to share conversations.' },
    });
    const broken = harness({ readAccount: async () => { throw new Error('Cannot read account.json'); } });
    expect(await broken.manager.create(SCOPE)).toMatchObject({ kind: 'error', status: 500, body: { error: 'account_unreadable' } });
    expect(signedOut.createRoom).not.toHaveBeenCalled();
  });

  it('maps createRoom failures', async () => {
    const cases: Array<[number | null, number, string]> = [
      [401, 409, 'account_rejected'],
      [403, 409, 'account_expired'],
      [429, 429, 'rate_limited'],
      [null, 502, 'share_service_unreachable'],
      [503, 502, 'share_service_error'],
    ];
    for (const [serviceStatus, status, error] of cases) {
      const h = harness();
      h.createRoom.mockResolvedValueOnce({ ok: false, status: serviceStatus, error: 'x' } as never);
      expect(await h.manager.create(SCOPE)).toMatchObject({ kind: 'error', status, body: { error } });
      expect(h.store).toEqual({});
    }
  });

  it('command sends exactly the rebuilt frame, and 409s when not connected', async () => {
    const h = harness();
    await h.manager.create(SCOPE);
    const socket = h.sockets[0] as FakeSocket;
    expect(await h.manager.command('BCDFGHJK', { type: 'kick', githubId: 5 })).toEqual({ status: 409, body: { error: 'share_not_connected' } });

    socket.open();
    socket.deliver({ type: 'room', snapshot: snapshot('BCDFGHJK') });
    const extra = { type: 'admit', githubId: 5, contributor: true, hostToken: 'x', data: {} } as never;
    expect(await h.manager.command('BCDFGHJK', extra)).toEqual({ status: 202, body: { ok: true } });
    expect(await h.manager.command('BCDFGHJK', { type: 'set-contributor', githubId: 5, contributor: false })).toEqual({ status: 202, body: { ok: true } });
    expect(socket.sent).toEqual([
      '{"type":"admit","githubId":5,"contributor":true}',
      '{"type":"set-contributor","githubId":5,"contributor":false}',
    ]);
    expect(await h.manager.command('LMNPQRST', { type: 'kick', githubId: 5 })).toEqual({ status: 404, body: { error: 'share_not_found' } });
  });

  it('keeps the latest error frame as lastError', async () => {
    const h = harness();
    const socket = await createConnected(h);
    socket.deliver({ type: 'error', code: 'unknown_participant', githubId: 7 });
    const [view] = await h.manager.list();
    expect(view?.lastError).toEqual({ code: 'unknown_participant', githubId: 7, at: '2026-11-02T00:00:00.000Z' });
  });

  it('close 4004 removes the record; close 1006 reconnects after 1 s (ac3)', async () => {
    const ended = harness();
    (await createConnected(ended)).drop(4004);
    expect(await ended.manager.list()).toEqual([]);
    expect(ended.store).toEqual({});

    const dropped = harness();
    const first = await createConnected(dropped);
    first.drop(1006);
    const [view] = await dropped.manager.list();
    expect(view).toMatchObject({ shortCode: 'BCDFGHJK', connection: 'reconnecting' });
    expect(Object.keys(dropped.store)).toEqual(['BCDFGHJK']);
    await vi.advanceTimersByTimeAsync(999);
    expect(dropped.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(dropped.sockets).toHaveLength(2);
    const second = dropped.sockets[1] as FakeSocket;
    expect(second.url).toBe(first.url);
    expect(second.headers).toEqual({ Authorization: `Bearer ${hostToken(1)}` });
  });

  it('close 4008 records lastError replaced and keeps the record', async () => {
    const h = harness();
    (await createConnected(h)).drop(4008);
    const [view] = await h.manager.list();
    expect(view).toMatchObject({ connection: 'disconnected', lastError: { code: 'replaced' } });
    expect(Object.keys(h.store)).toEqual(['BCDFGHJK']);
  });

  it('close 4008 does not reconnect', async () => {
    const h = harness();
    (await createConnected(h)).drop(4008);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sockets).toHaveLength(1);
    expect((await h.manager.list())[0]?.connection).toBe('disconnected');
  });

  it('an unexpected 404 at the upgrade removes the record; a 500 reconnects', async () => {
    const gone = harness();
    await gone.manager.create(SCOPE);
    (gone.sockets[0] as FakeSocket).emit('unexpected-response', {}, { statusCode: 404 });
    expect(await gone.manager.list()).toEqual([]);
    expect((gone.sockets[0] as FakeSocket).terminated).toBe(true);

    const flaky = harness();
    await flaky.manager.create(SCOPE);
    (flaky.sockets[0] as FakeSocket).emit('unexpected-response', {}, { statusCode: 500 });
    expect(await flaky.manager.list()).toMatchObject([{ connection: 'reconnecting' }]);
    expect((flaky.sockets[0] as FakeSocket).terminated).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(flaky.sockets).toHaveLength(2);
  });

  it('backs off 1, 2, 4, 8, 15, 30, 30 s and resets after a room frame', async () => {
    const h = harness();
    await createConnected(h);
    const schedule = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 30_000];
    expect(SHARE_RECONNECT_DELAYS_MS).toEqual(schedule.slice(0, 6));
    for (const [i, delay] of schedule.entries()) {
      (h.sockets.at(-1) as FakeSocket).drop(1006);
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(h.sockets).toHaveLength(i + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.sockets).toHaveLength(i + 2);
    }
    const newest = h.sockets.at(-1) as FakeSocket;
    newest.open();
    newest.deliver({ type: 'room', snapshot: snapshot('BCDFGHJK') });
    expect((await h.manager.list())[0]?.connection).toBe('connected');
    newest.drop(1006);
    await vi.advanceTimersByTimeAsync(999);
    expect(h.sockets).toHaveLength(8);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sockets).toHaveLength(9);
  });

  it('a 404 on a reconnect attempt removes the record and stops', async () => {
    const h = harness();
    (await createConnected(h)).drop(1006);
    await vi.advanceTimersByTimeAsync(1000);
    (h.sockets[1] as FakeSocket).emit('unexpected-response', {}, { statusCode: 404 });
    expect(await h.manager.list()).toEqual([]);
    expect(h.store).toEqual({});
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sockets).toHaveLength(2);
  });

  it('end and stop cancel a pending reconnect', async () => {
    const ended = harness();
    (await createConnected(ended)).drop(1006);
    expect(await ended.manager.end('BCDFGHJK')).toEqual({ status: 204 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ended.sockets).toHaveLength(1);

    const stopped = harness();
    (await createConnected(stopped)).drop(1006);
    stopped.manager.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(stopped.sockets).toHaveLength(1);
    expect(Object.keys(stopped.store)).toEqual(['BCDFGHJK']);
  });

  it('late events from a replaced socket change nothing', async () => {
    const h = harness();
    const old = await createConnected(h);
    old.drop(1006);
    await vi.advanceTimersByTimeAsync(1000);
    const fresh = h.sockets[1] as FakeSocket;
    fresh.open();
    fresh.deliver({ type: 'room', snapshot: snapshot('BCDFGHJK') });

    old.drop(4004);
    old.emit('error', new Error('late'));
    old.deliver({ type: 'room', snapshot: snapshot('BCDFGHJK', { hostConnected: false }) });

    expect(await h.manager.list()).toMatchObject([{ connection: 'connected', snapshot: snapshot('BCDFGHJK') }]);
    expect(Object.keys(h.store)).toEqual(['BCDFGHJK']);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sockets).toHaveLength(2);
  });

  it('pings every 30 s and terminates after 75 s without a pong (ac4)', async () => {
    const h = harness();
    const socket = await createConnected(h);

    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS);
    expect(socket.pings).toBe(1);
    socket.emit('pong');
    await vi.advanceTimersByTimeAsync(PONG_TIMEOUT_MS - 1);
    expect(socket.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.terminated).toBe(true);
    const [view] = await h.manager.list();
    expect(view?.connection).toBe('reconnecting');
    expect(Object.keys(h.store)).toEqual(['BCDFGHJK']);
  });

  it('end deletes the room with the host token, closes the socket and removes the record', async () => {
    const h = harness();
    const socket = await createConnected(h);
    expect(await h.manager.end('BCDFGHJK')).toEqual({ status: 204 });
    expect(h.deleteRoom).toHaveBeenCalledWith(BASE, 'BCDFGHJK', hostToken(1));
    expect(socket.closedWith).toBe(1000);
    expect(h.store).toEqual({});
    expect(await h.manager.end('BCDFGHJK')).toEqual({ status: 404, body: { error: 'share_not_found' } });
  });

  it('end keeps the record and answers 502 when the share service fails', async () => {
    const h = harness();
    await createConnected(h);
    h.deleteRoom.mockResolvedValueOnce({ ok: false, status: 503, error: 'internal_error' } as never);
    expect(await h.manager.end('BCDFGHJK')).toEqual({ status: 502, body: { error: 'share_service_error', message: 'internal_error' } });
    expect(Object.keys(h.store)).toEqual(['BCDFGHJK']);
  });

  it('end forgets a reconnecting share locally when the share service fails', async () => {
    const h = harness();
    (await createConnected(h)).drop(1006);
    h.deleteRoom.mockResolvedValueOnce({ ok: false, status: 503, error: 'internal_error' } as never);
    expect(await h.manager.end('BCDFGHJK')).toEqual({ status: 204 });
    expect(h.store).toEqual({});
    expect(await h.manager.list()).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sockets).toHaveLength(1);
  });

  it('end forgets a stale record locally when the share URL is invalid', async () => {
    const h = harness({ readShareUrl: async () => ({ error: 'bad' }) });
    h.store.VWXZ2345 = storedRecord('VWXZ2345', 9, 'conv-z');
    expect(await h.manager.end('VWXZ2345')).toEqual({ status: 204 });
    expect(h.store).toEqual({});
    expect(h.deleteRoom).not.toHaveBeenCalled();
  });

  it('end works on a stale record with no host socket', async () => {
    const h = harness();
    h.store.VWXZ2345 = { scopeKind: 'conversation', scopeId: 'conv-z', hostToken: hostToken(9), joinUrl: `${BASE}/s/VWXZ2345`, createdAt: '2026-11-01T00:00:00.000Z' };
    expect(await h.manager.list()).toEqual([
      {
        shortCode: 'VWXZ2345',
        joinUrl: `${BASE}/s/VWXZ2345`,
        scope: { kind: 'conversation', conversationId: 'conv-z' },
        createdAt: '2026-11-01T00:00:00.000Z',
        connection: 'disconnected',
        snapshot: null,
        lastError: null,
        drafts: [],
        queue: { agentWorking: false, delivering: false, items: [] },
      },
    ]);
    expect(await h.manager.end('VWXZ2345')).toEqual({ status: 204 });
    expect(h.store).toEqual({});
  });

  it('resume opens one host socket per record with that record\'s host token and answers their codes', async () => {
    const readAccount = vi.fn(async () => ACCOUNT);
    const h = harness({ readAccount });
    h.store.VWXZ2345 = storedRecord('VWXZ2345', 7, 'conv-z');
    h.store.LMNPQRST = storedRecord('LMNPQRST', 8, 'conv-y');

    expect((await h.manager.resume()).sort()).toEqual(['LMNPQRST', 'VWXZ2345']);
    expect(h.sockets.map((socket) => [socket.url, socket.headers.Authorization]).sort()).toEqual([
      ['wss://share.overdeck.ai/v1/rooms/LMNPQRST/host?v=1', `Bearer ${hostToken(8)}`],
      ['wss://share.overdeck.ai/v1/rooms/VWXZ2345/host?v=1', `Bearer ${hostToken(7)}`],
    ]);
    expect(readAccount).not.toHaveBeenCalled();
  });

  it('resume skips codes this process already hosts', async () => {
    const h = harness();
    await createConnected(h);
    expect(await h.manager.resume()).toEqual([]);
    expect(h.sockets).toHaveLength(1);
  });

  it('resume answers [] and opens nothing for an invalid share URL or an unreadable record file', async () => {
    const badUrl = harness({ readShareUrl: async () => ({ error: 'anywhere.share_url is not a URL' }) });
    badUrl.store.VWXZ2345 = storedRecord('VWXZ2345', 7, 'conv-z');
    expect(await badUrl.manager.resume()).toEqual([]);
    expect(badUrl.sockets).toHaveLength(0);

    const unreadable = harness();
    unreadable.deps.records.read = async () => { throw new Error('EACCES'); };
    expect(await unreadable.manager.resume()).toEqual([]);
    expect(unreadable.sockets).toHaveLength(0);
  });

  it('resume terminates the socket and keeps the record when building the hub throws', async () => {
    const h = harness({ createHub: () => { throw new Error('hub failed'); } });
    h.store.VWXZ2345 = storedRecord('VWXZ2345', 7, 'conv-z');
    expect(await h.manager.resume()).toEqual([]);
    expect(h.sockets).toHaveLength(1);
    expect(h.sockets[0]?.terminated).toBe(true);
    expect(Object.keys(h.store)).toEqual(['VWXZ2345']);
    expect(await h.manager.list()).toMatchObject([{ shortCode: 'VWXZ2345', connection: 'disconnected' }]);
  });

  it('a re-parked share is connecting, then connected after its room frame', async () => {
    const h = harness();
    h.store.VWXZ2345 = storedRecord('VWXZ2345', 7, 'conv-z');
    await h.manager.resume();
    expect(await h.manager.list()).toMatchObject([{ shortCode: 'VWXZ2345', connection: 'connecting' }]);
    const socket = h.sockets[0] as FakeSocket;
    socket.open();
    socket.deliver({ type: 'room', snapshot: snapshot('VWXZ2345') });
    expect(await h.manager.list()).toMatchObject([{ shortCode: 'VWXZ2345', connection: 'connected', snapshot: snapshot('VWXZ2345') }]);
  });

  it('list never contains a host token (ac5)', async () => {
    const h = harness();
    await createConnected(h);
    await h.manager.create({ kind: 'conversation', conversationId: 'conv-b' });
    h.store.VWXZ2345 = { scopeKind: 'conversation', scopeId: 'conv-z', hostToken: hostToken(9), joinUrl: `${BASE}/s/VWXZ2345`, createdAt: '2026-11-01T00:00:00.000Z' };
    const views = await h.manager.list();
    expect(views).toHaveLength(3);
    expect(views[0]?.shortCode).toBe('VWXZ2345');
    expect(JSON.stringify(views)).not.toMatch(/odh_[0-9a-f]{64}/);
  });
});

/** Records every call the manager makes on its hub. */
class FakeHub implements HostHub {
  readonly calls: Array<[string, ...unknown[]]> = [];
  drafts: ShareDraftView[] = [];
  queue: ShareQueueView = { agentWorking: false, delivering: false, items: [] };
  sendResult: ControllerSendResult = { ok: true, position: 1 };
  /** The effective controller the hub reports; null = before the first snapshot (PAN-4478). */
  controller: number | null = null;
  readonly admitted = new Set<number>();
  constructor(readonly ctx: PeerHubContext, private readonly socketSent: () => number) {}
  admit(githubId: number): void {
    this.calls.push(['admit', githubId, this.socketSent()]);
  }
  remove(githubId: number): void {
    this.calls.push(['remove', githubId]);
  }
  onSnapshot(value: RoomSnapshot): void {
    this.calls.push(['onSnapshot', value]);
  }
  onSignal(githubId: number, data: SignalData): void {
    this.calls.push(['onSignal', githubId, data]);
  }
  onIceServers(iceServers: readonly IceServer[]): void {
    this.calls.push(['onIceServers', iceServers]);
  }
  onIceServersUnavailable(): void {
    this.calls.push(['onIceServersUnavailable']);
  }
  draftsView(): ShareDraftView[] {
    return this.drafts;
  }
  queueView(): ShareQueueView {
    return this.queue;
  }
  sendFromController(input: SendSharePromptRequest, controller: ShareIdentity | null): ControllerSendResult {
    this.calls.push(['sendFromController', input, controller]);
    return this.sendResult;
  }
  controllerGithubId(): number | null {
    return this.controller;
  }
  isHostAdmitted(githubId: number): boolean {
    return this.admitted.has(githubId);
  }
  appoint(githubId: number): void {
    this.calls.push(['appoint', githubId]);
  }
  close(): void {
    this.calls.push(['close']);
  }
  count(name: string): number {
    return this.calls.filter(([call]) => call === name).length;
  }
}

describe('ShareManager WebRTC hub wiring (PAN-4474)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function hubHarness() {
    const hubs: FakeHub[] = [];
    let h: Harness | null = null;
    h = harness({
      createHub: (ctx) => {
        const hub = new FakeHub(ctx, () => (h?.sockets.at(-1)?.sent.length ?? 0));
        hubs.push(hub);
        return hub;
      },
    });
    return { h, hubs, hub: () => hubs.at(-1) as FakeHub };
  }

  it('creates one hub per created share with its scope and short code', async () => {
    const { h, hubs } = hubHarness();
    await createConnected(h);
    await h.manager.create({ kind: 'conversation', conversationId: 'conv-b' });
    expect(hubs.map((hub) => [hub.ctx.shortCode, hub.ctx.scope])).toEqual([
      ['BCDFGHJK', SCOPE],
      ['LMNPQRST', { kind: 'conversation', conversationId: 'conv-b' }],
    ]);
  });

  it('routes room, signal and ice-servers frames to the hub', async () => {
    const { h, hub } = hubHarness();
    const socket = await createConnected(h);
    const data: SignalData = { sdp: { type: 'answer', sdp: 'answer-sdp' } };
    socket.deliver({ type: 'signal', githubId: 7, data });
    socket.deliver({ type: 'ice-servers', iceServers: [{ urls: ['stun:x'] }] });
    socket.emit('message', Buffer.from(JSON.stringify({ type: 'signal', githubId: '7', data })), false);
    expect(hub().calls).toEqual([
      ['onSnapshot', snapshot('BCDFGHJK')],
      ['onSignal', 7, data],
      ['onIceServers', [{ urls: ['stun:x'] }]],
    ]);
  });

  it('tells the hub that TURN is unavailable and still records lastError', async () => {
    const { h, hub } = hubHarness();
    const socket = await createConnected(h);
    socket.deliver({ type: 'error', code: 'turn_unavailable' });
    expect(hub().count('onIceServersUnavailable')).toBe(1);
    const [view] = await h.manager.list();
    expect(view?.lastError).toMatchObject({ code: 'turn_unavailable' });
  });

  it('calls admit after the frame was sent, remove for kick and revoke, and nothing else', async () => {
    const { h, hub } = hubHarness();
    await createConnected(h);
    await h.manager.command('BCDFGHJK', { type: 'admit', githubId: 7 });
    await h.manager.command('BCDFGHJK', { type: 'set-contributor', githubId: 7, contributor: true });
    await h.manager.command('BCDFGHJK', { type: 'unrevoke', githubId: 8 });
    await h.manager.command('BCDFGHJK', { type: 'kick', githubId: 7 });
    await h.manager.command('BCDFGHJK', { type: 'revoke', githubId: 9 });
    expect(hub().calls.slice(1)).toEqual([
      ['admit', 7, 1],
      ['remove', 7],
      ['remove', 9],
    ]);
  });

  it('sends hub frames as JSON while connected and refuses them after the socket closes', async () => {
    const { h, hub } = hubHarness();
    const socket = await createConnected(h);
    expect(hub().ctx.sendFrame({ type: 'ice-servers' })).toBe(true);
    expect(socket.sent).toEqual([JSON.stringify({ type: 'ice-servers' })]);
    socket.drop(1006);
    expect(hub().ctx.sendFrame({ type: 'ice-servers' })).toBe(false);
    expect(socket.sent).toHaveLength(1);
  });

  it('keeps the hub on close 1006 and closes it once on close 4004', async () => {
    const { h, hub } = hubHarness();
    const socket = await createConnected(h);
    socket.drop(1006);
    expect(hub().count('close')).toBe(0);

    const second = hubHarness();
    const other = await createConnected(second.h);
    other.drop(4004);
    expect(second.hub().count('close')).toBe(1);
  });

  it('keeps one hub across a reconnect and routes the new socket\'s room frame to it', async () => {
    const { h, hubs, hub } = hubHarness();
    (await createConnected(h)).drop(1006);
    await vi.advanceTimersByTimeAsync(1000);
    const fresh = h.sockets[1] as FakeSocket;
    fresh.open();
    fresh.deliver({ type: 'room', snapshot: snapshot('BCDFGHJK', { participants: [] }) });
    expect(hubs).toHaveLength(1);
    expect(hub().count('close')).toBe(0);
    expect(hub().count('onSnapshot')).toBe(2);
  });

  it('sends hub frames on the new socket after a reconnect', async () => {
    const { h, hub } = hubHarness();
    const old = await createConnected(h);
    old.drop(1006);
    expect(hub().ctx.sendFrame({ type: 'ice-servers' })).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    const fresh = h.sockets[1] as FakeSocket;
    fresh.open();
    fresh.deliver({ type: 'room', snapshot: snapshot('BCDFGHJK') });
    expect(hub().ctx.sendFrame({ type: 'ice-servers' })).toBe(true);
    expect(fresh.sent).toEqual([JSON.stringify({ type: 'ice-servers' })]);
    expect(old.sent).toEqual([]);
  });

  it('the first room frame after resume admits every admitted participant once before onSnapshot', async () => {
    const { h, hub } = hubHarness();
    h.store.VWXZ2345 = storedRecord('VWXZ2345', 7, 'conv-z');
    await h.manager.resume();
    const socket = h.sockets[0] as FakeSocket;
    socket.open();
    const room = snapshot('VWXZ2345', { participants: [participant(100, 'admitted'), participant(101, 'admitted'), participant(102, 'lobby')] });
    socket.deliver({ type: 'room', snapshot: room });
    socket.deliver({ type: 'room', snapshot: room });
    expect(hub().calls.map(([name, id]) => (name === 'admit' ? `admit:${String(id)}` : name))).toEqual([
      'admit:100',
      'admit:101',
      'onSnapshot',
      'onSnapshot',
    ]);
  });

  it('a created share and a same-process reconnect never seed the hub', async () => {
    const { h, hub } = hubHarness();
    await h.manager.create(SCOPE);
    const first = h.sockets[0] as FakeSocket;
    first.open();
    const room = snapshot('BCDFGHJK', { participants: [participant(100, 'admitted')] });
    first.deliver({ type: 'room', snapshot: room });
    first.drop(1006);
    await vi.advanceTimersByTimeAsync(1000);
    const second = h.sockets[1] as FakeSocket;
    second.open();
    second.deliver({ type: 'room', snapshot: room });
    expect(hub().count('admit')).toBe(0);
    expect(hub().count('onSnapshot')).toBe(2);
  });

  it('closes the hub once on end and on stop', async () => {
    const ended = hubHarness();
    await createConnected(ended.h);
    expect(await ended.h.manager.end('BCDFGHJK')).toEqual({ status: 204 });
    expect(ended.hub().count('close')).toBe(1);

    const stopped = hubHarness();
    await createConnected(stopped.h);
    stopped.h.manager.stop();
    stopped.h.manager.stop();
    expect(stopped.hub().count('close')).toBe(1);
  });
});

describe('ShareManager prompts (PAN-4476)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function promptHarness() {
    const hubs: FakeHub[] = [];
    const h = harness({
      createHub: (ctx) => {
        const hub = new FakeHub(ctx, () => 0);
        hubs.push(hub);
        return hub;
      },
    });
    return { h, hub: () => hubs.at(-1) as FakeHub };
  }

  it('lists the hub drafts and queue in each view', async () => {
    const { h, hub } = promptHarness();
    await createConnected(h);
    const draft: ShareDraftView = {
      githubId: 7,
      login: 'alice',
      avatarUrl: 'https://a/7',
      text: 'hi',
      startedAt: '2026-11-02T00:00:00.000Z',
      updatedAt: '2026-11-02T00:00:01.000Z',
    };
    hub().drafts = [draft];
    hub().queue = {
      agentWorking: true,
      delivering: false,
      items: [{ id: 'controller-1', login: 'owner', avatarUrl: 'https://a/1', source: 'controller', text: 'Go', enqueuedAt: '2026-11-02T00:00:00.000Z' }],
    };
    const [view] = await h.manager.list();
    expect(view?.drafts).toEqual([draft]);
    expect(view?.queue).toEqual(hub().queue);
  });

  it('maps hub outcomes to 202, 400 and 429 and credits the data owner', async () => {
    const { h, hub } = promptHarness();
    await createConnected(h);
    expect(await h.manager.sendPrompt('BCDFGHJK', { text: 'Go', draftGithubId: 7 })).toEqual({ status: 202, body: { ok: true, position: 1 } });
    expect(hub().calls.at(-1)).toEqual(['sendFromController', { text: 'Go', draftGithubId: 7 }, snapshot('BCDFGHJK').dataOwner]);
    hub().sendResult = { ok: false, reason: 'invalid_prompt' };
    expect(await h.manager.sendPrompt('BCDFGHJK', { text: '/clear' })).toEqual({ status: 400, body: { error: 'invalid_prompt' } });
    hub().sendResult = { ok: false, reason: 'too_long' };
    expect(await h.manager.sendPrompt('BCDFGHJK', { text: 'x' })).toEqual({ status: 400, body: { error: 'too_long' } });
    hub().sendResult = { ok: false, reason: 'queue_full' };
    expect(await h.manager.sendPrompt('BCDFGHJK', { text: 'x' })).toEqual({ status: 429, body: { error: 'queue_full' } });
  });

  it('answers 404 for an unknown code and 409 for a share with no host entry', async () => {
    const { h } = promptHarness();
    expect(await h.manager.sendPrompt('BCDFGHJK', { text: 'Go' })).toEqual({ status: 404, body: { error: 'share_not_found' } });
    h.store.VWXZ2345 = { scopeKind: 'conversation', scopeId: 'conv-z', hostToken: hostToken(9), joinUrl: `${BASE}/s/VWXZ2345`, createdAt: '2026-11-01T00:00:00.000Z' };
    expect(await h.manager.sendPrompt('VWXZ2345', { text: 'Go' })).toEqual({ status: 409, body: { error: 'share_not_live' } });
  });
});

describe('ShareManager controller gate (PAN-4478)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const BOB = { githubId: 200, login: 'bob', avatarUrl: 'https://a/200' };
  const bobAdmitted = { ...BOB, state: 'admitted' as const, contributor: false, connected: true };

  function gateHarness() {
    const hubs: FakeHub[] = [];
    const h = harness({
      createHub: (ctx) => {
        const hub = new FakeHub(ctx, () => 0);
        hubs.push(hub);
        return hub;
      },
    });
    return { h, hub: () => hubs.at(-1) as FakeHub };
  }

  /** A connected share whose snapshot lists bob as admitted and controller, and whose hub agrees. */
  async function bobControls() {
    const g = gateHarness();
    const socket = await createConnected(g.h);
    socket.deliver({ type: 'room', snapshot: snapshot('BCDFGHJK', { participants: [bobAdmitted], controllerGithubId: BOB.githubId }) });
    g.hub().admitted.add(BOB.githubId);
    g.hub().controller = BOB.githubId;
    return { ...g, socket };
  }

  it('answers 409 not_controller for owner commands and prompts while a viewer controls', async () => {
    const { h, hub, socket } = await bobControls();
    const sent = socket.sent.length;
    const refused = { status: 409, body: { error: 'not_controller', message: 'Another participant has control. Reclaim control first.' } };
    expect(await h.manager.command('BCDFGHJK', { type: 'kick', githubId: BOB.githubId })).toEqual(refused);
    expect(await h.manager.command('BCDFGHJK', { type: 'unrevoke', githubId: 9 })).toEqual(refused);
    expect(await h.manager.sendPrompt('BCDFGHJK', { text: 'Go' })).toEqual(refused);
    expect(socket.sent).toHaveLength(sent);
    expect(hub().count('remove')).toBe(0);
    expect(hub().count('sendFromController')).toBe(0);
  });

  it('always accepts reclaim and mirrors it to hub.appoint', async () => {
    const { h, hub, socket } = await bobControls();
    expect(await h.manager.command('BCDFGHJK', { type: 'set-controller', githubId: OWNER.githubId })).toEqual({ status: 202, body: { ok: true } });
    expect(JSON.parse(socket.sent.at(-1) as string)).toEqual({ type: 'set-controller', githubId: OWNER.githubId });
    expect(hub().calls.at(-1)).toEqual(['appoint', OWNER.githubId]);
  });

  it('hands control to a host-admitted participant and mirrors it to hub.appoint', async () => {
    const g = gateHarness();
    const socket = await createConnected(g.h);
    socket.deliver({ type: 'room', snapshot: snapshot('BCDFGHJK', { participants: [bobAdmitted] }) });
    g.hub().admitted.add(BOB.githubId);
    g.hub().controller = OWNER.githubId;
    expect(await g.h.manager.command('BCDFGHJK', { type: 'set-controller', githubId: BOB.githubId })).toEqual({ status: 202, body: { ok: true } });
    expect(JSON.parse(socket.sent.at(-1) as string)).toEqual({ type: 'set-controller', githubId: BOB.githubId });
    expect(g.hub().calls.at(-1)).toEqual(['appoint', BOB.githubId]);
  });

  it('refuses set-controller to a participant the hub never admitted with unknown_participant', async () => {
    const g = gateHarness();
    const socket = await createConnected(g.h);
    socket.deliver({ type: 'room', snapshot: snapshot('BCDFGHJK', { participants: [bobAdmitted] }) });
    g.hub().controller = OWNER.githubId;
    const sent = socket.sent.length;
    expect(await g.h.manager.command('BCDFGHJK', { type: 'set-controller', githubId: BOB.githubId })).toEqual({
      status: 409,
      body: { error: 'unknown_participant', message: 'That person is not in the room.' },
    });
    expect(socket.sent).toHaveLength(sent);
    expect(g.hub().count('appoint')).toBe(0);
  });

  it('views carry the hub\'s controllerGithubId', async () => {
    const { h, hub } = await bobControls();
    expect((await h.manager.list())[0]?.controllerGithubId).toBe(BOB.githubId);
    hub().controller = OWNER.githubId;
    expect((await h.manager.list())[0]?.controllerGithubId).toBe(OWNER.githubId);
  });
});
