import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { openDatabase, type SqliteDatabase } from '../../../src/lib/database/driver.js';
import { initSchema } from '../../../src/lib/database/schema.js';
import type { ScopeDriftRecord } from '../../../src/lib/xbrief/continue-state.js';

let testDb: SqliteDatabase;

vi.mock('../../../src/lib/database/index.js', () => ({
  getDatabase: () => testDb,
}));

const mockUpdateIssueRecordForIssue = vi.hoisted(() => vi.fn());
const capturePipelineStageForIssueMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/lib/pan-dir/records.js', () => ({
  updateIssueRecordForIssue: mockUpdateIssueRecordForIssue,
}));

vi.mock('../../../src/lib/pipeline-notifier.js', () => ({
  notifyPipeline: vi.fn(),
  notifyPipelineSync: vi.fn(),
}));

vi.mock('../../../src/lib/activity-logger.js', () => ({
  emitActivityEntry: vi.fn(),
  emitActivityEntrySync: vi.fn(),
  emitActivityTts: vi.fn(),
  emitActivityTtsSync: vi.fn(),
}));

vi.mock('../../../src/lib/telemetry/pipeline.js', () => ({
  capturePipelineStageForIssue: capturePipelineStageForIssueMock,
}));

import { getReviewStatusSync, setReviewStatusSync } from '../../../src/lib/review-status.js';
import {
  registerReviewStatusMapReader,
  resolveCanonicalReviewStatus,
} from '../../../src/lib/cloister/review-status-source.js';
import { rehydrateHeadAnchor } from '../../../src/lib/git-utils.js';

describe('review status', () => {
  beforeEach(() => {
    testDb = openDatabase(':memory:');
    testDb.pragma('foreign_keys = ON');
    initSchema(testDb);
    mockUpdateIssueRecordForIssue.mockClear();
    capturePipelineStageForIssueMock.mockClear();
  });

  afterEach(() => {
    testDb.close();
  });

  it('rejects raw strings at the review anchor write door', () => {
    const invalidWrite = () => {
      // @ts-expect-error reviewedAtCommit must be producer-issued or explicitly rehydrated.
      setReviewStatusSync('PAN-3076', { reviewedAtCommit: 'raw-string' });
    };

    expect(invalidWrite).toBeTypeOf('function');
  });

  it('resolves canonical merged status even when the raw status map is stale', () => {
    setReviewStatusSync('PAN-3138', { mergeStatus: 'merged' });
    registerReviewStatusMapReader(() => ({
      'PAN-3138': { mergeStatus: 'failed' },
    }));

    expect(resolveCanonicalReviewStatus('PAN-3138')).toMatchObject({
      available: true,
      status: { mergeStatus: 'merged' },
    });
  });

  it('persists scope drift through the review status journal update', () => {
    const scopeDrift: ScopeDriftRecord = {
      outsideDeclaredScope: ['src/unplanned.ts'],
      declaredScopeUntouched: ['src/planned.ts'],
      declaredScope: ['src/planned.ts'],
      actualChangedFiles: ['src/unplanned.ts'],
      recordedAt: '2026-06-30T12:00:00.000Z',
    };

    setReviewStatusSync('PAN-1762', {
      reviewStatus: 'pending',
      testStatus: 'pending',
      readyForMerge: false,
      scopeDrift,
    });

    expect(mockUpdateIssueRecordForIssue).toHaveBeenCalledTimes(1);
    const [, reviewStatus] = mockUpdateIssueRecordForIssue.mock.calls[0];
    expect(reviewStatus.scopeDrift).toEqual(scopeDrift);
  });

  it('finalizes verification when no-code-drift skips the post-review test role', () => {
    // This fixture simulates an anchor read back from unbranded storage.
    const head = rehydrateHeadAnchor('abc123abc123abc123abc123abc123abc123abcd');
    setReviewStatusSync('PAN-2200', {
      reviewStatus: 'pending',
      testStatus: 'pending',
      verificationStatus: 'running',
      reviewedAtCommit: head,
      lastVerifiedCommit: head,
    });

    setReviewStatusSync('PAN-2200', { reviewStatus: 'passed' });

    const status = getReviewStatusSync('PAN-2200');
    expect(status).toMatchObject({
      reviewStatus: 'passed',
      testStatus: 'passed',
      verificationStatus: 'passed',
      readyForMerge: true,
    });
    expect(capturePipelineStageForIssueMock).toHaveBeenCalledTimes(1);
    expect(capturePipelineStageForIssueMock).toHaveBeenCalledWith('PAN-2200', 'review_passed');
  });

  it('consumes a serviced review request when review passes', () => {
    const initial = setReviewStatusSync('PAN-3083', {
      reviewStatus: 'pending',
      reviewRequestedAt: '2026-07-25T10:00:00.000Z',
      reviewSpawnedAt: '2026-07-25T10:01:00.000Z',
    });
    mockUpdateIssueRecordForIssue.mockClear();

    const status = setReviewStatusSync('PAN-3083', { reviewStatus: 'passed' }, initial);

    expect(status.reviewRequestedAt).toBeUndefined();
    const [, journalStatus] = mockUpdateIssueRecordForIssue.mock.calls.at(-1)!;
    const journalPipeline = JSON.parse(JSON.stringify(journalStatus));
    expect(journalPipeline).not.toHaveProperty('reviewRequestedAt');
  });

  it('preserves a review request newer than the current spawn', () => {
    const initial = setReviewStatusSync('PAN-3084', {
      reviewStatus: 'pending',
      reviewRequestedAt: '2026-07-25T10:02:00.000Z',
      reviewSpawnedAt: '2026-07-25T10:01:00.000Z',
    });
    mockUpdateIssueRecordForIssue.mockClear();

    const status = setReviewStatusSync('PAN-3084', { reviewStatus: 'failed' }, initial);

    expect(status.reviewRequestedAt).toBe('2026-07-25T10:02:00.000Z');
    const [, journalStatus] = mockUpdateIssueRecordForIssue.mock.calls.at(-1)!;
    expect(journalStatus.reviewRequestedAt).toBe('2026-07-25T10:02:00.000Z');
  });

  it('consumes a review request without a spawn timestamp when review blocks', () => {
    const initial = setReviewStatusSync('PAN-3085', {
      reviewStatus: 'pending',
      reviewRequestedAt: '2026-07-25T10:00:00.000Z',
    });
    mockUpdateIssueRecordForIssue.mockClear();

    const status = setReviewStatusSync('PAN-3085', { reviewStatus: 'blocked' }, initial);

    expect(status.reviewRequestedAt).toBeUndefined();
    const [, journalStatus] = mockUpdateIssueRecordForIssue.mock.calls.at(-1)!;
    const journalPipeline = JSON.parse(JSON.stringify(journalStatus));
    expect(journalPipeline).not.toHaveProperty('reviewRequestedAt');
  });

  it('preserves a pending review request during non-verdict updates', () => {
    const initial = setReviewStatusSync('PAN-3086', {
      reviewStatus: 'pending',
      reviewRequestedAt: '2026-07-25T10:00:00.000Z',
      reviewSpawnedAt: '2026-07-25T10:01:00.000Z',
    });
    mockUpdateIssueRecordForIssue.mockClear();

    const status = setReviewStatusSync('PAN-3086', { testStatus: 'running' }, initial);

    expect(status.reviewRequestedAt).toBe('2026-07-25T10:00:00.000Z');
    const [, journalStatus] = mockUpdateIssueRecordForIssue.mock.calls.at(-1)!;
    expect(journalStatus.reviewRequestedAt).toBe('2026-07-25T10:00:00.000Z');
  });
});
