/**
 * PAN-4438 WI-3: the GET/POST test-removal-waiver routes are thin — origin
 * check, param/body parse, then `grantTestSkipWaiver` / the store readers.
 * Those are mocked; the live dashboard and filesystem are never touched.
 */
import { tmpdir } from 'node:os';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  snapshotWorkspaceHeads: vi.fn(),
  getIssueWorkspacePath: vi.fn(),
  grantTestSkipWaiver: vi.fn(),
  readTestSkipWaiver: vi.fn(),
}));

vi.mock('../../../../lib/git-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/git-utils.js')>();
  return { ...actual, snapshotWorkspaceHeads: mocks.snapshotWorkspaceHeads };
});

vi.mock('../../../../lib/overdeck/issue-projects.js', () => ({
  getIssueWorkspacePath: mocks.getIssueWorkspacePath,
}));

vi.mock('../../../../lib/cloister/test-skip-waiver.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/cloister/test-skip-waiver.js')>();
  return {
    ...actual,
    grantTestSkipWaiver: mocks.grantTestSkipWaiver,
    readTestSkipWaiver: mocks.readTestSkipWaiver,
  };
});

const { testRemovalWaiverRouteLayer } = await import('../test-removal-waiver.js');

async function call(method: string, path: string, init: { body?: unknown; origin?: string | null } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.origin !== null) headers.Origin = init.origin ?? 'http://localhost:3011';
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }));
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(testRemovalWaiverRouteLayer),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
  )));
  const payload = (response as { body: { body?: Uint8Array } }).body;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '';
  return { status: (response as { status?: number }).status ?? 200, json: text ? JSON.parse(text) : null };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getIssueWorkspacePath.mockReturnValue(tmpdir());
  mocks.snapshotWorkspaceHeads.mockResolvedValue('abc123');
  mocks.readTestSkipWaiver.mockReturnValue(null);
});

describe('GET /api/issues/:id/test-removal-waiver (PAN-4438)', () => {
  it('returns 400 for an invalid issue id', async () => {
    expect((await call('GET', '/api/issues/not-an-id/test-removal-waiver')).status).toBe(400);
  });

  it('returns active: true only when the stored waiver covers the live head', async () => {
    mocks.readTestSkipWaiver.mockReturnValue({ sha: 'abc123', reason: 'ok', at: '2026-09-30T00:00:00.000Z', by: 'operator' });

    const res = await call('GET', '/api/issues/PAN-4438/test-removal-waiver');

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ issueId: 'PAN-4438', head: 'abc123', headShort: 'abc123', active: true });
  });

  it('returns active: false when the stored waiver is pinned to a different head', async () => {
    mocks.readTestSkipWaiver.mockReturnValue({ sha: 'stale-sha', reason: 'ok', at: '2026-09-30T00:00:00.000Z', by: 'operator' });

    const res = await call('GET', '/api/issues/PAN-4438/test-removal-waiver');

    expect(res.json).toMatchObject({ active: false });
  });
});

describe('POST /api/issues/:id/test-removal-waiver (PAN-4438)', () => {
  it('refuses a missing/invalid Origin with 403 and never calls grant', async () => {
    const res = await call('POST', '/api/issues/PAN-4438/test-removal-waiver', { body: { reason: 'ok', head: 'abc123' }, origin: null });

    expect(res.status).toBe(403);
    expect(mocks.grantTestSkipWaiver).not.toHaveBeenCalled();
  });

  it('returns 400 when head is missing', async () => {
    const res = await call('POST', '/api/issues/PAN-4438/test-removal-waiver', { body: { reason: 'ok' } });

    expect(res.status).toBe(400);
    expect(mocks.grantTestSkipWaiver).not.toHaveBeenCalled();
  });

  it('maps an empty-reason refusal to 400', async () => {
    mocks.grantTestSkipWaiver.mockResolvedValue({ ok: false, code: 'empty-reason', message: 'A reason is required.' });

    const res = await call('POST', '/api/issues/PAN-4438/test-removal-waiver', { body: { reason: '  ', head: 'abc123' } });

    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ error: 'A reason is required.', code: 'empty-reason' });
  });

  it('maps a head-moved refusal to 409', async () => {
    mocks.grantTestSkipWaiver.mockResolvedValue({ ok: false, code: 'head-moved', message: 'stale' });

    const res = await call('POST', '/api/issues/PAN-4438/test-removal-waiver', { body: { reason: 'ok', head: 'stale-sha' } });

    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ error: 'stale', code: 'head-moved' });
  });

  it('grants with by: dashboard and returns 201 on success', async () => {
    mocks.grantTestSkipWaiver.mockResolvedValue({
      ok: true,
      waiver: { sha: 'abc123', reason: 'operator approved', at: '2026-09-30T00:00:00.000Z', by: 'dashboard' },
      workspacePath: '/tmp/ws',
    });

    const res = await call('POST', '/api/issues/PAN-4438/test-removal-waiver', { body: { reason: 'operator approved', head: 'abc123' } });

    expect(res.status).toBe(201);
    expect(res.json.waiver.by).toBe('dashboard');
    expect(mocks.grantTestSkipWaiver).toHaveBeenCalledWith({ issueId: 'PAN-4438', reason: 'operator approved', by: 'dashboard', expectedHead: 'abc123' });
  });
});
