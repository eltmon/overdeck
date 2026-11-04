/**
 * `runVerificationForIssue` resolves `skipPlanChecklist` for an adopted PR
 * workspace with no xBRIEF (PAN-4786) before dispatching to the supervisor.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  mockRunSupervisedVerification,
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
  mockRunSupervisedVerification: vi.fn(async () => ({ outcome: 'passed' })),
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

// null, not a fixture project: `findPlan` (via `adopted-plan-checklist.js`,
// not mocked here) resolves plan homes through this same function, and the
// temp workspace tree under test is not a registered project.
vi.mock('../../../../src/lib/projects.js', () => ({
  findProjectByPath: vi.fn(() => null),
  resolveProjectFromIssueSync: vi.fn(() => null),
}));

vi.mock('../../../../src/lib/project-repos.js', () => ({
  resolveWorkspaceRepoRoots: mockResolveWorkspaceRepoRootsSync,
  resolveProjectReposForIssue: vi.fn(() => []),
}));

vi.mock('../../../../src/lib/cloister/test-skip-gate.js', () => ({
  runTestSkipGate: mockRunTestSkipGate,
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
  runSupervisedVerification: mockRunSupervisedVerification,
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

import { runVerificationForIssue, runVerificationForIssueInProcess } from '../../../../src/lib/cloister/verification-runner.js';
import { checkIncompletePlanItems } from '../../../../src/lib/work/done-preflight.js';

let root: string;
let workspacePath: string;

async function writeJournal(lines: Array<Record<string, unknown>>): Promise<void> {
  const journalDir = join(workspacePath, '.overdeck');
  await mkdir(journalDir, { recursive: true });
  const body = lines.map((line) => JSON.stringify(line)).join('\n') + '\n';
  await writeFile(join(journalDir, 'pipeline.jsonl'), body, 'utf-8');
}

function adoptedEntry(): Record<string, unknown> {
  return { at: '2026-11-02T04:21:00.000Z', type: 'workspace.adopted', issueId: 'PAN-9001', source: 'pr-adoption', data: { prNumber: 1 } };
}

async function writeSpec(dir: string): Promise<void> {
  await mkdir(join(dir, '.pan', 'specs'), { recursive: true });
  await writeFile(join(dir, '.pan', 'specs', '2026-11-01-PAN-9001-adopted.xbrief.json'), '{}', 'utf-8');
}

function resolvedOptions() {
  return mockRunSupervisedVerification.mock.calls[0]?.[4];
}

describe('runVerificationForIssue resolves skipPlanChecklist for adopted workspaces (PAN-4786)', () => {
  beforeEach(async () => {
    delete process.env.OVERDECK_VERIFICATION_WORKER;
    vi.clearAllMocks();
    mockRunSupervisedVerification.mockResolvedValue({ outcome: 'passed' });
    mockGetPrFacts.mockResolvedValue({
      issueId: 'PAN-9001', exists: true, open: true, merged: false, closed: false, draft: false,
      approved: true, changesRequested: false, checks: 'green', mergeable: true,
    });
    mockResolveWorkspaceRepoRootsSync.mockReturnValue([]);
    mockRunTestSkipGate.mockResolvedValue({ passed: true, violations: [] });
    mockRunQualityGates.mockResolvedValue([]);
    mockSnapshotHeads.mockResolvedValue('a'.repeat(40));
    mockWriteArtifact.mockReturnValue({ path: '/tmp/verification-latest.json' });

    root = await mkdtemp(join(tmpdir(), 'pan-4786-door-'));
    workspacePath = join(root, 'workspaces', 'feature-pan-9001');
    await mkdir(workspacePath, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('case 1: adopted, no xBRIEF — resolved options carry skipPlanChecklist: true', async () => {
    await writeJournal([adoptedEntry()]);

    const result = await Effect.runPromise(runVerificationForIssue('PAN-9001', workspacePath, { isRemote: false }, 'request-review'));

    expect(result).toEqual({ outcome: 'passed' });
    expect(mockRunSupervisedVerification).toHaveBeenCalledTimes(1);
    expect(resolvedOptions()).toMatchObject({ skipPlanChecklist: true });
  });

  it('case 2: adopted, xBRIEF in the workspace — skipPlanChecklist is not true', async () => {
    await writeJournal([adoptedEntry()]);
    await writeSpec(workspacePath);

    await Effect.runPromise(runVerificationForIssue('PAN-9001', workspacePath, { isRemote: false }, 'request-review'));

    expect(resolvedOptions()?.skipPlanChecklist).not.toBe(true);
  });

  it('case 3: normal workspace (only review.requested) — skipPlanChecklist is not true', async () => {
    await writeJournal([{ at: '2026-11-02T04:22:00.000Z', type: 'review.requested', issueId: 'PAN-9001', source: 'pan-done' }]);

    await Effect.runPromise(runVerificationForIssue('PAN-9001', workspacePath, { isRemote: false }, 'request-review'));

    expect(resolvedOptions()?.skipPlanChecklist).not.toBe(true);
  });

  it('case 4: strike options on a non-adopted workspace pass through unchanged', async () => {
    await writeJournal([{ at: '2026-11-02T04:22:00.000Z', type: 'review.requested', issueId: 'PAN-9001', source: 'pan-done' }]);

    await Effect.runPromise(runVerificationForIssue(
      'PAN-9001',
      workspacePath,
      { isRemote: false },
      'request-review',
      { syncTargetBranch: false, skipPlanChecklist: true },
    ));

    expect(resolvedOptions()).toEqual({ syncTargetBranch: false, skipPlanChecklist: true });
  });
});

describe('the verification worker re-decides the adopted checklist skip (PAN-4810)', () => {
  const noSync = { syncTargetBranch: false } as const;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetPrFacts.mockResolvedValue({
      issueId: 'PAN-9001', exists: true, open: true, merged: false, closed: false, draft: false,
      approved: true, changesRequested: false, checks: 'green', mergeable: true,
    });
    mockResolveWorkspaceRepoRootsSync.mockReturnValue([]);
    mockRunTestSkipGate.mockResolvedValue({ passed: true, violations: [] });
    mockRunQualityGates.mockResolvedValue([]);
    mockSnapshotHeads.mockResolvedValue('a'.repeat(40));
    mockWriteArtifact.mockReturnValue({ path: '/tmp/verification-latest.json' });
    vi.mocked(checkIncompletePlanItems).mockResolvedValue(['  The required xBRIEF checklist is missing or unreadable.']);

    root = await mkdtemp(join(tmpdir(), 'pan-4810-worker-'));
    workspacePath = join(root, 'workspaces', 'feature-pan-9001');
    await mkdir(workspacePath, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('skips the checklist when adoption journaled after dispatch (options carry no skip)', async () => {
    // Dispatched with `{}` — the journal had no adoption yet. Adoption lands before the checklist step.
    await writeJournal([adoptedEntry()]);

    const result = await runVerificationForIssueInProcess('PAN-9001', workspacePath, { isRemote: false }, 'request-review', noSync);

    expect(checkIncompletePlanItems).not.toHaveBeenCalled();
    expect(result).not.toMatchObject({ failedCheck: 'incomplete-plan-items' });
  });

  it('still runs the checklist for a workspace that was never adopted', async () => {
    await writeJournal([{ at: '2026-11-02T04:22:00.000Z', type: 'review.requested', issueId: 'PAN-9001', source: 'pan-done' }]);

    const result = await runVerificationForIssueInProcess('PAN-9001', workspacePath, { isRemote: false }, 'request-review', noSync);

    expect(checkIncompletePlanItems).toHaveBeenCalledWith(workspacePath, 'PAN-9001');
    expect(result).toMatchObject({ outcome: 'failed', failedCheck: 'incomplete-plan-items' });
  });
});
