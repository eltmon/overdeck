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
  resolveProjectFromIssueSync: mockResolveProjectFromIssue,
  getProjectSync: vi.fn(() => null),
  loadProjectsConfig: mockLoadProjectsConfig,
  loadProjectsConfigSync: mockLoadProjectsConfig,
}));

// ─── Mock disk admission and child_process exec (PAN-4961) ────────────────────

const mockReserveDiskFloor = vi.fn();
const mockRelease = vi.fn();
vi.mock('../../../../lib/disk-floor.js', () => ({
  reserveDiskFloor: mockReserveDiskFloor,
}));

vi.mock('../../../../lib/workspace/disk-cost.js', () => ({
  SEED_STACK_DISK_COST_BYTES: 2 * 1024 ** 3,
  estimateWorkspaceDiskCost: vi.fn(async () => ({ hostBytes: 1, stackBytes: 2_000, hostSource: 'measured', stackSource: 'measured' })),
  invalidateWorkspaceDiskCostMemo: vi.fn(),
}));

const mockExec = vi.fn();
vi.mock('node:child_process', () => {
  const kCustom = Symbol.for('nodejs.util.promisify.custom');
  function exec() {
    throw new Error('exec is only called through promisify');
  }
  (exec as any)[kCustom] = (...args: unknown[]) => mockExec(...args);
  return { exec };
});

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

      const program = Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return yield* ws.create('PAN-1');
      }).pipe(Effect.provide(WorkspaceServiceLive));

      const path = await runProgram(program);
      expect(path).toContain('feature-pan-1');
      expect(mockCreateWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({ featureName: 'pan-1' }),
      );
    });

    it('is idempotent — returns path without calling createWorkspace when already exists', async () => {
      mockExistsSync.mockImplementation((path: string) => !path.endsWith('.overdeck/setup-incomplete'));
      const { WorkspaceService, WorkspaceServiceLive } = await import('../workspace-service.js');

      const program = Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return yield* ws.create('PAN-1');
      }).pipe(Effect.provide(WorkspaceServiceLive));

      const path = await runProgram(program);
      expect(path).toContain('feature-pan-1');
      expect(mockCreateWorkspace).not.toHaveBeenCalled();
    });

    it('calls createWorkspace to resume setup when the workspace exists but its setup never finished (PAN-4171)', async () => {
      mockExistsSync.mockReturnValue(true);
      const { WorkspaceService, WorkspaceServiceLive } = await import('../workspace-service.js');

      const program = Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return yield* ws.create('PAN-1');
      }).pipe(Effect.provide(WorkspaceServiceLive));

      const path = await runProgram(program);
      expect(path).toContain('feature-pan-1');
      expect(mockExistsSync).toHaveBeenCalledWith(expect.stringMatching(/feature-pan-1\/\.overdeck\/setup-incomplete$/));
      expect(mockCreateWorkspace).toHaveBeenCalledWith(expect.objectContaining({ featureName: 'pan-1' }));
    });

    it('fails with WorkspaceCreateError when no project configured', async () => {
      mockResolveProjectFromIssue.mockReturnValue(null);
      const { WorkspaceService, WorkspaceServiceLive } = await import('../workspace-service.js');

      const program = Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return yield* ws.create('UNKNOWN-1');
      }).pipe(Effect.provide(WorkspaceServiceLive));

      const err = await runProgramFail(program);
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

      const program = Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return yield* ws.clean('PAN-1', true);
      }).pipe(Effect.provide(WorkspaceServiceLive));

      const result = await runProgram(program);
      expect(result.preview).toBe(true);
      expect(result.artifacts.length).toBeGreaterThan(0);
    });

    it('fails with WorkspaceNotFound for non-existent workspace', async () => {
      mockExistsSync.mockReturnValue(false);
      const { WorkspaceService, WorkspaceServiceLive } = await import('../workspace-service.js');

      const program = Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return yield* ws.clean('PAN-1');
      }).pipe(Effect.provide(WorkspaceServiceLive));

      const err = await runProgramFail(program);
      expect((err as any)._tag).toBe('WorkspaceNotFound');
    });
  });

  describe('containerize disk admission (PAN-4961)', () => {
    const HELD = 'Disk low — new workspace starts are held: 11.0 GiB free on the filesystem holding /w, 0.0 GiB reserved by 0 in-flight workspace setup(s), this step needs 2.0 GiB, and the safety floor is 10.0 GiB. Free disk space (see /resources) and retry.';
    const upCalls = () => mockExec.mock.calls.filter(([command]) => String(command).includes('up -d --build'));

    beforeEach(() => {
      mockExistsSync.mockImplementation((p: string) =>
        p.endsWith('feature-pan-1') || p.endsWith('docker-compose.devcontainer.yml'));
      mockExec.mockResolvedValue({ stdout: '', stderr: '' });
      mockRelease.mockResolvedValue(undefined);
      mockReserveDiskFloor.mockResolvedValue({ ok: true, reservation: { release: mockRelease } });
    });

    it('containerize-admission.ac3: a refusal fails with WorkspaceCreateError and never runs up', async () => {
      mockReserveDiskFloor.mockResolvedValue({ ok: false, error: HELD });
      const { WorkspaceService, WorkspaceServiceLive } = await import('../workspace-service.js');

      const program = Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return yield* ws.containerize('PAN-1');
      }).pipe(Effect.provide(WorkspaceServiceLive));

      const err = await runProgramFail(program);
      expect((err as any)._tag).toBe('WorkspaceCreateError');
      expect((err as any).message.startsWith('Disk low — new workspace starts are held')).toBe(true);
      expect(upCalls()).toHaveLength(0);
    });

    it('containerize-admission.ac4: an admission runs up, then releases once', async () => {
      const order: string[] = [];
      mockExec.mockImplementation(async () => {
        order.push('up');
        return { stdout: '', stderr: '' };
      });
      mockRelease.mockImplementation(async () => {
        order.push('release');
      });
      const { WorkspaceService, WorkspaceServiceLive } = await import('../workspace-service.js');

      const program = Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        return yield* ws.containerize('PAN-1');
      }).pipe(Effect.provide(WorkspaceServiceLive));

      await runProgram(program);
      expect(upCalls()).toHaveLength(1);
      expect(mockReserveDiskFloor).toHaveBeenCalledWith(expect.objectContaining({ bytes: 2_000, label: 'containerize:pan-1' }));
      expect(mockRelease).toHaveBeenCalledTimes(1);
      expect(order).toEqual(['up', 'release']);
    });
  });
});
