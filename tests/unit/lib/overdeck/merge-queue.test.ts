import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../helpers/overdeck-test-db.js';
import {
  enqueueMerge,
  getCurrentMerge,
  getQueueForProject,
  markMergeProcessing,
  requeueMerge,
} from '../../../../src/lib/overdeck/merge.js';

let odb: OverdeckTestDb;

beforeEach(() => { odb = setupOverdeckTestDb(); });
afterEach(() => { teardownOverdeckTestDb(odb); });

describe('persistent merge queue', () => {
  it('returns a deferred processing merge to queued state for restart resumption', () => {
    odb.raw().prepare(
      "INSERT INTO issues (id, stage, updated_at) VALUES (?, 'awaiting_merge', ?)",
    ).run('PAN-3135', Date.now());
    enqueueMerge('pan', 'PAN-3135');
    markMergeProcessing('pan', 'PAN-3135');
    expect(getCurrentMerge('pan')).toBe('PAN-3135');

    expect(requeueMerge('pan', 'PAN-3135')).toBe(true);

    expect(getCurrentMerge('pan')).toBeNull();
    expect(getQueueForProject('pan')).toEqual([
      expect.objectContaining({ issueId: 'PAN-3135', position: 1, status: 'queued', startedAt: null }),
    ]);
  });
});
