import { Effect } from 'effect';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockMessageAgent, mockResolveProjectFromIssue, mockGetReviewStatus, mockWriteFeedbackFile } = vi.hoisted(() => ({
  mockMessageAgent: vi.fn(),
  mockResolveProjectFromIssue: vi.fn(),
  mockGetReviewStatus: vi.fn(),
  mockWriteFeedbackFile: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn((cmd, args, options, callback) => callback(null, '', '')),
}));

vi.mock('../../../src/lib/agents.js', () => ({
  messageAgent: mockMessageAgent,
}));

vi.mock('../../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: mockResolveProjectFromIssue,
  resolveProjectFromIssueSync: mockResolveProjectFromIssue,
}));

vi.mock('../../../src/lib/review-status.js', () => ({
  getReviewStatus: mockGetReviewStatus,
  getReviewStatusSync: mockGetReviewStatus,
}));

vi.mock('../../../src/lib/cloister/feedback-writer.js', () => ({
  writeFeedbackFile: mockWriteFeedbackFile,
}));

vi.mock('../../../src/lib/agents/slot-reconcile.js', () => ({
  listSlotAgents: vi.fn(() => []),
}));

describe('deliverReviewVerdictFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveProjectFromIssue.mockReturnValue(null);
    mockGetReviewStatus.mockReturnValue({ prUrl: 'https://github.com/eltmon/overdeck/pull/1059' });
    mockWriteFeedbackFile.mockReturnValue(Effect.succeed({
      success: true,
      filePath: '/tmp/workspace/.pan/feedback/001-review-agent-changes-requested.md',
      relativePath: '.pan/feedback/001-review-agent-changes-requested.md',
    }));
  });

  it('posts synthesis to the PR, writes feedback, and messages the work agent', async () => {
    const workspace = join(tmpdir(), `pan-review-feedback-${process.pid}-${Date.now()}`);
    const reviewDir = join(workspace, '.pan', 'review', 'agent-pan-1059-review-abcdef12');
    await mkdir(reviewDir, { recursive: true });
    await writeFile(join(reviewDir, 'synthesis.md'), '## Verdict\n\nRequest changes for correctness.');

    const { deliverReviewVerdictFeedback } = await import('../../../src/lib/cloister/review-verdict-feedback.js');
    const result = await Effect.runPromise(deliverReviewVerdictFeedback({
      issueId: 'pan-1059',
      verdict: 'blocked',
      notes: 'correctness blocker',
      workspacePath: workspace,
    }));

    expect(result.prCommentPosted).toBe(true);
    expect(result.agentMessageSent).toBe(true);
    expect(result.synthesisPath).toBe(join(reviewDir, 'synthesis.md'));
    expect(execFile).toHaveBeenCalledWith(
      'gh',
      [
        'api',
        'repos/eltmon/overdeck/issues/1059/comments',
        '--field',
        expect.stringContaining('Request changes for correctness.'),
      ],
      { encoding: 'utf-8' },
      expect.any(Function),
    );
    expect(mockWriteFeedbackFile).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-1059',
      workspacePath: workspace,
      specialist: 'review-agent',
      outcome: 'changes-requested',
      markdownBody: expect.stringContaining('Request changes for correctness.'),
    }));
    expect(mockMessageAgent).toHaveBeenCalledWith(
      'agent-pan-1059',
      expect.stringContaining('MUST READ: /tmp/workspace/.pan/feedback/001-review-agent-changes-requested.md'),
    );
  });
});
