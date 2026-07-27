import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewStatus } from '../review-status-reconcile.js';

const mocks = vi.hoisted(() => ({
  dbGet: vi.fn(),
  dbUpsert: vi.fn(),
  emitActivity: vi.fn(),
  resolveJournal: vi.fn(),
  updateRecord: vi.fn(),
}));

vi.mock('../overdeck/review-status-sync.js', () => ({
  upsertReviewStatusSync: mocks.dbUpsert,
  deleteReviewStatus: vi.fn(),
  getReviewStatusFromDbSync: mocks.dbGet,
  getAllReviewStatusesFromDb: vi.fn(() => ({})),
  getReviewStatusesFromDb: vi.fn(() => ({})),
  markWorkspaceStuck: vi.fn(),
  clearWorkspaceStuck: vi.fn(),
}));

vi.mock('../overdeck/review-status-record-sync.js', () => ({
  updateIssueRecordForReviewStatusSync: mocks.updateRecord,
  readJournalStatusSync: vi.fn(() => null),
}));

vi.mock('../cloister/review-status-source.js', () => ({
  registerCanonicalReviewStatusResolver: vi.fn(),
  registerReviewStatusMapReader: vi.fn(),
}));

vi.mock('../review-status-read.js', () => ({
  resolveJournalReconciledReviewStatusSync: mocks.resolveJournal,
}));

vi.mock('../pipeline-notifier.js', () => ({
  notifyPipelineSync: vi.fn(),
}));

vi.mock('../activity-logger.js', () => ({
  emitActivityEntrySync: mocks.emitActivity,
  emitActivityTtsSync: vi.fn(),
}));

vi.mock('../telemetry/pipeline.js', () => ({
  capturePipelineStageForIssue: vi.fn(),
}));

import { getReviewStatusSync } from '../review-status.js';

function pendingStatus(reviewRequestedAt: string): ReviewStatus {
  return {
    issueId: 'PAN-3187',
    reviewStatus: 'pending',
    testStatus: 'pending',
    mergeStatus: 'pending',
    readyForMerge: false,
    reviewRequestedAt,
    updatedAt: new Date().toISOString(),
  };
}

describe('stale review request reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveJournal.mockImplementation((issueId, dbStatus, hooks) => {
      hooks.maybeAutoDispatchReviewHostSide(issueId, dbStatus);
      return dbStatus;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clears an expired request once without re-entering reconciliation', () => {
    const status = pendingStatus(new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString());
    mocks.dbGet.mockReturnValue(status);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});

    getReviewStatusSync('PAN-3187');
    getReviewStatusSync('PAN-3187');

    expect(mocks.dbGet).toHaveBeenCalledTimes(2);
    expect(mocks.dbUpsert).toHaveBeenCalledTimes(1);
    expect(mocks.dbUpsert).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-3187',
      reviewRequestedAt: undefined,
    }));
    expect(mocks.updateRecord).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(debug).not.toHaveBeenCalled();
    expect(mocks.emitActivity).toHaveBeenCalledWith(expect.objectContaining({
      source: 'cloister',
      level: 'warn',
      issueId: 'PAN-3187',
    }));
  });

  it('preserves a fresh request and follows the dispatch path', async () => {
    const status = pendingStatus(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    mocks.dbGet.mockReturnValue(status);
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});

    expect(getReviewStatusSync('PAN-3187')?.reviewRequestedAt).toBe(status.reviewRequestedAt);

    await vi.waitFor(() => expect(debug).toHaveBeenCalledTimes(1));
    expect(mocks.dbUpsert).not.toHaveBeenCalled();
    expect(mocks.updateRecord).not.toHaveBeenCalled();
  });
});
