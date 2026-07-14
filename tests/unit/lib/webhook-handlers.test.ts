/**
 * Tests for webhook-handlers.ts (PAN-905)
 */
import { Effect } from 'effect';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  handleCheckSuite,
  handleCheckRun,
  handleIssueComment,
  handlePullRequest,
  handlePullRequestReview,
  handlePullRequestReviewComment,
  handlePullRequestReviewThread,
  handleStatus,
  issueIdFromBranch,
  needsBlockerReconciliation,
  refreshMergeStateFromGitHub,
  type WebhookPayload,
} from '../../../src/lib/webhook-handlers.js';

// Mock review-status module
const mockGetReviewStatus = vi.fn();
const mockSetReviewStatus = vi.fn();
const mockLoadReviewStatuses = vi.fn();
const mockBumpIssuePrTabCacheGeneration = vi.fn();
const mockIsGitHubAppConfigured = vi.fn();
const mockGetPullRequestState = vi.fn();
const mockExecFile = vi.fn();
const mockPostMergeLifecycle = vi.fn();
let ghPrViewStdout = '';

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
  loadReviewStatuses: () => mockLoadReviewStatuses(),
}));

vi.mock('../../../src/dashboard/server/services/pr-tab-cache.js', () => ({
  bumpIssuePrTabCacheGeneration: (...args: Parameters<typeof mockBumpIssuePrTabCacheGeneration>) =>
    mockBumpIssuePrTabCacheGeneration(...args),
}));

// Mock tracker-config so isTrackedRepository passes in tests
vi.mock('../../../src/dashboard/server/services/tracker-config.js', () => ({
  getGitHubConfig: () => ({
    token: 'test-token',
    repos: [{ owner: 'test-owner', repo: 'test-repo' }],
  }),
}));

vi.mock('../../../src/lib/cloister/ci-failure-feedback.js', () => ({
  relayCiFailureFeedback: () => Effect.succeed({ agentMessageSent: false }),
}));

vi.mock('../../../src/lib/cloister/merge-agent.js', () => ({
  postMergeLifecycle: (...args: Parameters<typeof mockPostMergeLifecycle>) => mockPostMergeLifecycle(...args),
}));

vi.mock('../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: () => ({ projectPath: '/tmp/test-project' }),
}));

vi.mock('../../../src/lib/github-app.js', () => ({
  isGitHubAppConfigured: () => mockIsGitHubAppConfigured(),
  getPullRequestState: (owner: string, repo: string, number: number) =>
    mockGetPullRequestState(owner, repo, number),
}));

vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

beforeEach(() => {
  mockGetReviewStatus.mockReturnValue(null);
  mockSetReviewStatus.mockReturnValue(undefined);
  mockLoadReviewStatuses.mockReturnValue({});
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

describe('issueIdFromBranch', () => {
  it('parses feature, strike, and bypass issue refs', () => {
    expect(issueIdFromBranch('feature/pan-123')).toBe('PAN-123');
    expect(issueIdFromBranch('strike/pan-123')).toBe('PAN-123');
    expect(issueIdFromBranch('bypass/pan-2564')).toBe('PAN-2564');
    expect(issueIdFromBranch('main')).toBeNull();
    expect(issueIdFromBranch('uat/pan-slate-0625')).toBeNull();
  });
});

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

  it('invalidates PR tab cache for check suite events', async () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    await Effect.runPromise(handleCheckSuite(makePayload({
      check_suite: {
        status: 'completed',
        conclusion: 'success',
        pull_requests: [{ number: 1, head: { ref: 'feature/pan-123' } }],
      },
    })));

    expect(mockBumpIssuePrTabCacheGeneration).toHaveBeenCalledWith('PAN-123');
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

  it('invalidates PR tab cache for check run events', async () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    await Effect.runPromise(handleCheckRun(makePayload({
      check_run: {
        status: 'completed',
        conclusion: 'success',
        pull_requests: [{ number: 1, head: { ref: 'feature/pan-123' } }],
      },
    })));

    expect(mockBumpIssuePrTabCacheGeneration).toHaveBeenCalledWith('PAN-123');
  });
});

describe('handlePullRequest', () => {
  it('dispatches postMergeLifecycle with review passed marking for merged strike PRs', async () => {
    mockPostMergeLifecycle.mockResolvedValue(undefined);

    await Effect.runPromise(handlePullRequest(makePayload({
      action: 'closed',
      pull_request: {
        number: 1,
        head: { ref: 'strike/pan-123' },
        merged: true,
      },
    })));

    expect(mockPostMergeLifecycle).toHaveBeenCalledWith('PAN-123', '/tmp/test-project', 'strike/pan-123', {
      markReviewPassed: true,
    });
  });

  it('bumps PR tab cache generation for the affected issue', async () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    await Effect.runPromise(handlePullRequest(makePayload({
      action: 'synchronize',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-456' },
        mergeable: true,
        mergeable_state: 'clean',
      },
    })));

    expect(mockBumpIssuePrTabCacheGeneration).toHaveBeenCalledWith('PAN-456');
  });

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
  it('bumps PR tab cache generation for the reviewed issue', async () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    await Effect.runPromise(handlePullRequestReview(makePayload({
      action: 'submitted',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-111' },
      },
      review: { state: 'approved' },
    })));

    expect(mockBumpIssuePrTabCacheGeneration).toHaveBeenCalledWith('PAN-111');
  });

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

describe('handleIssueComment', () => {
  it('bumps PR tab cache generation for the status matching repo and PR number', async () => {
    mockLoadReviewStatuses.mockReturnValue({
      'PAN-222': {
        prNumber: 22,
        prUrl: 'https://github.com/test-owner/test-repo/pull/22',
      },
      'PAN-333': {
        prNumber: 22,
        prUrl: 'https://github.com/test-owner/other-repo/pull/22',
      },
      'PAN-444': {
        prNumber: 44,
        prUrl: 'https://github.com/test-owner/test-repo/pull/44',
      },
    });

    await Effect.runPromise(handleIssueComment(makePayload({
      action: 'created',
      issue: {
        number: 22,
        pull_request: { url: 'https://api.github.com/repos/test-owner/test-repo/pulls/22' },
      },
    })));

    expect(mockBumpIssuePrTabCacheGeneration).toHaveBeenCalledTimes(1);
    expect(mockBumpIssuePrTabCacheGeneration).toHaveBeenCalledWith('PAN-222');
  });
});

describe('handlePullRequestReviewComment', () => {
  it('bumps PR tab cache generation for inline PR review comments', async () => {
    await Effect.runPromise(handlePullRequestReviewComment(makePayload({
      action: 'created',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-555' },
      },
    })));

    expect(mockBumpIssuePrTabCacheGeneration).toHaveBeenCalledWith('PAN-555');
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

  it('invalidates PR tab cache for status events', async () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    await Effect.runPromise(handleStatus(makePayload({
      state: 'success',
      branches: [{ name: 'feature/pan-333' }],
    })));

    expect(mockBumpIssuePrTabCacheGeneration).toHaveBeenCalledWith('PAN-333');
  });
});

describe('needsBlockerReconciliation (PAN-1771)', () => {
  const ghBlocker = { type: 'failing_checks' as const, summary: 'Required checks are failing', detectedAt: '2026-06-11T01:39:00Z' };

  it('returns PR identity for a non-merged status with a GitHub-native blocker', () => {
    expect(needsBlockerReconciliation({
      mergeStatus: 'pending',
      blockerReasons: [ghBlocker],
      prUrl: 'https://github.com/test-owner/test-repo/pull/1713',
      prNumber: 1713,
    })).toEqual({ repo: 'test-owner/test-repo', prNumber: 1713 });
  });

  it('parses the PR number from prUrl when prNumber is absent', () => {
    expect(needsBlockerReconciliation({
      mergeStatus: 'pending',
      blockerReasons: [ghBlocker],
      prUrl: 'https://github.com/test-owner/test-repo/pull/42',
    })).toEqual({ repo: 'test-owner/test-repo', prNumber: 42 });
  });

  it('skips merged statuses', () => {
    expect(needsBlockerReconciliation({
      mergeStatus: 'merged',
      blockerReasons: [ghBlocker],
      prUrl: 'https://github.com/test-owner/test-repo/pull/1713',
      prNumber: 1713,
    })).toBeNull();
  });

  it('skips statuses without blockers', () => {
    expect(needsBlockerReconciliation({
      mergeStatus: 'pending',
      blockerReasons: [],
      prUrl: 'https://github.com/test-owner/test-repo/pull/1713',
      prNumber: 1713,
    })).toBeNull();
  });

  it('skips statuses whose only blockers are not GitHub-native', () => {
    expect(needsBlockerReconciliation({
      mergeStatus: 'pending',
      blockerReasons: [{ type: 'unresolved_conversations', summary: 'Open review threads', detectedAt: '2026-06-11T01:39:00Z' }],
      prUrl: 'https://github.com/test-owner/test-repo/pull/1713',
      prNumber: 1713,
    })).toBeNull();
  });

  it('skips statuses without a resolvable PR identity', () => {
    expect(needsBlockerReconciliation({
      mergeStatus: 'pending',
      blockerReasons: [ghBlocker],
    })).toBeNull();
  });
});

describe('refreshMergeStateFromGitHub (PAN-2265)', () => {
  function makeAppPrState(overrides: Partial<{
    mergeable: boolean | null;
    mergeableState: string;
    draft: boolean;
    checksFailed: boolean;
  }> = {}) {
    return Effect.succeed({
      owner: 'test-owner',
      repo: 'test-repo',
      number: 42,
      state: 'OPEN' as const,
      merged: false,
      mergeable: overrides.mergeable ?? true,
      mergeableState: overrides.mergeableState ?? 'clean',
      draft: overrides.draft ?? false,
      headSha: 'abc',
      baseBranch: 'main',
      checksPending: false,
      checksFailed: overrides.checksFailed ?? false,
    });
  }

  beforeEach(() => {
    // default: App configured, clean/mergeable PR
    mockIsGitHubAppConfigured.mockReturnValue(true);
    mockGetPullRequestState.mockReturnValue(makeAppPrState());
    ghPrViewStdout = '';
  });

  it('uses the App REST path (not gh) when the App is configured', async () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });
    mockGetPullRequestState.mockReturnValue(makeAppPrState({ mergeable: false, mergeableState: 'dirty' }));

    await refreshMergeStateFromGitHub('PAN-1', 'test-owner/test-repo', 42);

    expect(mockGetPullRequestState).toHaveBeenCalledWith('test-owner', 'test-repo', 42);
    expect(mockExecFile).not.toHaveBeenCalled();
    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-1', expect.objectContaining({
      blockerReasons: expect.arrayContaining([expect.objectContaining({ type: 'merge_conflict' })]),
    }));
  });

  it('maps App checksFailed to failing_checks blocker', async () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });
    mockGetPullRequestState.mockReturnValue(makeAppPrState({ checksFailed: true }));

    await refreshMergeStateFromGitHub('PAN-2', 'test-owner/test-repo', 42);

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-2', expect.objectContaining({
      blockerReasons: expect.arrayContaining([expect.objectContaining({ type: 'failing_checks' })]),
    }));
  });

  it('maps App draft to draft_pr blocker', async () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });
    mockGetPullRequestState.mockReturnValue(makeAppPrState({ draft: true }));

    await refreshMergeStateFromGitHub('PAN-3', 'test-owner/test-repo', 42);

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-3', expect.objectContaining({
      blockerReasons: expect.arrayContaining([expect.objectContaining({ type: 'draft_pr' })]),
    }));
  });

  it('falls back to gh pr view when the App is not configured', async () => {
    mockIsGitHubAppConfigured.mockReturnValue(false);
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });
    ghPrViewStdout = JSON.stringify({
      mergeable: 'CONFLICTING',
      mergeStateStatus: 'DIRTY',
      isDraft: false,
      statusCheckRollup: [{ conclusion: 'FAILURE' }],
    });
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: unknown, res: { stdout: string; stderr: string }) => void;
      cb(null, { stdout: ghPrViewStdout, stderr: '' });
    });

    await refreshMergeStateFromGitHub('PAN-4', 'test-owner/test-repo', 42);

    expect(mockGetPullRequestState).not.toHaveBeenCalled();
    expect(mockExecFile).toHaveBeenCalled();
    const [cmd, ghArgs] = mockExecFile.mock.calls[0] as [string, string[]];
    expect(cmd).toBe('gh');
    expect(ghArgs).toContain('view');
    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-4', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({ type: 'merge_conflict' }),
        expect.objectContaining({ type: 'failing_checks' }),
      ]),
    }));
  });
});
