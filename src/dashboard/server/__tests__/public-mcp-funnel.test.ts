/**
 * PAN-4947 WI-5: the Funnel middleware rate-limits and audits every public MCP
 * request while the switch is on, and leaves every other request alone. The
 * limiter clock and the audit sink are injected (no real time, no event store).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EmitActivityOptions } from '../../../lib/activity-logger.js';
import { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken } from '../../../lib/access-tokens.js';
import { _resetInternalTokenCacheForTests } from '../../../lib/internal-token.js';
import { invalidatePublicMcpConfig, PUBLIC_MCP_SURFACES } from '../../../lib/mcp/public-mcp.js';
import { invalidateRemoteAccessConfig } from '../../../lib/remote-access/config.js';
import { makePublicMcpFunnelLayer } from '../public-mcp-funnel.js';
import { createFixedWindowLimiter } from '../public-mcp-rate-limit.js';
import { remoteRequestGateLayer } from '../remote-request-gate.js';
import { _resetDashboardSessionTokenForTests } from '../routes/dashboard-auth.js';

const FUNNEL = { 'tailscale-funnel-request': '?1', 'x-forwarded-for': '203.0.113.7, 10.0.0.1' };
const originalHome = process.env.OVERDECK_HOME;
let home: string;
let clock: number;
let audit: ReturnType<typeof vi.fn<(entry: EmitActivityOptions) => void>>;
let app: Layer.Layer<never, never, never>;

function makeApp(route: Layer.Layer<never, never, never>) {
  const middleware = makePublicMcpFunnelLayer({ limiter: createFixedWindowLimiter({ now: () => clock }), audit });
  return Layer.mergeAll(remoteRequestGateLayer, middleware, route);
}

const reachedRoute = HttpRouter.add('*', '*', Effect.succeed(HttpServerResponse.text('reached')));

async function send(method: string, url: string, headers: Record<string, string> = FUNNEL, layer = app) {
  const request = HttpServerRequest.fromWeb(new Request('http://dashboard.test/', { method, headers }))
    .modify({ url, remoteAddress: Option.some('127.0.0.1') });
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(layer),
    (handler) => Effect.provideService(handler, HttpServerRequest.HttpServerRequest, request),
  )));
  const raw = response as unknown as { status: number; headers: Record<string, string> };
  return { status: raw.status, headers: raw.headers };
}

async function setPublicMcp(enabled: boolean): Promise<void> {
  await writeFile(join(home, 'config.yaml'), `mcp:\n  public:\n    enabled: ${enabled}\n`, 'utf8');
  invalidatePublicMcpConfig();
}

async function oauthToken(n: string): Promise<string> {
  const { token } = await createAccessToken({
    name: `bot ${n} (OAuth)`, scopes: ['read:state'], kind: 'token',
    oauthClientId: `odc_${n.repeat(32)}`, oauthFamilyId: n.repeat(32),
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  });
  return token;
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4947-funnel-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = 'funnel-internal-token';
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetAccessTokensForTests();
  invalidateRemoteAccessConfig();
  invalidatePublicMcpConfig();
  clock = 1_000_000;
  audit = vi.fn<(entry: EmitActivityOptions) => void>();
  app = makeApp(reachedRoute);
  await setPublicMcp(true);
});

afterEach(async () => {
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  invalidateRemoteAccessConfig();
  invalidatePublicMcpConfig();
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('public MCP Funnel middleware (PAN-4947)', () => {
  it('never limits or audits a non-Funnel request', async () => {
    for (let i = 0; i < 25; i += 1) expect((await send('POST', '/oauth/mcp/register', {})).status).toBe(200);
    expect(audit).not.toHaveBeenCalled();
  });

  it('writes no entry for a Funnel surface request while the switch is off', async () => {
    await setPublicMcp(false);
    expect((await send('POST', '/mcp')).status).toBe(404);
    expect(audit).not.toHaveBeenCalled();
  });

  it('writes no entry for a Funnel request outside the surfaces', async () => {
    expect((await send('GET', '/api/agents')).status).toBe(404);
    expect(audit).not.toHaveBeenCalled();
  });

  it('refuses the 21st POST /oauth/mcp/register from one address with 429 and Retry-After', async () => {
    for (let i = 0; i < 20; i += 1) expect((await send('POST', '/oauth/mcp/register')).status).toBe(200);
    clock += 10_000;
    const refused = await send('POST', '/oauth/mcp/register');
    expect(refused.status).toBe(429);
    expect(refused.headers['retry-after']).toBe('50');
    expect(audit).toHaveBeenLastCalledWith({
      source: 'dashboard', level: 'warn', message: 'Public MCP POST /oauth/mcp/register 429', details: '{"clientId":null}',
    });
    expect((await send('POST', '/oauth/mcp/register', { ...FUNNEL, 'x-forwarded-for': '198.51.100.9' })).status).toBe(200);
    clock += 50_000;
    expect((await send('POST', '/oauth/mcp/register')).status).toBe(200);
  });

  it('gives the authorize status poll its own 60-per-minute bucket', async () => {
    for (let i = 0; i < 60; i += 1) expect((await send('GET', '/oauth/mcp/authorize/status?id=x')).status).toBe(200);
    expect((await send('GET', '/oauth/mcp/authorize/status?id=x')).status).toBe(429);
    // The other sign-in endpoints still have their own 20-per-minute address bucket.
    expect((await send('POST', '/oauth/mcp/token')).status).toBe(200);
  });

  it('limits POST /mcp per OAuth token, 60 per minute', async () => {
    const first = await oauthToken('1');
    const second = await oauthToken('2');
    for (let i = 0; i < 60; i += 1) {
      expect((await send('POST', '/mcp', { ...FUNNEL, authorization: `Bearer ${first}` })).status).toBe(200);
    }
    expect((await send('POST', '/mcp', { ...FUNNEL, authorization: `Bearer ${first}` })).status).toBe(429);
    expect((await send('POST', '/mcp', { ...FUNNEL, authorization: `Bearer ${second}` })).status).toBe(200);
  });

  it('puts a POST /mcp without an OAuth token in the 20-per-minute address bucket', async () => {
    const { token } = await createAccessToken({ name: 'cli', scopes: ['read:state'], kind: 'token' });
    for (let i = 0; i < 20; i += 1) {
      expect((await send('POST', '/mcp', { ...FUNNEL, authorization: `Bearer ${token}` })).status).toBe(200);
    }
    expect((await send('POST', '/mcp', { ...FUNNEL, authorization: `Bearer ${token}` })).status).toBe(429);
  });

  it('audits every surface exactly once, with the OAuth client id and never a secret', async () => {
    const token = await oauthToken('3');
    const surfaces = [...PUBLIC_MCP_SURFACES].map((surface) => surface.split(' ') as [string, string]);
    for (const [method, path] of surfaces) {
      const query = path === '/oauth/mcp/token' ? '?code=secret-code&code_verifier=secret-verifier' : '';
      await send(method, `${path}${query}`, { ...FUNNEL, authorization: `Bearer ${token}` });
    }
    expect(audit).toHaveBeenCalledTimes(surfaces.length);
    expect(audit.mock.calls.map(([entry]) => entry.message)).toEqual(
      surfaces.map(([method, path]) => `Public MCP ${method} ${path} 200`),
    );
    expect(audit.mock.calls[0]?.[0].details).toBe(JSON.stringify({ clientId: `odc_${'3'.repeat(32)}` }));
    const logged = JSON.stringify(audit.mock.calls);
    expect(logged).not.toContain(token);
    expect(logged).not.toContain('code=');
    expect(logged).not.toContain('code_verifier');
    expect(logged).not.toContain('secret');
    for (const [entry] of audit.mock.calls) expect(`${entry.message} ${entry.details}`).not.toContain('?');
  });

  it('audits the authorize page with its client_id and a message without the query', async () => {
    await send('GET', `/oauth/mcp/authorize?client_id=odc_${'a'.repeat(32)}&state=s`);
    expect(audit).toHaveBeenCalledOnce();
    expect(audit).toHaveBeenCalledWith({
      source: 'dashboard', level: 'info', message: 'Public MCP GET /oauth/mcp/authorize 200',
      details: JSON.stringify({ clientId: `odc_${'a'.repeat(32)}` }),
    });
  });

  it('audits a failing route once with status 500 and lets the failure through', async () => {
    const failing = HttpRouter.add('POST', '/oauth/mcp/revoke', Effect.die(new Error('boom')));
    const layer = makeApp(failing);
    const outcome = await send('POST', '/oauth/mcp/revoke', FUNNEL, layer).then((r) => r.status, () => 'rejected');
    expect(outcome === 500 || outcome === 'rejected').toBe(true);
    expect(audit).toHaveBeenCalledOnce();
    expect(audit.mock.calls[0]?.[0].message).toBe('Public MCP POST /oauth/mcp/revoke 500');
  });
});
