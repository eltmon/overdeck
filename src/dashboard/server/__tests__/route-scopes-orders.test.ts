/** PAN-5598 WI-1: order-book routes resolve to agent-held scopes, and the mutation gate honors them on a DELETE that carries a body. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Option } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken } from '../../../lib/access-tokens.js';
import { _resetInternalTokenCacheForTests } from '../../../lib/internal-token.js';
import { ROUTE_SCOPES, requiredScopeFor } from '../route-scopes.js';
import { _resetDashboardSessionTokenForTests, rejectUnsafeDashboardMutationRequest } from '../routes/dashboard-auth.js';

const originalHome = process.env.OVERDECK_HOME;
let home: string;

function fakeRequest(headers: Record<string, string>, route: { method: string; url: string }) {
  return { ...route, headers, remoteAddress: Option.none() } as unknown as Parameters<typeof rejectUnsafeDashboardMutationRequest>[0];
}

async function bodyOf(response: ReturnType<typeof rejectUnsafeDashboardMutationRequest>) {
  const raw = response as unknown as { body: { body?: Uint8Array } };
  return JSON.parse(new TextDecoder().decode(raw.body.body));
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-5598-orders-scope-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = 'orders-scope-internal-token';
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetAccessTokensForTests();
});

afterEach(async () => {
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('order-book route scopes (PAN-5598 AC-1)', () => {
  it('maps reads to read:state and writes to operate', () => {
    expect(requiredScopeFor('GET', '/api/orders')).toBe('read:state');
    expect(requiredScopeFor('PATCH', '/api/orders/b')).toBe('operate');
    expect(requiredScopeFor('POST', '/api/orders')).toBe('operate');
    expect(requiredScopeFor('GET', '/api/orders/b')).toBe('read:state');
    expect(requiredScopeFor('GET', '/api/orders/b/preview-brief')).toBe('read:state');
    expect(requiredScopeFor('POST', '/api/orders/b/start')).toBe('operate');
    expect(requiredScopeFor('POST', '/api/orders/b/items')).toBe('operate');
    expect(requiredScopeFor('PATCH', '/api/orders/b/items/PAN-1')).toBe('operate');
    expect(requiredScopeFor('DELETE', '/api/orders/b/items/PAN-1')).toBe('operate');
  });

  it('matches GET /api/orders/backlog-candidates on its own row, not the :id row', () => {
    expect(requiredScopeFor('GET', '/api/orders/backlog-candidates')).toBe('read:state');
    const found = ROUTE_SCOPES.find((entry) => entry.method === 'GET' && (entry.path === '/api/orders/backlog-candidates' || entry.path === '/api/orders/:id'));
    expect(found?.path).toBe('/api/orders/backlog-candidates');
  });
});

describe('order-book DELETE mutation gate (PAN-5598 AC-1)', () => {
  const json = { 'content-type': 'application/json' };
  const route = { method: 'DELETE', url: '/api/orders/b/items/PAN-1' };

  it('admits an operate token with a JSON body', async () => {
    const { token } = await createAccessToken({ name: 'agent', scopes: ['operate'], kind: 'token' });
    const request = fakeRequest({ ...json, authorization: `Bearer ${token}` }, route);
    expect(rejectUnsafeDashboardMutationRequest(request)).toBeNull();
  });

  it('403s a read:state-only token with missingScope operate', async () => {
    const { token } = await createAccessToken({ name: 'reader', scopes: ['read:state'], kind: 'token' });
    const request = fakeRequest({ ...json, authorization: `Bearer ${token}` }, route);
    const rejection = rejectUnsafeDashboardMutationRequest(request);
    expect(rejection?.status).toBe(403);
    expect(await bodyOf(rejection)).toEqual({ error: 'insufficient_scope', missingScope: 'operate' });
  });
});
