/**
 * PAN-4649 W-8: the `/mcp` route's own credential checks (D-4649-4), its 405
 * answers, and a stateless `tools/list` round trip, under a temporary
 * OVERDECK_HOME with the real access-token registry. The dashboard API the
 * tools would call is a stub; the end-to-end proxying is `mcp-acceptance`.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

const LAN_PEER = '192.0.2.44';
const INTERNAL_TOKEN = 'mcp-route-internal-token-0123456789';
const originalHome = process.env.OVERDECK_HOME;
const home = mkdtempSync(join(tmpdir(), 'pan-4649-mcp-route-'));
process.env.OVERDECK_HOME = home;

const { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken, revokeAccessToken } = await import('../../../lib/access-tokens.js');
const { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } = await import('../../../lib/internal-token.js');
const { ALL_TOOLS } = await import('../../../lib/mcp/server.js');
const { _resetDashboardSessionTokenForTests } = await import('../routes/dashboard-auth.js');
const { remoteRequestGateLayer } = await import('../remote-request-gate.js');
const { makeMcpRouteLayer } = await import('../routes/mcp.js');

const app = Layer.mergeAll(
  remoteRequestGateLayer,
  makeMcpRouteLayer({ makeApi: () => ({ request: async () => ({ status: 200, json: [] }) }) }),
);

const TOOLS_LIST = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
const MCP_HEADERS = { accept: 'application/json, text/event-stream', 'content-type': 'application/json' };

interface SentResponse {
  status: number;
  headers: Record<string, string>;
  json: unknown;
}

async function send(method: string, headers: Record<string, string>, body?: string): Promise<SentResponse> {
  const request = HttpServerRequest.fromWeb(new Request('http://dashboard.test/mcp', { method, headers, body }))
    .modify({ remoteAddress: Option.some(LAN_PEER) });
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(app),
    (handler) => Effect.provideService(handler, HttpServerRequest.HttpServerRequest, request),
  )));
  const raw = response as unknown as { status: number; headers: Record<string, string>; body: { body?: Uint8Array } };
  const text = raw.body.body ? new TextDecoder().decode(raw.body.body) : '';
  return { status: raw.status, headers: raw.headers, json: text ? JSON.parse(text) : null };
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

afterAll(() => {
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
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

describe('/mcp route (PAN-4649 W-8)', () => {
  it('refuses a request with no credential (401)', async () => {
    const response = await send('POST', MCP_HEADERS, TOOLS_LIST);
    expect(response.status).toBe(401);
    expect(response.json).toEqual({ error: 'unauthorized' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('refuses the internal token: MCP is always fenced (403)', async () => {
    const response = await send('POST', { ...MCP_HEADERS, [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN }, TOOLS_LIST);
    expect(response.status).toBe(403);
    expect(response.json).toEqual({ error: expect.stringContaining('without admin scope') });
  });

  it('refuses an admin token (403)', async () => {
    const { token } = await createAccessToken({ name: 'too-strong', scopes: ['admin'], kind: 'token' });
    expect((await send('POST', { ...MCP_HEADERS, ...bearer(token) }, TOOLS_LIST)).status).toBe(403);
  });

  it('refuses a paired-device credential (403)', async () => {
    const { token } = await createAccessToken({ name: 'phone', scopes: ['read:conversations'], kind: 'device' });
    expect((await send('POST', { ...MCP_HEADERS, ...bearer(token) }, TOOLS_LIST)).status).toBe(403);
  });

  it('refuses an untrusted Origin even with a valid token (403)', async () => {
    const { token } = await createAccessToken({ name: 'mcp', scopes: ['read:conversations'], kind: 'token' });
    const response = await send('POST', { ...MCP_HEADERS, ...bearer(token), origin: 'https://evil.example' }, TOOLS_LIST);
    expect(response.status).toBe(403);
  });

  it('answers GET and DELETE with 405 and Allow: POST', async () => {
    for (const method of ['GET', 'DELETE']) {
      const response = await send(method, {});
      expect(response.status, method).toBe(405);
      expect(response.headers['allow'], method).toBe('POST');
      expect(response.json, method).toEqual({ error: 'method_not_allowed' });
    }
  });

  it('lists its visible tools for a valid MCP token, then refuses the token after revocation', async () => {
    const { token, record } = await createAccessToken({ name: 'mcp', scopes: ['read:state', 'read:conversations', 'operate'], kind: 'token' });
    const headers = { ...MCP_HEADERS, ...bearer(token) };

    const listed = await send('POST', headers, TOOLS_LIST);
    expect(listed.status).toBe(200);
    expect(listed.headers['cache-control']).toBe('no-store');
    expect(listed.headers['mcp-session-id']).toBeUndefined();
    const result = (listed.json as { result: { tools: Array<{ name: string }> } }).result;
    expect(result.tools.map((tool) => tool.name)).toEqual(ALL_TOOLS.filter((tool) => tool.scope !== 'approve' && tool.audience === 'any').map((tool) => tool.name));

    await revokeAccessToken(record.id);
    expect((await send('POST', headers, TOOLS_LIST)).status).toBe(401);
  });
});
