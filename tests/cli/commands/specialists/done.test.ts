import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSetReviewStatus } = vi.hoisted(() => ({
  mockSetReviewStatus: vi.fn(),
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  setReviewStatus: mockSetReviewStatus,
  getReviewStatus: vi.fn(),
}));

describe('specialists done command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mockSetReviewStatus.mockReturnValue({
      issueId: 'PAN-1059',
      reviewStatus: 'blocked',
      testStatus: 'pending',
      updatedAt: new Date().toISOString(),
      readyForMerge: false,
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
  });
});
