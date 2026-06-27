import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';
import type { ReviewStatus } from '../review-status.js';

const feedback = vi.hoisted(() => ({ deliver: vi.fn(() => Effect.succeed({ agentMessageSent: true, prCommentPosted: false })) }));
vi.mock('../cloister/review-verdict-feedback.js', () => ({ deliverReviewVerdictFeedback: feedback.deliver }));

// Mock the DB cache layer and the journal layer so we can drive getReviewStatusSync /
// setReviewStatusSync deterministically without touching SQLite or the filesystem.
const db = vi.hoisted(() => ({
  upsert: vi.fn(),
  delete: vi.fn(),
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
  deleteReviewStatus: db.delete,
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
const notifier = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock('../pipeline-notifier.js', () => ({ notifyPipelineSync: notifier.notify }));
vi.mock('../activity-logger.js', () => ({ emitActivityEntrySync: vi.fn(), emitActivityTtsSync: vi.fn() }));

import { getReviewStatusSync, resetPipelineVerdictsForWorkStartSync, setReviewStatusSync } from '../review-status.js';

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

  it('returns null for a closed-out journal with stale active durable status', () => {
    db.getFromDb.mockReturnValue(dbRow({
      reviewStatus: 'passed',
      testStatus: 'passed',
      verificationStatus: 'running',
      mergeStatus: 'pending',
      updatedAt: '2026-06-20T07:00:00.000Z',
    }));
    journal.readJournalStatusSync.mockReturnValue({
      updatedAt: '2026-06-20T07:22:21.788Z',
      durable: {
        reviewStatus: 'passed',
        testStatus: 'passed',
        verificationStatus: 'running',
        mergeStatus: 'pending',
        closedOut: true,
        closedOutAt: '2026-06-20T07:22:21.788Z',
      },
    });

    const result = getReviewStatusSync('PAN-1866');

    expect(result).toBeNull();
    expect(db.delete).toHaveBeenCalledWith('PAN-1866');
    expect(db.upsert).not.toHaveBeenCalled();
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

  it('delivers feedback to the work agent host-side when reconciling a NEW blocked verdict', async () => {
    // DB was 'reviewing' (review in progress); journal now carries the fresh 'blocked' verdict.
    db.getFromDb.mockReturnValue(dbRow({ reviewStatus: 'reviewing', updatedAt: '2026-06-20T07:00:00.000Z' }));
    journal.readJournalStatusSync.mockReturnValue({
      updatedAt: '2026-06-20T07:22:21.788Z',
      durable: { reviewStatus: 'blocked', testStatus: 'pending', reviewNotes: 'empty-backlog spawn' },
    });

    getReviewStatusSync('PAN-1866');
    await new Promise((r) => setTimeout(r, 0)); // let the fire-and-forget delivery run

    expect(feedback.deliver).toHaveBeenCalledTimes(1);
    expect(feedback.deliver.mock.calls[0][0]).toMatchObject({ issueId: 'PAN-1866', verdict: 'blocked', notes: 'empty-backlog spawn' });
  });

  it('emits review.approved when reconciling a NEW passed verdict — host-owned review→test handoff (PAN-1988)', () => {
    // A sandboxed codex/pi review agent recorded `passed` to the journal but could not emit the
    // lifecycle event. The host reconcile MUST re-emit review.approved so reactive Cloister
    // dispatches the test role — otherwise the issue strands at review=passed/test=pending until the
    // (possibly frozen) deacon nudges it. This is the exact bug that stranded PAN-1866.
    db.getFromDb.mockReturnValue(dbRow({ reviewStatus: 'reviewing', testStatus: 'pending', updatedAt: '2026-06-20T07:00:00.000Z' }));
    journal.readJournalStatusSync.mockReturnValue({
      updatedAt: '2026-06-20T07:22:21.788Z',
      durable: { reviewStatus: 'passed', testStatus: 'pending' },
    });

    getReviewStatusSync('PAN-1866');

    expect(notifier.notify).toHaveBeenCalledWith({ type: 'review.approved', issueId: 'PAN-1866' });
  });

  it('does NOT emit review.approved when the verdict was already passed (no transition)', () => {
    db.getFromDb.mockReturnValue(dbRow({ reviewStatus: 'passed', testStatus: 'pending', updatedAt: '2026-06-20T07:00:00.000Z' }));
    journal.readJournalStatusSync.mockReturnValue({
      updatedAt: '2026-06-20T07:30:00.000Z',
      durable: { reviewStatus: 'passed', testStatus: 'pending' },
    });

    getReviewStatusSync('PAN-1866');

    expect(notifier.notify).not.toHaveBeenCalledWith({ type: 'review.approved', issueId: 'PAN-1866' });
  });

  it('does NOT re-deliver feedback when the verdict was already blocked (no transition)', async () => {
    // DB already 'blocked'; journal newer (e.g. a later unrelated field) but still 'blocked'.
    db.getFromDb.mockReturnValue(dbRow({ reviewStatus: 'blocked', updatedAt: '2026-06-20T07:00:00.000Z' }));
    journal.readJournalStatusSync.mockReturnValue({
      updatedAt: '2026-06-20T07:30:00.000Z',
      durable: { reviewStatus: 'blocked', testStatus: 'failed' },
    });

    getReviewStatusSync('PAN-1866');
    await new Promise((r) => setTimeout(r, 0));

    expect(feedback.deliver).not.toHaveBeenCalled();
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

describe('resetPipelineVerdictsForWorkStartSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    journal.enrichReviewNotesFromRecordSync.mockImplementation((_id: string, s: ReviewStatus) => s);
    journal.readJournalStatusSync.mockReturnValue(null);
  });

  it('resets stale merged pipeline state before a work agent starts', () => {
    db.getFromDb.mockReturnValue(dbRow({
      reviewStatus: 'passed',
      testStatus: 'passed',
      mergeStatus: 'merged',
      verificationStatus: 'passed',
      readyForMerge: true,
      autoRequeueCount: 2,
      verificationCycleCount: 1,
      reviewRetryCount: 1,
      testRetryCount: 1,
      mergeRetryCount: 1,
      recoveryStartedAt: '2026-06-20T07:00:00.000Z',
      reviewedAtCommit: 'abc123',
      lastVerifiedCommit: 'abc123',
    }));

    const result = resetPipelineVerdictsForWorkStartSync('PAN-1866');

    expect(result).toMatchObject({
      reviewStatus: 'pending',
      testStatus: 'pending',
      mergeStatus: 'pending',
      verificationStatus: 'pending',
      readyForMerge: false,
      autoRequeueCount: 0,
      verificationCycleCount: 0,
      reviewRetryCount: 0,
      testRetryCount: 0,
      mergeRetryCount: 0,
    });
    expect(result?.recoveryStartedAt).toBeUndefined();
    expect(result?.reviewedAtCommit).toBeUndefined();
    expect(result?.lastVerifiedCommit).toBeUndefined();
    expect(journal.updateIssueRecordForReviewStatusSync).toHaveBeenCalledTimes(1);
  });

  it('does nothing when pipeline verdicts are already pending', () => {
    const pending = dbRow({
      reviewStatus: 'pending',
      testStatus: 'pending',
      mergeStatus: 'pending',
      verificationStatus: 'pending',
      readyForMerge: false,
      autoRequeueCount: 0,
      verificationCycleCount: 0,
      reviewRetryCount: 0,
      testRetryCount: 0,
      mergeRetryCount: 0,
      recoveryStartedAt: undefined,
      reviewedAtCommit: undefined,
      lastVerifiedCommit: undefined,
    });
    db.getFromDb.mockReturnValue(pending);

    const result = resetPipelineVerdictsForWorkStartSync('PAN-1866');

    expect(result).toBeNull();
    expect(journal.updateIssueRecordForReviewStatusSync).not.toHaveBeenCalled();
    expect(db.upsert).not.toHaveBeenCalled();
  });
});
