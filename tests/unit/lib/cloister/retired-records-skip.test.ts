import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';

const github = vi.hoisted(() => ({ getPullRequestState: vi.fn() }));
vi.mock('../../../../src/lib/github-app.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../src/lib/github-app.js')>(),
  isGitHubAppConfigured: vi.fn(() => true),
  getPullRequestState: github.getPullRequestState,
}));
vi.mock('../../../../src/lib/pipeline-notifier.js', () => ({ notifyPipeline: vi.fn(), notifyPipelineSync: vi.fn() }));
vi.mock('../../../../src/lib/activity-logger.js', () => ({
  emitActivityEntry: vi.fn(), emitActivityEntrySync: vi.fn(), emitActivityTts: vi.fn(), emitActivityTtsSync: vi.fn(),
}));

import {
  reconcileClosedPrReadyForMerge,
  reconcileFalseMerged,
  reconcileMergedButReviewing,
  reconcileStaleMergeBlockers,
  reconcileStaleMergeStatus,
  reconcileStuckReadyForMerge,
} from '../../../../src/lib/cloister/deacon-merge.js';
import { getReviewStatusSync, setReviewStatusSync } from '../../../../src/lib/review-status.js';

let odb: OverdeckTestDb;

beforeEach(() => {
  vi.useFakeTimers();
  odb = setupOverdeckTestDb();
  github.getPullRequestState.mockReturnValue(Effect.die('retired record reached GitHub'));
  setReviewStatusSync('PAN-3753', {
    reviewStatus: 'reviewing', testStatus: 'passed', verificationStatus: 'passed',
    mergeStatus: 'merged', readyForMerge: false,
    prUrl: 'https://github.com/eltmon/overdeck/pull/1679',
    blockerReasons: [{ type: 'merge_conflict', summary: 'closed', detectedAt: '2026-08-16T00:00:00Z' }],
  });
  setReviewStatusSync('PAN-3753', { retiredAt: '2026-08-16T00:00:00Z', readyForMerge: false });
});

afterEach(() => {
  teardownOverdeckTestDb(odb);
  vi.useRealTimers();
});

describe('retired review records', () => {
  it('produce no deacon actions or writes', async () => {
    const before = getReviewStatusSync('PAN-3753');
    const gather = vi.fn(async () => new Map());

    expect(await reconcileStaleMergeStatus()).toEqual([]);
    expect(await reconcileFalseMerged()).toEqual([]);
    expect(await reconcileClosedPrReadyForMerge()).toEqual([]);
    expect(await reconcileStaleMergeBlockers(gather)).toEqual([]);
    expect(await reconcileStuckReadyForMerge(gather)).toEqual([]);
    expect(await reconcileMergedButReviewing()).toEqual([]);

    expect(github.getPullRequestState).not.toHaveBeenCalled();
    expect(getReviewStatusSync('PAN-3753')).toEqual(before);
  });
});
