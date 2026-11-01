/**
 * PAN-1254 W-8..W-10: the /api/tailscale routes. The Tailscale lib modules are
 * mocked; credentials go through the real dashboard auth.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InstallPlan } from '../../../lib/tailscale/installer.js';
import type { LoginResult } from '../../../lib/tailscale/login.js';
import type { TailnetPeer } from '../../../lib/tailscale/peers.js';
import type { ServeResult } from '../../../lib/tailscale/serve.js';
import type { TailscaleState } from '../../../lib/tailscale/state.js';
import type { UserspaceResult } from '../../../lib/tailscale/userspace.js';

const readTailscaleState = vi.fn<() => Promise<TailscaleState>>();
const resolveInstallPlan = vi.fn<(opts: { userspace: boolean; port?: number }) => Promise<InstallPlan>>();

vi.mock('../../../lib/activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));
vi.mock('../../../lib/tailscale/state.js', () => ({ readTailscaleState: () => readTailscaleState() }));
const startTailscaleLogin = vi.fn<(state: TailscaleState) => Promise<LoginResult>>();
const enableTailscaleServe = vi.fn<(deps: { alreadyTrusted?: readonly string[] }) => Promise<ServeResult>>();
const installUserspaceTailscale = vi.fn<() => Promise<UserspaceResult>>();
const restartUserspaceDaemon = vi.fn<() => Promise<UserspaceResult>>();
const invalidateTrustedOriginsCache = vi.fn();
const discoverTailnetPeers = vi.fn<(state: TailscaleState, opts: { port: number; selfEnvironmentId: string }) => Promise<TailnetPeer[]>>();

vi.mock('../../../lib/tailscale/installer.js', () => ({
  resolveInstallPlan: (opts: { userspace: boolean; port?: number }) => resolveInstallPlan(opts),
  operatorCommand: (name: string) => `sudo tailscale set --operator=${name}`,
  USERSPACE_MODE_AVAILABLE: false,
}));
vi.mock('../../../lib/tailscale/peers.js', () => ({
  discoverTailnetPeers: (state: TailscaleState, opts: { port: number; selfEnvironmentId: string }) => discoverTailnetPeers(state, opts),
}));
vi.mock('../../../lib/tailscale/login.js', () => ({ startTailscaleLogin: (state: TailscaleState) => startTailscaleLogin(state) }));
vi.mock('../../../lib/tailscale/serve.js', () => ({ enableTailscaleServe: (deps: { alreadyTrusted?: readonly string[] }) => enableTailscaleServe(deps) }));
vi.mock('../../../lib/tailscale/userspace.js', () => ({
  installUserspaceTailscale: () => installUserspaceTailscale(),
  restartUserspaceDaemon: () => restartUserspaceDaemon(),
}));
vi.mock('../routes/origin-validation.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../routes/origin-validation.js')>();
  return {
    ...actual,
    invalidateTrustedOriginsCache: () => {
      invalidateTrustedOriginsCache();
      actual.invalidateTrustedOriginsCache();
    },
  };
});

const { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken } = await import('../../../lib/access-tokens.js');
const { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } = await import('../../../lib/internal-token.js');
const { _resetDashboardSessionTokenForTests, dashboardCsrfToken } = await import('../routes/dashboard-auth.js');
const { _resetTrustedOriginsForTests } = await import('../routes/origin-validation.js');
const { tailscaleRouteLayer } = await import('../routes/tailscale.js');

const INTERNAL_TOKEN = 'tailscale-routes-internal-token-0123';
const SESSION_TOKEN = 'tailscale-routes-session-token-0123';
const ENV_KEYS = ['OVERDECK_HOME', 'OVERDECK_INTERNAL_TOKEN', 'OVERDECK_DASHBOARD_SESSION_TOKEN', 'OVERDECK_TRUSTED_ORIGINS', 'API_PORT', 'PORT'] as const;
let savedEnv: Record<string, string | undefined>;
let home: string;

function state(overrides: Partial<TailscaleState> = {}): TailscaleState {
  return {
    installed: true,
    cli: { bin: '/usr/bin/tailscale', mode: 'system', baseArgs: [] },
    mode: 'system',
    version: '1.104.4',
    daemonRunning: true,
    statusError: null,
    backendState: 'Running',
    authUrl: null,
    magicDnsName: 'desk.tailnet.ts.net',
    serveUrl: 'https://desk.tailnet.ts.net',
    hostName: 'desk',
    ipv4: ['100.64.0.1'],
    loginName: 'op@example.com',
    magicDnsEnabled: true,
    httpsEnabled: true,
    tailnetName: 'example.com',
    operator: 'self',
    serve: { proxiesDashboard: false, otherHandlerOn443: false, funnelOn443: false },
    peers: [],
    port: 3999,
    requireTokenMint: false,
    nextStep: 'serve',
    ...overrides,
  };
}

async function call(method: string, path: string, headers: Record<string, string>, body?: unknown) {
  const init: RequestInit = { method, headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, init));
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(tailscaleRouteLayer),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
  )));
  const raw = response as { status: number; headers: Record<string, string>; body: { body?: Uint8Array } };
  const text = raw.body?.body ? new TextDecoder().decode(raw.body.body) : '';
  return { status: raw.status, headers: raw.headers, json: text ? JSON.parse(text) : null };
}

const ROOT = { cookie: `overdeck_session=${SESSION_TOKEN}` };

beforeEach(async () => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  home = await mkdtemp(join(tmpdir(), 'pan-1254-tailscale-routes-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = INTERNAL_TOKEN;
  process.env.OVERDECK_DASHBOARD_SESSION_TOKEN = SESSION_TOKEN;
  process.env.API_PORT = '3999';
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetTrustedOriginsForTests();
  _resetAccessTokensForTests();
  for (const mock of [startTailscaleLogin, enableTailscaleServe, installUserspaceTailscale, restartUserspaceDaemon, invalidateTrustedOriginsCache, discoverTailnetPeers]) mock.mockReset();
  readTailscaleState.mockReset();
  resolveInstallPlan.mockReset();
  readTailscaleState.mockResolvedValue(state());
  resolveInstallPlan.mockImplementation(async ({ userspace }) => (userspace ? { kind: 'userspace' } : { kind: 'pane', command: 'curl -fsSL https://tailscale.com/install.sh | sh' }));
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
  _resetTrustedOriginsForTests();
  await rm(home, { recursive: true, force: true });
});

describe('GET /api/tailscale/status (PAN-1254)', () => {
  it('returns state, install plan, operator command and port, not cacheable', async () => {
    const res = await call('GET', '/api/tailscale/status', ROOT);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json.state.nextStep).toBe('serve');
    expect(res.json.install.kind).toBe('pane');
    expect(res.json.operatorCommand).toMatch(/^sudo tailscale set --operator=/);
    expect(res.json.port).toBe(3999);
    expect(res.json.platform).toBe(process.platform);
    expect(res.json.userspaceAvailable).toBe(false);
    expect(resolveInstallPlan).toHaveBeenCalledWith({ userspace: false, port: 3999 });
  });

  it('answers 401 without a credential', async () => {
    expect((await call('GET', '/api/tailscale/status', {})).status).toBe(401);
    expect(readTailscaleState).not.toHaveBeenCalled();
  });

  it('asks the install plan for userspace with ?userspace=1', async () => {
    const res = await call('GET', '/api/tailscale/status?userspace=1', { [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN });
    expect(resolveInstallPlan).toHaveBeenCalledWith({ userspace: true, port: 3999 });
    expect(res.json.install.kind).toBe('userspace');
  });
});

const INTERNAL = { [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN };

describe('POST /api/tailscale/* (PAN-1254 D-4)', () => {
  it('refuses a paired device and a scoped token on every write route without calling the lib', async () => {
    const device = await createAccessToken({ name: 'phone', scopes: ['admin'], kind: 'device' });
    const token = await createAccessToken({ name: 'ci', scopes: ['admin'], kind: 'token' });
    const callers = [
      { authorization: `Bearer ${device.token}`, 'x-overdeck-csrf-token': dashboardCsrfToken() },
      { authorization: `Bearer ${token.token}` },
    ];
    for (const headers of callers) {
      for (const path of ['/api/tailscale/serve', '/api/tailscale/login', '/api/tailscale/userspace']) {
        const res = await call('POST', path, headers, {});
        expect(res.status, path).toBe(403);
        expect(res.json).toEqual({ error: 'Only this machine can change Tailscale settings.' });
      }
    }
    expect(enableTailscaleServe).not.toHaveBeenCalled();
    expect(startTailscaleLogin).not.toHaveBeenCalled();
    expect(installUserspaceTailscale).not.toHaveBeenCalled();
    expect(restartUserspaceDaemon).not.toHaveBeenCalled();
  });

  it('refuses a write without a JSON body', async () => {
    const res = await call('POST', '/api/tailscale/serve', INTERNAL);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(enableTailscaleServe).not.toHaveBeenCalled();
  });
});

describe('POST /api/tailscale/serve', () => {
  it('returns 200 on success, passes the trusted origins and invalidates the cache once', async () => {
    process.env.OVERDECK_TRUSTED_ORIGINS = 'https://already.example';
    _resetTrustedOriginsForTests();
    enableTailscaleServe.mockResolvedValue({ ok: true, url: 'https://desk.tailnet.ts.net', selfCheck: 'passed', changed: true });
    const res = await call('POST', '/api/tailscale/serve', INTERNAL, {});
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, changed: true });
    expect(enableTailscaleServe.mock.calls[0][0].alreadyTrusted).toContain('https://already.example');
    expect(invalidateTrustedOriginsCache).toHaveBeenCalledTimes(1);
  });

  it('returns 409 with the reason on a failed self-check and still invalidates the cache', async () => {
    enableTailscaleServe.mockResolvedValue({ ok: false, reason: 'self-check-failed', message: 'no answer' });
    const res = await call('POST', '/api/tailscale/serve', INTERNAL, {});
    expect(res.status).toBe(409);
    expect(res.json.reason).toBe('self-check-failed');
    expect(invalidateTrustedOriginsCache).toHaveBeenCalledTimes(1);
  });

  it('returns 500 and invalidates the cache when the lib throws', async () => {
    enableTailscaleServe.mockRejectedValue(new Error('Cannot update trusted-origins.json'));
    const res = await call('POST', '/api/tailscale/serve', INTERNAL, {});
    expect(res.status).toBe(500);
    expect(res.json.error).toContain('trusted-origins.json');
    expect(invalidateTrustedOriginsCache).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/tailscale/login', () => {
  it('returns the sign-in URL', async () => {
    startTailscaleLogin.mockResolvedValue({ authUrl: 'https://login.tailscale.com/a/x' });
    const res = await call('POST', '/api/tailscale/login', INTERNAL, {});
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ authUrl: 'https://login.tailscale.com/a/x' });
  });

  it('maps access denied to 409 with nextStep operator', async () => {
    startTailscaleLogin.mockResolvedValue({ error: 'access-denied', message: 'Access denied: prefs write access denied' });
    const res = await call('POST', '/api/tailscale/login', INTERNAL, {});
    expect(res.status).toBe(409);
    expect(res.json).toEqual({ error: 'Access denied: prefs write access denied', nextStep: 'operator' });
  });

  it('maps a timeout to 504', async () => {
    startTailscaleLogin.mockResolvedValue({ error: 'timeout', message: 'no link' });
    expect((await call('POST', '/api/tailscale/login', INTERNAL, {})).status).toBe(504);
  });
});

describe('POST /api/tailscale/userspace', () => {
  it('refuses a fresh userspace install while userspace mode is off', async () => {
    const res = await call('POST', '/api/tailscale/userspace', INTERNAL, {});
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ ok: false, reason: 'userspace-unavailable' });
    expect(installUserspaceTailscale).not.toHaveBeenCalled();
  });

  it('restarts the daemon of an existing userspace install', async () => {
    readTailscaleState.mockResolvedValue(state({ mode: 'userspace', daemonRunning: false, nextStep: 'start-daemon' }));
    restartUserspaceDaemon.mockResolvedValue({ ok: true });
    const res = await call('POST', '/api/tailscale/userspace', INTERNAL, {});
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
    expect(restartUserspaceDaemon).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/tailscale/peers', () => {
  const LAPTOP: TailnetPeer = {
    hostName: 'laptop',
    dnsName: 'laptop.tailnet.ts.net',
    os: 'macOS',
    online: true,
    overdeck: { environmentId: 'env-laptop', label: 'laptop', serverVersion: '0.72.0', url: 'https://laptop.tailnet.ts.net' },
  };

  it('returns the discovered peers, not cacheable', async () => {
    discoverTailnetPeers.mockResolvedValue([LAPTOP]);
    const res = await call('GET', '/api/tailscale/peers', ROOT);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json).toEqual({ peers: [LAPTOP] });
    expect(discoverTailnetPeers).toHaveBeenCalledWith(expect.objectContaining({ backendState: 'Running' }), { port: 3999, selfEnvironmentId: expect.any(String) });
  });

  it('returns no peers without probing when Tailscale is not running', async () => {
    readTailscaleState.mockResolvedValue(state({ backendState: 'NeedsLogin', nextStep: 'login' }));
    const res = await call('GET', '/api/tailscale/peers', ROOT);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ peers: [] });
    expect(discoverTailnetPeers).not.toHaveBeenCalled();
  });

  it('answers 401 without a credential', async () => {
    expect((await call('GET', '/api/tailscale/peers', {})).status).toBe(401);
  });
});
