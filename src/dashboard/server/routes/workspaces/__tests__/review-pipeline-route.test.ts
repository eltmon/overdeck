/**
 * PAN-3917 (FR-7, FR-8): the review dispatch routes read the derived issue
 * state and write no status row. These tests pin the guards that decide
 * whether a dispatch happens at all, and prove the deleted machinery — the
 * review-mode record write and the per-item tier escalation — is gone.
 */

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DerivedIssueState } from '@overdeck/contracts';

import { INTERNAL_TOKEN_HEADER, _resetInternalTokenCacheForTests } from '../../../../../lib/internal-token.js';

const routeMocks = vi.hoisted(() => ({
  getProjectPath: vi.fn(),
  getWorkspaceInfoForIssue: vi.fn(),
  setPendingOperation: vi.fn(),
  completePendingOperation: vi.fn(),
  clearPendingOperation: vi.fn(),
  flyExecCmd: vi.fn(),
  getDerivedIssueState: vi.fn(),
  getCachedConflictGateMergeability: vi.fn(),
  transitionIssueToInReview: vi.fn(),
  spawnRun: vi.fn(),
  pushLocalReviewBranches: vi.fn(),
  runVerificationForIssue: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
  spawnReviewRoleForIssue: vi.fn(),
}));

vi.mock('../../workspaces.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../workspaces.js')>();
  return {
    ...actual,
    getProjectPath: routeMocks.getProjectPath,
    getWorkspaceInfoForIssue: routeMocks.getWorkspaceInfoForIssue,
    setPendingOperation: routeMocks.setPendingOperation,
    completePendingOperation: routeMocks.completePendingOperation,
    clearPendingOperation: routeMocks.clearPendingOperation,
    flyExecCmd: routeMocks.flyExecCmd,
  };
});

vi.mock('../../../services/derived-issue-state.js', () => ({
  getDerivedIssueState: routeMocks.getDerivedIssueState,
}));

vi.mock('../../../../../lib/cloister/conflict-gate.js', () => ({
  getCachedConflictGateMergeability: routeMocks.getCachedConflictGateMergeability,
}));

vi.mock('../../../../../lib/agents.js', () => ({
  transitionIssueToInReview: routeMocks.transitionIssueToInReview,
  spawnRun: routeMocks.spawnRun,
}));

vi.mock('../../../../../lib/projects.js', () => ({
  resolveProjectFromIssueSync: routeMocks.resolveProjectFromIssueSync,
}));

vi.mock('../../../../../lib/cloister/review-branch-push.js', () => ({
  pushLocalReviewBranches: routeMocks.pushLocalReviewBranches,
}));

vi.mock('../../../../../lib/cloister/verification-runner.js', () => ({
  runVerificationForIssue: routeMocks.runVerificationForIssue,
}));

vi.mock('../../../../../lib/cloister/review-agent.js', () => ({
  spawnReviewRoleForIssue: routeMocks.spawnReviewRoleForIssue,
}));

vi.mock('../../../../../lib/review-artifacts.js', () => ({
  createReviewArtifactsForIssue: vi.fn(async () => ({ mergeSet: { repos: [] } })),
}));


// W1 deleted src/lib/state-read-home.ts and src/lib/state-home.ts; W3 deletes
// the record plane and the mirror syncs that import them. They are still on
// this module's import chain in this tree, so stub the importers rather than
// loading them. Every entry here disappears once W3 lands.
vi.mock('../../../../../lib/remote-workspace.js', () => ({}));
vi.mock('../../../../../lib/remote/remote-agents.js', () => ({}));
vi.mock('../../../../../lib/overdeck/planning-promotion.js', () => ({}));
vi.mock('../../../../../lib/overdeck/conversation-retrospective.js', () => ({}));
vi.mock('../../../../../lib/cloister/flywheel.js', () => ({}));
vi.mock('../../../../../lib/agents/spawn.js', () => ({ spawnRun: vi.fn(), spawnAgent: vi.fn(), spawnRunPromise: vi.fn() }));

import { EventStoreService } from '../../../services/domain-services.js';
import { reviewPipelineRouteLayer, _resetAutoRequeueCountsForTests } from '../review-pipeline.js';

function derived(overrides: Partial<DerivedIssueState> = {}): DerivedIssueState {
  return { issueId: 'PAN-3340', state: 'working', ...overrides };
}

const authHeaders = {
  'Content-Type': 'application/json',
  [INTERNAL_TOKEN_HEADER]: 'test-internal-token',
};

async function post(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, init));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(reviewPipelineRouteLayer), (app) => app.pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, request),
        Effect.provideService(EventStoreService, { append: () => Effect.succeed(1) } as never),
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

const trigger = (init: RequestInit = {}) => post('/api/review/PAN-3340/trigger', init);

beforeEach(() => {
  process.env.OVERDECK_INTERNAL_TOKEN = 'test-internal-token';
  _resetInternalTokenCacheForTests();
  _resetAutoRequeueCountsForTests();
  for (const mock of Object.values(routeMocks)) mock.mockReset();
  routeMocks.getProjectPath.mockReturnValue('/repo');
  routeMocks.getWorkspaceInfoForIssue.mockReturnValue({
    exists: true,
    isRemote: false,
    localPath: '/repo/workspaces/feature-3340',
  });
  routeMocks.getDerivedIssueState.mockResolvedValue(derived());
  routeMocks.getCachedConflictGateMergeability.mockReturnValue(null);
  routeMocks.resolveProjectFromIssueSync.mockReturnValue({ projectKey: 'overdeck', projectPath: '/repo' });
  routeMocks.transitionIssueToInReview.mockResolvedValue(undefined);
  routeMocks.pushLocalReviewBranches.mockImplementation(() => new Promise<void>(() => {}));
});

afterEach(() => {
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
});

describe('POST /api/review/:issueId/trigger — auth', () => {
  it('rejects an unsafe mutation before reading any issue state', async () => {
    const result = await trigger({ method: 'POST' });

    expect(result.status).toBe(401);
    expect(routeMocks.getWorkspaceInfoForIssue).not.toHaveBeenCalled();
    expect(routeMocks.getDerivedIssueState).not.toHaveBeenCalled();
    expect(routeMocks.setPendingOperation).not.toHaveBeenCalled();
  });
});

describe('POST /api/review/:issueId/trigger — derived guards', () => {
  it('refuses when the PR already carries an approval', async () => {
    routeMocks.getDerivedIssueState.mockResolvedValue(derived({
      state: 'ready',
      pr: { url: 'https://gh/pr/7', number: 7, reviewState: 'approved', checks: 'green', mergeable: true },
    }));

    const result = await trigger({ method: 'POST', headers: authHeaders, body: '{}' });

    expect(result.body).toMatchObject({ success: false, alreadyReviewed: true, prUrl: 'https://gh/pr/7' });
    expect(routeMocks.setPendingOperation).not.toHaveBeenCalled();
  });

  it('refuses when the reviewer asked for changes', async () => {
    routeMocks.getDerivedIssueState.mockResolvedValue(derived({
      state: 'changes-requested',
      pr: { url: 'https://gh/pr/7', number: 7, reviewState: 'changes-requested', checks: 'green', mergeable: true },
    }));

    const result = await trigger({ method: 'POST', headers: authHeaders, body: '{}' });

    expect(result.body).toMatchObject({ success: false, alreadyReviewed: true });
    expect(routeMocks.setPendingOperation).not.toHaveBeenCalled();
  });

  it('refuses when the issue is already merged', async () => {
    routeMocks.getDerivedIssueState.mockResolvedValue(derived({ state: 'merged' }));

    const result = await trigger({ method: 'POST', headers: authHeaders, body: '{}' });

    expect(result.body).toMatchObject({ success: false, alreadyMerged: true });
  });

  it('force=true dispatches past an approved PR', async () => {
    routeMocks.getDerivedIssueState.mockResolvedValue(derived({
      state: 'ready',
      pr: { url: 'https://gh/pr/7', number: 7, reviewState: 'approved', checks: 'green', mergeable: true },
    }));

    const result = await trigger({
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ force: true }),
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ success: true });
    expect(routeMocks.setPendingOperation).toHaveBeenCalledWith('PAN-3340', 'review');
  });

  it('returns a clear error when a review mode is requested but no project resolves', async () => {
    routeMocks.resolveProjectFromIssueSync.mockReturnValue(null);

    const result = await trigger({
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ reviewMode: 'full' }),
    });

    expect(result).toEqual({ status: 500, body: { error: 'No project configured for PAN-3340' } });
    expect(routeMocks.setPendingOperation).not.toHaveBeenCalled();
    expect(routeMocks.pushLocalReviewBranches).not.toHaveBeenCalled();
  });

  it('dispatches without persisting the review mode anywhere', async () => {
    const result = await trigger({
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ reviewMode: 'full' }),
    });

    expect(result.status).toBe(200);
    expect(routeMocks.pushLocalReviewBranches).toHaveBeenCalledOnce();
  });
});

describe('POST /api/review/:issueId/trigger — verification (FR-8)', () => {
  it('reports a verification failure through the pending operation and stops', async () => {
    routeMocks.pushLocalReviewBranches.mockResolvedValue(undefined);
    routeMocks.runVerificationForIssue.mockReturnValue(
      Effect.succeed({ outcome: 'failed', failedCheck: 'typecheck' }),
    );

    const result = await trigger({ method: 'POST', headers: authHeaders, body: '{}' });

    expect(result.status).toBe(200);
    await vi.waitFor(() => {
      expect(routeMocks.completePendingOperation).toHaveBeenCalledWith(
        'PAN-3340',
        'Verification failed at typecheck',
      );
    });
    // FR-14: the per-item tier escalation is deleted, so no reviewer is spawned
    // on a failed verification either.
    expect(routeMocks.spawnReviewRoleForIssue).not.toHaveBeenCalled();
  });
});

describe('POST /api/review/:issueId/trigger — conflict gate', () => {
  it('defers with 409 when the cached mergeability says conflicts', async () => {
    routeMocks.getCachedConflictGateMergeability.mockReturnValue('conflicts');

    const result = await trigger({ method: 'POST', headers: authHeaders, body: '{}' });

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ success: false, gated: true, pipeline: 'deferred' });
  });
});
