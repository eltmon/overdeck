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
  mockClearFeedbackDeliveryStuck,
} = vi.hoisted(() => ({
  mockMessageAgent: vi.fn(),
  mockResolveProjectFromIssue: vi.fn(),
  mockGetReviewStatus: vi.fn(),
  mockWriteFeedbackFile: vi.fn(),
  mockResolveIssueFeedbackTarget: vi.fn(),
  mockSurfaceIssueFeedbackNeedsYou: vi.fn(),
  mockClearFeedbackDeliveryStuck: vi.fn(),
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
  clearFeedbackDeliveryStuck: mockClearFeedbackDeliveryStuck,
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
    mockMessageAgent.mockResolvedValue({ delivered: true, queuedToMail: false });
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
      runId: 'agent-pan-1059-review-abcdef12',
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

  it('keeps one run key stable when the blocked anchor is written after delivery', async () => {
    mockGetReviewStatus
      .mockReturnValueOnce({ prUrl: 'https://github.com/eltmon/overdeck/pull/1059' })
      .mockReturnValueOnce({
        prUrl: 'https://github.com/eltmon/overdeck/pull/1059',
        reviewedAtCommit: 'head-one',
      });
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

    await Effect.runPromise(deliverReviewVerdictFeedback(options));
    await Effect.runPromise(deliverReviewVerdictFeedback(options));

    const firstKey = mockMessageAgent.mock.calls[0]![3].dedupKey;
    const secondKey = mockMessageAgent.mock.calls[1]![3].dedupKey;
    expect(firstKey).toMatch(/^review-feedback:pan-1059:[a-f0-9]{16}$/);
    expect(secondKey).toBe(firstKey);
    expect(mockSurfaceIssueFeedbackNeedsYou).not.toHaveBeenCalled();
  });

  it('uses a fresh key for a later review run after the anchor resets', async () => {
    mockGetReviewStatus.mockReturnValue({});
    const { deliverReviewVerdictFeedback } = await import(
      '../../../../src/lib/cloister/review-verdict-feedback.js'
    );

    const firstResult = await Effect.runPromise(deliverReviewVerdictFeedback({
      issueId: 'PAN-1059',
      verdict: 'blocked',
      runId: 'agent-pan-1059-review-abcdef12',
    }));
    const secondResult = await Effect.runPromise(deliverReviewVerdictFeedback({
      issueId: 'PAN-1059',
      verdict: 'blocked',
      runId: 'agent-pan-1059-review-fedcba98',
    }));

    expect(firstResult.agentMessageSent).toBe(true);
    expect(secondResult.agentMessageSent).toBe(true);
    expect(mockMessageAgent.mock.calls[0]![3].dedupKey).not.toBe(
      mockMessageAgent.mock.calls[1]![3].dedupKey,
    );
  });

  it('uses the reviewed anchor as fallback identity when no run ID exists', async () => {
    mockGetReviewStatus
      .mockReturnValueOnce({ reviewedAtCommit: 'head-one' })
      .mockReturnValueOnce({ reviewedAtCommit: 'head-two' });
    const { deliverReviewVerdictFeedback } = await import(
      '../../../../src/lib/cloister/review-verdict-feedback.js'
    );

    await Effect.runPromise(deliverReviewVerdictFeedback({
      issueId: 'PAN-1059',
      verdict: 'blocked',
    }));
    await Effect.runPromise(deliverReviewVerdictFeedback({
      issueId: 'PAN-1059',
      verdict: 'blocked',
    }));

    expect(mockMessageAgent.mock.calls[0]![3].dedupKey).not.toBe(
      mockMessageAgent.mock.calls[1]![3].dedupKey,
    );
  });

  it('delivers unkeyed when neither a run ID nor reviewed anchor exists', async () => {
    mockGetReviewStatus.mockReturnValue({});
    const { deliverReviewVerdictFeedback } = await import(
      '../../../../src/lib/cloister/review-verdict-feedback.js'
    );

    const result = await Effect.runPromise(deliverReviewVerdictFeedback({
      issueId: 'PAN-1059',
      verdict: 'blocked',
    }));

    expect(result.agentMessageSent).toBe(true);
    expect(mockMessageAgent).toHaveBeenCalledWith(
      'agent-pan-1059',
      expect.any(String),
      'internal',
      { owesRework: true },
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

    await Effect.runPromise(deliverReviewVerdictFeedback(options));
    expect(mockSurfaceIssueFeedbackNeedsYou).not.toHaveBeenCalled();

    await Effect.runPromise(deliverReviewVerdictFeedback(options));
    expect(mockSurfaceIssueFeedbackNeedsYou).toHaveBeenCalledOnce();
    expect(mockSurfaceIssueFeedbackNeedsYou).toHaveBeenCalledWith(
      'PAN-2059',
      'Review feedback for this verdict was already delivered to the agent; the pipeline re-triggered delivery 3+ times — possible stuck loop. Investigate before the agent context burns.',
      {
        specialist: 'review-agent',
        feedbackPath: '/tmp/workspace/.pan/feedback/001-review-agent-changes-requested.md',
      },
    );

    await Effect.runPromise(deliverReviewVerdictFeedback(options));
    expect(mockSurfaceIssueFeedbackNeedsYou).toHaveBeenCalledOnce();
    expect(mockClearFeedbackDeliveryStuck).toHaveBeenCalledTimes(1);
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

    await Effect.runPromise(deliverReviewVerdictFeedback(options));
    await Effect.runPromise(deliverReviewVerdictFeedback(options));
    expect(mockSurfaceIssueFeedbackNeedsYou).toHaveBeenCalledOnce();

    await Effect.runPromise(deliverReviewVerdictFeedback(options));
    await Effect.runPromise(deliverReviewVerdictFeedback(options));

    expect(mockSurfaceIssueFeedbackNeedsYou).toHaveBeenCalledOnce();
    expect(mockClearFeedbackDeliveryStuck).toHaveBeenCalledTimes(3);
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

describe('ambiguous keyed delivery retry (PAN-1837)', () => {
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
      const promise = Effect.runPromise(deliverReviewVerdictFeedback({
        issueId: 'pan-1059',
        verdict: 'blocked',
        notes: 'correctness blocker',
        workspacePath: workspace,
        runId: 'agent-pan-1059-review-abcdef12',
      }));
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
      const promise = Effect.runPromise(deliverReviewVerdictFeedback({
        issueId: 'pan-1059',
        verdict: 'blocked',
        notes: 'correctness blocker',
        workspacePath: workspace,
        runId: 'agent-pan-1059-review-abcdef12',
      }));
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
