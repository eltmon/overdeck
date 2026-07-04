import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetReviewStatus = vi.fn();
const mockSetReviewStatus = vi.fn();
const mockIsGitHubAppConfigured = vi.fn();
const mockGetPullRequestState = vi.fn();
const mockExecFile = vi.fn();

vi.mock('../../../src/lib/review-status.js', () => ({
  getReviewStatus: (...args: Parameters<typeof mockGetReviewStatus>) => Effect.sync(() => mockGetReviewStatus(...args)),
  getReviewStatusSync: (...args: Parameters<typeof mockGetReviewStatus>) => Effect.sync(() => mockGetReviewStatus(...args)),
  setReviewStatus: (...args: [string, Record<string, unknown>]) => Effect.sync(() => mockSetReviewStatus(args[0], args[1])),
  setReviewStatusSync: (...args: [string, Record<string, unknown>]) => Effect.sync(() => mockSetReviewStatus(args[0], args[1])),
  loadReviewStatuses: () => ({}),
}));

vi.mock('../../../src/dashboard/server/services/tracker-config.js', () => ({
  getGitHubConfig: () => ({
    token: 'test-token',
    repos: [{ owner: 'test-owner', repo: 'test-repo' }],
  }),
}));

vi.mock('../../../src/lib/cloister/ci-failure-feedback.js', () => ({
  relayCiFailureFeedback: () => Effect.succeed({ agentMessageSent: false }),
}));

vi.mock('../../../src/lib/github-app.js', () => ({
  isGitHubAppConfigured: () => mockIsGitHubAppConfigured(),
  getPullRequestState: (owner: string, repo: string, number: number) =>
    mockGetPullRequestState(owner, repo, number),
}));

vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

describe('github GraphQL cooldown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
    mockGetReviewStatus.mockReturnValue({ blockerReasons: [] });
    mockSetReviewStatus.mockReturnValue(undefined);
    mockIsGitHubAppConfigured.mockReturnValue(false);
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('enters cooldown after a GraphQL quota error and exits after 60s', async () => {
    const { noteGraphQLRateLimit, isInGraphQLCooldown } = await import('../../../src/lib/github-graphql-cooldown.js');

    noteGraphQLRateLimit(new Error('GraphQL: API rate limit already exceeded for user ID 678719'));

    expect(isInGraphQLCooldown()).toBe(true);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(isInGraphQLCooldown()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(isInGraphQLCooldown()).toBe(false);
  });

  it('skips refreshMergeStateFromGitHub gh fallback while cooldown is active', async () => {
    const { noteGraphQLRateLimit } = await import('../../../src/lib/github-graphql-cooldown.js');
    const { refreshMergeStateFromGitHub } = await import('../../../src/lib/webhook-handlers.js');

    noteGraphQLRateLimit(new Error('GraphQL: API rate limit already exceeded for user ID 678719'));

    await refreshMergeStateFromGitHub('PAN-1', 'test-owner/test-repo', 42);

    expect(mockExecFile).not.toHaveBeenCalled();
    expect(mockGetReviewStatus).not.toHaveBeenCalled();
    expect(mockSetReviewStatus).not.toHaveBeenCalled();
  });

  it('does not enter cooldown for unrelated errors', async () => {
    const { noteGraphQLRateLimit, isInGraphQLCooldown } = await import('../../../src/lib/github-graphql-cooldown.js');

    noteGraphQLRateLimit(new Error('network socket closed'));

    expect(isInGraphQLCooldown()).toBe(false);
  });

  it('notes GraphQL rate-limit errors thrown by the gh fallback', async () => {
    const { isInGraphQLCooldown } = await import('../../../src/lib/github-graphql-cooldown.js');
    const { refreshMergeStateFromGitHub } = await import('../../../src/lib/webhook-handlers.js');
    const error = new Error('GraphQL: API rate limit already exceeded for user ID 678719');
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: Error) => void;
      cb(error);
    });

    await refreshMergeStateFromGitHub('PAN-2', 'test-owner/test-repo', 42);

    expect(mockExecFile).toHaveBeenCalled();
    expect(isInGraphQLCooldown()).toBe(true);
  });
});
