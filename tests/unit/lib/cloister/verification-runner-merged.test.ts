import { mkdirSync, rmSync } from 'node:fs';

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetReviewStatus,
  mockMarkWorkspaceStuck,
  mockSetReviewStatus,
  mockRunQualityGates,
  mockWriteFeedbackFile,
  mockWriteVerificationArtifact,
  mockRebuildWorkspaceStack,
} = vi.hoisted(() => ({
  mockGetReviewStatus: vi.fn(),
  mockMarkWorkspaceStuck: vi.fn(),
  mockSetReviewStatus: vi.fn(),
  mockRunQualityGates: vi.fn(),
  mockWriteFeedbackFile: vi.fn(),
  mockWriteVerificationArtifact: vi.fn(),
  mockRebuildWorkspaceStack: vi.fn(),
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: mockGetReviewStatus,
  markWorkspaceStuck: mockMarkWorkspaceStuck,
  setReviewStatusSync: mockSetReviewStatus,
}));

vi.mock('../../../../src/lib/cloister/validation.js', () => ({
  DEFAULT_GATES: {},
  runQualityGates: (...args: unknown[]) => Effect.sync(() => mockRunQualityGates(...args)),
}));

vi.mock('../../../../src/lib/cloister/verification-artifact.js', () => ({
  readVerificationArtifact: vi.fn(() => null),
  writeVerificationArtifact: mockWriteVerificationArtifact,
}));

vi.mock('../../../../src/lib/workspace/rebuild-stack.js', () => ({
  rebuildWorkspaceStack: mockRebuildWorkspaceStack,
}));

vi.mock('../../../../src/lib/cloister/feedback-writer.js', () => ({
  writeFeedbackFile: mockWriteFeedbackFile,
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  findProjectByPathSync: vi.fn(() => ({
    name: 'Overdeck',
    path: '/tmp/overdeck',
    workspace: { type: 'polyrepo', default_branch: 'main' },
    quality_gates: { test: { command: 'npm test' } },
  })),
  resolveProjectFromIssueSync: vi.fn(() => null),
}));

vi.mock('../../../../src/lib/xbrief/acceptance-criteria.js', () => ({
  getXBriefACStatusSync: vi.fn(() => null),
}));

vi.mock('../../../../src/lib/work/done-preflight.js', () => ({
  checkIncompletePlanItemsPromise: vi.fn(async () => []),
}));

import { runVerificationForIssueInProcess } from '../../../../src/lib/cloister/verification-runner.js';

const workspacePath = '/tmp/feature-pan-2901-verification-test';
const workspaceInfo = { isRemote: false };

describe('runVerificationForIssueInProcess merged issue guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunQualityGates.mockReturnValue([]);
    mockWriteFeedbackFile.mockReturnValue(Effect.succeed({ success: false, error: 'not written' }));
    mockRebuildWorkspaceStack.mockReturnValue(Effect.succeed({ success: true }));
    mkdirSync(`${workspacePath}/repo/.git`, { recursive: true });
  });

  afterEach(() => {
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it('skips pre-merge verification when merge status is already terminal', async () => {
    mockGetReviewStatus.mockReturnValue({
      issueId: 'PAN-2901',
      reviewStatus: 'passed',
      testStatus: 'passed',
      mergeStatus: 'merged',
      verificationStatus: 'pending',
    });

    const result = await Effect.runPromise(runVerificationForIssueInProcess(
      'PAN-2901',
      workspacePath,
      workspaceInfo,
      'test',
      { syncTargetBranch: false },
    ));

    expect(result).toEqual({
      outcome: 'skipped',
      reason: 'Merge already landed; verify-on-main owns post-merge validation.',
    });
    expect(mockRunQualityGates).not.toHaveBeenCalled();
    expect(mockSetReviewStatus).toHaveBeenCalledTimes(1);
    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-2901', {
      verificationStatus: 'skipped',
      verificationNotes: 'Merge already landed; verify-on-main owns post-merge validation.',
    });
  });

  it('waits for an infrastructure-triggered stack rebuild before returning', async () => {
    mockGetReviewStatus.mockReturnValue({
      issueId: 'PAN-2901',
      reviewStatus: 'passed',
      testStatus: 'pending',
      mergeStatus: 'pending',
      verificationStatus: 'pending',
    });
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
    const verification = Effect.runPromise(runVerificationForIssueInProcess(
      'PAN-2901',
      workspacePath,
      workspaceInfo,
      'test',
      { syncTargetBranch: false },
    )).finally(() => { settled = true; });

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

  it('discards a failing gate verdict when the issue merges during verification', async () => {
    mockGetReviewStatus
      .mockReturnValueOnce({
        issueId: 'PAN-2901',
        reviewStatus: 'passed',
        testStatus: 'passed',
        mergeStatus: 'pending',
        verificationStatus: 'pending',
      })
      .mockReturnValueOnce({
        issueId: 'PAN-2901',
        reviewStatus: 'passed',
        testStatus: 'passed',
        mergeStatus: 'pending',
        verificationStatus: 'running',
      })
      .mockReturnValue({
        issueId: 'PAN-2901',
        reviewStatus: 'passed',
        testStatus: 'passed',
        mergeStatus: 'merged',
        verificationStatus: 'running',
      });
    mockRunQualityGates.mockReturnValue([{
      name: 'test',
      passed: false,
      required: true,
      output: 'failure after merge',
      durationMs: 10,
    }]);

    const result = await Effect.runPromise(runVerificationForIssueInProcess(
      'PAN-2901',
      workspacePath,
      workspaceInfo,
      'test',
      { syncTargetBranch: false },
    ));

    expect(result).toEqual({
      outcome: 'skipped',
      reason: 'Merge already landed; verify-on-main owns post-merge validation.',
    });
    expect(mockSetReviewStatus).not.toHaveBeenCalledWith(
      'PAN-2901',
      expect.objectContaining({ reviewStatus: 'pending', verificationStatus: 'failed' }),
    );
    expect(mockSetReviewStatus).toHaveBeenLastCalledWith('PAN-2901', {
      verificationStatus: 'skipped',
      verificationNotes: 'Merge already landed; verify-on-main owns post-merge validation.',
    });
    expect(mockMarkWorkspaceStuck).not.toHaveBeenCalled();
    expect(mockWriteFeedbackFile).not.toHaveBeenCalled();
  });
});
