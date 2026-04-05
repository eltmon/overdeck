import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Cause, Effect, Exit } from 'effect';

// ─── Mock RallyTracker ────────────────────────────────────────────────────────

const mockGetIssue = vi.fn();
const mockTransitionIssue = vi.fn();
const mockAddComment = vi.fn();

vi.mock('../../../../lib/tracker/rally.js', () => ({
  RallyTracker: vi.fn().mockImplementation(() => ({
    getIssue: mockGetIssue,
    transitionIssue: mockTransitionIssue,
    addComment: mockAddComment,
  })),
}));

// ─── Mock tracker-config ──────────────────────────────────────────────────────

const mockGetRallyConfig = vi.fn();
vi.mock('../tracker-config.js', () => ({
  getRallyConfig: mockGetRallyConfig,
}));

// ─── Helpers ───────────────────────��─────────────────────────────────���────────

const RALLY_CONFIG = {
  apiKey: 'test-key',
  server: 'https://rally1.rallydev.com',
  workspace: 'TestWorkspace',
  project: 'TestProject',
};

function makeRawIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rally-obj-id',
    ref: 'US1234',
    title: 'Test Story',
    description: 'A test story',
    url: 'https://rally1.rallydev.com/#/detail/userstory/1',
    state: 'in_progress',
    labels: ['feature'],
    ...overrides,
  };
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

describe('RallyClient Effect service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRallyConfig.mockReturnValue(RALLY_CONFIG);
    mockGetIssue.mockResolvedValue(makeRawIssue());
    mockTransitionIssue.mockResolvedValue(undefined);
    mockAddComment.mockResolvedValue({ id: 'comment-1' });
  });

  describe('RallyClientLive layer', () => {
    it('fails with TrackerNotConfigured when Rally is not configured', async () => {
      mockGetRallyConfig.mockReturnValue(null);

      const { RallyClient, RallyClientLive } = await import('../rally-client.js');

      const program = Effect.gen(function* () {
        const client = yield* RallyClient;
        return yield* client.getIssue('US1234');
      }).pipe(Effect.provide(RallyClientLive));

      const err = await runEffectFail(program);
      expect((err as any)._tag).toBe('TrackerNotConfigured');
      expect((err as any).tracker).toBe('rally');
    });
  });

  describe('getIssue', () => {
    it('returns normalized issue data', async () => {
      const { RallyClient, RallyClientLive } = await import('../rally-client.js');

      const program = Effect.gen(function* () {
        const client = yield* RallyClient;
        return yield* client.getIssue('US1234');
      }).pipe(Effect.provide(RallyClientLive));

      const issue = await runEffect(program);
      expect(issue.ref).toBe('US1234');
      expect(issue.title).toBe('Test Story');
      expect(issue.state).toBe('in_progress');
      expect(mockGetIssue).toHaveBeenCalledWith('US1234');
    });

    it('wraps not-found as IssueNotFound', async () => {
      mockGetIssue.mockRejectedValue(new Error('0 results found'));

      const { RallyClient, RallyClientLive } = await import('../rally-client.js');

      const program = Effect.gen(function* () {
        const client = yield* RallyClient;
        return yield* client.getIssue('US9999');
      }).pipe(Effect.provide(RallyClientLive));

      const err = await runEffectFail(program);
      expect((err as any)._tag).toBe('IssueNotFound');
    });

    it('wraps unknown errors as TrackerApiError', async () => {
      mockGetIssue.mockRejectedValue(new Error('Rally WSAPI error 500'));

      const { RallyClient, RallyClientLive } = await import('../rally-client.js');

      const program = Effect.gen(function* () {
        const client = yield* RallyClient;
        return yield* client.getIssue('US1234');
      }).pipe(Effect.provide(RallyClientLive));

      const err = await runEffectFail(program);
      expect((err as any)._tag).toBe('TrackerApiError');
      expect((err as any).tracker).toBe('rally');
    });
  });

  describe('updateState', () => {
    it('calls transitionIssue with normalized state', async () => {
      const { RallyClient, RallyClientLive } = await import('../rally-client.js');

      const program = Effect.gen(function* () {
        const client = yield* RallyClient;
        yield* client.updateState('US1234', 'closed');
      }).pipe(Effect.provide(RallyClientLive));

      await runEffect(program);
      expect(mockTransitionIssue).toHaveBeenCalledWith('US1234', 'closed');
    });
  });

  describe('addComment', () => {
    it('delegates to RallyTracker.addComment', async () => {
      const { RallyClient, RallyClientLive } = await import('../rally-client.js');

      const program = Effect.gen(function* () {
        const client = yield* RallyClient;
        yield* client.addComment('US1234', 'PR merged!');
      }).pipe(Effect.provide(RallyClientLive));

      await runEffect(program);
      expect(mockAddComment).toHaveBeenCalledWith('US1234', 'PR merged!');
    });
  });
});
