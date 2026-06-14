import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type SqliteDatabase } from '../../../../src/lib/database/driver.js';
import { initSchema } from '../../../../src/lib/database/schema.js';

let testDb: SqliteDatabase;

vi.mock('../../../../src/lib/database/index.js', () => ({
  getDatabase: () => testDb,
}));

beforeEach(() => {
  testDb = openDatabase(':memory:');
  initSchema(testDb);
});

afterEach(() => {
  testDb.close();
});

import {
  dequeueMerge,
  enqueueMerge,
  getCurrentMerge,
  markMergeProcessing,
  resetProcessingToQueued,
} from '../../../../src/lib/database/merge-queue-db.js';

describe('merge-queue-db', () => {
  it('returns the next queued issue without deleting unrelated processing rows', () => {
    enqueueMerge('pan', 'PAN-1');
    enqueueMerge('pan', 'PAN-2');
    markMergeProcessing('pan', 'PAN-1');

    const next = dequeueMerge('pan', 'PAN-1');

    expect(next).toBe('PAN-2');
    expect(getCurrentMerge('pan')).toBeNull();
    const remaining = testDb.prepare(
      `SELECT issue_id, status FROM merge_queue ORDER BY position ASC`
    ).all() as Array<{ issue_id: string; status: string }>;
    expect(remaining).toEqual([{ issue_id: 'PAN-2', status: 'queued' }]);
  });

  it('resetProcessingToQueued preserves entries for startup resume', () => {
    enqueueMerge('pan', 'PAN-1');
    markMergeProcessing('pan', 'PAN-1');

    expect(resetProcessingToQueued()).toBe(1);
    const row = testDb.prepare(
      `SELECT issue_id, status, started_at FROM merge_queue WHERE issue_id = 'PAN-1'`
    ).get() as { issue_id: string; status: string; started_at: string | null };

    expect(row).toEqual({
      issue_id: 'PAN-1',
      status: 'queued',
      started_at: null,
    });
  });
});
