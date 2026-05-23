import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Cause, Effect, Exit } from 'effect';

// ─── Mock SDK method functions ────────────────────────────────────────────────
// Declared first so they can be referenced in the factory below.

const mockSdkIssue = vi.fn();
const mockSdkSearchIssues = vi.fn();
const mockSdkTeam = vi.fn();
const mockSdkUpdateIssue = vi.fn();
const mockSdkCreateComment = vi.fn();
const mockSdkIssueLabels = vi.fn();
const mockSdkCreateIssueLabel = vi.fn();

// ─── Mock @linear/sdk ─────────────────────────────────────────────────────────

vi.mock('@linear/sdk', () => ({
  LinearClient: vi.fn().mockImplementation(function () { return {
    issue: mockSdkIssue,
    searchIssues: mockSdkSearchIssues,
    team: mockSdkTeam,
    updateIssue: mockSdkUpdateIssue,
    createComment: mockSdkCreateComment,
    issueLabels: mockSdkIssueLabels,
    createIssueLabel: mockSdkCreateIssueLabel,
  }; }),
}));

// ─── Mock tracker-config ──────────────────────────────────────────────────────

const mockGetLinearApiKey = vi.fn();
vi.mock('../tracker-config.js', () => ({
  getLinearApiKey: mockGetLinearApiKey,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const UUID_A = '00000000-0000-0000-0000-aaaaaaaaaaaa';
const UUID_B = '00000000-0000-0000-0000-bbbbbbbbbbbb';

function makeRawIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID_A,
    identifier: 'MIN-1',
    title: 'Test Issue',
    description: 'desc',
    url: 'https://linear.app/test',
    priority: 2,
    state: Promise.resolve({ id: 'state-1', name: 'In Progress' }),
    team: Promise.resolve({ id: 'team-1', key: 'MIN' }),
    labels: () => Promise.resolve({ nodes: [] }),
    ...overrides,
  };
}

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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LinearClient Effect service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLinearApiKey.mockReturnValue('test-api-key');
    // Safe defaults: search returns empty, issue returns null, labels return empty
    mockSdkSearchIssues.mockResolvedValue({ nodes: [] });
    mockSdkIssue.mockResolvedValue(null);
    mockSdkIssueLabels.mockResolvedValue({ nodes: [] });
    mockSdkUpdateIssue.mockResolvedValue({});
    mockSdkCreateComment.mockResolvedValue({});
    mockSdkTeam.mockResolvedValue({ states: () => Promise.resolve({ nodes: [] }) });
  });

  describe('LinearClientLive layer', () => {
    it('fails with TrackerNotConfigured when LINEAR_API_KEY is missing', async () => {
      mockGetLinearApiKey.mockReturnValue(null);

      const { LinearClient, LinearClientLive } = await import('../linear-client.js');

      const program = Effect.gen(function* () {
        const client = yield* LinearClient;
        return yield* client.getIssue('MIN-1');
      }).pipe(Effect.provide(LinearClientLive));

      const err = await runProgramFail(program);
      expect((err as any)._tag).toBe('TrackerNotConfigured');
      expect((err as any).tracker).toBe('linear');
    });
  });

  describe('getIssue', () => {
    it('fetches issue by UUID', async () => {
      const raw = makeRawIssue({ id: UUID_A, identifier: 'MIN-5' });
      mockSdkIssue.mockResolvedValue(raw);

      const { LinearClient, LinearClientLive } = await import('../linear-client.js');

      const program = Effect.gen(function* () {
        const client = yield* LinearClient;
        return yield* client.getIssue(UUID_A);
      }).pipe(Effect.provide(LinearClientLive));

      const issue = await runProgram(program);
      expect(issue.id).toBe(UUID_A);
      expect(issue.identifier).toBe('MIN-5');
      expect(mockSdkIssue).toHaveBeenCalledWith(UUID_A);
    });

    it('searches by identifier (e.g. MIN-1)', async () => {
      const raw = makeRawIssue({ identifier: 'MIN-1' });
      mockSdkSearchIssues.mockResolvedValue({ nodes: [raw] });

      const { LinearClient, LinearClientLive } = await import('../linear-client.js');

      const program = Effect.gen(function* () {
        const client = yield* LinearClient;
        return yield* client.getIssue('MIN-1');
      }).pipe(Effect.provide(LinearClientLive));

      const issue = await runProgram(program);
      expect(issue.identifier).toBe('MIN-1');
      expect(mockSdkSearchIssues).toHaveBeenCalledWith('MIN-1', { first: 1 });
    });

    it('handles search results that expose labels as a property instead of a function', async () => {
      const raw = makeRawIssue({
        identifier: 'MIN-7',
        labels: Promise.resolve({ nodes: [{ id: 'label-1', name: 'bug' }] }),
      });
      mockSdkSearchIssues.mockResolvedValue({ nodes: [raw] });

      const { LinearClient, LinearClientLive } = await import('../linear-client.js');

      const program = Effect.gen(function* () {
        const client = yield* LinearClient;
        return yield* client.getIssue('MIN-7');
      }).pipe(Effect.provide(LinearClientLive));

      const issue = await runProgram(program);
      expect(issue.identifier).toBe('MIN-7');
      expect(issue.labels).toEqual([{ id: 'label-1', name: 'bug' }]);
    });

    it('fails with IssueNotFound when SDK returns null', async () => {
      // mockSdkIssue is already set to return null in beforeEach

      const { LinearClient, LinearClientLive } = await import('../linear-client.js');

      const program = Effect.gen(function* () {
        const client = yield* LinearClient;
        return yield* client.getIssue(UUID_B);
      }).pipe(Effect.provide(LinearClientLive));

      const err = await runProgramFail(program);
      expect((err as any)._tag).toBe('IssueNotFound');
      expect((err as any).id).toBe(UUID_B);
    });

    it('fails with IssueNotFound when search returns empty', async () => {
      // mockSdkSearchIssues is already set to return { nodes: [] } in beforeEach

      const { LinearClient, LinearClientLive } = await import('../linear-client.js');

      const program = Effect.gen(function* () {
        const client = yield* LinearClient;
        return yield* client.getIssue('MIN-999');
      }).pipe(Effect.provide(LinearClientLive));

      const err = await runProgramFail(program);
      expect((err as any)._tag).toBe('IssueNotFound');
    });

    it('wraps SDK errors as TrackerApiError', async () => {
      mockSdkIssue.mockRejectedValue(new Error('Network timeout'));

      const { LinearClient, LinearClientLive } = await import('../linear-client.js');

      const program = Effect.gen(function* () {
        const client = yield* LinearClient;
        return yield* client.getIssue(UUID_A);
      }).pipe(Effect.provide(LinearClientLive));

      const err = await runProgramFail(program);
      expect((err as any)._tag).toBe('TrackerApiError');
      expect((err as any).message).toContain('Network timeout');
    });
  });

  describe('getTeamStates', () => {
    it('returns team states', async () => {
      mockSdkTeam.mockResolvedValue({
        states: () =>
          Promise.resolve({
            nodes: [
              { id: 'state-1', name: 'In Progress', type: 'started' },
              { id: 'state-2', name: 'Done', type: 'completed' },
            ],
          }),
      });

      const { LinearClient, LinearClientLive } = await import('../linear-client.js');

      const program = Effect.gen(function* () {
        const client = yield* LinearClient;
        return yield* client.getTeamStates('team-1');
      }).pipe(Effect.provide(LinearClientLive));

      const states = await runProgram(program);
      expect(states).toHaveLength(2);
      expect(states[0].name).toBe('In Progress');
      expect(states[1].type).toBe('completed');
    });
  });

  describe('updateState', () => {
    it('calls SDK updateIssue with stateId', async () => {
      const { LinearClient, LinearClientLive } = await import('../linear-client.js');

      const program = Effect.gen(function* () {
        const client = yield* LinearClient;
        yield* client.updateState(UUID_A, 'state-uuid');
      }).pipe(Effect.provide(LinearClientLive));

      await runProgram(program);
      expect(mockSdkUpdateIssue).toHaveBeenCalledWith(UUID_A, { stateId: 'state-uuid' });
    });
  });

  describe('addComment', () => {
    it('calls SDK createComment', async () => {
      const { LinearClient, LinearClientLive } = await import('../linear-client.js');

      const program = Effect.gen(function* () {
        const client = yield* LinearClient;
        yield* client.addComment(UUID_A, 'hello world');
      }).pipe(Effect.provide(LinearClientLive));

      await runProgram(program);
      expect(mockSdkCreateComment).toHaveBeenCalledWith({
        issueId: UUID_A,
        body: 'hello world',
      });
    });
  });

  describe('findOrCreateLabel', () => {
    it('returns existing label if found', async () => {
      mockSdkIssueLabels.mockResolvedValue({
        nodes: [{ id: 'label-1', name: 'merged' }],
      });

      const { LinearClient, LinearClientLive } = await import('../linear-client.js');

      const program = Effect.gen(function* () {
        const client = yield* LinearClient;
        return yield* client.findOrCreateLabel('team-1', 'merged');
      }).pipe(Effect.provide(LinearClientLive));

      const label = await runProgram(program);
      expect(label.id).toBe('label-1');
      expect(mockSdkCreateIssueLabel).not.toHaveBeenCalled();
    });

    it('creates label when not found', async () => {
      // mockSdkIssueLabels already returns { nodes: [] } from beforeEach
      mockSdkCreateIssueLabel.mockResolvedValue({
        issueLabel: Promise.resolve({ id: 'label-new', name: 'merged' }),
      });

      const { LinearClient, LinearClientLive } = await import('../linear-client.js');

      const program = Effect.gen(function* () {
        const client = yield* LinearClient;
        return yield* client.findOrCreateLabel('team-1', 'merged', '#00c000');
      }).pipe(Effect.provide(LinearClientLive));

      const label = await runProgram(program);
      expect(label.id).toBe('label-new');
      expect(mockSdkCreateIssueLabel).toHaveBeenCalledWith({
        teamId: 'team-1',
        name: 'merged',
        color: '#00c000',
      });
    });
  });

  describe('getComments', () => {
    it('returns comments with author and body', async () => {
      mockSdkIssue.mockResolvedValue({
        ...makeRawIssue(),
        comments: () => Promise.resolve({
          nodes: [
            {
              body: 'Nice work!',
              createdAt: '2025-01-01T00:00:00.000Z',
              user: Promise.resolve({ name: 'Alice' }),
            },
            {
              body: 'LGTM',
              createdAt: '2025-01-02T00:00:00.000Z',
              user: Promise.resolve({ name: 'Bob' }),
            },
          ],
        }),
      });

      const { LinearClient, LinearClientLive } = await import('../linear-client.js');

      const program = Effect.gen(function* () {
        const client = yield* LinearClient;
        return yield* client.getComments(UUID_A);
      }).pipe(Effect.provide(LinearClientLive));

      const comments = await runProgram(program);
      expect(comments).toHaveLength(2);
      expect(comments[0]).toEqual({ body: 'Nice work!', author: 'Alice', createdAt: '2025-01-01T00:00:00.000Z' });
      expect(comments[1]).toEqual({ body: 'LGTM', author: 'Bob', createdAt: '2025-01-02T00:00:00.000Z' });
    });

    it('returns empty array when issue has no comments', async () => {
      mockSdkIssue.mockResolvedValue({
        ...makeRawIssue(),
        comments: () => Promise.resolve({ nodes: [] }),
      });

      const { LinearClient, LinearClientLive } = await import('../linear-client.js');

      const program = Effect.gen(function* () {
        const client = yield* LinearClient;
        return yield* client.getComments(UUID_A);
      }).pipe(Effect.provide(LinearClientLive));

      const comments = await runProgram(program);
      expect(comments).toHaveLength(0);
    });
  });
});
