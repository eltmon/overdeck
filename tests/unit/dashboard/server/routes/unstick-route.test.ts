/**
 * Route-contract tests for POST /api/workspaces/:issueId/unstick (PAN-653).
 *
 * Exercises processUnstickRequest() — the extracted testable core of the unstick
 * route handler — covering the three HTTP response contracts:
 *
 *   404  workspace does not exist
 *   400  workspace exists but is not stuck
 *   200  workspace is stuck → clear flag + reset lifecycle → success body
 *
 * processUnstickRequest() is exported from workspaces.ts following the project's
 * established pattern for route helper extraction (computeStuckCount, parseGitActivityParams,
 * pushApproveMain). The route handler calls it and maps the UnstickResult to an HTTP response.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from '../../../../../src/lib/database/schema.js';

// ─── In-memory DB injection (needed for clearWorkspaceStuck / setReviewStatus) ─

let testDb: Database.Database;

vi.mock('../../../../../src/lib/database/index.js', () => ({
  getDatabase: () => testDb,
}));

// Stub pipeline notifier (no WebSocket bus in tests)
vi.mock('../../../../../src/lib/pipeline-notifier.js', () => ({
  notifyPipeline: vi.fn(),
}));
vi.mock('../../../../../src/lib/activity-logger.js', () => ({
  emitActivityEntry: vi.fn(),
}));

// Stub modules imported at workspaces.ts module scope
vi.mock('../../../../../src/lib/projects.js', () => ({ resolveProjectFromIssue: vi.fn() }));
vi.mock('../../../../../src/lib/cloister/service.js', () => ({ getCloisterService: vi.fn() }));
vi.mock('../../../../../src/lib/agents.js', () => ({
  listRunningAgents: vi.fn().mockReturnValue([]),
  getAgentState: vi.fn(),
  saveAgentState: vi.fn(),
  messageAgent: vi.fn(),
  saveAgentRuntimeState: vi.fn(),
  getAgentRuntimeState: vi.fn(),
  transitionIssueToInReview: vi.fn(),
}));
vi.mock('../../../../../src/lib/git/operations.js', () => ({
  gitPush: vi.fn(),
  gitForcePush: vi.fn(),
  gitFetch: vi.fn(),
  gitMerge: vi.fn(),
  MainDivergedError: class MainDivergedError extends Error {},
}));

beforeEach(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  initSchema(testDb);
});

afterEach(() => {
  testDb.close();
});

// ─── Import under test (after mocks) ──────────────────────────────────────────

import { processUnstickRequest } from '../../../../../src/dashboard/server/routes/workspaces.js';
import { markWorkspaceStuck, getReviewStatusFromDb } from '../../../../../src/lib/database/review-status-db.js';
import { setReviewStatus, getReviewStatus } from '../../../../../src/lib/review-status.js';

// ─── Route-contract tests ─────────────────────────────────────────────────────

describe('processUnstickRequest — POST /api/workspaces/:issueId/unstick route contract', () => {
  it('404: returns httpStatus=404 when workspace does not exist', () => {
    const result = processUnstickRequest('PAN-404', false, null);

    expect(result.httpStatus).toBe(404);
    expect(result.body.success).toBe(false);
    expect((result.body as { error: string }).error).toMatch(/does not exist/i);
  });

  it('400: returns httpStatus=400 when workspace exists but is not stuck', () => {
    // workspace exists (workspaceExists=true) but currentStatus has stuck=false/undefined
    const notStuckStatus = getReviewStatus('PAN-NOT-STUCK');  // returns null — not stuck

    const result = processUnstickRequest('PAN-NOT-STUCK', true, notStuckStatus);

    expect(result.httpStatus).toBe(400);
    expect(result.body.success).toBe(false);
    expect((result.body as { error: string }).error).toMatch(/not stuck/i);
  });

  it('400: returns httpStatus=400 even when a non-stuck status row exists', () => {
    // Pre-populate a non-stuck status row
    setReviewStatus('PAN-PENDING', { reviewStatus: 'pending', testStatus: 'pending' });
    const status = getReviewStatus('PAN-PENDING');  // stuck is falsy

    const result = processUnstickRequest('PAN-PENDING', true, status);

    expect(result.httpStatus).toBe(400);
  });

  it('200: returns httpStatus=200 and clears stuck flag for a genuinely stuck workspace', () => {
    // Set up a stuck workspace
    setReviewStatus('PAN-STUCK', { reviewStatus: 'passed', testStatus: 'passed' });
    markWorkspaceStuck('PAN-STUCK', 'main_diverged', { localSha: 'aaa', remoteSha: 'bbb' });

    const stuckStatus = getReviewStatus('PAN-STUCK');
    expect(stuckStatus?.stuck).toBe(true);  // precondition

    const result = processUnstickRequest('PAN-STUCK', true, stuckStatus);

    expect(result.httpStatus).toBe(200);
    expect(result.body.success).toBe(true);
    expect((result.body as { issueId: string }).issueId).toBe('PAN-STUCK');
    expect((result.body as { previousReason?: string }).previousReason).toBe('main_diverged');

    // Side effect: stuck flag must be cleared
    const after = getReviewStatusFromDb('PAN-STUCK');
    expect(after?.stuck).toBeFalsy();
  });

  it('200: resets reviewStatus/testStatus/readyForMerge to pending after unstick', () => {
    // Simulate workspace that passed review but got stuck before merge
    setReviewStatus('PAN-RESET', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      readyForMerge: true,
    });
    markWorkspaceStuck('PAN-RESET', 'main_diverged');
    const stuckStatus = getReviewStatus('PAN-RESET');

    processUnstickRequest('PAN-RESET', true, stuckStatus);

    // Lifecycle must be reset so deacon's orphan-recovery can re-dispatch
    const after = getReviewStatus('PAN-RESET');
    expect(after?.reviewStatus).toBe('pending');
    expect(after?.testStatus).toBe('pending');
    expect(after?.readyForMerge).toBe(false);
    expect(after?.stuck).toBeFalsy();
  });

  it('200: includes previousReason in the response body', () => {
    setReviewStatus('PAN-REASON', { reviewStatus: 'reviewing' });
    markWorkspaceStuck('PAN-REASON', 'main_diverged');
    const stuckStatus = getReviewStatus('PAN-REASON');

    const result = processUnstickRequest('PAN-REASON', true, stuckStatus);

    expect(result.httpStatus).toBe(200);
    expect((result.body as { previousReason?: string }).previousReason).toBe('main_diverged');
  });
});
