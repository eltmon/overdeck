import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type {
  CreateRoomResponse,
  IceServer,
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

  it('close 4004 removes the record; close 1006 keeps it disconnected (ac3)', async () => {
    const ended = harness();
    (await createConnected(ended)).drop(4004);
    expect(await ended.manager.list()).toEqual([]);
    expect(ended.store).toEqual({});

    const dropped = harness();
    (await createConnected(dropped)).drop(1006);
    const [view] = await dropped.manager.list();
    expect(view).toMatchObject({ shortCode: 'BCDFGHJK', connection: 'disconnected' });
    expect(Object.keys(dropped.store)).toEqual(['BCDFGHJK']);
  });

  it('close 4008 records lastError replaced and keeps the record', async () => {
    const h = harness();
    (await createConnected(h)).drop(4008);
    const [view] = await h.manager.list();
    expect(view).toMatchObject({ connection: 'disconnected', lastError: { code: 'replaced' } });
    expect(Object.keys(h.store)).toEqual(['BCDFGHJK']);
  });

  it('an unexpected 404 at the upgrade removes the record; a 500 keeps it', async () => {
    const gone = harness();
    await gone.manager.create(SCOPE);
    (gone.sockets[0] as FakeSocket).emit('unexpected-response', {}, { statusCode: 404 });
    expect(await gone.manager.list()).toEqual([]);
    expect((gone.sockets[0] as FakeSocket).terminated).toBe(true);

    const flaky = harness();
    await flaky.manager.create(SCOPE);
    (flaky.sockets[0] as FakeSocket).emit('unexpected-response', {}, { statusCode: 500 });
    expect(await flaky.manager.list()).toMatchObject([{ connection: 'disconnected' }]);
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
    expect(view?.connection).toBe('disconnected');
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
