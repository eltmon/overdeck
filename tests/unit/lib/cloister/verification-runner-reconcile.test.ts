import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockReadReviewStatusMap,
  mockSetReviewStatus,
  mockIsVerificationWorkerActive,
} = vi.hoisted(() => ({
  mockReadReviewStatusMap: vi.fn(),
  mockSetReviewStatus: vi.fn(),
  mockIsVerificationWorkerActive: vi.fn(() => false),
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: vi.fn(() => null),
  markWorkspaceStuck: vi.fn(),
  setReviewStatusSync: mockSetReviewStatus,
}));

vi.mock('../../../../src/lib/cloister/review-status-source.js', () => ({
  readReviewStatusMap: mockReadReviewStatusMap,
}));

vi.mock('../../../../src/lib/cloister/verification-worker-supervisor.js', () => ({
  isVerificationWorkerActive: mockIsVerificationWorkerActive,
  markVerificationWorkerAdmissionPhase: vi.fn(),
  runSupervisedVerification: vi.fn(),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  findProjectByPathSync: vi.fn(() => null),
  resolveProjectFromIssueSync: vi.fn(() => null),
}));

import { reconcileInterruptedVerifications } from '../../../../src/lib/cloister/verification-runner.js';

describe('reconcileInterruptedVerifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsVerificationWorkerActive.mockReturnValue(false);
  });

  // PAN-3339: verification is dispatched only from inside the review pipeline, and
  // that pipeline never runs again after merge — so a `pending` verdict left behind
  // by the merge has no owner and DoD row 3 blocks close-out forever.
  it('settles a pending verification on a merged issue', () => {
    mockReadReviewStatusMap.mockReturnValue({
      'PAN-3296': { issueId: 'PAN-3296', mergeStatus: 'merged', verificationStatus: 'pending' },
    });

    const reset = reconcileInterruptedVerifications('test');

    expect(reset).toBe(0);
    expect(mockSetReviewStatus).toHaveBeenCalledExactlyOnceWith('PAN-3296', {
      verificationStatus: 'skipped',
      verificationNotes: 'Merge already landed; verify-on-main owns post-merge validation.',
    });
  });

  it('leaves a pending verification alone while the issue can still be dispatched', () => {
    mockReadReviewStatusMap.mockReturnValue({
      'PAN-3296': { issueId: 'PAN-3296', mergeStatus: 'pending', verificationStatus: 'pending' },
    });

    expect(reconcileInterruptedVerifications('test')).toBe(0);
    expect(mockSetReviewStatus).not.toHaveBeenCalled();
  });

  it('still resets an orphaned running verification to pending', () => {
    mockReadReviewStatusMap.mockReturnValue({
      'PAN-3296': { issueId: 'PAN-3296', mergeStatus: 'pending', verificationStatus: 'running' },
    });

    expect(reconcileInterruptedVerifications('test')).toBe(1);
    expect(mockSetReviewStatus).toHaveBeenCalledExactlyOnceWith('PAN-3296', {
      verificationStatus: 'pending',
      verificationNotes: expect.stringContaining('verification re-runs on the next cycle'),
    });
  });

  it('preserves a running verification owned by a live supervised worker', () => {
    mockReadReviewStatusMap.mockReturnValue({
      'PAN-3296': { issueId: 'PAN-3296', mergeStatus: 'pending', verificationStatus: 'running' },
    });
    mockIsVerificationWorkerActive.mockReturnValue(true);

    expect(reconcileInterruptedVerifications('test')).toBe(0);
    expect(mockSetReviewStatus).not.toHaveBeenCalled();
  });
});
