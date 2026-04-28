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
  handleStatus,
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
  it('adds unresolved_conversations blocker with thread id tracking', () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    handlePullRequestReviewThread(makePayload({
      action: 'unresolved',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-222' },
      },
      thread: { id: 123, resolved: false },
    }));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-222', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({
          type: 'unresolved_conversations',
          details: JSON.stringify(['123']),
        }),
      ]),
    }));
  });

  it('removes unresolved_conversations blocker when all tracked threads are resolved', () => {
    mockGetReviewStatus.mockReturnValue({
      blockerReasons: [{
        type: 'unresolved_conversations',
        summary: 'Unresolved',
        details: JSON.stringify(['123']),
        detectedAt: '2026-04-28T10:00:00Z',
      }],
    });

    handlePullRequestReviewThread(makePayload({
      action: 'resolved',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-222' },
      },
      thread: { id: 123, resolved: true },
    }));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-222', { blockerReasons: undefined });
  });

  it('keeps unresolved_conversations blocker when only one of multiple threads is resolved', () => {
    mockGetReviewStatus.mockReturnValue({
      blockerReasons: [{
        type: 'unresolved_conversations',
        summary: 'Unresolved',
        details: JSON.stringify(['123', '456']),
        detectedAt: '2026-04-28T10:00:00Z',
      }],
    });

    handlePullRequestReviewThread(makePayload({
      action: 'resolved',
      pull_request: {
        number: 1,
        head: { ref: 'feature/pan-222' },
      },
      thread: { id: 123, resolved: true },
    }));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-222', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({
          type: 'unresolved_conversations',
          details: JSON.stringify(['456']),
        }),
      ]),
    }));
  });

  it('does not clear blocker on resolve when thread id is absent', () => {
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

describe('handleStatus', () => {
  it('adds failing_checks blocker on status failure', () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    handleStatus(makePayload({
      state: 'failure',
      branches: [{ name: 'main' }, { name: 'feature/pan-333' }],
    }));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-333', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({ type: 'failing_checks' }),
      ]),
    }));
  });

  it('adds failing_checks blocker on status error', () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    handleStatus(makePayload({
      state: 'error',
      branches: [{ name: 'feature/pan-444' }],
    }));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-444', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({ type: 'failing_checks' }),
      ]),
    }));
  });

  it('removes failing_checks blocker on status success', () => {
    mockGetReviewStatus.mockReturnValue({
      blockerReasons: [{ type: 'failing_checks', summary: 'CI failed', detectedAt: '2026-04-28T10:00:00Z' }],
    });

    handleStatus(makePayload({
      state: 'success',
      branches: [{ name: 'main' }, { name: 'feature/pan-333' }],
    }));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-333', { blockerReasons: undefined });
  });

  it('skips non-feature branches and acts on the first matching feature branch', () => {
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });

    handleStatus(makePayload({
      state: 'failure',
      branches: [{ name: 'main' }, { name: 'release' }, { name: 'feature/pan-555' }],
    }));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-555', expect.objectContaining({
      blockerReasons: expect.arrayContaining([
        expect.objectContaining({ type: 'failing_checks' }),
      ]),
    }));
  });

  it('ignores status events with no matching feature branches', () => {
    handleStatus(makePayload({
      state: 'failure',
      branches: [{ name: 'main' }, { name: 'release' }],
    }));

    expect(mockSetReviewStatus).not.toHaveBeenCalled();
  });
});
