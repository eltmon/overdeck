import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Cause, Effect, Exit, Layer } from 'effect';

// ─── Mock tracker-utils ───────────────────────────────────────────────────────

const mockResolveTrackerType = vi.fn();
const mockResolveGitHubIssue = vi.fn();

vi.mock('../../../../lib/tracker-utils.js', () => ({
  resolveTrackerType: mockResolveTrackerType,
  resolveGitHubIssue: mockResolveGitHubIssue,
}));

// ─── Mock tracker clients (provide as Effect Layers) ─────────────────────────

const mockLinearGetIssue = vi.fn();
const mockLinearGetTeamStates = vi.fn();
const mockLinearUpdateState = vi.fn();
const mockGitHubAddLabel = vi.fn();
const mockGitHubRemoveLabel = vi.fn();
const mockGitHubCloseIssue = vi.fn();
const mockGitHubReopenIssue = vi.fn();
const mockRallyUpdateState = vi.fn();

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function ok<T>(value: T): Effect.Effect<T, never> {
  return Effect.succeed(value);
}

// ─── Build test layer (uses Effect Layer.succeed to inject mock impls) ────────

async function makeTestLayer() {
  const { LinearClient } = await import('../linear-client.js');
  const { GitHubClient } = await import('../github-client.js');
  const { RallyClient } = await import('../rally-client.js');
  const { IssueLifecycleLive } = await import('../issue-lifecycle.js');

  const linearLayer = Layer.succeed(LinearClient, {
    getIssue: mockLinearGetIssue,
    getTeamStates: mockLinearGetTeamStates,
    updateState: mockLinearUpdateState,
    addComment: vi.fn(),
    getComments: vi.fn(),
    findOrCreateLabel: vi.fn(),
    addLabel: vi.fn(),
    removeLabel: vi.fn(),
  });

  const githubLayer = Layer.succeed(GitHubClient, {
    getIssue: vi.fn(),
    addLabel: mockGitHubAddLabel,
    removeLabel: mockGitHubRemoveLabel,
    closeIssue: mockGitHubCloseIssue,
    reopenIssue: mockGitHubReopenIssue,
    ensureLabel: vi.fn(),
    addComment: vi.fn(),
    getComments: vi.fn(),
  });

  const rallyLayer = Layer.succeed(RallyClient, {
    getIssue: vi.fn(),
    getChildIssues: vi.fn(),
    updateState: mockRallyUpdateState,
    addComment: vi.fn(),
  });

  return IssueLifecycleLive.pipe(
    Layer.provide(linearLayer),
    Layer.provide(githubLayer),
    Layer.provide(rallyLayer),
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('IssueLifecycle Effect service', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockResolveTrackerType.mockReturnValue('linear');
    mockResolveGitHubIssue.mockReturnValue({ isGitHub: false });

    mockLinearGetIssue.mockReturnValue(
      ok({ id: 'uuid-linear', identifier: 'MIN-1', team: { id: 'team-1', key: 'MIN' } }),
    );
    mockLinearGetTeamStates.mockReturnValue(
      ok([
        { id: 'state-open', name: 'Todo', type: 'unstarted' },
        { id: 'state-inprogress', name: 'In Progress', type: 'started' },
        { id: 'state-inreview', name: 'In Review', type: 'started' },
        { id: 'state-inplanning', name: 'In Planning', type: 'started' },
        { id: 'state-done', name: 'Done', type: 'completed' },
      ]),
    );
    mockLinearUpdateState.mockReturnValue(ok(undefined));
    mockGitHubAddLabel.mockReturnValue(ok(undefined));
    mockGitHubRemoveLabel.mockReturnValue(ok(undefined));
    mockGitHubCloseIssue.mockReturnValue(ok(undefined));
    mockGitHubReopenIssue.mockReturnValue(ok(undefined));
    mockRallyUpdateState.mockReturnValue(ok(undefined));
  });

  describe('transitionTo — Linear', () => {
    it('transitions to "in_progress" on Linear', async () => {
      const { IssueLifecycle } = await import('../issue-lifecycle.js');
      const layer = await makeTestLayer();

      const program = Effect.gen(function* () {
        const lifecycle = yield* IssueLifecycle;
        yield* lifecycle.transitionTo('MIN-1', 'in_progress');
      }).pipe(Effect.provide(layer));

      await runEffect(program);
      expect(mockLinearGetIssue).toHaveBeenCalledWith('MIN-1');
      expect(mockLinearGetTeamStates).toHaveBeenCalledWith('team-1');
      expect(mockLinearUpdateState).toHaveBeenCalledWith('uuid-linear', 'state-inprogress');
    });

    it('prefers "In Planning" state by name', async () => {
      const { IssueLifecycle } = await import('../issue-lifecycle.js');
      const layer = await makeTestLayer();

      const program = Effect.gen(function* () {
        const lifecycle = yield* IssueLifecycle;
        yield* lifecycle.transitionTo('MIN-1', 'in_planning');
      }).pipe(Effect.provide(layer));

      await runEffect(program);
      expect(mockLinearUpdateState).toHaveBeenCalledWith('uuid-linear', 'state-inplanning');
    });

    it('prefers "In Review" state by name', async () => {
      const { IssueLifecycle } = await import('../issue-lifecycle.js');
      const layer = await makeTestLayer();

      const program = Effect.gen(function* () {
        const lifecycle = yield* IssueLifecycle;
        yield* lifecycle.transitionTo('MIN-1', 'in_review');
      }).pipe(Effect.provide(layer));

      await runEffect(program);
      expect(mockLinearUpdateState).toHaveBeenCalledWith('uuid-linear', 'state-inreview');
    });

    it('prefers a verifying state by name', async () => {
      mockLinearGetTeamStates.mockReturnValue(
        ok([
          { id: 'state-open', name: 'Todo', type: 'unstarted' },
          { id: 'state-inprogress', name: 'In Progress', type: 'started' },
          { id: 'state-verifying', name: 'Verifying On Main', type: 'started' },
          { id: 'state-inreview', name: 'In Review', type: 'started' },
        ]),
      );
      const { IssueLifecycle } = await import('../issue-lifecycle.js');
      const layer = await makeTestLayer();

      const program = Effect.gen(function* () {
        const lifecycle = yield* IssueLifecycle;
        yield* lifecycle.transitionTo('MIN-1', 'verifying_on_main');
      }).pipe(Effect.provide(layer));

      await runEffect(program);
      expect(mockLinearUpdateState).toHaveBeenCalledWith('uuid-linear', 'state-verifying');
    });

    it('transitions to "closed" using completed type', async () => {
      const { IssueLifecycle } = await import('../issue-lifecycle.js');
      const layer = await makeTestLayer();

      const program = Effect.gen(function* () {
        const lifecycle = yield* IssueLifecycle;
        yield* lifecycle.transitionTo('MIN-1', 'closed');
      }).pipe(Effect.provide(layer));

      await runEffect(program);
      expect(mockLinearUpdateState).toHaveBeenCalledWith('uuid-linear', 'state-done');
    });
  });

  describe('transitionTo — GitHub', () => {
    beforeEach(() => {
      mockResolveTrackerType.mockReturnValue('github');
      mockResolveGitHubIssue.mockReturnValue({
        isGitHub: true,
        owner: 'acme',
        repo: 'myapp',
        prefix: 'APP',
        number: 42,
      });
    });

    it('adds in-progress label and removes conflicting labels', async () => {
      const { IssueLifecycle } = await import('../issue-lifecycle.js');
      const layer = await makeTestLayer();

      const program = Effect.gen(function* () {
        const lifecycle = yield* IssueLifecycle;
        yield* lifecycle.transitionTo('APP-42', 'in_progress');
      }).pipe(Effect.provide(layer));

      await runEffect(program);
      expect(mockGitHubAddLabel).toHaveBeenCalledWith('acme', 'myapp', 42, 'in-progress');
      expect(mockGitHubRemoveLabel).toHaveBeenCalledWith('acme', 'myapp', 42, 'planned');
    });

    it('adds in-review label and removes in-progress', async () => {
      const { IssueLifecycle } = await import('../issue-lifecycle.js');
      const layer = await makeTestLayer();

      const program = Effect.gen(function* () {
        const lifecycle = yield* IssueLifecycle;
        yield* lifecycle.transitionTo('APP-42', 'in_review');
      }).pipe(Effect.provide(layer));

      await runEffect(program);
      expect(mockGitHubAddLabel).toHaveBeenCalledWith('acme', 'myapp', 42, 'in-review');
      expect(mockGitHubRemoveLabel).toHaveBeenCalledWith('acme', 'myapp', 42, 'in-progress');
    });

    it('transitions to verifying_on_main without closing the GitHub issue', async () => {
      const { IssueLifecycle } = await import('../issue-lifecycle.js');
      const layer = await makeTestLayer();

      const program = Effect.gen(function* () {
        const lifecycle = yield* IssueLifecycle;
        yield* lifecycle.transitionTo('APP-42', 'verifying_on_main');
      }).pipe(Effect.provide(layer));

      await runEffect(program);
      expect(mockGitHubAddLabel).toHaveBeenCalledWith('acme', 'myapp', 42, 'verifying-on-main');
      expect(mockGitHubRemoveLabel).toHaveBeenCalledWith('acme', 'myapp', 42, 'in-progress');
      expect(mockGitHubRemoveLabel).toHaveBeenCalledWith('acme', 'myapp', 42, 'in-review');
      expect(mockGitHubCloseIssue).not.toHaveBeenCalled();
    });

    it('closes GitHub issue on closed state', async () => {
      const { IssueLifecycle } = await import('../issue-lifecycle.js');
      const layer = await makeTestLayer();

      const program = Effect.gen(function* () {
        const lifecycle = yield* IssueLifecycle;
        yield* lifecycle.transitionTo('APP-42', 'closed');
      }).pipe(Effect.provide(layer));

      await runEffect(program);
      expect(mockGitHubCloseIssue).toHaveBeenCalledWith('acme', 'myapp', 42);
    });
  });

  describe('transitionTo — Rally', () => {
    beforeEach(() => {
      mockResolveTrackerType.mockReturnValue('rally');
    });

    it('delegates to rally.updateState', async () => {
      const { IssueLifecycle } = await import('../issue-lifecycle.js');
      const layer = await makeTestLayer();

      const program = Effect.gen(function* () {
        const lifecycle = yield* IssueLifecycle;
        yield* lifecycle.transitionTo('US1234', 'in_progress');
      }).pipe(Effect.provide(layer));

      await runEffect(program);
      expect(mockRallyUpdateState).toHaveBeenCalledWith('US1234', 'in_progress');
    });
  });

  describe('addLabel / removeLabel', () => {
    it('adds label on GitHub issues', async () => {
      mockResolveTrackerType.mockReturnValue('github');
      mockResolveGitHubIssue.mockReturnValue({
        isGitHub: true, owner: 'acme', repo: 'myapp', prefix: 'APP', number: 5,
      });

      const { IssueLifecycle } = await import('../issue-lifecycle.js');
      const layer = await makeTestLayer();

      const program = Effect.gen(function* () {
        const lifecycle = yield* IssueLifecycle;
        yield* lifecycle.addLabel('APP-5', 'some-label');
      }).pipe(Effect.provide(layer));

      await runEffect(program);
      expect(mockGitHubAddLabel).toHaveBeenCalledWith('acme', 'myapp', 5, 'some-label');
    });

    it('is a no-op on Linear issues', async () => {
      const { IssueLifecycle } = await import('../issue-lifecycle.js');
      const layer = await makeTestLayer();

      const program = Effect.gen(function* () {
        const lifecycle = yield* IssueLifecycle;
        yield* lifecycle.addLabel('MIN-1', 'some-label');
      }).pipe(Effect.provide(layer));

      await runEffect(program);
      expect(mockGitHubAddLabel).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('closes a Linear issue via completed state', async () => {
      const { IssueLifecycle } = await import('../issue-lifecycle.js');
      const layer = await makeTestLayer();

      const program = Effect.gen(function* () {
        const lifecycle = yield* IssueLifecycle;
        yield* lifecycle.close('MIN-1');
      }).pipe(Effect.provide(layer));

      await runEffect(program);
      expect(mockLinearUpdateState).toHaveBeenCalledWith('uuid-linear', 'state-done');
    });

    it('removes workflow labels and closes a GitHub issue', async () => {
      mockResolveTrackerType.mockReturnValue('github');
      mockResolveGitHubIssue.mockReturnValue({
        isGitHub: true, owner: 'acme', repo: 'myapp', prefix: 'APP', number: 10,
      });

      const { IssueLifecycle } = await import('../issue-lifecycle.js');
      const layer = await makeTestLayer();

      const program = Effect.gen(function* () {
        const lifecycle = yield* IssueLifecycle;
        yield* lifecycle.close('APP-10');
      }).pipe(Effect.provide(layer));

      await runEffect(program);
      expect(mockGitHubCloseIssue).toHaveBeenCalledWith('acme', 'myapp', 10);
      expect(mockGitHubRemoveLabel).toHaveBeenCalledWith('acme', 'myapp', 10, 'in-progress');
    });
  });
});
