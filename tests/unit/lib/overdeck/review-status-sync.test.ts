import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getReviewStatusFromDbSync,
  upsertReviewStatusSync,
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
      const db = odb.raw();

      // Ensure issue exists for foreign key constraint
      db.prepare('INSERT OR IGNORE INTO issues (id, stage, updated_at) VALUES (?, ?, ?)').run('PAN-HISTORY-LIMIT', 'working', now);

      // Insert 30 history entries with notes exceeding 500 chars each
      const longNote = 'x'.repeat(600);
      for (let i = 0; i < 30; i++) {
        db.prepare(
          'INSERT INTO status_history (issue_id, type, status, timestamp, notes) VALUES (?, ?, ?, ?, ?)',
        ).run('PAN-HISTORY-LIMIT', 'review', i % 2 === 0 ? 'pending' : 'passed', now + i * 1000, longNote);
      }

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
      const db = odb.raw();

      // Ensure issue exists for foreign key constraint
      db.prepare('INSERT OR IGNORE INTO issues (id, stage, updated_at) VALUES (?, ?, ?)').run('PAN-RAW-NOTES', 'working', now);

      const longNote = 'x'.repeat(600);
      db.prepare(
        'INSERT INTO status_history (issue_id, type, status, timestamp, notes) VALUES (?, ?, ?, ?, ?)',
      ).run('PAN-RAW-NOTES', 'review', 'passed', now, longNote);

      // Fetch through canonical hydration
      const status = getReviewStatusFromDbSync('PAN-RAW-NOTES');

      // Hydrated history should have truncated notes
      expect(status?.history?.[0]?.notes?.length).toBeLessThanOrEqual(500);

      // Raw table should retain the full 600-char note
      const rawRow = db.prepare(
        'SELECT notes FROM status_history WHERE issue_id = ?',
      ).get('PAN-RAW-NOTES') as { notes: string };
      expect(rawRow.notes?.length).toBe(600);
    });

    it('applies SQL LIMIT to prevent loading all history rows before bounding', () => {
      const now = Date.now();
      const db = odb.raw();

      // Ensure issue exists for foreign key constraint
      db.prepare('INSERT OR IGNORE INTO issues (id, stage, updated_at) VALUES (?, ?, ?)').run('PAN-SQL-LIMIT', 'working', now);

      // Insert 500+ history entries
      const longNote = 'x'.repeat(100);
      for (let i = 0; i < 550; i++) {
        db.prepare(
          'INSERT INTO status_history (issue_id, type, status, timestamp, notes) VALUES (?, ?, ?, ?, ?)',
        ).run('PAN-SQL-LIMIT', 'review', 'pending', now + i * 1000, longNote);
      }

      // Fetch and verify only the last 20 are returned
      const status = getReviewStatusFromDbSync('PAN-SQL-LIMIT');
      expect(status?.history).toHaveLength(20);

      // Verify they are in chronological order (DESC DESC DESC, then reversed)
      const timestamps = status?.history?.map((h) => new Date(h.timestamp).getTime()) || [];
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeGreaterThan(timestamps[i - 1]);
      }
    });
  });
});
