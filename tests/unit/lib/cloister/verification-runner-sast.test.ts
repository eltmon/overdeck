/**
 * PAN-4590: the Semgrep `sast` gate's place in the verification runner. An
 * advisory or skipped result never fails the run; a blocking failure fails it
 * with failedCheck `sast`; the gate runs only after every other gate passed.
 */
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetPrFacts,
  mockEmitActivity,
  mockPostCheckRun,
  mockRunQualityGates,
  mockWriteArtifact,
  mockSnapshotHeads,
  mockCaptureStage,
  mockResolveWorkspaceRepoRootsSync,
  mockRunTestSkipGate,
  mockRunSast,
} = vi.hoisted(() => ({
  mockRunSast: vi.fn(),
  mockGetPrFacts: vi.fn(),
  mockEmitActivity: vi.fn(),
  mockPostCheckRun: vi.fn(async () => null),
  mockResolveWorkspaceRepoRootsSync: vi.fn(),
  mockRunTestSkipGate: vi.fn(),
  mockRunQualityGates: vi.fn(),
  mockWriteArtifact: vi.fn(),
  mockSnapshotHeads: vi.fn(),
  mockCaptureStage: vi.fn(),
}));

vi.mock('../../../../src/lib/cloister/pr-facts.js', () => ({
  getPrFacts: mockGetPrFacts,
}));

vi.mock('../../../../src/lib/cloister/verification-check-run.js', () => ({
  VERIFICATION_CHECK_RUN_NAME: 'overdeck/verification',
  postVerificationCheckRun: mockPostCheckRun,
}));

vi.mock('../../../../src/lib/activity-logger.js', () => ({
  emitActivityEntry: mockEmitActivity,
}));

vi.mock('../../../../src/lib/agents.js', () => ({
  getAgentState: vi.fn(() => null),
  clearAgentPaused: vi.fn(() => Effect.succeed(null)),
  setAgentPaused: vi.fn(() => Effect.succeed(null)),
  messageAgent: vi.fn(),
  stopAgent: vi.fn(() => Effect.succeed(null)),
}));

vi.mock('../../../../src/lib/cloister/validation.js', () => ({
  DEFAULT_GATES: {},
  runQualityGates: mockRunQualityGates,
}));

vi.mock('../../../../src/lib/cloister/verification-artifact.js', () => ({
  readVerificationArtifact: vi.fn(() => null),
  writeVerificationArtifact: mockWriteArtifact,
  verificationArtifactPath: vi.fn(() => '/tmp/verification-latest.json'),
  markRunningVerificationArtifactSkipped: vi.fn(() => null),
}));

vi.mock('../../../../src/lib/cloister/feedback-writer.js', () => ({
  writeFeedbackFile: vi.fn(async () => ({ success: false, error: 'not written' })),
}));

vi.mock('../../../../src/lib/xbrief/acceptance-criteria.js', () => ({
  getXBriefACStatus: vi.fn(() => null),
}));

vi.mock('../../../../src/lib/work/done-preflight.js', () => ({
  checkIncompletePlanItems: vi.fn(async () => []),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  findProjectByPath: vi.fn(() => ({ name: 'Overdeck', github_repo: 'eltmon/overdeck', verification: { tests: 'local', sast: 'blocking' } })),
  resolveProjectFromIssueSync: vi.fn(() => null),
}));

vi.mock('../../../../src/lib/project-repos.js', () => ({
  resolveWorkspaceRepoRoots: mockResolveWorkspaceRepoRootsSync,
  resolveProjectReposForIssue: vi.fn(() => []),
}));

vi.mock('../../../../src/lib/cloister/test-skip-gate.js', () => ({
  runTestSkipGate: mockRunTestSkipGate,
}));

vi.mock('../../../../src/lib/cloister/sast-run.js', () => ({
  runSastGate: mockRunSast,
}));

vi.mock('../../../../src/lib/cloister/plan-integrity-run.js', () => ({
  evaluatePlanIntegrityGate: vi.fn(async () => ({ failed: false, evidence: '' })),
}));

vi.mock('../../../../src/lib/cloister/test-skip-waiver.js', () => ({
  resolveActiveTestSkipWaiver: vi.fn(() => null),
}));

vi.mock('../../../../src/lib/git-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/git-utils.js')>();
  return { ...actual, snapshotWorkspaceHeads: mockSnapshotHeads };
});

vi.mock('../../../../src/lib/telemetry/pipeline.js', () => ({
  capturePipelineStageForIssue: mockCaptureStage,
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
    stdout: cmd.includes('git diff') ? 'src/foo.ts\n' : (cmd.includes('rev-parse') ? 'c'.repeat(40) : ''),
    stderr: '',
  });
  return { ...actual, exec: execMock };
});

const { mockSyncToPrHead, mockSyncSingleRepo } = vi.hoisted(() => ({
  mockSyncToPrHead: vi.fn(async (): Promise<unknown[]> => []),
  mockSyncSingleRepo: vi.fn(),
}));

vi.mock('../../../../src/lib/cloister/workspace-pr-head-sync.js', () => ({
  syncWorkspaceRootsToPrHead: mockSyncToPrHead,
  syncSingleRepo: mockSyncSingleRepo,
}));

import { runVerificationForIssueInProcess } from '../../../../src/lib/cloister/verification-runner.js';

const issueId = 'PAN-4590';
const workspacePath = '/tmp/feature-pan-4590';

function run() {
  return runVerificationForIssueInProcess(
    issueId,
    workspacePath,
    { isRemote: false },
    'test',
    { syncTargetBranch: false, skipPlanChecklist: true },
  );
}

const finding = 'src/app.py:3 [ERROR] rule.shell';

describe('verification runner sast gate (PAN-4590)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPrFacts.mockResolvedValue({
      issueId, exists: true, open: true, merged: false, closed: false, draft: false,
      approved: true, changesRequested: false, checks: 'green', mergeable: true,
    });
    mockResolveWorkspaceRepoRootsSync.mockReturnValue([
      { repoKey: 'main', dir: workspacePath, isPolyrepo: false, targetBranch: 'main' },
    ]);
    mockRunTestSkipGate.mockResolvedValue({ passed: true, violations: [] });
    mockRunQualityGates.mockResolvedValue([{ name: 'lint', passed: true, required: true, durationMs: 1 }]);
    mockSnapshotHeads.mockResolvedValue('a'.repeat(40));
    mockWriteArtifact.mockReturnValue({ path: '/tmp/verification-latest.json' });
    mockRunSast.mockResolvedValue(null);
  });

  const finalGates = () => mockWriteArtifact.mock.calls.at(-1)?.[2] as Array<{ name: string }>;

  it('passes the project override to the gate', async () => {
    await run();
    expect(mockRunSast).toHaveBeenCalledWith(expect.objectContaining({
      issueId, workspacePath, projectOverride: 'blocking',
    }));
  });

  it('adds no sast row when the gate is off', async () => {
    expect((await run()).outcome).toBe('passed');
    expect(finalGates().map((g) => g.name)).toEqual(['lint']);
  });

  it('an advisory finding is recorded but the run passes', async () => {
    mockRunSast.mockResolvedValue({ name: 'sast', passed: false, required: false, durationMs: 2, output: finding });
    expect((await run()).outcome).toBe('passed');
    expect(finalGates()).toEqual([
      expect.objectContaining({ name: 'lint' }),
      expect.objectContaining({ name: 'sast', passed: false, required: false, output: finding }),
    ]);
  });

  it('a skipped scan is recorded and the run passes', async () => {
    mockRunSast.mockResolvedValue({ name: 'sast', passed: true, required: false, skipped: true, durationMs: 0, output: 'SKIPPED', error: 'Semgrep did not run: binary missing' });
    expect((await run()).outcome).toBe('passed');
    expect(finalGates().at(-1)).toMatchObject({ name: 'sast', skipped: true });
  });

  it('a blocking finding fails verification at sast', async () => {
    mockRunSast.mockResolvedValue({ name: 'sast', passed: false, required: true, durationMs: 2, output: finding });
    expect(await run()).toMatchObject({ outcome: 'failed', failedCheck: 'sast' });
  });

  it('does not scan when another gate already failed', async () => {
    mockRunQualityGates.mockResolvedValue([{ name: 'lint', passed: false, required: true, durationMs: 1, output: 'lint error' }]);
    expect(await run()).toMatchObject({ outcome: 'failed', failedCheck: 'lint' });
    expect(mockRunSast).not.toHaveBeenCalled();
  });
});
