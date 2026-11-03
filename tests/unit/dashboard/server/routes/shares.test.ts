/**
 * PAN-4473 WI-5: /api/shares routes — create answers 201 with the join link and 200 on a repeat,
 * unknown and read-only conversations are refused, command bodies are validated, end answers 204,
 * an uncredentialed LAN peer is stopped by the remote gate, and no response ever carries a host
 * token. The share manager runs on fakes (no share service, no sockets); conversations are faked.
 */
import { EventEmitter } from 'node:events';
import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { CreateRoomResponse } from '@overdeck/contracts';

import { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } from '../../../../../src/lib/internal-token.js';
import { invalidateRemoteAccessConfig } from '../../../../../src/lib/remote-access/config.js';
import type { ShareRecord } from '../../../../../src/lib/sharing/share-record.js';
import { remoteRequestGateLayer } from '../../../../../src/dashboard/server/remote-request-gate.js';
import { sharesRouteLayer } from '../../../../../src/dashboard/server/routes/shares.js';
import { _resetDashboardSessionTokenForTests } from '../../../../../src/dashboard/server/routes/dashboard-auth.js';
import { ShareManager, setShareManagerForTests, type ShareManagerDeps, type ShareSocket } from '../../../../../src/dashboard/server/services/share-host.js';
import type { HostHub, PeerHubContext } from '../../../../../src/dashboard/server/sharing/peer-hub.js';

const mocks = vi.hoisted(() => ({ byName: vi.fn() }));

vi.mock('../../../../../src/lib/overdeck/conversations.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getConversationByName: mocks.byName,
}));

const INTERNAL = 'shares-internal-token';
const BASE = 'https://share.overdeck.ai';
const HOST_TOKEN_RE = /odh_[0-9a-f]{64}/;
const OWNER = { githubId: 1, login: 'owner', avatarUrl: 'https://avatars.githubusercontent.com/u/1' };
let home: string;
const originalHome = process.env.OVERDECK_HOME;
const bodies: string[] = [];

class FakeSocket extends EventEmitter implements ShareSocket {
  readyState: number = WebSocket.CONNECTING;
  readonly sent: string[] = [];
  override on(event: string, listener: (...args: never[]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }
  send(data: string): void { this.sent.push(data); }
  ping(): void {}
  close(): void { this.readyState = WebSocket.CLOSED; }
  terminate(): void { this.readyState = WebSocket.CLOSED; }
}

let sockets: FakeSocket[];
let store: Record<string, ShareRecord>;
let signedIn: boolean;

function fakeManager(createHub?: (ctx: PeerHubContext) => HostHub): ShareManager {
  const deps: ShareManagerDeps = {
    readAccount: async () => (signedIn
      ? { v: 1, baseUrl: 'https://overdeck.ai', accessToken: `odd_${'a'.repeat(64)}`, deviceId: 'd', label: 'desk', githubLogin: 'owner', githubId: 1, signedInAt: '2026-11-01T00:00:00.000Z' }
      : null),
    readShareUrl: async () => ({ url: BASE }),
    createRoom: (async (_base: string, _token: string, scope: CreateRoomResponse['snapshot']['scope']) => ({
      ok: true,
      room: {
        shortCode: 'BCDFGHJK',
        hostToken: `odh_${'c'.repeat(64)}`,
        joinUrl: `${BASE}/s/BCDFGHJK`,
        snapshot: { shortCode: 'BCDFGHJK', scope, dataOwner: OWNER, controllerGithubId: 1, hostConnected: false, participants: [], blocked: [] },
      },
    })) as unknown as ShareManagerDeps['createRoom'],
    deleteRoom: (async () => ({ ok: true })) as unknown as ShareManagerDeps['deleteRoom'],
    records: {
      read: async () => ({ ...store }),
      put: async (code, record) => { store[code] = record; },
      remove: async (code) => { const had = code in store; delete store[code]; return had; },
    },
    openSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    now: () => new Date('2026-11-02T00:00:00.000Z'),
    ...(createHub ? { createHub } : {}),
  };
  return new ShareManager(deps);
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4473-shares-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = INTERNAL;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  invalidateRemoteAccessConfig();
  sockets = [];
  store = {};
  signedIn = true;
  mocks.byName.mockReset().mockImplementation((name: string) => {
    if (name === 'conv-a') return { name, origin: 'local', releasedTo: null };
    if (name === 'conv-released') return { name, origin: 'local', releasedTo: '00000000-0000-4000-8000-0000000000bb' };
    return null;
  });
  setShareManagerForTests(fakeManager());
});

afterEach(async () => {
  setShareManagerForTests(null);
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

async function call(
  method: string,
  path: string,
  body?: unknown,
  opts: { credential?: boolean; peer?: string; layer?: Layer.Layer<never, never, never> } = {},
) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.credential !== false) headers[INTERNAL_TOKEN_HEADER] = INTERNAL;
  const request = HttpServerRequest.fromWeb(new Request(`http://127.0.0.1${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })).modify({ remoteAddress: opts.peer ? Option.some(opts.peer) : Option.none() });
  const response = await Effect.runPromise(Effect.scoped(
    Effect.flatMap(HttpRouter.toHttpEffect(opts.layer ?? sharesRouteLayer), (app) =>
      Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)),
  ));
  const raw = (response.body as { body?: Uint8Array } | null)?.body;
  const text = raw ? new TextDecoder().decode(raw) : '';
  bodies.push(text);
  return { status: response.status, headers: response.headers, text, body: (text ? JSON.parse(text) : null) as Record<string, any> | null };
}

async function connect(): Promise<void> {
  const socket = sockets.at(-1) as FakeSocket;
  socket.readyState = WebSocket.OPEN;
  socket.emit('open');
  const snapshot = { shortCode: 'BCDFGHJK', scope: { kind: 'conversation', conversationId: 'conv-a' }, dataOwner: OWNER, controllerGithubId: 1, hostConnected: true, participants: [], blocked: [] };
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'room', snapshot })), false);
}

describe('/api/shares (PAN-4473)', () => {
  it('creates a share with a join link, and a repeat answers 200 with the same code (ac1)', async () => {
    const created = await call('POST', '/api/shares', { conversationName: 'conv-a' });
    expect(created.status).toBe(201);
    expect(created.headers['cache-control']).toBe('no-store');
    expect(created.body?.joinUrl).toMatch(/\/s\/BCDFGHJK$/);
    expect(created.body).toMatchObject({ shortCode: 'BCDFGHJK', scope: { kind: 'conversation', conversationId: 'conv-a' }, connection: 'connecting' });
    expect(created.body).not.toHaveProperty('hostToken');

    const again = await call('POST', '/api/shares', { conversationName: 'conv-a' });
    expect(again.status).toBe(200);
    expect(again.body?.shortCode).toBe('BCDFGHJK');

    const listed = await call('GET', '/api/shares');
    expect(listed.status).toBe(200);
    expect(listed.headers['cache-control']).toBe('no-store');
    expect(listed.body?.shares).toHaveLength(1);
  });

  it('400s a bad body, 404s an unknown conversation and 409s a released one (ac2)', async () => {
    expect(await call('POST', '/api/shares', {})).toMatchObject({ status: 400, body: { error: 'invalid_request' } });
    expect(await call('POST', '/api/shares', { conversationName: 7 })).toMatchObject({ status: 400 });
    expect(await call('POST', '/api/shares', { conversationName: 'x'.repeat(201) })).toMatchObject({ status: 400 });
    expect(await call('POST', '/api/shares', { conversationName: 'nope' })).toMatchObject({ status: 404, body: { error: 'conversation_not_found' } });
    expect(await call('POST', '/api/shares', { conversationName: '@env/conv-a' })).toMatchObject({ status: 404 });
    expect(await call('POST', '/api/shares', { conversationName: 'conv-released' })).toMatchObject({ status: 409, body: { code: 'conversation-released' } });
    expect(sockets).toHaveLength(0);
  });

  it('answers 412 not_signed_in without an account', async () => {
    signedIn = false;
    expect(await call('POST', '/api/shares', { conversationName: 'conv-a' })).toMatchObject({
      status: 412,
      body: { error: 'not_signed_in', message: 'Sign in with pan account login to share conversations.' },
    });
  });

  it('validates command bodies with 400 invalid_command (ac3)', async () => {
    await call('POST', '/api/shares', { conversationName: 'conv-a' });
    await connect();
    for (const bad of [
      { type: 'end' },
      { type: 'signal', githubId: 5, data: {} },
      { type: 'set-controller', githubId: 5 },
      { type: 'admit', githubId: 0 },
      { type: 'admit', githubId: 1.5 },
      { type: 'admit', githubId: 5, contributor: 'yes' },
      { type: 'set-contributor', githubId: 5 },
    ]) {
      expect(await call('POST', '/api/shares/BCDFGHJK/commands', bad)).toMatchObject({ status: 400, body: { error: 'invalid_command' } });
    }
    expect((sockets[0] as FakeSocket).sent).toEqual([]);
  });

  it('relays a valid command, normalizing the code, and 404s an unknown share', async () => {
    await call('POST', '/api/shares', { conversationName: 'conv-a' });
    expect(await call('POST', '/api/shares/BCDFGHJK/commands', { type: 'kick', githubId: 5 })).toMatchObject({ status: 409, body: { error: 'share_not_connected' } });
    await connect();
    expect(await call('POST', '/api/shares/bcdf-ghjk/commands', { type: 'admit', githubId: 5, contributor: true })).toMatchObject({ status: 202, body: { ok: true } });
    expect((sockets[0] as FakeSocket).sent).toEqual(['{"type":"admit","githubId":5,"contributor":true}']);
    expect(await call('POST', '/api/shares/LMNPQRST/commands', { type: 'kick', githubId: 5 })).toMatchObject({ status: 404 });
    expect(await call('POST', '/api/shares/nope/commands', { type: 'kick', githubId: 5 })).toMatchObject({ status: 404, body: { error: 'share_not_found' } });
  });

  it('ends a share with 204 and no body, then 404s', async () => {
    await call('POST', '/api/shares', { conversationName: 'conv-a' });
    const ended = await call('DELETE', '/api/shares/BCDFGHJK');
    expect(ended.status).toBe(204);
    expect(ended.text).toBe('');
    expect(ended.headers['cache-control']).toBe('no-store');
    expect(store).toEqual({});
    expect(await call('DELETE', '/api/shares/BCDFGHJK')).toMatchObject({ status: 404, body: { error: 'share_not_found' } });
  });

  it('401s an uncredentialed request from a non-loopback peer', async () => {
    const gated = Layer.mergeAll(remoteRequestGateLayer, sharesRouteLayer);
    const lan = { credential: false, peer: '192.0.2.44', layer: gated };
    expect((await call('GET', '/api/shares', undefined, lan)).status).toBe(401);
    expect((await call('POST', '/api/shares', { conversationName: 'conv-a' }, lan)).status).toBe(401);
    expect((await call('POST', '/api/shares/BCDFGHJK/commands', { type: 'kick', githubId: 5 }, lan)).status).toBe(401);
    expect((await call('DELETE', '/api/shares/BCDFGHJK', undefined, lan)).status).toBe(401);
    expect(sockets).toHaveLength(0);
  });

  it('no response body from any of the four routes carries a host token (ac4)', async () => {
    bodies.length = 0;
    await call('POST', '/api/shares', { conversationName: 'conv-a' });
    await call('POST', '/api/shares', { conversationName: 'conv-a' });
    await call('GET', '/api/shares');
    await connect();
    await call('GET', '/api/shares');
    await call('POST', '/api/shares/BCDFGHJK/commands', { type: 'admit', githubId: 5 });
    await call('POST', '/api/shares/BCDFGHJK/commands', { type: 'end' });
    await call('DELETE', '/api/shares/BCDFGHJK');
    await call('DELETE', '/api/shares/BCDFGHJK');
    expect(bodies).toHaveLength(8);
    for (const text of bodies) expect(text).not.toMatch(HOST_TOKEN_RE);
  });
});

/** A hub that queues every controller send at position 1. */
function stubHub(sent: unknown[]): HostHub {
  return {
    admit: () => undefined,
    remove: () => undefined,
    onSnapshot: () => undefined,
    onSignal: () => undefined,
    onIceServers: () => undefined,
    onIceServersUnavailable: () => undefined,
    draftsView: () => [],
    queueView: () => ({ agentWorking: false, delivering: false, items: [] }),
    sendFromController: (input) => {
      sent.push(input);
      return { ok: true, position: 1 };
    },
    close: () => undefined,
  };
}

describe('POST /api/shares/:code/prompts (PAN-4476)', () => {
  it('400s invalid bodies with invalid_request', async () => {
    for (const bad of [{ text: 5 }, { text: 'x', draftGithubId: 0 }, { text: 'x', draftGithubId: 1.5 }, {}]) {
      expect(await call('POST', '/api/shares/BCDFGHJK/prompts', bad)).toMatchObject({ status: 400, body: { error: 'invalid_request' } });
    }
  });

  it('404s a malformed code and 409s a share with no live hub', async () => {
    expect(await call('POST', '/api/shares/nope/prompts', { text: 'Go' })).toMatchObject({ status: 404, body: { error: 'share_not_found' } });
    await call('POST', '/api/shares', { conversationName: 'conv-a' });
    expect(await call('POST', '/api/shares/BCDFGHJK/prompts', { text: 'Go' })).toMatchObject({ status: 409, body: { error: 'share_not_live' } });
  });

  it('answers 202 with the queue position for a valid body', async () => {
    const sent: unknown[] = [];
    setShareManagerForTests(fakeManager(() => stubHub(sent)));
    await call('POST', '/api/shares', { conversationName: 'conv-a' });
    await connect();
    const answer = await call('POST', '/api/shares/bcdf-ghjk/prompts', { text: 'Go', draftGithubId: 7 });
    expect(answer).toMatchObject({ status: 202, body: { ok: true, position: 1 } });
    expect(answer.headers['cache-control']).toBe('no-store');
    expect(sent).toEqual([{ text: 'Go', draftGithubId: 7 }]);
    for (const text of bodies) expect(text).not.toMatch(HOST_TOKEN_RE);
  });

  it('401s an uncredentialed request from a non-loopback peer', async () => {
    const gated = Layer.mergeAll(remoteRequestGateLayer, sharesRouteLayer);
    const lan = { credential: false, peer: '192.0.2.44', layer: gated };
    expect((await call('POST', '/api/shares/BCDFGHJK/prompts', { text: 'Go' }, lan)).status).toBe(401);
  });
});
