import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeMocks = vi.hoisted(() => ({
  rejectUnsafeDashboardMutationRequest: vi.fn(),
  getProjectPath: vi.fn(),
  getWorkspaceInfoForIssue: vi.fn(),
  setReviewStatus: vi.fn(),
  setPendingOperation: vi.fn(),
  completePendingOperation: vi.fn(),
  clearPendingOperation: vi.fn(),
  flyExecCmd: vi.fn(),
  getReviewStatusSync: vi.fn(),
  clearFeedbackDeliveryStuck: vi.fn(),
  getCachedConflictGateMergeability: vi.fn(),
  transitionIssueToInReview: vi.fn(),
  spawnRun: vi.fn(),
  pushLocalReviewBranches: vi.fn(),
  runVerificationForIssue: vi.fn(),
  registerDashboardDurableReviewPipeline: vi.fn(),
  pushDashboardReviewBranch: vi.fn(),
  resolveProjectForIssue: vi.fn(),
  updateIssueRecord: vi.fn(),
}));

vi.mock('../../dashboard-auth.js', () => ({
  rejectUnsafeDashboardMutationRequest: routeMocks.rejectUnsafeDashboardMutationRequest,
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
  for (const mock of Object.values(routeMocks)) mock.mockReset();
  routeMocks.rejectUnsafeDashboardMutationRequest.mockReturnValue(null);
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

describe('POST /api/review/:issueId/trigger reviewMode', () => {
  it('rejects an unsafe mutation before reading or mutating issue state', async () => {
    routeMocks.rejectUnsafeDashboardMutationRequest.mockReturnValue(
      HttpServerResponse.text('Invalid CSRF token', { status: 403 }),
    );

    const result = await requestReviewTrigger({ method: 'POST' });

    expect(result.status).toBe(403);
    expect(routeMocks.getWorkspaceInfoForIssue).not.toHaveBeenCalled();
    expect(routeMocks.resolveProjectForIssue).not.toHaveBeenCalled();
    expect(routeMocks.updateIssueRecord).not.toHaveBeenCalled();
    expect(routeMocks.setPendingOperation).not.toHaveBeenCalled();
  });

  it('returns a clear error before opening a pending operation when no project resolves', async () => {
    routeMocks.resolveProjectForIssue.mockReturnValue(null);

    const result = await requestReviewTrigger({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewMode: 'full' }),
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ success: true });
    expect(routeMocks.rejectUnsafeDashboardMutationRequest).toHaveBeenCalledOnce();
    expect(routeMocks.updateIssueRecord).toHaveBeenCalledWith(project, 'PAN-3340', expect.any(Function));
    expect(routeMocks.pushLocalReviewBranches).toHaveBeenCalledOnce();
    expect(routeMocks.updateIssueRecord.mock.invocationCallOrder[0])
      .toBeLessThan(routeMocks.pushLocalReviewBranches.mock.invocationCallOrder[0]!);
  });

  it('does not dispatch when review-mode persistence fails', async () => {
    routeMocks.updateIssueRecord.mockRejectedValue(new Error('state push failed'));

    const result = await requestReviewTrigger({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewMode: 'none' }),
    });

    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ error: expect.stringContaining('state push failed') });
    expect(routeMocks.pushLocalReviewBranches).not.toHaveBeenCalled();
  });
});
