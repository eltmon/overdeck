import { EventEmitter } from 'node:events';
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acquireRestartLock: vi.fn(),
  readRestartLockHolder: vi.fn(),
  readPlatformConfig: vi.fn(),
  restartDashboard: vi.fn(),
  stopDashboard: vi.fn(),
  writeRestartStatus: vi.fn(),
  resolveBundledServerPath: vi.fn(),
  spawnDashboardDetached: vi.fn(),
  spawn: vi.fn(),
  statSync: vi.fn(),
  readDevSupervisorMarker: vi.fn(),
  devSupervisorRefusalLines: vi.fn(),
}));

// reloadCommand refuses to run when a `pan dev` supervisor marker is present.
// Without mocking this, the test outcome depends on whether the host happens to
// have a live `pan dev` session — green in CI, red on a developer's machine.
// Default to "no dev session" so the test is hermetic.
vi.mock('../../../lib/dev-supervisor.js', () => ({
  readDevSupervisorMarker: mocks.readDevSupervisorMarker,
  devSupervisorRefusalLines: mocks.devSupervisorRefusalLines,
}));

vi.mock('../../../lib/restart-lock.js', () => ({
  acquireRestartLock: mocks.acquireRestartLock,
  readRestartLockHolder: mocks.readRestartLockHolder,
}));

vi.mock('../../../lib/platform-lifecycle.js', () => ({
  readPlatformConfig: mocks.readPlatformConfig,
  readPlatformConfigSync: mocks.readPlatformConfig,
  restartDashboard: mocks.restartDashboard,
  stopDashboard: mocks.stopDashboard,
  StageError: class StageError extends Error {
    failure: { stage: string; reason: string };
    constructor(failure: { stage: string; reason: string }) {
      super(`[${failure.stage}] ${failure.reason}`);
      this.failure = failure;
    }
  },
}));

vi.mock('../../../lib/restart-status.js', () => ({
  writeRestartStatus: mocks.writeRestartStatus,
}));

vi.mock('../restart.js', () => ({
  resolveBundledServerPath: mocks.resolveBundledServerPath,
  spawnDashboardDetached: mocks.spawnDashboardDetached,
}));

vi.mock('child_process', () => ({
  spawn: mocks.spawn,
}));

vi.mock('fs', async (importActual) => ({
  ...(await importActual<typeof import('fs')>()),
  statSync: mocks.statSync,
}));

import { reloadCommand } from '../reload.js';

// reloadCommand spawns `bun install` then `npm run build`. Let tests set each
// step's exit code independently; default both to success.
function mockSpawnExits(opts: { install?: number; build?: number } = {}): void {
  mocks.spawn.mockImplementation((command: string, args: string[]) => {
    const child = new EventEmitter();
    const isBuild = command === 'npm' && args[0] === 'run' && args[1] === 'build';
    const code = isBuild ? (opts.build ?? 0) : (opts.install ?? 0);
    process.nextTick(() => child.emit('close', code));
    return child;
  });
}

describe('reloadCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mocks.acquireRestartLock.mockReturnValue(Effect.succeed({ release: vi.fn(() => Promise.resolve()) }));
    mocks.readRestartLockHolder.mockReturnValue(Effect.succeed(null));
    mocks.readPlatformConfig.mockReturnValue({
      dashboardPort: 3010,
      dashboardApiPort: 3011,
      traefikEnabled: false,
      traefikDomain: 'pan.localhost',
      traefikDir: '/tmp/traefik',
    });
    mocks.restartDashboard.mockReturnValue(Effect.succeed(undefined));
    mocks.writeRestartStatus.mockReturnValue(Effect.succeed(undefined));
    mocks.resolveBundledServerPath.mockReturnValue('/tmp/server.js');
    mocks.readDevSupervisorMarker.mockReturnValue(null);
    mocks.devSupervisorRefusalLines.mockReturnValue([]);
  });

  it('signals a running pan dev supervisor (SIGUSR2) instead of refusing or restarting (PAN-1662)', async () => {
    mocks.readDevSupervisorMarker.mockReturnValue({
      pid: 424242,
      dashboardPort: 3010,
      apiPort: 3011,
      startedAt: '2026-06-07T00:00:00.000Z',
    });
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    await reloadCommand({});

    expect(mocks.acquireRestartLock).toHaveBeenCalledWith('pan reload');
    expect(killSpy).toHaveBeenCalledWith(424242, 'SIGUSR2');
    // It signals the dev supervisor to hot-restart in place — it must NOT run a
    // production restart or refuse with a non-zero exit code.
    expect(mocks.restartDashboard).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();

    killSpy.mockRestore();
  });

  it('refuses to signal pan dev when the restart lock is already held', async () => {
    mocks.readDevSupervisorMarker.mockReturnValue({
      pid: 424242,
      dashboardPort: 3010,
      apiPort: 3011,
      startedAt: '2026-06-07T00:00:00.000Z',
    });
    mocks.acquireRestartLock.mockReturnValue(Effect.succeed(null));
    mocks.readRestartLockHolder.mockReturnValue(
      Effect.succeed({ pid: 777777, caller: 'pan reload', ts: Date.now() }),
    );
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    await reloadCommand({});

    expect(killSpy).not.toHaveBeenCalled();
    expect(mocks.restartDashboard).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.writeRestartStatus).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: expect.stringContaining('restart in progress') }),
    );
    expect(process.exitCode).toBe(2);

    killSpy.mockRestore();
  });

  it('refuses the detached path when the restart lock is already held', async () => {
    mocks.acquireRestartLock.mockReturnValue(Effect.succeed(null));
    mocks.readRestartLockHolder.mockReturnValue(
      Effect.succeed({ pid: 777777, caller: 'pan reload', ts: Date.now() }),
    );

    await reloadCommand({});

    expect(mocks.restartDashboard).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.writeRestartStatus).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: expect.stringContaining('restart in progress') }),
    );
    expect(process.exitCode).toBe(2);
  });

  it('runs bun install before the build, then restartDashboard, on success', async () => {
    mocks.statSync
      .mockReturnValueOnce({ mtimeMs: 1000 })
      .mockReturnValueOnce({ mtimeMs: 2000 });
    mockSpawnExits();

    await reloadCommand({});

    // Deps are installed before the build so a rebase-added runtime dep can't
    // produce a server bundle that boot-crashes (ERR_MODULE_NOT_FOUND).
    expect(mocks.spawn).toHaveBeenCalledWith('bun', ['install'], expect.objectContaining({ stdio: 'inherit' }));
    expect(mocks.spawn).toHaveBeenCalledWith('npm', ['run', 'build'], expect.objectContaining({ stdio: 'inherit' }));
    const installOrder = mocks.spawn.mock.calls.findIndex(([c]) => c === 'bun');
    const buildOrder = mocks.spawn.mock.calls.findIndex(([c, a]) => c === 'npm' && a[1] === 'build');
    expect(installOrder).toBeLessThan(buildOrder);
    expect(mocks.restartDashboard).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();
  });

  it('aborts without building or restarting when bun install fails', async () => {
    mockSpawnExits({ install: 1 });

    await reloadCommand({});

    expect(mocks.spawn).toHaveBeenCalledWith('bun', ['install'], expect.objectContaining({ stdio: 'inherit' }));
    expect(mocks.spawn).not.toHaveBeenCalledWith('npm', ['run', 'build'], expect.anything());
    expect(mocks.restartDashboard).not.toHaveBeenCalled();
    expect(mocks.spawnDashboardDetached).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('does not restart or stop the dashboard when the build fails', async () => {
    mocks.statSync.mockReturnValue({ mtimeMs: 1000 });
    mockSpawnExits({ build: 1 });

    await reloadCommand({});

    expect(mocks.restartDashboard).not.toHaveBeenCalled();
    expect(mocks.stopDashboard).not.toHaveBeenCalled();
    expect(mocks.spawnDashboardDetached).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
