/**
 * PAN-3847 W12 — a verification pass clears a verification_stuck row flag and
 * lifts the pause that escalateVerificationStuck set on the work agent.
 */
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetReviewStatus,
  mockSetReviewStatus,
  mockClearWorkspaceStuck,
  mockGetAgentStateSync,
  mockSetAgentPaused,
  mockRunQualityGates,
  mockWriteArtifact,
  mockSnapshotHeads,
  mockCaptureStage,
} = vi.hoisted(() => ({
  mockGetReviewStatus: vi.fn(),
  mockSetReviewStatus: vi.fn(),
  mockClearWorkspaceStuck: vi.fn(),
  mockGetAgentStateSync: vi.fn(),
  mockSetAgentPaused: vi.fn(),
  mockRunQualityGates: vi.fn(),
  mockWriteArtifact: vi.fn(),
  mockSnapshotHeads: vi.fn(),
  mockCaptureStage: vi.fn(),
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: mockGetReviewStatus,
  markWorkspaceStuck: vi.fn(),
  setReviewStatusSync: mockSetReviewStatus,
}));

vi.mock('../../../../src/lib/overdeck/review-status-sync.js', () => ({
  clearWorkspaceStuck: mockClearWorkspaceStuck,
}));

vi.mock('../../../../src/lib/agents.js', () => ({
  getAgentStateSync: mockGetAgentStateSync,
  setAgentPaused: mockSetAgentPaused,
  messageAgent: vi.fn(),
  stopAgent: vi.fn(),
}));

vi.mock('../../../../src/lib/cloister/validation.js', () => ({
  DEFAULT_GATES: {},
  runQualityGates: mockRunQualityGates,
}));

vi.mock('../../../../src/lib/cloister/verification-artifact.js', () => ({
  readVerificationArtifact: vi.fn(() => null),
  writeVerificationArtifact: mockWriteArtifact,
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

vi.mock('../../../../src/lib/projects.js', () => ({
  findProjectByPathSync: vi.fn(() => null),
  resolveProjectFromIssueSync: vi.fn(() => null),
}));

vi.mock('../../../../src/lib/project-repos.js', () => ({
  resolveWorkspaceRepoRootsSync: vi.fn(() => [
    { repoKey: 'main', dir: '/tmp/feature-pan-3847', isPolyrepo: false, targetBranch: 'main' },
  ]),
}));

vi.mock('../../../../src/lib/git-utils.js', () => ({
  snapshotWorkspaceHeadsPromise: mockSnapshotHeads,
}));

vi.mock('../../../../src/lib/telemetry/pipeline.js', () => ({
  capturePipelineStageForIssue: mockCaptureStage,
}));

vi.mock('../../../../src/lib/deploy/deploy-queue.js', () => ({
  readPendingDeploy: vi.fn(() => null),
}));

vi.mock('../../../../src/lib/cloister/verification-worker-supervisor.js', () => ({
  isVerificationWorkerActive: vi.fn(() => false),
  markVerificationWorkerAdmissionPhase: vi.fn(),
  runSupervisedVerification: vi.fn(),
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const execMock = () => {
    throw new Error('exec without promisify.custom should not be called');
  };
  (execMock as any)[Symbol.for('nodejs.util.promisify.custom')] = async (cmd: string) => ({
    stdout: cmd.includes('git diff') ? 'src/foo.ts\n' : '',
    stderr: '',
  });
  return { ...actual, exec: execMock };
});

import { runVerificationForIssueInProcess } from '../../../../src/lib/cloister/verification-runner.js';

const issueId = 'PAN-3847';
const workspacePath = '/tmp/feature-pan-3847';

function stuckRow() {
  return {
    issueId,
    reviewStatus: 'pending',
    testStatus: 'pending',
    mergeStatus: 'pending',
    verificationStatus: 'pending',
    verificationCycleCount: 0,
    stuck: true,
    stuckReason: 'verification_stuck',
    updatedAt: '2026-09-17T00:00:00.000Z',
  };
}

describe('verification pass clears verification_stuck (PAN-3847)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetReviewStatus.mockReturnValue(stuckRow());
    mockSetReviewStatus.mockImplementation((_id: string, update: Record<string, unknown>) => ({
      ...stuckRow(),
      ...update,
    }));
    mockRunQualityGates.mockReturnValue(Effect.succeed([
      { name: 'test', passed: true, required: true, durationMs: 1 },
    ]));
    mockSnapshotHeads.mockResolvedValue('a'.repeat(40));
    mockGetAgentStateSync.mockReturnValue({
      id: 'agent-pan-3847',
      pausedReason: 'needs-you: verification stuck after 3/3 attempts (test)',
    });
    mockSetAgentPaused.mockReturnValue(Effect.succeed(null));
  });

  it('clears the stuck flag and lifts the verification-stuck pause on pass', async () => {
    const result = await Effect.runPromise(runVerificationForIssueInProcess(
      issueId,
      workspacePath,
      { isRemote: false },
      'test',
      { syncTargetBranch: false, skipPlanChecklist: true },
    ));

    expect(result.outcome).toBe('passed');
    expect(mockSetReviewStatus).toHaveBeenCalledWith(issueId, expect.objectContaining({
      verificationStatus: 'passed',
      lastVerifiedCommit: 'a'.repeat(40),
    }));
    expect(mockClearWorkspaceStuck).toHaveBeenCalledWith(issueId);
    expect(mockSetAgentPaused).toHaveBeenCalledWith('agent-pan-3847', undefined, false);
  });

  it('leaves an unrelated pause alone on pass', async () => {
    mockGetAgentStateSync.mockReturnValue({
      id: 'agent-pan-3847',
      pausedReason: 'operator: paused by hand',
    });

    const result = await Effect.runPromise(runVerificationForIssueInProcess(
      issueId,
      workspacePath,
      { isRemote: false },
      'test',
      { syncTargetBranch: false, skipPlanChecklist: true },
    ));

    expect(result.outcome).toBe('passed');
    expect(mockClearWorkspaceStuck).toHaveBeenCalledWith(issueId);
    expect(mockSetAgentPaused).not.toHaveBeenCalled();
  });

  it('failure feedback references the immutable per-run artifact path (PAN-3847 W13)', async () => {
    mockRunQualityGates.mockReturnValue(Effect.succeed([
      { name: 'test', passed: false, required: true, durationMs: 5, output: 'boom' },
    ]));
    const perRunPath = `${workspacePath}/.overdeck/verification/2026-09-17T01-02-03-000Z-abcd1234.json`;
    mockWriteArtifact.mockReturnValue({ path: perRunPath });

    const result = await Effect.runPromise(runVerificationForIssueInProcess(
      issueId,
      workspacePath,
      { isRemote: false },
      'test',
      { syncTargetBranch: false, skipPlanChecklist: true },
    ));

    expect(result.outcome).toBe('failed');
    expect(mockSetReviewStatus).toHaveBeenCalledWith(issueId, expect.objectContaining({
      verificationStatus: 'failed',
      verificationNotes: expect.stringContaining('.overdeck/verification/'),
    }));
    expect(mockSetReviewStatus).toHaveBeenCalledWith(issueId, expect.objectContaining({
      verificationNotes: expect.stringContaining(perRunPath),
    }));
  });
});
