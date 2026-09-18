/**
 * PAN-3847 W10 — post-review drift marks a passed review stale instead of
 * resetting it; blocked re-dispatch keeps working but never with force: true.
 */
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  statuses: {} as Record<string, any>,
  evaluateDrift: vi.fn(),
  setReviewStatus: vi.fn(),
  spawnReview: vi.fn(),
  logDeaconEvent: vi.fn(),
  issueClosed: vi.fn(),
  recordDeadEnd: vi.fn(),
}));

vi.mock('../../../../src/lib/workspace-anchor-drift.js', () => ({
  evaluateWorkspaceAnchorDrift: (...args: unknown[]) => mocks.evaluateDrift(...args),
}));

vi.mock('../../../../src/lib/cloister/issue-closed.js', () => ({
  isIssueClosed: (...args: unknown[]) => mocks.issueClosed(...args),
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: (issueId: string) => mocks.statuses[issueId],
  setReviewStatus: (issueId: string, update: Record<string, unknown>) =>
    mocks.setReviewStatus(issueId, update),
  setReviewStatusSync: (issueId: string, update: Record<string, unknown>) =>
    mocks.setReviewStatus(issueId, update),
  loadReviewStatuses: () => mocks.statuses,
  MAX_AUTO_REQUEUE: 25,

  // PAN-3903: the pipeline read door's bulk read; falls back to the cache map.
  getReviewStatusesSync: () => ({}),
}));

vi.mock('../../../../src/lib/cloister/review-agent.js', () => ({
  spawnReviewRoleForIssue: (...args: unknown[]) => Effect.promise(
    () => Promise.resolve(mocks.spawnReview(...args)),
  ),
}));

vi.mock('../../../../src/lib/cloister/concurrency.js', () => ({
  resetPatrolDispatchBudget: vi.fn(),
  tryReserveAdvancingSlot: () => true,
  releaseAdvancingSlot: vi.fn(),
  tryReserveSwarmSlot: () => true,
  releaseSwarmSlot: vi.fn(),
  describeRunningAgents: () => 'none',
  getConcurrencyLimits: () => ({ maxWorkAgents: 6, reservedAdvancingSlots: 3, totalCeiling: 9 }),
  countRunningAgents: () => ({ work: 0, advancing: 0, total: 0 }),
  workResumeSlotsAvailable: () => 6,
}));

vi.mock('../../../../src/lib/cloister/preemption.js', () => ({
  tryYieldForAdvancingDispatch: vi.fn(async () => false),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: vi.fn(() => ({ projectPath: '/project' })),
  resolveProjectFromIssueSync: vi.fn(() => ({ projectPath: '/project' })),
  findProjectByPath: vi.fn(() => null),
  findProjectByPathSync: vi.fn(() => null),
  listProjectsSync: vi.fn(() => []),
  getProjectSync: vi.fn(() => null),
}));

vi.mock('../../../../src/lib/persistent-logger.js', () => ({
  logDeaconEvent: vi.fn(),
  logDeaconEventSync: (...args: unknown[]) => mocks.logDeaconEvent(...args),
  logAgentLifecycle: vi.fn(),
  logAgentLifecycleSync: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('fs')>()),
  existsSync: vi.fn(() => true),
}));

vi.mock('../../../../src/lib/cloister/dead-end-trip.js', () => ({
  recordDeadEndNeedsYou: (...args: unknown[]) => mocks.recordDeadEnd(...args),
}));

describe('checkPostReviewCommits — stale marking (PAN-3847)', () => {
  let checkPostReviewCommits: () => Promise<string[]>;

  beforeEach(async () => {
    vi.resetModules();
    for (const issueId of Object.keys(mocks.statuses)) delete mocks.statuses[issueId];
    mocks.evaluateDrift.mockReset();
    mocks.spawnReview.mockReset().mockResolvedValue({ success: true, message: 'spawned' });
    mocks.logDeaconEvent.mockReset();
    mocks.issueClosed.mockReset().mockResolvedValue(false);
    mocks.recordDeadEnd.mockReset();
    mocks.setReviewStatus.mockReset().mockImplementation(
      (issueId: string, update: Record<string, unknown>) => {
        mocks.statuses[issueId] = { ...mocks.statuses[issueId], ...update };
        return mocks.statuses[issueId];
      },
    );

    ({ checkPostReviewCommits } = await import('../../../../src/lib/cloister/deacon.js'));
  });

  it('passed review + moved head: row gets reviewStaleSince, readyForMerge false, verdict kept, no re-dispatch', async () => {
    mocks.statuses['PAN-3847-A'] = {
      issueId: 'PAN-3847-A',
      reviewStatus: 'passed',
      testStatus: 'passed',
      reviewedAtCommit: 'old-head',
      readyForMerge: true,
    };
    mocks.evaluateDrift.mockResolvedValue({ kind: 'drifted', currentAnchor: 'new-head' });

    const actions = await checkPostReviewCommits();

    const write = mocks.setReviewStatus.mock.calls.find((call) => call[0] === 'PAN-3847-A');
    expect(write).toBeDefined();
    expect(write![1]).toMatchObject({
      readyForMerge: false,
    });
    expect(typeof write![1].reviewStaleSince).toBe('string');
    // The verdict and its anchor are NOT cleared — no reset.
    expect(write![1]).not.toHaveProperty('reviewStatus');
    expect(write![1]).not.toHaveProperty('reviewedAtCommit');
    expect(mocks.statuses['PAN-3847-A'].reviewStatus).toBe('passed');
    expect(mocks.statuses['PAN-3847-A'].reviewedAtCommit).toBe('old-head');
    expect(mocks.spawnReview).not.toHaveBeenCalled();
    expect(actions.some((a) => a.includes('Marked review stale for PAN-3847-A'))).toBe(true);
    expect(actions.some((a) => a.includes('Reset review'))).toBe(false);
  });

  it('an already-stale passed row is left untouched on later patrols', async () => {
    mocks.statuses['PAN-3847-B'] = {
      issueId: 'PAN-3847-B',
      reviewStatus: 'passed',
      testStatus: 'passed',
      reviewedAtCommit: 'old-head',
      reviewStaleSince: '2026-09-17T00:00:00.000Z',
      readyForMerge: false,
    };
    mocks.evaluateDrift.mockResolvedValue({ kind: 'drifted', currentAnchor: 'new-head' });

    const actions = await checkPostReviewCommits();

    expect(actions).toEqual([]);
    expect(mocks.setReviewStatus).not.toHaveBeenCalled();
    expect(mocks.spawnReview).not.toHaveBeenCalled();
    expect(mocks.recordDeadEnd).not.toHaveBeenCalled();
  });

  it('blocked review + moved head: re-dispatches with force: false', async () => {
    mocks.statuses['PAN-3847-C'] = {
      issueId: 'PAN-3847-C',
      reviewStatus: 'blocked',
      reviewedAtCommit: 'old-head',
      readyForMerge: false,
    };
    mocks.evaluateDrift.mockResolvedValue({ kind: 'drifted', currentAnchor: 'new-head' });

    await checkPostReviewCommits(); // debounce tick
    const actions = await checkPostReviewCommits();

    expect(mocks.spawnReview).toHaveBeenCalledTimes(1);
    expect(mocks.spawnReview).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: 'PAN-3847-C', force: false }),
    );
    expect(actions.some((a) => a.includes('Re-dispatched review for PAN-3847-C'))).toBe(true);
  });
});
