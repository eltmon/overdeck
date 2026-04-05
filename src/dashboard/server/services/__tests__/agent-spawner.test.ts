import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Cause, Effect, Exit } from 'effect';

// ─── Mock fs.existsSync ───────────────────────────────────────────────────────

const mockExistsSync = vi.fn();
vi.mock('node:fs', () => ({ existsSync: mockExistsSync }));

// ─── Mock agents.ts ───────────────────────────────────────────────────────────

const mockGetAgentState = vi.fn();
const mockSpawnAgent = vi.fn();
const mockStopAgent = vi.fn();
const mockMessageAgent = vi.fn();

vi.mock('../../../../lib/agents.js', () => ({
  getAgentState: mockGetAgentState,
  spawnAgent: mockSpawnAgent,
  stopAgent: mockStopAgent,
  messageAgent: mockMessageAgent,
  normalizeAgentId: (id: string) => id.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
}));

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

const WORKSPACE = '/projects/myapp/workspaces/feature-pan-1';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AgentSpawner Effect service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: workspace exists, beads exist, no running agent
    mockExistsSync.mockImplementation((path: string) => {
      if (path.includes('.beads')) return true;
      return true; // workspace exists
    });
    mockGetAgentState.mockReturnValue(null);
    mockSpawnAgent.mockResolvedValue({ id: 'pan-1', issueId: 'PAN-1' });
    mockStopAgent.mockReturnValue(undefined);
    mockMessageAgent.mockResolvedValue(undefined);
  });

  describe('startWork', () => {
    it('spawns an agent when all guards pass', async () => {
      const { AgentSpawner, AgentSpawnerLive } = await import('../agent-spawner.js');

      const program = Effect.gen(function* () {
        const spawner = yield* AgentSpawner;
        return yield* spawner.startWork('PAN-1', { workspacePath: WORKSPACE });
      }).pipe(Effect.provide(AgentSpawnerLive));

      const agent = await runEffect(program);
      expect(agent.issueId).toBe('PAN-1');
      expect(mockSpawnAgent).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'PAN-1', workspace: WORKSPACE }),
      );
    });

    it('fails with WorkspaceNotFound when workspace does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const { AgentSpawner, AgentSpawnerLive } = await import('../agent-spawner.js');

      const program = Effect.gen(function* () {
        const spawner = yield* AgentSpawner;
        return yield* spawner.startWork('PAN-1', { workspacePath: WORKSPACE });
      }).pipe(Effect.provide(AgentSpawnerLive));

      const err = await runEffectFail(program);
      expect((err as any)._tag).toBe('WorkspaceNotFound');
    });

    it('fails with BeadsNotInitialized when .beads dir is missing', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (path.includes('.beads')) return false;
        return true; // workspace exists
      });

      const { AgentSpawner, AgentSpawnerLive } = await import('../agent-spawner.js');

      const program = Effect.gen(function* () {
        const spawner = yield* AgentSpawner;
        return yield* spawner.startWork('PAN-1', { workspacePath: WORKSPACE });
      }).pipe(Effect.provide(AgentSpawnerLive));

      const err = await runEffectFail(program);
      expect((err as any)._tag).toBe('BeadsNotInitialized');
    });

    it('fails with AgentAlreadyRunning when agent status is running', async () => {
      mockGetAgentState.mockReturnValue({ status: 'running', issueId: 'PAN-1' });

      const { AgentSpawner, AgentSpawnerLive } = await import('../agent-spawner.js');

      const program = Effect.gen(function* () {
        const spawner = yield* AgentSpawner;
        return yield* spawner.startWork('PAN-1', { workspacePath: WORKSPACE });
      }).pipe(Effect.provide(AgentSpawnerLive));

      const err = await runEffectFail(program);
      expect((err as any)._tag).toBe('AgentAlreadyRunning');
    });

    it('wraps spawnAgent errors as AgentStartError', async () => {
      mockSpawnAgent.mockRejectedValue(new Error('tmux session conflict'));

      const { AgentSpawner, AgentSpawnerLive } = await import('../agent-spawner.js');

      const program = Effect.gen(function* () {
        const spawner = yield* AgentSpawner;
        return yield* spawner.startWork('PAN-1', { workspacePath: WORKSPACE });
      }).pipe(Effect.provide(AgentSpawnerLive));

      const err = await runEffectFail(program);
      expect((err as any)._tag).toBe('AgentStartError');
      expect((err as any).message).toContain('tmux session conflict');
    });
  });

  describe('kill', () => {
    it('calls stopAgent and is non-fatal on error', async () => {
      mockStopAgent.mockImplementation(() => {
        throw new Error('session not found');
      });

      const { AgentSpawner, AgentSpawnerLive } = await import('../agent-spawner.js');

      const program = Effect.gen(function* () {
        const spawner = yield* AgentSpawner;
        yield* spawner.kill('pan-1');
      }).pipe(Effect.provide(AgentSpawnerLive));

      // Should not throw
      await runEffect(program);
      expect(mockStopAgent).toHaveBeenCalledWith('pan-1');
    });
  });

  describe('message', () => {
    it('delegates to messageAgent', async () => {
      const { AgentSpawner, AgentSpawnerLive } = await import('../agent-spawner.js');

      const program = Effect.gen(function* () {
        const spawner = yield* AgentSpawner;
        yield* spawner.message('pan-1', 'hello agent');
      }).pipe(Effect.provide(AgentSpawnerLive));

      await runEffect(program);
      expect(mockMessageAgent).toHaveBeenCalledWith('pan-1', 'hello agent');
    });

    it('wraps errors as AgentStartError', async () => {
      mockMessageAgent.mockRejectedValue(new Error('no session'));

      const { AgentSpawner, AgentSpawnerLive } = await import('../agent-spawner.js');

      const program = Effect.gen(function* () {
        const spawner = yield* AgentSpawner;
        yield* spawner.message('pan-1', 'hello');
      }).pipe(Effect.provide(AgentSpawnerLive));

      const err = await runEffectFail(program);
      expect((err as any)._tag).toBe('AgentStartError');
    });
  });
});
