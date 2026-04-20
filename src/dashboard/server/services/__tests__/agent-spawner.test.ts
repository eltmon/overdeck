import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Cause, Effect, Exit } from 'effect';

// ─── Mock node:fs (existsSync + promises) ────────────────────────────────────

const mockExistsSync = vi.fn();
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  promises: {
    mkdir: mockMkdir,
    writeFile: mockWriteFile,
  },
}));

// ─── Mock agents.ts ───────────────────────────────────────────────────────────

const mockGetAgentState = vi.fn();
const mockGetAgentStateAsync = vi.fn();
const mockSpawnAgent = vi.fn();
const mockStopAgent = vi.fn();
const mockMessageAgent = vi.fn();

vi.mock('../../../../lib/agents.js', () => ({
  getAgentState: mockGetAgentState,
  getAgentStateAsync: mockGetAgentStateAsync,
  spawnAgent: mockSpawnAgent,
  stopAgent: mockStopAgent,
  stopAgentAsync: mockStopAgent,
  messageAgent: mockMessageAgent,
  normalizeAgentId: (id: string) => id.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
}));

// ─── Mock spawn-planning-session ─────────────────────────────────────────────

const mockSpawnPlanningSession = vi.fn();
vi.mock('../../../../lib/planning/spawn-planning-session.js', () => ({
  spawnPlanningSession: mockSpawnPlanningSession,
}));

// ─── Mock lifecycle workflows (deepWipe) ─────────────────────────────────────

const mockDeepWipe = vi.fn();
vi.mock('../../../../lib/lifecycle/workflows.js', () => ({
  deepWipe: mockDeepWipe,
}));

// ─── Mock projects (resolveProjectFromIssue) ─────────────────────────────────

vi.mock('../../../../lib/projects.js', () => ({
  resolveProjectFromIssue: vi.fn().mockReturnValue({ path: '/projects/myapp', name: 'myapp' }),
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
    mockGetAgentStateAsync.mockResolvedValue(null);
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
      mockGetAgentStateAsync.mockResolvedValue({ status: 'running', issueId: 'PAN-1' });

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

  describe('startPlanning', () => {
    const PLANNING_OPTS = {
      workspacePath: WORKSPACE,
      projectPath: '/projects/myapp',
      issue: {
        id: 'uuid-1',
        identifier: 'PAN-1',
        title: 'Test issue',
        description: '# Planning prompt\n\nDo things.',
        url: 'https://github.com/org/repo/issues/1',
        source: 'github' as const,
      },
    };

    it('spawns a planning session when workspace exists', async () => {
      mockSpawnPlanningSession.mockResolvedValue({ success: true });

      const { AgentSpawner, AgentSpawnerLive } = await import('../agent-spawner.js');

      const program = Effect.gen(function* () {
        const spawner = yield* AgentSpawner;
        yield* spawner.startPlanning('PAN-1', PLANNING_OPTS);
      }).pipe(Effect.provide(AgentSpawnerLive));

      await runEffect(program);
      expect(mockSpawnPlanningSession).toHaveBeenCalledWith(
        expect.objectContaining({
          workspacePath: WORKSPACE,
          projectPath: '/projects/myapp',
          workspaceLocation: 'local',
        }),
      );
    });

    it('fails with WorkspaceNotFound when workspace does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const { AgentSpawner, AgentSpawnerLive } = await import('../agent-spawner.js');

      const program = Effect.gen(function* () {
        const spawner = yield* AgentSpawner;
        yield* spawner.startPlanning('PAN-1', PLANNING_OPTS);
      }).pipe(Effect.provide(AgentSpawnerLive));

      const err = await runEffectFail(program);
      expect((err as any)._tag).toBe('WorkspaceNotFound');
    });

    it('wraps planning session failure as AgentStartError', async () => {
      mockSpawnPlanningSession.mockResolvedValue({ success: false, error: 'tmux unavailable' });

      const { AgentSpawner, AgentSpawnerLive } = await import('../agent-spawner.js');

      const program = Effect.gen(function* () {
        const spawner = yield* AgentSpawner;
        yield* spawner.startPlanning('PAN-1', PLANNING_OPTS);
      }).pipe(Effect.provide(AgentSpawnerLive));

      const err = await runEffectFail(program);
      expect((err as any)._tag).toBe('AgentStartError');
      expect((err as any).message).toContain('tmux unavailable');
    });
  });

  describe('deepWipe', () => {
    it('calls deepWipe with confirmed:true', async () => {
      mockDeepWipe.mockResolvedValue({ success: true, steps: [] });

      const { AgentSpawner, AgentSpawnerLive } = await import('../agent-spawner.js');

      const program = Effect.gen(function* () {
        const spawner = yield* AgentSpawner;
        yield* spawner.deepWipe('PAN-1', { confirmed: true });
      }).pipe(Effect.provide(AgentSpawnerLive));

      await runEffect(program);
      expect(mockDeepWipe).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'PAN-1' }),
        expect.objectContaining({ deleteWorkspace: true, deleteBranches: true, resetIssue: true }),
      );
    });

    it('respects custom deleteWorkspace/deleteBranches/resetIssue options', async () => {
      mockDeepWipe.mockResolvedValue({ success: true, steps: [] });

      const { AgentSpawner, AgentSpawnerLive } = await import('../agent-spawner.js');

      const program = Effect.gen(function* () {
        const spawner = yield* AgentSpawner;
        yield* spawner.deepWipe('PAN-1', {
          confirmed: true,
          deleteWorkspace: false,
          deleteBranches: false,
          resetIssue: false,
        });
      }).pipe(Effect.provide(AgentSpawnerLive));

      await runEffect(program);
      expect(mockDeepWipe).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'PAN-1' }),
        expect.objectContaining({ deleteWorkspace: false, deleteBranches: false, resetIssue: false }),
      );
    });

    it('wraps deepWipe errors as AgentStartError', async () => {
      mockDeepWipe.mockRejectedValue(new Error('branch deletion failed'));

      const { AgentSpawner, AgentSpawnerLive } = await import('../agent-spawner.js');

      const program = Effect.gen(function* () {
        const spawner = yield* AgentSpawner;
        yield* spawner.deepWipe('PAN-1', { confirmed: true });
      }).pipe(Effect.provide(AgentSpawnerLive));

      const err = await runEffectFail(program);
      expect((err as any)._tag).toBe('AgentStartError');
      expect((err as any).message).toContain('branch deletion failed');
    });
  });
});
