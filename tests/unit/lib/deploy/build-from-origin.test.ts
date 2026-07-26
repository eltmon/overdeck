import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildDashboardFromOriginMain,
  type BuildFromOriginDeps,
} from '../../../../src/lib/deploy/build-from-origin.js';

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
  const swapDist = vi.fn(async () => undefined);

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
    swapDist,
    removePath: vi.fn(async (path) => {
      removedPaths.push(path);
    }),
    note: vi.fn((message) => {
      notes.push(message);
    }),
    success: vi.fn(),
    processId: PROCESS_ID,
  };

  return { deps, gitCalls, removedPaths, notes, installAndBuild, swapDist };
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
    const { deps, installAndBuild, swapDist, gitCalls } = createDependencies({ status, headSha });

    await buildDashboardFromOriginMain(REPO_ROOT, deps);

    expect(installAndBuild).toHaveBeenCalledOnce();
    expect(installAndBuild).toHaveBeenCalledWith(BUILD_WORKTREE);
    expect(installAndBuild).not.toHaveBeenCalledWith(REPO_ROOT);
    expect(swapDist).toHaveBeenCalledWith(REPO_ROOT, BUILD_WORKTREE);
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
    const { deps, gitCalls, removedPaths, swapDist } = createDependencies({ installError: buildError });

    await expect(buildDashboardFromOriginMain(REPO_ROOT, deps)).rejects.toBe(buildError);

    expect(swapDist).not.toHaveBeenCalled();
    expect(gitCalls).toContainEqual(['worktree', 'remove', '--force', BUILD_WORKTREE]);
    expect(removedPaths).toEqual([
      BUILD_WORKTREE,
      BUILD_WORKTREE,
      join(REPO_ROOT, 'dist.incoming'),
    ]);
  });

  it('atomically swaps a detached worktree build into the primary checkout', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'overdeck-build-from-origin-'));
    temporaryRoots.push(root);
    const repoRoot = join(root, 'repo');
    const processId = 777;
    const buildWorktree = join(root, `.pan-reload-build-${processId}`);
    await fs.mkdir(join(repoRoot, 'dist'), { recursive: true });
    await fs.writeFile(join(repoRoot, 'dist', 'server.js'), 'old bundle');

    const runGit = vi.fn(async (args: string[]) => {
      const command = args.join(' ');
      if (command === 'status --porcelain') return { stdout: '', stderr: '' };
      if (command === 'rev-parse HEAD' || command === 'rev-parse origin/main') {
        return { stdout: `${ORIGIN_MAIN_SHA}\n`, stderr: '' };
      }
      if (args[0] === 'worktree' && args[1] === 'add') {
        await fs.mkdir(join(buildWorktree, 'dist'), { recursive: true });
        await fs.writeFile(join(buildWorktree, 'dist', 'server.js'), 'new bundle');
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

    await expect(fs.readFile(join(repoRoot, 'dist', 'server.js'), 'utf8')).resolves.toBe('new bundle');
    await expect(fs.access(buildWorktree)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(join(repoRoot, 'dist.incoming'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
