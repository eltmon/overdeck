import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Cause, Effect, Exit } from 'effect';

// ─── Mock workspace-manager ───────────────────────────────────────────────────

const mockCreateWorkspace = vi.fn();
const mockRemoveWorkspace = vi.fn();
const mockStopWorkspaceDocker = vi.fn();

vi.mock('../../../../lib/workspace-manager.js', () => ({
  createWorkspace: mockCreateWorkspace,
  removeWorkspace: mockRemoveWorkspace,
  stopWorkspaceDocker: mockStopWorkspaceDocker,
}));

// ─── Mock projects ────────────────────────────────────────────────────────────

const mockResolveProjectFromIssue = vi.fn();
const mockLoadProjectsConfig = vi.fn();

vi.mock('../../../../lib/projects.js', () => ({
  resolveProjectFromIssue: mockResolveProjectFromIssue,
  loadProjectsConfig: mockLoadProjectsConfig,
}));

// ─── Mock fs.existsSync ───────────────────────────────────────────────────────

const mockExistsSync = vi.fn();
vi.mock('node:fs', () => ({ existsSync: mockExistsSync }));

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

const MOCK_PROJECT = {
  path: '/projects/myapp',
  name: 'myapp',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WorkspaceService Effect service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveProjectFromIssue.mockReturnValue(MOCK_PROJECT);
    mockLoadProjectsConfig.mockReturnValue({
      projects: { myapp: MOCK_PROJECT },
    });
    mockExistsSync.mockReturnValue(true);
  });

  describe('resolve', () => {
    it('returns workspace path and existence flag', async () => {
      mockExistsSync.mockReturnValue(false);
      const { WorkspaceService, WorkspaceServiceLive } = await import('../workspace-service.js');

      const program = (await Effect.runPromise(Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return yield* ws.resolve('PAN-1');
      }).pipe(Effect.provide(WorkspaceServiceLive))));

      const info = await runEffect(program);
      expect(info.issueId).toBe('PAN-1');
      expect(info.path).toContain('feature-pan-1');
      expect(info.exists).toBe(false);
      expect(info.branch).toBe('feature/pan-1');
    });

    it('reports workspace as existing when directory is present', async () => {
      mockExistsSync.mockReturnValue(true);
      const { WorkspaceService, WorkspaceServiceLive } = await import('../workspace-service.js');

      const program = (await Effect.runPromise(Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return yield* ws.resolve('PAN-5');
      }).pipe(Effect.provide(WorkspaceServiceLive))));

      const info = await runEffect(program);
      expect(info.exists).toBe(true);
    });
  });

  describe('create', () => {
    it('calls createWorkspace and returns workspace path when workspace does not exist', async () => {
      // Workspace does not yet exist — should call createWorkspace
      mockExistsSync.mockReturnValue(false);
      mockCreateWorkspace.mockResolvedValue({
        success: true,
        workspacePath: '/projects/myapp/workspaces/feature-pan-1',
        errors: [],
        steps: ['created'],
      });

      const { WorkspaceService, WorkspaceServiceLive } = await import('../workspace-service.js');

      const program = (await Effect.runPromise(Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return yield* ws.create('PAN-1');
      }).pipe(Effect.provide(WorkspaceServiceLive))));

      const path = await runEffect(program);
      expect(path).toContain('feature-pan-1');
      expect(mockCreateWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({ featureName: 'pan-1' }),
      );
    });

    it('is idempotent — returns path without error when workspace already exists', async () => {
      // Workspace already exists — should NOT call createWorkspace
      mockExistsSync.mockReturnValue(true);

      const { WorkspaceService, WorkspaceServiceLive } = await import('../workspace-service.js');

      const program = (await Effect.runPromise(Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return yield* ws.create('PAN-1');
      }).pipe(Effect.provide(WorkspaceServiceLive))));

      const path = await runEffect(program);
      expect(path).toContain('feature-pan-1');
      expect(mockCreateWorkspace).not.toHaveBeenCalled();
    });

    it('fails with WorkspaceCreateError when creation fails', async () => {
      mockExistsSync.mockReturnValue(false);
      mockCreateWorkspace.mockResolvedValue({
        success: false,
        workspacePath: '',
        errors: ['git worktree failed'],
        steps: [],
      });

      const { WorkspaceService, WorkspaceServiceLive } = await import('../workspace-service.js');

      const program = (await Effect.runPromise(Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return yield* ws.create('PAN-1');
      }).pipe(Effect.provide(WorkspaceServiceLive))));

      const err = await runEffectFail(program);
      expect((err as any)._tag).toBe('WorkspaceCreateError');
      expect((err as any).message).toContain('git worktree failed');
    });

    it('fails with WorkspaceCreateError when no project is configured', async () => {
      mockExistsSync.mockReturnValue(false);
      mockResolveProjectFromIssue.mockReturnValue(null);

      const { WorkspaceService, WorkspaceServiceLive } = await import('../workspace-service.js');

      const program = (await Effect.runPromise(Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return yield* ws.create('UNKNOWN-1');
      }).pipe(Effect.provide(WorkspaceServiceLive))));

      const err = await runEffectFail(program);
      expect((err as any)._tag).toBe('WorkspaceCreateError');
    });
  });

  describe('remove', () => {
    it('calls removeWorkspace for existing workspace', async () => {
      mockRemoveWorkspace.mockResolvedValue({
        success: true,
        errors: [],
        steps: ['removed'],
      });

      const { WorkspaceService, WorkspaceServiceLive } = await import('../workspace-service.js');

      const program = (await Effect.runPromise(Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        yield* ws.remove('PAN-1');
      }).pipe(Effect.provide(WorkspaceServiceLive))));

      await runEffect(program);
      expect(mockRemoveWorkspace).toHaveBeenCalled();
    });

    it('fails with WorkspaceNotFound when workspace does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const { WorkspaceService, WorkspaceServiceLive } = await import('../workspace-service.js');

      const program = (await Effect.runPromise(Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        yield* ws.remove('PAN-99');
      }).pipe(Effect.provide(WorkspaceServiceLive))));

      const err = await runEffectFail(program);
      expect((err as any)._tag).toBe('WorkspaceNotFound');
    });
  });

  describe('stopDocker', () => {
    it('calls stopWorkspaceDocker and is non-fatal on error', async () => {
      mockStopWorkspaceDocker.mockRejectedValue(new Error('Docker not running'));

      const { WorkspaceService, WorkspaceServiceLive } = await import('../workspace-service.js');

      const program = (await Effect.runPromise(Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        yield* ws.stopDocker('PAN-1');
      }).pipe(Effect.provide(WorkspaceServiceLive))));

      // Should not throw
      await runEffect(program);
      expect(mockStopWorkspaceDocker).toHaveBeenCalled();
    });
  });
});
