import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockMessageAgent,
  mockResolveProjectFromIssue,
  mockGetPrFacts,
  mockWriteFeedbackFile,
  mockResolveIssueFeedbackTarget,
  mockSurfaceIssueFeedbackNeedsYou,
} = vi.hoisted(() => ({
  mockMessageAgent: vi.fn(),
  mockResolveProjectFromIssue: vi.fn(),
  mockGetPrFacts: vi.fn(),
  mockWriteFeedbackFile: vi.fn(),
  mockResolveIssueFeedbackTarget: vi.fn(),
  mockSurfaceIssueFeedbackNeedsYou: vi.fn(),
}));

function prFacts(overrides: Record<string, unknown> = {}) {
  return {
    issueId: 'PAN-1059', forge: 'github', url: 'https://github.com/eltmon/overdeck/pull/1059',
    number: 1059, exists: true, open: true, merged: false, closed: false, draft: false,
    headSha: 'head-one', headBranch: 'feature/pan-1059', reviewDecision: 'CHANGES_REQUESTED',
    approved: false, changesRequested: true, mergeable: true, mergeableState: 'mergeable',
    checks: 'green', ...overrides,
  };
}

vi.mock('node:child_process', () => ({
  execFile: vi.fn((cmd, args, options, callback) => callback(null, '', '')),
}));

vi.mock('../../../../src/lib/agents.js', () => ({
  messageAgent: mockMessageAgent,
}));

vi.mock('../../../../src/lib/agents/messaging.js', () => ({
  messageAgent: mockMessageAgent,
}));

vi.mock('../../../../src/lib/agents/agent-state.js', () => ({
  getAgentStateSync: vi.fn(),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: mockResolveProjectFromIssue,
  resolveProjectFromIssueSync: mockResolveProjectFromIssue,
}));

vi.mock('../../../../src/lib/cloister/pr-facts.js', () => ({
  getPrFacts: mockGetPrFacts,
}));

// PAN-3917: convergence is read from the round artifacts; no rounds on disk in
// these fixtures means "converging", which is the pre-cut default.
vi.mock('../../../../src/lib/cloister/review-rounds.js', () => ({
  assessReviewConvergence: () => ({ converging: true, counts: [], series: '' }),
}));

vi.mock('../../../../src/lib/cloister/feedback-writer.js', () => ({
  writeFeedbackFile: mockWriteFeedbackFile,
}));

vi.mock('../../../../src/lib/cloister/feedback-target.js', () => ({
  resolveIssueFeedbackTarget: mockResolveIssueFeedbackTarget,
  surfaceIssueFeedbackNeedsYou: mockSurfaceIssueFeedbackNeedsYou,
}));

vi.mock('../../../../src/lib/cloister/swarm-slot-reconcile.js', () => ({
  listSlotOwnership: vi.fn(() => []),
}));

// The pipeline journal is real (temp workspaces); only its event fan-out is silenced.
vi.mock('../../../../src/lib/pipeline-notifier.js', () => ({ notifyPipelineSync: vi.fn() }));

describe('deliverReviewVerdictFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveProjectFromIssue.mockReturnValue(null);
    mockMessageAgent.mockResolvedValue({ delivered: true, queuedToMail: false });
    mockGetPrFacts.mockResolvedValue(prFacts());
    mockWriteFeedbackFile.mockResolvedValue({
      success: true,
      filePath: '/tmp/workspace/.pan/feedback/001-review-agent-changes-requested.md',
      relativePath: '.pan/feedback/001-review-agent-changes-requested.md',
    });
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
    const result = await deliverReviewVerdictFeedback({
      issueId: 'pan-1059',
      verdict: 'blocked',
      notes: 'correctness blocker',
      workspacePath: workspace,
      runId: 'agent-pan-1059-review-abcdef12',
    });

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
        feedbackRedelivery: true,
        dedupKey: expect.stringMatching(/^review-feedback:pan-1059:[a-f0-9]{16}$/),
      },
    );
  });

  it('keeps one run key stable across deliveries for the same run', async () => {
    mockGetPrFacts
      .mockResolvedValueOnce(prFacts())
      .mockResolvedValueOnce(prFacts({ headSha: 'head-two' }));
    mockMessageAgent
      .mockResolvedValueOnce({ delivered: true, queuedToMail: false })
      .mockResolvedValueOnce({ delivered: true, queuedToMail: false, deduplicated: true });
    const { deliverReviewVerdictFeedback } = await import(
      '../../../../src/lib/cloister/review-verdict-feedback.js'
    );
    const options = {
      issueId: 'PAN-1059',
      verdict: 'blocked' as const,
      notes: 'correctness blocker',
      runId: 'agent-pan-1059-review-abcdef12',
    };

    await deliverReviewVerdictFeedback(options);
    await deliverReviewVerdictFeedback(options);

    const firstKey = mockMessageAgent.mock.calls[0]![3].dedupKey;
    const secondKey = mockMessageAgent.mock.calls[1]![3].dedupKey;
    expect(firstKey).toMatch(/^review-feedback:pan-1059:[a-f0-9]{16}$/);
    expect(secondKey).toBe(firstKey);
    expect(mockSurfaceIssueFeedbackNeedsYou).not.toHaveBeenCalled();
  });

  it('uses a fresh key for a later review run', async () => {
    mockGetPrFacts.mockResolvedValue(prFacts({ headSha: null }));
    const { deliverReviewVerdictFeedback } = await import(
      '../../../../src/lib/cloister/review-verdict-feedback.js'
    );

    const firstResult = await deliverReviewVerdictFeedback({
      issueId: 'PAN-1059',
      verdict: 'blocked',
      runId: 'agent-pan-1059-review-abcdef12',
    });
    const secondResult = await deliverReviewVerdictFeedback({
      issueId: 'PAN-1059',
      verdict: 'blocked',
      runId: 'agent-pan-1059-review-fedcba98',
    });

    expect(firstResult.agentMessageSent).toBe(true);
    expect(secondResult.agentMessageSent).toBe(true);
    expect(mockMessageAgent.mock.calls[0]![3].dedupKey).not.toBe(
      mockMessageAgent.mock.calls[1]![3].dedupKey,
    );
  });

  it('uses the PR head as fallback identity when no run ID exists', async () => {
    mockGetPrFacts
      .mockResolvedValueOnce(prFacts({ headSha: 'head-one' }))
      .mockResolvedValueOnce(prFacts({ headSha: 'head-two' }));
    const { deliverReviewVerdictFeedback } = await import(
      '../../../../src/lib/cloister/review-verdict-feedback.js'
    );

    await deliverReviewVerdictFeedback({
      issueId: 'PAN-1059',
      verdict: 'blocked',
    });
    await deliverReviewVerdictFeedback({
      issueId: 'PAN-1059',
      verdict: 'blocked',
    });

    expect(mockMessageAgent.mock.calls[0]![3].dedupKey).not.toBe(
      mockMessageAgent.mock.calls[1]![3].dedupKey,
    );
  });

  it('delivers unkeyed when neither a run ID nor a PR head exists', async () => {
    mockGetPrFacts.mockResolvedValue(prFacts({ headSha: null }));
    const { deliverReviewVerdictFeedback } = await import(
      '../../../../src/lib/cloister/review-verdict-feedback.js'
    );

    const result = await deliverReviewVerdictFeedback({
      issueId: 'PAN-1059',
      verdict: 'blocked',
    });

    expect(result.agentMessageSent).toBe(true);
    expect(mockMessageAgent).toHaveBeenCalledWith(
      'agent-pan-1059',
      expect.any(String),
      'internal',
      { owesRework: true, feedbackRedelivery: true },
    );
  });

  it('escalates once on the second suppressed re-delivery for one key', async () => {
    mockMessageAgent.mockResolvedValue({
      delivered: true,
      queuedToMail: false,
      deduplicated: true,
    });
    const { deliverReviewVerdictFeedback } = await import(
      '../../../../src/lib/cloister/review-verdict-feedback.js'
    );
    const options = {
      issueId: 'PAN-2059',
      verdict: 'blocked' as const,
      runId: 'agent-pan-2059-review-abcdef12',
    };

    await deliverReviewVerdictFeedback(options);
    expect(mockSurfaceIssueFeedbackNeedsYou).not.toHaveBeenCalled();

    await deliverReviewVerdictFeedback(options);
    expect(mockSurfaceIssueFeedbackNeedsYou).toHaveBeenCalledOnce();
    expect(mockSurfaceIssueFeedbackNeedsYou).toHaveBeenCalledWith(
      'PAN-2059',
      'Review feedback for this verdict was already delivered to the agent; the pipeline re-triggered delivery 3+ times — possible stuck loop. Investigate before the agent context burns.',
      {
        specialist: 'review-agent',
        feedbackPath: '/tmp/workspace/.pan/feedback/001-review-agent-changes-requested.md',
      },
    );

    await deliverReviewVerdictFeedback(options);
    expect(mockSurfaceIssueFeedbackNeedsYou).toHaveBeenCalledOnce();
  });

  it('resets the suppression counter after a fresh delivery for the same key', async () => {
    mockMessageAgent
      .mockResolvedValueOnce({ delivered: true, queuedToMail: false, deduplicated: true })
      .mockResolvedValueOnce({ delivered: true, queuedToMail: false, deduplicated: true })
      .mockResolvedValueOnce({ delivered: true, queuedToMail: false })
      .mockResolvedValueOnce({ delivered: true, queuedToMail: false, deduplicated: true });
    const { deliverReviewVerdictFeedback } = await import(
      '../../../../src/lib/cloister/review-verdict-feedback.js'
    );
    const options = {
      issueId: 'PAN-3059',
      verdict: 'blocked' as const,
      runId: 'agent-pan-3059-review-abcdef12',
    };

    await deliverReviewVerdictFeedback(options);
    await deliverReviewVerdictFeedback(options);
    expect(mockSurfaceIssueFeedbackNeedsYou).toHaveBeenCalledOnce();

    await deliverReviewVerdictFeedback(options);
    await deliverReviewVerdictFeedback(options);

    expect(mockSurfaceIssueFeedbackNeedsYou).toHaveBeenCalledOnce();
  });

  it('falls back to unkeyed delivery when the target transport cannot enforce a key', async () => {
    mockMessageAgent
      .mockRejectedValueOnce(new Error(
        'MessageDeliveryFailed: keyed delivery failed for agent-pan-1059 (internal): the ACP tier cannot enforce a dedup key',
      ))
      .mockResolvedValueOnce({ delivered: true, queuedToMail: false });
    const { deliverReviewVerdictFeedback } = await import(
      '../../../../src/lib/cloister/review-verdict-feedback.js'
    );

    const result = await deliverReviewVerdictFeedback({
      issueId: 'PAN-1059',
      verdict: 'blocked',
      runId: 'agent-pan-1059-review-abcdef12',
    });

    expect(result.agentMessageSent).toBe(true);
    expect(mockMessageAgent).toHaveBeenCalledTimes(2);
    expect(mockMessageAgent.mock.calls[0]![3]).toEqual({
      owesRework: true,
      feedbackRedelivery: true,
      dedupKey: expect.stringMatching(/^review-feedback:pan-1059:[a-f0-9]{16}$/),
    });
    expect(mockMessageAgent.mock.calls[1]![3]).toEqual({ owesRework: true, feedbackRedelivery: true });
  });
});

describe('ambiguous keyed delivery retry (PAN-1837)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveProjectFromIssue.mockReturnValue(null);
    mockGetPrFacts.mockResolvedValue(prFacts());
    mockWriteFeedbackFile.mockResolvedValue({
      success: true,
      filePath: '/tmp/workspace/.pan/feedback/001-review-agent-changes-requested.md',
      relativePath: '.pan/feedback/001-review-agent-changes-requested.md',
    });
    mockResolveIssueFeedbackTarget.mockResolvedValue({ agentId: 'agent-pan-1059' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function ambiguousError(): Error {
    const err = new Error(
      'MessageDeliveryFailed: ambiguous keyed delivery for agent-pan-1059 (messageAgent:internal): socket POST timeout — the supervisor may have completed the injection; NOT crossing to the tmux tier with the same key',
    );
    err.name = 'AmbiguousKeyedDeliveryError';
    return err;
  }

  async function makeWorkspace(): Promise<string> {
    const workspace = join(tmpdir(), `pan-1837-retry-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const reviewDir = join(workspace, '.pan', 'review', 'agent-pan-1059-review-abcdef12');
    await mkdir(reviewDir, { recursive: true });
    await writeFile(join(reviewDir, 'synthesis.md'), '## Verdict\n\nRequest changes.');
    return workspace;
  }

  // Mirrors AMBIGUOUS_DELIVERY_RETRY_MS in review-verdict-feedback.ts.
  const RETRY_SLEEP_MS = 2_000;
  // Stays under the 5s testTimeout so a genuine hang fails here with a readable
  // message instead of leaking a hot loop past the runner's own timeout. Fake
  // timers own `Date`, `performance`, AND `process.hrtime`, so the only honest
  // wall clock is a reference captured before any of them is installed.
  const realNow = Date.now;
  const SETTLE_BUDGET_MS = 4_000;

  // PAN-3259: the product sleeps between ambiguous-delivery retries with a real
  // `setTimeout`, so fake timers have to drive it — but one advance tick yields
  // a single event-loop turn, and the delivery path first awaits real `fs`
  // reads of the workspace synthesis on the libuv threadpool. Driving with a
  // fixed iteration budget raced that I/O: under load the reads landed a turn
  // late, the budget drained mid-retry-chain, and the trailing `await promise`
  // then blocked forever because nothing was left to advance the clock. The
  // promise settling is the only correct stop condition — each advance still
  // visits the poll phase, so pending fs work lands between ticks.
  async function settleWithFakeTimers<T>(promise: Promise<T>): Promise<T> {
    let settled = false;
    const tracked = promise.finally(() => {
      settled = true;
    });
    const deadline = realNow() + SETTLE_BUDGET_MS;
    while (!settled) {
      if (realNow() > deadline) {
        void tracked.catch(() => {});
        throw new Error(
          'delivery promise never settled while driving the ambiguous-delivery retry sleeps',
        );
      }
      await vi.advanceTimersByTimeAsync(RETRY_SLEEP_MS);
    }
    return tracked;
  }

  it('retries the same key and delivers without surfacing needs-you', async () => {
    vi.useFakeTimers();
    try {
      const workspace = await makeWorkspace();
      mockMessageAgent
        .mockRejectedValueOnce(ambiguousError())
        .mockRejectedValueOnce(ambiguousError())
        .mockResolvedValueOnce({ delivered: true, queuedToMail: false });

      const { deliverReviewVerdictFeedback } = await import('../../../../src/lib/cloister/review-verdict-feedback.js');
      const promise = deliverReviewVerdictFeedback({
        issueId: 'pan-1059',
        verdict: 'blocked',
        notes: 'correctness blocker',
        workspacePath: workspace,
        runId: 'agent-pan-1059-review-abcdef12',
      });
      const result = await settleWithFakeTimers(promise);

      expect(result.agentMessageSent).toBe(true);
      expect(mockMessageAgent).toHaveBeenCalledTimes(3);
      expect(mockSurfaceIssueFeedbackNeedsYou).not.toHaveBeenCalled();
      // Every attempt reuses the SAME dedup key — the supervisor's dedup
      // store is what makes the retry safe.
      const keys = mockMessageAgent.mock.calls.map((call) => call[3]?.dedupKey);
      expect(new Set(keys).size).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('surfaces needs-you only after exhausting the bounded retries', async () => {
    vi.useFakeTimers();
    try {
      const workspace = await makeWorkspace();
      mockMessageAgent.mockRejectedValue(ambiguousError());

      const { deliverReviewVerdictFeedback } = await import('../../../../src/lib/cloister/review-verdict-feedback.js');
      const promise = deliverReviewVerdictFeedback({
        issueId: 'pan-1059',
        verdict: 'blocked',
        notes: 'correctness blocker',
        workspacePath: workspace,
        runId: 'agent-pan-1059-review-abcdef12',
      });
      const result = await settleWithFakeTimers(promise);

      expect(result.agentMessageSent).toBe(false);
      expect(mockMessageAgent).toHaveBeenCalledTimes(4);
      expect(mockSurfaceIssueFeedbackNeedsYou).toHaveBeenCalledWith(
        'PAN-1059',
        expect.stringContaining('ambiguous keyed delivery'),
        expect.anything(),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('#4035: review feedback delivery is journaled per verdict episode', () => {
  let workspace: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { mkdtemp } = await import('node:fs/promises');
    workspace = await mkdtemp(join(tmpdir(), 'review-feedback-4035-'));
    mockResolveProjectFromIssue.mockReturnValue(null);
    mockMessageAgent.mockResolvedValue({ delivered: true, queuedToMail: false });
    mockGetPrFacts.mockResolvedValue(prFacts({ headSha: 'head-one' }));
    mockWriteFeedbackFile.mockResolvedValue({ success: true, filePath: join(workspace, 'feedback.md') });
    mockResolveIssueFeedbackTarget.mockResolvedValue({ agentId: 'agent-pan-1059' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const { rm } = await import('node:fs/promises');
    await rm(workspace, { recursive: true, force: true });
  });

  async function relay(runId?: string) {
    const { deliverReviewVerdictFeedback } = await import('../../../../src/lib/cloister/review-verdict-feedback.js');
    return deliverReviewVerdictFeedback({
      issueId: 'PAN-1059', verdict: 'blocked', workspacePath: workspace, ...(runId ? { runId } : {}),
    });
  }

  it('a repeat of one review run skips target resolution and delivery (Herdr ignores the key)', async () => {
    const { readPipelineJournal } = await import('../../../../src/lib/cloister/pipeline-journal.js');

    const first = await relay('agent-pan-1059-review-abcdef12');
    const repeat = await relay('agent-pan-1059-review-abcdef12');

    expect(first.agentMessageSent).toBe(true);
    expect(repeat.agentMessageSent).toBe(true);
    expect(mockResolveIssueFeedbackTarget).toHaveBeenCalledTimes(1);
    expect(mockMessageAgent).toHaveBeenCalledTimes(1);
    expect(readPipelineJournal(workspace)).toEqual([
      expect.objectContaining({
        type: 'feedback.delivered',
        data: expect.objectContaining({ kind: 'review', agentId: 'agent-pan-1059' }),
      }),
      expect.objectContaining({
        type: 'feedback.skipped',
        data: expect.objectContaining({ kind: 'review' }),
      }),
    ]);
  });

  it('the repeated-delivery loop detector counts journaled skips, so it holds across processes', async () => {
    const runId = 'agent-pan-1059-review-loop4035';
    await relay(runId);
    await relay(runId);
    expect(mockSurfaceIssueFeedbackNeedsYou).not.toHaveBeenCalled();

    await relay(runId);

    expect(mockMessageAgent).toHaveBeenCalledTimes(1);
    expect(mockSurfaceIssueFeedbackNeedsYou).toHaveBeenCalledTimes(1);
    expect(mockSurfaceIssueFeedbackNeedsYou).toHaveBeenCalledWith(
      'PAN-1059',
      expect.stringContaining('possible stuck loop'),
      expect.objectContaining({ specialist: 'review-agent' }),
    );

    // A fresh process has no in-memory count: the next skip is the third
    // journaled one, not a first, so it does not surface again.
    vi.resetModules();
    await relay(runId);
    expect(mockSurfaceIssueFeedbackNeedsYou).toHaveBeenCalledTimes(1);
  });

  it('a fresh process reaches the second skip from the journal alone', async () => {
    const runId = 'agent-pan-1059-review-xproc4035';
    await relay(runId);
    await relay(runId);
    vi.resetModules();
    await relay(runId);

    expect(mockSurfaceIssueFeedbackNeedsYou).toHaveBeenCalledTimes(1);
  });

  it('keeps the pre-#4035 head key when no approval is journaled', async () => {
    const { createHash } = await import('node:crypto');
    await relay();

    const expected = `review-feedback:pan-1059:${createHash('sha256').update('anchor:head-one').digest('hex').slice(0, 16)}`;
    expect(mockMessageAgent.mock.calls[0]![3].dedupKey).toBe(expected);
  });

  it('fail, approve, fail on one head delivers twice under distinct keys', async () => {
    const { appendPipelineEntry } = await import('../../../../src/lib/cloister/pipeline-journal.js');

    await relay();
    await relay();
    appendPipelineEntry(workspace, { type: 'review.verdict', issueId: 'PAN-1059', data: { verdict: 'APPROVED' } });
    await relay();

    expect(mockMessageAgent).toHaveBeenCalledTimes(2);
    expect(mockMessageAgent.mock.calls[0]![3].dedupKey).not.toBe(mockMessageAgent.mock.calls[1]![3].dedupKey);
  });

  it('a delivery that did not land is not journaled, so the next verdict run tries again', async () => {
    mockMessageAgent.mockResolvedValueOnce({ delivered: false, queuedToMail: false, reason: 'pane gone' });

    await relay('agent-pan-1059-review-abcdef12');
    await relay('agent-pan-1059-review-abcdef12');

    expect(mockMessageAgent).toHaveBeenCalledTimes(2);
  });
});
