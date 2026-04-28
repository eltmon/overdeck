/**
 * Tests for webhook-handlers.ts (PAN-905)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  handleCheckSuite,
  handleCheckRun,
  handlePullRequest,
  handlePullRequestReview,
  handlePullRequestReviewThread,
  type WebhookPayload,
} from '../../../src/lib/webhook-handlers.js';

// Mock review-status module
const mockGetReviewStatus = vi.fn();
const mockSetReviewStatus = vi.fn();

vi.mock('../../../src/lib/review-status.js', () => ({
  getReviewStatus: (...args: any[]) => mockGetReviewStatus(...args),
  setReviewStatus: (...args: any[]) => mockSetReviewStatus(...args),
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
  it('adds failing_checks blocker on check suite failure', () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    handleCheckSuite(makePayload({
      check_suite: {
        status: 'completed',
        conclusion: 'failure',
        pull_requests: [{ number: 1, head: { ref: 'feature/pan-123' } }],
      },
    }));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-123', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({ type: 'failing_checks' }),
      ]),
    }));
  });

  it('removes failing_checks blocker on check suite success', () => {
    mockGetReviewStatus.mockReturnValue({
      blockerReasons: [{ type: 'failing_checks', summary: 'CI failed', detectedAt: '2026-04-28T10:00:00Z' }],
    });

    handleCheckSuite(makePayload({
      check_suite: {
        status: 'completed',
        conclusion: 'success',
        pull_requests: [{ number: 1, head: { ref: 'feature/pan-123' } }],
      },
    }));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-123', { blockerReasons: undefined });
  });

  it('ignores check suite with no pull requests', () => {
    handleCheckSuite(makePayload({
      check_suite: {
        status: 'completed',
        conclusion: 'failure',
        pull_requests: [],
      },
    }));

    expect(mockSetReviewStatus).not.toHaveBeenCalled();
  });
});

describe('handlePullRequest', () => {
  it('adds draft_pr blocker when PR is draft', () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    handlePullRequest(makePayload({
      action: 'opened',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-456' },
        draft: true,
        mergeable: true,
        mergeable_state: 'clean',
      },
    }));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-456', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({ type: 'draft_pr' }),
      ]),
    }));
  });

  it('removes draft_pr blocker on ready_for_review', () => {
    mockGetReviewStatus.mockReturnValue({
      blockerReasons: [{ type: 'draft_pr', summary: 'Draft', detectedAt: '2026-04-28T10:00:00Z' }],
    });

    handlePullRequest(makePayload({
      action: 'ready_for_review',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-456' },
        draft: false,
        mergeable: true,
        mergeable_state: 'clean',
      },
    }));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-456', { blockerReasons: undefined });
  });

  it('adds merge_conflict blocker when mergeable is false', () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    handlePullRequest(makePayload({
      action: 'synchronize',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-789' },
        mergeable: false,
        mergeable_state: 'dirty',
      },
    }));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-789', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({ type: 'merge_conflict' }),
      ]),
    }));
  });
});

describe('handlePullRequestReview', () => {
  it('adds changes_requested blocker', () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    handlePullRequestReview(makePayload({
      action: 'submitted',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-111' },
      },
      review: { state: 'changes_requested' },
    }));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-111', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({ type: 'changes_requested' }),
      ]),
    }));
  });

  it('removes changes_requested blocker on approval', () => {
    mockGetReviewStatus.mockReturnValue({
      blockerReasons: [{ type: 'changes_requested', summary: 'Changes', detectedAt: '2026-04-28T10:00:00Z' }],
    });

    handlePullRequestReview(makePayload({
      action: 'submitted',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-111' },
      },
      review: { state: 'approved' },
    }));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-111', { blockerReasons: undefined });
  });
});

describe('handlePullRequestReviewThread', () => {
  it('adds unresolved_conversations blocker', () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    handlePullRequestReviewThread(makePayload({
      action: 'unresolved',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-222' },
      },
      thread: { resolved: false },
    }));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-222', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({ type: 'unresolved_conversations' }),
      ]),
    }));
  });

  it('does not remove unresolved_conversations blocker on single thread resolve', () => {
    // Per-thread webhooks make it impossible to know if other threads
    // are still unresolved without querying the GitHub API. We keep the
    // blocker conservative and only clear it on review approval.
    mockGetReviewStatus.mockReturnValue({
      blockerReasons: [{ type: 'unresolved_conversations', summary: 'Unresolved', detectedAt: '2026-04-28T10:00:00Z' }],
    });

    handlePullRequestReviewThread(makePayload({
      action: 'resolved',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-222' },
      },
      thread: { resolved: true },
    }));

    expect(mockSetReviewStatus).not.toHaveBeenCalled();
  });
});
