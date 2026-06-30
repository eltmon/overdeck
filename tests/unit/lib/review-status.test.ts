import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { openDatabase, type SqliteDatabase } from '../../../src/lib/database/driver.js';
import { initSchema } from '../../../src/lib/database/schema.js';
import type { ScopeDriftRecord } from '../../../src/lib/vbrief/continue-state.js';

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

import { setReviewStatusSync } from '../../../src/lib/review-status.js';

describe('review status scope drift', () => {
  beforeEach(() => {
    testDb = openDatabase(':memory:');
    testDb.pragma('foreign_keys = ON');
    initSchema(testDb);
    mockUpdateIssueRecordForIssue.mockClear();
  });

  afterEach(() => {
    testDb.close();
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
});
