/**
 * PAN-4945 (epic AC-16): a stock MCP SDK client signs in to `/mcp` end to end.
 *
 * The app is the real remote request gate, the real `/mcp` route, the public
 * OAuth routes and the operator routes. The SDK's own helpers from
 * `@modelcontextprotocol/sdk/client/auth.js` drive discovery, registration,
 * authorization, code exchange and refresh through a `fetchFn` that
 * dispatches into the app as a loopback request. The operator approves the
 * sign-in with the internal token. Real registry and store under a temporary
 * OVERDECK_HOME; only `Date` is faked, for access-token expiry.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  exchangeAuthorization,
  extractWWWAuthenticateParams,
  refreshAuthorization,
  registerClient,
  selectResourceURL,
  startAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { InvalidGrantError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthClientInformationFull, OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGIN = 'http://localhost:3011';
const REDIRECT = 'http://127.0.0.1:53682/callback';
const INTERNAL_TOKEN = 'mcp-oauth-acceptance-internal-token-0123456789';
const originalHome = process.env.OVERDECK_HOME;
const originalPort = { API_PORT: process.env.API_PORT, PORT: process.env.PORT, DASHBOARD_URL: process.env.DASHBOARD_URL };
const home = mkdtempSync(join(tmpdir(), 'pan-4945-oauth-acceptance-'));
process.env.OVERDECK_HOME = home;
process.env.API_PORT = '3011';
delete process.env.PORT;
delete process.env.DASHBOARD_URL;

const { _resetAccessTokensForTests, _settleAccessTokenWritesForTests } = await import('../../../lib/access-tokens.js');
const { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } = await import('../../../lib/internal-token.js');
const { _resetMcpOAuthStoreForTests } = await import('../../../lib/mcp/oauth-store.js');
const { createMcpOAuthService } = await import('../../../lib/mcp/oauth-service.js');
const { _resetDashboardSessionTokenForTests } = await import('../routes/dashboard-auth.js');
const { _resetTrustedOriginsForTests } = await import('../routes/origin-validation.js');
const { remoteRequestGateLayer } = await import('../remote-request-gate.js');
const { makeMcpRouteLayer } = await import('../routes/mcp.js');
const { issuerFor, makeMcpOAuthRouteLayer } = await import('../routes/mcp-oauth.js');
const { makeMcpOAuthAdminRouteLayer } = await import('../routes/mcp-oauth-admin.js');

let app = buildApp();

function buildApp() {
  const service = createMcpOAuthService();
  return Layer.mergeAll(
    remoteRequestGateLayer,
    makeMcpRouteLayer({ makeApi: () => ({ request: async () => ({ status: 200, json: [] }) }) }),
    makeMcpOAuthRouteLayer({ service, issuerFor }),
    makeMcpOAuthAdminRouteLayer({ service }),
  ) as Layer.Layer<never, never, never>;
}

/** A Fetch API over the app: each call becomes a loopback request carrying the URL's host. */
async function fetchFn(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  const web = new Request(url, init);
  const headers = new Headers(web.headers);
  headers.set('host', url.host);
  const body = web.method === 'GET' || web.method === 'HEAD' ? undefined : await web.text();
  const request = HttpServerRequest.fromWeb(new Request(url, { method: web.method, headers, body }))
    .modify({ remoteAddress: Option.some('127.0.0.1') });
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(app),
    (handler) => Effect.provideService(handler, HttpServerRequest.HttpServerRequest, request),
  )));
  const raw = response as unknown as { status: number; headers: Record<string, string>; body: { body?: Uint8Array } };
  const text = raw.body.body ? new TextDecoder().decode(raw.body.body) : '';
  return new Response(raw.status === 204 || raw.status === 302 ? null : text, { status: raw.status, headers: raw.headers });
}

const TOOLS_LIST = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

function postMcp(accessToken?: string): Promise<Response> {
  return fetchFn(`${ORIGIN}/mcp`, {
    method: 'POST',
    headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
    body: TOOLS_LIST,
  });
}

function operator(path: string, init: RequestInit = {}): Promise<Response> {
  return fetchFn(`${ORIGIN}${path}`, { ...init, headers: { 'content-type': 'application/json', [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN } });
}

interface SignedIn {
  metadata: NonNullable<Awaited<ReturnType<typeof discoverAuthorizationServerMetadata>>>;
  clientInformation: OAuthClientInformationFull;
  accessToken: string;
  refreshToken: string;
}

/** Discover, register, authorize (no state), approve as the operator at `level`, and exchange the code. */
async function signIn(level: string, checkRequestedLevel = false): Promise<SignedIn> {
  const metadata = await discoverAuthorizationServerMetadata(ORIGIN, { fetchFn });
  if (!metadata) throw new Error('no authorization server metadata');
  const clientInformation = await registerClient(ORIGIN, { metadata, clientMetadata: { redirect_uris: [REDIRECT], client_name: 'acceptance' }, fetchFn });
  const { authorizationUrl, codeVerifier } = await startAuthorization(ORIGIN, { metadata, clientInformation, redirectUrl: REDIRECT, scope: 'read message operate approve' });
  expect(authorizationUrl.searchParams.has('state')).toBe(false);

  const page = await fetchFn(authorizationUrl);
  expect(page.status).toBe(200);
  const approvalCode = /class="code">([A-Z]{4}-[A-Z]{4})</.exec(await page.text())?.[1];
  expect(approvalCode).toBeDefined();

  const { approvals } = await (await operator('/api/mcp-oauth/approvals')).json() as { approvals: Array<{ id: string; approvalCode: string; requestedLevel: string }> };
  const approval = approvals.find((row) => row.approvalCode === approvalCode)!;
  if (checkRequestedLevel) expect(approval.requestedLevel).toBe('read');
  const decided = await operator(`/api/mcp-oauth/approvals/${approval.id}`, { method: 'POST', body: JSON.stringify({ decision: 'approve', level }) });
  expect(decided.status).toBe(200);

  const status = await (await fetchFn(`${ORIGIN}/oauth/mcp/authorize/status?request=${approval.id}`)).json() as { status: string; redirect: string };
  expect(status.status).toBe('approved');
  const code = new URL(status.redirect).searchParams.get('code')!;
  const tokens = await exchangeAuthorization(ORIGIN, { metadata, clientInformation, authorizationCode: code, codeVerifier, redirectUri: REDIRECT, fetchFn });
  return { metadata, clientInformation, accessToken: tokens.access_token, refreshToken: tokens.refresh_token! };
}

afterAll(() => {
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  for (const [name, value] of Object.entries(originalPort)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  _resetTrustedOriginsForTests();
  rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  _resetTrustedOriginsForTests();
  process.env.OVERDECK_INTERNAL_TOKEN = INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetAccessTokensForTests();
  app = buildApp();
});

afterEach(async () => {
  vi.useRealTimers();
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  _resetMcpOAuthStoreForTests();
  rmSync(join(home, 'access-tokens.json'), { force: true });
  rmSync(join(home, 'mcp-oauth.json'), { force: true });
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
});

describe('MCP SDK OAuth sign-in to /mcp (PAN-4945, epic AC-16)', () => {
  it('discovers, signs in, calls tools, rotates, and ends the sign-in on refresh reuse', async () => {
    // 1. The 401 points at the protected-resource metadata.
    const unauthorized = await postMcp();
    expect(unauthorized.status).toBe(401);
    const { resourceMetadataUrl } = extractWWWAuthenticateParams(unauthorized);
    expect(resourceMetadataUrl?.href).toBe(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`);

    // 2. Discovery names this dashboard, and the SDK accepts the advertised resource.
    const resource = await discoverOAuthProtectedResourceMetadata(`${ORIGIN}/mcp`, { resourceMetadataUrl }, fetchFn);
    expect(resource.authorization_servers?.[0]).toBe(ORIGIN);
    const provider = {} as OAuthClientProvider;
    await expect(selectResourceURL(`${ORIGIN}/mcp`, provider, resource)).resolves.toEqual(new URL(`${ORIGIN}/mcp`));

    // 3-7. Register, authorize with every scope and no state, approve at operate, exchange.
    const first = await signIn('operate', true);
    const listed = await postMcp(first.accessToken);
    expect(listed.status).toBe(200);
    const names = ((await listed.json()) as { result: { tools: Array<{ name: string }> } }).result.tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['list_machines', 'send_message', 'start_conversation']));
    expect(names).not.toContain('answer_permission');

    // 8. Refresh replaces both tokens; the old access token stops working.
    const { metadata, clientInformation } = first;
    const second = await refreshAuthorization(ORIGIN, { metadata, clientInformation, refreshToken: first.refreshToken, fetchFn });
    expect(second.access_token).not.toBe(first.accessToken);
    expect(second.refresh_token).not.toBe(first.refreshToken);
    expect((await postMcp(first.accessToken)).status).toBe(401);
    expect((await postMcp(second.access_token)).status).toBe(200);

    // 9. Reusing the first refresh token ends the sign-in.
    await expect(refreshAuthorization(ORIGIN, { metadata, clientInformation, refreshToken: first.refreshToken, fetchFn })).rejects.toBeInstanceOf(InvalidGrantError);
    expect((await postMcp(second.access_token)).status).toBe(401);
    await expect(refreshAuthorization(ORIGIN, { metadata, clientInformation, refreshToken: second.refresh_token!, fetchFn })).rejects.toBeInstanceOf(InvalidGrantError);
  });

  it('answers 401 with the challenge once a fresh sign-in passes its 30-day expiry', async () => {
    const signedIn = await signIn('read');
    expect((await postMcp(signedIn.accessToken)).status).toBe(200);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 30 * 24 * 60 * 60_000 + 1_000);
    const expired = await postMcp(signedIn.accessToken);
    expect(expired.status).toBe(401);
    expect(extractWWWAuthenticateParams(expired).resourceMetadataUrl?.href).toBe(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`);
  });
});
