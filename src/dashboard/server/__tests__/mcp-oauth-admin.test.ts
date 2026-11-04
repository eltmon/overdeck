/**
 * PAN-4945: the root-only MCP OAuth operator routes behind the unchanged
 * remote request gate. The gate keeps them `admin`; the handler then admits
 * only the internal token or the root session. Real registry and store under
 * a temporary OVERDECK_HOME.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

const LAN_PEER = '192.0.2.44';
const INTERNAL_TOKEN = 'mcp-oauth-admin-internal-token-0123456789';
const REDIRECT = 'http://127.0.0.1:8123/callback';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const originalHome = process.env.OVERDECK_HOME;
const home = mkdtempSync(join(tmpdir(), 'pan-4945-oauth-admin-'));
process.env.OVERDECK_HOME = home;

const { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken, verifyAccessToken } = await import('../../../lib/access-tokens.js');
const { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } = await import('../../../lib/internal-token.js');
const { _resetMcpOAuthStoreForTests } = await import('../../../lib/mcp/oauth-store.js');
const { createMcpOAuthService } = await import('../../../lib/mcp/oauth-service.js');
const { _resetDashboardSessionTokenForTests } = await import('../routes/dashboard-auth.js');
const { remoteRequestGateLayer } = await import('../remote-request-gate.js');
const { makeMcpOAuthAdminRouteLayer } = await import('../routes/mcp-oauth-admin.js');

let service = createMcpOAuthService();
let app = Layer.mergeAll(remoteRequestGateLayer, makeMcpOAuthAdminRouteLayer({ service }));

async function send(method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<{ status: number; headers: Record<string, string>; json: unknown }> {
  const request = HttpServerRequest.fromWeb(new Request(`http://dashboard.test${path}`, {
    method,
    headers: method === 'GET' ? headers : { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })).modify({ remoteAddress: Option.some(LAN_PEER) });
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(app),
    (handler) => Effect.provideService(handler, HttpServerRequest.HttpServerRequest, request),
  )));
  const raw = response as unknown as { status: number; headers: Record<string, string>; body: { body?: Uint8Array } };
  const text = raw.body.body ? new TextDecoder().decode(raw.body.body) : '';
  return { status: raw.status, headers: raw.headers, json: text ? JSON.parse(text) : null };
}

const asInternal = { [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN };

async function pendingApprovalId(): Promise<string> {
  const registered = await service.registerClient({ client_name: 'Claude', redirect_uris: [REDIRECT] });
  if (!registered.ok) throw new Error('register failed');
  const outcome = await service.authorize(new URLSearchParams({
    client_id: registered.body.client_id as string, redirect_uri: REDIRECT, response_type: 'code', code_challenge: CHALLENGE, code_challenge_method: 'S256',
  }));
  if (outcome.kind !== 'page') throw new Error(`authorize gave ${outcome.kind}`);
  return outcome.requestId;
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
  service = createMcpOAuthService();
  app = Layer.mergeAll(remoteRequestGateLayer, makeMcpOAuthAdminRouteLayer({ service }));
});

afterEach(async () => {
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  _resetMcpOAuthStoreForTests();
  rmSync(join(home, 'access-tokens.json'), { force: true });
  rmSync(join(home, 'mcp-oauth.json'), { force: true });
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
});

describe('MCP OAuth operator routes (PAN-4945)', () => {
  it('refuses a token with operate at the gate and a device with admin in the handler', async () => {
    const token = await createAccessToken({ name: 'sidecar', scopes: ['operate'], kind: 'token' });
    expect((await send('GET', '/api/mcp-oauth/approvals', { authorization: `Bearer ${token.token}` })).status).toBe(403);
    const device = await createAccessToken({ name: 'phone', scopes: ['admin'], kind: 'device' });
    const response = await send('GET', '/api/mcp-oauth/approvals', { authorization: `Bearer ${device.token}` });
    expect(response).toMatchObject({ status: 403, json: { error: 'only the internal token or the root session can manage MCP sign-ins' } });
  });

  it('lists a pending approval, approves it at message, and answers 409 to a second decision', async () => {
    const id = await pendingApprovalId();
    const listed = await send('GET', '/api/mcp-oauth/approvals', asInternal);
    expect(listed.status).toBe(200);
    expect(listed.headers['cache-control']).toBe('no-store');
    expect(listed.json).toMatchObject({ approvals: [{ id, clientName: 'Claude', redirectHost: '127.0.0.1:8123', requestedLevel: 'read' }] });
    await expect(send('POST', `/api/mcp-oauth/approvals/${id}`, asInternal, { decision: 'approve', level: 'message' })).resolves.toMatchObject({ status: 200, json: { status: 'approved' } });
    await expect(send('POST', `/api/mcp-oauth/approvals/${id}`, asInternal, { decision: 'deny' })).resolves.toMatchObject({ status: 409 });
    await expect(send('POST', `/api/mcp-oauth/approvals/${'0'.repeat(32)}`, asInternal, { decision: 'deny' })).resolves.toMatchObject({ status: 404 });
  });

  it('answers 400 for approve without a level', async () => {
    const id = await pendingApprovalId();
    await expect(send('POST', `/api/mcp-oauth/approvals/${id}`, asInternal, { decision: 'approve' })).resolves.toMatchObject({ status: 400 });
  });

  it('issues a headless sign-in, lists it, and revokes it once', async () => {
    const issued = await send('POST', '/api/mcp-oauth/issue', asInternal, { name: 'xAI', level: 'message' });
    expect(issued).toMatchObject({ status: 201, json: { level: 'message', expires_in: 2_592_000 } });
    const body = issued.json as { familyId: string; access_token: string; refresh_token: string };
    expect(body.access_token).toMatch(/^odk_/);
    expect(body.refresh_token).toMatch(/^odr_/);

    const signIns = await send('GET', '/api/mcp-oauth/sign-ins', asInternal);
    expect(signIns).toMatchObject({ status: 200, json: { signIns: [{ familyId: body.familyId, clientName: 'xAI', headless: true }] } });
    expect(JSON.stringify(signIns.json)).not.toContain(body.access_token);

    await expect(send('DELETE', `/api/mcp-oauth/sign-ins/${body.familyId}`, asInternal)).resolves.toMatchObject({ status: 200, json: { revoked: true } });
    expect(verifyAccessToken(body.access_token)).toEqual({ ok: false });
    await expect(send('DELETE', `/api/mcp-oauth/sign-ins/${body.familyId}`, asInternal)).resolves.toMatchObject({ status: 404 });
    await expect(send('POST', '/api/mcp-oauth/issue', asInternal, { name: 'x', level: 'admin' })).resolves.toMatchObject({ status: 400 });
  });
});
