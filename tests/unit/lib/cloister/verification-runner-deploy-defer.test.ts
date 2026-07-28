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

const issueId = 'PAN-3244';
const workspacePath = '/tmp/feature-pan-3244';
const workspaceInfo = { isRemote: false };
const queuedDeploy = {
  requestedAt: '2026-07-28T12:00:00.000Z',
  requestedBy: ['deploy-patrol', 'merge-step0'],
  lastReason: 'Deployment deferred because a merge specialist session is active.',
  blockedBy: [],
  deferralCount: 2,
  escalated: false,
};

async function runVerification() {
  return Effect.runPromise(runVerificationForIssueInProcess(
    issueId,
    workspacePath,
    workspaceInfo,
    'test',
    { syncTargetBranch: false, skipPlanChecklist: true },
  ));
}

/**
 * PAN-3244 regression lock: a queued dashboard deploy must NOT defer
 * verification admission. Supervised verification workers are detached and
 * survive dashboard restarts, so deploys and verification are fully
 * decoupled — the old drain gate held every project's pipeline hostage
 * whenever a deploy sat queued behind a busy flywheel run.
 */
describe('verification admission with a queued deploy', () => {
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

  it('admits a fresh verification even while a deploy is queued', async () => {
    mockReadPendingDeploy.mockReturnValue(queuedDeploy);

    const result = await runVerification();

    expect(result.outcome).toBe('error');
    expect(mockSetReviewStatus).toHaveBeenCalledWith(issueId, { verificationStatus: 'running' });
    expect(mockSetReviewStatus).not.toHaveBeenCalledWith(
      issueId,
      expect.objectContaining({ verificationNotes: expect.stringContaining('dashboard deploy is queued') }),
    );
  });

  it('admits normally when no deploy is queued', async () => {
    const result = await runVerification();

    expect(result.outcome).toBe('error');
    expect(mockSetReviewStatus).toHaveBeenCalledWith(issueId, { verificationStatus: 'running' });
  });
});
