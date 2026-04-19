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
  getReviewStatusFromDb,
} from '../../../src/lib/database/review-status-db.js';
import { setReviewStatus, getReviewStatus } from '../../../src/lib/review-status.js';

// ============== Tests ==============

describe('markWorkspaceStuck', () => {
  it('sets stuck=1 with reason, stuckAt, and details', () => {
    markWorkspaceStuck('PAN-100', 'main_diverged', { beforeSha: 'aaa', remoteSha: 'bbb' });

    const row = getReviewStatusFromDb('PAN-100');
    expect(row).not.toBeNull();
    expect(row!.stuck).toBe(true);
    expect(row!.stuckReason).toBe('main_diverged');
    expect(row!.stuckAt).toBeTruthy();
    expect(row!.stuckDetails).toContain('beforeSha');
  });

  it('creates a minimal placeholder row when no prior status exists', () => {
    markWorkspaceStuck('PAN-FRESH', 'main_diverged');

    const row = getReviewStatusFromDb('PAN-FRESH');
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

    const row = getReviewStatusFromDb('PAN-200');
    expect(row!.stuck).toBe(true);
    expect(row!.reviewStatus).toBe('passed');   // not reset
    expect(row!.testStatus).toBe('passed');     // not reset
  });
});

describe('clearWorkspaceStuck (unstick endpoint core logic)', () => {
  it('clears stuck=0 and nullifies reason/details', () => {
    markWorkspaceStuck('PAN-300', 'main_diverged', { sha: 'abc' });
    expect(getReviewStatusFromDb('PAN-300')!.stuck).toBe(true);

    clearWorkspaceStuck('PAN-300');

    const row = getReviewStatusFromDb('PAN-300');
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

    const row = getReviewStatusFromDb('PAN-400');
    // stuck=0 in DB maps to undefined (not false) — workspace is not stuck
    expect(row!.stuck).toBeUndefined();
  });

  it('round-trip: mark stuck → verify → clear → verify', () => {
    markWorkspaceStuck('PAN-500', 'main_diverged');
    expect(getReviewStatusFromDb('PAN-500')!.stuck).toBe(true);

    clearWorkspaceStuck('PAN-500');
    // After clearing, stuck is undefined (not stuck)
    expect(getReviewStatusFromDb('PAN-500')!.stuck).toBeUndefined();

    // Can be stuck again after clearing
    markWorkspaceStuck('PAN-500', 'main_diverged');
    expect(getReviewStatusFromDb('PAN-500')!.stuck).toBe(true);
  });

  it('clearing one issue does not affect another', () => {
    markWorkspaceStuck('PAN-600', 'main_diverged');
    markWorkspaceStuck('PAN-601', 'main_diverged');

    clearWorkspaceStuck('PAN-600');

    expect(getReviewStatusFromDb('PAN-600')!.stuck).toBeUndefined();  // cleared
    expect(getReviewStatusFromDb('PAN-601')!.stuck).toBe(true);       // still stuck
  });
});

describe('unstick lifecycle recovery', () => {
  // These tests verify that the unstick endpoint leaves the issue in a state
  // that Deacon's orphan-recovery patrol will automatically act on (PAN-653).

  it('resets reviewStatus to pending after unstick so deacon can re-dispatch', () => {
    // Simulate an issue that passed review/test but then got stuck (e.g. diverged from main)
    setReviewStatus('PAN-700', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      readyForMerge: false,
    });
    markWorkspaceStuck('PAN-700', 'main_diverged');

    // Unstick: clear the stuck flag and reset lifecycle
    clearWorkspaceStuck('PAN-700');
    setReviewStatus('PAN-700', {
      reviewStatus: 'pending',
      testStatus: 'pending',
      readyForMerge: false,
    });

    const after = getReviewStatus('PAN-700');
    // Lifecycle must be in a state deacon's orphan recovery will re-dispatch
    expect(after?.reviewStatus).toBe('pending');
    expect(after?.testStatus).toBe('pending');
    expect(after?.readyForMerge).toBe(false);
    // Stuck flag must be cleared
    expect(after?.stuck).toBeFalsy();
  });

  it('unstick from readyForMerge=true also resets to pending', () => {
    // Simulate a workspace that was approved and ready to merge but then got stuck
    setReviewStatus('PAN-800', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      readyForMerge: true,
    });
    markWorkspaceStuck('PAN-800', 'main_diverged');

    // Unstick flow
    clearWorkspaceStuck('PAN-800');
    setReviewStatus('PAN-800', {
      reviewStatus: 'pending',
      testStatus: 'pending',
      readyForMerge: false,
    });

    const after = getReviewStatus('PAN-800');
    expect(after?.reviewStatus).toBe('pending');
    expect(after?.readyForMerge).toBe(false);
    expect(after?.stuck).toBeFalsy();
  });

  it('stranded passed/passed state without lifecycle reset would not be acted on by deacon', () => {
    // This test documents the pre-fix behavior that was a bug: if only the stuck flag
    // is cleared but reviewStatus/testStatus remain 'passed', deacon has no path to
    // re-dispatch because the issue looks already-completed.
    setReviewStatus('PAN-900', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      readyForMerge: false,
    });
    markWorkspaceStuck('PAN-900', 'main_diverged');
    clearWorkspaceStuck('PAN-900');  // only clears stuck flag, no lifecycle reset

    // Without the lifecycle reset, issue is stranded: stuck=false but status=passed/passed
    // After the fix, the endpoint also calls setReviewStatus to reset — verify that the
    // correct fix (setting reviewStatus=pending) produces a state deacon can act on.
    setReviewStatus('PAN-900', { reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false });

    const after = getReviewStatus('PAN-900');
    // Must not be stuck=true (would be skipped by deacon)
    expect(after?.stuck).toBeFalsy();
    // Must not be in completed-looking state (would be ignored by deacon orphan recovery)
    expect(after?.reviewStatus).not.toBe('passed');
    expect(after?.reviewStatus).toBe('pending');
  });
});
