/**
 * Tests for `pan admin specialists done <role> <issue> --status <...>`.
 *
 * PAN-3917: a specialist verdict is posted where the forge owns it — an
 * approval or a review comment on the pull/merge request — and nowhere
 * else. There is no review-status row, no verdict-anchor write door, and
 * no `inspect` role (that went with the per-item inspection gate).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const {
  mockDiscoverArtifact,
  mockApproveReviewArtifact,
  mockCommentOnArtifact,
  mockGetIssueWorkspacePath,
  mockDeliverReviewVerdictFeedback,
  mockSurfaceIssueFeedbackNeedsYou,
} = vi.hoisted(() => ({
  mockDiscoverArtifact: vi.fn(),
  mockApproveReviewArtifact: vi.fn(),
  mockCommentOnArtifact: vi.fn(),
  mockGetIssueWorkspacePath: vi.fn(),
  mockDeliverReviewVerdictFeedback: vi.fn(),
  mockSurfaceIssueFeedbackNeedsYou: vi.fn(),
}));

vi.mock('../../../../src/lib/forge.js', () => ({
  discoverArtifact: mockDiscoverArtifact,
  approveReviewArtifact: mockApproveReviewArtifact,
  commentOnArtifact: mockCommentOnArtifact,
}));

vi.mock('../../../../src/lib/overdeck/issue-projects.js', () => ({
  getIssueWorkspacePath: mockGetIssueWorkspacePath,
}));

vi.mock('../../../../src/lib/cloister/review-verdict-feedback.js', () => ({
  deliverReviewVerdictFeedback: mockDeliverReviewVerdictFeedback,
}));

vi.mock('../../../../src/lib/cloister/feedback-target.js', () => ({
  surfaceIssueFeedbackNeedsYou: mockSurfaceIssueFeedbackNeedsYou,
}));

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: vi.fn(() => true),
}));

const ARTIFACT_URL = 'https://github.com/eltmon/overdeck/pull/1059';

describe('specialists done command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    mockGetIssueWorkspacePath.mockReturnValue('/project/workspaces/feature-pan-1059');
    mockDiscoverArtifact.mockReturnValue(Effect.succeed({
      forge: 'github',
      url: ARTIFACT_URL,
      id: '1059',
      created: false,
    }));
    mockApproveReviewArtifact.mockReturnValue(Effect.succeed(undefined));
    mockCommentOnArtifact.mockReturnValue(Effect.succeed(undefined));
    mockDeliverReviewVerdictFeedback.mockReturnValue(Effect.succeed({
      feedbackPath: '/workspace/.pan/feedback/001-review-agent-changes-requested.md',
      prCommentPosted: true,
      agentMessageSent: true,
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('rejects an unknown specialist role', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('inspect', 'pan-1059', { status: 'passed' });

    expect(exit).toHaveBeenCalledWith(1);
    expect(mockDiscoverArtifact).not.toHaveBeenCalled();
  });

  it('requires --status', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('review', 'pan-1059', {} as never);

    expect(exit).toHaveBeenCalledWith(1);
    expect(mockDiscoverArtifact).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range status for the role (test cannot go blocked)', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('test', 'pan-1059', { status: 'blocked' });

    expect(exit).toHaveBeenCalledWith(1);
    expect(mockDiscoverArtifact).not.toHaveBeenCalled();
  });

  it('rejects --uat-status on a non-test verdict', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('review', 'pan-1059', { status: 'passed', uatStatus: 'passed' });

    expect(exit).toHaveBeenCalledWith(1);
    expect(mockDiscoverArtifact).not.toHaveBeenCalled();
  });

  it('refuses when the issue has no workspace', async () => {
    mockGetIssueWorkspacePath.mockReturnValue(null);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const error = vi.spyOn(console, 'error');
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('review', 'pan-1059', { status: 'passed' });

    expect(exit).toHaveBeenCalledWith(1);
    expect(error.mock.calls.map((c) => String(c[0])).join('\n')).toContain('No workspace for PAN-1059');
    expect(mockDiscoverArtifact).not.toHaveBeenCalled();
  });

  it('refuses when there is no open review artifact', async () => {
    mockDiscoverArtifact.mockReturnValue(Effect.succeed(null));
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const error = vi.spyOn(console, 'error');
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('review', 'pan-1059', { status: 'passed' });

    expect(exit).toHaveBeenCalledWith(1);
    expect(error.mock.calls.map((c) => String(c[0])).join('\n')).toContain('No open review artifact');
    expect(mockApproveReviewArtifact).not.toHaveBeenCalled();
  });

  it('a passed review approves the artifact instead of commenting', async () => {
    const log = vi.spyOn(console, 'log');
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('review', 'pan-1059', { status: 'passed', notes: 'looks good' });

    expect(mockApproveReviewArtifact).toHaveBeenCalledWith('github', {
      forge: 'github',
      url: ARTIFACT_URL,
      cwd: '/project/workspaces/feature-pan-1059',
    });
    expect(mockCommentOnArtifact).not.toHaveBeenCalled();
    expect(log.mock.calls.map((c) => String(c[0])).join('\n')).toContain('Review approved');
    expect(mockDeliverReviewVerdictFeedback).not.toHaveBeenCalled();
  });

  it('a blocked review comments the verdict and delivers feedback', async () => {
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('review', 'pan-1059', {
      status: 'blocked',
      notes: 'correctness blocker',
      runId: 'agent-pan-1059-review-abcdef12',
    });

    expect(mockCommentOnArtifact).toHaveBeenCalledWith('github', {
      forge: 'github',
      url: ARTIFACT_URL,
      body: expect.stringContaining('review verdict: blocked'),
      cwd: '/project/workspaces/feature-pan-1059',
    });
    expect(mockCommentOnArtifact.mock.calls[0][1].body).toContain('correctness blocker');
    expect(mockDeliverReviewVerdictFeedback).toHaveBeenCalledWith({
      issueId: 'PAN-1059',
      verdict: 'blocked',
      notes: 'correctness blocker',
      prUrl: ARTIFACT_URL,
      runId: 'agent-pan-1059-review-abcdef12',
    });
  });

  it('a failed review also delivers feedback', async () => {
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('review', 'pan-1059', { status: 'failed', notes: 'synthesis crashed' });

    expect(mockCommentOnArtifact.mock.calls[0][1].body).toContain('review verdict: failed');
    expect(mockDeliverReviewVerdictFeedback).toHaveBeenCalledWith({
      issueId: 'PAN-1059',
      verdict: 'failed',
      notes: 'synthesis crashed',
      prUrl: ARTIFACT_URL,
    });
  });

  it('records a test verdict with UAT recorded separately in the same comment', async () => {
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('test', 'pan-1059', {
      status: 'passed',
      notes: 'typecheck, lint, and tests passed',
      uatStatus: 'failed',
      uatNotes: 'workspace has no tracker-backed issue data',
    });

    const body = mockCommentOnArtifact.mock.calls[0][1].body as string;
    expect(body).toContain('test verdict: passed');
    expect(body).toContain('typecheck, lint, and tests passed');
    expect(body).toContain('browser UAT: failed');
    expect(body).toContain('workspace has no tracker-backed issue data');
    expect(mockDeliverReviewVerdictFeedback).not.toHaveBeenCalled();
  });

  it('PAN-2524/PAN-3642: surfaces needs-you when feedback delivery exceeds the advisory deadline', async () => {
    vi.useFakeTimers();
    mockDeliverReviewVerdictFeedback.mockReturnValue(Effect.never);
    const {
      doneCommand,
      FEEDBACK_DELIVERY_TIMEOUT_MS,
    } = await import('../../../../src/cli/commands/specialists/done.js');

    const completion = doneCommand('review', 'pan-1059', {
      status: 'blocked',
      notes: 'durable first',
      runId: 'agent-pan-1059-review-abcdef12',
    });

    await vi.advanceTimersByTimeAsync(FEEDBACK_DELIVERY_TIMEOUT_MS);
    await expect(completion).resolves.toBeUndefined();

    expect(mockSurfaceIssueFeedbackNeedsYou).toHaveBeenCalledWith(
      'PAN-1059',
      expect.stringContaining('retry remains required'),
      {
        specialist: 'review-agent',
        retryable: true,
        source: 'specialists-done-timeout',
        runId: 'agent-pan-1059-review-abcdef12',
      },
    );
  });

  it('doneAndExitCommand exits 0 after the verdict is posted', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const { doneAndExitCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneAndExitCommand('test', 'pan-1059', { status: 'passed' });

    expect(mockCommentOnArtifact).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('formatVerdictBody composes the heading, notes, and UAT sections', async () => {
    const { formatVerdictBody } = await import('../../../../src/cli/commands/specialists/done.js');

    const body = formatVerdictBody('test', 'passed', 'all green', { status: 'failed', notes: 'no live server' });

    expect(body).toContain('**test verdict: passed**');
    expect(body).toContain('all green');
    expect(body).toContain('**browser UAT: failed**');
    expect(body).toContain('no live server');
  });
});
