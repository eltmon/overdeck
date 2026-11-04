import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

const { mockPostStrikeMergePayload } = vi.hoisted(() => ({ mockPostStrikeMergePayload: vi.fn() }));

vi.mock('../../services/strike-merge.js', () => ({ postStrikeMergePayload: mockPostStrikeMergePayload }));

import { mergeTrainLanesRouteLayer } from '../merge-train-lanes.js';
import { INTERNAL_TOKEN_HEADER, _resetInternalTokenCacheForTests } from '../../../../lib/internal-token.js';
import { _resetDashboardSessionTokenForTests } from '../dashboard-auth.js';
import { _resetTrustedOriginsForTests } from '../origin-validation.js';
import { getOverdeckHome } from '../../../../lib/paths.js';

async function postStrikeMerge(issueId: string, headers: Record<string, string>) {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost/api/merge-train/strikes/${issueId}/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: '{}',
  }));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(mergeTrainLanesRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
}

const AUTHED = { [INTERNAL_TOKEN_HEADER]: 'test-token' };

function resetAuth() {
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetTrustedOriginsForTests();
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OVERDECK_INTERNAL_TOKEN = 'test-token';
  delete process.env.OVERDECK_TRUSTED_ORIGINS;
  // The token file wins over env (PAN-4628); delete any file a sibling test left.
  rmSync(join(getOverdeckHome(), 'internal-token'), { force: true });
  resetAuth();
});

afterEach(() => {
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  delete process.env.OVERDECK_DASHBOARD_SESSION_TOKEN;
  delete process.env.OVERDECK_DASHBOARD_CSRF_TOKEN;
  delete process.env.OVERDECK_TRUSTED_ORIGINS;
  resetAuth();
});

/** PAN-4750: the operator's strike Merge button. */
describe('POST /api/merge-train/strikes/:issueId/merge', () => {
  it('refuses a request with no dashboard credential', async () => {
    const res = await postStrikeMerge('PAN-9', {});
    expect(res.status).toBe(401);
    expect(mockPostStrikeMergePayload).not.toHaveBeenCalled();
  });

  it('refuses a cross-site request without a CSRF token', async () => {
    process.env.OVERDECK_DASHBOARD_SESSION_TOKEN = 'session-token';
    process.env.OVERDECK_DASHBOARD_CSRF_TOKEN = 'csrf-token';
    resetAuth();
    const res = await postStrikeMerge('PAN-9', { Cookie: 'overdeck_session=session-token' });
    expect(res.status).toBe(403);
    expect(mockPostStrikeMergePayload).not.toHaveBeenCalled();
  });

  it('returns 400 on a bad issue id', async () => {
    const res = await postStrikeMerge('not-an-issue', AUTHED);
    expect(res).toEqual({ status: 400, body: { error: 'Invalid issue ID' } });
    expect(mockPostStrikeMergePayload).not.toHaveBeenCalled();
  });

  it('merges the upper-cased issue and returns the payload status', async () => {
    mockPostStrikeMergePayload.mockResolvedValue({ status: 200, body: { success: true, outcome: 'merging' } });
    const res = await postStrikeMerge('pan-9', AUTHED);
    expect(res).toEqual({ status: 200, body: { success: true, outcome: 'merging' } });
    expect(mockPostStrikeMergePayload).toHaveBeenCalledWith('PAN-9');
  });

  it('passes a refusal status through', async () => {
    mockPostStrikeMergePayload.mockResolvedValue({ status: 404, body: { success: false, error: 'No strike workspace for PAN-9' } });
    const res = await postStrikeMerge('PAN-9', AUTHED);
    expect(res.status).toBe(404);
  });
});
