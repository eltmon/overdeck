import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../helpers/overdeck-test-db.js';
import {
  enqueueMerge,
  getCurrentMerge,
  markMergeProcessing,
  removeQueuedMerge,
} from '../../../../src/lib/overdeck/merge.js';

let odb: OverdeckTestDb;

beforeEach(() => { odb = setupOverdeckTestDb(); });
afterEach(() => { teardownOverdeckTestDb(odb); });

/** The project's live queue rows (status queued or processing), read straight from the table. */
function liveQueueRows(projectKey: string): Array<{ issue_id: string; position: number; status: string; started_at: string | null }> {
  return odb.raw().prepare(
    `SELECT issue_id, position, status, started_at
     FROM merge_queue
     WHERE project_key = ? AND status IN ('queued', 'processing')
     ORDER BY position ASC`,
  ).all(projectKey) as Array<{ issue_id: string; position: number; status: string; started_at: string | null }>;
}

describe('persistent merge queue', () => {
  it('returns a deferred processing merge to queued state for restart resumption', () => {
    odb.raw().prepare(
      "INSERT INTO issues (id, stage, updated_at) VALUES (?, 'awaiting_merge', ?)",
    ).run('PAN-3135', Date.now());
    enqueueMerge('pan', 'PAN-3135');
    markMergeProcessing('pan', 'PAN-3135');
    expect(getCurrentMerge('pan')).toBe('PAN-3135');
    expect(liveQueueRows('pan')).toEqual([
      expect.objectContaining({ issue_id: 'PAN-3135', position: 1, status: 'processing', started_at: expect.any(String) }),
    ]);

    markMergeProcessing('pan', 'PAN-3135', false);

    expect(getCurrentMerge('pan')).toBeNull();
    expect(liveQueueRows('pan')).toEqual([
      expect.objectContaining({ issue_id: 'PAN-3135', position: 1, status: 'queued', started_at: null }),
    ]);
  });

  it('only moves a row that is in the expected source state', () => {
    enqueueMerge('pan', 'PAN-3136');

    // Un-marking a merge that is still queued (not processing) matches no row.
    markMergeProcessing('pan', 'PAN-3136', false);
    expect(liveQueueRows('pan')).toEqual([
      expect.objectContaining({ issue_id: 'PAN-3136', status: 'queued', started_at: null }),
    ]);

    markMergeProcessing('pan', 'PAN-3136');
    // Marking an already-processing merge again matches no row, so started_at is not re-stamped.
    const startedAt = liveQueueRows('pan')[0]?.started_at;
    markMergeProcessing('pan', 'PAN-3136');
    expect(liveQueueRows('pan')).toEqual([
      expect.objectContaining({ issue_id: 'PAN-3136', status: 'processing', started_at: startedAt }),
    ]);
  });

  // #4066 review: an operator's auto-merge cancel removes the issue's queue entry.
  it('removes only a waiting entry, never the merge already processing', () => {
    enqueueMerge('pan', 'PAN-1');
    markMergeProcessing('pan', 'PAN-1');
    enqueueMerge('pan', 'PAN-2');
    expect(removeQueuedMerge('pan-2')).toBe(1);
    expect(removeQueuedMerge('PAN-1')).toBe(0);
    expect(liveQueueRows('pan').map((row) => row.issue_id)).toEqual(['PAN-1']);
  });
});
