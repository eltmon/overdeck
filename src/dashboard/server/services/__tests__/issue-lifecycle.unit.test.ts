/**
 * Unit tests for IssueLifecycle service (PAN-449)
 *
 * Tests IssueLifecycle with mocked tracker clients, verifying that the
 * service properly routes operations to the correct tracker and handles
 * error cases via typed error channels.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Cause, Effect, Exit, Layer } from 'effect';

// ─── Mock tracker-utils ────────────────────────────────────────────────────────

const mockResolveTrackerType = vi.fn();
const mockResolveGitHubIssue = vi.fn();

vi.mock('../../../../lib/tracker-utils.js', () => ({
  resolveTrackerType: mockResolveTrackerType,
  resolveTrackerTypeSync: mockResolveTrackerType,
  resolveGitHubIssue: mockResolveGitHubIssue,
  resolveGitHubIssueSync: mockResolveGitHubIssue,
}));

// ─── Mock issue-service-singleton (cache patching) ────────────────────────────

const mockPatchIssue = vi.fn();
vi.mock('../issue-service-singleton.js', () => ({
  getSharedIssueService: () => ({ patchIssue: mockPatchIssue }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function runProgram<A, E>(effect: Effect.Effect<A, E, never>): Promise<A> {
  const exit = await Effect.runPromise(Effect.exit(effect));
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
}

async function runProgramFail<A, E>(effect: Effect.Effect<A, E, never>): Promise<E> {
  const exit = await Effect.runPromise(Effect.exit(effect));
  if (Exit.isSuccess(exit))
    throw new Error('Expected effect to fail, got: ' + JSON.stringify(exit.value));
  return Cause.squash(exit.cause) as E;
}

function ok<T>(value: T): Effect.Effect<T, never> {
  return Effect.succeed(value);
}

// ─── Build test layer ─────────────────────────────────────────────────────────

const mockLinearGetIssue = vi.fn();
const mockLinearGetTeamStates = vi.fn();
const mockLinearUpdateState = vi.fn();
const mockGitHubAddLabel = vi.fn();
const mockGitHubRemoveLabel = vi.fn();
const mockGitHubCloseIssue = vi.fn();
const mockGitHubReopenIssue = vi.fn();
const mockGitHubEnsureLabel = vi.fn();
const mockRallyUpdateState = vi.fn();

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
    ensureLabel: mockGitHubEnsureLabel,
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

describe('IssueLifecycle — integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveTrackerType.mockReturnValue('linear');
    mockResolveGitHubIssue.mockReturnValue({ isGitHub: false });
    mockLinearGetIssue.mockReturnValue(
      ok({
        id: 'uuid-1',
        identifier: 'MIN-1',
        team: { id: 'team-1', key: 'MIN' },
        state: { id: 'state-open', type: 'unstarted' },
      }),
    );
    mockLinearGetTeamStates.mockReturnValue(
      ok([
        { id: 'state-open', name: 'Todo', type: 'unstarted' },
        { id: 'state-inprogress', name: 'In Progress', type: 'started' },
        { id: 'state-done', name: 'Done', type: 'completed' },
        { id: 'state-canceled', name: 'Canceled', type: 'canceled' },
      ]),
    );
    mockLinearUpdateState.mockReturnValue(ok(undefined));
    mockGitHubAddLabel.mockReturnValue(ok(undefined));
    mockGitHubRemoveLabel.mockReturnValue(ok(undefined));
    mockGitHubCloseIssue.mockReturnValue(ok(undefined));
    mockGitHubReopenIssue.mockReturnValue(ok(undefined));
    mockGitHubEnsureLabel.mockReturnValue(ok({ id: 1, name: 'label', color: 'fbca04' }));
    mockRallyUpdateState.mockReturnValue(ok(undefined));
  });

  describe('transitionTo (Linear)', () => {
    it('transitions issue to in_progress state via Linear', async () => {
      const layer = await makeTestLayer();
      const { IssueLifecycle } = await import('../issue-lifecycle.js');

      const program = Effect.gen(function* () {
        const lifecycle = yield* IssueLifecycle;
        yield* lifecycle.transitionTo('MIN-1', 'in_progress');
      }).pipe(Effect.provide(layer));

      await runProgram(program);
      expect(mockLinearUpdateState).toHaveBeenCalledWith('uuid-1', 'state-inprogress');
    });

    it('patches the in-memory cache after transition', async () => {
      const layer = await makeTestLayer();
      const { IssueLifecycle } = await import('../issue-lifecycle.js');

      const program = Effect.gen(function* () {
        const lifecycle = yield* IssueLifecycle;
        yield* lifecycle.transitionTo('MIN-1', 'in_progress');
      }).pipe(Effect.provide(layer));

      await runProgram(program);
      expect(mockPatchIssue).toHaveBeenCalledWith('MIN-1', expect.objectContaining({ canonicalStatus: 'in_progress' }));
    });

    it('skips update when issue is already in target state', async () => {
      // Issue is already 'state-inprogress' — should skip the update
      mockLinearGetIssue.mockReturnValue(
        ok({
          id: 'uuid-1',
          identifier: 'MIN-1',
          team: { id: 'team-1', key: 'MIN' },
          state: { id: 'state-inprogress', type: 'started' },
        }),
      );

      const layer = await makeTestLayer();
      const { IssueLifecycle } = await import('../issue-lifecycle.js');

      const program = Effect.gen(function* () {
        const lifecycle = yield* IssueLifecycle;
        yield* lifecycle.transitionTo('MIN-1', 'in_progress');
      }).pipe(Effect.provide(layer));

      await runProgram(program);
      expect(mockLinearUpdateState).not.toHaveBeenCalled();
    });
  });

  describe('transitionTo (GitHub)', () => {
    it('adds/removes labels for GitHub issues', async () => {
      mockResolveTrackerType.mockReturnValue('github');
      mockResolveGitHubIssue.mockReturnValue({ isGitHub: true, owner: 'org', repo: 'repo', number: 1 });

      const layer = await makeTestLayer();
      const { IssueLifecycle } = await import('../issue-lifecycle.js');

      const program = Effect.gen(function* () {
        const lifecycle = yield* IssueLifecycle;
        yield* lifecycle.transitionTo('org/repo#1', 'in_progress');
      }).pipe(Effect.provide(layer));

      await runProgram(program);
      expect(mockGitHubAddLabel).toHaveBeenCalledWith('org', 'repo', 1, 'in-progress');
    });

    it('closes canceled GitHub issues with a wontfix label', async () => {
      mockResolveTrackerType.mockReturnValue('github');
      mockResolveGitHubIssue.mockReturnValue({ isGitHub: true, owner: 'org', repo: 'repo', number: 1 });

      const layer = await makeTestLayer();
      const { IssueLifecycle } = await import('../issue-lifecycle.js');

      const program = Effect.gen(function* () {
        const lifecycle = yield* IssueLifecycle;
        yield* lifecycle.transitionTo('org/repo#1', 'canceled');
      }).pipe(Effect.provide(layer));

      await runProgram(program);
      expect(mockGitHubAddLabel).toHaveBeenCalledWith('org', 'repo', 1, 'wontfix');
      expect(mockGitHubCloseIssue).toHaveBeenCalledWith('org', 'repo', 1);
    });
  });

  describe('transitionTo (Linear canceled)', () => {
    it('transitions Linear issues to the canceled state when available', async () => {
      const layer = await makeTestLayer();
      const { IssueLifecycle } = await import('../issue-lifecycle.js');

      const program = Effect.gen(function* () {
        const lifecycle = yield* IssueLifecycle;
        yield* lifecycle.transitionTo('MIN-1', 'canceled');
      }).pipe(Effect.provide(layer));

      await runProgram(program);
      expect(mockLinearUpdateState).toHaveBeenCalledWith('uuid-1', 'state-canceled');
      expect(mockPatchIssue).toHaveBeenCalledWith('MIN-1', expect.objectContaining({ canonicalStatus: 'canceled' }));
    });
  });

  describe('close', () => {
    it('transitions Linear issue to closed state', async () => {
      const layer = await makeTestLayer();
      const { IssueLifecycle } = await import('../issue-lifecycle.js');

      const program = Effect.gen(function* () {
        const lifecycle = yield* IssueLifecycle;
        yield* lifecycle.close('MIN-1');
      }).pipe(Effect.provide(layer));

      await runProgram(program);
      expect(mockLinearUpdateState).toHaveBeenCalledWith('uuid-1', 'state-done');
    });

    it('emits issue.closed event and patches cache', async () => {
      const layer = await makeTestLayer();
      const { IssueLifecycle } = await import('../issue-lifecycle.js');

      const program = Effect.gen(function* () {
        const lifecycle = yield* IssueLifecycle;
        yield* lifecycle.close('MIN-1');
      }).pipe(Effect.provide(layer));

      await runProgram(program);
      expect(mockPatchIssue).toHaveBeenCalledWith('MIN-1', expect.objectContaining({ canonicalStatus: 'closed' }));
    });

    it('removes planning/in-review labels and closes GitHub issues', async () => {
      mockResolveTrackerType.mockReturnValue('github');
      mockResolveGitHubIssue.mockReturnValue({ isGitHub: true, owner: 'org', repo: 'repo', number: 42 });

      const layer = await makeTestLayer();
      const { IssueLifecycle } = await import('../issue-lifecycle.js');

      const program = Effect.gen(function* () {
        const lifecycle = yield* IssueLifecycle;
        yield* lifecycle.close('org/repo#42');
      }).pipe(Effect.provide(layer));

      await runProgram(program);
      expect(mockGitHubRemoveLabel).toHaveBeenCalledWith('org', 'repo', 42, 'in-review');
      expect(mockGitHubRemoveLabel).toHaveBeenCalledWith('org', 'repo', 42, 'in-planning');
      expect(mockGitHubCloseIssue).toHaveBeenCalledWith('org', 'repo', 42);
    });
  });

  describe('error handling — typed errors', () => {
    it('propagates TrackerNotConfigured error through the error channel', async () => {
      const { IssueLifecycle } = await import('../issue-lifecycle.js');
      const { LinearClient } = await import('../linear-client.js');
      const { GitHubClient } = await import('../github-client.js');
      const { RallyClient } = await import('../rally-client.js');
      const { IssueLifecycleLive } = await import('../issue-lifecycle.js');
      const { TrackerNotConfigured } = await import('../typed-errors.js');

      const fail = Effect.fail(new TrackerNotConfigured({ tracker: 'linear' }));
      const failLayer = Layer.succeed(LinearClient, {
        getIssue: () => fail,
        getTeamStates: () => fail,
        updateState: () => fail,
        addComment: vi.fn(),
        getComments: vi.fn(),
        findOrCreateLabel: vi.fn(),
        addLabel: vi.fn(),
        removeLabel: vi.fn(),
      });

      const githubLayer = Layer.succeed(GitHubClient, {
        getIssue: vi.fn(),
        addLabel: vi.fn(),
        removeLabel: vi.fn(),
        closeIssue: vi.fn(),
        reopenIssue: vi.fn(),
        ensureLabel: vi.fn(),
        addComment: vi.fn(),
        getComments: vi.fn(),
      });

      const rallyLayer = Layer.succeed(RallyClient, {
        getIssue: vi.fn(),
        getChildIssues: vi.fn(),
        updateState: vi.fn(),
        addComment: vi.fn(),
      });

      const layer = IssueLifecycleLive.pipe(
        Layer.provide(failLayer),
        Layer.provide(githubLayer),
        Layer.provide(rallyLayer),
      );

      const program = Effect.gen(function* () {
        const lifecycle = yield* IssueLifecycle;
        yield* lifecycle.transitionTo('MIN-1', 'in_progress');
      }).pipe(Effect.provide(layer));

      const err = await runProgramFail(program);
      expect((err as any)._tag).toBe('TrackerNotConfigured');
    });
  });
});
