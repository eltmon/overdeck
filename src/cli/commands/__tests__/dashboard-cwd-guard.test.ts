import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const processMocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('child_process', async (importActual) => ({
  ...(await importActual<typeof import('child_process')>()),
  execFileSync: processMocks.execFileSync,
  spawn: processMocks.spawn,
}));

import {
  refuseNonPrimaryDashboardCwd,
  resolveBundledServerPath,
  resolvePrimaryDashboardIdentity,
  spawnDashboardDetached,
} from '../restart.js';

const fixtureRoots: string[] = [];

function createFixture(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  fixtureRoots.push(root);
  return root;
}

afterEach(() => {
  process.exitCode = undefined;
  vi.clearAllMocks();
  vi.restoreAllMocks();
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('resolvePrimaryDashboardIdentity', () => {
  it('derives the checkout root from the resolved dashboard bundle', () => {
    const serverPath = resolveBundledServerPath();

    expect(resolvePrimaryDashboardIdentity()).toEqual({
      repoRoot: resolve(serverPath, '..', '..', '..'),
      mode: 'primary',
    });
  });

  it('starts the dashboard with the identity root as its working directory', () => {
    const child = { unref: vi.fn() };
    processMocks.execFileSync.mockImplementation(() => { throw new Error('systemd unavailable'); });
    processMocks.spawn.mockReturnValue(child);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    spawnDashboardDetached({
      dashboardPort: 3010,
      dashboardApiPort: 3011,
      traefikEnabled: false,
      traefikDomain: 'overdeck.localhost',
    } as Parameters<typeof spawnDashboardDetached>[0]);

    expect(processMocks.spawn).toHaveBeenCalledWith(
      expect.any(String),
      [resolveBundledServerPath()],
      expect.objectContaining({ cwd: resolvePrimaryDashboardIdentity().repoRoot }),
    );
    expect(child.unref).toHaveBeenCalled();
  });

  it('launches a deployment-root bundle while keeping the primary repo as cwd', () => {
    const fixtureRoot = createFixture('pan-dashboard-deployment-root-');
    const repoRoot = join(fixtureRoot, 'primary');
    const serverPath = join(fixtureRoot, 'deploy', 'dist', 'dashboard', 'server.js');
    mkdirSync(join(fixtureRoot, 'deploy', 'dist', 'dashboard'), { recursive: true });
    writeFileSync(serverPath, 'export {};');
    const child = { unref: vi.fn() };
    processMocks.execFileSync.mockImplementation(() => { throw new Error('systemd unavailable'); });
    processMocks.spawn.mockReturnValue(child);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    spawnDashboardDetached({
      dashboardPort: 3010,
      dashboardApiPort: 3011,
      traefikEnabled: false,
      traefikDomain: 'overdeck.localhost',
    } as Parameters<typeof spawnDashboardDetached>[0], { serverPath, repoRoot });

    expect(processMocks.spawn).toHaveBeenCalledWith(
      expect.any(String),
      [serverPath],
      expect.objectContaining({ cwd: repoRoot }),
    );
  });

  it('returns a handle that stops the spawned systemd unit', () => {
    processMocks.execFileSync.mockReturnValue(undefined);
    vi.spyOn(Date, 'now').mockReturnValue(123456);

    const handle = spawnDashboardDetached({
      dashboardPort: 3010,
      dashboardApiPort: 3011,
      traefikEnabled: false,
      traefikDomain: 'overdeck.localhost',
    } as Parameters<typeof spawnDashboardDetached>[0]);
    handle.stop();

    expect(processMocks.execFileSync).toHaveBeenLastCalledWith(
      'systemctl',
      ['--user', 'stop', 'overdeck-dashboard-123456.service'],
      { stdio: 'ignore' },
    );
    expect(processMocks.spawn).not.toHaveBeenCalled();
  });
});

describe('refuseNonPrimaryDashboardCwd', () => {
  it('refuses a linked worktree and names its primary checkout', () => {
    const fixtureRoot = createFixture('pan-dashboard-cwd-linked-');
    const repoRoot = join(fixtureRoot, 'hoff-gh-quota');
    const cwd = join(repoRoot, 'src', 'cli');
    const primaryRoot = join(fixtureRoot, 'primary');
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(repoRoot, '.git'), `gitdir: ${join(primaryRoot, '.git', 'worktrees', 'hoff-gh-quota')}\n`);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(refuseNonPrimaryDashboardCwd(cwd, 'restart')).toBe(true);
    expect(process.exitCode).toBe(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining(
      `Run this command from the primary checkout at ${primaryRoot}.`,
    ));
  });

  it('allows primary clones and directories outside git repositories', () => {
    const fixtureRoot = createFixture('pan-dashboard-cwd-primary-');
    const primaryRoot = join(fixtureRoot, 'primary');
    const primaryCwd = join(primaryRoot, 'src');
    const noGitCwd = join(fixtureRoot, 'no-git', 'src');
    mkdirSync(join(primaryRoot, '.git'), { recursive: true });
    mkdirSync(primaryCwd, { recursive: true });
    mkdirSync(noGitCwd, { recursive: true });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(refuseNonPrimaryDashboardCwd(primaryCwd, 'restart')).toBe(false);
    expect(refuseNonPrimaryDashboardCwd(noGitCwd, 'restart')).toBe(false);
    expect(error).not.toHaveBeenCalled();
  });

  it('preserves workspace refusal and derives the primary checkout', () => {
    const fixtureRoot = createFixture('pan-dashboard-cwd-workspace-');
    const repoRoot = join(fixtureRoot, 'workspaces', 'feature-pan-2252');
    const cwd = join(repoRoot, 'src', 'cli');
    mkdirSync(join(repoRoot, '.git'), { recursive: true });
    mkdirSync(cwd, { recursive: true });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(refuseNonPrimaryDashboardCwd(cwd, 'restart')).toBe(true);
    expect(process.exitCode).toBe(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining(
      `Run this command from the primary checkout at ${fixtureRoot}.`,
    ));
  });
});
