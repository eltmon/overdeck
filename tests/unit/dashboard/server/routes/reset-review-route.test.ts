/**
 * Route-contract tests for POST /api/review/:issueId/reset (PAN-805).
 *
 * Regression: the reset endpoint previously called saveAgentRuntimeState() with
 * resolution='working' / resolutionCount=0, wiping the work-agent's lifecycle
 * resolution (unclear/stuck/needs_input) on every reset. Since `pan done`'s
 * self-heal path also triggers this endpoint, a genuinely-confused agent's
 * unclear count was zeroed out before the escalation gate could fire, so PAN-805
 * never escalated to stuck even after many UNCLEAR verdicts.
 *
 * The fix removed the resolution-reset block from the route handler. This test
 * locks that behavior down: calling processResetReviewPipeline() must NOT
 * mutate the work-agent's runtime state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from '../../../../../src/lib/database/schema.js';

// ─── In-memory DB (needed for setReviewStatus) ────────────────────────────────

let testDb: Database.Database;

vi.mock('../../../../../src/lib/database/index.js', () => ({
  getDatabase: () => testDb,
}));

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

// Stub modules imported at workspaces.ts module scope.
vi.mock('../../../../../src/lib/projects.js', () => ({ resolveProjectFromIssue: vi.fn() }));
vi.mock('../../../../../src/lib/cloister/service.js', () => ({ getCloisterService: vi.fn() }));

// CRITICAL: capture saveAgentRuntimeState so we can assert it was NOT called
// with resolution/resolutionCount in the patch — that is the bug we are
// regressing against. vi.hoisted() is required because vi.mock() factory
// callbacks are hoisted to the top of the file.
const { saveAgentRuntimeStateMock, getAgentRuntimeStateMock } = vi.hoisted(() => ({
  saveAgentRuntimeStateMock: vi.fn(),
  getAgentRuntimeStateMock: vi.fn(),
}));

vi.mock('../../../../../src/lib/agents.js', () => ({
  listRunningAgents: vi.fn().mockReturnValue([]),
  listRunningAgentsSync: vi.fn().mockReturnValue([]),
  getAgentState: vi.fn(),
  getAgentStateSync: vi.fn(),
  saveAgentState: vi.fn(),
  saveAgentStateSync: vi.fn(),
  messageAgent: vi.fn(),
  saveAgentRuntimeState: saveAgentRuntimeStateMock,
  getAgentRuntimeState: getAgentRuntimeStateMock,
  getAgentRuntimeStateSync: getAgentRuntimeStateMock,
  getAgentRuntimeStateAsync: vi.fn(),
  transitionIssueToInReview: vi.fn(),
  spawnAgent: vi.fn(),
  getAgentStateAsync: vi.fn(),
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
  saveAgentRuntimeStateMock.mockReset();
  getAgentRuntimeStateMock.mockReset();
});

afterEach(() => {
  testDb.close();
});

// ─── Import under test (after mocks) ──────────────────────────────────────────

import { processResetReviewPipeline } from '../../../../../src/dashboard/server/routes/workspaces.js';
import { setReviewStatusSync, getReviewStatusSync } from '../../../../../src/lib/review-status.js';

// ─── Route-contract tests ─────────────────────────────────────────────────────

describe('processResetReviewPipeline — POST /api/review/:issueId/reset route contract', () => {
  it('400: returns httpStatus=400 when workspace does not exist', () => {
    const result = processResetReviewPipeline('PAN-MISSING', false);

    expect(result.httpStatus).toBe(400);
    expect(result.body.success).toBe(false);
    expect((result.body as { error: string }).error).toMatch(/does not exist/i);
  });

  it('400 path does NOT mutate agent runtime state', () => {
    processResetReviewPipeline('PAN-MISSING', false);
    expect(saveAgentRuntimeStateMock).not.toHaveBeenCalled();
  });

  it('200: resets review/test/merge/verification status to pending', () => {
    setReviewStatusSync('PAN-1', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      mergeStatus: 'failed',
      readyForMerge: true,
      autoRequeueCount: 3,
      verificationStatus: 'passed',
      verificationCycleCount: 2,
    });

    const result = processResetReviewPipeline('PAN-1', true);

    expect(result.httpStatus).toBe(200);
    expect(result.body.success).toBe(true);

    const after = getReviewStatusSync('PAN-1');
    expect(after?.reviewStatus).toBe('pending');
    expect(after?.testStatus).toBe('pending');
    expect(after?.mergeStatus).toBe('pending');
    expect(after?.readyForMerge).toBe(false);
    expect(after?.autoRequeueCount).toBe(0);
    expect(after?.verificationStatus).toBe('pending');
    expect(after?.verificationCycleCount).toBe(0);
  });

  it('200: clears the stuck marker and circuit-breaker retry counters', () => {
    // A human-initiated reset is an explicit circuit-breaker override. If the
    // stuck marker / retry budgets survive, the deacon immediately re-skips the
    // workspace and the "override" is a no-op (root cause of the PAN-977 jam).
    setReviewStatusSync('PAN-2', {
      reviewStatus: 'passed',
      testStatus: 'pending',
      stuck: true,
      stuckReason: 'review_infrastructure_failure',
      stuckAt: new Date().toISOString(),
      stuckDetails: '{"reviewRetryCount":3}',
      reviewRetryCount: 3,
      testRetryCount: 3,
      mergeRetryCount: 2,
      recoveryStartedAt: new Date().toISOString(),
    });

    const result = processResetReviewPipeline('PAN-2', true);
    expect(result.httpStatus).toBe(200);

    const after = getReviewStatusSync('PAN-2');
    expect(after?.stuck).toBeFalsy();
    expect(after?.stuckReason).toBeUndefined();
    expect(after?.stuckAt).toBeUndefined();
    expect(after?.stuckDetails).toBeUndefined();
    expect(after?.reviewRetryCount).toBe(0);
    expect(after?.testRetryCount).toBe(0);
    expect(after?.mergeRetryCount).toBe(0);
    expect(after?.recoveryStartedAt).toBeUndefined();
  });

  // ─── THE REGRESSION TEST — locks down PAN-805 fix ──────────────────────────

  it('PAN-805 regression: does NOT call saveAgentRuntimeState (resolution stays untouched)', () => {
    // Simulate a work agent with an elevated unclear count — the kind of state
    // the old buggy code zeroed out, preventing escalation to stuck.
    getAgentRuntimeStateMock.mockReturnValue({
      state: 'stopped' as const,
      lastActivity: new Date().toISOString(),
      resolution: 'unclear' as const,
      resolutionCount: 5,
    });

    const result = processResetReviewPipeline('PAN-805', true);

    expect(result.httpStatus).toBe(200);

    // THE ASSERTION: resolution/resolutionCount MUST NOT be written.
    // If a future change re-introduces the bug, this catches it.
    expect(saveAgentRuntimeStateMock).not.toHaveBeenCalled();

    // Sanity: the observed prior state is surfaced in the response body so
    // it shows up in logs / audit trails.
    const body = result.body as {
      success: true;
      preservedResolution?: { agentId: string; resolution?: string; resolutionCount?: number };
    };
    expect(body.preservedResolution).toEqual({
      agentId: 'agent-pan-805',
      resolution: 'unclear',
      resolutionCount: 5,
    });
  });

  it('PAN-805 regression: does not call saveAgentRuntimeState even when runtime state is absent', () => {
    // No runtime state for this agent — the old code would still have written
    // resolution='working'/count=0 unconditionally.
    getAgentRuntimeStateMock.mockReturnValue(null);

    processResetReviewPipeline('PAN-NO-AGENT', true);

    expect(saveAgentRuntimeStateMock).not.toHaveBeenCalled();
  });

  it('PAN-805 regression: preserves stuck resolution across reset', () => {
    // A stuck work agent must remain stuck after the pipeline reset so Deacon's
    // patrol can still see it and take the appropriate action (abandon/poke).
    getAgentRuntimeStateMock.mockReturnValue({
      state: 'stopped' as const,
      lastActivity: new Date().toISOString(),
      resolution: 'stuck' as const,
      resolutionCount: 4,
    });

    processResetReviewPipeline('PAN-STUCK', true);

    expect(saveAgentRuntimeStateMock).not.toHaveBeenCalled();
  });
});
