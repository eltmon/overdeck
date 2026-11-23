import { mkdirSync, rmSync } from 'node:fs';

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetPrFacts,
  mockEmitActivity,
  mockPostCheckRun,
  mockRunQualityGates,
  mockWriteFeedbackFile,
  mockVerificationArtifactPath,
  mockWriteVerificationArtifact,
  mockRebuildWorkspaceStack,
  mockMarkRunningSkipped,
  mockRestoreReclaimedStack,
  mockReadCycleState,
} = vi.hoisted(() => ({
  mockGetPrFacts: vi.fn(),
  mockEmitActivity: vi.fn(),
  mockPostCheckRun: vi.fn(async () => null),
  mockRunQualityGates: vi.fn(),
  mockWriteFeedbackFile: vi.fn(),
  mockVerificationArtifactPath: vi.fn((workspacePath: string) => `${workspacePath}/.overdeck/verification-latest.json`),
  mockWriteVerificationArtifact: vi.fn(),
  mockRebuildWorkspaceStack: vi.fn(),
  mockMarkRunningSkipped: vi.fn(() => null),
  mockRestoreReclaimedStack: vi.fn(),
  mockReadCycleState: vi.fn(),
}));

// PAN-5623: the restore door, observed in call order against the journal and the gates.
vi.mock('../../../../src/lib/workspace/stack-restore.js', () => ({
  restoreReclaimedStack: mockRestoreReclaimedStack,
}));

vi.mock('../../../../src/lib/cloister/verification-cycles.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/cloister/verification-cycles.js')>()),
  readVerificationCycleState: (...args: unknown[]) => mockReadCycleState(...args),
}));

// PAN-3917: the forge answers "has this merged?", not a stored merge status.
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

vi.mock('../../../../src/lib/cloister/test-skip-gate.js', () => ({
  runTestSkipGate: vi.fn(async () => ({ passed: true, violations: [] })),
}));

vi.mock('../../../../src/lib/cloister/plan-integrity-run.js', () => ({
  evaluatePlanIntegrityGate: vi.fn(async () => ({ failed: false, evidence: '' })),
}));

vi.mock('../../../../src/lib/cloister/validation.js', () => ({
  DEFAULT_GATES: {},
  runQualityGates: async (...args: unknown[]) => mockRunQualityGates(...args),
}));

vi.mock('../../../../src/lib/cloister/verification-artifact.js', () => ({
  readVerificationArtifact: vi.fn(() => null),
  verificationArtifactPath: mockVerificationArtifactPath,
  writeVerificationArtifact: mockWriteVerificationArtifact,
  markRunningVerificationArtifactSkipped: mockMarkRunningSkipped,
}));

vi.mock('../../../../src/lib/workspace/rebuild-stack.js', () => ({
  rebuildWorkspaceStack: mockRebuildWorkspaceStack,
}));

vi.mock('../../../../src/lib/cloister/feedback-writer.js', () => ({
  writeFeedbackFile: mockWriteFeedbackFile,
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  findProjectByPath: vi.fn(() => ({
    name: 'Overdeck',
    path: '/tmp/overdeck',
    workspace: { type: 'polyrepo', default_branch: 'main' },
    quality_gates: { test: { command: 'npm test' } },
  })),
  resolveProjectFromIssueSync: vi.fn(() => null),
}));

vi.mock('../../../../src/lib/xbrief/acceptance-criteria.js', () => ({
  getXBriefACStatus: vi.fn(() => null),
}));

vi.mock('../../../../src/lib/work/done-preflight.js', () => ({
  checkIncompletePlanItems: vi.fn(async () => []),
}));

import { readPipelineJournal } from '../../../../src/lib/cloister/pipeline-journal.js';
import { runVerificationForIssueInProcess } from '../../../../src/lib/cloister/verification-runner.js';

/**
 * PAN-5623 WI-7: a verification run starts a stack a memory reclaim stopped,
 * right after `verification.started` is journaled and before the first gate.
 */
const workspacePath = '/tmp/feature-pan-5623-verification-restore-test';
const workspaceInfo = { isRemote: false };

function prFacts(overrides: Record<string, unknown> = {}) {
  return {
    issueId: 'PAN-5623', exists: true, open: true, merged: false, closed: false, draft: false,
    approved: true, changesRequested: false, checks: 'green', mergeable: true, ...overrides,
  };
}

function run() {
  return runVerificationForIssueInProcess('PAN-5623', workspacePath, workspaceInfo, 'test', { syncTargetBranch: false });
}

describe('runVerificationForIssueInProcess restores a reclaimed stack (PAN-5623)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPrFacts.mockResolvedValue(prFacts());
    mockWriteFeedbackFile.mockResolvedValue({ success: false, error: 'not written' });
    mockRebuildWorkspaceStack.mockReturnValue(Effect.succeed({ success: true }));
    mockReadCycleState.mockReturnValue({ cycleCount: 0 });
    mockRestoreReclaimedStack.mockResolvedValue({ kind: 'none' });
    mockRunQualityGates.mockReturnValue([{ name: 'test', passed: false, required: true, output: 'FAIL', durationMs: 10 }]);
    mkdirSync(`${workspacePath}/repo/.git`, { recursive: true });
  });

  afterEach(() => {
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it('restores once with trigger verification, after verification.started and before the first gate', async () => {
    let journalAtRestore: string[] = [];
    mockRestoreReclaimedStack.mockImplementation(async () => {
      journalAtRestore = readPipelineJournal(workspacePath).map((entry) => entry.type);
      return { kind: 'none' };
    });

    await run();

    expect(mockRestoreReclaimedStack).toHaveBeenCalledExactlyOnceWith({
      issueId: 'PAN-5623', workspacePath, trigger: 'verification',
    });
    expect(journalAtRestore.at(-1)).toBe('verification.started');
    expect(mockRestoreReclaimedStack.mock.invocationCallOrder[0])
      .toBeLessThan(mockRunQualityGates.mock.invocationCallOrder[0]!);
  });

  it('a failed restore does not change the run outcome', async () => {
    const baseline = await run();
    rmSync(workspacePath, { recursive: true, force: true });
    mkdirSync(`${workspacePath}/repo/.git`, { recursive: true });
    mockRestoreReclaimedStack.mockResolvedValue({ kind: 'failed', failed: ['x-api-1'], error: 'port is already allocated' });

    await expect(run()).resolves.toEqual(baseline);
    expect(baseline).toMatchObject({ outcome: 'failed', failedCheck: 'test' });
  });

  it('a run skipped by the circuit breaker never restores', async () => {
    mockReadCycleState.mockReturnValue({ cycleCount: 99 });

    await expect(run()).resolves.toMatchObject({ outcome: 'skipped' });
    expect(mockRestoreReclaimedStack).not.toHaveBeenCalled();
  });
});
