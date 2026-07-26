import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetReviewStatus,
  mockReadPendingDeploy,
  mockSetReviewStatus,
} = vi.hoisted(() => ({
  mockGetReviewStatus: vi.fn(),
  mockReadPendingDeploy: vi.fn(),
  mockSetReviewStatus: vi.fn(),
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: mockGetReviewStatus,
  markWorkspaceStuck: vi.fn(),
  setReviewStatusSync: mockSetReviewStatus,
}));

vi.mock('../../../../src/lib/deploy/deploy-queue.js', () => ({
  readPendingDeploy: mockReadPendingDeploy,
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  findProjectByPathSync: vi.fn(() => {
    throw new Error('stop after admission');
  }),
  resolveProjectFromIssueSync: vi.fn(() => null),
}));

vi.mock('../../../../src/lib/cloister/validation.js', () => ({
  DEFAULT_GATES: {},
  runQualityGates: vi.fn(),
}));

vi.mock('../../../../src/lib/cloister/verification-artifact.js', () => ({
  readVerificationArtifact: vi.fn(() => null),
  writeVerificationArtifact: vi.fn(),
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

import { runVerificationForIssueInProcess } from '../../../../src/lib/cloister/verification-runner.js';

const issueId = 'PAN-3135';
const workspacePath = '/tmp/feature-pan-3135';
const workspaceInfo = { isRemote: false };
const queuedDeploy = {
  requestedAt: '2026-07-26T12:00:00.000Z',
  requestedBy: ['agent-a', 'agent-z'],
  lastReason: 'Verification is running',
  blockedBy: ['PAN-10'],
  deferralCount: 2,
  escalated: false,
};
const deferralReason = 'Verification deferred: a dashboard deploy is queued (requested 2026-07-26T12:00:00.000Z by agent-a, agent-z). It re-runs automatically after the deploy.';

async function runVerification() {
  return Effect.runPromise(runVerificationForIssueInProcess(
    issueId,
    workspacePath,
    workspaceInfo,
    'test',
    { syncTargetBranch: false, skipPlanChecklist: true },
  ));
}

describe('verification deploy queue admission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadPendingDeploy.mockReturnValue(null);
    mockGetReviewStatus.mockReturnValue({
      issueId,
      mergeStatus: 'pending',
      verificationStatus: 'pending',
      verificationCycleCount: 0,
    });
  });

  it('defers a fresh verification admission while a deploy is queued', async () => {
    mockReadPendingDeploy.mockReturnValue(queuedDeploy);

    await expect(runVerification()).resolves.toEqual({
      outcome: 'deferred',
      reason: deferralReason,
    });
    expect(mockSetReviewStatus).toHaveBeenCalledTimes(1);
    expect(mockSetReviewStatus).toHaveBeenCalledWith(issueId, {
      verificationStatus: 'pending',
      verificationNotes: deferralReason,
    });
    expect(mockSetReviewStatus).not.toHaveBeenCalledWith(
      issueId,
      expect.objectContaining({ verificationStatus: 'running' }),
    );
  });

  it('does not self-defer an in-flight verification', async () => {
    mockReadPendingDeploy.mockReturnValue(queuedDeploy);
    mockGetReviewStatus.mockReturnValue({
      issueId,
      mergeStatus: 'pending',
      verificationStatus: 'running',
      verificationCycleCount: 0,
    });

    const result = await runVerification();

    expect(result.outcome).toBe('error');
    expect(mockSetReviewStatus).toHaveBeenCalledWith(issueId, { verificationStatus: 'running' });
    expect(mockSetReviewStatus).not.toHaveBeenCalledWith(
      issueId,
      expect.objectContaining({ verificationNotes: deferralReason }),
    );
  });

  it('preserves normal admission when no deploy is queued', async () => {
    const result = await runVerification();

    expect(result.outcome).toBe('error');
    expect(mockSetReviewStatus).toHaveBeenCalledWith(issueId, { verificationStatus: 'running' });
    expect(mockSetReviewStatus).not.toHaveBeenCalledWith(
      issueId,
      expect.objectContaining({ verificationNotes: expect.stringContaining('dashboard deploy is queued') }),
    );
  });
});
