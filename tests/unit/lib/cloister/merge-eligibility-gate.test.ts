import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';
import type { PipelineBucket } from '@overdeck/contracts';
import type { PipelineMembership } from '../../../../src/lib/pipeline-membership.js';

const mocks = vi.hoisted(() => ({
  resolveConflictGate: vi.fn(),
}));

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
vi.mock('../../../../src/lib/cloister/conflict-gate.js', () => ({
  buildRealConflictGateDeps: vi.fn(() => ({})),
  resolveConflictGate: mocks.resolveConflictGate,
}));

import {
  gatherMergeEligibility,
  isMergeEligible,
} from '../../../../src/lib/cloister/merge-eligibility.js';
import {
  reconcileStaleMergeBlockers,
  reconcileStuckReadyForMerge,
} from '../../../../src/lib/cloister/deacon-merge.js';
import {
  fixStuckReadyForMerge,
  loadReviewStatuses,
  setReviewStatusSync,
} from '../../../../src/lib/review-status.js';

let odb: OverdeckTestDb;

const membership = (issueId: string, bucket: PipelineBucket): PipelineMembership => ({
  issueId,
  bucket,
  inPipeline: bucket !== 'clean_terminal',
  reasons: [],
  labelDrift: null,
  lenses: { L1_openPr: bucket === 'in_flight', L2_unmergedBranch: false, L3_issueOpen: true, L4_phaseLabel: null },
});

const eligibility = (bucket: PipelineBucket) => async (issueIds: string[]) =>
  new Map(issueIds.map((issueId) => [issueId.toUpperCase(), membership(issueId, bucket)]));

const seed = (issueId: string, blockers: unknown[] = []) => {
  odb.raw().prepare(`INSERT INTO review_status (
    issue_id, review_status, test_status, verification_status, merge_status,
    blocker_reasons, updated_at, ready_for_merge
  ) VALUES (?, 'passed', 'passed', 'passed', 'pending', ?, '2026-08-16T00:00:00Z', 0)`)
    .run(issueId, JSON.stringify(blockers));
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-16T12:00:00Z'));
  odb = setupOverdeckTestDb();
  mocks.resolveConflictGate.mockReset();
});

afterEach(() => {
  teardownOverdeckTestDb(odb);
  vi.useRealTimers();
});

describe('readyForMerge pipeline-membership gates', () => {
  it('keeps a stale blocker for planned backlog membership', async () => {
    seed('PAN-3753', [{ type: 'merge_conflict', detail: 'main moved' }]);

    expect(await reconcileStaleMergeBlockers(eligibility('planned_backlog'), () => true, () => '/tmp/workspace')).toEqual([]);
    expect(mocks.resolveConflictGate).not.toHaveBeenCalled();
    expect(loadReviewStatuses()['PAN-3753']).toMatchObject({ readyForMerge: false, retiredAt: '2026-08-16T12:00:00.000Z' });
    expect(loadReviewStatuses()['PAN-3753'].blockerReasons).toHaveLength(1);
  });

  it('still clears a stale blocker for in-flight membership', async () => {
    vi.setSystemTime(new Date('2026-08-16T12:03:00Z'));
    seed('PAN-3753', [{ type: 'merge_conflict', detail: 'main moved' }]);
    mocks.resolveConflictGate.mockImplementation(async (issueId: string) => {
      setReviewStatusSync(issueId, { blockerReasons: [] });
      return { clearedStaleBlocker: true };
    });

    expect(await reconcileStaleMergeBlockers(eligibility('in_flight'), () => true, () => '/tmp/workspace')).toHaveLength(1);
    expect(mocks.resolveConflictGate).toHaveBeenCalledOnce();
    expect(loadReviewStatuses()['PAN-3753']).toMatchObject({ readyForMerge: true, blockerReasons: [] });
  });

  it('does not restore stuck readyForMerge in either patrol or boot sweep for planned backlog', async () => {
    seed('PAN-3753');

    expect(await reconcileStuckReadyForMerge(eligibility('planned_backlog'))).toEqual([]);
    await fixStuckReadyForMerge(eligibility('planned_backlog'));

    expect(loadReviewStatuses()['PAN-3753'].readyForMerge).toBe(false);
  });

  it('does not gather or write retired records during the boot sweep', async () => {
    seed('PAN-3753');
    odb.raw().prepare('UPDATE review_status SET retired_at = ? WHERE issue_id = ?')
      .run(Date.parse('2026-08-16T06:00:00Z'), 'PAN-3753');
    const gather = vi.fn(eligibility('in_flight'));

    await fixStuckReadyForMerge(gather);

    expect(gather).not.toHaveBeenCalled();
    expect(loadReviewStatuses()['PAN-3753']).toMatchObject({
      readyForMerge: false,
      retiredAt: '2026-08-16T06:00:00.000Z',
      updatedAt: '2026-08-16T00:00:00.000Z',
    });
  });

  it('does not gather project lenses when there are no candidates', async () => {
    const gather = vi.fn(async () => []);
    const memberships = await gatherMergeEligibility([], {
      resolveProject: vi.fn(),
      getProject: vi.fn(),
      gather,
    });

    expect(memberships.size).toBe(0);
    expect(gather).not.toHaveBeenCalled();
  });

  it('gathers once per represented project and only in-flight is merge-eligible', async () => {
    const gather = vi.fn(async () => [{
      issueId: 'PAN-1', issueOpen: true, hasOpenPr: true, hasMergedPr: false,
      hasConventionBranch: true, branchUnmerged: true, hasMergedBranchWork: false,
      phaseLabel: 'in-review', hasXbriefSpec: true, explicitlyReady: false,
      hasTerminalCloseOut: false,
    }]);
    const memberships = await gatherMergeEligibility(['PAN-1', 'PAN-2'], {
      resolveProject: vi.fn((issueId: string) => ({ projectKey: 'overdeck', projectName: 'Overdeck', projectPath: '/repo', linearTeam: issueId.split('-')[0] })),
      getProject: vi.fn(() => ({ name: 'Overdeck', path: '/repo', issue_prefix: 'PAN' })),
      gather,
    });

    expect(gather).toHaveBeenCalledOnce();
    expect(isMergeEligible(memberships.get('PAN-1')!)).toBe(true);
  });
});
