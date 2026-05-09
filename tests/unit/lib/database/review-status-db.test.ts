/**
 * Tests for review-status-db.ts module functions.
 * Uses an in-memory SQLite database injected via vi.mock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from '../../../../src/lib/database/schema.js';
import type { ReviewStatus } from '../../../../src/lib/review-status.js';

// ============== In-memory DB injection ==============

let testDb: Database.Database;

vi.mock('../../../../src/lib/database/index.js', () => ({
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
  upsertReviewStatus,
  deleteReviewStatus,
  getReviewStatusFromDb,
  getAllReviewStatusesFromDb,
} from '../../../../src/lib/database/review-status-db.js';

// ============== Helpers ==============

function makeStatus(overrides: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId: 'PAN-TEST-1',
    reviewStatus: 'pending',
    testStatus: 'pending',
    updatedAt: new Date().toISOString(),
    readyForMerge: false,
    ...overrides,
  };
}

// ============== upsertReviewStatus ==============

describe('upsertReviewStatus', () => {
  it('inserts a new status record', () => {
    upsertReviewStatus(makeStatus({ issueId: 'PAN-U-1' }));
    const row = testDb.prepare('SELECT * FROM review_status WHERE issue_id = ?').get('PAN-U-1') as any;
    expect(row).toBeTruthy();
    expect(row.review_status).toBe('pending');
    expect(row.ready_for_merge).toBe(0);
  });

  it('updates an existing record on conflict', () => {
    upsertReviewStatus(makeStatus({ issueId: 'PAN-U-2', reviewStatus: 'pending' }));
    upsertReviewStatus(makeStatus({ issueId: 'PAN-U-2', reviewStatus: 'passed', readyForMerge: true }));

    const row = testDb.prepare('SELECT * FROM review_status WHERE issue_id = ?').get('PAN-U-2') as any;
    expect(row.review_status).toBe('passed');
    expect(row.ready_for_merge).toBe(1);
  });

  it('stores history entries', () => {
    const ts = new Date().toISOString();
    upsertReviewStatus(makeStatus({
      issueId: 'PAN-U-3',
      history: [
        { type: 'review', status: 'reviewing', timestamp: ts },
      ],
    }));

    const rows = testDb.prepare('SELECT * FROM status_history WHERE issue_id = ?').all('PAN-U-3') as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('reviewing');
  });

  it('deduplicates history entries via INSERT OR IGNORE', () => {
    const ts = new Date().toISOString();
    const entry = { type: 'review' as const, status: 'passed', timestamp: ts };

    // Insert same history entry twice
    upsertReviewStatus(makeStatus({ issueId: 'PAN-U-4', history: [entry] }));
    upsertReviewStatus(makeStatus({ issueId: 'PAN-U-4', history: [entry] }));

    const rows = testDb.prepare('SELECT * FROM status_history WHERE issue_id = ?').all('PAN-U-4') as any[];
    expect(rows).toHaveLength(1);
  });

  it('stores optional fields (mergeStatus, prUrl, verificationNotes)', () => {
    upsertReviewStatus(makeStatus({
      issueId: 'PAN-U-5',
      mergeStatus: 'merged',
      prUrl: 'https://github.com/example/pr/1',
      verificationNotes: 'All good',
    }));

    const row = testDb.prepare('SELECT * FROM review_status WHERE issue_id = ?').get('PAN-U-5') as any;
    expect(row.merge_status).toBe('merged');
    expect(row.pr_url).toBe('https://github.com/example/pr/1');
    expect(row.verification_notes).toBe('All good');
  });
});

// ============== deleteReviewStatus ==============

describe('deleteReviewStatus', () => {
  it('removes the review status row', () => {
    upsertReviewStatus(makeStatus({ issueId: 'PAN-D-1' }));
    deleteReviewStatus('PAN-D-1');
    const row = testDb.prepare('SELECT * FROM review_status WHERE issue_id = ?').get('PAN-D-1');
    expect(row).toBeUndefined();
  });

  it('cascades delete to status_history', () => {
    const ts = new Date().toISOString();
    upsertReviewStatus(makeStatus({
      issueId: 'PAN-D-2',
      history: [{ type: 'review', status: 'pending', timestamp: ts }],
    }));
    deleteReviewStatus('PAN-D-2');
    const history = testDb.prepare('SELECT * FROM status_history WHERE issue_id = ?').all('PAN-D-2');
    expect(history).toHaveLength(0);
  });

  it('does not throw when issue does not exist', () => {
    expect(() => deleteReviewStatus('PAN-NOEXIST')).not.toThrow();
  });
});

// ============== getReviewStatusFromDb ==============

describe('getReviewStatusFromDb', () => {
  it('returns null for unknown issue', () => {
    expect(getReviewStatusFromDb('PAN-UNKNOWN')).toBeNull();
  });

  it('returns a fully mapped ReviewStatus', () => {
    const ts = new Date().toISOString();
    upsertReviewStatus(makeStatus({
      issueId: 'PAN-G-1',
      reviewStatus: 'passed',
      testStatus: 'passed',
      readyForMerge: true,
      updatedAt: ts,
    }));

    const result = getReviewStatusFromDb('PAN-G-1');
    expect(result).not.toBeNull();
    expect(result!.issueId).toBe('PAN-G-1');
    expect(result!.reviewStatus).toBe('passed');
    expect(result!.readyForMerge).toBe(true);
    expect(result!.updatedAt).toBe(ts);
  });

  it('includes history when present', () => {
    const ts = new Date().toISOString();
    upsertReviewStatus(makeStatus({
      issueId: 'PAN-G-2',
      history: [{ type: 'review', status: 'reviewing', timestamp: ts }],
    }));

    const result = getReviewStatusFromDb('PAN-G-2');
    expect(result!.history).toHaveLength(1);
    expect(result!.history![0].status).toBe('reviewing');
  });

  it('returns undefined history when no history exists', () => {
    upsertReviewStatus(makeStatus({ issueId: 'PAN-G-3' }));
    const result = getReviewStatusFromDb('PAN-G-3');
    expect(result!.history).toBeUndefined();
  });

  it('normalizes stale merge notes away for merged records', () => {
    upsertReviewStatus(makeStatus({
      issueId: 'PAN-G-4',
      mergeStatus: 'merged',
      mergeNotes: 'Conflicts in src/example.ts',
      readyForMerge: true,
    }));

    const result = getReviewStatusFromDb('PAN-G-4');
    expect(result!.mergeNotes).toBeUndefined();
    expect(result!.readyForMerge).toBe(false);
  });

  it('preserves readyForMerge=true when verificationStatus=failed (no longer normalized)', () => {
    // verificationStatus no longer clears readyForMerge in normalizeReviewStatus.
    // Only mergeStatus=merged, reviewStatus!=passed, or testStatus!=passed do so.
    upsertReviewStatus(makeStatus({
      issueId: 'PAN-G-5',
      reviewStatus: 'passed',
      testStatus: 'passed',
      verificationStatus: 'failed',
      readyForMerge: true,
    }));

    const result = getReviewStatusFromDb('PAN-G-5');
    expect(result!.readyForMerge).toBe(true);
  });
});

// ============== reviewedAtCommit / stuckAt / stuckDetails round-trip ==============

describe('DB round-trip for fields used by deacon and the dashboard', () => {
  it('persists reviewedAtCommit through upsert→get', () => {
    const sha = 'abc1234def5678901234567890123456789012ab';
    upsertReviewStatus(makeStatus({
      issueId: 'PAN-RAC-1',
      reviewStatus: 'passed',
      reviewedAtCommit: sha,
    }));

    const result = getReviewStatusFromDb('PAN-RAC-1');
    expect(result).not.toBeNull();
    expect(result!.reviewedAtCommit).toBe(sha);
  });

  it('overwrites reviewedAtCommit on update', () => {
    const sha1 = 'aaaa1111000000000000000000000000000000aa';
    const sha2 = 'bbbb2222000000000000000000000000000000bb';
    upsertReviewStatus(makeStatus({ issueId: 'PAN-RAC-2', reviewedAtCommit: sha1 }));
    upsertReviewStatus(makeStatus({ issueId: 'PAN-RAC-2', reviewedAtCommit: sha2 }));

    const result = getReviewStatusFromDb('PAN-RAC-2');
    expect(result!.reviewedAtCommit).toBe(sha2);
  });

  it('returns undefined reviewedAtCommit when not set', () => {
    upsertReviewStatus(makeStatus({ issueId: 'PAN-RAC-3' }));
    const result = getReviewStatusFromDb('PAN-RAC-3');
    expect(result!.reviewedAtCommit).toBeUndefined();
  });

  it('clears reviewedAtCommit when explicitly set to undefined', () => {
    const sha = 'cccc3333000000000000000000000000000000cc';
    upsertReviewStatus(makeStatus({ issueId: 'PAN-RAC-4', reviewedAtCommit: sha }));
    upsertReviewStatus(makeStatus({ issueId: 'PAN-RAC-4', reviewedAtCommit: undefined }));

    const result = getReviewStatusFromDb('PAN-RAC-4');
    expect(result!.reviewedAtCommit).toBeUndefined();
  });

  it('persists stuckAt through upsert→get', () => {
    const ts = '2026-04-19T05:00:00.000Z';
    upsertReviewStatus(makeStatus({
      issueId: 'PAN-SA-1',
      stuck: true,
      stuckReason: 'main_diverged',
      stuckAt: ts,
    }));

    const result = getReviewStatusFromDb('PAN-SA-1');
    expect(result!.stuckAt).toBe(ts);
  });

  it('persists stuckDetails through upsert→get', () => {
    upsertReviewStatus(makeStatus({
      issueId: 'PAN-SD-1',
      stuck: true,
      stuckReason: 'main_diverged',
      stuckDetails: JSON.stringify({ localSha: 'abc123', remoteSha: 'def456' }),
    }));

    const result = getReviewStatusFromDb('PAN-SD-1');
    expect(result!.stuckDetails).toContain('abc123');
    expect(result!.stuckDetails).toContain('def456');
  });

  it('preserves all three fields together through a restart (getAllReviewStatusesFromDb)', () => {
    const sha = 'dddd4444000000000000000000000000000000dd';
    const stuckTs = '2026-04-19T06:00:00.000Z';
    upsertReviewStatus(makeStatus({
      issueId: 'PAN-ALL-1',
      reviewStatus: 'passed',
      reviewedAtCommit: sha,
      stuck: true,
      stuckReason: 'main_diverged',
      stuckAt: stuckTs,
      stuckDetails: JSON.stringify({ localSha: 'aaa', remoteSha: 'bbb' }),
    }));

    // getAllReviewStatusesFromDb simulates a dashboard restart loading all statuses
    const all = getAllReviewStatusesFromDb();
    const status = all['PAN-ALL-1'];
    expect(status).toBeDefined();
    expect(status.reviewedAtCommit).toBe(sha);
    expect(status.stuckAt).toBe(stuckTs);
    expect(status.stuckDetails).toContain('aaa');
  });
});

// ============== getAllReviewStatusesFromDb ==============

describe('getAllReviewStatusesFromDb', () => {
  it('returns empty object when no statuses', () => {
    expect(getAllReviewStatusesFromDb()).toEqual({});
  });

  it('returns all statuses keyed by issueId', () => {
    upsertReviewStatus(makeStatus({ issueId: 'PAN-A-1', reviewStatus: 'pending' }));
    upsertReviewStatus(makeStatus({ issueId: 'PAN-A-2', reviewStatus: 'passed' }));

    const all = getAllReviewStatusesFromDb();
    expect(Object.keys(all)).toContain('PAN-A-1');
    expect(Object.keys(all)).toContain('PAN-A-2');
    expect(all['PAN-A-1'].reviewStatus).toBe('pending');
    expect(all['PAN-A-2'].reviewStatus).toBe('passed');
  });

  it('includes history in each status', () => {
    const ts = new Date().toISOString();
    upsertReviewStatus(makeStatus({
      issueId: 'PAN-A-3',
      history: [{ type: 'test', status: 'passed', timestamp: ts }],
    }));

    const all = getAllReviewStatusesFromDb();
    expect(all['PAN-A-3'].history).toHaveLength(1);
  });
});

// ============== PAN-905: blockerReasons round-trip ==============

describe('blockerReasons', () => {
  it('persists blockerReasons through upsert→get', () => {
    const blockers = [
      { type: 'failing_checks' as const, summary: '2/5 checks failed', detectedAt: '2026-04-28T10:00:00Z' },
      { type: 'merge_conflict' as const, summary: 'Merge conflict with main', detectedAt: '2026-04-28T10:01:00Z' },
    ];
    upsertReviewStatus(makeStatus({
      issueId: 'PAN-BR-1',
      blockerReasons: blockers,
    }));

    const result = getReviewStatusFromDb('PAN-BR-1');
    expect(result).not.toBeNull();
    expect(result!.blockerReasons).toHaveLength(2);
    expect(result!.blockerReasons![0].type).toBe('failing_checks');
    expect(result!.blockerReasons![1].type).toBe('merge_conflict');
  });

  it('returns undefined blockerReasons when not set', () => {
    upsertReviewStatus(makeStatus({ issueId: 'PAN-BR-2' }));
    const result = getReviewStatusFromDb('PAN-BR-2');
    expect(result!.blockerReasons).toBeUndefined();
  });

  it('clears blockerReasons when explicitly set to undefined', () => {
    upsertReviewStatus(makeStatus({
      issueId: 'PAN-BR-3',
      blockerReasons: [{ type: 'draft_pr' as const, summary: 'PR is draft', detectedAt: '2026-04-28T10:00:00Z' }],
    }));
    upsertReviewStatus(makeStatus({ issueId: 'PAN-BR-3', blockerReasons: undefined }));

    const result = getReviewStatusFromDb('PAN-BR-3');
    expect(result!.blockerReasons).toBeUndefined();
  });

  it('normalizes readyForMerge to false when blockerReasons is non-empty', () => {
    upsertReviewStatus(makeStatus({
      issueId: 'PAN-BR-4',
      reviewStatus: 'passed',
      testStatus: 'passed',
      readyForMerge: true,
      blockerReasons: [{ type: 'failing_checks' as const, summary: 'CI failed', detectedAt: '2026-04-28T10:00:00Z' }],
    }));

    const result = getReviewStatusFromDb('PAN-BR-4');
    expect(result!.readyForMerge).toBe(false);
  });
});
