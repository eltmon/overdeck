/**
 * Tests for `pan admin specialists done <role> <issue> --status <...>`.
 *
 * PAN-3917: a specialist verdict is posted where the forge owns it — and for
 * the reviewer that means the forge's own review decision: APPROVE on a pass,
 * REQUEST_CHANGES on blocked/failed. Test and UAT verdicts stay comments. There
 * is no review-status row, no verdict-anchor write door, and no `inspect` role
 * (that went with the per-item inspection gate).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const {
  mockDiscoverArtifact,
  mockCommentOnArtifact,
  mockGetIssueWorkspacePath,
  mockDeliverReviewVerdictFeedback,
  mockSurfaceIssueFeedbackNeedsYou,
  mockPostReviewVerdict,
  mockGetPrFacts,
  mockRelayUatFailureFeedback,
  mockClearUatFailureFeedbackAnchor,
} = vi.hoisted(() => ({
  mockDiscoverArtifact: vi.fn(),
  mockCommentOnArtifact: vi.fn(),
  mockGetIssueWorkspacePath: vi.fn(),
  mockDeliverReviewVerdictFeedback: vi.fn(),
  mockSurfaceIssueFeedbackNeedsYou: vi.fn(),
  mockPostReviewVerdict: vi.fn(),
  mockGetPrFacts: vi.fn(),
  mockRelayUatFailureFeedback: vi.fn(),
  mockClearUatFailureFeedbackAnchor: vi.fn(),
}));

vi.mock('../../../../src/lib/cloister/uat-failure-feedback.js', () => ({
  relayUatFailureFeedbackPromise: mockRelayUatFailureFeedback,
  clearUatFailureFeedbackAnchor: mockClearUatFailureFeedbackAnchor,
}));

vi.mock('../../../../src/lib/forge.js', () => ({
  discoverArtifact: mockDiscoverArtifact,
  commentOnArtifact: mockCommentOnArtifact,
}));

vi.mock('../../../../src/lib/cloister/pr-review-verdict.js', () => ({
  postReviewVerdict: mockPostReviewVerdict,
}));

vi.mock('../../../../src/lib/cloister/pr-facts.js', () => ({
  getPrFacts: mockGetPrFacts,
  resetPrFactsCache: vi.fn(),
}));

vi.mock('../../../../src/dashboard/server/services/pr-tab-cache.js', () => ({
  bumpIssuePrTabCacheGeneration: vi.fn(),
}));

vi.mock('../../../../src/lib/cloister/pipeline-journal.js', () => ({
  appendPipelineEntry: vi.fn(),
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
    mockCommentOnArtifact.mockReturnValue(Effect.succeed(undefined));
    mockPostReviewVerdict.mockResolvedValue({
      posted: true, forge: 'github', url: ARTIFACT_URL, verdict: 'request-changes',
    });
    mockGetPrFacts.mockResolvedValue({
      issueId: 'PAN-1059', forge: 'github', url: ARTIFACT_URL, open: true,
      approved: false, changesRequested: true, headSha: 'head-sha-1',
    });
    mockRelayUatFailureFeedback.mockResolvedValue({
      agentMessageSent: true, needsYouSurfaced: false, deduplicated: false,
    });
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
    expect(mockPostReviewVerdict).not.toHaveBeenCalled();
  });

  it('a passed review posts APPROVE, not a comment', async () => {
    mockPostReviewVerdict.mockResolvedValue({
      posted: true, forge: 'github', url: ARTIFACT_URL, verdict: 'approve',
    });
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('review', 'pan-1059', { status: 'passed', notes: 'looks good' });

    expect(mockPostReviewVerdict).toHaveBeenCalledWith({
      issueId: 'PAN-1059',
      verdict: 'approve',
      body: expect.stringContaining('review verdict: passed'),
    });
    expect(mockCommentOnArtifact).not.toHaveBeenCalled();
    expect(mockDeliverReviewVerdictFeedback).not.toHaveBeenCalled();
  });

  it('a blocked review posts REQUEST_CHANGES and delivers feedback', async () => {
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('review', 'pan-1059', {
      status: 'blocked',
      notes: 'correctness blocker',
      runId: 'agent-pan-1059-review-abcdef12',
    });

    expect(mockPostReviewVerdict).toHaveBeenCalledWith({
      issueId: 'PAN-1059',
      verdict: 'request-changes',
      body: expect.stringContaining('review verdict: blocked'),
    });
    expect(mockPostReviewVerdict.mock.calls[0][0].body).toContain('correctness blocker');
    expect(mockCommentOnArtifact).not.toHaveBeenCalled();
    expect(mockDeliverReviewVerdictFeedback).toHaveBeenCalledWith({
      issueId: 'PAN-1059',
      verdict: 'blocked',
      notes: 'correctness blocker',
      prUrl: ARTIFACT_URL,
      runId: 'agent-pan-1059-review-abcdef12',
    });
  });

  it('a failed review also posts REQUEST_CHANGES and delivers feedback', async () => {
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('review', 'pan-1059', { status: 'failed', notes: 'synthesis crashed' });

    expect(mockPostReviewVerdict.mock.calls[0][0]).toMatchObject({ verdict: 'request-changes' });
    expect(mockDeliverReviewVerdictFeedback).toHaveBeenCalledWith({
      issueId: 'PAN-1059',
      verdict: 'failed',
      notes: 'synthesis crashed',
      prUrl: ARTIFACT_URL,
    });
  });

  it('fails completion when the verdict could not be posted to the forge', async () => {
    mockPostReviewVerdict.mockResolvedValue({ posted: false, reason: 'gh pr review failed: 403' });
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const error = vi.spyOn(console, 'error');
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('review', 'pan-1059', { status: 'blocked', notes: 'blocker' });

    expect(exit).toHaveBeenCalledWith(1);
    expect(error.mock.calls.map((c) => String(c[0])).join('\n')).toContain('Could not post the review verdict');
    expect(mockDeliverReviewVerdictFeedback).not.toHaveBeenCalled();
  });

  it('does not drive the work agent until a fresh PR read reports CHANGES_REQUESTED', async () => {
    mockGetPrFacts.mockResolvedValue({
      issueId: 'PAN-1059', forge: 'github', url: ARTIFACT_URL, open: true,
      approved: false, changesRequested: false,
    });
    const warn = vi.spyOn(console, 'warn');
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('review', 'pan-1059', { status: 'blocked', notes: 'blocker' });

    expect(mockDeliverReviewVerdictFeedback).not.toHaveBeenCalled();
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('does not report the rejection yet');
  });

  it('GitLab has no request-changes primitive, so an open unapproved MR is the rejection', async () => {
    mockPostReviewVerdict.mockResolvedValue({
      posted: true, forge: 'gitlab', url: 'https://gitlab.com/g/p/-/merge_requests/7', verdict: 'request-changes',
    });
    mockGetPrFacts.mockResolvedValue({
      issueId: 'PAN-1059', forge: 'gitlab', url: 'https://gitlab.com/g/p/-/merge_requests/7',
      open: true, approved: false, changesRequested: false,
    });
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('review', 'pan-1059', { status: 'blocked', notes: 'blocker' });

    expect(mockDeliverReviewVerdictFeedback).toHaveBeenCalled();
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

  it('PAN-4030: a failed UAT relays the UAT notes to the work agent, anchored on the PR head', async () => {
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('test', 'pan-1059', {
      status: 'passed',
      notes: 'gates green',
      uatStatus: 'failed',
      uatNotes: 'criterion 3: save does not persist',
    });

    expect(mockCommentOnArtifact).toHaveBeenCalledTimes(1);
    expect(mockRelayUatFailureFeedback).toHaveBeenCalledTimes(1);
    expect(mockRelayUatFailureFeedback).toHaveBeenCalledWith({
      issueId: 'PAN-1059',
      uatNotes: 'criterion 3: save does not persist',
      workspacePath: '/project/workspaces/feature-pan-1059',
      anchor: 'head-sha-1',
    });
    expect(mockClearUatFailureFeedbackAnchor).not.toHaveBeenCalled();
  });

  it('PAN-4030: anchors on --tested-sha, not the PR head that moved during the run', async () => {
    // PR head is head-sha-1 (a push landed mid-run); UAT exercised ABC1234.
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('test', 'pan-1059', {
      status: 'passed', uatStatus: 'failed', uatNotes: 'x', testedSha: 'ABC1234',
    });

    expect(mockRelayUatFailureFeedback).toHaveBeenCalledWith(expect.objectContaining({ anchor: 'abc1234' }));
    expect(mockGetPrFacts).not.toHaveBeenCalled();
  });

  it('PAN-4030: rejects a malformed --tested-sha, or one on a review verdict, before posting', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('test', 'pan-1059', { status: 'passed', testedSha: 'not-a-sha' });
    await doneCommand('review', 'pan-1059', { status: 'passed', testedSha: 'abc1234' });

    expect(exit).toHaveBeenCalledTimes(2);
    expect(exit).toHaveBeenCalledWith(1);
    expect(mockDiscoverArtifact).not.toHaveBeenCalled();
  });

  it('PAN-4030: the uat role\'s own failed status is a UAT failure too', async () => {
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('uat', 'pan-1059', { status: 'failed', notes: 'login redirects to 404' });

    expect(mockRelayUatFailureFeedback).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-1059',
      uatNotes: 'login redirects to 404',
      anchor: 'head-sha-1',
    }));
  });

  it('PAN-4030: a passing UAT clears the anchor and relays nothing', async () => {
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('test', 'pan-1059', { status: 'passed', uatStatus: 'passed', uatNotes: 'all criteria observed' });

    expect(mockClearUatFailureFeedbackAnchor).toHaveBeenCalledWith('PAN-1059');
    expect(mockRelayUatFailureFeedback).not.toHaveBeenCalled();
  });

  it('PAN-4030: a test verdict without UAT neither relays nor clears', async () => {
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('test', 'pan-1059', { status: 'failed', notes: 'unit tests red' });

    expect(mockRelayUatFailureFeedback).not.toHaveBeenCalled();
    expect(mockClearUatFailureFeedbackAnchor).not.toHaveBeenCalled();
  });

  it('PAN-4030: an unreadable PR head still relays the failure, unanchored', async () => {
    mockGetPrFacts.mockRejectedValue(new Error('gh: rate limited'));
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('test', 'pan-1059', { status: 'passed', uatStatus: 'failed', uatNotes: 'x' });

    expect(mockRelayUatFailureFeedback).toHaveBeenCalledWith({
      issueId: 'PAN-1059',
      uatNotes: 'x',
      workspacePath: '/project/workspaces/feature-pan-1059',
    });
  });

  it('PAN-4030: surfaces a uat-agent needs-you when UAT relay exceeds the advisory deadline', async () => {
    vi.useFakeTimers();
    mockRelayUatFailureFeedback.mockReturnValue(new Promise(() => {}));
    const {
      doneCommand,
      FEEDBACK_DELIVERY_TIMEOUT_MS,
    } = await import('../../../../src/cli/commands/specialists/done.js');

    const completion = doneCommand('test', 'pan-1059', { status: 'passed', uatStatus: 'failed', uatNotes: 'x' });

    await vi.advanceTimersByTimeAsync(FEEDBACK_DELIVERY_TIMEOUT_MS);
    await expect(completion).resolves.toBeUndefined();

    expect(mockSurfaceIssueFeedbackNeedsYou).toHaveBeenCalledWith(
      'PAN-1059',
      expect.stringContaining('UAT failure feedback delivery exceeded'),
      { specialist: 'uat-agent', retryable: true, source: 'specialists-done-timeout' },
    );
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
