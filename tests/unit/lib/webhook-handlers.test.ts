/**
 * Tests for webhook-handlers.ts (PAN-905).
 *
 * PAN-3917: the handlers no longer mirror GitHub's merge blockers into a
 * `review_status` row — GitHub owns that state and `cloister/pr-facts` reads it
 * on demand. What is asserted here is the work a webhook does that a read
 * cannot: PR-tab cache invalidation, the default-branch CI observation, the CI
 * failure relay, and the post-merge lifecycle for an out-of-band merge.
 */
import { Effect } from 'effect';
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
const mockResolveDefaultBranchHead = vi.fn(async () => 'abc123');
const mockEnqueueProjectResourceRefresh = vi.fn();
const mockRelayCiFailureFeedback = vi.fn(() => Effect.succeed({ agentMessageSent: false }));
const mockRecordCiTestGatePass = vi.fn(() => Effect.succeed(true));
const mockGetPrFacts = vi.fn();

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

vi.mock('../../../src/lib/activity-logger.js', () => ({
  appendDomainEventAsync: (...args: Parameters<typeof mockAppendDomainEventAsync>) =>
    mockAppendDomainEventAsync(...args),
}));

vi.mock('../../../src/lib/ci/project-ci-github.js', () => ({
  resolveDefaultBranchHead: (...args: unknown[]) => mockResolveDefaultBranchHead(...args),
}));

vi.mock('node:child_process', () => ({ execFile: (...args: unknown[]) => mockExecFile(...args) }));
vi.mock('child_process', () => ({ execFile: (...args: unknown[]) => mockExecFile(...args) }));

beforeEach(() => {
  mockResolveDefaultBranchHead.mockResolvedValue('abc123');
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
    await Effect.runPromise(handleCheckSuite(makePayload({
      check_suite: {
        status: 'completed',
        conclusion: 'failure',
        pull_requests: [{ number: 11, head: { ref: 'feature/pan-123', sha: 'deadbee' } }],
      },
    })));

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
    await Effect.runPromise(handleCheckSuite(makePayload({
      check_suite: {
        status: 'completed',
        conclusion: 'success',
        pull_requests: [{ number: 1, head: { ref: 'feature/pan-123', sha: 'abc' } }],
      },
    })));

    expect(mockRelayCiFailureFeedback).not.toHaveBeenCalled();
    expect(mockBumpIssuePrTabCacheGeneration).toHaveBeenCalledWith('PAN-123');
  });

  it('ignores a check suite with no pull requests', async () => {
    await Effect.runPromise(handleCheckSuite(makePayload({
      check_suite: { status: 'completed', conclusion: 'failure', pull_requests: [] },
    })));

    expect(mockRelayCiFailureFeedback).not.toHaveBeenCalled();
  });

  it('appends a project CI observation for a default-branch suite with no pull requests', async () => {
    await Effect.runPromise(handleCheckSuite(makePayload({
      check_suite: {
        id: 42,
        status: 'in_progress',
        conclusion: null,
        head_branch: 'main',
        head_sha: 'abc123',
        app: { slug: 'github-actions' },
        pull_requests: [],
      },
    })));

    expect(mockAppendDomainEventAsync).toHaveBeenCalledTimes(1);
    expect(mockAppendDomainEventAsync.mock.calls[0]![0]).toMatchObject({
      type: 'project.ci_suite_observed',
    });
  });

  it('ignores an untracked repository', async () => {
    await Effect.runPromise(handleCheckSuite({
      action: 'completed',
      repository: { full_name: 'someone-else/other-repo' },
      check_suite: {
        status: 'completed',
        conclusion: 'failure',
        pull_requests: [{ number: 1, head: { ref: 'feature/pan-123', sha: 'abc' } }],
      },
    }));

    expect(mockRelayCiFailureFeedback).not.toHaveBeenCalled();
    expect(mockBumpIssuePrTabCacheGeneration).not.toHaveBeenCalled();
  });
});

describe('handleCheckRun', () => {
  it('relays a failing non-advisory check run', async () => {
    await Effect.runPromise(handleCheckRun(makePayload({
      check_run: {
        name: 'build',
        conclusion: 'failure',
        pull_requests: [{ number: 5, head: { ref: 'feature/pan-123', sha: 'cafe' } }],
      },
    })));

    expect(mockRelayCiFailureFeedback).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-123',
      prNumber: 5,
      source: 'check_run:build',
    }));
  });

  it('bumps the cache but never relays for an advisory check run', async () => {
    await Effect.runPromise(handleCheckRun(makePayload({
      check_run: {
        name: 'CodeRabbit',
        conclusion: 'failure',
        pull_requests: [{ number: 5, head: { ref: 'feature/pan-123', sha: 'cafe' } }],
      },
    })));

    expect(mockBumpIssuePrTabCacheGeneration).toHaveBeenCalledWith('PAN-123');
    expect(mockRelayCiFailureFeedback).not.toHaveBeenCalled();
  });

  it('processes every PR on the check run, not just the first', async () => {
    await Effect.runPromise(handleCheckRun(makePayload({
      check_run: {
        name: 'build',
        conclusion: 'failure',
        pull_requests: [
          { number: 5, head: { ref: 'feature/pan-123', sha: 'a' } },
          { number: 6, head: { ref: 'feature/min-42', sha: 'b' } },
        ],
      },
    })));

    expect(mockBumpIssuePrTabCacheGeneration).toHaveBeenCalledWith('PAN-123');
    expect(mockBumpIssuePrTabCacheGeneration).toHaveBeenCalledWith('MIN-42');
    expect(mockRelayCiFailureFeedback).toHaveBeenCalledTimes(2);
  });

  it('records a green CI test job as the verification reset (PAN-3965)', async () => {
    await Effect.runPromise(handleCheckRun(makePayload({
      check_run: {
        name: 'test (22)',
        conclusion: 'success',
        pull_requests: [{ number: 5, head: { ref: 'feature/pan-123', sha: 'cafe' } }],
      },
    })));

    expect(mockRecordCiTestGatePass).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-123',
      headSha: 'cafe',
      headRef: 'feature/pan-123',
    }));
    expect(mockRelayCiFailureFeedback).not.toHaveBeenCalled();
  });

  it('records nothing for a green non-test check (PAN-3965)', async () => {
    await Effect.runPromise(handleCheckRun(makePayload({
      check_run: {
        name: 'lint',
        conclusion: 'success',
        pull_requests: [{ number: 5, head: { ref: 'feature/pan-123', sha: 'cafe' } }],
      },
    })));

    expect(mockRecordCiTestGatePass).not.toHaveBeenCalled();
  });
});

describe('handlePullRequest', () => {
  it('fires postMergeLifecycle when GitHub reports the PR closed and merged', async () => {
    await Effect.runPromise(handlePullRequest(makePayload({
      action: 'closed',
      pull_request: {
        number: 9,
        head: { ref: 'feature/pan-123', sha: 'abc' },
        state: 'closed',
        merged: true,
      },
    })));

    expect(mockPostMergeLifecycle).toHaveBeenCalledWith(
      'PAN-123',
      '/tmp/test-project',
      'feature/pan-123',
    );
  });

  it('does not fire postMergeLifecycle for a PR closed without merging', async () => {
    await Effect.runPromise(handlePullRequest(makePayload({
      action: 'closed',
      pull_request: {
        number: 9,
        head: { ref: 'feature/pan-123', sha: 'abc' },
        state: 'closed',
        merged: false,
      },
    })));

    expect(mockPostMergeLifecycle).not.toHaveBeenCalled();
  });

  it('enqueues a membership refresh on open, closed and reopened', async () => {
    for (const action of ['opened', 'closed', 'reopened']) {
      await Effect.runPromise(handlePullRequest(makePayload({
        action,
        pull_request: { number: 9, head: { ref: 'feature/pan-123', sha: 'abc' } },
      })));
    }

    expect(mockEnqueueProjectResourceRefresh).toHaveBeenCalledTimes(3);
  });

  it('bumps the PR tab cache for any pull_request action', async () => {
    await Effect.runPromise(handlePullRequest(makePayload({
      action: 'synchronize',
      pull_request: { number: 9, head: { ref: 'feature/pan-123', sha: 'abc' } },
    })));

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
    await Effect.runPromise(handlePullRequest(makePayload({
      action: 'opened',
      pull_request: { number: 9, head: { ref: 'feature/pan-123', sha: 'abc' }, draft: false },
    })));

    expect(startReview).toHaveBeenCalledTimes(1);
    expect(startReview.mock.calls[0]![0]).toBe('PAN-123');
  });

  it('starts the review pipeline when a draft PR is readied', async () => {
    await Effect.runPromise(handlePullRequest(makePayload({
      action: 'ready_for_review',
      pull_request: { number: 9, head: { ref: 'feature/pan-123', sha: 'abc' }, draft: false },
    })));

    expect(startReview).toHaveBeenCalledTimes(1);
  });

  it('does not start review for a draft PR, another action, or a merged PR', async () => {
    await Effect.runPromise(handlePullRequest(makePayload({
      action: 'opened',
      pull_request: { number: 9, head: { ref: 'feature/pan-123', sha: 'abc' }, draft: true },
    })));
    await Effect.runPromise(handlePullRequest(makePayload({
      action: 'synchronize',
      pull_request: { number: 9, head: { ref: 'feature/pan-123', sha: 'abc' } },
    })));
    await Effect.runPromise(handlePullRequest(makePayload({
      action: 'opened',
      pull_request: { number: 9, head: { ref: 'feature/pan-123', sha: 'abc' }, state: 'closed', merged: true },
    })));

    expect(startReview).not.toHaveBeenCalled();
  });

  it('does not start review for a strike or bypass PR — the pipeline reviews feature/<issue>', async () => {
    await Effect.runPromise(handlePullRequest(makePayload({
      action: 'opened',
      pull_request: { number: 9, head: { ref: 'bypass/pan-123', sha: 'abc' } },
    })));
    await Effect.runPromise(handlePullRequest(makePayload({
      action: 'opened',
      pull_request: { number: 9, head: { ref: 'strike/pan-123', sha: 'abc' } },
    })));

    expect(startReview).not.toHaveBeenCalled();
  });

  it('does not start review for an untracked repo or a branch with no issue', async () => {
    await Effect.runPromise(handlePullRequest({
      action: 'opened',
      repository: { full_name: 'someone-else/repo' },
      pull_request: { number: 9, head: { ref: 'feature/pan-123', sha: 'abc' } },
    }));
    await Effect.runPromise(handlePullRequest(makePayload({
      action: 'opened',
      pull_request: { number: 9, head: { ref: 'chore/cleanup', sha: 'abc' } },
    })));

    expect(startReview).not.toHaveBeenCalled();
  });

  it('a starter that rejects does not fail the webhook', async () => {
    startReview.mockRejectedValue(new Error('dashboard is mid-restart'));

    await expect(Effect.runPromise(handlePullRequest(makePayload({
      action: 'opened',
      pull_request: { number: 9, head: { ref: 'feature/pan-123', sha: 'abc' } },
    })))).resolves.toBeUndefined();
  });

  it('no registered starter is not a failure', async () => {
    registerRequestReviewStarter(null);
    expect(getRequestReviewStarter()).toBeNull();

    await expect(Effect.runPromise(handlePullRequest(makePayload({
      action: 'opened',
      pull_request: { number: 9, head: { ref: 'feature/pan-123', sha: 'abc' } },
    })))).resolves.toBeUndefined();
  });
});

describe('handlePullRequestReview / ReviewComment / ReviewThread', () => {
  it('bumps the PR tab cache and writes nothing back', async () => {
    const pull_request = { number: 9, head: { ref: 'feature/pan-123', sha: 'abc' } };

    await Effect.runPromise(handlePullRequestReview(makePayload({
      action: 'submitted', pull_request, review: { state: 'changes_requested' },
    })));
    await Effect.runPromise(handlePullRequestReviewComment(makePayload({ pull_request })));
    await Effect.runPromise(handlePullRequestReviewThread(makePayload({
      pull_request, thread: { id: 1, resolved: false },
    })));

    expect(mockBumpIssuePrTabCacheGeneration).toHaveBeenCalledTimes(3);
    expect(mockBumpIssuePrTabCacheGeneration).toHaveBeenCalledWith('PAN-123');
  });
});

describe('handleIssueComment', () => {
  it('asks the forge which issue the commented PR belongs to', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, { stdout: JSON.stringify({ headRefName: 'feature/pan-123' }), stderr: '' });
    });

    await Effect.runPromise(handleIssueComment(makePayload({
      issue: { number: 9, pull_request: {} },
    })));

    expect(mockBumpIssuePrTabCacheGeneration).toHaveBeenCalledWith('PAN-123');
  });

  it('ignores a comment on a plain issue', async () => {
    await Effect.runPromise(handleIssueComment(makePayload({ issue: { number: 9 } })));

    expect(mockBumpIssuePrTabCacheGeneration).not.toHaveBeenCalled();
  });
});

describe('handleStatus', () => {
  it('relays a failing commit status using the PR identity the forge reports', async () => {
    await Effect.runPromise(handleStatus(makePayload({
      state: 'failure',
      sha: 'feedface',
      context: 'ci/build',
      branches: [{ name: 'feature/pan-123' }],
    })));

    expect(mockGetPrFacts).toHaveBeenCalledWith('PAN-123');
    expect(mockRelayCiFailureFeedback).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-123',
      prNumber: 7,
      headSha: 'feedface',
      source: 'status:ci/build',
    }));
  });

  it('never relays an advisory context', async () => {
    await Effect.runPromise(handleStatus(makePayload({
      state: 'failure',
      sha: 'feedface',
      context: 'coderabbitai',
      branches: [{ name: 'feature/pan-123' }],
    })));

    expect(mockBumpIssuePrTabCacheGeneration).toHaveBeenCalledWith('PAN-123');
    expect(mockRelayCiFailureFeedback).not.toHaveBeenCalled();
  });

  it('skips non-feature branches', async () => {
    await Effect.runPromise(handleStatus(makePayload({
      state: 'failure',
      sha: 'feedface',
      branches: [{ name: 'main' }],
    })));

    expect(mockRelayCiFailureFeedback).not.toHaveBeenCalled();
  });

  it('does not relay when the forge has no open PR for the issue', async () => {
    mockGetPrFacts.mockResolvedValue({ open: false, number: null, url: null });

    await Effect.runPromise(handleStatus(makePayload({
      state: 'error',
      sha: 'feedface',
      branches: [{ name: 'feature/pan-123' }],
    })));

    expect(mockRelayCiFailureFeedback).not.toHaveBeenCalled();
  });
});
