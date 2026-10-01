/**
 * PAN-4445 WI-3: POST /api/anywhere/trusted-origins saves an address other
 * devices use and trusts it on the next request. Only the root session may
 * call it; the internal token, a device and a scoped token get 403 and no
 * file is written. Loopback and invalid origins get 400.
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));

const { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken } = await import('../../../lib/access-tokens.js');
const { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } = await import('../../../lib/internal-token.js');
const { _resetDashboardSessionTokenForTests, dashboardCsrfToken } = await import('../routes/dashboard-auth.js');
const { _resetTrustedOriginsForTests, validateOriginHeaders } = await import('../routes/origin-validation.js');
const { anywhereRouteLayer } = await import('../routes/anywhere.js');

const INTERNAL_TOKEN = 'anywhere-internal-token-0123456789';
const SESSION_TOKEN = 'anywhere-session-token-0123456789';
const ENV_KEYS = ['OVERDECK_HOME', 'OVERDECK_INTERNAL_TOKEN', 'OVERDECK_DASHBOARD_SESSION_TOKEN', 'OVERDECK_TRUSTED_ORIGINS', 'OVERDECK_TRAEFIK_ENABLED', 'OVERDECK_TRAEFIK_DOMAIN', 'TRAEFIK_DOMAIN', 'DASHBOARD_URL'] as const;
let savedEnv: Record<string, string | undefined>;
let home: string;

async function post(body: unknown, headers: Record<string, string>) {
  const request = HttpServerRequest.fromWeb(new Request('http://localhost/api/anywhere/trusted-origins', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }));
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(anywhereRouteLayer),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
  )));
  const raw = response as { status: number; headers: Record<string, string>; body: { body?: Uint8Array } };
  const text = raw.body?.body ? new TextDecoder().decode(raw.body.body) : '';
  return { status: raw.status, headers: raw.headers, json: text ? JSON.parse(text) : null };
}

function asRootSession() {
  return {
    cookie: `overdeck_session=${SESSION_TOKEN}`,
    'x-overdeck-csrf-token': dashboardCsrfToken(),
    origin: 'http://localhost:3011',
  };
}

function savedFile(): string {
  return join(home, 'trusted-origins.json');
}

beforeEach(async () => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  home = await mkdtemp(join(tmpdir(), 'pan-4445-anywhere-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = INTERNAL_TOKEN;
  process.env.OVERDECK_DASHBOARD_SESSION_TOKEN = SESSION_TOKEN;
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

describe('POST /api/anywhere/trusted-origins (PAN-4445)', () => {
  it('adds an origin for the root session and trusts it on the next request, with no restart', async () => {
    const headers = { origin: 'https://desk.tailnet.ts.net' };
    expect(validateOriginHeaders(headers, 'POST')).toEqual({ ok: false, error: 'Invalid origin' });

    const res = await post({ origin: 'https://desk.tailnet.ts.net/some/path' }, asRootSession());
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ origin: 'https://desk.tailnet.ts.net', added: true });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(readFileSync(savedFile(), 'utf8'))).toEqual({ version: 1, origins: ['https://desk.tailnet.ts.net'] });
    expect(validateOriginHeaders(headers, 'POST')).toEqual({ ok: true });

    const again = await post({ origin: 'https://desk.tailnet.ts.net' }, asRootSession());
    expect(again.status).toBe(200);
    expect(again.json).toEqual({ origin: 'https://desk.tailnet.ts.net', added: false });
  });

  it('refuses the internal token with 403 and writes no file', async () => {
    const res = await post({ origin: 'https://desk.tailnet.ts.net' }, { [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN });
    expect(res.status).toBe(403);
    expect(existsSync(savedFile())).toBe(false);
  });

  it('refuses a paired device with 403 and writes no file', async () => {
    const { token } = await createAccessToken({ name: 'phone', scopes: ['admin'], kind: 'device' });
    const res = await post(
      { origin: 'https://desk.tailnet.ts.net' },
      { cookie: `overdeck_device=${token}`, 'x-overdeck-csrf-token': dashboardCsrfToken() },
    );
    expect(res.status).toBe(403);
    expect(existsSync(savedFile())).toBe(false);
  });

  it('refuses a scoped Bearer token with 403 and writes no file', async () => {
    const { token } = await createAccessToken({ name: 'ci', scopes: ['admin'], kind: 'token' });
    const res = await post({ origin: 'https://desk.tailnet.ts.net' }, { authorization: `Bearer ${token}` });
    expect(res.status).toBe(403);
    expect(existsSync(savedFile())).toBe(false);
  });

  it('answers 400 for a loopback origin or a missing origin and writes no file', async () => {
    const loopback = await post({ origin: 'http://127.0.0.1:9' }, asRootSession());
    expect(loopback.status).toBe(400);
    expect(loopback.json.error).toContain('only works on this machine');

    const missing = await post({}, asRootSession());
    expect(missing.status).toBe(400);

    const invalid = await post({ origin: 'ftp://x' }, asRootSession());
    expect(invalid.status).toBe(400);
    expect(existsSync(savedFile())).toBe(false);
  });

  it('answers 401 without a credential', async () => {
    const res = await post({ origin: 'https://desk.tailnet.ts.net' }, {});
    expect(res.status).toBe(401);
    expect(existsSync(savedFile())).toBe(false);
  });
});
