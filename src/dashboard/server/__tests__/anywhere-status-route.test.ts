/**
 * PAN-4445 WI-4: GET /api/anywhere/status aggregates this machine's identity,
 * trusted addresses, the active paired-device count and the vault state, and
 * is never cacheable. It needs a dashboard credential.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));

// PAN-1254: the Tailscale summary comes from readTailscaleState; pin it so the
// result does not depend on whether this machine has Tailscale.
const tailscaleState = vi.hoisted(() => ({
  current: {
    installed: false,
    nextStep: 'install',
    serveUrl: null as string | null,
    magicDnsName: null as string | null,
    serve: { proxiesDashboard: false, otherHandlerOn443: false, funnelOn443: false },
  },
}));
vi.mock('../../../lib/tailscale/state.js', () => ({ readTailscaleState: async () => tailscaleState.current }));

const {
  _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken, revokeAccessToken, isPairedDeviceRecord, PHONE_TOKEN_SCOPES,
} = await import('../../../lib/access-tokens.js');
const { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } = await import('../../../lib/internal-token.js');
const { _resetDashboardSessionTokenForTests } = await import('../routes/dashboard-auth.js');
const { _resetTrustedOriginsForTests } = await import('../routes/origin-validation.js');
const { anywhereRouteLayer } = await import('../routes/anywhere.js');

const INTERNAL_TOKEN = 'anywhere-status-internal-token-0123';
const SESSION_TOKEN = 'anywhere-status-session-token-0123';
const ENV_KEYS = ['OVERDECK_HOME', 'OVERDECK_INTERNAL_TOKEN', 'OVERDECK_DASHBOARD_SESSION_TOKEN', 'OVERDECK_TRUSTED_ORIGINS', 'OVERDECK_TRAEFIK_ENABLED', 'OVERDECK_TRAEFIK_DOMAIN', 'TRAEFIK_DOMAIN', 'DASHBOARD_URL', 'API_PORT', 'PORT'] as const;
let savedEnv: Record<string, string | undefined>;
let home: string;

async function get(headers: Record<string, string>) {
  const request = HttpServerRequest.fromWeb(new Request('http://localhost/api/anywhere/status', { method: 'GET', headers }));
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(anywhereRouteLayer),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
  )));
  const raw = response as { status: number; headers: Record<string, string>; body: { body?: Uint8Array } };
  const text = raw.body?.body ? new TextDecoder().decode(raw.body.body) : '';
  return { status: raw.status, headers: raw.headers, json: text ? JSON.parse(text) : null };
}

beforeEach(async () => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  home = await mkdtemp(join(tmpdir(), 'pan-4445-anywhere-status-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = INTERNAL_TOKEN;
  process.env.OVERDECK_DASHBOARD_SESSION_TOKEN = SESSION_TOKEN;
  process.env.API_PORT = '3999';
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetAccessTokensForTests();
  _resetTrustedOriginsForTests();
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

describe('GET /api/anywhere/status (PAN-4445)', () => {
  it('reports Tailscale as not installed when no CLI resolves (PAN-1254)', async () => {
    const res = await get({ [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN });
    expect(res.json.tailscale).toEqual({ nextStep: 'not-installed', serveUrl: null, magicDnsName: null });
  });

  it('reports unprotected Tailscale Serve as a problem with the setup action (PAN-1254)', async () => {
    tailscaleState.current = {
      installed: true,
      nextStep: 'protect',
      serveUrl: 'https://desk.tailnet.ts.net',
      magicDnsName: 'desk.tailnet.ts.net',
      serve: { proxiesDashboard: true, otherHandlerOn443: false, funnelOn443: false },
    };
    try {
      const res = await get({ [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN });
      expect(res.json.tailscale).toEqual({ nextStep: 'protect', serveUrl: 'https://desk.tailnet.ts.net', magicDnsName: 'desk.tailnet.ts.net' });
      expect(res.json.problems).toContainEqual(expect.objectContaining({ code: 'tailscale-serve-unprotected', action: { kind: 'tailscale-setup' } }));
    } finally {
      tailscaleState.current = { ...tailscaleState.current, installed: false, nextStep: 'install', serveUrl: null, magicDnsName: null, serve: { proxiesDashboard: false, otherHandlerOn443: false, funnelOn443: false } };
    }
  });

  it('counts both paired browsers and paired phones as active devices, lists loopback addresses, and is not cacheable', async () => {
    await createAccessToken({ name: 'phone', scopes: ['admin'], kind: 'device' });
    await createAccessToken({
      name: 'iris', kind: 'phone', scopes: [...PHONE_TOKEN_SCOPES],
      phoneKey: 'ab'.repeat(32), clientId: '22222222-2222-4222-8222-222222222222',
    });
    const lost = await createAccessToken({ name: 'lost', scopes: ['admin'], kind: 'device' });
    await createAccessToken({ name: 'ci', scopes: ['admin'], kind: 'token' });
    await revokeAccessToken(lost.record.id);

    const res = await get({ [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json.devices).toEqual({ active: 2 });
    expect(res.json.addresses).toContainEqual({ origin: 'http://127.0.0.1:3999', loopback: true });
    expect(res.json.machine).toEqual({ environmentId: expect.any(String), label: expect.any(String) });
    expect(res.json.vault).toEqual({ state: 'off', backend: null });
    expect(res.json.problems.map((problem: { code: string }) => problem.code)).toEqual(['no-reachable-address']);
    for (const problem of res.json.problems as Array<{ message: string }>) {
      expect(problem.message).not.toMatch(/\bpan [a-z]/);
    }
  });

  it('isPairedDeviceRecord treats device, phone and no kind as paired, and token, machine and connector as not (PAN-5000)', () => {
    expect(isPairedDeviceRecord({ kind: 'device' })).toBe(true);
    expect(isPairedDeviceRecord({ kind: 'phone' })).toBe(true);
    expect(isPairedDeviceRecord({ kind: undefined })).toBe(true);
    expect(isPairedDeviceRecord({ kind: 'token' })).toBe(false);
    expect(isPairedDeviceRecord({ kind: 'machine' })).toBe(false);
    expect(isPairedDeviceRecord({ kind: 'connector' })).toBe(false);
  });

  it('lists a trusted reachable address as not loopback and reports no address problem', async () => {
    process.env.OVERDECK_TRUSTED_ORIGINS = 'https://desk.tailnet.ts.net';
    const res = await get({ [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN });
    expect(res.json.addresses).toContainEqual({ origin: 'https://desk.tailnet.ts.net', loopback: false });
    expect(res.json.problems).toEqual([]);
  });

  it('answers 401 without a credential', async () => {
    const res = await get({});
    expect(res.status).toBe(401);
  });

  it('reports the caller\'s credential kind as viewer.kind (PAN-4455 D-3)', async () => {
    expect((await get({ [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN })).json.viewer).toEqual({ kind: 'internal-token' });
    expect((await get({ cookie: `overdeck_session=${SESSION_TOKEN}` })).json.viewer).toEqual({ kind: 'root-session' });
    const { token } = await createAccessToken({ name: 'phone', scopes: ['admin'], kind: 'device' });
    expect((await get({ cookie: `overdeck_device=${token}` })).json.viewer).toEqual({ kind: 'device' });
  });
});
