/**
 * PAN-3762 W10.1: the remote request gate. A non-loopback peer without a
 * credential gets 401 on every gated surface except the allowlist; a device
 * credential or a loopback peer passes; `dashboard.require_token_mint` turns a
 * forwarded loopback peer (a local reverse proxy) into a remote one, for the
 * gate and for the session mint. PAN-2351 W3: a registry credential passes only
 * when its scopes satisfy the route-scope table, from any peer, else 403.
 *
 * The gate is composed with a catch-all route the same way makeRoutesLayer
 * merges it beside the real route layers. The route inventory is the no-loss
 * matrix, never a grep of source files.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NO_LOSS_MATRIX } from '../../../../tests/unit/lib/overdeck/no-loss-matrix.js';
import { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken } from '../../../lib/access-tokens.js';
import { _resetInternalTokenCacheForTests } from '../../../lib/internal-token.js';
import { invalidateRemoteAccessConfig } from '../../../lib/remote-access/config.js';
import { _resetDashboardSessionTokenForTests, rejectUnauthorizedDashboardSessionMintRequest } from '../routes/dashboard-auth.js';
import { REMOTE_GATE_ALLOWLIST, remoteRequestGateLayer } from '../remote-request-gate.js';

const LAN_PEER = '192.0.2.44';
const originalHome = process.env.OVERDECK_HOME;
const originalEventsToken = process.env.OVERDECK_EVENTS_TOKEN;
let home: string;

const reachedRoute = HttpRouter.add('*', '*', Effect.succeed(HttpServerResponse.text('reached')));
const app = Layer.mergeAll(remoteRequestGateLayer, reachedRoute);

function makeRequest(method: string, path: string, opts: { peer?: string; headers?: Record<string, string> } = {}) {
  return HttpServerRequest.fromWeb(new Request(`http://dashboard.test${path}`, { method, headers: opts.headers }))
    .modify({ remoteAddress: opts.peer ? Option.some(opts.peer) : Option.none() });
}

async function sendFull(method: string, path: string, opts: { peer?: string; headers?: Record<string, string> } = {}) {
  const request = makeRequest(method, path, opts);
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(app),
    (handler) => Effect.provideService(handler, HttpServerRequest.HttpServerRequest, request),
  )));
  const raw = response as { status: number; body: { body?: Uint8Array } };
  return { status: raw.status, text: raw.body?.body ? new TextDecoder().decode(raw.body.body) : '' };
}

async function send(method: string, path: string, opts: { peer?: string; headers?: Record<string, string> } = {}) {
  return (await sendFull(method, path, opts)).status;
}

async function setRequireTokenMint(value: boolean): Promise<void> {
  await writeFile(join(home, 'config.yaml'), `dashboard:\n  require_token_mint: ${value}\n`, 'utf8');
  invalidateRemoteAccessConfig();
}

/** `GET /api/devices/:id` → `/api/devices/x`, so the path is concrete. */
function concretePath(path: string): string {
  return path.replace(/:[A-Za-z0-9_]+/g, 'x').replace(/\*/g, 'x');
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-3762-gate-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = 'gate-internal-token';
  delete process.env.OVERDECK_EVENTS_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetAccessTokensForTests();
  invalidateRemoteAccessConfig();
});

afterEach(async () => {
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  invalidateRemoteAccessConfig();
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  if (originalEventsToken === undefined) delete process.env.OVERDECK_EVENTS_TOKEN;
  else process.env.OVERDECK_EVENTS_TOKEN = originalEventsToken;
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('remote request gate (PAN-3762)', () => {
  it('rejects an uncredentialed non-loopback peer on /api/conversations, /api/lanes and /events/stream', async () => {
    expect(await send('GET', '/api/conversations', { peer: LAN_PEER })).toBe(401);
    expect(await send('GET', '/api/lanes', { peer: LAN_PEER })).toBe(401);
    expect(await send('GET', '/events/stream', { peer: LAN_PEER })).toBe(401);
    expect(await send('GET', '/api/conversations')).toBe(401);
  });

  it('does not let a doubled or dotted path reach a route past the gate', async () => {
    // An unauthenticated route: 200 here would mean the gate was bypassed.
    const probeApp = Layer.mergeAll(
      remoteRequestGateLayer,
      HttpRouter.add('GET', '/api/probe', Effect.succeed(HttpServerResponse.text('reached'))),
    );
    for (const path of ['//api/probe', '///api/probe', '/./api/probe', '/x/../api/probe', '/%61pi/probe', '/API/probe', '/api//probe', 'http://evil.example/api/probe', '/%E0%A4%A']) {
      const request = makeRequest('GET', '/', { peer: LAN_PEER }).modify({ url: path });
      const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
        HttpRouter.toHttpEffect(probeApp),
        (handler) => Effect.provideService(handler, HttpServerRequest.HttpServerRequest, request),
      )));
      expect((response as { status: number }).status, path).not.toBe(200);
    }
  });

  it('passes static SPA paths without a credential', async () => {
    expect(await send('GET', '/', { peer: LAN_PEER })).toBe(200);
    expect(await send('GET', '/assets/index.js', { peer: LAN_PEER })).toBe(200);
  });

  it('401s every gated matrix surface off the allowlist and passes every allowlisted one', async () => {
    const surfaces = NO_LOSS_MATRIX
      .filter((entry) => entry.kind === 'http')
      .map((entry) => entry.surface)
      .filter((surface) => /^[A-Z]+ \/(api|events)\//.test(surface));
    expect(surfaces.length).toBeGreaterThan(100);

    const wrong: string[] = [];
    for (const surface of surfaces) {
      const [method, path] = surface.split(' ') as [string, string];
      const expected = REMOTE_GATE_ALLOWLIST.has(surface) ? 200 : 401;
      const status = await send(method, concretePath(path), { peer: LAN_PEER });
      if (status !== expected) wrong.push(`${surface} → ${status} (expected ${expected})`);
    }
    expect(wrong).toEqual([]);
    // Some allowlisted routes (GET /api/health) live in server.ts, outside the matrix.
    for (const allowed of REMOTE_GATE_ALLOWLIST) {
      const [method, path] = allowed.split(' ') as [string, string];
      expect(await send(method, path, { peer: LAN_PEER }), allowed).toBe(200);
    }
  });

  it('passes a loopback peer without a credential (local behavior unchanged)', async () => {
    expect(await send('GET', '/api/conversations', { peer: '127.0.0.1' })).toBe(200);
    expect(await send('GET', '/api/conversations', { peer: '::ffff:127.0.0.1' })).toBe(200);
    expect(await send('GET', '/api/conversations', { peer: '127.0.0.1', headers: { 'x-forwarded-for': '203.0.113.9' } })).toBe(200);
  });

  it('passes a non-loopback peer with a valid device cookie', async () => {
    const { token } = await createAccessToken({ name: 'phone', scopes: ['admin'], kind: 'device' });
    expect(await send('GET', '/api/conversations', { peer: LAN_PEER, headers: { cookie: `overdeck_device=${token}` } })).toBe(200);
    expect(await send('GET', '/api/conversations', { peer: LAN_PEER, headers: { cookie: 'overdeck_device=odk_forged' } })).toBe(401);
  });

  it('accepts the OVERDECK_EVENTS_TOKEN bearer on /events/stream only', async () => {
    process.env.OVERDECK_EVENTS_TOKEN = 'events-secret';
    const bearer = { authorization: 'Bearer events-secret' };
    expect(await send('GET', '/events/stream', { peer: LAN_PEER, headers: bearer })).toBe(200);
    expect(await send('GET', '/api/conversations', { peer: LAN_PEER, headers: bearer })).toBe(401);
    expect(await send('GET', '/events/stream', { peer: LAN_PEER, headers: { authorization: 'Bearer wrong' } })).toBe(401);
  });

  it('with require_token_mint, treats a forwarded loopback peer as remote for the gate and the mint', async () => {
    await setRequireTokenMint(true);
    const forwarded = { 'x-forwarded-for': '203.0.113.9' };

    expect(await send('GET', '/api/conversations', { peer: '127.0.0.1', headers: forwarded })).toBe(401);
    expect(await send('GET', '/api/conversations', { peer: '127.0.0.1', headers: { forwarded: 'for=203.0.113.9' } })).toBe(401);
    expect(await send('GET', '/api/conversations', { peer: '127.0.0.1' })).toBe(200);

    const mintRejection = rejectUnauthorizedDashboardSessionMintRequest(makeRequest('POST', '/api/dashboard/session', { peer: '127.0.0.1', headers: forwarded }));
    expect(mintRejection?.status).toBe(401);
  });

  it('keeps the loopback session mint when require_token_mint is off', async () => {
    await setRequireTokenMint(false);
    expect(rejectUnauthorizedDashboardSessionMintRequest(makeRequest('POST', '/api/dashboard/session', { peer: '127.0.0.1' }))).toBeNull();
  });

  it('applies require_token_mint after invalidation without a restart', async () => {
    const loopbackMint = () => rejectUnauthorizedDashboardSessionMintRequest(makeRequest('POST', '/api/dashboard/session', { peer: '127.0.0.1' }));

    await setRequireTokenMint(false);
    expect(loopbackMint()).toBeNull();

    await setRequireTokenMint(true);
    expect(loopbackMint()?.status).toBe(401);

    await setRequireTokenMint(false);
    expect(loopbackMint()).toBeNull();
  });
});

describe('remote request gate scopes (PAN-2351)', () => {
  async function bearer(scopes: Parameters<typeof createAccessToken>[0]['scopes']) {
    const { token } = await createAccessToken({ name: scopes.join('+'), scopes, kind: 'token' });
    return { authorization: `Bearer ${token}` };
  }

  it('lets a read:events token reach its routes and 403s it elsewhere with the missing scope', async () => {
    const headers = await bearer(['read:events']);
    expect(await send('GET', '/events/stream', { peer: LAN_PEER, headers })).toBe(200);

    const tell = await sendFull('POST', '/api/agents/x/tell', { peer: LAN_PEER, headers });
    expect(tell.status).toBe(403);
    expect(JSON.parse(tell.text)).toEqual({ error: 'insufficient_scope', missingScope: 'tell' });

    const settings = await sendFull('GET', '/api/settings', { peer: LAN_PEER, headers });
    expect(settings.status).toBe(403);
    expect(JSON.parse(settings.text)).toEqual({ error: 'insufficient_scope', missingScope: 'admin' });
  });

  it('lets a tell token reach tell routes and an operate token reach them too', async () => {
    expect(await send('POST', '/api/agents/x/tell', { peer: LAN_PEER, headers: await bearer(['tell']) })).toBe(200);
    expect(await send('POST', '/api/conversations/x/message', { peer: LAN_PEER, headers: await bearer(['operate']) })).toBe(200);
  });

  it('judges a narrow token by its scopes even from a loopback peer', async () => {
    const headers = await bearer(['read:events']);
    expect(await send('GET', '/api/settings', { peer: '127.0.0.1', headers })).toBe(403);
    expect(await send('GET', '/api/settings', { peer: '127.0.0.1' })).toBe(200);
  });

  it('still passes an admin device everywhere and 401s an unknown odk_ bearer', async () => {
    const { token } = await createAccessToken({ name: 'phone', scopes: ['admin'], kind: 'device' });
    expect(await send('GET', '/api/settings', { peer: LAN_PEER, headers: { authorization: `Bearer ${token}` } })).toBe(200);
    expect(await send('GET', '/api/settings', { peer: LAN_PEER, headers: { authorization: 'Bearer odk_unknown' } })).toBe(401);
  });
});
