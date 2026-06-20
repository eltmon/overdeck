import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReviewStatus } from '../review-status.js';

// Mock the DB cache layer and the journal layer so we can drive getReviewStatusSync /
// setReviewStatusSync deterministically without touching SQLite or the filesystem.
const db = vi.hoisted(() => ({
  upsert: vi.fn(),
  getFromDb: vi.fn(),
}));
const journal = vi.hoisted(() => ({
  readJournalStatusSync: vi.fn(),
  enrichReviewNotesFromRecordSync: vi.fn((_id: string, s: ReviewStatus) => s),
  updateIssueRecordForReviewStatusSync: vi.fn(),
}));

vi.mock('../overdeck/review-status-sync.js', () => ({
  upsertReviewStatusSync: db.upsert,
  getReviewStatusFromDbSync: db.getFromDb,
  deleteReviewStatus: vi.fn(),
  getAllReviewStatusesFromDb: vi.fn(() => ({})),
  getReviewStatusesFromDb: vi.fn(() => ({})),
  markWorkspaceStuck: vi.fn(),
  clearWorkspaceStuck: vi.fn(),
  setDeaconIgnored: vi.fn(),
  setAutoMerge: vi.fn(),
}));
vi.mock('../overdeck/review-status-record-sync.js', () => ({
  readJournalStatusSync: journal.readJournalStatusSync,
  enrichReviewNotesFromRecordSync: journal.enrichReviewNotesFromRecordSync,
  updateIssueRecordForReviewStatusSync: journal.updateIssueRecordForReviewStatusSync,
}));
vi.mock('../pipeline-notifier.js', () => ({ notifyPipelineSync: vi.fn() }));
vi.mock('../activity-logger.js', () => ({ emitActivityEntrySync: vi.fn(), emitActivityTtsSync: vi.fn() }));

import { getReviewStatusSync, setReviewStatusSync } from '../review-status.js';

const dbRow = (over: Partial<ReviewStatus> = {}): ReviewStatus => ({
  issueId: 'PAN-1866',
  reviewStatus: 'reviewing',
  testStatus: 'pending',
  updatedAt: '2026-06-20T07:00:00.000Z',
  readyForMerge: false,
  ...over,
});

describe('getReviewStatusSync — journal→DB reconcile (PAN-1988)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    journal.enrichReviewNotesFromRecordSync.mockImplementation((_id: string, s: ReviewStatus) => s);
  });

  it('reconciles the DB cache from the journal when the journal is newer (host-owned write)', () => {
    // DB row lags: still 'reviewing' with no verdict. Journal has the fresh 'blocked' verdict —
    // exactly the state after a sandboxed agent wrote the journal but could not write the DB.
    db.getFromDb.mockReturnValue(dbRow({ reviewStatus: 'reviewing', updatedAt: '2026-06-20T07:00:00.000Z' }));
    journal.readJournalStatusSync.mockReturnValue({
      updatedAt: '2026-06-20T07:22:21.788Z',
      durable: { reviewStatus: 'blocked', testStatus: 'pending', reviewNotes: 'Regenerate empties the backlog' },
    });

    const result = getReviewStatusSync('PAN-1866');

    expect(result?.reviewStatus).toBe('blocked');
    expect(result?.reviewNotes).toBe('Regenerate empties the backlog');
    expect(result?.updatedAt).toBe('2026-06-20T07:22:21.788Z');
    // The cache was reconciled (host write) so bulk/merge-gate readers catch up.
    expect(db.upsert).toHaveBeenCalledTimes(1);
  });

  it('does not reconcile when the DB is current — overlays feedback from the journal', () => {
    db.getFromDb.mockReturnValue(dbRow({ reviewStatus: 'blocked', updatedAt: '2026-06-20T07:22:21.788Z' }));
    journal.readJournalStatusSync.mockReturnValue({
      updatedAt: '2026-06-20T07:22:21.788Z', // equal → not newer
      durable: { reviewStatus: 'blocked', reviewNotes: 'note' },
    });
    journal.enrichReviewNotesFromRecordSync.mockImplementation((_id: string, s: ReviewStatus) => ({ ...s, reviewNotes: 'note' }));

    const result = getReviewStatusSync('PAN-1866');

    expect(result?.reviewNotes).toBe('note');
    expect(db.upsert).not.toHaveBeenCalled(); // no reconcile write
  });

  it('tolerates a read-only DB during reconcile (sandboxed reader) without throwing', () => {
    db.getFromDb.mockReturnValue(dbRow({ updatedAt: '2026-06-20T07:00:00.000Z' }));
    journal.readJournalStatusSync.mockReturnValue({
      updatedAt: '2026-06-20T07:22:21.788Z',
      durable: { reviewStatus: 'blocked', testStatus: 'pending' },
    });
    db.upsert.mockImplementation(() => { throw new Error('SQLITE_READONLY: attempt to write a readonly database'); });

    expect(() => getReviewStatusSync('PAN-1866')).not.toThrow();
    expect(getReviewStatusSync('PAN-1866')?.reviewStatus).toBe('blocked');
  });
});

describe('setReviewStatusSync — host-owned write + journal-preserving merge (PAN-1988)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    journal.enrichReviewNotesFromRecordSync.mockImplementation((_id: string, s: ReviewStatus) => s);
    // Merge base reads through getReviewStatusSync → DB + journal. Default: empty/clean.
    db.getFromDb.mockReturnValue(null);
    journal.readJournalStatusSync.mockReturnValue(null);
  });

  it('records the verdict to the journal even when the DB write is read-only (no escalation)', () => {
    db.upsert.mockImplementation(() => { throw new Error('SQLITE_READONLY: attempt to write a readonly database'); });

    const result = setReviewStatusSync('PAN-1866', { reviewStatus: 'blocked', reviewNotes: 'blocking reason' });

    // The call SUCCEEDS despite the read-only DB — the journal is the source of truth.
    expect(result.reviewStatus).toBe('blocked');
    expect(journal.updateIssueRecordForReviewStatusSync).toHaveBeenCalledTimes(1);
    const journaled = journal.updateIssueRecordForReviewStatusSync.mock.calls[0][1] as ReviewStatus;
    expect(journaled.reviewStatus).toBe('blocked');
    expect(journaled.reviewNotes).toBe('blocking reason');
  });

  it('preserves journal feedback through a partial update (the merge-base trap)', () => {
    // DB row carries NO notes (PAN-1988: the cache no longer stores them); the journal holds
    // the review feedback. A later testStatus update carries no review notes.
    db.getFromDb.mockReturnValue(dbRow({ reviewStatus: 'blocked', reviewNotes: undefined, updatedAt: '2026-06-20T07:22:21.788Z' }));
    journal.readJournalStatusSync.mockReturnValue({
      updatedAt: '2026-06-20T07:22:21.788Z',
      durable: { reviewStatus: 'blocked', reviewNotes: 'must-not-be-erased' },
    });
    journal.enrichReviewNotesFromRecordSync.mockImplementation((_id: string, s: ReviewStatus) => ({ ...s, reviewNotes: 'must-not-be-erased' }));

    setReviewStatusSync('PAN-1866', { testStatus: 'passed' });

    const journaled = journal.updateIssueRecordForReviewStatusSync.mock.calls.at(-1)![1] as ReviewStatus;
    expect(journaled.reviewNotes).toBe('must-not-be-erased'); // NOT nulled by the partial update
    expect(journaled.testStatus).toBe('passed');
  });
});
