/**
 * PAN-4945: the public OAuth routes for `/mcp` — discovery metadata, client
 * registration, the authorize page and its status, and the token and
 * revocation endpoints — behind the unchanged remote request gate, with a
 * `GET *` stub standing in for the SPA so a missing route would answer HTML.
 * Real access-token registry and store under a temporary OVERDECK_HOME.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

const LOOPBACK = '127.0.0.1';
const REDIRECT = 'http://127.0.0.1:8123/callback';
const originalHome = process.env.OVERDECK_HOME;
const originalPort = { API_PORT: process.env.API_PORT, PORT: process.env.PORT, DASHBOARD_URL: process.env.DASHBOARD_URL };
const home = mkdtempSync(join(tmpdir(), 'pan-4945-oauth-routes-'));
process.env.OVERDECK_HOME = home;
process.env.API_PORT = '3011';
delete process.env.PORT;
delete process.env.DASHBOARD_URL;

const { _resetAccessTokensForTests, _settleAccessTokenWritesForTests } = await import('../../../lib/access-tokens.js');
const { _resetMcpOAuthStoreForTests } = await import('../../../lib/mcp/oauth-store.js');
const { createMcpOAuthService } = await import('../../../lib/mcp/oauth-service.js');
const { _resetTrustedOriginsForTests } = await import('../routes/origin-validation.js');
const { remoteRequestGateLayer } = await import('../remote-request-gate.js');
const { issuerFor, makeMcpOAuthRouteLayer } = await import('../routes/mcp-oauth.js');

let service = createMcpOAuthService();
let app = buildApp();

function buildApp() {
  return Layer.mergeAll(
    remoteRequestGateLayer,
    makeMcpOAuthRouteLayer({ service, issuerFor }),
    HttpRouter.add('GET', '*', Effect.succeed(HttpServerResponse.text('<html>SPA</html>', { contentType: 'text/html' }))),
  );
}

interface SentResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
  json: unknown;
}

async function send(method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<SentResponse> {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost:3011${path}`, { method, headers: { host: 'localhost:3011', ...headers }, body }))
    .modify({ remoteAddress: Option.some(LOOPBACK) });
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
    json = null;
  }
  return { status: raw.status, headers: raw.headers, text, json };
}

async function registerClient(): Promise<string> {
  const response = await send('POST', '/oauth/mcp/register', { 'content-type': 'application/json' }, JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT] }));
  expect(response.status).toBe(201);
  return (response.json as { client_id: string }).client_id;
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
  _resetAccessTokensForTests();
  service = createMcpOAuthService();
  app = buildApp();
});

afterEach(async () => {
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  _resetMcpOAuthStoreForTests();
  rmSync(join(home, 'access-tokens.json'), { force: true });
  rmSync(join(home, 'mcp-oauth.json'), { force: true });
});

describe('discovery and registration (PAN-4945)', () => {
  it('answers authorization-server metadata built from the request host, never the SPA', async () => {
    const response = await send('GET', '/.well-known/oauth-authorization-server');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.text).not.toContain('SPA');
    expect(response.json).toMatchObject({ issuer: 'http://localhost:3011', token_endpoint: 'http://localhost:3011/oauth/mcp/token', code_challenge_methods_supported: ['S256'] });
  });

  it('answers protected-resource metadata for /mcp and refuses an unknown host', async () => {
    const response = await send('GET', '/.well-known/oauth-protected-resource/mcp');
    expect(response.json).toMatchObject({ resource: 'http://localhost:3011/mcp', authorization_servers: ['http://localhost:3011'] });
    await expect(send('GET', '/.well-known/oauth-protected-resource')).resolves.toMatchObject({ status: 200, json: { resource: 'http://localhost:3011/mcp' } });
    await expect(send('GET', '/.well-known/oauth-protected-resource/mcp', { host: 'evil.example' })).resolves.toMatchObject({ status: 400, json: { error: 'unknown host' } });
  });

  it('registers a loopback client and refuses a text/plain or oversized body', async () => {
    expect(await registerClient()).toMatch(/^odc_[0-9a-f]{32}$/);
    const plain = await send('POST', '/oauth/mcp/register', { 'content-type': 'text/plain' }, JSON.stringify({ redirect_uris: [REDIRECT] }));
    expect(plain).toMatchObject({ status: 400, json: { error: 'invalid_client_metadata' } });
    const huge = await send('POST', '/oauth/mcp/register', { 'content-type': 'application/json' }, JSON.stringify({ redirect_uris: [REDIRECT], pad: 'x'.repeat(17 * 1024) }));
    expect(huge.status).toBe(400);
    const broken = await send('POST', '/oauth/mcp/register', { 'content-type': 'application/json; charset=utf-8' }, '{nope');
    expect(broken).toMatchObject({ status: 400, json: { error: 'invalid_client_metadata' } });
  });

  it('leaves a Funnel request to the gate, which answers 404', async () => {
    const response = await send('GET', '/.well-known/oauth-authorization-server', { 'tailscale-funnel-request': '?1' });
    expect(response.status).toBe(404);
    expect(response.text).not.toContain('issuer');
  });
});
