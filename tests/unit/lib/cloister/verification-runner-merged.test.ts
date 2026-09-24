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
} = vi.hoisted(() => ({
  mockGetPrFacts: vi.fn(),
  mockEmitActivity: vi.fn(),
  mockPostCheckRun: vi.fn(async () => null),
  mockRunQualityGates: vi.fn(),
  mockWriteFeedbackFile: vi.fn(),
  mockVerificationArtifactPath: vi.fn((workspacePath: string) => `${workspacePath}/.overdeck/verification-latest.json`),
  mockWriteVerificationArtifact: vi.fn(),
  mockRebuildWorkspaceStack: vi.fn(),
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

vi.mock('../../../../src/lib/cloister/validation.js', () => ({
  DEFAULT_GATES: {},
  runQualityGates: async (...args: unknown[]) => mockRunQualityGates(...args),
}));

vi.mock('../../../../src/lib/cloister/verification-artifact.js', () => ({
  readVerificationArtifact: vi.fn(() => null),
  verificationArtifactPath: mockVerificationArtifactPath,
  writeVerificationArtifact: mockWriteVerificationArtifact,
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

import { runVerificationForIssueInProcess } from '../../../../src/lib/cloister/verification-runner.js';

const workspacePath = '/tmp/feature-pan-2901-verification-test';
const workspaceInfo = { isRemote: false };

function prFacts(overrides: Record<string, unknown> = {}) {
  return {
    issueId: 'PAN-2901', exists: true, open: true, merged: false, closed: false, draft: false,
    approved: true, changesRequested: false, checks: 'green', mergeable: true, ...overrides,
  };
}

describe('runVerificationForIssueInProcess merged issue guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunQualityGates.mockReturnValue([]);
    mockGetPrFacts.mockResolvedValue(prFacts());
    mockWriteFeedbackFile.mockResolvedValue({ success: false, error: 'not written' });
    mockRebuildWorkspaceStack.mockReturnValue(Effect.succeed({ success: true }));
    mkdirSync(`${workspacePath}/repo/.git`, { recursive: true });
  });

  afterEach(() => {
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it('skips pre-merge verification when the forge says the PR merged', async () => {
    mockGetPrFacts.mockResolvedValue(prFacts({ merged: true, open: false }));

    const result = await runVerificationForIssueInProcess(
      'PAN-2901',
      workspacePath,
      workspaceInfo,
      'test',
      { syncTargetBranch: false },
    );

    expect(result).toEqual({
      outcome: 'skipped',
      reason: 'The pull request already merged; pre-merge verification no longer applies.',
    });
    expect(mockRunQualityGates).not.toHaveBeenCalled();
  });

  it('waits for an infrastructure-triggered stack rebuild before returning', async () => {
    mockRunQualityGates.mockReturnValue([{
      name: 'frontend-lint',
      passed: false,
      required: true,
      infraUnavailable: true,
      error: 'frontend container is stuck Created',
      output: '',
      durationMs: 10,
    }]);

    let markRebuildStarted!: () => void;
    const rebuildStarted = new Promise<void>((resolve) => { markRebuildStarted = resolve; });
    let finishRebuild!: (result: { success: boolean }) => void;
    const rebuildFinished = new Promise<{ success: boolean }>((resolve) => { finishRebuild = resolve; });
    mockRebuildWorkspaceStack.mockReturnValue(Effect.promise(async () => {
      markRebuildStarted();
      return rebuildFinished;
    }));

    let settled = false;
    const verification = runVerificationForIssueInProcess(
      'PAN-2901',
      workspacePath,
      workspaceInfo,
      'test',
      { syncTargetBranch: false },
    ).finally(() => { settled = true; });

    await rebuildStarted;
    expect(settled).toBe(false);

    finishRebuild({ success: true });
    await expect(verification).resolves.toEqual({
      outcome: 'failed',
      failedCheck: 'frontend-lint',
      cycleCount: 0,
      maxCycles: 3,
    });
  });

  it('points failed-gate feedback at the complete verification artifact', async () => {
    mockRunQualityGates.mockReturnValue([{
      name: 'test',
      passed: false,
      required: true,
      output: `${'passing output\n'.repeat(20_000)}FAIL src/example.test.ts\nAssertionError: expected true to be false`,
      durationMs: 10,
    }]);

    await runVerificationForIssueInProcess(
      'PAN-2901',
      workspacePath,
      workspaceInfo,
      'test',
      { syncTargetBranch: false },
    );

    const fullOutputPath = `${workspacePath}/.overdeck/verification-latest.json`;
    // PAN-3847: terminal writes carry the run timestamp (and head8 when the
    // workspace HEAD resolves — it does not in this fixture, so the write falls
    // back to latest-only and feedback keeps pointing at verification-latest.json).
    expect(mockWriteVerificationArtifact).toHaveBeenCalledWith(
      workspacePath,
      'PAN-2901',
      expect.arrayContaining([expect.objectContaining({ name: 'test', passed: false })]),
      expect.objectContaining({ ranAt: expect.any(String) }),
    );
    // PAN-3917: the failure announcement carries the artifact path; no status row.
    expect(mockEmitActivity).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-2901',
      details: expect.stringContaining(fullOutputPath),
    }));
    expect(mockWriteFeedbackFile).toHaveBeenCalledWith(expect.objectContaining({
      markdownBody: expect.stringContaining(`Read the complete gate output at \`${fullOutputPath}\``),
    }));
  });

  it('discards a failing gate verdict when the issue merges during verification', async () => {
    mockGetPrFacts
      .mockResolvedValueOnce(prFacts())
      .mockResolvedValueOnce(prFacts())
      .mockResolvedValue(prFacts({ merged: true, open: false }));
    mockRunQualityGates.mockReturnValue([{
      name: 'test',
      passed: false,
      required: true,
      output: 'failure after merge',
      durationMs: 10,
    }]);

    const result = await runVerificationForIssueInProcess(
      'PAN-2901',
      workspacePath,
      workspaceInfo,
      'test',
      { syncTargetBranch: false },
    );

    expect(result).toEqual({
      outcome: 'skipped',
      reason: 'The pull request already merged; pre-merge verification no longer applies.',
    });
    expect(mockWriteFeedbackFile).not.toHaveBeenCalled();
  });
});
