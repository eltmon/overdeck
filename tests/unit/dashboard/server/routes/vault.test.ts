/** PAN-4307 WI-6: the six /api/vault/* routes map onto vault-service, no route touches evict.ts directly. */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _resetInternalTokenCacheForTests } from '../../../../../src/lib/internal-token.js';
import {
  DASHBOARD_CSRF_HEADER,
  DASHBOARD_SESSION_COOKIE,
  _resetDashboardSessionTokenForTests,
} from '../../../../../src/dashboard/server/routes/dashboard-auth.js';

const mocks = vi.hoisted(() => ({
  getVaultServiceSnapshot: vi.fn(),
  reviewEvictionBatch: vi.fn(),
  confirmEvictionBatch: vi.fn(),
  declineEvictionEntry: vi.fn(),
  clearEvictionBatch: vi.fn(),
  reofferEvictionEntry: vi.fn(),
}));

vi.mock('../../../../../src/dashboard/server/services/vault-service.js', () => mocks);

const { vaultRouteLayer } = await import('../../../../../src/dashboard/server/routes/vault.js');

const SESSION = 'test-session-token';
const CSRF = 'test-csrf-token';

async function call(
  method: 'GET' | 'POST',
  path: string,
  options: { body?: unknown; csrf?: boolean } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { cookie: `${DASHBOARD_SESSION_COOKIE}=${SESSION}` };
  if (method === 'POST') {
    headers['content-type'] = 'application/json';
    if (options.csrf !== false) headers[DASHBOARD_CSRF_HEADER] = CSRF;
  }
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, {
    method,
    headers,
    ...(method === 'POST' ? { body: JSON.stringify(options.body ?? {}) } : {}),
  }));
  const response = await Effect.runPromise(Effect.scoped(
    Effect.flatMap(HttpRouter.toHttpEffect(vaultRouteLayer), (app) =>
      Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
    ),
  ));
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
}

beforeEach(() => {
  process.env.OVERDECK_INTERNAL_TOKEN = 'test-internal-token';
  process.env.OVERDECK_DASHBOARD_SESSION_TOKEN = SESSION;
  process.env.OVERDECK_DASHBOARD_CSRF_TOKEN = CSRF;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  for (const mock of Object.values(mocks)) mock.mockReset();
});

afterEach(() => {
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  delete process.env.OVERDECK_DASHBOARD_SESSION_TOKEN;
  delete process.env.OVERDECK_DASHBOARD_CSRF_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
});

describe('vault routes', () => {
  it('GET /api/vault/status returns the vault-service snapshot', async () => {
    mocks.getVaultServiceSnapshot.mockResolvedValue({ state: 'ready', running: true, backend: 'dir:x', evict: false, lastSync: null, machines: [] });
    const result = await call('GET', '/api/vault/status');
    expect(result).toEqual({ status: 200, body: { state: 'ready', running: true, backend: 'dir:x', evict: false, lastSync: null, machines: [] } });
  });

  it('GET /api/vault/eviction-batch returns the FR-9 shape', async () => {
    const batch = { evict: true, fingerprint: 'fp', entries: [], declined: [], totalBytes: 0, deletableCount: 0, deletableBytes: 0 };
    mocks.reviewEvictionBatch.mockResolvedValue(batch);
    const result = await call('GET', '/api/vault/eviction-batch');
    expect(result).toEqual({ status: 200, body: batch });
  });

  it('POST confirm without the CSRF header returns 403 and never confirms', async () => {
    const result = await call('POST', '/api/vault/eviction-batch/confirm', { body: { fingerprint: 'fp' }, csrf: false });
    expect(result.status).toBe(403);
    expect(mocks.confirmEvictionBatch).not.toHaveBeenCalled();
  });

  it('POST confirm requires a non-empty fingerprint', async () => {
    const result = await call('POST', '/api/vault/eviction-batch/confirm', { body: {} });
    expect(result.status).toBe(400);
    expect(mocks.confirmEvictionBatch).not.toHaveBeenCalled();
  });

  it('POST confirm with a stale fingerprint returns 409 batch-changed and the current fingerprint', async () => {
    mocks.confirmEvictionBatch.mockResolvedValue({ refused: true, fingerprint: 'current-fp' });
    const result = await call('POST', '/api/vault/eviction-batch/confirm', { body: { fingerprint: 'stale-fp' } });
    expect(result).toEqual({ status: 409, body: { error: 'The pending-deletion batch changed since it was displayed.', code: 'batch-changed', fingerprint: 'current-fp' } });
    expect(mocks.confirmEvictionBatch).toHaveBeenCalledWith('stale-fp');
  });

  it('POST confirm passes through the confirm result on success', async () => {
    mocks.confirmEvictionBatch.mockResolvedValue({ refused: false, deleted: ['/a.jsonl'], skipped: [], bytesFreed: 100, fingerprint: 'fp-after' });
    const result = await call('POST', '/api/vault/eviction-batch/confirm', { body: { fingerprint: 'fp' } });
    expect(result).toEqual({ status: 200, body: { deleted: ['/a.jsonl'], skipped: [], bytesFreed: 100, fingerprint: 'fp-after' } });
  });

  it('POST confirm returns 409 vault-unavailable when the vault is not open', async () => {
    mocks.confirmEvictionBatch.mockResolvedValue({ unavailable: 'Session Vault is off. Run: pan vault setup <git-url>' });
    const result = await call('POST', '/api/vault/eviction-batch/confirm', { body: { fingerprint: 'fp' } });
    expect(result).toEqual({ status: 409, body: { error: 'Session Vault is off. Run: pan vault setup <git-url>', code: 'vault-unavailable' } });
  });

  it('POST decline requires a non-empty vaultId and otherwise returns the refreshed batch', async () => {
    const missing = await call('POST', '/api/vault/eviction-batch/decline', { body: {} });
    expect(missing.status).toBe(400);
    expect(mocks.declineEvictionEntry).not.toHaveBeenCalled();

    const refreshed = { evict: true, fingerprint: 'fp2', entries: [], declined: [{ vaultId: 'v1', nativePath: '/a', declinedAt: 't' }], totalBytes: 0, deletableCount: 0, deletableBytes: 0 };
    mocks.declineEvictionEntry.mockResolvedValue(refreshed);
    const result = await call('POST', '/api/vault/eviction-batch/decline', { body: { vaultId: 'v1' } });
    expect(result).toEqual({ status: 200, body: refreshed });
    expect(mocks.declineEvictionEntry).toHaveBeenCalledWith('v1');
  });

  it('POST clear without the CSRF header returns 403; with it, returns the refreshed batch', async () => {
    const refused = await call('POST', '/api/vault/eviction-batch/clear', { csrf: false });
    expect(refused.status).toBe(403);
    expect(mocks.clearEvictionBatch).not.toHaveBeenCalled();

    const refreshed = { evict: true, fingerprint: 'fp3', entries: [], declined: [], totalBytes: 0, deletableCount: 0, deletableBytes: 0 };
    mocks.clearEvictionBatch.mockResolvedValue(refreshed);
    const result = await call('POST', '/api/vault/eviction-batch/clear');
    expect(result).toEqual({ status: 200, body: refreshed });
  });

  it('POST reoffer requires a non-empty vaultId and otherwise returns the refreshed batch', async () => {
    const missing = await call('POST', '/api/vault/eviction-batch/reoffer', { body: {} });
    expect(missing.status).toBe(400);
    expect(mocks.reofferEvictionEntry).not.toHaveBeenCalled();

    const refreshed = { evict: true, fingerprint: 'fp4', entries: [{ vaultId: 'v1', title: 't', harness: 'claude-code', nativePath: '/a', sizeBytes: 1, verification: 'verified' as const, checkedAt: 'x' }], declined: [], totalBytes: 1, deletableCount: 1, deletableBytes: 1 };
    mocks.reofferEvictionEntry.mockResolvedValue(refreshed);
    const result = await call('POST', '/api/vault/eviction-batch/reoffer', { body: { vaultId: 'v1' } });
    expect(result).toEqual({ status: 200, body: refreshed });
    expect(mocks.reofferEvictionEntry).toHaveBeenCalledWith('v1');
  });
});
