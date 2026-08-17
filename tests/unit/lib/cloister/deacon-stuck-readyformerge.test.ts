/**
 * PAN-2198: reconcileStuckReadyForMerge — periodic re-derive of readyForMerge for
 * the NO-BLOCKER "stuck after review" strand (review+test+verify passed, no merge
 * blocker, but readyForMerge left false). Previously converged only on the
 * server-restart repair sweep (fixStuckReadyForMerge); this patrol does it on the tick.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';

let odb: OverdeckTestDb;

vi.mock('../../../../src/lib/pipeline-notifier.js', () => ({
  notifyPipeline: vi.fn(),
  notifyPipelineSync: vi.fn(),
}));
vi.mock('../../../../src/lib/activity-logger.js', () => ({
  emitActivityEntry: vi.fn(),
  emitActivityEntrySync: vi.fn(),
  emitActivityTts: vi.fn(),
  emitActivityTtsSync: vi.fn(),
}));
vi.mock('../../../../src/lib/cloister/merge-eligibility.js', () => ({
  gatherMergeEligibility: vi.fn(async (issueIds: string[]) => new Map(issueIds.map((issueId) => [issueId, { bucket: 'in_flight' }]))),
  isMergeEligible: vi.fn((membership: { bucket: string }) => membership.bucket === 'in_flight'),
}));

beforeEach(() => {
  odb = setupOverdeckTestDb();
}, 20_000);
afterEach(() => {
  teardownOverdeckTestDb(odb);
});

import { reconcileStuckReadyForMerge } from '../../../../src/lib/cloister/deacon-merge.js';
import { loadReviewStatuses } from '../../../../src/lib/review-status.js';

const seed = (cols: Record<string, string | number>) => {
  const keys = Object.keys(cols);
  const placeholders = keys.map(() => '?').join(', ');
  odb.raw()
    .prepare(`INSERT INTO review_status (${keys.join(', ')}) VALUES (${placeholders})`)
    .run(...keys.map((k) => cols[k]));
};

describe('reconcileStuckReadyForMerge (PAN-2198)', () => {
  it('flips readyForMerge for the no-blocker stuck strand, and is idempotent', async () => {
    seed({
      issue_id: 'PAN-STUCK',
      review_status: 'passed',
      test_status: 'passed',
      verification_status: 'passed',
      merge_status: 'pending',
      updated_at: '2026-06-30T00:00:00Z',
      ready_for_merge: 0,
    });

    const actions = await reconcileStuckReadyForMerge();
    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('PAN-STUCK');
    expect(loadReviewStatuses()['PAN-STUCK'].readyForMerge).toBe(true);

    // Second tick: already flipped → no action (steady state = zero writes)
    expect(await reconcileStuckReadyForMerge()).toHaveLength(0);
  });

  it('leaves a blocker-strand issue untouched (owned by reconcileStaleMergeBlockers)', async () => {
    seed({
      issue_id: 'PAN-BLOCKED',
      review_status: 'passed',
      test_status: 'passed',
      verification_status: 'passed',
      merge_status: 'pending',
      blocker_reasons: JSON.stringify([{ type: 'merge_conflict', detail: 'main moved' }]),
      updated_at: '2026-06-30T00:00:00Z',
      ready_for_merge: 0,
    });

    expect(await reconcileStuckReadyForMerge()).toHaveLength(0);
    expect(loadReviewStatuses()['PAN-BLOCKED'].readyForMerge).toBeFalsy();
  });

  it('leaves an issue whose gates have not passed untouched', async () => {
    seed({
      issue_id: 'PAN-REVIEWING',
      review_status: 'reviewing',
      test_status: 'pending',
      verification_status: 'pending',
      merge_status: 'pending',
      updated_at: '2026-06-30T00:00:00Z',
      ready_for_merge: 0,
    });

    expect(await reconcileStuckReadyForMerge()).toHaveLength(0);
    expect(loadReviewStatuses()['PAN-REVIEWING'].readyForMerge).toBeFalsy();
  });
});
