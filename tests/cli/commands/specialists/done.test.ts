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
  mockAppendPipelineEntry,
  mockForgeApprovalAtHead,
  mockGetAgentState,
  mockEmitActivityEntry,
} = vi.hoisted(() => ({
  mockDiscoverArtifact: vi.fn(),
  mockCommentOnArtifact: vi.fn(),
  mockGetIssueWorkspacePath: vi.fn(),
  mockDeliverReviewVerdictFeedback: vi.fn(),
  mockSurfaceIssueFeedbackNeedsYou: vi.fn(),
  mockPostReviewVerdict: vi.fn(),
  mockGetPrFacts: vi.fn(),
  mockRelayUatFailureFeedback: vi.fn(),
  mockAppendPipelineEntry: vi.fn(),
  mockForgeApprovalAtHead: vi.fn(),
  mockGetAgentState: vi.fn(),
  mockEmitActivityEntry: vi.fn(),
}));

vi.mock('../../../../src/lib/activity-logger.js', () => ({
  emitActivityEntry: mockEmitActivityEntry,
}));

vi.mock('../../../../src/lib/cloister/uat-failure-feedback.js', () => ({
  relayUatFailureFeedback: mockRelayUatFailureFeedback,
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
  forgeApprovalAtHead: mockForgeApprovalAtHead,
}));

vi.mock('../../../../src/lib/agents/agent-state-read.js', () => ({
  getAgentState: mockGetAgentState,
}));

vi.mock('../../../../src/dashboard/server/services/pr-tab-cache.js', () => ({
  bumpIssuePrTabCacheGeneration: vi.fn(),
}));

vi.mock('../../../../src/lib/cloister/pipeline-journal.js', () => ({
  appendPipelineEntry: mockAppendPipelineEntry,
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
    // #3853: the caller's identity decides the override door; default to an
    // operator shell so the suite does not inherit the runner's agent id.
    vi.stubEnv('OVERDECK_AGENT_ID', '');
    mockGetAgentState.mockReturnValue(null);
    mockForgeApprovalAtHead.mockResolvedValue(undefined);

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
    mockDeliverReviewVerdictFeedback.mockResolvedValue({
      feedbackPath: '/workspace/.pan/feedback/001-review-agent-changes-requested.md',
      prCommentPosted: true,
      agentMessageSent: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
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
      reviewedHead: 'abcdef12',
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

  describe('#3853: the override door refuses agent sessions', () => {
    // A forge approval: the shared PR read never proves it at head; the guard
    // path reads the reviews' commit shas (`forgeApprovalAtHead`).
    const FORGE_APPROVED = {
      issueId: 'PAN-1059', forge: 'github', url: ARTIFACT_URL, number: 1059, open: true,
      approved: true, changesRequested: false, headSha: 'abcdef1234567890',
    };

    async function recordAsSynthesizer(status: 'passed' | 'blocked' | 'failed', notes = 'three reproduced blockers') {
      vi.stubEnv('OVERDECK_AGENT_ID', 'agent-pan-1059-review');
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      const error = vi.spyOn(console, 'error');
      const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');
      await doneCommand('review', 'pan-1059', { status, notes, runId: 'agent-pan-1059-review-abcdef12' });
      return { exit, stderr: error.mock.calls.map((c) => String(c[0])).join('\n') };
    }

    it('refuses the synthesizer reversing a GitHub review that approved the exact head sha', async () => {
      mockGetPrFacts.mockResolvedValue(FORGE_APPROVED);
      mockForgeApprovalAtHead.mockResolvedValue(true);

      const { exit, stderr } = await recordAsSynthesizer('blocked', 'Operator-authorized override: three blockers');

      expect(mockForgeApprovalAtHead).toHaveBeenCalledWith(FORGE_APPROVED);
      expect(exit).toHaveBeenCalledWith(1);
      expect(stderr).toContain('cannot reverse an approval on the commit it approved');
      // The refusal must not teach the bypass, and must not steer the agent to
      // re-record its blocker as a pass (a wrong refusal would then turn a real
      // blocker into an approval). It stops and leaves the operator a comment.
      expect(stderr).not.toMatch(/conv-|OVERDECK_AGENT_ID|outside any agent session/);
      expect(stderr).not.toMatch(/record\s+`?passed/i);
      expect(stderr).toContain('record no verdict');
      expect(stderr).toContain(`gh pr comment ${ARTIFACT_URL}`);
      expect(mockPostReviewVerdict).not.toHaveBeenCalled();
      expect(mockDeliverReviewVerdictFeedback).not.toHaveBeenCalled();
      // The refusal leaves a durable trace for the operator.
      expect(mockAppendPipelineEntry).toHaveBeenCalledOnce();
      expect(mockAppendPipelineEntry).toHaveBeenCalledWith('/project/workspaces/feature-pan-1059', {
        type: 'review.verdict-refused',
        issueId: 'PAN-1059',
        source: 'pan-specialists-done',
        data: expect.objectContaining({
          status: 'blocked',
          caller: 'agent-pan-1059-review',
          runId: 'agent-pan-1059-review-abcdef12',
          reason: expect.stringContaining('cannot reverse an approval'),
        }),
      });
      expect(mockEmitActivityEntry).toHaveBeenCalledWith(expect.objectContaining({
        level: 'warn', issueId: 'PAN-1059',
      }));
    });

    it('refuses on a verdict marker proven at head without reading reviews again', async () => {
      mockGetPrFacts.mockResolvedValue({ ...FORGE_APPROVED, approvedAtHead: true });

      const { exit } = await recordAsSynthesizer('failed');

      expect(exit).toHaveBeenCalledWith(1);
      expect(mockForgeApprovalAtHead).not.toHaveBeenCalled();
      expect(mockPostReviewVerdict).not.toHaveBeenCalled();
    });

    it.each([
      ['the approval is on an older commit', false],
      ['the review list is empty', false],
      ['the reviews could not be read', undefined],
    ])('lets the review agent block when %s', async (_why, proof) => {
      mockGetPrFacts.mockResolvedValue(FORGE_APPROVED);
      mockForgeApprovalAtHead.mockResolvedValue(proof);

      const { exit } = await recordAsSynthesizer('blocked', 'new blocker');

      expect(exit).not.toHaveBeenCalledWith(1);
      expect(mockPostReviewVerdict).toHaveBeenCalledWith({
        issueId: 'PAN-1059',
        verdict: 'request-changes',
        body: expect.stringContaining('new blocker'),
        facts: FORGE_APPROVED,
        reviewedHead: 'abcdef12',
      });
    });

    it('lets an operator-requested re-review block an approved head', async () => {
      mockGetPrFacts.mockResolvedValue({ ...FORGE_APPROVED, approvedAtHead: true });
      mockGetAgentState.mockReturnValue({ id: 'agent-pan-1059-review', reviewOperatorRequested: true });

      const { exit } = await recordAsSynthesizer('blocked', 'operator asked for a full review');

      expect(mockGetAgentState).toHaveBeenCalledWith('agent-pan-1059-review');
      expect(exit).not.toHaveBeenCalledWith(1);
      expect(mockForgeApprovalAtHead).not.toHaveBeenCalled();
      expect(mockPostReviewVerdict).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'request-changes' }));
    });

    it('still refuses the automatic cycle whose state carries no operator request', async () => {
      mockGetPrFacts.mockResolvedValue(FORGE_APPROVED);
      mockForgeApprovalAtHead.mockResolvedValue(true);
      mockGetAgentState.mockReturnValue({ id: 'agent-pan-1059-review' });

      const { exit } = await recordAsSynthesizer('blocked');

      expect(exit).toHaveBeenCalledWith(1);
      expect(mockPostReviewVerdict).not.toHaveBeenCalled();
    });

    it('reads no review shas for a pass', async () => {
      mockGetPrFacts.mockResolvedValue(FORGE_APPROVED);

      await recordAsSynthesizer('passed', 'lgtm');

      expect(mockForgeApprovalAtHead).not.toHaveBeenCalled();
      expect(mockPostReviewVerdict).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'approve' }));
    });

    // #3853: the marker's sha= must be the commit the run reviewed. done.ts
    // hands postReviewVerdict the head from the run id; postReviewVerdict
    // names the head only when it still is that commit.
    it('passes the reviewed head from --run-id, not the head at post time', async () => {
      mockGetPrFacts.mockResolvedValue({ ...FORGE_APPROVED, headSha: 'bbbbbbbb00000000000000000000000000000000' });

      await recordAsSynthesizer('passed', 'lgtm');

      expect(mockPostReviewVerdict.mock.calls[0][0]).toMatchObject({ reviewedHead: 'abcdef12' });
    });

    it('falls back to the review parent\'s current run when --run-id is absent', async () => {
      vi.stubEnv('OVERDECK_AGENT_ID', 'agent-pan-1059-review');
      mockGetAgentState.mockReturnValue({ id: 'agent-pan-1059-review', reviewRunId: 'agent-pan-1059-review-1234abcd' });
      const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

      await doneCommand('review', 'pan-1059', { status: 'passed', notes: 'lgtm' });

      expect(mockPostReviewVerdict.mock.calls[0][0]).toMatchObject({ reviewedHead: '1234abcd' });
    });

    it('passes no reviewed head when the run id names no commit', async () => {
      vi.stubEnv('OVERDECK_AGENT_ID', 'agent-pan-1059-review');
      const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

      await doneCommand('review', 'pan-1059', { status: 'passed', notes: 'lgtm', runId: 'agent-pan-1059-review' });

      expect(mockPostReviewVerdict.mock.calls[0][0]).not.toHaveProperty('reviewedHead');
    });

    it('refuses a non-review agent session recording any review verdict', async () => {
      vi.stubEnv('OVERDECK_AGENT_ID', 'agent-pan-1059');
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

      await doneCommand('review', 'pan-1059', { status: 'passed', notes: 'self-approval' });

      expect(exit).toHaveBeenCalledWith(1);
      expect(mockPostReviewVerdict).not.toHaveBeenCalled();
    });

    it('accepts the operator override from a conv-* conversation', async () => {
      vi.stubEnv('OVERDECK_AGENT_ID', 'conv-20260916-2706');
      mockGetPrFacts.mockResolvedValue({ ...FORGE_APPROVED, approvedAtHead: true });
      const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

      await doneCommand('review', 'pan-1059', { status: 'blocked', notes: 'operator blocks' });

      expect(mockPostReviewVerdict).toHaveBeenCalledWith({
        issueId: 'PAN-1059',
        verdict: 'request-changes',
        body: expect.stringContaining('operator blocks'),
      });
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
    // #4036: the marker merge readiness reads, anchored where PAN-4030 anchors.
    expect(body).toContain('<!-- overdeck-uat: failed sha=head-sha-1 -->');
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
    expect(mockAppendPipelineEntry).toHaveBeenCalledWith('/project/workspaces/feature-pan-1059', expect.objectContaining({
      type: 'uat.verdict',
      issueId: 'PAN-1059',
      data: expect.objectContaining({ status: 'failed' }),
    }));
  });

  it('PAN-4030: anchors on --tested-sha, not the PR head that moved during the run', async () => {
    // PR head is head-sha-1 (a push landed mid-run); UAT exercised ABC1234.
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('test', 'pan-1059', {
      status: 'passed', uatStatus: 'failed', uatNotes: 'x', testedSha: 'ABC1234',
    });

    expect(mockRelayUatFailureFeedback).toHaveBeenCalledWith(expect.objectContaining({ anchor: 'abc1234' }));
    // #4036: the verdict marker carries the same tested commit.
    expect(mockCommentOnArtifact.mock.calls[0][1].body).toContain('<!-- overdeck-uat: failed sha=abc1234 -->');
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

  it('#4035: a passing UAT is journaled (a new verdict episode) and relays nothing', async () => {
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('test', 'pan-1059', { status: 'passed', uatStatus: 'passed', uatNotes: 'all criteria observed' });

    expect(mockAppendPipelineEntry).toHaveBeenCalledWith('/project/workspaces/feature-pan-1059', {
      type: 'uat.verdict',
      issueId: 'PAN-1059',
      source: 'pan-specialists-done',
      data: { status: 'passed', subRole: 'test' },
    });
    expect(mockRelayUatFailureFeedback).not.toHaveBeenCalled();
  });

  it('PAN-4030: a test verdict without UAT neither relays nor journals a UAT verdict', async () => {
    const { doneCommand } = await import('../../../../src/cli/commands/specialists/done.js');

    await doneCommand('test', 'pan-1059', { status: 'failed', notes: 'unit tests red' });

    expect(mockRelayUatFailureFeedback).not.toHaveBeenCalled();
    expect(mockAppendPipelineEntry).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'uat.verdict' }));
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
    mockDeliverReviewVerdictFeedback.mockReturnValue(new Promise(() => {}));
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
