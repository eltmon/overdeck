/**
 * PAN-4945: the OAuth service behind `/mcp` — registration, the authorize
 * request and its approval (D-5, D-6) and the code exchange (D-7).
 *
 * Real registry and store under a temporary OVERDECK_HOME. One test clock:
 * the service reads `Date.now() + offset`, so adding to `offset` moves only
 * the service (codes, approvals); access-token expiry follows `Date`.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Registry = typeof import('../../../../src/lib/access-tokens.js');
type Store = typeof import('../../../../src/lib/mcp/oauth-store.js');
type Service = typeof import('../../../../src/lib/mcp/oauth-service.js');

const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const REDIRECT = 'http://127.0.0.1:8123/callback';

let registry: Registry;
let store: Store;
let serviceModule: Service;
let service: ReturnType<Service['createMcpOAuthService']>;
let home: string;
let offset: number;
const originalHome = process.env.OVERDECK_HOME;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4945-service-'));
  process.env.OVERDECK_HOME = home;
  vi.resetModules();
  registry = await import('../../../../src/lib/access-tokens.js');
  store = await import('../../../../src/lib/mcp/oauth-store.js');
  serviceModule = await import('../../../../src/lib/mcp/oauth-service.js');
  offset = 0;
  service = serviceModule.createMcpOAuthService({ now: () => Date.now() + offset });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await registry._settleAccessTokenWritesForTests();
  registry._resetAccessTokensForTests();
  store._resetMcpOAuthStoreForTests();
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

async function register(name = 'Claude Desktop'): Promise<string> {
  const result = await service.registerClient({ client_name: name, redirect_uris: [REDIRECT] });
  if (!result.ok) throw new Error(`register failed: ${JSON.stringify(result.body)}`);
  return result.body.client_id as string;
}

function authorizeParams(clientId: string, extra: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT, response_type: 'code', code_challenge: CHALLENGE, code_challenge_method: 'S256', ...extra });
}

async function startSignIn(clientId: string, extra: Record<string, string> = {}): Promise<string> {
  const outcome = await service.authorize(authorizeParams(clientId, extra));
  if (outcome.kind !== 'page') throw new Error(`authorize gave ${outcome.kind}`);
  return outcome.requestId;
}

async function approvedCode(clientId: string, level = 'operate'): Promise<string> {
  const requestId = await startSignIn(clientId, { state: 'st-1' });
  expect(service.decideApproval(requestId, 'approve', level)).toEqual({ ok: true, status: 'approved' });
  const status = service.approvalStatus(requestId);
  if (status.status !== 'approved') throw new Error(`status ${status.status}`);
  return new URL(status.redirect).searchParams.get('code')!;
}

function exchangeForm(clientId: string, code: string, overrides: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: VERIFIER, ...overrides });
}

describe('registration (D-4)', () => {
  it('answers RFC 7591 fields for a public client', async () => {
    const result = await service.registerClient({ client_name: 'Claude', redirect_uris: [REDIRECT] });
    expect(result).toMatchObject({
      ok: true,
      body: { client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] },
    });
    expect((result as { body: { client_id: string } }).body.client_id).toMatch(/^odc_[0-9a-f]{32}$/);
  });

  it('refuses an invalid redirect URI with 400', async () => {
    await expect(service.registerClient({ redirect_uris: ['http://example.com/cb'] })).resolves.toMatchObject({ ok: false, status: 400, body: { error: 'invalid_redirect_uri' } });
  });

  it('evicts the oldest client with no sign-in when 50 are registered', async () => {
    const first = await register('first');
    for (let i = 1; i < 50; i += 1) {
      offset += 1;
      await register(`client ${i}`);
    }
    offset += 1;
    await register('fifty-first');
    const clients = (await store.readMcpOAuthData(Date.now() + offset)).clients;
    expect(clients).toHaveLength(50);
    expect(clients.some((c) => c.clientId === first)).toBe(false);
  });
});

describe('authorize and approvals (D-5, D-6)', () => {
  it('approves at operate and exchanges the code for tokens with the operate scopes', async () => {
    const clientId = await register();
    const requestId = await startSignIn(clientId, { state: 'st-1', scope: 'read message operate approve' });
    expect(service.listApprovals()).toMatchObject([{ id: requestId, clientId, clientName: 'Claude Desktop', redirectHost: '127.0.0.1:8123', requestedLevel: 'read' }]);
    expect(service.approvalStatus(requestId)).toEqual({ status: 'pending' });
    expect(service.decideApproval(requestId, 'approve', 'operate')).toEqual({ ok: true, status: 'approved' });

    const status = service.approvalStatus(requestId);
    expect(status.status).toBe('approved');
    const redirect = new URL((status as { redirect: string }).redirect);
    expect(redirect.origin + redirect.pathname).toBe(REDIRECT);
    expect(redirect.searchParams.get('state')).toBe('st-1');
    const code = redirect.searchParams.get('code')!;
    expect(code).toBeTruthy();

    const result = await service.exchangeCode(exchangeForm(clientId, code));
    expect(result).toMatchObject({ ok: true, body: { token_type: 'Bearer', expires_in: 2_592_000, scope: 'operate' } });
    const body = (result as { body: { access_token: string; refresh_token: string } }).body;
    expect(body.refresh_token).toMatch(/^odr_[0-9a-f]{64}$/);
    const verified = registry.verifyAccessToken(body.access_token);
    expect(verified).toMatchObject({ ok: true, record: { kind: 'token', scopes: ['read:state', 'read:conversations', 'tell', 'operate'], oauthClientId: clientId, name: 'Claude Desktop (OAuth)' } });
    const data = await store.readMcpOAuthData(Date.now());
    expect(data.families).toMatchObject([{ clientId, level: 'operate', accessTokenId: (verified as { record: { id: string } }).record.id }]);
    expect(JSON.stringify(data)).not.toContain(body.refresh_token);
    expect(data.clients[0]!.lastUsedAt).not.toBeNull();
    expect(service.approvalStatus(requestId)).toEqual({ status: 'expired' });
  });

  it('shows an error page for an unknown client or an unregistered redirect URI', async () => {
    const clientId = await register();
    await expect(service.authorize(authorizeParams(`odc_${'0'.repeat(32)}`))).resolves.toMatchObject({ kind: 'error-page' });
    await expect(service.authorize(authorizeParams(clientId, { redirect_uri: 'http://127.0.0.1:8123/elsewhere' }))).resolves.toMatchObject({ kind: 'error-page' });
    expect(service.listApprovals()).toEqual([]);
  });

  it('accepts a different loopback port at authorize', async () => {
    const clientId = await register();
    await expect(service.authorize(authorizeParams(clientId, { redirect_uri: 'http://127.0.0.1:55001/callback' }))).resolves.toMatchObject({ kind: 'page' });
  });

  it('redirects with error=invalid_request for code_challenge_method=plain', async () => {
    const clientId = await register();
    const outcome = await service.authorize(authorizeParams(clientId, { code_challenge_method: 'plain', state: 'st-2' }));
    expect(outcome.kind).toBe('redirect');
    const location = new URL((outcome as { location: string }).location);
    expect(location.origin + location.pathname).toBe(REDIRECT);
    expect(location.searchParams.get('error')).toBe('invalid_request');
    expect(location.searchParams.get('state')).toBe('st-2');
  });

  it('expires a pending approval at createdAt + 10 min + 1 s', async () => {
    const clientId = await register();
    const requestId = await startSignIn(clientId);
    offset += 10 * 60_000 + 1_000;
    expect(service.approvalStatus(requestId)).toEqual({ status: 'expired' });
    expect(service.decideApproval(requestId, 'approve', 'read')).toMatchObject({ ok: false, status: 404 });
    expect(service.approvalStatus('f'.repeat(32))).toEqual({ status: 'expired' });
  });

  it('redirects a denied sign-in with error=access_denied', async () => {
    const clientId = await register();
    const requestId = await startSignIn(clientId, { state: 'st-3' });
    expect(service.decideApproval(requestId, 'deny', undefined)).toEqual({ ok: true, status: 'denied' });
    const status = service.approvalStatus(requestId);
    expect(status.status).toBe('denied');
    const redirect = new URL((status as { redirect: string }).redirect);
    expect(redirect.searchParams.get('error')).toBe('access_denied');
    expect(redirect.searchParams.get('state')).toBe('st-3');
  });

  it('answers 409 for a decided approval and 400 for approve without a level', async () => {
    const clientId = await register();
    const requestId = await startSignIn(clientId);
    expect(service.decideApproval(requestId, 'approve', undefined)).toMatchObject({ ok: false, status: 400 });
    expect(service.decideApproval(requestId, 'approve', 'admin')).toMatchObject({ ok: false, status: 400 });
    expect(service.decideApproval(requestId, 'maybe', 'read')).toMatchObject({ ok: false, status: 400 });
    expect(service.decideApproval(requestId, 'deny', undefined)).toEqual({ ok: true, status: 'denied' });
    expect(service.decideApproval(requestId, 'approve', 'read')).toMatchObject({ ok: false, status: 409 });
    expect(service.decideApproval('0'.repeat(32), 'deny', undefined)).toMatchObject({ ok: false, status: 404 });
  });

  it('drops the oldest pending approval when the 21st arrives', async () => {
    const clientId = await register();
    const first = await startSignIn(clientId);
    for (let i = 0; i < 20; i += 1) {
      offset += 1;
      await startSignIn(clientId);
    }
    const pending = service.listApprovals();
    expect(pending).toHaveLength(20);
    expect(pending.some((approval) => approval.id === first)).toBe(false);
    expect(service.approvalStatus(first)).toEqual({ status: 'expired' });
  });
});

describe('code exchange (D-7)', () => {
  it('consumes a code on a wrong verifier, so the right verifier then fails too', async () => {
    const clientId = await register();
    const code = await approvedCode(clientId);
    await expect(service.exchangeCode(exchangeForm(clientId, code, { code_verifier: `${VERIFIER.slice(0, -1)}l` }))).resolves.toMatchObject({ ok: false, status: 400, body: { error: 'invalid_grant' } });
    await expect(service.exchangeCode(exchangeForm(clientId, code))).resolves.toMatchObject({ ok: false, status: 400, body: { error: 'invalid_grant' } });
  });

  it('refuses a wrong redirect_uri, a wrong client_id and missing fields', async () => {
    const clientId = await register();
    const code = await approvedCode(clientId);
    await expect(service.exchangeCode(exchangeForm(clientId, code, { redirect_uri: 'http://127.0.0.1:9999/callback' }))).resolves.toMatchObject({ body: { error: 'invalid_grant' } });
    const other = await approvedCode(clientId);
    await expect(service.exchangeCode(exchangeForm(`odc_${'0'.repeat(32)}`, other))).resolves.toMatchObject({ body: { error: 'invalid_grant' } });
    await expect(service.exchangeCode(new URLSearchParams({ grant_type: 'authorization_code', code: other }))).resolves.toMatchObject({ status: 400, body: { error: 'invalid_request' } });
  });

  it('refuses a code at now + 61 s', async () => {
    const clientId = await register();
    const code = await approvedCode(clientId);
    offset += 61_000;
    await expect(service.exchangeCode(exchangeForm(clientId, code))).resolves.toMatchObject({ ok: false, status: 400, body: { error: 'invalid_grant' } });
  });

  it('revokes the first access token when a used code is presented again', async () => {
    const clientId = await register();
    const code = await approvedCode(clientId);
    const first = await service.exchangeCode(exchangeForm(clientId, code));
    expect(first.ok).toBe(true);
    const accessToken = (first as { body: { access_token: string } }).body.access_token;
    expect(registry.verifyAccessToken(accessToken).ok).toBe(true);
    await expect(service.exchangeCode(exchangeForm(clientId, code))).resolves.toMatchObject({ ok: false, status: 400, body: { error: 'invalid_grant' } });
    expect(registry.verifyAccessToken(accessToken)).toEqual({ ok: false });
    const family = (await store.readMcpOAuthData(Date.now())).families[0]!;
    expect(family.revokedAt).toBeDefined();
  });

  it('ends the sign-in when a code is presented again while its first exchange is minting', async () => {
    const clientId = await register();
    const code = await approvedCode(clientId);
    const [a, b] = await Promise.all([service.exchangeCode(exchangeForm(clientId, code)), service.exchangeCode(exchangeForm(clientId, code))]);
    expect([a.ok, b.ok]).toEqual([false, false]);
    expect(registry.listActiveRecordsOfKind('token')).toEqual([]);
  });
});
