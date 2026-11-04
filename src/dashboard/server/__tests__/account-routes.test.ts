/**
 * PAN-4960 WI-4: GET /api/account. The view service is mocked; credentials, peers and the
 * require_token_mint config go through the real dashboard auth and remote-request gate helpers.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountSignInView } from '../services/account-view.js';

const view = vi.fn(async (input: { canSignIn: boolean; signIn: AccountSignInView }) => ({ signedIn: false, ...input }));
let channelMarker: unknown = null;

vi.mock('../services/account-view.js', () => ({ accountViewService: () => ({ view }) }));
vi.mock('../channel-peer.js', () => ({ channelOfRequest: () => channelMarker, channelOfIncoming: () => channelMarker }));

const { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken } = await import('../../../lib/access-tokens.js');
const { _resetInternalTokenCacheForTests } = await import('../../../lib/internal-token.js');
const { invalidateRemoteAccessConfig } = await import('../../../lib/remote-access/config.js');
const { _resetDashboardSessionTokenForTests } = await import('../routes/dashboard-auth.js');
const { accountRouteLayer } = await import('../routes/account.js');

const INTERNAL_TOKEN = 'account-routes-internal-token-0123';
const SESSION_TOKEN = 'account-routes-session-token-0123';
const ROOT = { cookie: `overdeck_session=${SESSION_TOKEN}` };
const ENV_KEYS = ['OVERDECK_HOME', 'OVERDECK_INTERNAL_TOKEN', 'OVERDECK_DASHBOARD_SESSION_TOKEN', 'API_PORT', 'PORT', 'HOST'] as const;
let savedEnv: Record<string, string | undefined>;
let home: string;

async function call(method: string, path: string, opts: { headers?: Record<string, string>; peer?: string } = {}) {
  const request = HttpServerRequest.fromWeb(new Request(`http://127.0.0.1:3999${path}`, { method, headers: opts.headers })).modify({
    remoteAddress: opts.peer ? Option.some(opts.peer) : Option.none(),
  });
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(accountRouteLayer),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
  )));
  const raw = response as { status: number; headers: Record<string, string>; body: { body?: Uint8Array } };
  const text = raw.body?.body ? new TextDecoder().decode(raw.body.body) : '';
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: raw.status, headers: raw.headers, text, json: json as Record<string, unknown> | null };
}

async function setRequireTokenMint(value: boolean): Promise<void> {
  await writeFile(join(home, 'config.yaml'), `dashboard:\n  require_token_mint: ${value}\n`, 'utf8');
  invalidateRemoteAccessConfig();
}

beforeEach(async () => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  home = await mkdtemp(join(tmpdir(), 'pan-4960-account-routes-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = INTERNAL_TOKEN;
  process.env.OVERDECK_DASHBOARD_SESSION_TOKEN = SESSION_TOKEN;
  process.env.API_PORT = '3999';
  channelMarker = null;
  view.mockClear();
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetAccessTokensForTests();
  invalidateRemoteAccessConfig();
});

afterEach(async () => {
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  invalidateRemoteAccessConfig();
  await rm(home, { recursive: true, force: true });
});

describe('GET /api/account (PAN-4960 WI-4)', () => {
  it('lets a root session from a loopback peer sign in, not cacheable (ac4)', async () => {
    const res = await call('GET', '/api/account', { headers: ROOT, peer: '127.0.0.1' });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json).toMatchObject({ canSignIn: true, signIn: { state: 'idle', authorizeUrl: null, message: null } });
  });

  it('does not let an admin device token sign in (ac4)', async () => {
    const device = await createAccessToken({ name: 'phone', scopes: ['admin'], kind: 'device' });
    const res = await call('GET', '/api/account', { headers: { authorization: `Bearer ${device.token}` }, peer: '127.0.0.1' });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ canSignIn: false });
  });

  it('does not let a forwarded root session sign in while require_token_mint is on (ac4)', async () => {
    await setRequireTokenMint(true);
    const res = await call('GET', '/api/account', { headers: { ...ROOT, 'x-forwarded-for': '100.64.0.9' }, peer: '127.0.0.1' });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ canSignIn: false });
  });

  it('answers 401 without a credential', async () => {
    expect((await call('GET', '/api/account', { peer: '192.0.2.44' })).status).toBe(401);
    expect(view).not.toHaveBeenCalled();
  });

  it('refuses a secure-channel caller with 403 (ac4)', async () => {
    channelMarker = { mode: 'link', remoteKey: Buffer.alloc(32) };
    const res = await call('GET', '/api/account', { headers: ROOT, peer: '127.0.0.1' });
    expect(res.status).toBe(403);
    expect(res.json).toEqual({ error: 'a linked machine cannot read this account here' });
    expect(view).not.toHaveBeenCalled();
  });
});
