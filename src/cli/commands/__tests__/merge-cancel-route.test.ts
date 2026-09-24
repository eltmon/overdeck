/**
 * #3954: `pan merge cancel` kept calling DELETE /api/flywheel/auto-merge/:id
 * after PAN-3917 moved the route to /api/merge-train/auto-merge/:id. This test
 * drives the real CLI command into the real merge-train route layer, so the
 * URL, method, and internal-token header are checked against the route the
 * dashboard serves. The old path is rejected by the router with RouteNotFound.
 */

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/activity-logger.js', () => ({ emitActivityTts: vi.fn() }));
vi.mock('../../../lib/cloister/merge-eligibility.js', () => ({
  gatherMergeEligibility: vi.fn(async () => []),
  isMergeEligible: vi.fn(() => false),
}));
vi.mock('../../../lib/cloister/merge-blockers.js', () => ({ getMergeBlockersPayload: vi.fn(() => []) }));
vi.mock('../../../lib/overdeck/merge-sync.js', () => ({
  cancelPending: vi.fn(() => true),
  countActionableAutoMerges: vi.fn(() => 0),
  getActionableAutoMerge: vi.fn(() => null),
  listActiveAutoMerges: vi.fn(() => []),
  listProblemAutoMerges: vi.fn(() => []),
  scheduleAutoMergeWithResult: vi.fn(() => ({ created: true, entry: {} })),
  isMergeTrainEnabledForProject: vi.fn(() => true),
  getUatGeneration: vi.fn(() => null),
}));

const { mergeTrainRouteLayer } = await import('../../../dashboard/server/routes/merge-train.js');
const mergeSync = await import('../../../lib/overdeck/merge-sync.js');
const { _resetInternalTokenCacheForTests } = await import('../../../lib/internal-token.js');
const { mergeCancelCommand } = await import('../merge.js');

/** A fetch that answers from the dashboard's merge-train route layer. */
async function routeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const request = HttpServerRequest.fromWeb(new Request(input, init));
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(mergeTrainRouteLayer),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
  )));
  const body = response.body as { body?: Uint8Array } | null;
  return new Response(body?.body ? new TextDecoder().decode(body.body) : '{}', { status: response.status });
}

describe('pan merge cancel against the merge-train route layer', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    _resetInternalTokenCacheForTests();
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('cancels the pending row through DELETE /api/merge-train/auto-merge/:id', async () => {
    vi.stubEnv('OVERDECK_INTERNAL_TOKEN', 'cli-route-token');
    vi.stubEnv('OVERDECK_DASHBOARD_URL', 'http://dashboard.test');
    _resetInternalTokenCacheForTests();
    vi.mocked(mergeSync.getActionableAutoMerge).mockReturnValueOnce({ id: 11, issueId: 'PAN-123', status: 'pending' } as never);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = undefined;

    await mergeCancelCommand('pan-123', routeFetch as typeof fetch);

    expect(error).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
    expect(mergeSync.cancelPending).toHaveBeenCalledWith(11, 'operator');
    expect(log).toHaveBeenCalledWith('Cancelled auto-merge for PAN-123');
  });
});
