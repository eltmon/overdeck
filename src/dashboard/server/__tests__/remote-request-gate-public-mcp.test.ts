/**
 * PAN-4947 WI-2: gate rule 0 admits exactly the nine public MCP surfaces from
 * Tailscale Funnel while `mcp.public.enabled` is on, matched on the raw path.
 *
 * `new Request()` normalizes `/api/../mcp` before the gate sees it, so every
 * request sets its raw URL with `.modify({ url })`, the way a Node server
 * passes `req.url` through unnormalized.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken } from '../../../lib/access-tokens.js';
import { _resetInternalTokenCacheForTests } from '../../../lib/internal-token.js';
import { invalidatePublicMcpConfig, PUBLIC_MCP_SURFACES } from '../../../lib/mcp/public-mcp.js';
import { invalidateRemoteAccessConfig } from '../../../lib/remote-access/config.js';
import { _resetDashboardSessionTokenForTests } from '../routes/dashboard-auth.js';
import { remoteRequestGateLayer } from '../remote-request-gate.js';

const FUNNEL = { 'tailscale-funnel-request': '?1' };
const originalHome = process.env.OVERDECK_HOME;
let home: string;

const reachedRoute = HttpRouter.add('*', '*', Effect.succeed(HttpServerResponse.text('reached')));
const app = Layer.mergeAll(remoteRequestGateLayer, reachedRoute);

async function send(method: string, rawUrl: string, headers: Record<string, string> = FUNNEL): Promise<number> {
  const request = HttpServerRequest.fromWeb(new Request('http://dashboard.test/', { method, headers }))
    .modify({ url: rawUrl, remoteAddress: Option.some('127.0.0.1') });
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(app),
    (handler) => Effect.provideService(handler, HttpServerRequest.HttpServerRequest, request),
  )));
  return (response as { status: number }).status;
}

async function setPublicMcp(enabled: boolean): Promise<void> {
  await writeFile(join(home, 'config.yaml'), `mcp:\n  public:\n    enabled: ${enabled}\n`, 'utf8');
  invalidatePublicMcpConfig();
}

const SURFACES = [...PUBLIC_MCP_SURFACES].map((surface) => surface.split(' ') as [string, string]);

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4947-gate-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = 'gate-internal-token';
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetAccessTokensForTests();
  invalidateRemoteAccessConfig();
  invalidatePublicMcpConfig();
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

describe('remote request gate: public MCP through Funnel (PAN-4947)', () => {
  it('lists nine surfaces', () => {
    expect(SURFACES).toHaveLength(9);
  });

  it('answers 404 on every surface while the switch is off, and still reaches POST /hooks/*', async () => {
    await setPublicMcp(false);
    for (const [method, path] of SURFACES) expect(await send(method, path), `${method} ${path}`).toBe(404);
    expect(await send('POST', '/hooks/x/y')).toBe(200);
  });

  it('answers 404 on every surface with no config.yaml', async () => {
    for (const [method, path] of SURFACES) expect(await send(method, path), `${method} ${path}`).toBe(404);
  });

  it('reaches every surface while the switch is on, query string included', async () => {
    await setPublicMcp(true);
    for (const [method, path] of SURFACES) expect(await send(method, path), `${method} ${path}`).toBe(200);
    expect(await send('GET', '/oauth/mcp/authorize?client_id=c&state=s')).toBe(200);
    expect(await send('POST', '/hooks/x/y')).toBe(200);
  });

  it.each([
    ['GET', '/api/agents'],
    ['GET', '/api/health'],
    ['GET', '/mcp'],
    ['DELETE', '/mcp'],
    ['GET', '/'],
    ['POST', '/mcp/'],
    ['POST', '//mcp'],
    ['POST', '/api/../mcp'],
    ['POST', '/%6Dcp'],
    ['POST', '/oauth/mcp/authorize'],
    ['GET', '/.well-known/oauth-protected-resource/'],
  ])('answers 404 to %s %s from Funnel while the switch is on', async (method, path) => {
    await setPublicMcp(true);
    expect(await send(method, path)).toBe(404);
  });

  it('answers 404 to a credentialed non-surface Funnel request', async () => {
    await setPublicMcp(true);
    const { token } = await createAccessToken({ name: 'phone', scopes: ['admin'], kind: 'device' });
    expect(await send('GET', '/api/settings', { ...FUNNEL, authorization: `Bearer ${token}` })).toBe(404);
  });

  it('leaves non-Funnel requests to the other rules', async () => {
    await setPublicMcp(true);
    expect(await send('POST', '/mcp', {})).toBe(200);
    expect(await send('GET', '/api/agents', {})).toBe(200);
  });
});
