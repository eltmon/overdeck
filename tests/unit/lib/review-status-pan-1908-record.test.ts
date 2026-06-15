/**
 * Tests for PAN-1908 pipeline-status-to-git wiring.
 *
 * Verifies that setReviewStatusSync updates the per-issue permanent record
 * in the infra repo whenever durable review_status verdicts change.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openDatabase, type SqliteDatabase } from '../../../src/lib/database/driver.js';
import { initSchema } from '../../../src/lib/database/schema.js';

// ============== In-memory DB injection ==============

let testDb: SqliteDatabase;

vi.mock('../../../src/lib/database/index.js', () => ({
  getDatabase: () => testDb,
}));

const mockUpdateIssueRecordForIssue = vi.hoisted(() => vi.fn());

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

beforeEach(() => {
  testDb = openDatabase(':memory:');
  testDb.pragma('foreign_keys = ON');
  initSchema(testDb);
  mockUpdateIssueRecordForIssue.mockClear();
});

afterEach(() => {
  testDb.close();
});

// ============== Import after mocks ==============

import { setReviewStatusSync } from '../../../src/lib/review-status.js';

describe('setReviewStatusSync PAN-1908 record projection', () => {
  it('updates the per-issue permanent record after a durable verdict change', () => {
    setReviewStatusSync('PAN-1908', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      readyForMerge: true,
    });

    expect(mockUpdateIssueRecordForIssue).toHaveBeenCalledTimes(1);
    const [issueId, reviewStatus] = mockUpdateIssueRecordForIssue.mock.calls[0];
    expect(issueId).toBe('PAN-1908');
    expect(reviewStatus.reviewStatus).toBe('passed');
    expect(reviewStatus.testStatus).toBe('passed');
    expect(reviewStatus.readyForMerge).toBe(true);
  });
});
