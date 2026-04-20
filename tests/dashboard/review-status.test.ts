/**
 * Tests for review status history tracking (PAN-128)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  setReviewStatus,
  getReviewStatus,
  clearReviewStatus,
  loadReviewStatuses,
  saveReviewStatuses,
} from '../../src/lib/review-status-json.js';

let testDir: string;
let statusFile: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'review-status-test-'));
  mkdirSync(testDir, { recursive: true });
  statusFile = join(testDir, 'review-status.json');
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('setReviewStatus', () => {
  it('creates a new status with default values', () => {
    const result = setReviewStatus('PAN-100', { reviewStatus: 'reviewing' }, statusFile);
    expect(result.issueId).toBe('PAN-100');
    expect(result.reviewStatus).toBe('reviewing');
    expect(result.testStatus).toBe('pending');
    expect(result.readyForMerge).toBe(false);
    expect(result.updatedAt).toBeTruthy();
  });

  it('tracks review status changes in history', () => {
    setReviewStatus('PAN-101', { reviewStatus: 'reviewing' }, statusFile);
    const result = setReviewStatus('PAN-101', { reviewStatus: 'passed' }, statusFile);

    expect(result.history).toHaveLength(2);
    expect(result.history![0].type).toBe('review');
    expect(result.history![0].status).toBe('reviewing');
    expect(result.history![1].type).toBe('review');
    expect(result.history![1].status).toBe('passed');
  });

  it('tracks test status changes in history', () => {
    setReviewStatus('PAN-102', { testStatus: 'testing' }, statusFile);
    const result = setReviewStatus('PAN-102', { testStatus: 'passed' }, statusFile);

    expect(result.history).toHaveLength(2);
    expect(result.history![0].type).toBe('test');
    expect(result.history![0].status).toBe('testing');
    expect(result.history![1].type).toBe('test');
    expect(result.history![1].status).toBe('passed');
  });

  it('tracks merge status changes in history', () => {
    setReviewStatus('PAN-103', {
      reviewStatus: 'passed',
      testStatus: 'passed',
    }, statusFile);
    const result = setReviewStatus('PAN-103', { mergeStatus: 'merged' }, statusFile);

    expect(result.history!.some(h => h.type === 'merge' && h.status === 'merged')).toBe(true);
  });

  it('does not add history entry when status is unchanged', () => {
    setReviewStatus('PAN-104', { reviewStatus: 'reviewing' }, statusFile);
    const result = setReviewStatus('PAN-104', { reviewStatus: 'reviewing' }, statusFile);

    expect(result.history).toHaveLength(1);
  });

  it('includes notes in history entries', () => {
    const result = setReviewStatus('PAN-105', {
      reviewStatus: 'blocked',
      reviewNotes: 'Missing error handling',
    }, statusFile);

    expect(result.history).toHaveLength(1);
    expect(result.history![0].notes).toBe('Missing error handling');
  });

  it('limits history to 10 entries', () => {
    // Create 12 status changes
    for (let i = 0; i < 6; i++) {
      setReviewStatus('PAN-106', { reviewStatus: 'reviewing' }, statusFile);
      setReviewStatus('PAN-106', { reviewStatus: 'failed', reviewNotes: `Attempt ${i + 1}` }, statusFile);
    }

    const result = getReviewStatus('PAN-106', statusFile);
    expect(result!.history).toHaveLength(10);
    // 12 entries total, oldest 2 removed → starts at 3rd entry (reviewing, attempt 2)
    expect(result!.history![0].type).toBe('review');
    // Last entry should be the final failed
    expect(result!.history![9].status).toBe('failed');
    expect(result!.history![9].notes).toBe('Attempt 6');
  });

  it('records timestamps in history entries', () => {
    const before = new Date().toISOString();
    setReviewStatus('PAN-107', { reviewStatus: 'reviewing' }, statusFile);
    const after = new Date().toISOString();

    const result = getReviewStatus('PAN-107', statusFile);
    const timestamp = result!.history![0].timestamp;
    expect(timestamp >= before).toBe(true);
    expect(timestamp <= after).toBe(true);
  });

  it('tracks mixed review and test transitions', () => {
    setReviewStatus('PAN-108', { reviewStatus: 'reviewing' }, statusFile);
    setReviewStatus('PAN-108', { reviewStatus: 'passed' }, statusFile);
    setReviewStatus('PAN-108', { testStatus: 'testing' }, statusFile);
    const result = setReviewStatus('PAN-108', { testStatus: 'passed' }, statusFile);

    expect(result.history).toHaveLength(4);
    expect(result.history![0]).toMatchObject({ type: 'review', status: 'reviewing' });
    expect(result.history![1]).toMatchObject({ type: 'review', status: 'passed' });
    expect(result.history![2]).toMatchObject({ type: 'test', status: 'testing' });
    expect(result.history![3]).toMatchObject({ type: 'test', status: 'passed' });
  });

  it('computes readyForMerge correctly', () => {
    setReviewStatus('PAN-109', { reviewStatus: 'passed' }, statusFile);
    const result = setReviewStatus('PAN-109', { testStatus: 'passed' }, statusFile);
    expect(result.readyForMerge).toBe(true);
  });

  it('readyForMerge is false when test fails', () => {
    setReviewStatus('PAN-110', { reviewStatus: 'passed' }, statusFile);
    const result = setReviewStatus('PAN-110', { testStatus: 'failed' }, statusFile);
    expect(result.readyForMerge).toBe(false);
  });

  it('clears stale merge notes when verification starts', () => {
    setReviewStatus('PAN-111', {
      mergeStatus: 'failed',
      mergeNotes: 'Conflicts in src/example.ts',
    }, statusFile);

    const result = setReviewStatus('PAN-111', { mergeStatus: 'verifying' }, statusFile);
    expect(result.mergeNotes).toBeUndefined();
  });

  it('forces merged issues out of ready state and clears merge notes', () => {
    setReviewStatus('PAN-112', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      readyForMerge: true,
      mergeNotes: 'Old conflict notes',
    }, statusFile);

    const result = setReviewStatus('PAN-112', { mergeStatus: 'merged' }, statusFile);
    expect(result.readyForMerge).toBe(false);
    expect(result.mergeNotes).toBeUndefined();
  });

  it('preserves explicit readyForMerge=true even when verificationStatus=failed', () => {
    // verificationStatus no longer blocks readyForMerge — normalizeReviewStatus only
    // clears it for mergeStatus=merged, reviewStatus!=passed, or testStatus!=passed.
    // The post-rebase gate in triggerMerge() is the authoritative quality gate.
    const result = setReviewStatus('PAN-113', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      verificationStatus: 'failed',
      readyForMerge: true,
    }, statusFile);

    expect(result.readyForMerge).toBe(true);
  });

  it('does not block readyForMerge when verification is pending (not yet run)', () => {
    // 'pending' means "not yet run this cycle" — not a failure.
    // Only 'failed' blocks readyForMerge. This matches verificationSatisfied() in review-status.ts.
    const result = setReviewStatus('PAN-113b', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      verificationStatus: 'pending',
    }, statusFile);

    expect(result.readyForMerge).toBe(true);
  });
});

describe('getReviewStatus', () => {
  it('returns null for non-existent issue', () => {
    expect(getReviewStatus('PAN-999', statusFile)).toBeNull();
  });

  it('returns saved status', () => {
    setReviewStatus('PAN-200', { reviewStatus: 'passed' }, statusFile);
    const result = getReviewStatus('PAN-200', statusFile);
    expect(result!.reviewStatus).toBe('passed');
    expect(result!.history).toHaveLength(1);
  });
});

describe('clearReviewStatus', () => {
  it('removes a status entry', () => {
    setReviewStatus('PAN-300', { reviewStatus: 'reviewing' }, statusFile);
    expect(getReviewStatus('PAN-300', statusFile)).not.toBeNull();
    clearReviewStatus('PAN-300', statusFile);
    expect(getReviewStatus('PAN-300', statusFile)).toBeNull();
  });
});

describe('stale branch auto-pass', () => {
  it('sets reviewStatus to passed with stale branch notes', () => {
    // Simulates what the stale branch pre-check in wakeSpecialistWithTask does
    const result = setReviewStatus('PAN-STALE', {
      reviewStatus: 'passed',
      reviewNotes: 'No changes to review — branch identical to main (already merged or stale)',
    }, statusFile);

    expect(result.reviewStatus).toBe('passed');
    expect(result.reviewNotes).toContain('branch identical to main');
    expect(result.history).toHaveLength(1);
    expect(result.history![0]).toMatchObject({ type: 'review', status: 'passed' });
  });

  it('stale branch auto-pass does not set readyForMerge without test pass', () => {
    const result = setReviewStatus('PAN-STALE2', {
      reviewStatus: 'passed',
      reviewNotes: 'No changes to review — branch identical to main (already merged or stale)',
    }, statusFile);

    // readyForMerge requires BOTH review and test to be passed
    expect(result.readyForMerge).toBe(false);
    expect(result.testStatus).toBe('pending');
  });
});

describe('loadReviewStatuses', () => {
  it('returns empty object for non-existent file', () => {
    const result = loadReviewStatuses(join(testDir, 'nonexistent.json'));
    expect(result).toEqual({});
  });
});

describe('setReviewStatus — regression guard (PAN-338)', () => {
  it('rejects passed→reviewing regression when mergeStatus is not being reset', () => {
    // Set up: issue is in 'passed' state
    setReviewStatus('PAN-338', { reviewStatus: 'reviewing' }, statusFile);
    setReviewStatus('PAN-338', { reviewStatus: 'passed' }, statusFile);

    // Try to regress to 'reviewing' without changing mergeStatus
    const result = setReviewStatus('PAN-338', {
      reviewStatus: 'reviewing',
      testStatus: 'pending',
    }, statusFile);

    // Should remain at 'passed' — regression rejected
    expect(result.reviewStatus).toBe('passed');
  });

  it('allows passed→reviewing when mergeStatus is explicitly included in the update', () => {
    // Set up: issue is in 'passed' state
    setReviewStatus('PAN-338b', { reviewStatus: 'reviewing' }, statusFile);
    setReviewStatus('PAN-338b', { reviewStatus: 'passed' }, statusFile);

    // Deliberate reopen — includes mergeStatus reset
    const result = setReviewStatus('PAN-338b', {
      reviewStatus: 'reviewing',
      mergeStatus: 'pending',
    }, statusFile);

    expect(result.reviewStatus).toBe('reviewing');
  });

  it('allows normal transitions (pending→reviewing→passed) without interference', () => {
    setReviewStatus('PAN-338c', { reviewStatus: 'reviewing' }, statusFile);
    const result = setReviewStatus('PAN-338c', { reviewStatus: 'passed' }, statusFile);

    expect(result.reviewStatus).toBe('passed');
  });

  it('allows regression from states other than passed (e.g. blocked→reviewing)', () => {
    setReviewStatus('PAN-338d', { reviewStatus: 'blocked' }, statusFile);
    const result = setReviewStatus('PAN-338d', { reviewStatus: 'reviewing' }, statusFile);

    expect(result.reviewStatus).toBe('reviewing');
  });
});

// ── saveReviewStatuses / loadReviewStatuses JSON-path semantics ───────────────
// These exercise src/lib/review-status-json.ts (the JSON-file path used by CLI
// tooling and tests). DB-backed semantics live in review-status-clearstuck.test.ts.

describe('saveReviewStatuses (JSON path)', () => {
  it('persists batch mutations to the JSON file', () => {
    // Seed two entries
    setReviewStatus('PAN-100', { reviewStatus: 'reviewing' }, statusFile);
    setReviewStatus('PAN-101', { reviewStatus: 'reviewing' }, statusFile);

    // Load → mutate → save
    const statuses = loadReviewStatuses(statusFile);
    statuses['PAN-100'].reviewStatus = 'pending';
    statuses['PAN-101'].reviewStatus = 'pending';
    saveReviewStatuses(statuses, statusFile);

    const after = loadReviewStatuses(statusFile);
    expect(after['PAN-100'].reviewStatus).toBe('pending');
    expect(after['PAN-101'].reviewStatus).toBe('pending');
  });

  it('deletes entries absent from the passed map (replace-all semantics)', () => {
    setReviewStatus('PAN-200', { reviewStatus: 'passed' }, statusFile);
    setReviewStatus('PAN-201', { reviewStatus: 'passed' }, statusFile);

    const statuses = loadReviewStatuses(statusFile);
    delete (statuses as Record<string, unknown>)['PAN-201'];
    saveReviewStatuses(statuses, statusFile);

    const after = loadReviewStatuses(statusFile);
    expect(after['PAN-200']).toBeDefined();
    expect(after['PAN-201']).toBeUndefined();
  });

  it('round-trips an empty map (clears all entries)', () => {
    setReviewStatus('PAN-300', { reviewStatus: 'passed' }, statusFile);
    saveReviewStatuses({}, statusFile);
    expect(Object.keys(loadReviewStatuses(statusFile))).toHaveLength(0);
  });
});
