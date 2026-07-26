import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  activateDashboardDeployment,
  buildDashboardFromOriginMain,
  dashboardDeploymentRoots,
  removeDashboardDeployment,
  selectDashboardDeploymentRoot,
  sweepDashboardDeployments,
  type BuildFromOriginDeps,
} from '../../../../src/lib/deploy/build-from-origin.js';

const execFileAsync = promisify(execFile);

const REPO_ROOT = '/workspace/overdeck';
const PROCESS_ID = 4242;
const BUILD_WORKTREE = join(dirname(REPO_ROOT), `.pan-reload-build-${PROCESS_ID}`);
const ORIGIN_MAIN_SHA = '1111111111111111111111111111111111111111';

function createDependencies(options: {
  status?: string;
  headSha?: string;
  originMainSha?: string;
  installError?: Error;
} = {}) {
  const gitCalls: string[][] = [];
  const removedPaths: string[] = [];
  const notes: string[] = [];
  const installAndBuild = vi.fn(async () => {
    if (options.installError) throw options.installError;
  });

  const deps: BuildFromOriginDeps = {
    runGit: vi.fn(async (args) => {
      gitCalls.push([...args]);
      const command = args.join(' ');
      if (command === 'status --porcelain') return { stdout: options.status ?? '', stderr: '' };
      if (command === 'rev-parse HEAD') return { stdout: `${options.headSha ?? ORIGIN_MAIN_SHA}\n`, stderr: '' };
      if (command === 'rev-parse origin/main') {
        return { stdout: `${options.originMainSha ?? ORIGIN_MAIN_SHA}\n`, stderr: '' };
      }
      return { stdout: '', stderr: '' };
    }),
    installAndBuild,
    removePath: vi.fn(async (path) => {
      removedPaths.push(path);
    }),
    ensureParent: vi.fn(async () => undefined),
    deploymentRoot: vi.fn(() => BUILD_WORKTREE),
    note: vi.fn((message) => {
      notes.push(message);
    }),
    success: vi.fn(),
    processId: PROCESS_ID,
  };

  return { deps, gitCalls, removedPaths, notes, installAndBuild };
}

const originalOverdeckHome = process.env.OVERDECK_HOME;
const temporaryRoots: string[] = [];

afterEach(async () => {
  if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalOverdeckHome;
  await Promise.all(temporaryRoots.splice(0).map((path) => fs.rm(path, { recursive: true, force: true })));
});

describe('buildDashboardFromOriginMain', () => {
  it.each([
    { state: 'clean and equal to origin/main', status: '', headSha: ORIGIN_MAIN_SHA },
    { state: 'dirty and equal to origin/main', status: ' M src/file.ts', headSha: ORIGIN_MAIN_SHA },
    { state: 'ahead of origin/main', status: '', headSha: '2222222222222222222222222222222222222222' },
    { state: 'behind origin/main', status: '', headSha: '0000000000000000000000000000000000000000' },
  ])('builds only in the detached worktree when the primary tree is $state', async ({ status, headSha }) => {
    const { deps, installAndBuild, gitCalls } = createDependencies({ status, headSha });

    const deployment = await buildDashboardFromOriginMain(REPO_ROOT, deps);

    expect(installAndBuild).toHaveBeenCalledOnce();
    expect(installAndBuild).toHaveBeenCalledWith(BUILD_WORKTREE);
    expect(installAndBuild).not.toHaveBeenCalledWith(REPO_ROOT);
    expect(deployment).toEqual({
      deployRoot: BUILD_WORKTREE,
      serverPath: join(BUILD_WORKTREE, 'dist', 'dashboard', 'server.js'),
    });
    expect(gitCalls).toContainEqual(['worktree', 'add', '--detach', BUILD_WORKTREE, 'origin/main']);
    expect(gitCalls.some((args) => args.includes('merge-base'))).toBe(false);
    expect(gitCalls).not.toContainEqual(['worktree', 'remove', '--force', BUILD_WORKTREE]);
  });

  it('notes excluded primary-tree changes while continuing the deploy', async () => {
    const { deps, notes, installAndBuild } = createDependencies({
      status: ' M src/file.ts',
      headSha: '2222222222222222222222222222222222222222',
    });

    await buildDashboardFromOriginMain(REPO_ROOT, deps);

    expect(notes).toContain('Primary worktree has uncommitted changes; they are excluded from this deploy.');
    expect(notes).toContain('Primary worktree HEAD differs from origin/main; only origin/main is being deployed.');
    expect(installAndBuild).toHaveBeenCalledWith(BUILD_WORKTREE);
  });

  it('propagates build failures and removes the failed deployment worktree', async () => {
    const buildError = new Error('Build failed in detached worktree — old dashboard left running');
    const { deps, gitCalls, removedPaths } = createDependencies({ installError: buildError });

    await expect(buildDashboardFromOriginMain(REPO_ROOT, deps)).rejects.toBe(buildError);

    expect(gitCalls).toContainEqual(['worktree', 'remove', '--force', BUILD_WORKTREE]);
    expect(removedPaths).toEqual([BUILD_WORKTREE, BUILD_WORKTREE]);
  });

  it('removes a stale registered worktree before creating the next deployment worktree', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'overdeck-stale-worktree-'));
    temporaryRoots.push(root);
    const repoRoot = join(root, 'repo');
    const processId = 888;
    const deployRoot = join(root, `.pan-reload-build-${processId}`);
    await fs.mkdir(repoRoot);
    await execFileAsync('git', ['init'], { cwd: repoRoot });
    await execFileAsync('git', ['config', 'user.name', 'Overdeck Test'], { cwd: repoRoot });
    await execFileAsync('git', ['config', 'user.email', 'test@overdeck.local'], { cwd: repoRoot });
    await fs.writeFile(join(repoRoot, 'README.md'), 'fixture');
    await execFileAsync('git', ['add', 'README.md'], { cwd: repoRoot });
    await execFileAsync('git', ['commit', '-m', 'fixture'], { cwd: repoRoot });
    await execFileAsync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: repoRoot });
    await execFileAsync('git', ['worktree', 'add', '--detach', deployRoot, 'HEAD'], { cwd: repoRoot });

    const runGit = async (args: string[], cwd: string) => {
      if (args[0] === 'fetch') return { stdout: '', stderr: '' };
      const result = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
      return { stdout: String(result.stdout), stderr: String(result.stderr) };
    };

    const deployment = await buildDashboardFromOriginMain(repoRoot, {
      runGit,
      installAndBuild: vi.fn(async () => undefined),
        deploymentRoot: () => deployRoot,
      note: vi.fn(),
      success: vi.fn(),
      processId,
    });

    expect(deployment.deployRoot).toBe(deployRoot);
    const worktreeList = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(String(worktreeList.stdout)).toContain(deployRoot);
    await removeDashboardDeployment(repoRoot, deployRoot, { runGit });
  });

  it('resolves canonical dependencies without changing the primary dependency environment', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'overdeck-build-from-origin-'));
    temporaryRoots.push(root);
    const repoRoot = join(root, 'repo');
    const processId = 777;
    const deployRoot = join(root, `.pan-reload-build-${processId}`);
    await fs.mkdir(join(repoRoot, 'node_modules', 'wip-only'), { recursive: true });
    await fs.mkdir(join(repoRoot, 'packages', 'workspace-runtime'), { recursive: true });
    await fs.writeFile(join(repoRoot, 'node_modules', 'wip-only', 'sentinel.txt'), 'primary WIP dependency');
    await fs.writeFile(join(repoRoot, 'packages', 'workspace-runtime', 'index.js'), 'export const workspaceValue = "primary WIP";');
    await fs.symlink('../packages/workspace-runtime', join(repoRoot, 'node_modules', 'workspace-runtime'));

    const runGit = vi.fn(async (args: string[]) => {
      const command = args.join(' ');
      if (command === 'status --porcelain') return { stdout: '', stderr: '' };
      if (command === 'rev-parse HEAD' || command === 'rev-parse origin/main') {
        return { stdout: `${ORIGIN_MAIN_SHA}\n`, stderr: '' };
      }
      if (args[0] === 'worktree' && args[1] === 'add') {
        await fs.mkdir(join(deployRoot, 'dist', 'dashboard'), { recursive: true });
        await fs.mkdir(join(deployRoot, 'node_modules', 'runtime-package'), { recursive: true });
        await fs.mkdir(join(deployRoot, 'packages', 'workspace-runtime'), { recursive: true });
        await fs.writeFile(
          join(deployRoot, 'dist', 'dashboard', 'server.mjs'),
          'import { value } from "runtime-package"; import { workspaceValue } from "workspace-runtime"; export default `${value}:${workspaceValue}`;',
        );
        await fs.writeFile(
          join(deployRoot, 'node_modules', 'runtime-package', 'package.json'),
          JSON.stringify({ name: 'runtime-package', type: 'module', exports: './index.js' }),
        );
        await fs.writeFile(
          join(deployRoot, 'node_modules', 'runtime-package', 'index.js'),
          'export const value = "canonical runtime dependency";',
        );
        await fs.writeFile(
          join(deployRoot, 'packages', 'workspace-runtime', 'package.json'),
          JSON.stringify({ name: 'workspace-runtime', type: 'module', exports: './index.js' }),
        );
        await fs.writeFile(
          join(deployRoot, 'packages', 'workspace-runtime', 'index.js'),
          'export const workspaceValue = "canonical workspace dependency";',
        );
        await fs.symlink('../packages/workspace-runtime', join(deployRoot, 'node_modules', 'workspace-runtime'));
      }
      return { stdout: '', stderr: '' };
    });

    const deployment = await buildDashboardFromOriginMain(repoRoot, {
      runGit,
      installAndBuild: vi.fn(async () => undefined),
      deploymentRoot: () => deployRoot,
      note: vi.fn(),
      success: vi.fn(),
      processId,
    });

    const activation = await activateDashboardDeployment(repoRoot, deployment);
    const deployedBundle = await import(`${pathToFileURL(join(deployment.deployRoot, 'dist', 'dashboard', 'server.mjs')).href}?test=${processId}`);
    expect(deployedBundle.default).toBe('canonical runtime dependency:canonical workspace dependency');
    await expect(fs.readFile(join(repoRoot, 'node_modules', 'wip-only', 'sentinel.txt'), 'utf8'))
      .resolves.toBe('primary WIP dependency');
    await expect(fs.readFile(join(repoRoot, 'packages', 'workspace-runtime', 'index.js'), 'utf8'))
      .resolves.toContain('primary WIP');
    expect((await fs.lstat(join(repoRoot, 'node_modules', 'workspace-runtime'))).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(join(repoRoot, 'dist', 'node_modules'))).isSymbolicLink()).toBe(true);
    await expect(fs.readlink(join(repoRoot, 'dist', 'node_modules')))
      .resolves.toBe(join(deployRoot, 'node_modules'));
    await activation.commit();
    await removeDashboardDeployment(repoRoot, deployRoot, {
      runGit: async () => ({ stdout: '', stderr: '' }),
    });
  });

  it('alternates between two fixed deployment generations', async () => {
    const home = await fs.mkdtemp(join(tmpdir(), 'overdeck-deployment-slots-'));
    temporaryRoots.push(home);
    process.env.OVERDECK_HOME = home;
    const [first, second] = dashboardDeploymentRoots();

    expect(selectDashboardDeploymentRoot(null)).toBe(first);
    expect(selectDashboardDeploymentRoot(first)).toBe(second);
    expect(selectDashboardDeploymentRoot(second)).toBe(first);
  });

  it('sweeps legacy deployment roots while retaining the two bounded generations', async () => {
    const home = await fs.mkdtemp(join(tmpdir(), 'overdeck-deployment-sweep-'));
    temporaryRoots.push(home);
    process.env.OVERDECK_HOME = home;
    const [first, second] = dashboardDeploymentRoots();
    const baseDir = dirname(first);
    const legacyOne = join(baseDir, '.pan-reload-build-101');
    const legacyTwo = join(baseDir, '.pan-reload-build-202');
    await Promise.all([first, second, legacyOne, legacyTwo].map((path) => fs.mkdir(path, { recursive: true })));

    await sweepDashboardDeployments('/repo', [first, second], {
      runGit: async () => ({ stdout: '', stderr: '' }),
    });

    await expect(fs.access(first)).resolves.toBeUndefined();
    await expect(fs.access(second)).resolves.toBeUndefined();
    await expect(fs.access(legacyOne)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(legacyTwo)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
