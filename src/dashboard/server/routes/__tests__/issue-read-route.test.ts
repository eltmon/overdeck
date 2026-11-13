/**
 * PAN-5171 WI-2: `GET /api/issues/:id` reads the shared issue service
 * (cycle: 'all'), backfills through the tracker door when the service lacks
 * the row, and distinguishes a real 404 from a tracker outage (503).
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../../http-helpers.js';

const mocks = vi.hoisted(() => ({
  getIssues: vi.fn(),
  backfillIssue: vi.fn(),
  missingIssueFailureKind: vi.fn(),
}));

vi.mock('../../services/issue-service-singleton.js', () => ({
  getSharedIssueService: () => ({
    getIssues: mocks.getIssues,
    backfillIssue: mocks.backfillIssue,
  }),
}));

vi.mock('../../services/issue-title-fallback.js', () => ({
  missingIssueFailureKind: mocks.missingIssueFailureKind,
}));

const { issueReadRouteLayer } = await import('../issue-read.js');

async function call(path: string, layer: Layer.Layer<HttpRouter.HttpRouter, never, never> = issueReadRouteLayer) {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, { method: 'GET' }));
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(layer),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
  )));
  const payload = (response as { body: { body?: Uint8Array } }).body;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '';
  return { status: (response as { status?: number }).status ?? 200, json: text ? JSON.parse(text) : null };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getIssues.mockReturnValue([]);
  mocks.backfillIssue.mockResolvedValue(undefined);
  mocks.missingIssueFailureKind.mockReturnValue(null);
});

describe('GET /api/issues/:id (PAN-5171)', () => {
  it('returns the row from the cycle: all snapshot and never calls backfillIssue', async () => {
    mocks.getIssues.mockReturnValue([{ identifier: 'PAN-7', title: 'Canceled row' }]);

    const res = await call('/api/issues/PAN-7');

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ identifier: 'PAN-7', title: 'Canceled row' });
    expect(mocks.backfillIssue).not.toHaveBeenCalled();
    expect(mocks.getIssues).toHaveBeenCalledWith({ cycle: 'all', includeCompleted: true });
  });

  it('matches the id case-insensitively', async () => {
    mocks.getIssues.mockReturnValue([{ identifier: 'PAN-7', title: 'Canceled row' }]);

    const res = await call('/api/issues/pan-7');

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ identifier: 'PAN-7' });
  });

  it('backfills an issue absent from the snapshot and returns the backfilled row', async () => {
    mocks.getIssues
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ identifier: 'PAN-9', title: 'Backfilled' }]);

    const res = await call('/api/issues/PAN-9');

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ identifier: 'PAN-9', title: 'Backfilled' });
    expect(mocks.backfillIssue).toHaveBeenCalledWith('PAN-9');
  });

  it('returns 404 when the failure kind is not-found', async () => {
    mocks.missingIssueFailureKind.mockReturnValue('not-found');

    const res = await call('/api/issues/PAN-9');

    expect(res.status).toBe(404);
    expect(res.json).toEqual({ error: 'Issue not found', issueId: 'PAN-9' });
  });

  it('returns 503 when the failure kind is unavailable', async () => {
    mocks.missingIssueFailureKind.mockReturnValue('unavailable');

    const res = await call('/api/issues/PAN-9');

    expect(res.status).toBe(503);
    expect(res.json).toEqual({ error: 'Issue tracker unavailable', issueId: 'PAN-9' });
  });

  it('returns 503 when the failure kind is null', async () => {
    mocks.missingIssueFailureKind.mockReturnValue(null);

    const res = await call('/api/issues/PAN-9');

    expect(res.status).toBe(503);
  });

  it('returns 400 for an invalid issue id', async () => {
    const res = await call('/api/issues/not-an-id');

    expect(res.status).toBe(400);
  });

  it('lets a more specific GET /api/issues/resource-allocated route win over :id', async () => {
    const stubLayer = Layer.mergeAll(
      issueReadRouteLayer,
      HttpRouter.add('GET', '/api/issues/resource-allocated', Effect.succeed(jsonResponse({ stub: true }))),
    );

    const res = await call('/api/issues/resource-allocated', stubLayer);

    expect(res.json).toEqual({ stub: true });
  });
});
