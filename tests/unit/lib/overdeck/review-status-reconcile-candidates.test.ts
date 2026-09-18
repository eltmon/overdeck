import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getMergeBlockerReconcileCandidatesSync } from '../../../../src/lib/overdeck/review-status-sync.js';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../helpers/overdeck-test-db.js';

describe('merge-blocker reconcile candidates', () => {
  let odb: OverdeckTestDb;

  beforeEach(() => { odb = setupOverdeckTestDb(); });
  afterEach(() => { teardownOverdeckTestDb(odb); });

  it('includes a not-ready row carrying a failing_checks blocker', () => {
    odb.raw().prepare(`
      INSERT INTO review_status
        (issue_id, review_status, test_status, pr_url, blocker_reasons, updated_at, ready_for_merge)
      VALUES (?, 'passed', 'passed', ?, ?, ?, 0)
    `).run(
      'PAN-2712',
      'https://github.com/eltmon/overdeck/pull/2712',
      JSON.stringify([{ type: 'failing_checks', summary: 'Required checks are failing' }]),
      Date.now(),
    );

    expect(getMergeBlockerReconcileCandidatesSync()).toEqual([
      expect.objectContaining({ issueId: 'PAN-2712', readyForMerge: false }),
    ]);
  });

  it('excludes retired rows carrying merge blockers', () => {
    odb.raw().prepare(`
      INSERT INTO review_status
        (issue_id, review_status, test_status, blocker_reasons, retired_at, updated_at, ready_for_merge)
      VALUES (?, 'passed', 'passed', ?, ?, ?, 0)
    `).run(
      'PAN-3753',
      JSON.stringify([{ type: 'not_mergeable', summary: 'closed PR' }]),
      Date.now(),
      Date.now(),
    );

    expect(getMergeBlockerReconcileCandidatesSync()).toEqual([]);
  });
});
