import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_HOME = vi.hoisted(() => {
  const { join } = require('node:path');
  const { tmpdir } = require('node:os');
  return join(tmpdir(), `pan-inspect-polyrepo-${process.pid}`);
});

const repoRootsMock = vi.hoisted(() => ({
  resolveWorkspaceRepoRootsSync: vi.fn(),
}));

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => TEST_HOME };
});

vi.mock('../../../../src/lib/project-repos.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/lib/project-repos.js')>('../../../../src/lib/project-repos.js');
  return {
    ...actual,
    resolveWorkspaceRepoRootsSync: repoRootsMock.resolveWorkspaceRepoRootsSync,
  };
});

import {
  getCurrentHead,
  getInspectDiffContext,
  saveCheckpoint,
} from '../../../../src/lib/cloister/inspect-checkpoints.js';

const git = (cwd: string, command: string) =>
  execSync(`git ${command}`, {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });

function makeRepo(dir: string, featureFile?: string): void {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init -b main');
  writeFileSync(join(dir, 'base.txt'), 'base\n');
  git(dir, 'add .');
  git(dir, 'commit -m base');
  git(dir, 'checkout -b feature/min-999');
  if (featureFile) commitFile(dir, featureFile, 'change\n');
}

function commitFile(dir: string, file: string, content: string): void {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), content);
  git(dir, 'add .');
  git(dir, `commit -m "change ${file}"`);
}

describe('inspect checkpoints (polyrepo)', () => {
  let workspace: string;

  beforeEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
    mkdirSync(TEST_HOME, { recursive: true });
    workspace = mkdtempSync(join(tmpdir(), 'pan-inspect-workspace-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(TEST_HOME, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('returns unknown when no code repo head can be read', async () => {
    repoRootsMock.resolveWorkspaceRepoRootsSync.mockReturnValue([
      { repoKey: 'missing', dir: join(workspace, 'missing'), sourceBranch: 'feature/min-999', targetBranch: 'main', isPolyrepo: false },
    ]);

    await expect(Effect.runPromise(getCurrentHead('MIN-999', workspace))).resolves.toBe('unknown');
  });

  it('preserves the monorepo HEAD^ inspection scope', async () => {
    makeRepo(workspace, 'src/index.ts');
    repoRootsMock.resolveWorkspaceRepoRootsSync.mockReturnValue([
      { repoKey: 'overdeck', dir: workspace, sourceBranch: 'feature/min-999', targetBranch: 'main', isPolyrepo: false },
    ]);

    const context = await Effect.runPromise(getInspectDiffContext('overdeck', 'MIN-999', workspace));
    const head = git(workspace, 'rev-parse HEAD').trim();
    const parent = git(workspace, 'rev-parse HEAD^').trim();

    expect(context.currentHead).toBe(head);
    expect(context.checkpoint).toBe(parent);
    expect(context.repos).toEqual([expect.objectContaining({
      repoKey: 'overdeck',
      headSha: head,
      diffBase: parent,
    })]);
    expect(context.diffStats).toContain('src/index.ts');
    expect(context.diffCommand).toBe(`git -C '${workspace}' diff '${parent}'...HEAD`);
  });

  it('diffs changed sub-repos and uses composite checkpoints to omit unchanged repos', async () => {
    makeRepo(workspace);
    writeFileSync(join(workspace, '.gitignore'), 'fe/\napi/\n');
    git(workspace, 'add .gitignore');
    git(workspace, 'commit -m wrapper');

    const feDir = join(workspace, 'fe');
    const apiDir = join(workspace, 'api');
    makeRepo(feDir, 'src/view.tsx');
    makeRepo(apiDir);

    repoRootsMock.resolveWorkspaceRepoRootsSync.mockReturnValue([
      { repoKey: 'fe', dir: feDir, sourceBranch: 'feature/min-999', targetBranch: 'main', isPolyrepo: true },
      { repoKey: 'api', dir: apiDir, sourceBranch: 'feature/min-999', targetBranch: 'main', isPolyrepo: true },
    ]);

    const first = await Effect.runPromise(getInspectDiffContext('myn', 'MIN-999', workspace));
    const feHead = git(feDir, 'rev-parse HEAD').trim();
    const apiHead = git(apiDir, 'rev-parse HEAD').trim();

    expect(first.currentHead).toBe(`fe@${feHead} api@${apiHead}`);
    expect(first.repos.map(repo => repo.repoKey)).toEqual(['fe']);
    expect(first.diffStats).toContain('── fe ──');
    expect(first.diffStats).toContain('src/view.tsx');
    expect(first.diffCommand).toContain(`git -C '${feDir}' diff`);
    expect(first.diffCommand).not.toContain(`git -C '${workspace}' diff`);
    expect(first.diffCommand).not.toContain(`git -C '${apiDir}' diff`);

    saveCheckpoint('myn', 'MIN-999', 'item-1', first.currentHead);
    commitFile(apiDir, 'src/handler.ts', 'change\n');

    const second = await Effect.runPromise(getInspectDiffContext('myn', 'MIN-999', workspace));
    expect(second.repos.map(repo => repo.repoKey)).toEqual(['api']);
    expect(second.repos[0]?.diffBase).toBe(apiHead);
    expect(second.diffStats).toContain('src/handler.ts');
    expect(second.diffCommand).not.toContain(`git -C '${feDir}' diff`);
  });
});
