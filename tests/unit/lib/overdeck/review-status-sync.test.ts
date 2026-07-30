import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setReviewStatusSync } from '../../../../src/lib/review-status.js';
import {
  getReviewStatusFromDbSync,
  upsertReviewStatusSync,
  getAllReviewStatusesFromDb,
  getReviewStatusesFromDb,
} from '../../../../src/lib/overdeck/review-status-sync.js';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../helpers/overdeck-test-db.js';

describe('overdeck review status sync', () => {
  let odb: OverdeckTestDb;

  beforeEach(() => {
    odb = setupOverdeckTestDb();
  });

  afterEach(() => {
    teardownOverdeckTestDb(odb);
  });

  it('round-trips strike transport backoff state for patrol reloads', () => {
    upsertReviewStatusSync({
      issueId: 'PAN-TRANSPORT-RETRY',
      reviewStatus: 'pending',
      testStatus: 'pending',
      strikeLandingState: 'ready',
      strikeTransportRetryCount: 4,
      strikeNextAttemptAt: '2026-07-22T00:15:00.000Z',
      updatedAt: new Date().toISOString(),
      readyForMerge: false,
    });

    const raw = odb.raw().prepare(
      'SELECT strike_transport_retry_count, strike_next_attempt_at FROM review_status WHERE issue_id = ?',
    ).get('PAN-TRANSPORT-RETRY') as {
      strike_transport_retry_count: number;
      strike_next_attempt_at: number;
    };
    expect(raw.strike_transport_retry_count).toBe(4);
    expect(raw.strike_next_attempt_at).toBe(Date.parse('2026-07-22T00:15:00.000Z'));
    expect(getReviewStatusFromDbSync('PAN-TRANSPORT-RETRY')).toEqual(expect.objectContaining({
      strikeTransportRetryCount: 4,
      strikeNextAttemptAt: '2026-07-22T00:15:00.000Z',
    }));
  });

  it('round-trips the active inspection owner session', () => {
    upsertReviewStatusSync({
      issueId: 'PAN-INSPECT-OWNER',
      reviewStatus: 'pending',
      testStatus: 'pending',
      inspectStatus: 'inspecting',
      inspectBeadId: 'workspace-owner',
      inspectOwnerSession: 'agent-pan-inspect-owner-review-supervisor',
      updatedAt: new Date().toISOString(),
    });

    const raw = odb.raw().prepare(
      'SELECT inspect_owner_session FROM review_status WHERE issue_id = ?',
    ).get('PAN-INSPECT-OWNER') as { inspect_owner_session: string };
    expect(raw.inspect_owner_session).toBe('agent-pan-inspect-owner-review-supervisor');
    expect(getReviewStatusFromDbSync('PAN-INSPECT-OWNER')).toEqual(expect.objectContaining({
      inspectBeadId: 'workspace-owner',
      inspectOwnerSession: 'agent-pan-inspect-owner-review-supervisor',
    }));
  });

  it('round-trips conflictsSince', () => {
    upsertReviewStatusSync({
      issueId: 'PAN-CONFLICTS-SINCE',
      reviewStatus: 'pending',
      testStatus: 'pending',
      conflictsSince: {
        sha: '6ac4a3dc11',
        detectedAt: '2026-07-26T18:58:00.000Z',
        paths: ['scripts/file-size-baseline.txt'],
      },
      updatedAt: new Date().toISOString(),
      readyForMerge: false,
    });

    const raw = odb.raw().prepare(
      'SELECT conflicts_since FROM review_status WHERE issue_id = ?',
    ).get('PAN-CONFLICTS-SINCE') as { conflicts_since: string };
    expect(JSON.parse(raw.conflicts_since)).toEqual({
      sha: '6ac4a3dc11',
      detectedAt: '2026-07-26T18:58:00.000Z',
      paths: ['scripts/file-size-baseline.txt'],
    });
    expect(getReviewStatusFromDbSync('PAN-CONFLICTS-SINCE')).toEqual(expect.objectContaining({
      conflictsSince: {
        sha: '6ac4a3dc11',
        detectedAt: '2026-07-26T18:58:00.000Z',
        paths: ['scripts/file-size-baseline.txt'],
      },
    }));
  });

  it('leaves conflictsSince undefined when never set', () => {
    upsertReviewStatusSync({
      issueId: 'PAN-NO-CONFLICTS',
      reviewStatus: 'pending',
      testStatus: 'pending',
      updatedAt: new Date().toISOString(),
      readyForMerge: false,
    });

    expect(getReviewStatusFromDbSync('PAN-NO-CONFLICTS')?.conflictsSince).toBeUndefined();
  });

  it('clears conflictsSince back to undefined on a subsequent write', () => {
    upsertReviewStatusSync({
      issueId: 'PAN-CLEAR-CONFLICTS',
      reviewStatus: 'pending',
      testStatus: 'pending',
      conflictsSince: {
        sha: '6ac4a3dc11',
        detectedAt: '2026-07-26T18:58:00.000Z',
        paths: ['a.txt'],
      },
      updatedAt: new Date().toISOString(),
      readyForMerge: false,
    });
    upsertReviewStatusSync({
      issueId: 'PAN-CLEAR-CONFLICTS',
      reviewStatus: 'pending',
      testStatus: 'pending',
      updatedAt: new Date().toISOString(),
      readyForMerge: false,
    });

    expect(getReviewStatusFromDbSync('PAN-CLEAR-CONFLICTS')?.conflictsSince).toBeUndefined();
  });

  describe('bounded history with large note limits (PAN-3253)', () => {
    it('returns only the newest 20 history entries and truncates notes at canonical hydration', () => {
      const now = Date.now();

      // Create a review status with 30 history entries using upsertReviewStatusSync
      const longNote = 'x'.repeat(600);
      const historyEntries = Array.from({ length: 30 }, (_, i) => ({
        type: 'review' as const,
        status: i % 2 === 0 ? 'pending' : 'passed',
        timestamp: new Date(now + i * 1000).toISOString(),
        notes: longNote,
      }));

      upsertReviewStatusSync({
        issueId: 'PAN-HISTORY-LIMIT',
        reviewStatus: 'passed',
        testStatus: 'pending',
        history: historyEntries,
        updatedAt: new Date().toISOString(),
        readyForMerge: false,
      });

      // Fetch through the canonical hydration path
      const status = getReviewStatusFromDbSync('PAN-HISTORY-LIMIT');

      // Should return only the last 20 entries
      expect(status?.history).toHaveLength(20);

      // All notes should be truncated to ≤ 500 chars
      for (const entry of status?.history || []) {
        if (entry.notes) {
          expect(entry.notes.length).toBeLessThanOrEqual(500);
        }
      }
    });

    it('preserves raw (untrun) notes in status_history table while bounding hydrated history', () => {
      const now = Date.now();

      const longNote = 'x'.repeat(600);
      upsertReviewStatusSync({
        issueId: 'PAN-RAW-NOTES',
        reviewStatus: 'passed',
        testStatus: 'pending',
        history: [
          {
            type: 'review',
            status: 'passed',
            timestamp: new Date(now).toISOString(),
            notes: longNote,
          },
        ],
        updatedAt: new Date().toISOString(),
        readyForMerge: false,
      });

      // Fetch through canonical hydration
      const status = getReviewStatusFromDbSync('PAN-RAW-NOTES');

      // Hydrated history should have truncated notes
      if (status?.history && status.history.length > 0) {
        expect(status.history[0]!.notes?.length ?? 0).toBeLessThanOrEqual(500);
      }

      // Raw table should retain the full 600-char note
      const db = odb.raw();
      const rawRow = db.prepare(
        'SELECT notes FROM status_history WHERE issue_id = ?',
      ).get('PAN-RAW-NOTES') as { notes: string | null };
      expect(rawRow.notes?.length).toBe(600);
    });

    it('applies SQL LIMIT to prevent loading all history rows before bounding', () => {
      const now = Date.now();

      // Create history with 550 entries to verify SQL LIMIT works
      const longNote = 'x'.repeat(100);
      const historyEntries = Array.from({ length: 550 }, (_, i) => ({
        type: 'review' as const,
        status: 'pending' as const,
        timestamp: new Date(now + i * 1000).toISOString(),
        notes: longNote,
      }));

      upsertReviewStatusSync({
        issueId: 'PAN-SQL-LIMIT',
        reviewStatus: 'pending',
        testStatus: 'pending',
        history: historyEntries,
        updatedAt: new Date().toISOString(),
        readyForMerge: false,
      });

      // Fetch and verify only the last 20 are returned
      const status = getReviewStatusFromDbSync('PAN-SQL-LIMIT');
      expect(status?.history).toHaveLength(20);

      // Verify they are in chronological order
      const timestamps = status?.history?.map((h) => new Date(h.timestamp).getTime()) || [];
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]!).toBeGreaterThan(timestamps[i - 1]!);
      }
    });
  });

  it('verifies dbStatus/updated split and testNotes preservation (PAN-3253 notes-cap.ac2-ac3)', () => {
    // This test exercises the real setReviewStatusSync() composition path
    // and verifies the split between dbStatus (raw, full notes) and updated (bounded, truncated notes)
    // It also verifies notes-cap.ac2: status.testNotes stays complete at 10,000 chars
    // while the appended history note is capped at ≤500

    const now = Date.now();
    const db = odb.raw();

    // Create an issue for FK constraint
    db.prepare('INSERT OR IGNORE INTO issues (id, stage, updated_at) VALUES (?, ?, ?)').run(
      'PAN-COMPOSITION-TEST',
      'working',
      now
    );

    const longTestNote = 'x'.repeat(10000); // Far exceeds 500-char limit

    // Call setReviewStatusSync() with a long testNotes to exercise the composition path
    // This triggers the dbStatus/updated split in review-status.ts
    // Signature: setReviewStatusSync(issueId: string, update: ReviewStatusUpdate, existing?: ReviewStatus)
    // Change testStatus from 'pending' to 'passed' to create the test transition that carries testNotes
    const updated = setReviewStatusSync(
      'PAN-COMPOSITION-TEST',
      {
        reviewStatus: 'pending', // Keep at pending to only create test transition
        testStatus: 'passed', // Change from pending to passed to create the transition
        testNotes: longTestNote, // 10,000 chars - should NOT be truncated in returned status
        updatedAt: new Date().toISOString(),
        readyForMerge: false,
      }
    );

    // AC2: Verify returned status.testNotes is complete (≤ 500 rule only applies to history notes, not testNotes)
    expect(updated.testNotes).toBe(longTestNote);
    expect(updated.testNotes.length).toBe(10000);

    // AC3: Verify returned history notes are truncated
    const hydrated = getReviewStatusFromDbSync('PAN-COMPOSITION-TEST');
    expect(hydrated).not.toBeNull();
    expect(hydrated?.history).toBeDefined();
    expect(hydrated?.history).toHaveLength(1); // Must have exactly one history entry
    const historyNote = hydrated!.history![0]!.notes;
    expect(historyNote).toBeDefined(); // Note must exist
    expect(historyNote!.length).toBeLessThanOrEqual(500);
    expect(historyNote!.endsWith('…')).toBe(true); // Should have ellipsis indicator

    // AC3: Verify raw status_history table has the full untrimmed note
    const rawRows = db.prepare(
      'SELECT notes FROM status_history WHERE issue_id = ?'
    ).all('PAN-COMPOSITION-TEST') as Array<{ notes: string | null }>;

    // Must have exactly one row in status_history
    expect(rawRows).toHaveLength(1);
    expect(rawRows[0]?.notes).toBeDefined(); // Note must exist
    // The testNotes field in the raw row should have the complete 10,000-char note
    expect(rawRows[0]!.notes!.length).toBe(10000);
    expect(rawRows[0]!.notes!).toBe(longTestNote);
  });

  describe('bulk hydration bounds (PAN-3253 notes-cap.ac2)', () => {
    it('getAllReviewStatusesFromDb applies history and note bounds', () => {
      const now = Date.now();

      // Create 3 issues with 30 history entries each (exceeds 20-entry limit per issue)
      const longNote = 'x'.repeat(600);
      const createIssueWithHistory = (issueId: string) => {
        const historyEntries = Array.from({ length: 30 }, (_, i) => ({
          type: 'review' as const,
          status: i % 2 === 0 ? 'pending' : 'passed',
          timestamp: new Date(now + i * 1000).toISOString(),
          notes: longNote,
        }));
        upsertReviewStatusSync({
          issueId,
          reviewStatus: 'passed',
          testStatus: 'pending',
          history: historyEntries,
          updatedAt: new Date().toISOString(),
          readyForMerge: false,
        });
      };

      createIssueWithHistory('PAN-BULK-TEST-1');
      createIssueWithHistory('PAN-BULK-TEST-2');
      createIssueWithHistory('PAN-BULK-TEST-3');

      const allStatuses = getAllReviewStatusesFromDb();

      // Each issue should have exactly 20 history entries
      expect(allStatuses['PAN-BULK-TEST-1']?.history).toHaveLength(20);
      expect(allStatuses['PAN-BULK-TEST-2']?.history).toHaveLength(20);
      expect(allStatuses['PAN-BULK-TEST-3']?.history).toHaveLength(20);

      // All notes should be truncated to ≤ 500 chars
      for (const status of [
        allStatuses['PAN-BULK-TEST-1'],
        allStatuses['PAN-BULK-TEST-2'],
        allStatuses['PAN-BULK-TEST-3'],
      ]) {
        for (const entry of status?.history || []) {
          if (entry.notes) {
            expect(entry.notes.length).toBeLessThanOrEqual(500);
          }
        }
      }
    });

    it('getReviewStatusesFromDb applies history and note bounds per issue', () => {
      const now = Date.now();

      // Create 2 issues with 30 history entries each
      const longNote = 'y'.repeat(600);
      const createIssueWithHistory = (issueId: string) => {
        const historyEntries = Array.from({ length: 30 }, (_, i) => ({
          type: 'review' as const,
          status: 'pending',
          timestamp: new Date(now + i * 1000).toISOString(),
          notes: longNote,
        }));
        upsertReviewStatusSync({
          issueId,
          reviewStatus: 'pending',
          testStatus: 'pending',
          history: historyEntries,
          updatedAt: new Date().toISOString(),
          readyForMerge: false,
        });
      };

      createIssueWithHistory('PAN-SELECTIVE-1');
      createIssueWithHistory('PAN-SELECTIVE-2');
      // Also create one more that won't be queried
      createIssueWithHistory('PAN-SELECTIVE-3');

      // Query only 2 of the 3 issues
      const selectedStatuses = getReviewStatusesFromDb([
        'PAN-SELECTIVE-1',
        'PAN-SELECTIVE-2',
      ]);

      // Should have exactly 2 issues returned
      expect(Object.keys(selectedStatuses)).toHaveLength(2);

      // Each should have exactly 20 history entries
      expect(selectedStatuses['PAN-SELECTIVE-1']?.history).toHaveLength(20);
      expect(selectedStatuses['PAN-SELECTIVE-2']?.history).toHaveLength(20);

      // Notes should all be truncated
      for (const status of Object.values(selectedStatuses)) {
        for (const entry of status?.history || []) {
          if (entry.notes) {
            expect(entry.notes.length).toBeLessThanOrEqual(500);
          }
        }
      }

      // The unqueried issue should not be in the result
      expect(selectedStatuses['PAN-SELECTIVE-3']).toBeUndefined();
    });
  });
});
