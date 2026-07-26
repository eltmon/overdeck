import { Effect } from 'effect';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockMessageAgent,
  mockResolveProjectFromIssue,
  mockGetReviewStatus,
  mockWriteFeedbackFile,
  mockResolveIssueFeedbackTarget,
  mockSurfaceIssueFeedbackNeedsYou,
} = vi.hoisted(() => ({
  mockMessageAgent: vi.fn(),
  mockResolveProjectFromIssue: vi.fn(),
  mockGetReviewStatus: vi.fn(),
  mockWriteFeedbackFile: vi.fn(),
  mockResolveIssueFeedbackTarget: vi.fn(),
  mockSurfaceIssueFeedbackNeedsYou: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn((cmd, args, options, callback) => callback(null, '', '')),
}));

vi.mock('../../../../src/lib/agents.js', () => ({
  messageAgent: mockMessageAgent,
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: mockResolveProjectFromIssue,
  resolveProjectFromIssueSync: mockResolveProjectFromIssue,
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  getReviewStatus: mockGetReviewStatus,
  getReviewStatusSync: mockGetReviewStatus,
}));

vi.mock('../../../../src/lib/cloister/feedback-writer.js', () => ({
  writeFeedbackFile: mockWriteFeedbackFile,
}));

vi.mock('../../../../src/lib/cloister/feedback-target.js', () => ({
  resolveIssueFeedbackTarget: mockResolveIssueFeedbackTarget,
  surfaceIssueFeedbackNeedsYou: mockSurfaceIssueFeedbackNeedsYou,
}));

vi.mock('../../../../src/lib/agents/slot-reconcile.js', () => ({
  listSlotOwnership: vi.fn(() => []),
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
    mockResolveIssueFeedbackTarget.mockResolvedValue({ agentId: 'agent-pan-1059' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts synthesis to the PR, writes feedback, and messages the work agent', async () => {
    const workspace = join(tmpdir(), `pan-review-feedback-${process.pid}-${Date.now()}`);
    const reviewDir = join(workspace, '.pan', 'review', 'agent-pan-1059-review-abcdef12');
    await mkdir(reviewDir, { recursive: true });
    await writeFile(join(reviewDir, 'synthesis.md'), '## Verdict\n\nRequest changes for correctness.');

    const { deliverReviewVerdictFeedback } = await import('../../../../src/lib/cloister/review-verdict-feedback.js');
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
        expect.stringContaining('body=# Review CHANGES REQUESTED for PAN-1059'),
      ],
      expect.objectContaining({ encoding: 'utf-8', timeout: 15_000 }),
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
      'internal',
      {
        owesRework: true,
        dedupKey: expect.stringMatching(/^review-feedback:pan-1059:[a-f0-9]{16}$/),
      },
    );
  });

  it('uses the same dedup key for the same verdict, run, and reviewed anchor', async () => {
    mockGetReviewStatus.mockReturnValue({
      prUrl: 'https://github.com/eltmon/overdeck/pull/1059',
      reviewedAtCommit: 'head-one',
    });
    const { deliverReviewVerdictFeedback } = await import(
      '../../../../src/lib/cloister/review-verdict-feedback.js'
    );
    const options = {
      issueId: 'PAN-1059',
      verdict: 'blocked' as const,
      notes: 'correctness blocker',
      runId: 'agent-pan-1059-review-abcdef12',
    };

    await Effect.runPromise(deliverReviewVerdictFeedback(options));
    await Effect.runPromise(deliverReviewVerdictFeedback(options));

    const firstKey = mockMessageAgent.mock.calls[0]![3].dedupKey;
    const secondKey = mockMessageAgent.mock.calls[1]![3].dedupKey;
    expect(firstKey).toMatch(/^review-feedback:pan-1059:[a-f0-9]{16}$/);
    expect(secondKey).toBe(firstKey);
  });

  it('uses different dedup keys when the reviewed anchor changes', async () => {
    mockGetReviewStatus
      .mockReturnValueOnce({ reviewedAtCommit: 'head-one' })
      .mockReturnValueOnce({ reviewedAtCommit: 'head-two' });
    const { deliverReviewVerdictFeedback } = await import(
      '../../../../src/lib/cloister/review-verdict-feedback.js'
    );

    await Effect.runPromise(deliverReviewVerdictFeedback({
      issueId: 'PAN-1059',
      verdict: 'blocked',
      runId: 'agent-pan-1059-review-abcdef12',
    }));
    await Effect.runPromise(deliverReviewVerdictFeedback({
      issueId: 'PAN-1059',
      verdict: 'blocked',
      runId: 'agent-pan-1059-review-abcdef12',
    }));

    expect(mockMessageAgent.mock.calls[0]![3].dedupKey).not.toBe(
      mockMessageAgent.mock.calls[1]![3].dedupKey,
    );
  });

  it('falls back to unkeyed delivery when the target transport cannot enforce a key', async () => {
    mockMessageAgent
      .mockRejectedValueOnce(new Error(
        'MessageDeliveryFailed: keyed delivery failed for agent-pan-1059 (internal): the ACP tier cannot enforce a dedup key',
      ))
      .mockResolvedValueOnce(undefined);
    const { deliverReviewVerdictFeedback } = await import(
      '../../../../src/lib/cloister/review-verdict-feedback.js'
    );

    const result = await Effect.runPromise(deliverReviewVerdictFeedback({
      issueId: 'PAN-1059',
      verdict: 'blocked',
      runId: 'agent-pan-1059-review-abcdef12',
    }));

    expect(result.agentMessageSent).toBe(true);
    expect(mockMessageAgent).toHaveBeenCalledTimes(2);
    expect(mockMessageAgent.mock.calls[0]![3]).toEqual({
      owesRework: true,
      dedupKey: expect.stringMatching(/^review-feedback:pan-1059:[a-f0-9]{16}$/),
    });
    expect(mockMessageAgent.mock.calls[1]![3]).toEqual({ owesRework: true });
  });
});
