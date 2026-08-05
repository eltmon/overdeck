import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rehydrateHeadAnchor } from '../../git-utils.js';
import type { ReviewStatus } from '../../review-status.js';

const mocks = vi.hoisted(() => ({
  getReviewStatusSync: vi.fn(),
  evaluateWorkspaceAnchorDrift: vi.fn(),
}));

vi.mock('../../workspace-anchor-drift.js', () => ({
  evaluateWorkspaceAnchorDrift: mocks.evaluateWorkspaceAnchorDrift,
}));

import { shouldPreservePipelineVerdicts } from '../verdict-preservation.js';
import { registerVerdictPreservationStatusReader } from '../work-start-verdicts.js';

const reviewedAnchor = rehydrateHeadAnchor('a'.repeat(40));
const currentAnchor = rehydrateHeadAnchor('b'.repeat(40));

function reviewStatus(overrides: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId: 'PAN-3110',
    reviewStatus: 'passed',
    testStatus: 'passed',
    verificationStatus: 'passed',
    mergeStatus: 'pending',
    readyForMerge: true,
    reviewedAtCommit: reviewedAnchor,
    lastVerifiedCommit: reviewedAnchor,
    updatedAt: '2026-07-26T00:00:00.000Z',
    ...overrides,
  };
}

describe('shouldPreservePipelineVerdicts', () => {
  beforeEach(() => {
    mocks.getReviewStatusSync.mockReset();
    mocks.evaluateWorkspaceAnchorDrift.mockReset();
    mocks.getReviewStatusSync.mockReturnValue(reviewStatus());
    registerVerdictPreservationStatusReader(mocks.getReviewStatusSync);
  });

  it('preserves passed verdicts when the reviewed anchor is current', async () => {
    mocks.evaluateWorkspaceAnchorDrift.mockResolvedValue({
      kind: 'current',
      currentAnchor: reviewedAnchor,
    });

    await expect(shouldPreservePipelineVerdicts('PAN-3110', '/workspace')).resolves.toEqual({
      preserve: true,
      reason: 'workspace HEAD matches the reviewed commit anchor',
    });
    expect(mocks.evaluateWorkspaceAnchorDrift).toHaveBeenCalledWith(
      'PAN-3110',
      '/workspace',
      reviewedAnchor,
    );
  });

  it('preserves skipped review verdicts and refreshes a benign anchor move', async () => {
    mocks.getReviewStatusSync.mockReturnValue(reviewStatus({ reviewStatus: 'skipped' }));
    mocks.evaluateWorkspaceAnchorDrift.mockResolvedValue({
      kind: 'benign',
      currentAnchor,
    });

    await expect(shouldPreservePipelineVerdicts('PAN-3110', '/workspace')).resolves.toEqual({
      preserve: true,
      reason: 'workspace HEAD moved without changing the reviewed code',
      refreshedAnchor: currentAnchor,
    });
  });

  it('resets verdicts when the reviewed code drifted', async () => {
    mocks.evaluateWorkspaceAnchorDrift.mockResolvedValue({
      kind: 'drifted',
      currentAnchor,
    });

    await expect(shouldPreservePipelineVerdicts('PAN-3110', '/workspace')).resolves.toEqual({
      preserve: false,
      reason: 'workspace code changed after review',
    });
  });

  it('resets verdicts when the current anchor is unreadable', async () => {
    mocks.evaluateWorkspaceAnchorDrift.mockResolvedValue({ kind: 'unreadable' });

    await expect(shouldPreservePipelineVerdicts('PAN-3110', '/workspace')).resolves.toEqual({
      preserve: false,
      reason: 'the current workspace commit anchor is unreadable',
    });
  });

  it('resets verdicts without evaluating drift when the review anchor is missing', async () => {
    mocks.getReviewStatusSync.mockReturnValue(reviewStatus({ reviewedAtCommit: undefined }));

    await expect(shouldPreservePipelineVerdicts('PAN-3110', '/workspace')).resolves.toEqual({
      preserve: false,
      reason: 'the review verdict has no commit anchor',
    });
    expect(mocks.evaluateWorkspaceAnchorDrift).not.toHaveBeenCalled();
  });

  it('resets verdicts without evaluating drift when review has not passed', async () => {
    mocks.getReviewStatusSync.mockReturnValue(reviewStatus({ reviewStatus: 'reviewing' }));

    await expect(shouldPreservePipelineVerdicts('PAN-3110', '/workspace')).resolves.toEqual({
      preserve: false,
      reason: 'review is reviewing',
    });
    expect(mocks.evaluateWorkspaceAnchorDrift).not.toHaveBeenCalled();
  });

  it.each([
    ['test', { testStatus: 'failed' as const }, 'tests are failed'],
    ['test', { testStatus: 'pending' as const }, 'tests are pending'],
    ['verification', { verificationStatus: 'failed' as const }, 'verification is failed'],
    ['verification', { verificationStatus: 'pending' as const }, 'verification is pending'],
  ])('resets verdicts without evaluating drift when %s has not passed', async (_gate, statusOverride, reason) => {
    mocks.getReviewStatusSync.mockReturnValue(reviewStatus(statusOverride));

    await expect(shouldPreservePipelineVerdicts('PAN-3110', '/workspace')).resolves.toEqual({
      preserve: false,
      reason,
    });
    expect(mocks.evaluateWorkspaceAnchorDrift).not.toHaveBeenCalled();
  });

  it('fails closed when the preservation check throws', async () => {
    mocks.evaluateWorkspaceAnchorDrift.mockRejectedValue(new Error('git unavailable'));

    await expect(shouldPreservePipelineVerdicts('PAN-3110', '/workspace')).resolves.toEqual({
      preserve: false,
      reason: 'verdict preservation check failed: git unavailable',
    });
  });
});
