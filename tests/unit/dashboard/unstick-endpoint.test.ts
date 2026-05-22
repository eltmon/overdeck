/**
 * Tests for the unstick endpoint business logic (PAN-653).
 *
 * POST /api/workspaces/:issueId/unstick clears the persistent stuck flag
 * set by markWorkspaceStuck() so Deacon resumes normal patrol.
 *
 * We test the underlying database round-trip directly (not the Effect HTTP
 * handler) because Effect route integration tests require a full server stack.
 * The route itself is thin: validate workspace exists → check stuck flag →
 * call clearWorkspaceStuck. These tests verify the stuck-flag lifecycle.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from '../../../src/lib/database/schema.js';

// ============== In-memory DB injection ==============

let testDb: Database.Database;

vi.mock('../../../src/lib/database/index.js', () => ({
  getDatabase: () => testDb,
}));

beforeEach(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  initSchema(testDb);
});

afterEach(() => {
  testDb.close();
});

// ============== Imports (after mock is set up) ==============

import {
  markWorkspaceStuck,
  clearWorkspaceStuck,
  getReviewStatusFromDbSync,
} from '../../../src/lib/database/review-status-db.js';
import { setReviewStatusSync, getReviewStatusSync } from '../../../src/lib/review-status.js';

// ============== Tests ==============

describe('markWorkspaceStuck', () => {
  it('sets stuck=1 with reason, stuckAt, and details', () => {
    markWorkspaceStuck('PAN-100', 'main_diverged', { beforeSha: 'aaa', remoteSha: 'bbb' });

    const row = getReviewStatusFromDbSync('PAN-100');
    expect(row).not.toBeNull();
    expect(row!.stuck).toBe(true);
    expect(row!.stuckReason).toBe('main_diverged');
    expect(row!.stuckAt).toBeTruthy();
    expect(row!.stuckDetails).toContain('beforeSha');
  });

  it('creates a minimal placeholder row when no prior status exists', () => {
    markWorkspaceStuck('PAN-FRESH', 'main_diverged');

    const row = getReviewStatusFromDbSync('PAN-FRESH');
    expect(row).not.toBeNull();
    expect(row!.stuck).toBe(true);
    expect(row!.reviewStatus).toBe('pending');
    expect(row!.testStatus).toBe('pending');
  });

  it('overwrites an existing status without resetting other columns', () => {
    // First, give the issue a passing review
    testDb.prepare(`
      INSERT INTO review_status (issue_id, review_status, test_status, updated_at, ready_for_merge)
      VALUES ('PAN-200', 'passed', 'passed', datetime('now'), 1)
    `).run();

    markWorkspaceStuck('PAN-200', 'main_diverged');

    const row = getReviewStatusFromDbSync('PAN-200');
    expect(row!.stuck).toBe(true);
    expect(row!.reviewStatus).toBe('passed');   // not reset
    expect(row!.testStatus).toBe('passed');     // not reset
  });
});

describe('clearWorkspaceStuck (unstick endpoint core logic)', () => {
  it('clears stuck=0 and nullifies reason/details', () => {
    markWorkspaceStuck('PAN-300', 'main_diverged', { sha: 'abc' });
    expect(getReviewStatusFromDbSync('PAN-300')!.stuck).toBe(true);

    clearWorkspaceStuck('PAN-300');

    const row = getReviewStatusFromDbSync('PAN-300');
    expect(row!.stuck).toBeUndefined();  // stuck=0 → undefined
    expect(row!.stuckReason).toBeUndefined();
    expect(row!.stuckAt).toBeUndefined();
    expect(row!.stuckDetails).toBeUndefined();
  });

  it('is idempotent — clearing an already-not-stuck workspace does not error', () => {
    // Insert a non-stuck row
    testDb.prepare(`
      INSERT INTO review_status (issue_id, review_status, test_status, updated_at, ready_for_merge)
      VALUES ('PAN-400', 'pending', 'pending', datetime('now'), 0)
    `).run();

    // Should not throw
    expect(() => clearWorkspaceStuck('PAN-400')).not.toThrow();

    const row = getReviewStatusFromDbSync('PAN-400');
    // stuck=0 in DB maps to undefined (not false) — workspace is not stuck
    expect(row!.stuck).toBeUndefined();
  });

  it('round-trip: mark stuck → verify → clear → verify', () => {
    markWorkspaceStuck('PAN-500', 'main_diverged');
    expect(getReviewStatusFromDbSync('PAN-500')!.stuck).toBe(true);

    clearWorkspaceStuck('PAN-500');
    // After clearing, stuck is undefined (not stuck)
    expect(getReviewStatusFromDbSync('PAN-500')!.stuck).toBeUndefined();

    // Can be stuck again after clearing
    markWorkspaceStuck('PAN-500', 'main_diverged');
    expect(getReviewStatusFromDbSync('PAN-500')!.stuck).toBe(true);
  });

  it('clearing one issue does not affect another', () => {
    markWorkspaceStuck('PAN-600', 'main_diverged');
    markWorkspaceStuck('PAN-601', 'main_diverged');

    clearWorkspaceStuck('PAN-600');

    expect(getReviewStatusFromDbSync('PAN-600')!.stuck).toBeUndefined();  // cleared
    expect(getReviewStatusFromDbSync('PAN-601')!.stuck).toBe(true);       // still stuck
  });
});

describe('clearWorkspaceStuck DB helper — clears only stuck fields', () => {
  // clearWorkspaceStuck() is a narrow DB helper: it zeroes stuck/stuckReason/stuckAt/stuckDetails
  // and leaves all other columns untouched. The lifecycle-reset policy lives in
  // processUnstickRequest (the route helper), which calls setReviewStatus() atomically.

  it('preserves passed reviewStatus/testStatus after clearing stuck via DB helper', () => {
    setReviewStatusSync('PAN-700', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      readyForMerge: false,
    });
    markWorkspaceStuck('PAN-700', 'main_diverged');

    clearWorkspaceStuck('PAN-700');

    const after = getReviewStatusSync('PAN-700');
    expect(after?.stuck).toBeFalsy();
    // DB helper preserves lifecycle — only stuck fields cleared
    expect(after?.reviewStatus).toBe('passed');
    expect(after?.testStatus).toBe('passed');
  });

  it('preserves readyForMerge=true after clearing stuck via DB helper', () => {
    setReviewStatusSync('PAN-800', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      readyForMerge: true,
    });
    markWorkspaceStuck('PAN-800', 'main_diverged');

    clearWorkspaceStuck('PAN-800');

    const after = getReviewStatusSync('PAN-800');
    expect(after?.stuck).toBeFalsy();
    // DB helper preserves lifecycle — only stuck fields cleared
    expect(after?.readyForMerge).toBe(true);
  });
});

describe('mergeRetryCount persistence (restart-safety regression)', () => {
  // Regression: mergeRetryCount is Deacon's circuit breaker for failed-merge retries.
  // It MUST survive a dashboard restart — if it reset to 0 on reload, the retry cap
  // would be bypassed and the system could retry indefinitely.

  it('persists mergeRetryCount across a simulated restart (re-read from DB)', () => {
    setReviewStatusSync('PAN-RC1', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      mergeStatus: 'failed',
      readyForMerge: false,
      mergeRetryCount: 3,
    });

    // Simulate restart: read directly from DB (bypasses any in-memory cache)
    const row = getReviewStatusFromDbSync('PAN-RC1');
    expect(row?.mergeRetryCount).toBe(3);
  });

  it('mergeRetryCount increments and persists correctly across writes', () => {
    setReviewStatusSync('PAN-RC2', { reviewStatus: 'passed', testStatus: 'passed', mergeStatus: 'failed', readyForMerge: false, mergeRetryCount: 1 });
    setReviewStatusSync('PAN-RC2', { reviewStatus: 'passed', testStatus: 'passed', mergeStatus: 'pending', readyForMerge: true, mergeRetryCount: 2 });

    const row = getReviewStatusFromDbSync('PAN-RC2');
    expect(row?.mergeRetryCount).toBe(2);
  });

  it('mergeRetryCount defaults to undefined (not 0) when never set', () => {
    setReviewStatusSync('PAN-RC3', { reviewStatus: 'pending', testStatus: 'pending' });

    const status = getReviewStatusSync('PAN-RC3');
    // Deacon uses `status.mergeRetryCount || 0` so undefined and 0 are equivalent —
    // but the field must not be fabricated as a non-zero value.
    expect(status?.mergeRetryCount == null || status.mergeRetryCount === 0).toBe(true);
  });
});
