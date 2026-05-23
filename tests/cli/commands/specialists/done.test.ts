import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verificationSatisfied } from '../../../../src/lib/review-status.js';

const { mockSetReviewStatus, mockDeliverReviewVerdictFeedback } = vi.hoisted(() => ({
  mockSetReviewStatus: vi.fn(),
  mockDeliverReviewVerdictFeedback: vi.fn(),
}));

vi.mock('../../../../src/lib/review-status.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/review-status.js')>();
  return {
    ...actual,
    setReviewStatus: mockSetReviewStatus,
    setReviewStatusSync: mockSetReviewStatus,
    getReviewStatus: vi.fn(),
    getReviewStatusSync: vi.fn(),
  };
});

vi.mock('../../../../src/lib/cloister/review-verdict-feedback.js', () => ({
  deliverReviewVerdictFeedback: mockDeliverReviewVerdictFeedback,
}));

describe('specialists done command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mockSetReviewStatus.mockImplementation((_issueId: string, update: Record<string, unknown>) => {
      return {
        issueId: 'PAN-1059',
        reviewStatus: 'blocked',
        testStatus: 'pending',
        updatedAt: new Date().toISOString(),
        readyForMerge: false,
        prUrl: 'https://github.com/eltmon/panopticon-cli/pull/1059',
        ...update,
      };
    });
    mockDeliverReviewVerdictFeedback.mockResolvedValue({
      feedbackPath: '/workspace/.pan/feedback/001-review-agent-changes-requested.md',
      prCommentPosted: true,
      agentMessageSent: true,
    });
  });

  it('allows review to signal blocked status', async () => {
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('review', 'pan-1059', {
      status: 'blocked',
      notes: 'correctness blocker',
    });

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-1059', {
      reviewStatus: 'blocked',
      reviewNotes: 'correctness blocker',
    });
    expect(mockDeliverReviewVerdictFeedback).toHaveBeenCalledWith({
      issueId: 'PAN-1059',
      verdict: 'blocked',
      notes: 'correctness blocker',
      prUrl: 'https://github.com/eltmon/panopticon-cli/pull/1059',
    });
  });

  it('delivers synthesis feedback when review signals failed status', async () => {
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('review', 'pan-1059', {
      status: 'failed',
      notes: 'synthesis crashed',
    });

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-1059', {
      reviewStatus: 'failed',
      reviewNotes: 'synthesis crashed',
    });
    expect(mockDeliverReviewVerdictFeedback).toHaveBeenCalledWith({
      issueId: 'PAN-1059',
      verdict: 'failed',
      notes: 'synthesis crashed',
      prUrl: 'https://github.com/eltmon/panopticon-cli/pull/1059',
    });
  });

  it('does not deliver feedback when review passes', async () => {
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('review', 'pan-1059', {
      status: 'passed',
      notes: 'approved',
    });

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-1059', {
      reviewStatus: 'passed',
      reviewNotes: 'approved',
      reviewedAtCommit: undefined,
      verificationStatus: 'passed',
      verificationNotes: 'Cleared by `pan specialists done review --status passed` override (PAN-1215)',
    });
    expect(mockDeliverReviewVerdictFeedback).not.toHaveBeenCalled();
  });

  it('verificationSatisfied is true after passed override even from failed state (AC10/AC27)', () => {
    expect(verificationSatisfied({ verificationStatus: 'failed' })).toBe(false);
    expect(verificationSatisfied({ verificationStatus: 'passed' })).toBe(true);
    expect(verificationSatisfied({ verificationStatus: 'pending' })).toBe(true);
  });
});
