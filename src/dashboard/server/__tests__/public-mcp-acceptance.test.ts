/**
 * PAN-4947 (epic AC-18): public MCP through Tailscale Funnel, end to end.
 *
 * The app is the real remote request gate, the real Funnel middleware (with an
 * injected audit sink and a fixed limiter clock), the real `/mcp` route, the
 * public OAuth routes and the operator routes, under a temporary OVERDECK_HOME
 * with the real token registry and OAuth store. Funnel requests carry
 * `tailscale-funnel-request` and `x-forwarded-for` from a loopback peer, the
 * way tailscaled proxies them. `DASHBOARD_URL` is a `.ts.net` origin so the
 * OAuth issuer has a Funnel base.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterAll, describe, expect, it, vi } from 'vitest';

import type { EmitActivityOptions } from '../../../lib/activity-logger.js';

const INTERNAL_TOKEN = 'public-mcp-acceptance-internal-token-0123456789';
const FUNNEL = { 'tailscale-funnel-request': '?1', 'x-forwarded-for': '203.0.113.7' };
const original = {
  OVERDECK_HOME: process.env.OVERDECK_HOME,
  API_PORT: process.env.API_PORT,
  PORT: process.env.PORT,
  DASHBOARD_URL: process.env.DASHBOARD_URL,
  OVERDECK_INTERNAL_TOKEN: process.env.OVERDECK_INTERNAL_TOKEN,
};
const home = mkdtempSync(join(tmpdir(), 'pan-4947-acceptance-'));
process.env.OVERDECK_HOME = home;
process.env.API_PORT = '3011';
delete process.env.PORT;
process.env.DASHBOARD_URL = 'https://m.t.ts.net';
process.env.OVERDECK_INTERNAL_TOKEN = INTERNAL_TOKEN;

const { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken } = await import('../../../lib/access-tokens.js');
const { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } = await import('../../../lib/internal-token.js');
const { _resetMcpOAuthStoreForTests } = await import('../../../lib/mcp/oauth-store.js');
const { createMcpOAuthService } = await import('../../../lib/mcp/oauth-service.js');
const { invalidatePublicMcpConfig, PUBLIC_MCP_SURFACES } = await import('../../../lib/mcp/public-mcp.js');
const { savePublicMcpEnabled } = await import('../../../lib/mcp/public-mcp-write.js');
const { _resetDashboardSessionTokenForTests } = await import('../routes/dashboard-auth.js');
const { _resetTrustedOriginsForTests } = await import('../routes/origin-validation.js');
const { remoteRequestGateLayer } = await import('../remote-request-gate.js');
const { makePublicMcpFunnelLayer } = await import('../public-mcp-funnel.js');
const { createFixedWindowLimiter } = await import('../public-mcp-rate-limit.js');
const { makeMcpRouteLayer } = await import('../routes/mcp.js');
const { issuerFor, makeMcpOAuthRouteLayer } = await import('../routes/mcp-oauth.js');
const { makeMcpOAuthAdminRouteLayer } = await import('../routes/mcp-oauth-admin.js');

_resetTrustedOriginsForTests();
_resetInternalTokenCacheForTests();
_resetDashboardSessionTokenForTests();
_resetAccessTokensForTests();
invalidatePublicMcpConfig();

const audit = vi.fn<(entry: EmitActivityOptions) => void>();
const service = createMcpOAuthService();
const app = Layer.mergeAll(
  remoteRequestGateLayer,
  makePublicMcpFunnelLayer({ limiter: createFixedWindowLimiter({ now: () => 1_000_000 }), audit }),
  makeMcpRouteLayer({ makeApi: () => ({ request: async () => ({ status: 200, json: [] }) }) }),
  makeMcpOAuthRouteLayer({ service, issuerFor }),
  makeMcpOAuthAdminRouteLayer({ service }),
) as Layer.Layer<never, never, never>;

const TOOLS_LIST = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
const MCP_HEADERS = { accept: 'application/json, text/event-stream', 'content-type': 'application/json' };

async function send(method: string, path: string, headers: Record<string, string>, body?: string) {
  const request = HttpServerRequest.fromWeb(new Request(`http://dashboard.test${path}`, { method, headers, body }))
    .modify({ remoteAddress: Option.some('127.0.0.1') });
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(app),
    (handler) => Effect.provideService(handler, HttpServerRequest.HttpServerRequest, request),
  )));
  const raw = response as unknown as { status: number; headers: Record<string, string>; body: { body?: Uint8Array } };
  const text = raw.body.body ? new TextDecoder().decode(raw.body.body) : '';
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: raw.status, headers: raw.headers, json };
}

function funnelMcp(token: string) {
  return send('POST', '/mcp', { ...FUNNEL, ...MCP_HEADERS, authorization: `Bearer ${token}` }, TOOLS_LIST);
}

const SURFACES = [...PUBLIC_MCP_SURFACES].map((surface) => surface.split(' ') as [string, string]);

afterAll(async () => {
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  _resetMcpOAuthStoreForTests();
  invalidatePublicMcpConfig();
  for (const [name, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  _resetTrustedOriginsForTests();
  _resetInternalTokenCacheForTests();
  rmSync(home, { recursive: true, force: true });
});

describe('public MCP through Tailscale Funnel (PAN-4947, epic AC-18)', () => {
  it('is 404 while off; while on, OAuth works, a plain token is 403, the 61st call is 429, and each call is audited without a token', async () => {
    const issued = await send('POST', '/api/mcp-oauth/issue', {
      'content-type': 'application/json', [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN,
    }, JSON.stringify({ name: 'xAI', level: 'message' }));
    expect(issued.status).toBe(201);
    const oauthToken = (issued.json as { access_token: string }).access_token;
    const { token: plainToken } = await createAccessToken({ name: 'cli', scopes: ['read:state'], kind: 'token' });

    // 1. Switch off: every surface from Funnel is 404 and nothing is audited.
    for (const [method, path] of SURFACES) {
      expect((await send(method, path, { ...FUNNEL, authorization: `Bearer ${oauthToken}` })).status, `${method} ${path}`).toBe(404);
    }
    expect(audit).not.toHaveBeenCalled();

    // 2. Switch on through the write door; the gate sees it on the next request.
    await savePublicMcpEnabled(true);
    const listed = await funnelMcp(oauthToken);
    expect(listed.status).toBe(200);
    expect((listed.json as { result: { tools: unknown[] } }).result.tools.length).toBeGreaterThan(0);
    const metadata = await send('GET', '/.well-known/oauth-authorization-server', FUNNEL);
    expect(metadata.status).toBe(200);
    expect((metadata.json as { issuer: string }).issuer).toBe('https://m.t.ts.net:8443');
    const plain = await funnelMcp(plainToken);
    expect(plain.status).toBe(403);
    expect(plain.json).toEqual({ error: 'public MCP accepts only OAuth sign-ins' });
    expect((await send('GET', '/api/agents', { ...FUNNEL, authorization: `Bearer ${oauthToken}` })).status).toBe(404);

    // 3. Sixty calls per sign-in per minute (the first one above counts); the 61st is 429.
    for (let i = 0; i < 59; i += 1) expect((await funnelMcp(oauthToken)).status).toBe(200);
    const limited = await funnelMcp(oauthToken);
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('60');

    // 4. One entry per Funnel surface request while on (GET /api/agents is not a surface), no token anywhere.
    expect(audit).toHaveBeenCalledTimes(1 + 1 + 1 + 59 + 1);
    for (const [entry] of audit.mock.calls) expect(entry.message).toMatch(/^Public MCP (POST \/mcp|GET \/\.well-known\/oauth-authorization-server) \d{3}$/);
    const logged = JSON.stringify(audit.mock.calls);
    expect(logged).not.toContain(oauthToken);
    expect(logged).not.toContain(plainToken);
  });
});
