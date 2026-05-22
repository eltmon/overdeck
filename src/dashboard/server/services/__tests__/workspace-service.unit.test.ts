/**
 * Unit tests for WorkspaceService (PAN-449)
 *
 * Tests WorkspaceService with mocked underlying workspace-manager.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Cause, Effect, Exit } from 'effect';

// ─── Mock workspace-manager ────────────────────────────────────────────────────

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
vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    stat: vi.fn().mockResolvedValue({ isFile: () => false }),
    rm: vi.fn().mockResolvedValue(undefined),
  },
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

const MOCK_PROJECT = { path: '/projects/myapp', name: 'myapp' };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WorkspaceService — integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveProjectFromIssue.mockReturnValue(MOCK_PROJECT);
    mockLoadProjectsConfig.mockReturnValue({ projects: { myapp: MOCK_PROJECT } });
    mockExistsSync.mockReturnValue(false);
    mockCreateWorkspace.mockResolvedValue({
      success: true,
      workspacePath: '/projects/myapp/workspaces/feature-pan-1',
      errors: [],
      steps: ['created'],
    });
    mockRemoveWorkspace.mockResolvedValue({ success: true, errors: [], steps: [] });
    mockStopWorkspaceDocker.mockResolvedValue(undefined);
  });

  describe('create', () => {
    it('creates workspace and returns path when workspace does not exist', async () => {
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

    it('is idempotent — returns path without calling createWorkspace when already exists', async () => {
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

    it('fails with WorkspaceCreateError when no project configured', async () => {
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

  describe('clean (preview mode)', () => {
    it('returns artifact list without deleting in preview mode', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.endsWith('node_modules') || p.endsWith('dist')) return true;
        if (p.endsWith('feature-pan-1')) return true;
        return false;
      });

      const { WorkspaceService, WorkspaceServiceLive } = await import('../workspace-service.js');

      const program = (await Effect.runPromise(Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return yield* ws.clean('PAN-1', true);
      }).pipe(Effect.provide(WorkspaceServiceLive))));

      const result = await runEffect(program);
      expect(result.preview).toBe(true);
      expect(result.artifacts.length).toBeGreaterThan(0);
    });

    it('fails with WorkspaceNotFound for non-existent workspace', async () => {
      mockExistsSync.mockReturnValue(false);
      const { WorkspaceService, WorkspaceServiceLive } = await import('../workspace-service.js');

      const program = (await Effect.runPromise(Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return yield* ws.clean('PAN-1');
      }).pipe(Effect.provide(WorkspaceServiceLive))));

      const err = await runEffectFail(program);
      expect((err as any)._tag).toBe('WorkspaceNotFound');
    });
  });
});
