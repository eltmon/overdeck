import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewStatus } from '../../../../src/lib/review-status.js';
import {
  reconcileStuckMergingStatesWithDeps,
  STUCK_MERGING_MS,
  type StuckMergingDeps,
} from '../../../../src/lib/cloister/deacon-stuck-merging.js';

const NOW = new Date('2026-07-26T22:00:00.000Z');

function status(
  mergeStatus: 'merging' | 'verifying',
  ageMs: number,
  overrides: Partial<ReviewStatus> = {},
): ReviewStatus {
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
  } as ReviewStatus;
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

function makeDeps(overrides: Partial<StuckMergingDeps> = {}): StuckMergingDeps {
  return {
    now: vi.fn(() => NOW.getTime()),
    loadStatuses: vi.fn(() => ({})),
    resolveProject: vi.fn(() => ({ projectPath: '/tmp/myn' })),
    getMergeSet: vi.fn(() => ({ status: 'merging', repos: [{ repoKey: 'api', forge: 'gitlab' }] }) as any),
    resolveGitHubIssue: vi.fn(() => ({ isGitHub: false })),
    observeForge: vi.fn(async () => observation() as any),
    observeGitHub: vi.fn(async () => ({ merged: false })),
    readSpecStatus: vi.fn(async () => 'active'),
    hasPlanningAgent: vi.fn(() => false),
    reviewGatesPassed: vi.fn(() => true),
    setReviewStatus: vi.fn() as unknown as StuckMergingDeps['setReviewStatus'],
    enqueuePostMerge: vi.fn(async () => 'Queued post-merge lifecycle for MIN-898'),
    warn: vi.fn(),
    ...overrides,
  };
}

describe('reconcileStuckMergingStatesWithDeps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the injected clock and leaves a merging row younger than 30 minutes untouched', async () => {
    const deps = makeDeps({
      loadStatuses: vi.fn(() => ({
        'MIN-898': status('merging', STUCK_MERGING_MS - 1),
      })),
    });

    const actions = await reconcileStuckMergingStatesWithDeps(deps);

    expect(deps.now).toHaveBeenCalledTimes(1);
    expect(deps.observeForge).not.toHaveBeenCalled();
    expect(deps.setReviewStatus).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });

  it('terminalizes an expired merging row when the injected forge observer proves the merge', async () => {
    const deps = makeDeps({
      loadStatuses: vi.fn(() => ({
        'MIN-898': status('merging', STUCK_MERGING_MS + 1),
      })),
      observeForge: vi.fn(async () => observation({
        complete: true,
        hasPositiveMergedEvidence: true,
        repos: [{ repoKey: 'api', state: 'merged', aheadCount: 1, reason: 'api MR merged' }],
        summary: 'Merge complete across 1 repository',
      }) as any),
    });

    const actions = await reconcileStuckMergingStatesWithDeps(deps);

    expect(deps.setReviewStatus).toHaveBeenCalledWith('MIN-898', {
      mergeStatus: 'merged',
      mergeStep: 'post-merge-cleanup',
      readyForMerge: false,
    });
    expect(deps.enqueuePostMerge).toHaveBeenCalledWith(
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
    'resets an expired unmerged row and derives readyForMerge=%s from the injected gate reader',
    async (gatesPassed) => {
      const stuck = status('merging', STUCK_MERGING_MS + 1);
      const deps = makeDeps({
        loadStatuses: vi.fn(() => ({ 'MIN-898': stuck })),
        reviewGatesPassed: vi.fn(() => gatesPassed),
      });

      const actions = await reconcileStuckMergingStatesWithDeps(deps);

      expect(deps.reviewGatesPassed).toHaveBeenCalledWith({ ...stuck, mergeStatus: 'pending' });
      expect(deps.setReviewStatus).toHaveBeenCalledWith('MIN-898', {
        mergeStatus: 'pending',
        mergeNotes: expect.stringContaining('forge has no completed merge evidence'),
        readyForMerge: gatesPassed,
      });
      expect(actions).toEqual(['Reset stuck merging state for MIN-898 to pending']);
    },
  );

  it('covers verifying rows and fails open through the injected warning sink', async () => {
    const deps = makeDeps({
      loadStatuses: vi.fn(() => ({
        'MIN-898': status('verifying', STUCK_MERGING_MS + 1),
      })),
      observeForge: vi.fn(async () => observation({
        repos: [{
          repoKey: 'api',
          state: 'unverifiable',
          aheadCount: 0,
          reason: 'glab authentication failed',
        }],
        summary: 'glab authentication failed',
      }) as any),
    });

    const actions = await reconcileStuckMergingStatesWithDeps(deps);

    expect(deps.warn).toHaveBeenCalledWith(expect.stringContaining('stuck verifying state is unverifiable'));
    expect(deps.setReviewStatus).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });
});
