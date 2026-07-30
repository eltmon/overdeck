import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const processMocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('child_process', async (importActual) => ({
  ...(await importActual<typeof import('child_process')>()),
  execFileSync: processMocks.execFileSync,
  spawn: processMocks.spawn,
}));

import { spawnDashboardDetached } from '../../../src/cli/commands/restart.js';

const fixtureRoots: string[] = [];
const config = {
  dashboardPort: 3010,
  dashboardApiPort: 3011,
  traefikEnabled: false,
  traefikDomain: 'overdeck.localhost',
} as Parameters<typeof spawnDashboardDetached>[0];

function createDashboardBundleFixture(): { serverPath: string; repoRoot: string } {
  const repoRoot = mkdtempSync(join(tmpdir(), 'overdeck-dashboard-spawn-pid-'));
  fixtureRoots.push(repoRoot);
  const serverPath = join(repoRoot, 'dist', 'dashboard', 'server.js');
  mkdirSync(join(repoRoot, 'dist', 'dashboard'), { recursive: true });
  writeFileSync(serverPath, 'export {};');
  return { serverPath, repoRoot };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('dashboard spawn pid handles', () => {
  it('returns the detached child pid when systemd-run is unavailable', async () => {
    const bundle = createDashboardBundleFixture();
    const child = { pid: 4321, unref: vi.fn() };
    processMocks.execFileSync.mockImplementation(() => { throw new Error('systemd unavailable'); });
    processMocks.spawn.mockReturnValue(child);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const handle = spawnDashboardDetached(config, bundle);

    expect(handle.pid).toBeTypeOf('function');
    await expect(handle.pid!()).resolves.toBe(4321);
  });

  it('returns an immediately available systemd MainPID', async () => {
    const bundle = createDashboardBundleFixture();
    processMocks.execFileSync.mockReturnValue(undefined);
    const runSystemctl = vi.fn(() => '5432\n');

    const handle = spawnDashboardDetached(config, { ...bundle, runSystemctl });

    await expect(handle.pid!()).resolves.toBe(5432);
    expect(runSystemctl).toHaveBeenCalledWith([
      '--user', 'show', '-p', 'MainPID', '--value', 'overdeck-dashboard-0.service',
    ]);
  });

  it('polls MainPID=0 until systemd reports the server pid', async () => {
    const bundle = createDashboardBundleFixture();
    processMocks.execFileSync.mockReturnValue(undefined);
    const runSystemctl = vi.fn()
      .mockReturnValueOnce('0\n')
      .mockReturnValueOnce('6543\n');
    const handle = spawnDashboardDetached(config, { ...bundle, runSystemctl });

    const pidPromise = handle.pid!();
    await vi.advanceTimersByTimeAsync(100);

    await expect(pidPromise).resolves.toBe(6543);
    expect(runSystemctl).toHaveBeenCalledTimes(2);
  });

  it('returns null when the systemd unit has already vanished', async () => {
    const bundle = createDashboardBundleFixture();
    processMocks.execFileSync.mockReturnValue(undefined);
    const runSystemctl = vi.fn(() => { throw new Error('unit not found'); });
    const handle = spawnDashboardDetached(config, { ...bundle, runSystemctl });

    await expect(handle.pid!()).resolves.toBeNull();
  });
});
