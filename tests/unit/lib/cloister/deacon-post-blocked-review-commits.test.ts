import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  statuses: {} as Record<string, any>,
  evaluateDrift: vi.fn(),
  setReviewStatus: vi.fn(),
  spawnReview: vi.fn(),
  logDeaconEvent: vi.fn(),
  issueClosed: vi.fn(),
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

vi.mock('../../../../src/lib/tmux.js', () => ({
  sessionExists: vi.fn(() => Effect.succeed(false)),
  sessionExistsSync: vi.fn(() => false),
  sendKeysProgram: vi.fn(() => Effect.succeed(undefined)),
  buildTmuxCommandString: vi.fn(),
  capturePane: vi.fn(() => Effect.succeed('')),
  createSession: vi.fn(() => Effect.succeed(undefined)),
  isPaneDead: vi.fn(() => Effect.succeed(false)),
  killSession: vi.fn(() => Effect.succeed(undefined)),
  killSessionSync: vi.fn(),
  listPaneValues: vi.fn(() => Effect.succeed([])),
  listSessionNames: vi.fn(() => Effect.succeed([])),
}));

vi.mock('../../../../src/lib/cloister/specialists.js', () => ({
  getEnabledSpecialists: vi.fn(() => []),
  getTmuxSessionName: vi.fn(),
  isRunning: vi.fn(async () => false),
  initializeSpecialist: vi.fn(),
  spawnEphemeralSpecialist: vi.fn(),
  getAllProjectSpecialistStatuses: vi.fn(async () => []),
}));

vi.mock('../../../../src/lib/agents.js', () => ({
  getAgentRuntimeState: vi.fn(() => null),
  getAgentRuntimeStateSync: vi.fn(() => null),
  saveAgentRuntimeState: vi.fn(),
  saveSessionId: vi.fn(),
  listRunningAgents: vi.fn(() => []),
  listRunningAgentsSync: vi.fn(() => []),
  getAgentDir: vi.fn(() => '/tmp'),
  getAgentState: vi.fn(() => Effect.succeed(null)),
  getAgentStateSync: vi.fn(() => null),
  saveAgentState: vi.fn(),
  saveAgentStateSync: vi.fn(),
  clearAgentTroubledSync: vi.fn(),
}));

vi.mock('../../../../src/lib/cloister/feedback-writer.js', () => ({
  writeFeedbackFile: vi.fn(() => Effect.succeed(undefined)),
}));

vi.mock('../../../../src/lib/cloister/orphan-proposed-reconciler.js', () => ({
  reconcileOrphanProposedSpecs: vi.fn(async () => []),
  spawnWorkAgentThroughAgentsEndpoint: vi.fn(),
}));

vi.mock('../../../../src/lib/cloister/dead-end-trip.js', () => ({
  recordDeadEndNeedsYou: vi.fn(),
}));

describe('checkPostReviewCommits blocked review drift', () => {
  let checkPostReviewCommits: () => Promise<string[]>;

  beforeEach(async () => {
    vi.resetModules();
    for (const issueId of Object.keys(mocks.statuses)) delete mocks.statuses[issueId];
    mocks.evaluateDrift.mockReset();
    mocks.spawnReview.mockReset().mockResolvedValue({ success: true, message: 'spawned' });
    mocks.logDeaconEvent.mockReset();
    mocks.issueClosed.mockReset().mockResolvedValue(false);
    mocks.setReviewStatus.mockReset().mockImplementation(
      (issueId: string, update: Record<string, unknown>) => {
        mocks.statuses[issueId] = { ...mocks.statuses[issueId], ...update };
        return mocks.statuses[issueId];
      },
    );

    ({ checkPostReviewCommits } = await import('../../../../src/lib/cloister/deacon.js'));
  });

  it('debounces a drifted blocked review for one tick, then resets and re-dispatches', async () => {
    mocks.statuses['PAN-3148-A'] = {
      issueId: 'PAN-3148-A',
      reviewStatus: 'blocked',
      reviewedAtCommit: 'old-head',
      reviewNotes: 'keep review notes',
      testStatus: 'failed',
      testNotes: 'keep test notes',
      reviewRetryCount: 3,
      recoveryStartedAt: '2026-07-26T00:00:00.000Z',
      readyForMerge: false,
    };
    mocks.evaluateDrift.mockResolvedValue({ kind: 'drifted', currentAnchor: 'new-head' });

    await expect(checkPostReviewCommits()).resolves.toEqual([]);
    expect(mocks.setReviewStatus).not.toHaveBeenCalled();
    expect(mocks.spawnReview).not.toHaveBeenCalled();

    const actions = await checkPostReviewCommits();

    expect(mocks.setReviewStatus).toHaveBeenCalledWith('PAN-3148-A', {
      reviewStatus: 'pending',
      readyForMerge: false,
      reviewedAtCommit: undefined,
      reviewRetryCount: 0,
      recoveryStartedAt: undefined,
    });
    expect(mocks.statuses['PAN-3148-A']).toMatchObject({
      reviewStatus: 'pending',
      reviewNotes: 'keep review notes',
      testStatus: 'failed',
      testNotes: 'keep test notes',
      reviewRetryCount: 0,
      recoveryStartedAt: undefined,
    });
    expect(mocks.spawnReview).toHaveBeenCalledWith({
      issueId: 'PAN-3148-A',
      workspace: '/project/workspaces/feature-pan-3148-a',
      branch: 'feature/pan-3148-a',
      force: true,
    });
    expect(actions).toEqual([
      'Re-dispatched review for PAN-3148-A: rework commit after BLOCKED verdict (old-head → new-head)',
    ]);
  });

  it('advances the anchor for benign blocked drift without resetting or dispatching', async () => {
    mocks.statuses['PAN-3148-B'] = {
      issueId: 'PAN-3148-B',
      reviewStatus: 'blocked',
      reviewedAtCommit: 'old-head',
    };
    mocks.evaluateDrift.mockResolvedValue({ kind: 'benign', currentAnchor: 'new-head' });

    await expect(checkPostReviewCommits()).resolves.toEqual([]);

    expect(mocks.setReviewStatus).toHaveBeenCalledWith('PAN-3148-B', {
      reviewedAtCommit: 'new-head',
    });
    expect(mocks.statuses['PAN-3148-B'].reviewStatus).toBe('blocked');
    expect(mocks.spawnReview).not.toHaveBeenCalled();
  });

  it('derives a missing blocked anchor only when every reviewer verdict agrees', async () => {
    mocks.statuses['PAN-3148-C'] = {
      issueId: 'PAN-3148-C',
      reviewStatus: 'blocked',
      reviewerVerdicts: {
        security: { status: 'passed', atCommit: 'reviewed-head' },
        correctness: { status: 'blocked', atCommit: 'reviewed-head' },
      },
    };
    mocks.evaluateDrift.mockResolvedValue({ kind: 'drifted', currentAnchor: 'new-head' });

    await checkPostReviewCommits();
    await checkPostReviewCommits();

    expect(mocks.evaluateDrift).toHaveBeenCalledWith(
      'PAN-3148-C',
      '/project/workspaces/feature-pan-3148-c',
      'reviewed-head',
    );
    expect(mocks.spawnReview).toHaveBeenCalledOnce();

    mocks.spawnReview.mockClear();
    mocks.evaluateDrift.mockClear();
    mocks.statuses['PAN-3148-D'] = {
      issueId: 'PAN-3148-D',
      reviewStatus: 'blocked',
      reviewerVerdicts: {
        security: { status: 'passed', atCommit: 'head-one' },
        correctness: { status: 'blocked', atCommit: 'head-two' },
      },
    };

    await expect(checkPostReviewCommits()).resolves.toEqual([]);
    expect(mocks.evaluateDrift).not.toHaveBeenCalled();
    expect(mocks.spawnReview).not.toHaveBeenCalled();
    expect(mocks.logDeaconEvent).toHaveBeenCalledWith(
      'checkPostReviewCommits: PAN-3148-D blocked without anchor — cannot detect drift',
    );
  });

  it('clears the debounce when review status changes before the second tick', async () => {
    mocks.statuses['PAN-3148-E'] = {
      issueId: 'PAN-3148-E',
      reviewStatus: 'blocked',
      reviewedAtCommit: 'old-head',
    };
    mocks.evaluateDrift.mockResolvedValue({ kind: 'drifted', currentAnchor: 'new-head' });

    await checkPostReviewCommits();
    mocks.statuses['PAN-3148-E'].reviewStatus = 'reviewing';
    await checkPostReviewCommits();
    mocks.statuses['PAN-3148-E'].reviewStatus = 'blocked';
    await checkPostReviewCommits();

    expect(mocks.spawnReview).not.toHaveBeenCalled();

    await checkPostReviewCommits();
    expect(mocks.spawnReview).toHaveBeenCalledOnce();
  });
});
