import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Cause, Effect, Exit } from 'effect';

// ─── Mock global fetch ────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ─── Mock tracker-config ──────────────────────────────────────────────────────

const mockGetGitHubConfig = vi.fn();
vi.mock('../tracker-config.js', () => ({
  getGitHubConfig: mockGetGitHubConfig,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

async function runEffect<A, E>(effect: Effect.Effect<A, E, never>): Promise<A> {
  const exit = await Effect.runPromise(Effect.exit(effect));
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
}

async function runEffectFail<A, E>(effect: Effect.Effect<A, E, never>): Promise<E> {
  const exit = await Effect.runPromise(Effect.exit(effect));
  if (Exit.isSuccess(exit))
    throw new Error('Expected effect to fail, got: ' + JSON.stringify(exit.value));
  return Cause.squash(exit.cause) as E;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GitHubClient Effect service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGitHubConfig.mockReturnValue({ token: 'ghp_test123', repos: [] });
    mockFetch.mockResolvedValue(makeResponse({}));
  });

  describe('GitHubClientLive layer', () => {
    it('fails with TrackerNotConfigured when GitHub config is missing', async () => {
      mockGetGitHubConfig.mockReturnValue(null);

      const { GitHubClient, GitHubClientLive } = await import('../github-client.js');

      const program = Effect.gen(function* () {
        const client = yield* GitHubClient;
        return yield* client.getIssue('owner', 'repo', 1);
      }).pipe(Effect.provide(GitHubClientLive));

      const err = await runEffectFail(program);
      expect((err as any)._tag).toBe('TrackerNotConfigured');
      expect((err as any).tracker).toBe('github');
    });
  });

  describe('getIssue', () => {
    it('returns parsed issue data', async () => {
      mockFetch.mockResolvedValue(
        makeResponse({
          number: 42,
          title: 'Fix bug',
          body: 'Details here',
          state: 'open',
          labels: [{ id: 1, name: 'bug' }],
          html_url: 'https://github.com/owner/repo/issues/42',
        }),
      );

      const { GitHubClient, GitHubClientLive } = await import('../github-client.js');

      const program = Effect.gen(function* () {
        const client = yield* GitHubClient;
        return yield* client.getIssue('owner', 'repo', 42);
      }).pipe(Effect.provide(GitHubClientLive));

      const issue = await runEffect(program);
      expect(issue.number).toBe(42);
      expect(issue.title).toBe('Fix bug');
      expect(issue.state).toBe('open');
      expect(issue.labels).toEqual([{ id: 1, name: 'bug' }]);
    });

    it('fails with IssueNotFound on 404', async () => {
      mockFetch.mockResolvedValue(makeResponse({ message: 'Not Found' }, 404));

      const { GitHubClient, GitHubClientLive } = await import('../github-client.js');

      const program = Effect.gen(function* () {
        const client = yield* GitHubClient;
        return yield* client.getIssue('owner', 'repo', 999);
      }).pipe(Effect.provide(GitHubClientLive));

      const err = await runEffectFail(program);
      expect((err as any)._tag).toBe('IssueNotFound');
    });

    it('fails with TrackerApiError on 500', async () => {
      mockFetch.mockResolvedValue(makeResponse({ message: 'Internal Server Error' }, 500));

      const { GitHubClient, GitHubClientLive } = await import('../github-client.js');

      const program = Effect.gen(function* () {
        const client = yield* GitHubClient;
        return yield* client.getIssue('owner', 'repo', 1);
      }).pipe(Effect.provide(GitHubClientLive));

      const err = await runEffectFail(program);
      expect((err as any)._tag).toBe('TrackerApiError');
    });
  });

  describe('addLabel', () => {
    it('posts label to GitHub issues endpoint', async () => {
      mockFetch.mockResolvedValue(makeResponse([{ id: 1, name: 'in-progress' }]));

      const { GitHubClient, GitHubClientLive } = await import('../github-client.js');

      const program = Effect.gen(function* () {
        const client = yield* GitHubClient;
        yield* client.addLabel('owner', 'repo', 42, 'in-progress');
      }).pipe(Effect.provide(GitHubClientLive));

      await runEffect(program);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/issues/42/labels',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ labels: ['in-progress'] }),
        }),
      );
    });
  });

  describe('removeLabel', () => {
    it('deletes label from issue', async () => {
      mockFetch.mockResolvedValue(makeResponse({}, 200));

      const { GitHubClient, GitHubClientLive } = await import('../github-client.js');

      const program = Effect.gen(function* () {
        const client = yield* GitHubClient;
        yield* client.removeLabel('owner', 'repo', 42, 'in-progress');
      }).pipe(Effect.provide(GitHubClientLive));

      await runEffect(program);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/issues/42/labels/in-progress',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('is non-fatal when label is not on the issue (404)', async () => {
      mockFetch.mockResolvedValue(makeResponse({ message: 'Not Found' }, 404));

      const { GitHubClient, GitHubClientLive } = await import('../github-client.js');

      const program = Effect.gen(function* () {
        const client = yield* GitHubClient;
        yield* client.removeLabel('owner', 'repo', 42, 'missing-label');
      }).pipe(Effect.provide(GitHubClientLive));

      // Should NOT throw
      await runEffect(program);
    });
  });

  describe('ensureLabel', () => {
    it('creates label when it does not exist', async () => {
      mockFetch.mockResolvedValue(
        makeResponse({ id: 10, name: 'merged', color: '00c000' }, 201),
      );

      const { GitHubClient, GitHubClientLive } = await import('../github-client.js');

      const program = Effect.gen(function* () {
        const client = yield* GitHubClient;
        return yield* client.ensureLabel('owner', 'repo', 'merged', '00c000');
      }).pipe(Effect.provide(GitHubClientLive));

      const label = await runEffect(program);
      expect(label.name).toBe('merged');
    });

    it('fetches existing label when creation returns 422', async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse({ message: 'Validation Failed' }, 422))
        .mockResolvedValueOnce(makeResponse({ id: 5, name: 'merged', color: '00c000' }));

      const { GitHubClient, GitHubClientLive } = await import('../github-client.js');

      const program = Effect.gen(function* () {
        const client = yield* GitHubClient;
        return yield* client.ensureLabel('owner', 'repo', 'merged');
      }).pipe(Effect.provide(GitHubClientLive));

      const label = await runEffect(program);
      expect(label.id).toBe(5);
      expect(label.name).toBe('merged');
    });
  });

  describe('addComment', () => {
    it('posts comment to issue', async () => {
      mockFetch.mockResolvedValue(makeResponse({ id: 99, body: 'hello' }, 201));

      const { GitHubClient, GitHubClientLive } = await import('../github-client.js');

      const program = Effect.gen(function* () {
        const client = yield* GitHubClient;
        yield* client.addComment('owner', 'repo', 42, 'hello');
      }).pipe(Effect.provide(GitHubClientLive));

      await runEffect(program);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/issues/42/comments',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ body: 'hello' }),
        }),
      );
    });
  });

  describe('closeIssue / reopenIssue', () => {
    it('patches issue state to closed', async () => {
      mockFetch.mockResolvedValue(makeResponse({ state: 'closed' }));

      const { GitHubClient, GitHubClientLive } = await import('../github-client.js');

      const program = Effect.gen(function* () {
        const client = yield* GitHubClient;
        yield* client.closeIssue('owner', 'repo', 42);
      }).pipe(Effect.provide(GitHubClientLive));

      await runEffect(program);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/issues/42',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ state: 'closed' }),
        }),
      );
    });

    it('patches issue state to open', async () => {
      mockFetch.mockResolvedValue(makeResponse({ state: 'open' }));

      const { GitHubClient, GitHubClientLive } = await import('../github-client.js');

      const program = Effect.gen(function* () {
        const client = yield* GitHubClient;
        yield* client.reopenIssue('owner', 'repo', 42);
      }).pipe(Effect.provide(GitHubClientLive));

      await runEffect(program);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/issues/42',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ state: 'open' }),
        }),
      );
    });
  });
});
