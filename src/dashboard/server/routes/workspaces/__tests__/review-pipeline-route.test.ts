/**
 * PAN-3917 (FR-7, FR-8): the review dispatch routes read the derived issue
 * state and write no status row. These tests pin the guards that decide
 * whether a dispatch happens at all, and prove the deleted machinery — the
 * review-mode record write and the per-item tier escalation — is gone.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DerivedIssueState } from '@overdeck/contracts';

import { INTERNAL_TOKEN_HEADER, _resetInternalTokenCacheForTests } from '../../../../../lib/internal-token.js';
import { getOverdeckHome } from '../../../../../lib/paths.js';

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
  refreshIssuePullRequestStateNow: vi.fn(),
  resolveEffort: vi.fn(),
  answerMissingWorkspace: vi.fn(),
  answerAdoptionInFlight: vi.fn(),
  isDeftPipelineIssue: vi.fn(),
  clearVerificationDispatchOwed: vi.fn(),
  confirmResumedDispatch: vi.fn(),
}));

vi.mock('../../../../../lib/cloister/verification-worker-supervisor.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../lib/cloister/verification-worker-supervisor.js')>()),
  clearVerificationDispatchOwed: routeMocks.clearVerificationDispatchOwed,
}));
vi.mock('../../../../../lib/cloister/verification-resume-dispatch.js', () => ({
  confirmResumedDispatch: routeMocks.confirmResumedDispatch,
}));

vi.mock('../../../../../lib/deft/issue-pipeline.js', () => ({
  isDeftPipelineIssue: routeMocks.isDeftPipelineIssue,
}));

// PAN-4820: a pass-through spy, so a test can prove nothing was journalled.
vi.mock('../../../../../lib/cloister/pipeline-journal.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../lib/cloister/pipeline-journal.js')>();
  return { ...actual, appendPipelineEntry: vi.fn(actual.appendPipelineEntry) };
});

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

vi.mock('../../../../../lib/agents/resolve-effort.js', () => ({
  resolveEffort: routeMocks.resolveEffort,
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

vi.mock('../../../../../lib/cloister/pr-adoption-review.js', () => ({
  answerMissingWorkspace: routeMocks.answerMissingWorkspace,
  answerAdoptionInFlight: routeMocks.answerAdoptionInFlight,
}));

vi.mock('../../../services/issue-pr-refresh.js', () => ({
  refreshIssuePullRequestStateNow: routeMocks.refreshIssuePullRequestStateNow,
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
import { reviewPipelineRouteLayer, _resetAutoRequeueCountsForTests, requestReviewGuarded, startRequestReviewPipeline } from '../review-pipeline.js';
import { requestReviewPipeline } from '../../../../../lib/cloister/request-review-pipeline.js';

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
  rmSync(join(getOverdeckHome(), 'internal-token'), { force: true });
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
  routeMocks.resolveEffort.mockReturnValue({ effort: 'high', source: 'default', requested: 'high', clamped: false });
  routeMocks.answerMissingWorkspace.mockResolvedValue(null);
  routeMocks.answerAdoptionInFlight.mockReturnValue(null);
  routeMocks.isDeftPipelineIssue.mockResolvedValue(false);
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

  // #4118: the Full/Quick/None menu choice reaches the review run as a
  // per-run override instead of being validated and dropped.
  it.each(['full', 'quick', 'none'] as const)('passes a requested %s mode to this review run', async (reviewMode) => {
    routeMocks.pushLocalReviewBranches.mockResolvedValue(undefined);
    routeMocks.runVerificationForIssue.mockReturnValue(Effect.succeed({ outcome: 'passed' }));
    routeMocks.spawnReviewRoleForIssue.mockReturnValue(Effect.succeed({ success: true, message: 'spawned' }));

    const result = await trigger({
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ reviewMode }),
    });

    expect(result.status).toBe(200);
    await vi.waitFor(() => {
      expect(routeMocks.spawnReviewRoleForIssue).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'PAN-3340', reviewMode }),
      );
    });
  });

  // #3853: a forced Full review on an approved head is the operator's request,
  // so its reviewer must be able to block that head.
  it('marks a forced review of an approved PR as operator-requested', async () => {
    routeMocks.getDerivedIssueState.mockResolvedValue(derived({
      state: 'ready',
      pr: { url: 'https://gh/pr/7', number: 7, reviewState: 'approved', checks: 'green', mergeable: true },
    }));
    routeMocks.pushLocalReviewBranches.mockResolvedValue(undefined);
    routeMocks.runVerificationForIssue.mockReturnValue(Effect.succeed({ outcome: 'passed' }));
    routeMocks.spawnReviewRoleForIssue.mockReturnValue(Effect.succeed({ success: true, message: 'spawned' }));

    const result = await trigger({
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ force: true, reviewMode: 'full' }),
    });

    expect(result.status).toBe(200);
    await vi.waitFor(() => {
      expect(routeMocks.spawnReviewRoleForIssue).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'PAN-3340', force: true, reviewMode: 'full', operatorRequested: true }),
      );
    });
  });

  it('leaves review mode to config when no mode is requested', async () => {
    routeMocks.pushLocalReviewBranches.mockResolvedValue(undefined);
    routeMocks.runVerificationForIssue.mockReturnValue(Effect.succeed({ outcome: 'passed' }));
    routeMocks.spawnReviewRoleForIssue.mockReturnValue(Effect.succeed({ success: true, message: 'spawned' }));

    await trigger({ method: 'POST', headers: authHeaders, body: '{}' });

    await vi.waitFor(() => {
      expect(routeMocks.spawnReviewRoleForIssue).toHaveBeenCalledOnce();
    });
    expect(routeMocks.spawnReviewRoleForIssue.mock.calls[0][0]).not.toHaveProperty('reviewMode');
  });
});

// #3853: the review parent's `reviewOperatorRequested` lets a run's reviewer
// block an approved head. Only an operator's explicit request may set it.
describe('POST /api/review/:issueId/request — operator standing (#3853)', () => {
  it('marks a forced re-review of an approved PR as operator-requested', async () => {
    routeMocks.getDerivedIssueState.mockResolvedValue(derived({
      state: 'ready',
      pr: { url: 'https://gh/pr/7', number: 7, reviewState: 'approved', checks: 'green', mergeable: true },
    }));
    routeMocks.pushLocalReviewBranches.mockResolvedValue(undefined);
    routeMocks.spawnReviewRoleForIssue.mockReturnValue(Effect.succeed({ success: true, message: 'spawned' }));

    const result = await post('/api/review/PAN-3340/request?force=true', {
      method: 'POST',
      headers: authHeaders,
      body: '{}',
    });

    expect(result.body).toMatchObject({ success: true, rerun: true });
    await vi.waitFor(() => {
      expect(routeMocks.spawnReviewRoleForIssue).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'PAN-3340', force: true, operatorRequested: true }),
      );
    });
  });

  // `pan done` requests review through this route with source=pan-done; the
  // automatic dispatch behind it must not carry operator standing, so it
  // clears any flag an earlier operator request left on the review parent.
  it("dispatches pan done's review with no operator flag", async () => {
    routeMocks.getDerivedIssueState.mockResolvedValue(derived({ issueId: 'PAN-3341' }));
    routeMocks.getWorkspaceInfoForIssue.mockReturnValue({
      exists: true,
      isRemote: false,
      localPath: '/repo/workspaces/feature-pan-3341',
    });
    routeMocks.pushLocalReviewBranches.mockResolvedValue(undefined);
    routeMocks.runVerificationForIssue.mockReturnValue(Effect.succeed({ outcome: 'passed' }));
    routeMocks.spawnReviewRoleForIssue.mockReturnValue(Effect.succeed({ success: true, message: 'spawned' }));

    const result = await post('/api/review/PAN-3341/request', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ source: 'pan-done' }),
    });

    expect(result.status).toBe(202);
    await vi.waitFor(() => {
      expect(routeMocks.spawnReviewRoleForIssue).toHaveBeenCalledOnce();
    });
    expect(routeMocks.spawnReviewRoleForIssue.mock.calls[0][0]).not.toHaveProperty('operatorRequested');
  });
});

// PAN-4256: the manual test re-dispatch (an approved PR whose checks are not
// green) must honor roles.test.effort instead of launching the test role
// unconditionally at the role file's hardcoded high.
describe('requestReviewGuarded — test re-dispatch resolves effort (PAN-4256)', () => {
  it('threads roles.test.effort into the re-dispatched test role', async () => {
    routeMocks.resolveEffort.mockReturnValue({ effort: 'medium', source: 'role', requested: 'medium', clamped: false });
    routeMocks.spawnRun.mockResolvedValue({ id: 'agent-pan-3340-test' });

    const outcome = await requestReviewGuarded('PAN-3340', {
      source: 'api',
      derived: derived({
        pr: { url: 'https://gh/pr/7', number: 7, reviewState: 'approved', checks: 'red', mergeable: true },
      }),
      approvalStandsAtHead: async () => true,
    });

    expect(outcome).toEqual({ kind: 'tests-requeued' });
    expect(routeMocks.resolveEffort).toHaveBeenCalledWith({ role: 'test', issueId: 'PAN-3340' });
    expect(routeMocks.spawnRun).toHaveBeenCalledWith('PAN-3340', 'test', expect.objectContaining({
      effort: 'medium',
      effortSource: 'role',
    }));
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

// PAN-4457: the issue row's PR badge appears within seconds of `pan done`
// opening the PR, not only on the next tracker poll. The `/request` route is
// the door onto `requestReviewGuarded` → `startRequestReviewPipeline`, where
// the refresh call lives (the `/trigger` route above has its own separate
// dispatch and never reaches it).
describe('POST /api/review/:issueId/request — PR state refresh (PAN-4457)', () => {
  it('calls refreshIssuePullRequestStateNow once with the canonical issue id when a request starts', async () => {
    const result = await post('/api/review/PAN-3340/request', {
      method: 'POST',
      headers: authHeaders,
      body: '{}',
    });

    expect(result.status).toBe(202);
    expect(routeMocks.refreshIssuePullRequestStateNow).toHaveBeenCalledTimes(1);
    expect(routeMocks.refreshIssuePullRequestStateNow).toHaveBeenCalledWith('PAN-3340');
  });

  it('does not call refreshIssuePullRequestStateNow when the workspace does not exist', async () => {
    routeMocks.getWorkspaceInfoForIssue.mockReturnValue({ exists: false, isRemote: false, localPath: '' });

    const result = await post('/api/review/PAN-3340/request', {
      method: 'POST',
      headers: authHeaders,
      body: '{}',
    });

    expect(result.body).toMatchObject({ success: false, error: 'Workspace does not exist' });
    expect(routeMocks.refreshIssuePullRequestStateNow).not.toHaveBeenCalled();
  });

  it('adopts an open PR before the approved-head shortcut when the issue has no workspace (PAN-4605)', async () => {
    routeMocks.getWorkspaceInfoForIssue.mockReturnValue({ exists: false, isRemote: false, localPath: '' });
    routeMocks.getDerivedIssueState.mockResolvedValue(derived({
      state: 'ready',
      pr: { url: 'https://gh/pr/7', number: 7, reviewState: 'approved', checks: 'green', mergeable: true },
    }));
    routeMocks.answerMissingWorkspace.mockResolvedValue({ status: 202, body: { success: true, queued: true, adopting: true, message: 'adopting PR #7' } });

    const result = await post('/api/review/PAN-3340/request', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ source: 'pan-review-request', nudge: true }),
    });

    expect(result.status).toBe(202);
    expect(result.body).toMatchObject({ success: true, adopting: true });
    expect(routeMocks.answerMissingWorkspace).toHaveBeenCalledWith('PAN-3340', 'pan-review-request', { derivedState: 'ready', workspaceExists: false });
    expect(routeMocks.setPendingOperation).not.toHaveBeenCalled();
    expect(routeMocks.refreshIssuePullRequestStateNow).not.toHaveBeenCalled();
  });

  it('does not call refreshIssuePullRequestStateNow when the pipeline is already running for the issue', async () => {
    const isInFlightSpy = vi.spyOn(requestReviewPipeline, 'isInFlight').mockReturnValue(true);

    const result = await post('/api/review/PAN-3340/request', {
      method: 'POST',
      headers: authHeaders,
      body: '{}',
    });

    expect(result.body).toMatchObject({ success: true, alreadyRunning: true });
    expect(routeMocks.refreshIssuePullRequestStateNow).not.toHaveBeenCalled();

    isInFlightSpy.mockRestore();
  });
});

// PAN-4995: the worktree is on disk before adoption checks its head, so a
// request that arrives mid-adoption must not verify (and merge main into) it.
describe('POST /api/review/:issueId/request — adoption in flight (PAN-4995)', () => {
  it('answers 202 adopting and starts no verification while adoption owns the workspace', async () => {
    routeMocks.answerAdoptionInFlight.mockReturnValue({
      status: 202,
      body: { success: true, queued: true, adopting: true, message: 'Adoption of PR #7 is in progress; verification starts when it is ready.' },
    });

    const result = await post('/api/review/PAN-3340/request', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ source: 'pan-review-request' }),
    });

    expect(result.status).toBe(202);
    expect(result.body).toMatchObject({ success: true, queued: true, adopting: true });
    expect(routeMocks.answerAdoptionInFlight).toHaveBeenCalledWith('PAN-3340');
    expect(routeMocks.answerMissingWorkspace).not.toHaveBeenCalled();
    expect(routeMocks.runVerificationForIssue).not.toHaveBeenCalled();
    expect(routeMocks.setPendingOperation).not.toHaveBeenCalled();
    expect(routeMocks.refreshIssuePullRequestStateNow).not.toHaveBeenCalled();
  });

  it('verifies as before when no adoption is in flight', async () => {
    routeMocks.getDerivedIssueState.mockResolvedValue(derived({ issueId: 'PAN-3342' }));
    routeMocks.getWorkspaceInfoForIssue.mockReturnValue({
      exists: true,
      isRemote: false,
      localPath: '/repo/workspaces/feature-pan-3342',
    });
    routeMocks.pushLocalReviewBranches.mockResolvedValue(undefined);
    routeMocks.runVerificationForIssue.mockReturnValue(Effect.succeed({ outcome: 'passed' }));
    routeMocks.spawnReviewRoleForIssue.mockReturnValue(Effect.succeed({ success: true, message: 'spawned' }));

    const result = await post('/api/review/PAN-3342/request', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ source: 'pan-review-request' }),
    });

    expect(result.status).toBe(202);
    expect(result.body).not.toHaveProperty('adopting');
    expect(routeMocks.answerAdoptionInFlight).toHaveBeenCalledWith('PAN-3342');
    await vi.waitFor(() => {
      expect(routeMocks.spawnReviewRoleForIssue).toHaveBeenCalledOnce();
    });
    expect(routeMocks.runVerificationForIssue).toHaveBeenCalledOnce();
  });
});

// PAN-4820 (AD-5): a Deft issue runs Deft's own review cycle, so the request
// door refuses before it transitions the issue or journals anything; a
// journalled `review.requested` would make the Deacon re-request every tick.
describe('POST /api/review/:issueId/request — Deft issue (PAN-4820)', () => {
  it('answers 409 and neither transitions the issue nor journals review.requested', async () => {
    routeMocks.isDeftPipelineIssue.mockResolvedValue(true);
    const { appendPipelineEntry } = await import('../../../../../lib/cloister/pipeline-journal.js');
    vi.mocked(appendPipelineEntry).mockClear();

    const result = await post('/api/review/PAN-3340/request', {
      method: 'POST',
      headers: authHeaders,
      body: '{}',
    });

    expect(result).toEqual({ status: 409, body: { success: false, error: 'PAN-3340 runs on Deft; Overdeck review is off' } });
    expect(routeMocks.transitionIssueToInReview).not.toHaveBeenCalled();
    expect(vi.mocked(appendPipelineEntry).mock.calls.filter(([, entry]) => entry.type === 'review.requested')).toEqual([]);
  });
});

// PAN-4622: boot adoption resumes a request Overdeck already accepted. A worker
// installing dependencies can leave a tracked file modified at boot, so the
// resumed request skips the dirty-tree refusal and checks head and tree at
// dispatch time instead; the owed dispatch is cleared only once review spawns.
describe('startRequestReviewPipeline — resumed by boot adoption (PAN-4622)', () => {
  let dirtyWorkspace: string;

  beforeEach(() => {
    dirtyWorkspace = mkdtempSync(join(tmpdir(), 'review-door-resume-'));
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dirtyWorkspace, stdio: 'ignore' });
    git('init', '-q');
    writeFileSync(join(dirtyWorkspace, 'package.json'), '{}');
    git('add', 'package.json');
    git('commit', '-q', '-m', 'base');
    writeFileSync(join(dirtyWorkspace, 'package.json'), '{"installing":true}');
    routeMocks.getWorkspaceInfoForIssue.mockReturnValue({ exists: true, isRemote: false, localPath: dirtyWorkspace });
    routeMocks.pushLocalReviewBranches.mockResolvedValue(undefined);
    routeMocks.runVerificationForIssue.mockReturnValue(Effect.succeed({ outcome: 'passed' }));
    routeMocks.spawnReviewRoleForIssue.mockReturnValue(Effect.succeed({ success: true, message: 'spawned' }));
  });

  afterEach(() => {
    rmSync(dirtyWorkspace, { recursive: true, force: true });
  });

  it('a fresh request is refused on a dirty tree, but a resumed one starts and checks the tree at dispatch', async () => {
    expect(await startRequestReviewPipeline('PAN-3340')).toMatchObject({ started: false, reason: 'dirty-workspace' });
    expect(routeMocks.runVerificationForIssue).not.toHaveBeenCalled();

    let treeError: string | null | undefined;
    routeMocks.confirmResumedDispatch.mockImplementation(async (_issueId: string, _path: string, dirtyError: () => Promise<string | null>) => {
      treeError = await dirtyError();
      return treeError === null;
    });

    expect(await startRequestReviewPipeline('PAN-3340', { source: 'verification-adoption', resume: true })).toEqual({ started: true });
    await vi.waitFor(() => expect(routeMocks.confirmResumedDispatch).toHaveBeenCalledWith('PAN-3340', dirtyWorkspace, expect.any(Function)));
    await vi.waitFor(() => expect(requestReviewPipeline.isInFlight('PAN-3340')).toBe(false));

    expect(routeMocks.runVerificationForIssue).toHaveBeenCalledOnce();
    expect(treeError).toContain('uncommitted changes');
    expect(routeMocks.pushLocalReviewBranches).not.toHaveBeenCalled();
    expect(routeMocks.spawnReviewRoleForIssue).not.toHaveBeenCalled();
  });

  it('the dispatch-time tree check fails closed when git cannot read the tree', async () => {
    routeMocks.getWorkspaceInfoForIssue.mockReturnValue({ exists: true, isRemote: false, localPath: join(dirtyWorkspace, 'gone') });
    let treeError: string | null | undefined;
    routeMocks.confirmResumedDispatch.mockImplementation(async (_issueId: string, _path: string, dirtyError: () => Promise<string | null>) => {
      treeError = await dirtyError();
      return false;
    });

    await startRequestReviewPipeline('PAN-3340', { source: 'verification-adoption', resume: true });
    await vi.waitFor(() => expect(treeError).toEqual(expect.stringContaining('Could not read the working tree')));
  });

  it('clears the owed dispatch when review spawns, and keeps it when the spawn is gated', async () => {
    routeMocks.confirmResumedDispatch.mockResolvedValue(true);

    await startRequestReviewPipeline('PAN-3340', { source: 'verification-adoption', resume: true });
    await vi.waitFor(() => expect(routeMocks.spawnReviewRoleForIssue).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(requestReviewPipeline.isInFlight('PAN-3340')).toBe(false));
    expect(routeMocks.clearVerificationDispatchOwed).toHaveBeenCalledWith('PAN-3340');

    routeMocks.clearVerificationDispatchOwed.mockClear();
    routeMocks.spawnReviewRoleForIssue.mockReturnValue(Effect.succeed({ success: false, gated: true, message: 'Review dispatch deferred: conflicts' }));
    await startRequestReviewPipeline('PAN-3340', { source: 'verification-adoption', resume: true });
    await vi.waitFor(() => expect(routeMocks.spawnReviewRoleForIssue).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(requestReviewPipeline.isInFlight('PAN-3340')).toBe(false));
    expect(routeMocks.clearVerificationDispatchOwed).not.toHaveBeenCalled();
  });
});
