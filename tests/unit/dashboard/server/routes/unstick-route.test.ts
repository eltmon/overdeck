/**
 * Route-contract tests for POST /api/workspaces/:issueId/unstick (PAN-653).
 *
 * Exercises processUnstickRequest() — the extracted testable core of the unstick
 * route handler — covering the three HTTP response contracts:
 *
 *   404  workspace does not exist
 *   400  workspace exists but is not stuck
 *   409  workspace is stuck but git state not yet repaired
 *   200  workspace is stuck, git state verified safe → clear stuck + reset lifecycle → success body
 *
 * processUnstickRequest() is exported from workspaces.ts following the project's
 * established pattern for route helper extraction (computeStuckCount, parseGitActivityParams,
 * pushApproveMain). The route handler calls it and maps the UnstickResult to an HTTP response.
 *
 * PAN-1938: ported from panopticon.db to overdeck.db via setupOverdeckTestDb().
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../../helpers/overdeck-test-db.js';

// ─── Overdeck DB injection ────────────────────────────────────────────────────

let odb: OverdeckTestDb;

beforeEach(() => {
  odb = setupOverdeckTestDb();
}, 20_000);

afterEach(() => {
  teardownOverdeckTestDb(odb);
  vi.clearAllMocks();
});

// ─── Stubs not under test ─────────────────────────────────────────────────────

// PAN-1613: checkPostReviewCommits now gates on isIssueClosed, whose tracker
// fallback shells out to `gh issue view`. Keep this a hermetic unit test (no
// real network/tracker call) — the gate is never "closed" here.
vi.mock('../../../../../src/lib/cloister/issue-closed.js', () => ({
  isIssueClosed: vi.fn(async () => false),
  isTrackerIssueClosed: vi.fn(async () => false),
  clearIssueClosedCache: vi.fn(),
  TRACKER_CLOSED_CACHE_TTL_MS: 5 * 60 * 1000,
}));

// Stub pipeline notifier (no WebSocket bus in tests)
vi.mock('../../../../../src/lib/pipeline-notifier.js', () => ({
  notifyPipeline: vi.fn(),
  notifyPipelineSync: vi.fn(),
}));
vi.mock('../../../../../src/lib/activity-logger.js', () => ({
  emitActivityEntry: vi.fn(),
  emitActivityEntrySync: vi.fn(),
  emitActivityTts: vi.fn(),
  emitActivityTtsSync: vi.fn(),
}));

// Stub modules imported at workspaces.ts module scope
vi.mock('../../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
}));
vi.mock('../../../../../src/lib/cloister/service.js', () => ({ getCloisterService: vi.fn() }));
vi.mock('../../../../../src/lib/agents.js', () => ({
  listRunningAgents: vi.fn().mockReturnValue([]),
  listRunningAgentsSync: vi.fn().mockReturnValue([]),
  getAgentState: vi.fn(),
  getAgentStateSync: vi.fn(),
  saveAgentState: vi.fn(),
  saveAgentStateSync: vi.fn(),
  messageAgent: vi.fn(),
  saveAgentRuntimeState: vi.fn(),
  getAgentRuntimeState: vi.fn(),
  getAgentRuntimeStateSync: vi.fn(),
  transitionIssueToInReview: vi.fn(),
}));
vi.mock('../../../../../src/lib/git/operations.js', () => ({
  gitPush: vi.fn(),
  gitForcePush: vi.fn(),
  gitFetch: vi.fn(),
  gitMerge: vi.fn(),
  MainDivergedError: class MainDivergedError extends Error {},
}));

// ─── Import under test (after mocks) ──────────────────────────────────────────

import { processUnstickRequest, __testInternals } from '../../../../../src/dashboard/server/routes/workspaces/review-control.js';
import {
  markWorkspaceStuck,
  getReviewStatusFromDbSync,
} from '../../../../../src/lib/overdeck/review-status-sync.js';
import { setReviewStatusSync, getReviewStatusSync } from '../../../../../src/lib/review-status.js';

// ─── Route-contract tests ─────────────────────────────────────────────────────

describe('processUnstickRequest — POST /api/workspaces/:issueId/unstick route contract', () => {
  it('404: returns httpStatus=404 when workspace does not exist', () => {
    const result = processUnstickRequest('PAN-404', false, null, { safe: true });

    expect(result.httpStatus).toBe(404);
    expect(result.body.success).toBe(false);
    expect((result.body as { error: string }).error).toMatch(/does not exist/i);
  });

  it('400: returns httpStatus=400 when workspace exists but is not stuck', () => {
    // workspace exists (workspaceExists=true) but currentStatus has stuck=false/undefined
    const notStuckStatus = getReviewStatusSync('PAN-NOT-STUCK');  // returns null — not stuck

    const result = processUnstickRequest('PAN-NOT-STUCK', true, notStuckStatus, { safe: true });

    expect(result.httpStatus).toBe(400);
    expect(result.body.success).toBe(false);
    expect((result.body as { error: string }).error).toMatch(/not stuck/i);
  });

  it('400: returns httpStatus=400 even when a non-stuck status row exists', () => {
    // Pre-populate a non-stuck status row
    setReviewStatusSync('PAN-PENDING', { reviewStatus: 'pending', testStatus: 'pending' });
    const status = getReviewStatusSync('PAN-PENDING');  // stuck is falsy

    const result = processUnstickRequest('PAN-PENDING', true, status, { safe: true });

    expect(result.httpStatus).toBe(400);
  });

  it('409: returns recoverable advice when local main is ahead and dirty', () => {
    setReviewStatusSync('PAN-NOTRESET', { reviewStatus: 'passed', testStatus: 'passed' });
    markWorkspaceStuck('PAN-NOTRESET', 'main_diverged', { localSha: 'aaa', remoteSha: 'bbb' });
    const stuckStatus = getReviewStatusSync('PAN-NOTRESET');

    const result = processUnstickRequest('PAN-NOTRESET', true, stuckStatus, {
      safe: false,
      advice: 'In the project repo, commit the project repo changes that should be preserved; push the 10 local main commit(s) to origin/main.',
    });

    expect(result.httpStatus).toBe(409);
    expect(result.body.success).toBe(false);
    const error = (result.body as { error: string }).error;
    expect(error).toContain('commit the project repo changes');
    expect(error).toContain('push the 10 local main commit(s)');
    expect(error).not.toMatch(/git reset --hard/i);

    // Stuck flag must NOT be cleared — workspace is still unrepaired
    expect(getReviewStatusFromDbSync('PAN-NOTRESET')?.stuck).toBe(true);
  });

  it('200: returns httpStatus=200 and clears stuck flag for a genuinely stuck workspace', () => {
    // Set up a stuck workspace with repaired project main state.
    setReviewStatusSync('PAN-STUCK', { reviewStatus: 'passed', testStatus: 'passed' });
    markWorkspaceStuck('PAN-STUCK', 'main_diverged', { localSha: 'aaa', remoteSha: 'bbb' });

    const stuckStatus = getReviewStatusSync('PAN-STUCK');
    expect(stuckStatus?.stuck).toBe(true);  // precondition

    const result = processUnstickRequest('PAN-STUCK', true, stuckStatus, { safe: true });

    expect(result.httpStatus).toBe(200);
    expect(result.body.success).toBe(true);
    expect((result.body as { issueId: string }).issueId).toBe('PAN-STUCK');
    expect((result.body as { previousReason?: string }).previousReason).toBe('main_diverged');

    // Side effect: stuck flag must be cleared
    const after = getReviewStatusFromDbSync('PAN-STUCK');
    expect(after?.stuck).toBeFalsy();
  });

  it('200: resets reviewStatus/testStatus to pending after unstick (lifecycle invalidated)', () => {
    // Unstick resets lifecycle because recovery changes project main state,
    // making prior passed results invalid.
    setReviewStatusSync('PAN-RESET', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      readyForMerge: true,
    });
    markWorkspaceStuck('PAN-RESET', 'main_diverged');
    const stuckStatus = getReviewStatusSync('PAN-RESET');

    processUnstickRequest('PAN-RESET', true, stuckStatus, { safe: true });

    const after = getReviewStatusSync('PAN-RESET');
    // Stuck flag cleared — Deacon will process the issue again
    expect(after?.stuck).toBeFalsy();
    // Lifecycle reset — prior results are invalid after project main repair.
    expect(after?.reviewStatus).toBe('pending');
    expect(after?.testStatus).toBe('pending');
    expect(after?.readyForMerge).toBe(false);
  });

  it('200: includes previousReason in the response body', () => {
    setReviewStatusSync('PAN-REASON', { reviewStatus: 'reviewing' });
    markWorkspaceStuck('PAN-REASON', 'main_diverged');
    const stuckStatus = getReviewStatusSync('PAN-REASON');

    const result = processUnstickRequest('PAN-REASON', true, stuckStatus, { safe: true });

    expect(result.httpStatus).toBe(200);
    expect((result.body as { previousReason?: string }).previousReason).toBe('main_diverged');
  });

  it('200: clears reviewedAtCommit so deacon does not re-trigger post-review reset', () => {
    // Regression: without clearing reviewedAtCommit, Deacon's checkPostReviewCommits()
    // would detect HEAD != reviewedAtCommit immediately after unstick and reset the
    // pipeline a second time, causing duplicate invalidation / stale state.
    setReviewStatusSync('PAN-RAC-CLEAR', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      readyForMerge: true,
      reviewedAtCommit: 'sha-before-divergence',
    });
    markWorkspaceStuck('PAN-RAC-CLEAR', 'main_diverged');
    const stuckStatus = getReviewStatusSync('PAN-RAC-CLEAR');

    processUnstickRequest('PAN-RAC-CLEAR', true, stuckStatus, { safe: true });

    const after = getReviewStatusSync('PAN-RAC-CLEAR');
    expect(after?.reviewedAtCommit).toBeUndefined();
  });

  it('200: clears review_cycle_history when unsticking review-not-converging (PAN-3151 regression)', () => {
    // PAN-3151: When convergence detection marks an issue stuck with stuckReason=review-not-converging,
    // unstick must clear the cycle history so a fresh attempt doesn't immediately re-trigger the gate.
    // Regression: without clearing, the history series would re-engage convergence detection immediately.
    setReviewStatusSync('PAN-CONV-CLEAR', {
      reviewStatus: 'blocked',
      testStatus: 'passed',
    });
    markWorkspaceStuck('PAN-CONV-CLEAR', 'review-not-converging', {
      blockingCount: 8,
      cycleCount: 3,
    });
    // Pre-populate cycle history to simulate a stuck convergence scenario
    const stuckStatusBefore = getReviewStatusSync('PAN-CONV-CLEAR');
    expect(stuckStatusBefore?.stuck).toBe(true);
    expect(stuckStatusBefore?.stuckReason).toBe('review-not-converging');

    processUnstickRequest('PAN-CONV-CLEAR', true, stuckStatusBefore, { safe: true });

    const after = getReviewStatusSync('PAN-CONV-CLEAR');
    // Convergence history must be cleared so a fresh rework attempt doesn't re-engage the gate
    expect(after?.reviewCycleHistory).toBeUndefined();
    // Stuck flag cleared — deacon will process the issue again from a clean slate
    expect(after?.stuck).toBeFalsy();
  });
});

describe('buildUnstickRepairAdvice', () => {
  const { buildUnstickRepairAdvice } = __testInternals;

  it('returns no advice when project main matches origin/main and is clean', () => {
    expect(buildUnstickRepairAdvice(0, 0, false)).toBeNull();
  });

  it('tells operators to commit or explicitly discard dirty project repo changes', () => {
    const advice = buildUnstickRepairAdvice(0, 0, true) ?? '';

    expect(advice).toContain('commit the project repo changes');
    expect(advice).toContain('explicitly discard only changes known to be disposable');
    expect(advice).not.toMatch(/git reset --hard/i);
  });

  it('tells operators to push local-only main commits when main is ahead', () => {
    const advice = buildUnstickRepairAdvice(10, 0, false) ?? '';

    expect(advice).toContain('push the 10 local main commit(s) to origin/main');
    expect(advice).not.toMatch(/git reset --hard/i);
  });

  it('tells operators to fast-forward when local main is behind origin/main', () => {
    const advice = buildUnstickRepairAdvice(0, 3, false) ?? '';

    expect(advice).toContain('fast-forward local main from origin/main');
    expect(advice).toContain('3 commit(s) behind');
    expect(advice).not.toMatch(/git reset --hard/i);
  });

  it('tells operators to reconcile and push when main has diverged', () => {
    const advice = buildUnstickRepairAdvice(2, 4, false) ?? '';

    expect(advice).toContain('reconcile local main with origin/main');
    expect(advice).toContain('preserving the 2 local commit(s)');
    expect(advice).toContain('push the reconciled main');
    expect(advice).not.toMatch(/git reset --hard/i);
  });
});
