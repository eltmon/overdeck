import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildDashboardFromOriginMain,
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
  const swapArtifacts = vi.fn(async () => undefined);

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
    swapArtifacts,
    removePath: vi.fn(async (path) => {
      removedPaths.push(path);
    }),
    note: vi.fn((message) => {
      notes.push(message);
    }),
    success: vi.fn(),
    processId: PROCESS_ID,
  };

  return { deps, gitCalls, removedPaths, notes, installAndBuild, swapArtifacts };
}

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => fs.rm(path, { recursive: true, force: true })));
});

describe('buildDashboardFromOriginMain', () => {
  it.each([
    { state: 'clean and equal to origin/main', status: '', headSha: ORIGIN_MAIN_SHA },
    { state: 'dirty and equal to origin/main', status: ' M src/file.ts', headSha: ORIGIN_MAIN_SHA },
    { state: 'ahead of origin/main', status: '', headSha: '2222222222222222222222222222222222222222' },
    { state: 'behind origin/main', status: '', headSha: '0000000000000000000000000000000000000000' },
  ])('builds only in the detached worktree when the primary tree is $state', async ({ status, headSha }) => {
    const { deps, installAndBuild, swapArtifacts, gitCalls } = createDependencies({ status, headSha });

    await buildDashboardFromOriginMain(REPO_ROOT, deps);

    expect(installAndBuild).toHaveBeenCalledOnce();
    expect(installAndBuild).toHaveBeenCalledWith(BUILD_WORKTREE);
    expect(installAndBuild).not.toHaveBeenCalledWith(REPO_ROOT);
    expect(swapArtifacts).toHaveBeenCalledWith(REPO_ROOT, BUILD_WORKTREE);
    expect(gitCalls).toContainEqual(['worktree', 'add', '--detach', BUILD_WORKTREE, 'origin/main']);
    expect(gitCalls.some((args) => args.includes('merge-base'))).toBe(false);
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

  it('propagates build failures and removes temporary deploy state', async () => {
    const buildError = new Error('Build failed in detached worktree — old dashboard left running');
    const { deps, gitCalls, removedPaths, swapArtifacts } = createDependencies({ installError: buildError });

    await expect(buildDashboardFromOriginMain(REPO_ROOT, deps)).rejects.toBe(buildError);

    expect(swapArtifacts).not.toHaveBeenCalled();
    expect(gitCalls).toContainEqual(['worktree', 'remove', '--force', BUILD_WORKTREE]);
    expect(removedPaths).toEqual([
      BUILD_WORKTREE,
      BUILD_WORKTREE,
      join(REPO_ROOT, 'dist.incoming'),
      join(REPO_ROOT, 'node_modules.incoming'),
    ]);
  });

  it('removes a stale registered worktree before creating the next build worktree', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'overdeck-stale-worktree-'));
    temporaryRoots.push(root);
    const repoRoot = join(root, 'repo');
    const processId = 888;
    const buildWorktree = join(root, `.pan-reload-build-${processId}`);
    await fs.mkdir(repoRoot);
    await execFileAsync('git', ['init'], { cwd: repoRoot });
    await execFileAsync('git', ['config', 'user.name', 'Overdeck Test'], { cwd: repoRoot });
    await execFileAsync('git', ['config', 'user.email', 'test@overdeck.local'], { cwd: repoRoot });
    await fs.writeFile(join(repoRoot, 'README.md'), 'fixture');
    await execFileAsync('git', ['add', 'README.md'], { cwd: repoRoot });
    await execFileAsync('git', ['commit', '-m', 'fixture'], { cwd: repoRoot });
    await execFileAsync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: repoRoot });
    await execFileAsync('git', ['worktree', 'add', '--detach', buildWorktree, 'HEAD'], { cwd: repoRoot });

    const runGit = async (args: string[], cwd: string) => {
      if (args[0] === 'fetch') return { stdout: '', stderr: '' };
      const result = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
      return { stdout: String(result.stdout), stderr: String(result.stderr) };
    };
    const swapArtifacts = vi.fn(async () => undefined);

    await buildDashboardFromOriginMain(repoRoot, {
      runGit,
      installAndBuild: vi.fn(async () => undefined),
      swapArtifacts,
      note: vi.fn(),
      success: vi.fn(),
      processId,
    });

    expect(swapArtifacts).toHaveBeenCalledWith(repoRoot, buildWorktree);
    const worktreeList = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(String(worktreeList.stdout)).not.toContain(buildWorktree);
  });

  it('atomically swaps the canonical build and its runtime dependencies into the primary checkout', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'overdeck-build-from-origin-'));
    temporaryRoots.push(root);
    const repoRoot = join(root, 'repo');
    const processId = 777;
    const buildWorktree = join(root, `.pan-reload-build-${processId}`);
    await fs.mkdir(join(repoRoot, 'dist'), { recursive: true });
    await fs.mkdir(join(repoRoot, 'node_modules'), { recursive: true });
    await fs.writeFile(join(repoRoot, 'dist', 'server.mjs'), 'export default "old bundle";');

    const runGit = vi.fn(async (args: string[]) => {
      const command = args.join(' ');
      if (command === 'status --porcelain') return { stdout: '', stderr: '' };
      if (command === 'rev-parse HEAD' || command === 'rev-parse origin/main') {
        return { stdout: `${ORIGIN_MAIN_SHA}\n`, stderr: '' };
      }
      if (args[0] === 'worktree' && args[1] === 'add') {
        await fs.mkdir(join(buildWorktree, 'dist'), { recursive: true });
        await fs.mkdir(join(buildWorktree, 'node_modules', 'runtime-package'), { recursive: true });
        await fs.writeFile(
          join(buildWorktree, 'dist', 'server.mjs'),
          'import { value } from "runtime-package"; export default value;',
        );
        await fs.writeFile(
          join(buildWorktree, 'node_modules', 'runtime-package', 'package.json'),
          JSON.stringify({ name: 'runtime-package', type: 'module', exports: './index.js' }),
        );
        await fs.writeFile(
          join(buildWorktree, 'node_modules', 'runtime-package', 'index.js'),
          'export const value = "canonical runtime dependency";',
        );
      }
      return { stdout: '', stderr: '' };
    });

    await buildDashboardFromOriginMain(repoRoot, {
      runGit,
      installAndBuild: vi.fn(async () => undefined),
      note: vi.fn(),
      success: vi.fn(),
      processId,
    });

    const deployedBundle = await import(`${pathToFileURL(join(repoRoot, 'dist', 'server.mjs')).href}?test=${processId}`);
    expect(deployedBundle.default).toBe('canonical runtime dependency');
    await expect(fs.access(buildWorktree)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(join(repoRoot, 'dist.incoming'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(join(repoRoot, 'node_modules.incoming'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
