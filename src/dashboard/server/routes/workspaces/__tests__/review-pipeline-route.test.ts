import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { INTERNAL_TOKEN_HEADER, _resetInternalTokenCacheForTests } from '../../../../../lib/internal-token.js';

const routeMocks = vi.hoisted(() => ({
  getProjectPath: vi.fn(),
  getWorkspaceInfoForIssue: vi.fn(),
  setReviewStatus: vi.fn(),
  setPendingOperation: vi.fn(),
  completePendingOperation: vi.fn(),
  clearPendingOperation: vi.fn(),
  flyExecCmd: vi.fn(),
  getReviewStatusSync: vi.fn(),
  clearFeedbackDeliveryStuck: vi.fn(),
  registerReviewVerdictFeedbackDelivery: vi.fn(),
  getCachedConflictGateMergeability: vi.fn(),
  transitionIssueToInReview: vi.fn(),
  spawnRun: vi.fn(),
  pushLocalReviewBranches: vi.fn(),
  runVerificationForIssue: vi.fn(),
  registerDashboardDurableReviewPipeline: vi.fn(),
  pushDashboardReviewBranch: vi.fn(),
  resolveProjectForIssue: vi.fn(),
  updateIssueRecord: vi.fn(),
  reportTieredVerificationFailureEscalation: vi.fn(),
}));

vi.mock('../../workspaces.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../workspaces.js')>();
  return {
    ...actual,
    getProjectPath: routeMocks.getProjectPath,
    getWorkspaceInfoForIssue: routeMocks.getWorkspaceInfoForIssue,
    setReviewStatus: routeMocks.setReviewStatus,
    setPendingOperation: routeMocks.setPendingOperation,
    completePendingOperation: routeMocks.completePendingOperation,
    clearPendingOperation: routeMocks.clearPendingOperation,
    flyExecCmd: routeMocks.flyExecCmd,
  };
});

vi.mock('../../../../../lib/review-status.js', () => ({
  getReviewStatusSync: routeMocks.getReviewStatusSync,
  clearFeedbackDeliveryStuck: routeMocks.clearFeedbackDeliveryStuck,
  registerReviewVerdictFeedbackDelivery: routeMocks.registerReviewVerdictFeedbackDelivery,

  // PAN-3903: the pipeline read door's bulk read; falls back to the cache map.
  getReviewStatusesSync: () => ({}),
}));

vi.mock('../../../../../lib/cloister/conflict-gate.js', () => ({
  getCachedConflictGateMergeability: routeMocks.getCachedConflictGateMergeability,
}));

vi.mock('../../../../../lib/agents.js', () => ({
  transitionIssueToInReview: routeMocks.transitionIssueToInReview,
  spawnRun: routeMocks.spawnRun,
}));

vi.mock('../../../../../lib/cloister/review-branch-push.js', () => ({
  pushLocalReviewBranches: routeMocks.pushLocalReviewBranches,
}));

vi.mock('../../../../../lib/cloister/verification-runner.js', () => ({
  runVerificationForIssue: routeMocks.runVerificationForIssue,
}));

vi.mock('../../../services/durable-review-pipeline.js', () => ({
  registerDashboardDurableReviewPipeline: routeMocks.registerDashboardDurableReviewPipeline,
  pushDashboardReviewBranch: routeMocks.pushDashboardReviewBranch,
}));

vi.mock('../../../../../lib/pan-dir/record.js', () => ({
  resolveProjectForIssue: routeMocks.resolveProjectForIssue,
}));

vi.mock('../../../../../lib/pan-dir/record-update.js', () => ({
  updateIssueRecord: routeMocks.updateIssueRecord,
}));

vi.mock('../../tiered-inspect-escalation.js', () => ({
  reportTieredVerificationFailureEscalation: routeMocks.reportTieredVerificationFailureEscalation,
}));

vi.mock('../../../../../lib/review-artifacts.js', () => ({
  createReviewArtifactsForIssue: vi.fn(() => Effect.succeed({ mergeSet: { repos: [] } })),
}));

import { EventStoreService } from '../../../services/domain-services.js';
import { reviewPipelineRouteLayer } from '../review-pipeline.js';

async function requestReviewTrigger(init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  const request = HttpServerRequest.fromWeb(new Request('http://localhost/api/review/PAN-3340/trigger', init));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(reviewPipelineRouteLayer), (app) => app.pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, request),
        Effect.provideService(EventStoreService, {
          append: () => Effect.succeed(1),
        } as never),
      )),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: text };
  }
}

beforeEach(() => {
  process.env.OVERDECK_INTERNAL_TOKEN = 'test-internal-token';
  _resetInternalTokenCacheForTests();
  for (const mock of Object.values(routeMocks)) mock.mockReset();
  routeMocks.getProjectPath.mockReturnValue('/repo');
  routeMocks.getWorkspaceInfoForIssue.mockReturnValue({
    exists: true,
    isRemote: false,
    localPath: '/repo/workspaces/feature-3340',
  });
  routeMocks.getReviewStatusSync.mockReturnValue(null);
  routeMocks.getCachedConflictGateMergeability.mockReturnValue(null);
  routeMocks.resolveProjectForIssue.mockReturnValue({ key: 'overdeck' });
  routeMocks.updateIssueRecord.mockResolvedValue({ reviewMode: 'full' });
  routeMocks.transitionIssueToInReview.mockResolvedValue(undefined);
  routeMocks.pushLocalReviewBranches.mockImplementation(() => new Promise<void>(() => {}));
});

afterEach(() => {
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
});

describe('POST /api/review/:issueId/trigger reviewMode', () => {
  it('rejects an unsafe mutation before reading or mutating issue state', async () => {
    const result = await requestReviewTrigger({ method: 'POST' });

    expect(result.status).toBe(401);
    expect(routeMocks.getWorkspaceInfoForIssue).not.toHaveBeenCalled();
    expect(routeMocks.resolveProjectForIssue).not.toHaveBeenCalled();
    expect(routeMocks.updateIssueRecord).not.toHaveBeenCalled();
    expect(routeMocks.setPendingOperation).not.toHaveBeenCalled();
  });

  it('returns a clear error before opening a pending operation when no project resolves', async () => {
    routeMocks.resolveProjectForIssue.mockReturnValue(null);

    const result = await requestReviewTrigger({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [INTERNAL_TOKEN_HEADER]: 'test-internal-token',
      },
      body: JSON.stringify({ reviewMode: 'full' }),
    });

    expect(result).toEqual({ status: 500, body: { error: 'No project configured for PAN-3340' } });
    expect(routeMocks.setPendingOperation).not.toHaveBeenCalled();
    expect(routeMocks.setReviewStatus).not.toHaveBeenCalled();
    expect(routeMocks.updateIssueRecord).not.toHaveBeenCalled();
    expect(routeMocks.pushLocalReviewBranches).not.toHaveBeenCalled();
  });

  it('persists an authenticated mode selection before background dispatch', async () => {
    const project = { key: 'overdeck' };
    routeMocks.resolveProjectForIssue.mockReturnValue(project);

    const result = await requestReviewTrigger({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [INTERNAL_TOKEN_HEADER]: 'test-internal-token',
      },
      body: JSON.stringify({ reviewMode: 'full' }),
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ success: true });
    expect(routeMocks.updateIssueRecord).toHaveBeenCalledWith(project, 'PAN-3340', expect.any(Function));
    expect(routeMocks.pushLocalReviewBranches).toHaveBeenCalledOnce();
    expect(routeMocks.updateIssueRecord.mock.invocationCallOrder[0])
      .toBeLessThan(routeMocks.pushLocalReviewBranches.mock.invocationCallOrder[0]!);
  });

  it('does not dispatch when review-mode persistence fails', async () => {
    routeMocks.updateIssueRecord.mockRejectedValue(new Error('state push failed'));

    const result = await requestReviewTrigger({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [INTERNAL_TOKEN_HEADER]: 'test-internal-token',
      },
      body: JSON.stringify({ reviewMode: 'none' }),
    });

    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ error: expect.stringContaining('state push failed') });
    expect(routeMocks.pushLocalReviewBranches).not.toHaveBeenCalled();
  });

  // PAN-3858: the verification gate is the caller of the verification-failed
  // escalation trigger.
  it('fires the verification-failed tier escalation when verification fails', async () => {
    routeMocks.pushLocalReviewBranches.mockResolvedValue(undefined);
    routeMocks.runVerificationForIssue.mockReturnValue(Effect.succeed({ outcome: 'failed', failedCheck: 'typecheck' }));
    routeMocks.reportTieredVerificationFailureEscalation.mockResolvedValue(undefined);

    const result = await requestReviewTrigger({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [INTERNAL_TOKEN_HEADER]: 'test-internal-token',
      },
      body: JSON.stringify({ reviewMode: 'full' }),
    });

    expect(result.status).toBe(200);
    await vi.waitFor(() => {
      expect(routeMocks.reportTieredVerificationFailureEscalation).toHaveBeenCalledWith(
        'PAN-3340',
        '/repo/workspaces/feature-3340',
        'verification failed at typecheck',
      );
    });
  });

  it('does not fire the tier escalation when verification passes', async () => {
    routeMocks.pushLocalReviewBranches.mockImplementation(() => new Promise<void>(() => {}));

    const result = await requestReviewTrigger({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [INTERNAL_TOKEN_HEADER]: 'test-internal-token',
      },
      body: JSON.stringify({ reviewMode: 'full' }),
    });

    expect(result.status).toBe(200);
    // The background pipeline is parked at the branch push, well before
    // verification runs; give microtasks a turn, then assert no escalation.
    await new Promise((resolve) => setImmediate(resolve));
    expect(routeMocks.reportTieredVerificationFailureEscalation).not.toHaveBeenCalled();
    expect(routeMocks.runVerificationForIssue).not.toHaveBeenCalled();
  });
});
