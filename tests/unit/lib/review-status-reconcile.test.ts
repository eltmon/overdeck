import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewStatus } from '../../../src/lib/review-status.js';

const {
  mockDbUpsert,
  mockGetReviewStatusFromDbSync,
  mockReadJournalStatusSync,
  mockEnrichReviewNotesFromRecordSync,
  mockNotifyPipelineSync,
} = vi.hoisted(() => ({
  mockDbUpsert: vi.fn(),
  mockGetReviewStatusFromDbSync: vi.fn(),
  mockReadJournalStatusSync: vi.fn(),
  mockEnrichReviewNotesFromRecordSync: vi.fn(),
  mockNotifyPipelineSync: vi.fn(),
}));

vi.mock('../../../src/lib/overdeck/review-status-sync.js', () => ({
  upsertReviewStatusSync: mockDbUpsert,
  deleteReviewStatus: vi.fn(),
  getReviewStatusFromDbSync: mockGetReviewStatusFromDbSync,
  getAllReviewStatusesFromDb: vi.fn(() => ({})),
  getReviewStatusesFromDb: vi.fn(() => ({})),
  markWorkspaceStuck: vi.fn(),
  clearWorkspaceStuck: vi.fn(),
}));

vi.mock('../../../src/lib/overdeck/review-status-record-sync.js', () => ({
  updateIssueRecordForReviewStatusSync: vi.fn(),
  enrichReviewNotesFromRecordSync: mockEnrichReviewNotesFromRecordSync,
  readJournalStatusSync: mockReadJournalStatusSync,
}));

vi.mock('../../../src/lib/pipeline-notifier.js', () => ({
  notifyPipelineSync: mockNotifyPipelineSync,
}));

vi.mock('../../../src/lib/activity-logger.js', () => ({
  emitActivityEntrySync: vi.fn(),
  emitActivityTtsSync: vi.fn(),
}));

import { getReviewStatusSync } from '../../../src/lib/review-status.js';

const dbStatus: ReviewStatus = {
  issueId: 'PAN-2988',
  reviewStatus: 'pending',
  testStatus: 'pending',
  verificationStatus: 'pending',
  mergeStatus: 'pending',
  readyForMerge: false,
  updatedAt: '2026-07-22T20:00:00.000Z',
};

describe('review status journal reconciliation', () => {
  beforeEach(() => {
    mockDbUpsert.mockReset();
    mockGetReviewStatusFromDbSync.mockReset();
    mockReadJournalStatusSync.mockReset();
    mockEnrichReviewNotesFromRecordSync.mockReset();
    mockNotifyPipelineSync.mockReset();
    mockGetReviewStatusFromDbSync.mockReturnValue(dbStatus);
    mockEnrichReviewNotesFromRecordSync.mockImplementation((_issueId, status) => status);
  });

  it('emits status_changed after a newer journal record is reconciled into the cache', () => {
    mockReadJournalStatusSync.mockReturnValue({
      updatedAt: '2026-07-22T20:01:00.000Z',
      durable: {
        reviewStatus: 'pending',
        testStatus: 'pending',
        verificationStatus: 'pending',
        mergeStatus: 'pending',
      },
    });

    const result = getReviewStatusSync(dbStatus.issueId);

    expect(mockDbUpsert).toHaveBeenCalledOnce();
    expect(mockNotifyPipelineSync).toHaveBeenCalledOnce();
    expect(mockNotifyPipelineSync).toHaveBeenCalledWith({
      type: 'status_changed',
      issueId: dbStatus.issueId,
      status: result,
    });
    expect(result?.updatedAt).toBe('2026-07-22T20:01:00.000Z');
  });

  // PAN-3339: the write door settles merged + pending verification to skipped.
  // A journal record still carrying the ownerless `pending` must not reinstate it.
  it('settles a pending verification carried by a merged journal record', () => {
    mockReadJournalStatusSync.mockReturnValue({
      updatedAt: '2026-07-22T20:01:00.000Z',
      durable: {
        reviewStatus: 'passed',
        testStatus: 'passed',
        verificationStatus: 'pending',
        mergeStatus: 'merged',
      },
    });

    expect(getReviewStatusSync(dbStatus.issueId)).toMatchObject({
      mergeStatus: 'merged',
      verificationStatus: 'skipped',
      verificationNotes: 'Merge already landed; verify-on-main owns post-merge validation.',
    });
  });

  it('does not emit when the DB cache is current with the journal', () => {
    mockReadJournalStatusSync.mockReturnValue({
      updatedAt: dbStatus.updatedAt,
      durable: {
        reviewStatus: 'pending',
        testStatus: 'pending',
        verificationStatus: 'pending',
        mergeStatus: 'pending',
      },
    });

    expect(getReviewStatusSync(dbStatus.issueId)).toEqual(dbStatus);
    expect(mockDbUpsert).not.toHaveBeenCalled();
    expect(mockNotifyPipelineSync).not.toHaveBeenCalled();
  });
});
