import { EventEmitter } from 'node:events';
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
}));

vi.mock('../../../lib/restart-lock.js', () => ({
  acquireRestartLock: mocks.acquireRestartLock,
  readRestartLockHolder: mocks.readRestartLockHolder,
}));

vi.mock('../../../lib/platform-lifecycle.js', () => ({
  readPlatformConfig: mocks.readPlatformConfig,
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

function mockBuildExit(code: number): void {
  mocks.spawn.mockImplementation(() => {
    const child = new EventEmitter();
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
    mocks.acquireRestartLock.mockReturnValue({ release: vi.fn() });
    mocks.readRestartLockHolder.mockReturnValue(null);
    mocks.readPlatformConfig.mockReturnValue({
      dashboardPort: 3010,
      dashboardApiPort: 3011,
      traefikEnabled: false,
      traefikDomain: 'pan.localhost',
      traefikDir: '/tmp/traefik',
    });
    mocks.restartDashboard.mockResolvedValue(undefined);
    mocks.resolveBundledServerPath.mockReturnValue('/tmp/server.js');
  });

  it('calls restartDashboard after a successful build refreshes the dashboard bundle', async () => {
    mocks.statSync
      .mockReturnValueOnce({ mtimeMs: 1000 })
      .mockReturnValueOnce({ mtimeMs: 2000 });
    mockBuildExit(0);

    await reloadCommand({});

    expect(mocks.spawn).toHaveBeenCalledWith('npm', ['run', 'build'], expect.objectContaining({ stdio: 'inherit' }));
    expect(mocks.restartDashboard).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();
  });

  it('does not restart or stop the dashboard when the build fails', async () => {
    mocks.statSync.mockReturnValue({ mtimeMs: 1000 });
    mockBuildExit(1);

    await reloadCommand({});

    expect(mocks.restartDashboard).not.toHaveBeenCalled();
    expect(mocks.stopDashboard).not.toHaveBeenCalled();
    expect(mocks.spawnDashboardDetached).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
