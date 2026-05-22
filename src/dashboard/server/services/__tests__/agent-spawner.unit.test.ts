/**
 * Unit tests for AgentSpawner service (PAN-449)
 *
 * Tests AgentSpawner service with mocked underlying lib modules, verifying
 * that the service properly guards agent operations and handles errors.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Cause, Effect, Exit } from 'effect';

// ─── Mock node:fs ─────────────────────────────────────────────────────────────

const mockExistsSync = vi.fn();
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  promises: { mkdir: mockMkdir, writeFile: mockWriteFile },
}));

// ─── Mock lib/agents.ts ───────────────────────────────────────────────────────

const mockGetAgentState = vi.fn();
const mockGetAgentStateEffect = vi.fn();
const mockSpawnAgent = vi.fn();
const mockStopAgent = vi.fn();
const mockMessageAgent = vi.fn();
vi.mock('../../../../lib/agents.js', () => ({
  getAgentState: mockGetAgentState,
  getAgentStateEffect: mockGetAgentStateEffect,
  spawnAgent: mockSpawnAgent,
  stopAgent: mockStopAgent,
  stopAgentEffect: (agentId: string) => Effect.sync(() => mockStopAgent(agentId)),
  messageAgent: mockMessageAgent,
  normalizeAgentId: (id: string) => id.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
}));

// ─── Mock spawn-planning-session ─────────────────────────────────────────────

const mockSpawnPlanningSession = vi.fn();
vi.mock('../../../../lib/planning/spawn-planning-session.js', () => ({
  spawnPlanningSession: mockSpawnPlanningSession,
}));

// ─── Mock lifecycle workflows ─────────────────────────────────────────────────

const mockDeepWipe = vi.fn();
vi.mock('../../../../lib/lifecycle/workflows.js', () => ({
  deepWipe: mockDeepWipe,
}));

// ─── Mock projects ────────────────────────────────────────────────────────────

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

describe('AgentSpawner — integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockGetAgentState.mockReturnValue(null);
    mockGetAgentStateEffect.mockReturnValue(Effect.succeed(null));
    mockSpawnAgent.mockResolvedValue({ id: 'pan-1', issueId: 'PAN-1' });
    mockStopAgent.mockReturnValue(undefined);
    mockMessageAgent.mockResolvedValue(undefined);
    mockSpawnPlanningSession.mockResolvedValue({ success: true });
    // deepWipe returns an Effect, not a Promise (PAN-1249).
    mockDeepWipe.mockReturnValue(Effect.succeed({ success: true, steps: [] }));
  });

  describe('startWork', () => {
    it('fails with AgentStartError for bare numeric issueId', async () => {
      const { AgentSpawner, AgentSpawnerLive } = await import('../agent-spawner.js');

      const program = (await Effect.runPromise(Effect.gen(function* () {
        const spawner = yield* AgentSpawner;
        return yield* spawner.startWork('484', { workspacePath: WORKSPACE });
      }).pipe(Effect.provide(AgentSpawnerLive))));

      const err = await runEffectFail(program);
      expect((err as any)._tag).toBe('AgentStartError');
      expect((err as any).message).toContain('bare numeric');
      expect((err as any).message).toContain('PAN-484');
    });

    it('spawns agent when all guards pass', async () => {
      const { AgentSpawner, AgentSpawnerLive } = await import('../agent-spawner.js');

      const program = (await Effect.runPromise(Effect.gen(function* () {
        const spawner = yield* AgentSpawner;
        return yield* spawner.startWork('PAN-1', { workspacePath: WORKSPACE });
      }).pipe(Effect.provide(AgentSpawnerLive))));

      const result = await runEffect(program);
      expect(result.issueId).toBe('PAN-1');
      expect(mockSpawnAgent).toHaveBeenCalledOnce();
    });

    it('fails with WorkspaceNotFound when workspace does not exist', async () => {
      mockExistsSync.mockReturnValue(false);
      const { AgentSpawner, AgentSpawnerLive } = await import('../agent-spawner.js');

      const program = (await Effect.runPromise(Effect.gen(function* () {
        const spawner = yield* AgentSpawner;
        return yield* spawner.startWork('PAN-1', { workspacePath: '/nonexistent' });
      }).pipe(Effect.provide(AgentSpawnerLive))));

      const err = await runEffectFail(program);
      expect((err as any)._tag).toBe('WorkspaceNotFound');
    });

    it('fails with AgentAlreadyRunning when agent status is running', async () => {
      mockGetAgentStateEffect.mockReturnValue(Effect.succeed({ status: 'running', issueId: 'PAN-1' }));
      const { AgentSpawner, AgentSpawnerLive } = await import('../agent-spawner.js');

      const program = (await Effect.runPromise(Effect.gen(function* () {
        const spawner = yield* AgentSpawner;
        return yield* spawner.startWork('PAN-1', { workspacePath: WORKSPACE });
      }).pipe(Effect.provide(AgentSpawnerLive))));

      const err = await runEffectFail(program);
      expect((err as any)._tag).toBe('AgentAlreadyRunning');
    });
  });

  describe('kill', () => {
    it('kills a running agent and is non-fatal on error', async () => {
      mockStopAgent.mockImplementation(() => { throw new Error('session not found'); });
      const { AgentSpawner, AgentSpawnerLive } = await import('../agent-spawner.js');

      const program = (await Effect.runPromise(Effect.gen(function* () {
        const spawner = yield* AgentSpawner;
        yield* spawner.kill('pan-1');
      }).pipe(Effect.provide(AgentSpawnerLive))));

      // Should not throw
      await runEffect(program);
    });
  });

  describe('message', () => {
    it('delivers message to the agent', async () => {
      const { AgentSpawner, AgentSpawnerLive } = await import('../agent-spawner.js');

      const program = (await Effect.runPromise(Effect.gen(function* () {
        const spawner = yield* AgentSpawner;
        yield* spawner.message('pan-1', 'hello');
      }).pipe(Effect.provide(AgentSpawnerLive))));

      await runEffect(program);
      expect(mockMessageAgent).toHaveBeenCalledWith('pan-1', 'hello');
    });
  });

  describe('deepWipe', () => {
    it('executes deepWipe lifecycle with correct options', async () => {
      const { AgentSpawner, AgentSpawnerLive } = await import('../agent-spawner.js');

      const program = (await Effect.runPromise(Effect.gen(function* () {
        const spawner = yield* AgentSpawner;
        yield* spawner.deepWipe('PAN-1', { confirmed: true });
      }).pipe(Effect.provide(AgentSpawnerLive))));

      await runEffect(program);
      expect(mockDeepWipe).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'PAN-1' }),
        expect.objectContaining({ deleteWorkspace: true, deleteBranches: true }),
      );
    });
  });
});
