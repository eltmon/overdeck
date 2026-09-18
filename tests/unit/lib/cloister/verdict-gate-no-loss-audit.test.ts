/**
 * PAN-3847 W21 — no-loss audit for verdicts and gates.
 *
 * This file is the deletion gate for W20 (patrols #35
 * reconcileTestStatusFromGreenCi and #41 checkVerificationReviewContradiction):
 * every state those patrols repaired must be unreachable through the new
 * synchronous writes, proven here against a real overdeck.db row and the real
 * review-status / verdict-door / deacon / runner code paths.
 *
 * Fixtures replay the corpus shapes from the reliability review:
 *   (a) reviewedAtCommit === lastVerifiedCommit + passed review → test role
 *       dispatched (review.approved), never auto-passed.
 *   (b) passed review whose anchor differs from HEAD → stale marking, no
 *       reset, readyForMerge false.
 *   (c) a verdict with no evidence head from each caller-site writer →
 *       refusal, no row write.
 *   (d) stuck: verification_stuck + a verification pass → cleared.
 */
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../helpers/overdeck-test-db.js';

// ── Shared mock surface ──────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  notifyPipelineSync: vi.fn(),
  emitActivityEntrySync: vi.fn(),
  updateIssueRecordForIssue: vi.fn(),
  capturePipelineStageForIssue: vi.fn(),
  evaluateDrift: vi.fn(),
  issueClosed: vi.fn(),
  spawnReview: vi.fn(),
  recordDeadEnd: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
  existsSync: vi.fn(),
  snapshotWorkspaceHeadsPromise: vi.fn(),
  getCloisterEventStore: vi.fn(),
  getAgentStateSync: vi.fn(),
  clearAgentPaused: vi.fn(),
  setAgentPaused: vi.fn(),
  runQualityGates: vi.fn(),
  writeVerificationArtifact: vi.fn(),
  deliverReviewVerdictFeedback: vi.fn(),
  exec: vi.fn(),
}));

vi.mock('../../../../src/lib/pipeline-notifier.js', () => ({
  notifyPipeline: vi.fn(),
  notifyPipelineSync: mocks.notifyPipelineSync,
}));

vi.mock('../../../../src/lib/activity-logger.js', () => ({
  emitActivityEntry: vi.fn(),
  emitActivityEntrySync: mocks.emitActivityEntrySync,
  emitActivityTts: vi.fn(),
  emitActivityTtsSync: vi.fn(),
}));

vi.mock('../../../../src/lib/pan-dir/records.js', () => ({
  updateIssueRecordForIssue: mocks.updateIssueRecordForIssue,
}));

vi.mock('../../../../src/lib/telemetry/pipeline.js', () => ({
  capturePipelineStageForIssue: mocks.capturePipelineStageForIssue,
}));

vi.mock('../../../../src/lib/overdeck/review-status-record-sync.js', () => ({
  updateIssueRecordForReviewStatusSync: vi.fn(),
  enrichReviewNotesFromRecordSync: (_issueId: string, status: unknown) => status,
  readJournalStatusSync: vi.fn(() => null),
  flushReviewStatusJournalWrites: vi.fn(async () => undefined),
  readWorkspaceVerdictFallbackSync: vi.fn(() => null),
  workspaceVerdictFallbackPath: vi.fn(() => null),
  clearWorkspaceStuck: vi.fn(),
}));

vi.mock('../../../../src/lib/workspace-anchor-drift.js', () => ({
  evaluateWorkspaceAnchorDrift: (...args: unknown[]) => mocks.evaluateDrift(...args),
}));

vi.mock('../../../../src/lib/cloister/issue-closed.js', () => ({
  isIssueClosed: (...args: unknown[]) => mocks.issueClosed(...args),
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
  resolveProjectFromIssue: mocks.resolveProjectFromIssueSync,
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
  findProjectByPath: vi.fn(() => null),
  findProjectByPathSync: vi.fn(() => null),
  listProjectsSync: vi.fn(() => []),
  getProjectSync: vi.fn(() => null),
}));

vi.mock('../../../../src/lib/persistent-logger.js', () => ({
  logDeaconEvent: vi.fn(),
  logDeaconEventSync: vi.fn(),
  logAgentLifecycle: vi.fn(),
  logAgentLifecycleSync: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('fs')>()),
  existsSync: mocks.existsSync,
}));

vi.mock('../../../../src/lib/cloister/dead-end-trip.js', () => ({
  recordDeadEndNeedsYou: (...args: unknown[]) => mocks.recordDeadEnd(...args),
}));

vi.mock('../../../../src/lib/cloister/event-store-provider.js', () => ({
  getCloisterEventStore: mocks.getCloisterEventStore,
}));

vi.mock('../../../../src/lib/git-utils.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/git-utils.js')>()),
  snapshotWorkspaceHeadsPromise: mocks.snapshotWorkspaceHeadsPromise,
}));

vi.mock('../../../../src/lib/agents.js', () => ({
  clearAgentPaused: mocks.clearAgentPaused,
  getAgentStateSync: mocks.getAgentStateSync,
  getAgentRuntimeState: vi.fn(() => null),
  getAgentRuntimeStateSync: vi.fn(() => null),
  listRunningAgents: vi.fn(() => []),
  listRunningAgentsSync: vi.fn(() => []),
  setAgentPaused: mocks.setAgentPaused,
  messageAgent: vi.fn(),
  stopAgent: vi.fn(),
}));

vi.mock('../../../../src/lib/cloister/test-skip-gate.js', () => ({
  runTestSkipGate: vi.fn(async () => ({ passed: true, violations: [] })),
}));

vi.mock('../../../../src/lib/cloister/validation.js', () => ({
  DEFAULT_GATES: {},
  runQualityGates: mocks.runQualityGates,
}));

vi.mock('../../../../src/lib/cloister/verification-artifact.js', () => ({
  readVerificationArtifact: vi.fn(() => null),
  writeVerificationArtifact: mocks.writeVerificationArtifact,
  verificationArtifactPath: vi.fn(() => '/tmp/verification-latest.json'),
}));

vi.mock('../../../../src/lib/cloister/feedback-writer.js', () => ({
  writeFeedbackFile: vi.fn(() => Effect.succeed({ success: false, error: 'not written' })),
}));

vi.mock('../../../../src/lib/xbrief/acceptance-criteria.js', () => ({
  getXBriefACStatusSync: vi.fn(() => null),
}));

vi.mock('../../../../src/lib/work/done-preflight.js', () => ({
  checkIncompletePlanItemsPromise: vi.fn(async () => []),
}));

vi.mock('../../../../src/lib/project-repos.js', () => ({
  resolveWorkspaceRepoRootsSync: vi.fn(() => [
    { repoKey: 'main', dir: '/project/workspaces/feature-pan-3847', isPolyrepo: false, targetBranch: 'main' },
  ]),
}));

vi.mock('../../../../src/lib/deploy/deploy-queue.js', () => ({
  readPendingDeploy: vi.fn(() => null),
}));

vi.mock('../../../../src/lib/cloister/verification-worker-supervisor.js', () => ({
  isVerificationWorkerActive: vi.fn(() => false),
  markVerificationWorkerAdmissionPhase: vi.fn(),
  runSupervisedVerification: vi.fn(),
}));

vi.mock('../../../../src/lib/cloister/review-verdict-feedback.js', () => ({
  deliverReviewVerdictFeedback: mocks.deliverReviewVerdictFeedback,
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const exec = mocks.exec;
  Object.assign(exec, {
    [Symbol.for('nodejs.util.promisify.custom')]: (command: string, options: unknown) =>
      Promise.resolve(mocks.exec(command, options)),
  });
  return { ...actual, exec };
});

// ── Units under test (real modules, real overdeck.db row) ────────────────────

import {
  getReviewStatusSync,
  setReviewStatusSync,
} from '../../../../src/lib/review-status.js';
import { checkPostReviewCommits } from '../../../../src/lib/cloister/deacon.js';
import { recordReviewVerdict, type VerdictWriter } from '../../../../src/lib/cloister/review-verdict-writer.js';
import { runVerificationForIssueInProcess } from '../../../../src/lib/cloister/verification-runner.js';
import { doneCommand } from '../../../../src/cli/commands/specialists/done.js';

let odb: OverdeckTestDb | undefined;

describe('verdict-and-gate no-loss audit (PAN-3847 W21)', () => {
  beforeEach(() => {
    odb = setupOverdeckTestDb();
    vi.clearAllMocks();
    mocks.resolveProjectFromIssueSync.mockReturnValue({ projectPath: '/project' });
    mocks.existsSync.mockReturnValue(true);
    mocks.issueClosed.mockResolvedValue(false);
    mocks.spawnReview.mockResolvedValue({ success: true, message: 'spawned' });
    mocks.getCloisterEventStore.mockReturnValue(null);
    mocks.snapshotWorkspaceHeadsPromise.mockResolvedValue('c'.repeat(40));
    mocks.getAgentStateSync.mockReturnValue(null);
    mocks.setAgentPaused.mockReturnValue(Effect.succeed(null));
    mocks.clearAgentPaused.mockReturnValue(Effect.succeed(null));
    mocks.deliverReviewVerdictFeedback.mockReturnValue(Effect.succeed({
      feedbackPath: undefined,
      synthesisPath: undefined,
      prCommentPosted: false,
    }));
    mocks.exec.mockImplementation((command: string) => ({
      stdout: String(command).includes('git diff') ? 'src/foo.ts\n' : '',
      stderr: '',
    }));
    mocks.runQualityGates.mockReturnValue(Effect.succeed([
      { name: 'test', passed: true, required: true, durationMs: 1 },
    ]));
  });

  afterEach(() => {
    teardownOverdeckTestDb(odb);
    odb = undefined;
  });

  it('(a) equal anchors + passed review: the test role is dispatched, never auto-passed', () => {
    const head = 'abc123abc123abc123abc123abc123abc123abcd';
    setReviewStatusSync('PAN-3847', {
      reviewStatus: 'pending',
      testStatus: 'pending',
      verificationStatus: 'running',
      reviewedAtCommit: head,
      lastVerifiedCommit: head,
    });

    setReviewStatusSync('PAN-3847', { reviewStatus: 'passed' });

    const row = getReviewStatusSync('PAN-3847');
    expect(row?.testStatus).toBe('pending');
    expect(mocks.notifyPipelineSync).toHaveBeenCalledWith({ type: 'review.approved', issueId: 'PAN-3847' });
    expect(mocks.notifyPipelineSync).not.toHaveBeenCalledWith({ type: 'test.passed', issueId: 'PAN-3847' });
  });

  it('(b) passed review + moved head: stale marking, no reset, readyForMerge false', async () => {
    setReviewStatusSync('PAN-3847', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      readyForMerge: true,
      reviewedAtCommit: 'old-head',
    });
    mocks.evaluateDrift.mockResolvedValue({ kind: 'drifted', currentAnchor: 'new-head' });

    const actions = await checkPostReviewCommits();

    expect(actions.some((a) => a.includes('Marked review stale for PAN-3847'))).toBe(true);
    expect(mocks.spawnReview).not.toHaveBeenCalled();
    const row = getReviewStatusSync('PAN-3847');
    expect(row?.reviewStatus).toBe('passed');
    expect(row?.reviewedAtCommit).toBe('old-head');
    expect(row?.reviewStaleSince).toBeTruthy();
    expect(row?.readyForMerge).toBe(false);
  });

  it.each<[VerdictWriter]>([
    ['coordinator'],
    ['quick-signal'],
    ['fallback'],
    ['orphan-restore'],
    ['unsignaled-recovery'],
    ['infra-bypass'],
  ])('(c) a %s verdict with no evidence head is refused and writes nothing', async (writer) => {
    setReviewStatusSync('PAN-3847', {
      reviewStatus: 'reviewing',
      testStatus: 'pending',
      lastVerifiedCommit: 'a'.repeat(40),
    });
    const before = getReviewStatusSync('PAN-3847');

    const outcome = await recordReviewVerdict('PAN-3847', { verdict: 'passed', notes: 'n', writer });

    expect(outcome).toEqual({ landed: false, reason: 'no-evidence-head' });
    const after = getReviewStatusSync('PAN-3847');
    expect(after?.reviewStatus).toBe(before?.reviewStatus);
    expect(after?.reviewedAtCommit).toBe(before?.reviewedAtCommit);
  });

  it('(d) stuck: verification_stuck + a verification pass clears the flag and the pause', async () => {
    setReviewStatusSync('PAN-3847', {
      reviewStatus: 'pending',
      testStatus: 'pending',
      verificationStatus: 'pending',
      stuck: true,
      stuckReason: 'verification_stuck',
    });
    mocks.getAgentStateSync.mockReturnValue({
      id: 'agent-pan-3847',
      pausedReason: 'needs-you: verification stuck after 3/3 attempts (test)',
    });

    const result = await Effect.runPromise(runVerificationForIssueInProcess(
      'PAN-3847',
      '/project/workspaces/feature-pan-3847',
      { isRemote: false },
      'audit',
      { syncTargetBranch: false, skipPlanChecklist: true },
    ));

    expect(result.outcome).toBe('passed');
    const row = getReviewStatusSync('PAN-3847');
    expect(row?.verificationStatus).toBe('passed');
    expect(row?.stuck).toBeFalsy();
    expect(mocks.clearAgentPaused).toHaveBeenCalledWith('agent-pan-3847');
  });

  it('(2a) green CI alone cannot set testStatus passed — only a test verdict can', () => {
    // The deleted patrol #35 promoted pending → passed from a green CI run. The
    // only writers left are the verdict doors: prove a non-verdict row write
    // (here: a merge-lifecycle field) never promotes testStatus.
    setReviewStatusSync('PAN-3847', {
      reviewStatus: 'passed',
      testStatus: 'pending',
      verificationStatus: 'passed',
    });

    setReviewStatusSync('PAN-3847', { mergeNotes: 'CI is green on the PR head' });

    expect(getReviewStatusSync('PAN-3847')?.testStatus).toBe('pending');

    // …and the test specialist's verdict is what promotes it.
    setReviewStatusSync('PAN-3847', { testStatus: 'passed' });
    expect(getReviewStatusSync('PAN-3847')?.testStatus).toBe('passed');
  });

  it('(2b) a passed review via the review command never writes verificationStatus', async () => {
    setReviewStatusSync('PAN-3847', {
      reviewStatus: 'pending',
      testStatus: 'pending',
      verificationStatus: 'failed',
      lastVerifiedCommit: 'c'.repeat(40),
    });

    await doneCommand('review', 'pan-3847', { status: 'passed', notes: 'approved' });

    const row = getReviewStatusSync('PAN-3847');
    expect(row?.reviewStatus).toBe('passed');
    // The contradiction patrol #41 existed to repair can no longer be created:
    // verification stays failed until the verification gate itself passes.
    expect(row?.verificationStatus).toBe('failed');
    expect(row?.verificationNotes ?? '').not.toContain('PAN-1215');
  });

  it('(2c) the deleted patrols #35 and #41 are gone from the runtime module surface', async () => {
    const deacon = await import('../../../../src/lib/cloister/deacon.js');
    expect('checkVerificationReviewContradiction' in deacon).toBe(false);
    expect('reconcileTestStatusFromGreenCi' in deacon).toBe(false);
    await expect(import('../../../../src/lib/cloister/test-status-green-ci-reconciler.js')).rejects.toThrow();
  });

});
