/**
 * Tests for webhook-handlers.ts (PAN-905)
 */
import { Effect } from 'effect';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  handleCheckSuite,
  handleCheckRun,
  handlePullRequest,
  handlePullRequestReview,
  handlePullRequestReviewThread,
  handleStatus,
  type WebhookPayload,
} from '../../../src/lib/webhook-handlers.js';

// Mock review-status module
const mockGetReviewStatus = vi.fn();
const mockSetReviewStatus = vi.fn();

vi.mock('../../../src/lib/review-status.js', () => ({
  getReviewStatus: (...args: Parameters<typeof mockGetReviewStatus>) => mockGetReviewStatus(...args),
  getReviewStatusSync: (...args: Parameters<typeof mockGetReviewStatus>) => mockGetReviewStatus(...args),
  setReviewStatus: (...args: Parameters<typeof mockSetReviewStatus>) => mockSetReviewStatus(...args),
  setReviewStatusSync: (...args: Parameters<typeof mockSetReviewStatus>) => mockSetReviewStatus(...args),
  getReviewStatus: (...args: Parameters<typeof mockGetReviewStatus>) => Effect.sync(() => mockGetReviewStatus(...args)),
  getReviewStatusSync: (...args: Parameters<typeof mockGetReviewStatus>) => Effect.sync(() => mockGetReviewStatus(...args)),
  // Strip the optional third arg (existing status) so test assertions stay clean.
  setReviewStatus: (...args: [string, Record<string, unknown>]) => Effect.sync(() => mockSetReviewStatus(args[0], args[1])),
  setReviewStatusSync: (...args: [string, Record<string, unknown>]) => Effect.sync(() => mockSetReviewStatus(args[0], args[1])),
}));

// Mock tracker-config so isTrackedRepository passes in tests
vi.mock('../../../src/dashboard/server/services/tracker-config.js', () => ({
  getGitHubConfig: () => ({
    token: 'test-token',
    repos: [{ owner: 'test-owner', repo: 'test-repo' }],
  }),
}));

beforeEach(() => {
  mockGetReviewStatus.mockReturnValue(null);
  mockSetReviewStatus.mockReturnValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

function makePayload(overrides: Partial<WebhookPayload> = {}): WebhookPayload {
  return {
    action: 'completed',
    repository: { full_name: 'test-owner/test-repo' },
    ...overrides,
  };
}

describe('handleCheckSuite', () => {
  it('adds failing_checks blocker on check suite failure', async () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    await Effect.runPromise(handleCheckSuite(makePayload({
      check_suite: {
        status: 'completed',
        conclusion: 'failure',
        pull_requests: [{ number: 1, head: { ref: 'feature/pan-123' } }],
      },
    })));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-123', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({ type: 'failing_checks' }),
      ]),
    }));
  });

  it('removes failing_checks blocker on check suite success', async () => {
    mockGetReviewStatus.mockReturnValue({
      blockerReasons: [{ type: 'failing_checks', summary: 'CI failed', detectedAt: '2026-04-28T10:00:00Z' }],
    });

    await Effect.runPromise(handleCheckSuite(makePayload({
      check_suite: {
        status: 'completed',
        conclusion: 'success',
        pull_requests: [{ number: 1, head: { ref: 'feature/pan-123' } }],
      },
    })));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-123', { blockerReasons: undefined });
  });

  it('ignores check suite with no pull requests', async () => {
    await Effect.runPromise(handleCheckSuite(makePayload({
      check_suite: {
        status: 'completed',
        conclusion: 'failure',
        pull_requests: [],
      },
    })));

    expect(mockSetReviewStatus).not.toHaveBeenCalled();
  });

  it('matches non-PAN project prefixes (MIN, KRUX, AUR, MYN)', async () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    await Effect.runPromise(handleCheckSuite(makePayload({
      check_suite: {
        status: 'completed',
        conclusion: 'failure',
        pull_requests: [{ number: 1, head: { ref: 'feature/min-42' } }],
      },
    })));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('MIN-42', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({ type: 'failing_checks' }),
      ]),
    }));

    await Effect.runPromise(handleCheckSuite(makePayload({
      check_suite: {
        status: 'completed',
        conclusion: 'failure',
        pull_requests: [{ number: 2, head: { ref: 'feature/krux-7' } }],
      },
    })));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('KRUX-7', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({ type: 'failing_checks' }),
      ]),
    }));
  });

  it('processes all PRs in check_suite, not just the first', async () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    await Effect.runPromise(handleCheckSuite(makePayload({
      check_suite: {
        status: 'completed',
        conclusion: 'failure',
        pull_requests: [
          { number: 1, head: { ref: 'feature/pan-100' } },
          { number: 2, head: { ref: 'feature/pan-200' } },
        ],
      },
    })));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-100', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({ type: 'failing_checks' }),
      ]),
    }));
    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-200', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({ type: 'failing_checks' }),
      ]),
    }));
  });
});

describe('handleCheckRun', () => {
  it('adds failing_checks blocker on check run failure', async () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    await Effect.runPromise(handleCheckRun(makePayload({
      check_run: {
        status: 'completed',
        conclusion: 'failure',
        pull_requests: [{ number: 1, head: { ref: 'feature/pan-123' } }],
      },
    })));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-123', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({ type: 'failing_checks' }),
      ]),
    }));
  });

  it('processes all PRs in check_run, not just the first', async () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    await Effect.runPromise(handleCheckRun(makePayload({
      check_run: {
        status: 'completed',
        conclusion: 'failure',
        pull_requests: [
          { number: 1, head: { ref: 'feature/pan-100' } },
          { number: 2, head: { ref: 'feature/pan-200' } },
        ],
      },
    })));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-100', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({ type: 'failing_checks' }),
      ]),
    }));
    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-200', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({ type: 'failing_checks' }),
      ]),
    }));
  });
});

describe('handlePullRequest', () => {
  it('adds draft_pr blocker when PR is draft', async () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    await Effect.runPromise(handlePullRequest(makePayload({
      action: 'opened',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-456' },
        draft: true,
        mergeable: true,
        mergeable_state: 'clean',
      },
    })));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-456', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({ type: 'draft_pr' }),
      ]),
    }));
  });

  it('removes draft_pr blocker on ready_for_review', async () => {
    mockGetReviewStatus.mockReturnValue({
      blockerReasons: [{ type: 'draft_pr', summary: 'Draft', detectedAt: '2026-04-28T10:00:00Z' }],
    });

    await Effect.runPromise(handlePullRequest(makePayload({
      action: 'ready_for_review',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-456' },
        draft: false,
        mergeable: true,
        mergeable_state: 'clean',
      },
    })));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-456', expect.objectContaining({ blockerReasons: undefined }));
  });

  it('adds merge_conflict blocker when mergeable_state is dirty', async () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    await Effect.runPromise(handlePullRequest(makePayload({
      action: 'synchronize',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-789' },
        mergeable: false,
        mergeable_state: 'dirty',
      },
    })));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-789', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({ type: 'merge_conflict' }),
      ]),
    }));
  });

  it('adds merge_conflict fallback when mergeable is false and mergeable_state is unavailable', async () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    await Effect.runPromise(handlePullRequest(makePayload({
      action: 'synchronize',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-789' },
        mergeable: false,
        mergeable_state: null,
      },
    })));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-789', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({ type: 'merge_conflict' }),
      ]),
    }));
  });

  it('adds not_mergeable blocker for behind state', async () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    await Effect.runPromise(handlePullRequest(makePayload({
      action: 'synchronize',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-789' },
        mergeable: false,
        mergeable_state: 'behind',
      },
    })));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-789', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({ type: 'not_mergeable' }),
      ]),
    }));
  });

  it('adds not_mergeable blocker for blocked state', async () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    await Effect.runPromise(handlePullRequest(makePayload({
      action: 'synchronize',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-789' },
        mergeable: false,
        mergeable_state: 'blocked',
      },
    })));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-789', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({ type: 'not_mergeable' }),
      ]),
    }));
  });

  it('does not add merge_conflict for behind state', async () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    await Effect.runPromise(handlePullRequest(makePayload({
      action: 'synchronize',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-789' },
        mergeable: false,
        mergeable_state: 'behind',
      },
    })));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-789', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({ type: 'not_mergeable' }),
      ]),
    }));
    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-789', expect.not.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({ type: 'merge_conflict' }),
      ]),
    }));
  });

  it('leaves blockers unchanged when mergeable_state is unknown', async () => {
    const existingBlockers = [{ type: 'merge_conflict', summary: 'Conflict', detectedAt: '2026-04-28T10:00:00Z' }];
    mockGetReviewStatus.mockReturnValue({ blockerReasons: existingBlockers });

    await Effect.runPromise(handlePullRequest(makePayload({
      action: 'synchronize',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-789' },
        mergeable: null,
        mergeable_state: 'unknown',
      },
    })));

    // Unknown state is left untouched — blockers are written back as-is
    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-789', expect.objectContaining({ blockerReasons: existingBlockers }));
  });

  it('clears merge and not_mergeable blockers on clean state', async () => {
    mockGetReviewStatus.mockReturnValue({
      blockerReasons: [
        { type: 'merge_conflict', summary: 'Conflict', detectedAt: '2026-04-28T10:00:00Z' },
        { type: 'not_mergeable', summary: 'Behind', detectedAt: '2026-04-28T10:00:00Z' },
      ],
    });

    await Effect.runPromise(handlePullRequest(makePayload({
      action: 'synchronize',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-789' },
        mergeable: true,
        mergeable_state: 'clean',
      },
    })));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-789', expect.objectContaining({ blockerReasons: undefined }));
  });

  it('removes changes_requested blocker on review_dismissed action', async () => {
    mockGetReviewStatus.mockReturnValue({
      blockerReasons: [{ type: 'changes_requested', summary: 'Changes', detectedAt: '2026-04-28T10:00:00Z' }],
    });

    await Effect.runPromise(handlePullRequest(makePayload({
      action: 'review_dismissed',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-789' },
        mergeable: true,
        mergeable_state: 'clean',
      },
    })));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-789', expect.objectContaining({ blockerReasons: undefined }));
  });

  it('tolerates head SHA mismatch on synchronize and refreshes prHeadSha', async () => {
    mockGetReviewStatus.mockReturnValue({
      blockerReasons: [],
      prUrl: 'https://github.com/test-owner/test-repo/pull/1',
      prNumber: 1,
      prHeadSha: 'old-sha-123',
    });

    await Effect.runPromise(handlePullRequest(makePayload({
      action: 'synchronize',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-789', sha: 'new-sha-456' },
        mergeable: true,
        mergeable_state: 'clean',
      },
    })));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-789', expect.objectContaining({
      prHeadSha: 'new-sha-456',
    }));
  });

  it('rejects non-synchronize events with head SHA mismatch', async () => {
    mockGetReviewStatus.mockReturnValue({
      blockerReasons: [],
      prUrl: 'https://github.com/test-owner/test-repo/pull/1',
      prNumber: 1,
      prHeadSha: 'old-sha-123',
    });

    await Effect.runPromise(handlePullRequest(makePayload({
      action: 'labeled',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-789', sha: 'new-sha-456' },
        mergeable: true,
        mergeable_state: 'clean',
      },
    })));

    expect(mockSetReviewStatus).not.toHaveBeenCalled();
  });
});

describe('handlePullRequestReview', () => {
  it('adds changes_requested blocker', async () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    await Effect.runPromise(handlePullRequestReview(makePayload({
      action: 'submitted',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-111' },
      },
      review: { state: 'changes_requested' },
    })));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-111', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({ type: 'changes_requested' }),
      ]),
    }));
  });

  it('removes changes_requested blocker on approval', async () => {
    mockGetReviewStatus.mockReturnValue({
      blockerReasons: [{ type: 'changes_requested', summary: 'Changes', detectedAt: '2026-04-28T10:00:00Z' }],
    });

    await Effect.runPromise(handlePullRequestReview(makePayload({
      action: 'submitted',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-111' },
      },
      review: { state: 'approved' },
    })));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-111', { blockerReasons: undefined });
  });

  it('ignores dismissed review state (handled by pull_request review_dismissed action)', async () => {
    mockGetReviewStatus.mockReturnValue({
      blockerReasons: [{ type: 'changes_requested', summary: 'Changes', detectedAt: '2026-04-28T10:00:00Z' }],
    });

    await Effect.runPromise(handlePullRequestReview(makePayload({
      action: 'submitted',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-111' },
      },
      review: { state: 'dismissed' },
    })));

    expect(mockSetReviewStatus).not.toHaveBeenCalled();
  });
});

describe('handlePullRequestReviewThread', () => {
  it('adds unresolved_conversations blocker with thread id tracking', async () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    await Effect.runPromise(handlePullRequestReviewThread(makePayload({
      action: 'unresolved',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-222' },
      },
      thread: { id: 123, resolved: false },
    })));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-222', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({
          type: 'unresolved_conversations',
          details: JSON.stringify(['123']),
        }),
      ]),
    }));
  });

  it('removes unresolved_conversations blocker when all tracked threads are resolved', async () => {
    mockGetReviewStatus.mockReturnValue({
      blockerReasons: [{
        type: 'unresolved_conversations',
        summary: 'Unresolved',
        details: JSON.stringify(['123']),
        detectedAt: '2026-04-28T10:00:00Z',
      }],
    });

    await Effect.runPromise(handlePullRequestReviewThread(makePayload({
      action: 'resolved',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-222' },
      },
      thread: { id: 123, resolved: true },
    })));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-222', { blockerReasons: undefined });
  });

  it('keeps unresolved_conversations blocker when only one of multiple threads is resolved', async () => {
    mockGetReviewStatus.mockReturnValue({
      blockerReasons: [{
        type: 'unresolved_conversations',
        summary: 'Unresolved',
        details: JSON.stringify(['123', '456']),
        detectedAt: '2026-04-28T10:00:00Z',
      }],
    });

    await Effect.runPromise(handlePullRequestReviewThread(makePayload({
      action: 'resolved',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-222' },
      },
      thread: { id: 123, resolved: true },
    })));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-222', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({
          type: 'unresolved_conversations',
          details: JSON.stringify(['456']),
        }),
      ]),
    }));
  });

  it('does not clear blocker on resolve when thread id is absent', async () => {
    // Without a thread id we cannot determine which thread was resolved,
    // so we conservatively keep the blocker.
    mockGetReviewStatus.mockReturnValue({
      blockerReasons: [{
        type: 'unresolved_conversations',
        summary: 'Unresolved',
        details: JSON.stringify(['123']),
        detectedAt: '2026-04-28T10:00:00Z',
      }],
    });

    await Effect.runPromise(handlePullRequestReviewThread(makePayload({
      action: 'resolved',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-222' },
      },
      thread: { resolved: true },
    })));

    expect(mockSetReviewStatus).not.toHaveBeenCalled();
  });

  it('warns when unresolved thread has no id', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    await Effect.runPromise(handlePullRequestReviewThread(makePayload({
      action: 'unresolved',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-222' },
      },
      thread: { resolved: false },
    })));

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Unresolved review thread without id'));
    warnSpy.mockRestore();
  });
});

describe('handleStatus', () => {
  it('adds failing_checks blocker on status failure', async () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    await Effect.runPromise(handleStatus(makePayload({
      state: 'failure',
      branches: [{ name: 'main' }, { name: 'feature/pan-333' }],
    })));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-333', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({ type: 'failing_checks' }),
      ]),
    }));
  });

  it('adds failing_checks blocker on status error', async () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    await Effect.runPromise(handleStatus(makePayload({
      state: 'error',
      branches: [{ name: 'feature/pan-444' }],
    })));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-444', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({ type: 'failing_checks' }),
      ]),
    }));
  });

  it('removes failing_checks blocker on status success', async () => {
    mockGetReviewStatus.mockReturnValue({
      blockerReasons: [{ type: 'failing_checks', summary: 'CI failed', detectedAt: '2026-04-28T10:00:00Z' }],
    });

    await Effect.runPromise(handleStatus(makePayload({
      state: 'success',
      branches: [{ name: 'main' }, { name: 'feature/pan-333' }],
    })));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-333', { blockerReasons: undefined });
  });

  it('skips non-feature branches and acts on the first matching feature branch', async () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    await Effect.runPromise(handleStatus(makePayload({
      state: 'failure',
      branches: [{ name: 'main' }, { name: 'release' }, { name: 'feature/pan-555' }],
    })));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-555', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({ type: 'failing_checks' }),
      ]),
    }));
  });

  it('continues scanning after an unmatched feature branch', async () => {
    mockGetReviewStatus
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ blockerReasons: [] });

    await Effect.runPromise(handleStatus(makePayload({
      state: 'failure',
      sha: 'abc123',
      branches: [{ name: 'feature/pan-111' }, { name: 'feature/pan-222' }],
    })));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-222', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({ type: 'failing_checks' }),
      ]),
    }));
  });

  it('ignores status events with no matching feature branches', async () => {
    await Effect.runPromise(handleStatus(makePayload({
      state: 'failure',
      branches: [{ name: 'main' }, { name: 'release' }],
    })));

    expect(mockSetReviewStatus).not.toHaveBeenCalled();
  });

  it('does not partial-match branches with alphanumeric suffixes', async () => {
    await Effect.runPromise(handleStatus(makePayload({
      state: 'failure',
      branches: [{ name: 'feature/pan-3uwo' }],
    })));

    expect(mockSetReviewStatus).not.toHaveBeenCalled();
  });
});
