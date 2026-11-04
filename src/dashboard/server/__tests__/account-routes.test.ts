/**
 * PAN-4960 WI-4, WI-6: GET /api/account, POST /api/account/sign-in and GET /oauth/account/callback.
 * The view and sign-in services are mocked; credentials, peers and the require_token_mint config
 * go through the real dashboard auth and remote-request gate helpers.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BeginResult, CallbackResult } from '../services/account-sign-in.js';
import type { AccountSignInView } from '../services/account-view.js';

const view = vi.fn(async (input: { canSignIn: boolean; signIn: AccountSignInView }) => ({ signedIn: false, ...input }));
const signInView = vi.fn((canSignIn: boolean): AccountSignInView => ({ state: 'pending', authorizeUrl: canSignIn ? 'https://account.test/auth/start' : null, message: null }));
const begin = vi.fn(async (): Promise<BeginResult> => ({ ok: true, authorizeUrl: 'https://account.test/auth/start?state=s' }));
const complete = vi.fn(async (_query: URLSearchParams): Promise<CallbackResult> => ({ kind: 'succeeded', githubLogin: 'octocat' }));
let channelMarker: unknown = null;

vi.mock('../services/account-view.js', () => ({ accountViewService: () => ({ view }) }));
vi.mock('../services/account-sign-in.js', () => ({
  CALLBACK_PATH: '/oauth/account/callback',
  accountSignInService: () => ({ view: signInView, begin, complete }),
}));
vi.mock('../channel-peer.js', () => ({ channelOfRequest: () => channelMarker, channelOfIncoming: () => channelMarker }));

const { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken } = await import('../../../lib/access-tokens.js');
const { _resetInternalTokenCacheForTests } = await import('../../../lib/internal-token.js');
const { invalidateRemoteAccessConfig } = await import('../../../lib/remote-access/config.js');
const { _resetDashboardSessionTokenForTests, dashboardCsrfToken } = await import('../routes/dashboard-auth.js');
const { accountRouteLayer } = await import('../routes/account.js');

const INTERNAL_TOKEN = 'account-routes-internal-token-0123';
const SESSION_TOKEN = 'account-routes-session-token-0123';
const ROOT = { cookie: `overdeck_session=${SESSION_TOKEN}` };
const ENV_KEYS = ['OVERDECK_HOME', 'OVERDECK_INTERNAL_TOKEN', 'OVERDECK_DASHBOARD_SESSION_TOKEN', 'API_PORT', 'PORT', 'HOST'] as const;
let savedEnv: Record<string, string | undefined>;
let home: string;

async function call(method: string, path: string, opts: { headers?: Record<string, string>; peer?: string; body?: unknown } = {}) {
  const init: RequestInit = { method, headers: opts.headers };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const request = HttpServerRequest.fromWeb(new Request(`http://127.0.0.1:3999${path}`, init)).modify({
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
  signInView.mockClear();
  begin.mockClear();
  complete.mockClear();
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
    expect(res.json).toMatchObject({ canSignIn: true, signIn: { state: 'pending', authorizeUrl: 'https://account.test/auth/start', message: null } });
    expect(signInView).toHaveBeenCalledWith(true);
  });

  it('does not let an admin device token sign in (ac4)', async () => {
    const device = await createAccessToken({ name: 'phone', scopes: ['admin'], kind: 'device' });
    const res = await call('GET', '/api/account', { headers: { authorization: `Bearer ${device.token}` }, peer: '127.0.0.1' });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ canSignIn: false, signIn: { authorizeUrl: null } });
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

const ROOT_MUTATION = () => ({ ...ROOT, 'content-type': 'application/json', 'x-overdeck-csrf-token': dashboardCsrfToken() });

describe('POST /api/account/sign-in (PAN-4960 WI-6)', () => {
  it('returns the authorize URL for a root session with CSRF from a loopback peer (ac1)', async () => {
    const res = await call('POST', '/api/account/sign-in', { headers: ROOT_MUTATION(), peer: '127.0.0.1', body: {} });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json).toEqual({ authorizeUrl: 'https://account.test/auth/start?state=s' });
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it('refuses a device token (ac1)', async () => {
    const device = await createAccessToken({ name: 'phone', scopes: ['admin'], kind: 'device' });
    const res = await call('POST', '/api/account/sign-in', {
      headers: { authorization: `Bearer ${device.token}`, 'content-type': 'application/json', 'x-overdeck-csrf-token': dashboardCsrfToken() },
      peer: '127.0.0.1',
      body: {},
    });
    expect(res.status).toBe(403);
    expect(res.json).toEqual({ error: 'Only this machine can sign in to overdeck.ai.' });
    expect(begin).not.toHaveBeenCalled();
  });

  it('refuses a forwarded root session while require_token_mint is on (ac2)', async () => {
    await setRequireTokenMint(true);
    const res = await call('POST', '/api/account/sign-in', {
      headers: { ...ROOT_MUTATION(), 'x-forwarded-for': '100.64.0.9' },
      peer: '127.0.0.1',
      body: {},
    });
    expect(res.status).toBe(403);
    expect(res.json).toEqual({ error: 'Sign in from a browser on this machine; the sign-in returns to 127.0.0.1.' });
    expect(begin).not.toHaveBeenCalled();
  });

  it('applies the mutation guard to a root session without CSRF', async () => {
    const res = await call('POST', '/api/account/sign-in', { headers: { ...ROOT, 'content-type': 'application/json' }, peer: '127.0.0.1', body: {} });
    expect(res.status).toBe(403);
    expect(res.json).toEqual({ error: 'Invalid CSRF token' });
    expect(begin).not.toHaveBeenCalled();
  });

  it('passes the service refusal through with its status', async () => {
    begin.mockResolvedValueOnce({ ok: false, status: 409, error: 'nope' });
    const res = await call('POST', '/api/account/sign-in', { headers: ROOT_MUTATION(), peer: '127.0.0.1', body: {} });
    expect(res.status).toBe(409);
    expect(res.json).toEqual({ error: 'nope' });
  });
});

describe('GET /oauth/account/callback (PAN-4960 WI-6)', () => {
  it('renders the success page for a loopback peer with framing and referrer locked down (ac3)', async () => {
    const res = await call('GET', '/oauth/account/callback?state=s&code=odc_code', { peer: '127.0.0.1' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-security-policy']).toBe("default-src 'none'; style-src 'unsafe-inline'");
    expect(res.text).toContain('<title>Signed in to overdeck.ai</title>');
    expect(res.text).toContain('Signed in to overdeck.ai as octocat. You can close this tab and go back to Overdeck.');
    const query = complete.mock.calls[0]![0];
    expect(query.get('state')).toBe('s');
    expect(query.get('code')).toBe('odc_code');
  });

  it('answers 404 for a LAN peer and for a forwarded loopback peer (ac3)', async () => {
    expect((await call('GET', '/oauth/account/callback?state=s&code=c', { peer: '192.0.2.44' })).status).toBe(404);
    const forwarded = await call('GET', '/oauth/account/callback?state=s&code=c', { peer: '127.0.0.1', headers: { 'x-forwarded-for': '192.0.2.44' } });
    expect(forwarded.status).toBe(404);
    expect(forwarded.json).toEqual({ error: 'not found' });
    expect(complete).not.toHaveBeenCalled();
  });

  it('escapes the login and the failure message (ac4)', async () => {
    complete.mockResolvedValueOnce({ kind: 'succeeded', githubLogin: '<script>' });
    const res = await call('GET', '/oauth/account/callback?state=s&code=c', { peer: '127.0.0.1' });
    expect(res.text).toContain('as &lt;script&gt;.');
    expect(res.text).not.toContain('<script>');
    complete.mockResolvedValueOnce({ kind: 'failed', message: 'Cannot reach <x>' });
    const failed = await call('GET', '/oauth/account/callback?state=s&code=c', { peer: '127.0.0.1' });
    expect(failed.status).toBe(200);
    expect(failed.text).toContain('<title>Sign-in did not finish</title>');
    expect(failed.text).toContain('Cannot reach &lt;x&gt;');
    expect(failed.text).toContain('click Sign in to try again.');
  });

  it('answers 400 with the expired page for an expired result (ac4)', async () => {
    complete.mockResolvedValueOnce({ kind: 'expired' });
    const res = await call('GET', '/oauth/account/callback?state=s', { peer: '127.0.0.1' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('<title>Sign-in link expired</title>');
    expect(res.text).toContain('This sign-in link expired or was already used.');
  });
});
