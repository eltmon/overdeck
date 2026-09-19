/**
 * The verification runner's gate outputs (PAN-3847 W12/W13, re-pointed PAN-3917).
 *
 * This file used to assert that a passing run cleared a `stuck` flag on the
 * review row and lifted the pause that flag implied. There is no row and no
 * flag any more: a failure is announced on the activity stream and posted as a
 * GitHub check run, and the operator signal is the agent pause itself. What
 * survives is what the gate produces — the immutable per-run artifact path that
 * feedback points at, and the test-skip gate's per-repo aggregation.
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
} = vi.hoisted(() => ({
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
  emitActivityEntrySync: mockEmitActivity,
}));

vi.mock('../../../../src/lib/agents.js', () => ({
  getAgentStateSync: vi.fn(() => null),
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
  findProjectByPathSync: vi.fn(() => ({ name: 'Overdeck', github_repo: 'eltmon/overdeck' })),
  resolveProjectFromIssueSync: vi.fn(() => null),
}));

vi.mock('../../../../src/lib/project-repos.js', () => ({
  resolveWorkspaceRepoRootsSync: mockResolveWorkspaceRepoRootsSync,
  resolveProjectReposForIssueSync: vi.fn(() => []),
}));

vi.mock('../../../../src/lib/cloister/test-skip-gate.js', () => ({
  runTestSkipGate: mockRunTestSkipGate,
}));

vi.mock('../../../../src/lib/cloister/test-skip-waiver.js', () => ({
  resolveActiveTestSkipWaiverSync: vi.fn(() => null),
}));

vi.mock('../../../../src/lib/git-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/git-utils.js')>();
  return { ...actual, snapshotWorkspaceHeadsPromise: mockSnapshotHeads };
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

import { runVerificationForIssueInProcess } from '../../../../src/lib/cloister/verification-runner.js';

const issueId = 'PAN-3847';
const workspacePath = '/tmp/feature-pan-3847';

function run() {
  return Effect.runPromise(runVerificationForIssueInProcess(
    issueId,
    workspacePath,
    { isRemote: false },
    'test',
    { syncTargetBranch: false, skipPlanChecklist: true },
  ));
}

describe('verification runner gate output (PAN-3847, re-pointed PAN-3917)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPrFacts.mockResolvedValue({
      issueId, exists: true, open: true, merged: false, closed: false, draft: false,
      approved: true, changesRequested: false, checks: 'green', mergeable: true,
    });
    mockResolveWorkspaceRepoRootsSync.mockReturnValue([
      { repoKey: 'main', dir: '/tmp/feature-pan-3847', isPolyrepo: false, targetBranch: 'main' },
    ]);
    mockRunTestSkipGate.mockResolvedValue({ passed: true, violations: [] });
    mockRunQualityGates.mockReturnValue(Effect.succeed([
      { name: 'test', passed: true, required: true, durationMs: 1 },
    ]));
    mockSnapshotHeads.mockResolvedValue('a'.repeat(40));
    mockWriteArtifact.mockReturnValue({ path: '/tmp/verification-latest.json' });
  });

  it('a passing run announces nothing and posts a successful check run', async () => {
    const result = await run();

    expect(result.outcome).toBe('passed');
    expect(mockPostCheckRun).toHaveBeenCalledWith(
      expect.objectContaining({ conclusion: 'success' }),
    );
    expect(mockEmitActivity).not.toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' }));
  });

  it('failure feedback references the immutable per-run artifact path (PAN-3847 W13)', async () => {
    mockRunQualityGates.mockReturnValue(Effect.succeed([
      { name: 'test', passed: false, required: true, durationMs: 5, output: 'boom' },
    ]));
    const perRunPath = `${workspacePath}/.overdeck/verification/2026-09-17T01-02-03-000Z-abcd1234.json`;
    mockWriteArtifact.mockReturnValue({ path: perRunPath });

    const result = await run();

    expect(result.outcome).toBe('failed');
    // PAN-3917: the announcement replaces the `verificationNotes` row write and
    // carries the same evidence path.
    expect(mockEmitActivity).toHaveBeenCalledWith(expect.objectContaining({
      issueId,
      level: 'warn',
      details: expect.stringContaining(perRunPath),
    }));
    expect(mockPostCheckRun).toHaveBeenCalledWith(
      expect.objectContaining({ conclusion: 'failure', summary: expect.stringContaining(perRunPath) }),
    );
  });

  it('runs the test-skip gate once per repo root and aggregates violations (PR #3872 finding 6)', async () => {
    mockResolveWorkspaceRepoRootsSync.mockReturnValue([
      { repoKey: 'fe', dir: '/tmp/ws/fe', isPolyrepo: true, targetBranch: 'main' },
      { repoKey: 'api', dir: '/tmp/ws/api', isPolyrepo: true, targetBranch: 'develop' },
    ]);
    mockRunTestSkipGate.mockImplementation(async (dir: string) => (
      dir === '/tmp/ws/api'
        ? { passed: false, violations: [{ file: 'src/bar.test.ts', line: 'it.skip("x", () => {', kind: 'skip' }] }
        : { passed: true, violations: [] }
    ));

    const result = await run();

    expect(mockRunTestSkipGate).toHaveBeenCalledTimes(2);
    // PAN-3906: the third argument carries the operator-waiver decision.
    expect(mockRunTestSkipGate).toHaveBeenCalledWith('/tmp/ws/fe', 'origin/main', { waiveRemovedTests: false });
    expect(mockRunTestSkipGate).toHaveBeenCalledWith('/tmp/ws/api', 'origin/develop', { waiveRemovedTests: false });
    expect(result.outcome).toBe('failed');
    const gateWrites = mockWriteArtifact.mock.calls.map((call) => call[2]).flat();
    const skipGate = gateWrites.find((g: { name?: string }) => g?.name === 'test-skip');
    expect(skipGate).toBeDefined();
    expect(skipGate.output).toContain('api/src/bar.test.ts');
    expect(mockRunQualityGates).not.toHaveBeenCalled();
  });

  it('a diff failure in any repo fails the gate with the diagnostic (PR #3872 finding 4)', async () => {
    mockRunTestSkipGate.mockResolvedValue({
      passed: false,
      violations: [],
      diffUnavailable: true,
      error: 'Could not diff origin/main...HEAD: unknown revision',
    });

    const result = await run();

    expect(result.outcome).toBe('failed');
    const gateWrites = mockWriteArtifact.mock.calls.map((call) => call[2]).flat();
    const skipGate = gateWrites.find((g: { name?: string }) => g?.name === 'test-skip');
    expect(skipGate?.output ?? skipGate?.error).toContain('Could not diff origin/main...HEAD');
    expect(mockRunQualityGates).not.toHaveBeenCalled();
  });
});
