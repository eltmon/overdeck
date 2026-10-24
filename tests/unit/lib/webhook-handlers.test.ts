/**
 * Tests for webhook-handlers.ts (PAN-905).
 *
 * PAN-3917: the handlers no longer mirror GitHub's merge blockers into a
 * `review_status` row — GitHub owns that state and `cloister/pr-facts` reads it
 * on demand. What is asserted here is the work a webhook does that a read
 * cannot: PR-tab cache invalidation, the default-branch CI observation, the CI
 * failure relay, and the post-merge lifecycle for an out-of-band merge.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getRequestReviewStarter,
  registerRequestReviewStarter,
} from '../../../src/lib/cloister/request-review-pipeline.js';
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
  type WebhookPayload,
} from '../../../src/lib/webhook-handlers.js';

const mockBumpIssuePrTabCacheGeneration = vi.fn();
const mockExecFile = vi.fn();
const mockPostMergeLifecycle = vi.fn();
const mockAppendDomainEventAsync = vi.fn(async () => true);
const mockResolveCiHead = vi.fn(async () => 'abc123');
const mockEnqueueProjectResourceRefresh = vi.fn();
const mockRelayCiFailureFeedback = vi.fn(async () => ({ agentMessageSent: false }));
const mockRecordCiTestGatePass = vi.fn(async () => true);
const mockGetPrFacts = vi.fn();
const mockAdopt = vi.fn(async (..._args: unknown[]) => ({ kind: 'started', workspacePath: '/tmp/test-project/workspaces/feature-pan-1' }));
const mockRefreshIssuePullRequestStateNow = vi.fn();

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
  relayCiFailureFeedback: (...args: Parameters<typeof mockRelayCiFailureFeedback>) =>
    mockRelayCiFailureFeedback(...args),
  recordCiTestGatePass: (...args: Parameters<typeof mockRecordCiTestGatePass>) =>
    mockRecordCiTestGatePass(...args),
}));

vi.mock('../../../src/lib/cloister/pr-facts.js', () => ({
  getPrFacts: (...args: unknown[]) => mockGetPrFacts(...args),
}));

vi.mock('../../../src/lib/overdeck/pull-requests.js', () => ({ fetchIssuePullRequest: vi.fn() }));

vi.mock('../../../src/lib/cloister/merge-agent.js', () => ({
  postMergeLifecycle: (...args: Parameters<typeof mockPostMergeLifecycle>) => mockPostMergeLifecycle(...args),
}));

vi.mock('../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: () => ({ projectKey: 'test-project', projectPath: '/tmp/test-project' }),
  listProjectsSync: () => [{
    key: 'test-project',
    config: {
      name: 'Test Project',
      path: '/tmp/test-project',
      github_repo: 'test-owner/test-repo',
      workspace: { default_branch: 'main' },
    },
  }],
}));

vi.mock('../../../src/dashboard/server/services/project-resource-refresh-queue.js', () => ({
  enqueueProjectResourceRefresh: (...args: Parameters<typeof mockEnqueueProjectResourceRefresh>) =>
    mockEnqueueProjectResourceRefresh(...args),
}));

vi.mock('../../../src/lib/cloister/pr-adoption-review.js', () => ({
  adoptPrAndStartReview: (...args: unknown[]) => mockAdopt(...args),
}));

vi.mock('../../../src/dashboard/server/services/issue-pr-refresh.js', () => ({
  refreshIssuePullRequestStateNow: (...args: unknown[]) => mockRefreshIssuePullRequestStateNow(...args),
}));

vi.mock('../../../src/lib/activity-logger.js', () => ({
  appendDomainEventAsync: (...args: Parameters<typeof mockAppendDomainEventAsync>) =>
    mockAppendDomainEventAsync(...args),
}));

vi.mock('../../../src/lib/ci/project-ci-github.js', () => ({
  resolveCiHead: (...args: unknown[]) => mockResolveCiHead(...args),
}));

vi.mock('node:child_process', () => ({ execFile: (...args: unknown[]) => mockExecFile(...args) }));
vi.mock('child_process', () => ({ execFile: (...args: unknown[]) => mockExecFile(...args) }));

beforeEach(() => {
  mockResolveCiHead.mockResolvedValue('abc123');
  mockGetPrFacts.mockResolvedValue({ open: true, number: 7, url: 'https://github.com/test-owner/test-repo/pull/7' });
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
  it('relays a CI failure to the work agent with the PR identity from the payload', async () => {
    await handleCheckSuite(makePayload({
      check_suite: {
        status: 'completed',
        conclusion: 'failure',
        pull_requests: [{ number: 11, head: { ref: 'feature/pan-123', sha: 'deadbee' } }],
      },
    }));

    expect(mockRelayCiFailureFeedback).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-123',
      prNumber: 11,
      headSha: 'deadbee',
      prUrl: 'https://github.com/test-owner/test-repo/pull/11',
      source: 'check_suite',
    }));
    expect(mockBumpIssuePrTabCacheGeneration).toHaveBeenCalledWith('PAN-123');
  });

  it('does not relay on a successful check suite', async () => {
    await handleCheckSuite(makePayload({
      check_suite: {
        status: 'completed',
        conclusion: 'success',
        pull_requests: [{ number: 1, head: { ref: 'feature/pan-123', sha: 'abc' } }],
      },
    }));

    expect(mockRelayCiFailureFeedback).not.toHaveBeenCalled();
    expect(mockBumpIssuePrTabCacheGeneration).toHaveBeenCalledWith('PAN-123');
  });

  it('ignores a check suite with no pull requests', async () => {
    await handleCheckSuite(makePayload({
      check_suite: { status: 'completed', conclusion: 'failure', pull_requests: [] },
    }));

    expect(mockRelayCiFailureFeedback).not.toHaveBeenCalled();
  });

  it('appends a project CI observation for a default-branch suite with no pull requests', async () => {
    await handleCheckSuite(makePayload({
      check_suite: {
        id: 42,
        status: 'in_progress',
        conclusion: null,
        head_branch: 'main',
        head_sha: 'abc123',
        app: { slug: 'github-actions' },
        pull_requests: [],
      },
    }));

    expect(mockAppendDomainEventAsync).toHaveBeenCalledTimes(1);
    expect(mockAppendDomainEventAsync.mock.calls[0]![0]).toMatchObject({
      type: 'project.ci_suite_observed',
    });
  });

  it('ignores an untracked repository', async () => {
    await handleCheckSuite({
      action: 'completed',
      repository: { full_name: 'someone-else/other-repo' },
      check_suite: {
        status: 'completed',
        conclusion: 'failure',
        pull_requests: [{ number: 1, head: { ref: 'feature/pan-123', sha: 'abc' } }],
      },
    });

    expect(mockRelayCiFailureFeedback).not.toHaveBeenCalled();
    expect(mockBumpIssuePrTabCacheGeneration).not.toHaveBeenCalled();
  });

  it('resolves a failing suite with empty pull_requests by head (PAN-4432)', async () => {
    mockGetPrFacts.mockResolvedValue({
      open: true,
      number: 9,
      headSha: 'abc123',
      headBranch: 'feature/pan-77',
    });

    await handleCheckSuite(makePayload({
      check_suite: {
        status: 'completed',
        conclusion: 'failure',
        head_branch: 'feature/pan-77',
        head_sha: 'abc123',
        pull_requests: [],
      },
    }));

    expect(mockRelayCiFailureFeedback).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-77',
      prNumber: 9,
      source: 'check_suite',
    }));
  });
});

describe('handleCheckRun', () => {
  it('relays a failing non-advisory check run', async () => {
    await handleCheckRun(makePayload({
      check_run: {
        name: 'build',
        conclusion: 'failure',
        pull_requests: [{ number: 5, head: { ref: 'feature/pan-123', sha: 'cafe' } }],
      },
    }));

    expect(mockRelayCiFailureFeedback).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-123',
      prNumber: 5,
      source: 'check_run:build',
    }));
  });

  it('hands the relay the failed check it fired on (PAN-4534)', async () => {
    await handleCheckRun(makePayload({
      check_run: {
        id: 456,
        name: 'test-shard (4/4)',
        conclusion: 'failure',
        details_url: 'https://github.com/o/r/actions/runs/900/job/456',
        app: { slug: 'github-actions' },
        pull_requests: [{ number: 5, head: { ref: 'feature/pan-123', sha: 'cafe' } }],
      },
    }));

    expect(mockRelayCiFailureFeedback).toHaveBeenCalledWith(expect.objectContaining({
      trigger: { name: 'test-shard (4/4)', url: 'https://github.com/o/r/actions/runs/900/job/456', jobId: 456 },
    }));
  });

  it('bumps the cache but never relays for an advisory check run', async () => {
    await handleCheckRun(makePayload({
      check_run: {
        name: 'CodeRabbit',
        conclusion: 'failure',
        pull_requests: [{ number: 5, head: { ref: 'feature/pan-123', sha: 'cafe' } }],
      },
    }));

    expect(mockBumpIssuePrTabCacheGeneration).toHaveBeenCalledWith('PAN-123');
    expect(mockRelayCiFailureFeedback).not.toHaveBeenCalled();
  });

  it('processes every PR on the check run, not just the first', async () => {
    await handleCheckRun(makePayload({
      check_run: {
        name: 'build',
        conclusion: 'failure',
        pull_requests: [
          { number: 5, head: { ref: 'feature/pan-123', sha: 'a' } },
          { number: 6, head: { ref: 'feature/min-42', sha: 'b' } },
        ],
      },
    }));

    expect(mockBumpIssuePrTabCacheGeneration).toHaveBeenCalledWith('PAN-123');
    expect(mockBumpIssuePrTabCacheGeneration).toHaveBeenCalledWith('MIN-42');
    expect(mockRelayCiFailureFeedback).toHaveBeenCalledTimes(2);
  });

  it('records a green CI test job as the verification reset (PAN-3965)', async () => {
    await handleCheckRun(makePayload({
      check_run: {
        name: 'test (22)',
        conclusion: 'success',
        pull_requests: [{ number: 5, head: { ref: 'feature/pan-123', sha: 'cafe' } }],
      },
    }));

    expect(mockRecordCiTestGatePass).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-123',
      headSha: 'cafe',
      headRef: 'feature/pan-123',
    }));
    expect(mockRelayCiFailureFeedback).not.toHaveBeenCalled();
  });

  it('records nothing for a green non-test check (PAN-3965)', async () => {
    await handleCheckRun(makePayload({
      check_run: {
        name: 'lint',
        conclusion: 'success',
        pull_requests: [{ number: 5, head: { ref: 'feature/pan-123', sha: 'cafe' } }],
      },
    }));

    expect(mockRecordCiTestGatePass).not.toHaveBeenCalled();
  });

  it('resolves an empty pull_requests array by head branch and SHA (PAN-4432)', async () => {
    mockGetPrFacts.mockResolvedValue({
      open: true,
      number: 9,
      headSha: 'abc123',
      headBranch: 'feature/pan-77',
    });

    await handleCheckRun(makePayload({
      check_run: {
        name: 'test-shard (2/4)',
        conclusion: 'failure',
        head_sha: 'abc123',
        check_suite: { head_branch: 'feature/pan-77' },
        pull_requests: [],
      },
    }));

    expect(mockRelayCiFailureFeedback).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-77',
      prNumber: 9,
      headSha: 'abc123',
      headRef: 'feature/pan-77',
    }));
  });

  it('does not relay when the open PR has moved past the run\'s head (PAN-4432)', async () => {
    mockGetPrFacts.mockResolvedValue({
      open: true,
      number: 9,
      headSha: 'def456',
      headBranch: 'feature/pan-77',
    });

    await handleCheckRun(makePayload({
      check_run: {
        name: 'test-shard (2/4)',
        conclusion: 'failure',
        head_sha: 'abc123',
        check_suite: { head_branch: 'feature/pan-77' },
        pull_requests: [],
      },
    }));

    expect(mockRelayCiFailureFeedback).not.toHaveBeenCalled();
  });

  it('makes no forge read for an in-progress run with empty pull_requests (PAN-4432)', async () => {
    await handleCheckRun(makePayload({
      check_run: {
        name: 'test-shard (2/4)',
        status: 'in_progress',
        conclusion: null,
        head_sha: 'abc123',
        check_suite: { head_branch: 'feature/pan-77' },
        pull_requests: [],
      },
    }));

    expect(mockGetPrFacts).not.toHaveBeenCalled();
  });

  it('skips a run whose head_branch names no issue (PAN-4432)', async () => {
    await handleCheckRun(makePayload({
      check_run: {
        name: 'test-shard (2/4)',
        conclusion: 'failure',
        head_sha: 'abc123',
        check_suite: { head_branch: null },
        pull_requests: [],
      },
    }));

    expect(mockGetPrFacts).not.toHaveBeenCalled();
    expect(mockRelayCiFailureFeedback).not.toHaveBeenCalled();
  });
});

describe('handlePullRequest', () => {
  it('fires postMergeLifecycle when GitHub reports the PR closed and merged', async () => {
    await handlePullRequest(makePayload({
      action: 'closed',
      pull_request: {
        number: 9,
        head: { ref: 'feature/pan-123', sha: 'abc' },
        state: 'closed',
        merged: true,
      },
    }));

    expect(mockPostMergeLifecycle).toHaveBeenCalledWith(
      'PAN-123',
      '/tmp/test-project',
      'feature/pan-123',
    );
  });

  it('does not fire postMergeLifecycle for a PR closed without merging', async () => {
    await handlePullRequest(makePayload({
      action: 'closed',
      pull_request: {
        number: 9,
        head: { ref: 'feature/pan-123', sha: 'abc' },
        state: 'closed',
        merged: false,
      },
    }));

    expect(mockPostMergeLifecycle).not.toHaveBeenCalled();
  });

  it('enqueues a membership refresh on open, closed and reopened', async () => {
    for (const action of ['opened', 'closed', 'reopened']) {
      await handlePullRequest(makePayload({
        action,
        pull_request: { number: 9, head: { ref: 'feature/pan-123', sha: 'abc' } },
      }));
    }

    expect(mockEnqueueProjectResourceRefresh).toHaveBeenCalledTimes(3);
  });

  it('bumps the PR tab cache for any pull_request action', async () => {
    await handlePullRequest(makePayload({
      action: 'synchronize',
      pull_request: { number: 9, head: { ref: 'feature/pan-123', sha: 'abc' } },
    }));

    expect(mockBumpIssuePrTabCacheGeneration).toHaveBeenCalledWith('PAN-123');
  });
});

describe('handlePullRequest → review pipeline (PAN-3917 W12)', () => {
  const startReview = vi.fn(async () => ({ started: true as const }));

  beforeEach(() => {
    startReview.mockClear();
    startReview.mockResolvedValue({ started: true as const });
    registerRequestReviewStarter(startReview);
  });

  afterEach(() => {
    registerRequestReviewStarter(null);
  });

  it('starts the review pipeline when a PR is opened', async () => {
    await handlePullRequest(makePayload({
      action: 'opened',
      pull_request: { number: 9, head: { ref: 'feature/pan-123', sha: 'abc' }, draft: false },
    }));

    expect(startReview).toHaveBeenCalledTimes(1);
    expect(startReview.mock.calls[0]![0]).toBe('PAN-123');
  });

  it('starts the review pipeline when a draft PR is readied', async () => {
    await handlePullRequest(makePayload({
      action: 'ready_for_review',
      pull_request: { number: 9, head: { ref: 'feature/pan-123', sha: 'abc' }, draft: false },
    }));

    expect(startReview).toHaveBeenCalledTimes(1);
  });

  it('does not start review for a draft PR, another action, or a merged PR', async () => {
    await handlePullRequest(makePayload({
      action: 'opened',
      pull_request: { number: 9, head: { ref: 'feature/pan-123', sha: 'abc' }, draft: true },
    }));
    await handlePullRequest(makePayload({
      action: 'synchronize',
      pull_request: { number: 9, head: { ref: 'feature/pan-123', sha: 'abc' } },
    }));
    await handlePullRequest(makePayload({
      action: 'opened',
      pull_request: { number: 9, head: { ref: 'feature/pan-123', sha: 'abc' }, state: 'closed', merged: true },
    }));

    expect(startReview).not.toHaveBeenCalled();
  });

  it('does not start review for a strike or bypass PR — the pipeline reviews feature/<issue>', async () => {
    await handlePullRequest(makePayload({
      action: 'opened',
      pull_request: { number: 9, head: { ref: 'bypass/pan-123', sha: 'abc' } },
    }));
    await handlePullRequest(makePayload({
      action: 'opened',
      pull_request: { number: 9, head: { ref: 'strike/pan-123', sha: 'abc' } },
    }));

    expect(startReview).not.toHaveBeenCalled();
  });

  it('does not start review for an untracked repo or a branch with no issue', async () => {
    await handlePullRequest({
      action: 'opened',
      repository: { full_name: 'someone-else/repo' },
      pull_request: { number: 9, head: { ref: 'feature/pan-123', sha: 'abc' } },
    });
    await handlePullRequest(makePayload({
      action: 'opened',
      pull_request: { number: 9, head: { ref: 'chore/cleanup', sha: 'abc' } },
    }));

    expect(startReview).not.toHaveBeenCalled();
  });

  it('a starter that rejects does not fail the webhook', async () => {
    startReview.mockRejectedValue(new Error('dashboard is mid-restart'));

    await expect(handlePullRequest(makePayload({
      action: 'opened',
      pull_request: { number: 9, head: { ref: 'feature/pan-123', sha: 'abc' } },
    }))).resolves.toBeUndefined();
  });

  it('adopts the PR into a workspace when the starter answers no-workspace (PAN-4605)', async () => {
    startReview.mockResolvedValue({ started: false, reason: 'no-workspace' } as never);

    await handlePullRequest(makePayload({
      action: 'opened',
      pull_request: { number: 9, head: { ref: 'feature/pan-1', sha: 'f00d' }, draft: false },
    }));

    expect(mockAdopt).toHaveBeenCalledTimes(1);
    expect(mockAdopt).toHaveBeenCalledWith(
      { issueId: 'PAN-1', number: 9, headRef: 'feature/pan-1', headSha: 'f00d', repo: 'test-owner/test-repo' },
      { source: 'webhook', startReview },
    );
  });

  it('does not adopt for any other review-start refusal (PAN-4605)', async () => {
    startReview.mockResolvedValueOnce({ started: false, reason: 'dirty-workspace', error: 'bun.lock' } as never);
    startReview.mockResolvedValueOnce({ started: false, reason: 'already-running' } as never);

    for (let delivery = 0; delivery < 2; delivery += 1) {
      await handlePullRequest(makePayload({
        action: 'opened',
        pull_request: { number: 9, head: { ref: 'feature/pan-1', sha: 'f00d' } },
      }));
    }

    expect(startReview).toHaveBeenCalledTimes(2);

    expect(mockAdopt).not.toHaveBeenCalled();
  });

  it('an adopter that rejects does not fail the webhook (PAN-4605)', async () => {
    startReview.mockResolvedValue({ started: false, reason: 'no-workspace' } as never);
    mockAdopt.mockRejectedValueOnce(new Error('adoption blew up'));

    await expect(handlePullRequest(makePayload({
      action: 'opened',
      pull_request: { number: 9, head: { ref: 'feature/pan-1', sha: 'f00d' } },
    }))).resolves.toBeUndefined();
  });

  it('refreshes the issue PR state now on opened and ready_for_review (PAN-4605)', async () => {
    for (const action of ['opened', 'ready_for_review']) {
      await handlePullRequest(makePayload({
        action,
        pull_request: { number: 9, head: { ref: 'feature/pan-1', sha: 'f00d' } },
      }));
    }

    expect(mockRefreshIssuePullRequestStateNow).toHaveBeenCalledTimes(2);
    expect(mockRefreshIssuePullRequestStateNow).toHaveBeenCalledWith('PAN-1');
  });

  it('no registered starter is not a failure', async () => {
    registerRequestReviewStarter(null);
    expect(getRequestReviewStarter()).toBeNull();

    await expect(handlePullRequest(makePayload({
      action: 'opened',
      pull_request: { number: 9, head: { ref: 'feature/pan-123', sha: 'abc' } },
    }))).resolves.toBeUndefined();
  });
});

describe('handlePullRequestReview / ReviewComment / ReviewThread', () => {
  it('bumps the PR tab cache and writes nothing back', async () => {
    const pull_request = { number: 9, head: { ref: 'feature/pan-123', sha: 'abc' } };

    await handlePullRequestReview(makePayload({
      action: 'submitted', pull_request, review: { state: 'changes_requested' },
    }));
    await handlePullRequestReviewComment(makePayload({ pull_request }));
    await handlePullRequestReviewThread(makePayload({
      pull_request, thread: { id: 1, resolved: false },
    }));

    expect(mockBumpIssuePrTabCacheGeneration).toHaveBeenCalledTimes(3);
    expect(mockBumpIssuePrTabCacheGeneration).toHaveBeenCalledWith('PAN-123');
  });
});

describe('handleIssueComment', () => {
  it('asks the forge which issue the commented PR belongs to', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, { stdout: JSON.stringify({ headRefName: 'feature/pan-123' }), stderr: '' });
    });

    await handleIssueComment(makePayload({
      issue: { number: 9, pull_request: {} },
    }));

    expect(mockBumpIssuePrTabCacheGeneration).toHaveBeenCalledWith('PAN-123');
  });

  it('ignores a comment on a plain issue', async () => {
    await handleIssueComment(makePayload({ issue: { number: 9 } }));

    expect(mockBumpIssuePrTabCacheGeneration).not.toHaveBeenCalled();
  });
});

describe('handleStatus', () => {
  it('relays a failing commit status using the PR identity the forge reports', async () => {
    await handleStatus(makePayload({
      state: 'failure',
      sha: 'feedface',
      context: 'ci/build',
      branches: [{ name: 'feature/pan-123' }],
    }));

    expect(mockGetPrFacts).toHaveBeenCalledWith('PAN-123');
    expect(mockRelayCiFailureFeedback).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-123',
      prNumber: 7,
      headSha: 'feedface',
      source: 'status:ci/build',
    }));
  });

  it('never relays an advisory context', async () => {
    await handleStatus(makePayload({
      state: 'failure',
      sha: 'feedface',
      context: 'coderabbitai',
      branches: [{ name: 'feature/pan-123' }],
    }));

    expect(mockBumpIssuePrTabCacheGeneration).toHaveBeenCalledWith('PAN-123');
    expect(mockRelayCiFailureFeedback).not.toHaveBeenCalled();
  });

  it('skips non-feature branches', async () => {
    await handleStatus(makePayload({
      state: 'failure',
      sha: 'feedface',
      branches: [{ name: 'main' }],
    }));

    expect(mockRelayCiFailureFeedback).not.toHaveBeenCalled();
  });

  it('does not relay when the forge has no open PR for the issue', async () => {
    mockGetPrFacts.mockResolvedValue({ open: false, number: null, url: null });

    await handleStatus(makePayload({
      state: 'error',
      sha: 'feedface',
      branches: [{ name: 'feature/pan-123' }],
    }));

    expect(mockRelayCiFailureFeedback).not.toHaveBeenCalled();
  });

  it('records the CI test gate pass for a green Dagger Cloud test status (PAN-4589)', async () => {
    await handleStatus(makePayload({
      state: 'success',
      sha: 'feedface',
      context: 'go-client/test',
      target_url: 'https://dagger.cloud/o/checks/github.com/o/r@feedface?check=go-client/test',
      branches: [{ name: 'feature/pan-1801' }],
    }));

    expect(mockRecordCiTestGatePass).toHaveBeenCalledOnce();
    expect(mockRecordCiTestGatePass).toHaveBeenCalledWith({
      issueId: 'PAN-1801',
      headSha: 'feedface',
      headRef: 'feature/pan-1801',
      source: 'status:go-client/test',
    });
    expect(mockRelayCiFailureFeedback).not.toHaveBeenCalled();
  });

  it('does not record a pass for a green non-test Dagger status (PAN-4589)', async () => {
    await handleStatus(makePayload({
      state: 'success',
      sha: 'feedface',
      context: 'helm/lint',
      target_url: 'https://dagger.cloud/o/checks/github.com/o/r@feedface?check=helm/lint',
      branches: [{ name: 'feature/pan-1801' }],
    }));

    expect(mockRecordCiTestGatePass).not.toHaveBeenCalled();
  });

  it('does not record a pass for a green test-named status whose URL is not Dagger Cloud (PAN-4589)', async () => {
    await handleStatus(makePayload({
      state: 'success',
      sha: 'feedface',
      context: 'go-client/test',
      target_url: 'https://buildkite.com/o/p/builds/1',
      branches: [{ name: 'feature/pan-1801' }],
    }));

    expect(mockRecordCiTestGatePass).not.toHaveBeenCalled();
  });
});
