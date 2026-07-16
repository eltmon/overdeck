import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveProjectFromIssueSync: vi.fn(),
  getReviewStatusSync: vi.fn(),
  writeFeedbackFile: vi.fn(),
  messageAgent: vi.fn(),
  resolveIssueFeedbackTarget: vi.fn(),
  markWorkspaceStuck: vi.fn(),
}));

vi.mock('../../projects.js', () => ({
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
}));

vi.mock('../../review-status.js', () => ({
  getReviewStatusSync: mocks.getReviewStatusSync,
  markWorkspaceStuck: mocks.markWorkspaceStuck,
}));

vi.mock('../feedback-writer.js', () => ({
  writeFeedbackFile: mocks.writeFeedbackFile,
}));

vi.mock('../feedback-target.js', () => ({
  resolveIssueFeedbackTarget: mocks.resolveIssueFeedbackTarget,
  surfaceIssueFeedbackNeedsYou: (issueId: string, reason: string, details: Record<string, unknown> = {}) => {
    mocks.markWorkspaceStuck(issueId, 'feedback_delivery_needs_you', {
      reason,
      ...details,
    });
  },
}));

vi.mock('../../agents.js', () => ({
  messageAgent: mocks.messageAgent,
}));

import { deliverReviewVerdictFeedback } from '../review-verdict-feedback.js';

describe('deliverReviewVerdictFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveProjectFromIssueSync.mockReturnValue(null);
    mocks.getReviewStatusSync.mockReturnValue(undefined);
    mocks.writeFeedbackFile.mockReturnValue(Effect.succeed({
      success: true,
      relativePath: '.pan/feedback/001-review-agent-blocked.md',
      filePath: '/tmp/overdeck/workspaces/feature-pan-1917/.pan/feedback/001-review-agent-blocked.md',
    }));
    mocks.resolveIssueFeedbackTarget.mockReturnValue({
      needsYou: true,
      reason: 'No live feedback target for PAN-1917',
    });
    mocks.markWorkspaceStuck.mockImplementation(() => {
      throw new Error('SQLITE_READONLY: attempt to write a readonly database');
    });
    mocks.messageAgent.mockResolvedValue(undefined);
  });

  it('swallows a readonly DB failure when marking review feedback as needing human attention', async () => {
    const result = await Effect.runPromise(deliverReviewVerdictFeedback({
      issueId: 'PAN-1917',
      verdict: 'blocked',
      notes: 'Blocked by missing dependency',
      workspacePath: '/tmp/overdeck/workspaces/feature-pan-1917',
    }));

    expect(result).toEqual(expect.objectContaining({
      feedbackPath: '/tmp/overdeck/workspaces/feature-pan-1917/.pan/feedback/001-review-agent-blocked.md',
      agentMessageSent: false,
    }));
    expect(mocks.markWorkspaceStuck).toHaveBeenCalledWith('PAN-1917', 'feedback_delivery_needs_you', expect.objectContaining({
      reason: 'No live feedback target for PAN-1917',
      specialist: 'review-agent',
      feedbackPath: '/tmp/overdeck/workspaces/feature-pan-1917/.pan/feedback/001-review-agent-blocked.md',
    }));
  });
});
