/**
 * PAN-4475 WI-5: /api/joins routes — a join intent opens the join socket for a code or a join URL,
 * bad codes and bad signals are refused, a lobby join refuses signals, an admitted join relays a
 * rebuilt answer, the event stream starts with the current state, leave answers 204, and no
 * response ever carries the device token. The join manager runs on fakes (no share service).
 */
import { EventEmitter } from 'node:events';
import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { JoinView, ServiceToViewerFrame } from '@overdeck/contracts';

import { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } from '../../../../../src/lib/internal-token.js';
import { invalidateRemoteAccessConfig } from '../../../../../src/lib/remote-access/config.js';
import { REMOTE_GATE_ALLOWLIST, remoteRequestGateLayer } from '../../../../../src/dashboard/server/remote-request-gate.js';
import { _resetDashboardSessionTokenForTests } from '../../../../../src/dashboard/server/routes/dashboard-auth.js';
import {
  formatJoinEvent,
  joinsRouteLayer,
  parseJoinTarget,
  parseSignalBody,
  probeCorsOrigin,
} from '../../../../../src/dashboard/server/routes/joins.js';
import type { ShareSocket } from '../../../../../src/dashboard/server/services/share-host.js';
import { JoinManager, setJoinManagerForTests } from '../../../../../src/dashboard/server/services/share-join.js';

const INTERNAL = 'joins-internal-token';
const BASE = 'https://share.overdeck.ai';
const CODE = 'BCDFGHJK';
const ANSWER = { sdp: { type: 'answer', sdp: 'v=0 answer' } };
let home: string;
const originalHome = process.env.OVERDECK_HOME;
const bodies: string[] = [];

class FakeSocket extends EventEmitter implements ShareSocket {
  readyState: number = WebSocket.CONNECTING;
  readonly sent: string[] = [];
  constructor(readonly url: string) {
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
  send(data: string): void { this.sent.push(data); }
  ping(): void {}
  close(): void { this.readyState = WebSocket.CLOSED; }
  terminate(): void { this.readyState = WebSocket.CLOSED; }
}

let sockets: FakeSocket[];
let signedIn: boolean;
let manager: JoinManager;

function fakeManager(): JoinManager {
  return new JoinManager({
    readAccount: async () => (signedIn
      ? { v: 1, baseUrl: 'https://overdeck.ai', accessToken: `odd_${'b'.repeat(64)}`, deviceId: 'd', label: 'laptop', githubLogin: 'alice', githubId: 100, signedInAt: '2026-11-01T00:00:00.000Z' }
      : null),
    readShareUrl: async () => ({ url: BASE }),
    openSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    now: () => Date.now(),
  });
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4475-joins-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = INTERNAL;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  invalidateRemoteAccessConfig();
  sockets = [];
  signedIn = true;
  manager = fakeManager();
  setJoinManagerForTests(manager);
});

afterEach(async () => {
  manager.stop();
  setJoinManagerForTests(null);
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

async function raw(
  method: string,
  path: string,
  body?: unknown,
  opts: { credential?: boolean; peer?: string; origin?: string; layer?: Layer.Layer<never, never, never> } = {},
): Promise<HttpServerResponse.HttpServerResponse> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.credential !== false) headers[INTERNAL_TOKEN_HEADER] = INTERNAL;
  if (opts.origin) headers.origin = opts.origin;
  const request = HttpServerRequest.fromWeb(new Request(`http://127.0.0.1${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })).modify({ remoteAddress: opts.peer ? Option.some(opts.peer) : Option.none() });
  return Effect.runPromise(Effect.scoped(
    Effect.flatMap(HttpRouter.toHttpEffect(opts.layer ?? joinsRouteLayer), (app) =>
      Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)),
  ));
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  opts: { credential?: boolean; peer?: string; origin?: string; layer?: Layer.Layer<never, never, never> } = {},
) {
  const response = await raw(method, path, body, opts);
  const bytes = (response.body as { body?: Uint8Array } | null)?.body;
  const text = bytes ? new TextDecoder().decode(bytes) : '';
  bodies.push(text);
  return { status: response.status, headers: response.headers, text, body: (text ? JSON.parse(text) : null) as Record<string, any> | null };
}

async function admit(): Promise<FakeSocket> {
  expect((await call('POST', '/api/joins', { code: CODE })).status).toBe(201);
  const socket = sockets.at(-1) as FakeSocket;
  socket.open();
  socket.deliver({ type: 'status', status: 'admitted' });
  socket.deliver({ type: 'ice-servers', iceServers: [{ urls: ['stun:stun.example:3478'] }] });
  socket.sent.length = 0;
  return socket;
}

describe('/api/joins (PAN-4475)', () => {
  it('creates a join from a dashed lowercase code and answers 201, then 200 while live', async () => {
    const created = await call('POST', '/api/joins', { code: 'bcdf-ghjk' });
    expect(created.status).toBe(201);
    expect(created.headers['cache-control']).toBe('no-store');
    expect(created.body).toMatchObject({ shortCode: CODE, joinUrl: `${BASE}/s/${CODE}`, state: 'connecting', login: 'alice' });
    expect(sockets[0]?.url).toBe(`wss://share.overdeck.ai/v1/rooms/${CODE}/join?v=1`);
    const again = await call('POST', '/api/joins', { code: CODE });
    expect(again.status).toBe(200);
    expect(sockets).toHaveLength(1);
  });

  it('accepts a join URL', async () => {
    expect((await call('POST', '/api/joins', { code: `${BASE}/s/${CODE}` })).status).toBe(201);
    expect(sockets[0]?.url).toContain(`/v1/rooms/${CODE}/join`);
  });

  it('400s an invalid code', async () => {
    expect(await call('POST', '/api/joins', { code: 'nope' })).toMatchObject({ status: 400, body: { error: 'invalid_code' } });
    expect(await call('POST', '/api/joins', {})).toMatchObject({ status: 400, body: { error: 'invalid_code' } });
    expect(sockets).toHaveLength(0);
  });

  it('answers 412 not_signed_in without an account', async () => {
    signedIn = false;
    expect(await call('POST', '/api/joins', { code: CODE })).toMatchObject({
      status: 412,
      body: { error: 'not_signed_in', message: 'Sign in with pan account login to join shared conversations.' },
    });
  });

  it('refuses a mutation without a credential or CSRF token', async () => {
    const refused = await call('POST', '/api/joins', { code: CODE }, { credential: false });
    expect([401, 403]).toContain(refused.status);
    expect(sockets).toHaveLength(0);
  });

  it('404s an unknown join', async () => {
    expect(await call('GET', '/api/joins/XXXXXXXX')).toMatchObject({ status: 404, body: { error: 'join_not_found' } });
    expect(await call('GET', `/api/joins/${CODE}`)).toMatchObject({ status: 404, body: { error: 'join_not_found' } });
    expect(await call('GET', `/api/joins/${CODE}/events`)).toMatchObject({ status: 404, body: { error: 'join_not_found' } });
    expect(await call('DELETE', `/api/joins/${CODE}`)).toMatchObject({ status: 404, body: { error: 'join_not_found' } });
    expect(await call('POST', `/api/joins/${CODE}/signal`, ANSWER)).toMatchObject({ status: 404 });
    expect(await call('POST', `/api/joins/${CODE}/ice-servers`)).toMatchObject({ status: 404 });
  });

  it('reads a join view', async () => {
    await call('POST', '/api/joins', { code: CODE });
    const got = await call('GET', '/api/joins/bcdf-ghjk');
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({ shortCode: CODE, state: 'connecting' });
  });

  it('400s an offer and 409s a valid answer in the lobby', async () => {
    await call('POST', '/api/joins', { code: CODE });
    const socket = sockets[0] as FakeSocket;
    socket.open();
    socket.deliver({ type: 'status', status: 'lobby' });
    expect(await call('POST', `/api/joins/${CODE}/signal`, { sdp: { type: 'offer', sdp: 'x' } })).toMatchObject({ status: 400, body: { error: 'invalid_signal' } });
    expect(await call('POST', `/api/joins/${CODE}/signal`, ANSWER)).toMatchObject({ status: 409, body: { error: 'join_not_admitted' } });
    expect(await call('POST', `/api/joins/${CODE}/ice-servers`)).toMatchObject({ status: 409, body: { error: 'join_not_admitted' } });
    expect(socket.sent).toEqual([]);
  });

  it('relays a rebuilt answer while admitted', async () => {
    const socket = await admit();
    const relayed = await call('POST', `/api/joins/${CODE}/signal`, { ...ANSWER, extra: 'nope', sdpx: 1 });
    expect(relayed).toMatchObject({ status: 202, body: { ok: true } });
    expect(socket.sent).toEqual([JSON.stringify({ type: 'signal', data: ANSWER })]);
  });

  it('answers the ICE servers', async () => {
    await admit();
    expect(await call('POST', `/api/joins/${CODE}/ice-servers`)).toMatchObject({
      status: 200,
      body: { iceServers: [{ urls: ['stun:stun.example:3478'] }] },
    });
  });

  it('leaves with 204 and no body', async () => {
    const socket = await admit();
    const left = await call('DELETE', `/api/joins/${CODE}`);
    expect(left.status).toBe(204);
    expect(left.text).toBe('');
    expect(left.headers['cache-control']).toBe('no-store');
    expect(socket.sent).toEqual(['{"type":"leave"}']);
  });

  it('streams the current state first and unsubscribes on cancel', async () => {
    await admit();
    const response = await raw('GET', `/api/joins/${CODE}/events`);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('text/event-stream');
    const reader = HttpServerResponse.toWeb(response).body!.getReader();
    const first = await reader.read();
    const text = new TextDecoder().decode(first.value);
    const view = manager.get(CODE) as JoinView;
    expect(text).toBe(`event: state\ndata: ${JSON.stringify(view)}\n\n`);
    await reader.cancel();
    // With no subscriber, a second subscriber is the first of its kind: no `replaced` is sent to the cancelled one.
    const events: string[] = [];
    manager.subscribe(CODE, (event) => events.push(event.type));
    expect(events).toEqual(['state']);
  });

  it('no response body carries the device token', async () => {
    bodies.length = 0;
    await admit();
    await call('GET', `/api/joins/${CODE}`);
    await call('POST', `/api/joins/${CODE}/signal`, ANSWER);
    await call('POST', `/api/joins/${CODE}/ice-servers`);
    await call('DELETE', `/api/joins/${CODE}`);
    expect(bodies.length).toBeGreaterThanOrEqual(5);
    for (const text of bodies) expect(text).not.toContain('odd_');
  });
});

describe('join route helpers', () => {
  it('parseJoinTarget takes a code or a join URL', () => {
    expect(parseJoinTarget('bcdf-ghjk')).toBe(CODE);
    expect(parseJoinTarget(`${BASE}/s/${CODE}`)).toBe(CODE);
    expect(parseJoinTarget('http://127.0.0.1:8787/s/bcdf-ghjk/')).toBe(CODE);
    expect(parseJoinTarget('nope')).toBeNull();
    expect(parseJoinTarget(`${BASE}/x/${CODE}`)).toBeNull();
    expect(parseJoinTarget(7)).toBeNull();
  });

  it('parseSignalBody rebuilds answers and candidates from known keys only', () => {
    expect(parseSignalBody({ ...ANSWER, other: 1 })).toEqual(ANSWER);
    expect(parseSignalBody({ candidate: { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'u' } }))
      .toEqual({ candidate: { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 } });
    expect(parseSignalBody({ candidate: { candidate: 'candidate:1' } })).toEqual({ candidate: { candidate: 'candidate:1' } });
    expect(parseSignalBody({ sdp: { type: 'offer', sdp: 'x' } })).toBeNull();
    expect(parseSignalBody({ sdp: { type: 'answer', sdp: 'x'.repeat(32_769) } })).toBeNull();
    expect(parseSignalBody({ candidate: { candidate: 'c', sdpMLineIndex: -1 } })).toBeNull();
    expect(parseSignalBody({ candidate: { candidate: 'c', sdpMid: 5 } })).toBeNull();
    expect(parseSignalBody({})).toBeNull();
    expect(parseSignalBody(null)).toBeNull();
  });

  it('formatJoinEvent frames the three event types', () => {
    const view: JoinView = { shortCode: CODE, joinUrl: `${BASE}/s/${CODE}`, state: 'lobby', contributor: false, login: 'alice', closeCode: null, error: null };
    expect(formatJoinEvent({ type: 'state', view })).toBe(`event: state\ndata: ${JSON.stringify(view)}\n\n`);
    expect(formatJoinEvent({ type: 'signal', data: ANSWER as never })).toBe(`event: signal\ndata: ${JSON.stringify(ANSWER)}\n\n`);
    expect(formatJoinEvent({ type: 'replaced' })).toBe('event: replaced\ndata: {}\n\n');
  });
});

describe('/api/share-probe (PAN-4475)', () => {
  const SHARE_ORIGIN = 'http://127.0.0.1:8787';

  beforeEach(async () => {
    await writeFile(join(home, 'config.yaml'), `anywhere:\n  share_url: ${SHARE_ORIGIN}\n`);
  });

  it('answers the share origin with CORS', async () => {
    const probed = await call('GET', '/api/share-probe', undefined, { credential: false, origin: SHARE_ORIGIN });
    expect(probed.status).toBe(200);
    expect(probed.body).toEqual({ overdeck: true, v: 1 });
    expect(probed.headers['access-control-allow-origin']).toBe(SHARE_ORIGIN);
    expect(probed.headers.vary).toBe('Origin');
    expect(probed.headers['cache-control']).toBe('no-store');
  });

  it('sends no CORS header to another origin or without one', async () => {
    const evil = await call('GET', '/api/share-probe', undefined, { credential: false, origin: 'https://evil.example' });
    expect(evil.status).toBe(200);
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    const none = await call('GET', '/api/share-probe', undefined, { credential: false });
    expect(none.status).toBe(200);
    expect(none.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers the Private Network Access preflight for the share origin only', async () => {
    const ok = await call('OPTIONS', '/api/share-probe', undefined, { credential: false, origin: SHARE_ORIGIN });
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe(SHARE_ORIGIN);
    expect(ok.headers['access-control-allow-private-network']).toBe('true');
    expect(ok.headers['access-control-allow-methods']).toBe('GET');
    const other = await call('OPTIONS', '/api/share-probe', undefined, { credential: false, origin: 'https://evil.example' });
    expect(other.status).toBe(204);
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
    expect(other.headers['access-control-allow-private-network']).toBeUndefined();
    expect(other.headers['access-control-allow-methods']).toBeUndefined();
  });

  it('needs no credential from a loopback peer and is not on the gate allowlist', async () => {
    const gated = Layer.mergeAll(remoteRequestGateLayer, joinsRouteLayer);
    const local = await call('GET', '/api/share-probe', undefined, { credential: false, peer: '127.0.0.1', origin: SHARE_ORIGIN, layer: gated });
    expect(local.status).toBe(200);
    expect(local.body).toEqual({ overdeck: true, v: 1 });
    expect(REMOTE_GATE_ALLOWLIST.has('GET /api/share-probe')).toBe(false);
    expect(REMOTE_GATE_ALLOWLIST.has('OPTIONS /api/share-probe')).toBe(false);
  });

  it('probeCorsOrigin matches the exact share origin', () => {
    expect(probeCorsOrigin('https://share.overdeck.ai', { url: 'https://share.overdeck.ai' })).toBe('https://share.overdeck.ai');
    expect(probeCorsOrigin('https://share.overdeck.ai.evil', { url: 'https://share.overdeck.ai' })).toBeNull();
    expect(probeCorsOrigin(undefined, { url: 'https://share.overdeck.ai' })).toBeNull();
    expect(probeCorsOrigin('https://share.overdeck.ai', { error: 'bad' })).toBeNull();
  });
});
