/**
 * PAN-4947 WI-6: `GET`/`PUT /api/mcp/public` behind the unchanged remote
 * request gate. Only the internal token or the root session may use them; the
 * save door, the switch read and the trusted origins are injected.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const LAN_PEER = '192.0.2.44';
const INTERNAL_TOKEN = 'mcp-public-internal-token-0123456789';
const originalHome = process.env.OVERDECK_HOME;
const home = mkdtempSync(join(tmpdir(), 'pan-4947-mcp-public-'));
process.env.OVERDECK_HOME = home;

const { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken } = await import('../../../lib/access-tokens.js');
const { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } = await import('../../../lib/internal-token.js');
const { _resetDashboardSessionTokenForTests } = await import('../routes/dashboard-auth.js');
const { remoteRequestGateLayer } = await import('../remote-request-gate.js');
const { makeMcpPublicRouteLayer } = await import('../routes/mcp-public.js');

let enabled = false;
let origins: string[] = [];
const save = vi.fn(async (next: boolean) => {
  enabled = next;
});
const app = Layer.mergeAll(
  remoteRequestGateLayer,
  makeMcpPublicRouteLayer({ save, isEnabled: () => enabled, port: () => 4000, trustedOrigins: () => origins }),
);

async function send(method: string, headers: Record<string, string>, body?: string, peer = LAN_PEER) {
  const request = HttpServerRequest.fromWeb(new Request('http://dashboard.test/api/mcp/public', {
    method,
    headers: method === 'GET' ? headers : { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body }),
  })).modify({ remoteAddress: Option.some(peer) });
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(app),
    (handler) => Effect.provideService(handler, HttpServerRequest.HttpServerRequest, request),
  )));
  const raw = response as unknown as { status: number; headers: Record<string, string>; body: { body?: Uint8Array } };
  const text = raw.body.body ? new TextDecoder().decode(raw.body.body) : '';
  return { status: raw.status, headers: raw.headers, json: text ? JSON.parse(text) : null };
}

const asInternal = { [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN };
const COMMANDS = [
  'tailscale funnel --bg --https=8443 --set-path=/mcp http://127.0.0.1:4000/mcp',
  'tailscale funnel --bg --https=8443 --set-path=/.well-known http://127.0.0.1:4000/.well-known',
  'tailscale funnel --bg --https=8443 --set-path=/oauth http://127.0.0.1:4000/oauth',
];
const OFF_COMMANDS = [
  'tailscale funnel --https=8443 --set-path=/mcp off',
  'tailscale funnel --https=8443 --set-path=/.well-known off',
  'tailscale funnel --https=8443 --set-path=/oauth off',
];

afterAll(() => {
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  enabled = false;
  origins = [];
  save.mockClear();
  process.env.OVERDECK_INTERNAL_TOKEN = INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetAccessTokensForTests();
});

afterEach(async () => {
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  rmSync(join(home, 'access-tokens.json'), { force: true });
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
});

describe('/api/mcp/public (PAN-4947)', () => {
  it('answers the switch, the commands and no URL without a .ts.net origin', async () => {
    const response = await send('GET', asInternal);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json).toEqual({ enabled: false, funnelCommands: COMMANDS, funnelOffCommands: OFF_COMMANDS, mcpUrl: null });
  });

  it('answers the public /mcp URL for a .ts.net trusted origin', async () => {
    origins = ['http://localhost:3011', 'https://m.t.ts.net'];
    expect((await send('GET', asInternal)).json).toMatchObject({ mcpUrl: 'https://m.t.ts.net:8443/mcp' });
  });

  it('saves the switch on PUT and answers the new state', async () => {
    const response = await send('PUT', asInternal, JSON.stringify({ enabled: true }));
    expect(response.status).toBe(200);
    expect(save).toHaveBeenCalledExactlyOnceWith(true);
    expect(response.json).toMatchObject({ enabled: true, funnelCommands: COMMANDS });
  });

  it.each(['{"enabled":"yes"}', '{}', 'not json', '[true]'])('refuses the body %s with 400', async (body) => {
    const response = await send('PUT', asInternal, body);
    expect(response.status).toBe(400);
    expect(response.json).toEqual({ error: 'body must be { enabled: boolean }' });
    expect(save).not.toHaveBeenCalled();
  });

  it('refuses a plain token on both methods', async () => {
    const { token } = await createAccessToken({ name: 'cli', scopes: ['read:state'], kind: 'token' });
    const auth = { authorization: `Bearer ${token}` };
    expect((await send('GET', auth)).status).toBe(403);
    expect((await send('PUT', auth, JSON.stringify({ enabled: true }))).status).toBe(403);
    expect(save).not.toHaveBeenCalled();
  });

  it('refuses an admin device token (root credentials only)', async () => {
    const { token } = await createAccessToken({ name: 'phone', scopes: ['admin'], kind: 'device' });
    const response = await send('GET', { authorization: `Bearer ${token}` });
    expect(response.status).toBe(403);
    expect(response.json).toEqual({ error: 'only the internal token or the root session can change public MCP' });
  });

  it('refuses a cross-site PUT without the internal token', async () => {
    const response = await send('PUT', { origin: 'https://evil.example' }, JSON.stringify({ enabled: true }), '127.0.0.1');
    expect(response.status).toBe(401);
    expect(save).not.toHaveBeenCalled();
  });
});
