import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  enqueuePostMergeLifecycleMock,
  execFileMock,
  findSpecByIssueMock,
  getAgentStateMock,
  getMergeSetMock,
  loadReviewStatusesMock,
  observeForgeMergeStateMock,
  resolveGitHubIssueMock,
  resolveProjectMock,
  reviewGatesPassedMock,
  setReviewStatusMock,
} = vi.hoisted(() => ({
  enqueuePostMergeLifecycleMock: vi.fn(),
  execFileMock: vi.fn(),
  findSpecByIssueMock: vi.fn(),
  getAgentStateMock: vi.fn(),
  getMergeSetMock: vi.fn(),
  loadReviewStatusesMock: vi.fn(),
  observeForgeMergeStateMock: vi.fn(),
  resolveGitHubIssueMock: vi.fn(),
  resolveProjectMock: vi.fn(),
  reviewGatesPassedMock: vi.fn(),
  setReviewStatusMock: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  execFileMock[Symbol.for('nodejs.util.promisify.custom')] = execFileMock;
  return { ...actual, execFile: execFileMock };
});

vi.mock('../../../../src/lib/review-status.js', () => ({
  loadReviewStatuses: loadReviewStatusesMock,
  reviewGatesPassedSync: reviewGatesPassedMock,
  setReviewStatusSync: setReviewStatusMock,
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: resolveProjectMock,
}));

vi.mock('../../../../src/lib/tracker-utils.js', () => ({
  resolveGitHubIssueSync: resolveGitHubIssueMock,
}));

vi.mock('../../../../src/lib/merge-set.js', () => ({
  getMergeSetSync: getMergeSetMock,
}));

vi.mock('../../../../src/lib/agents.js', () => ({
  getAgentStateSync: getAgentStateMock,
}));

vi.mock('../../../../src/lib/cloister/merge-completeness.js', () => ({
  observeForgeMergeState: observeForgeMergeStateMock,
}));

vi.mock('../../../../src/lib/pan-dir/specs.js', () => ({
  findSpecByIssue: findSpecByIssueMock,
}));

vi.mock('../../../../src/lib/cloister/post-merge-lifecycle-worker.js', () => ({
  enqueuePostMergeLifecycle: enqueuePostMergeLifecycleMock,
}));

import {
  reconcileStuckMergingStates,
  STUCK_MERGING_MS,
} from '../../../../src/lib/cloister/deacon-stuck-merging.js';

const NOW = new Date('2026-07-26T22:00:00.000Z');

function status(
  mergeStatus: 'merging' | 'verifying',
  ageMs: number,
  overrides: Record<string, unknown> = {},
) {
  const timestamp = new Date(NOW.getTime() - ageMs).toISOString();
  return {
    issueId: 'MIN-898',
    reviewStatus: 'passed',
    testStatus: 'passed',
    verificationStatus: 'passed',
    mergeStatus,
    readyForMerge: false,
    updatedAt: timestamp,
    history: [{ type: 'merge', status: mergeStatus, timestamp }],
    ...overrides,
  };
}

function observation(overrides: Record<string, unknown> = {}) {
  return {
    complete: false,
    hasPositiveMergedEvidence: false,
    mergeSet: null,
    repos: [{ repoKey: 'api', state: 'unmerged', aheadCount: 1, reason: 'api MR is open' }],
    summary: 'api MR is open',
    ...overrides,
  };
}

describe('reconcileStuckMergingStates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    resolveProjectMock.mockReturnValue({ projectPath: '/tmp/myn' });
    resolveGitHubIssueMock.mockReturnValue({ isGitHub: false });
    getMergeSetMock.mockReturnValue({
      status: 'merging',
      repos: [{ repoKey: 'api', forge: 'gitlab' }],
    });
    findSpecByIssueMock.mockReturnValue(Effect.succeed({ status: 'active' }));
    getAgentStateMock.mockReturnValue(null);
    observeForgeMergeStateMock.mockResolvedValue(observation());
    reviewGatesPassedMock.mockReturnValue(true);
    enqueuePostMergeLifecycleMock.mockReturnValue('Queued post-merge lifecycle for MIN-898');
    execFileMock.mockResolvedValue({ stdout: '[]' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('leaves a merging row younger than 30 minutes untouched', async () => {
    loadReviewStatusesMock.mockReturnValue({
      'MIN-898': status('merging', STUCK_MERGING_MS - 1),
    });

    const actions = await reconcileStuckMergingStates();

    expect(observeForgeMergeStateMock).not.toHaveBeenCalled();
    expect(setReviewStatusMock).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });

  it('terminalizes an expired merging row when the forge proves the merge', async () => {
    loadReviewStatusesMock.mockReturnValue({
      'MIN-898': status('merging', STUCK_MERGING_MS + 1),
    });
    observeForgeMergeStateMock.mockResolvedValue(observation({
      complete: true,
      hasPositiveMergedEvidence: true,
      repos: [{ repoKey: 'api', state: 'merged', aheadCount: 1, reason: 'api MR merged' }],
      summary: 'Merge complete across 1 repository',
    }));

    const actions = await reconcileStuckMergingStates();

    expect(setReviewStatusMock).toHaveBeenCalledWith('MIN-898', {
      mergeStatus: 'merged',
      mergeStep: 'post-merge-cleanup',
      readyForMerge: false,
    });
    expect(enqueuePostMergeLifecycleMock).toHaveBeenCalledWith(
      'MIN-898',
      '/tmp/myn',
      'feature/min-898',
    );
    expect(actions).toEqual(expect.arrayContaining([
      expect.stringContaining('Reconciled stuck merging state'),
      'Queued post-merge lifecycle for MIN-898',
    ]));
  });

  it.each([true, false])(
    'resets an expired unmerged row and derives readyForMerge=%s from the gates',
    async (gatesPassed) => {
      const stuck = status('merging', STUCK_MERGING_MS + 1);
      loadReviewStatusesMock.mockReturnValue({ 'MIN-898': stuck });
      reviewGatesPassedMock.mockReturnValue(gatesPassed);

      const actions = await reconcileStuckMergingStates();

      expect(reviewGatesPassedMock).toHaveBeenCalledWith({ ...stuck, mergeStatus: 'pending' });
      expect(setReviewStatusMock).toHaveBeenCalledWith('MIN-898', {
        mergeStatus: 'pending',
        mergeNotes: expect.stringContaining('forge has no completed merge evidence'),
        readyForMerge: gatesPassed,
      });
      expect(actions).toEqual(['Reset stuck merging state for MIN-898 to pending']);
    },
  );

  it('covers verifying rows and fails open when forge evidence is unverifiable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    loadReviewStatusesMock.mockReturnValue({
      'MIN-898': status('verifying', STUCK_MERGING_MS + 1),
    });
    observeForgeMergeStateMock.mockResolvedValue(observation({
      repos: [{
        repoKey: 'api',
        state: 'unverifiable',
        aheadCount: 0,
        reason: 'glab authentication failed',
      }],
      summary: 'glab authentication failed',
    }));

    const actions = await reconcileStuckMergingStates();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('stuck verifying state is unverifiable'));
    expect(setReviewStatusMock).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
    warn.mockRestore();
  });
});
