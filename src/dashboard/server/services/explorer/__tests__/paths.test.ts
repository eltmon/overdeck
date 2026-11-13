import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PanRpcError } from '@overdeck/contracts';
import { resolveInsideRoot } from '../paths.js';
import type { ExplorerRoot } from '../roots.js';
import { makeFixtureRepo, type FixtureRepo } from './fixture-repo.js';

let repo: FixtureRepo;
let outsideDir: string;
let rootPath: string;

function root(kind: ExplorerRoot['kind'] = 'issue'): ExplorerRoot {
  return { kind, id: `${kind}:x`, absPath: rootPath, writable: kind !== 'project', projectKey: 'p', defaultBranch: 'main' };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PanRpcError);
    return (error as PanRpcError).code;
  }
  return 'resolved';
}

beforeAll(async () => {
  repo = await makeFixtureRepo({ 'a/b.txt': 'b' });
  rootPath = await realpath(repo.dir);
  outsideDir = await mkdtemp(join(tmpdir(), 'explorer-outside-'));
  await writeFile(join(outsideDir, 'secret'), 's');
  await symlink(outsideDir, join(rootPath, 'out'));
  await symlink('.git', join(rootPath, 'g'));
  await symlink(join(outsideDir, 'missing'), join(rootPath, 'dangling'));
  await mkdir(join(rootPath, 'inner', 'objects'), { recursive: true });
  await mkdir(join(rootPath, 'inner', 'refs'), { recursive: true });
  await writeFile(join(rootPath, 'inner', 'HEAD'), 'ref: refs/heads/main\n');
});

afterAll(async () => {
  await repo.cleanup();
  await rm(outsideDir, { recursive: true, force: true });
});

describe('resolveInsideRoot', () => {
  it.each(['../x', '/etc/passwd', 'a/../b', 'a//b', './a', 'a\\b', 'C:/x', 'a\0b'])(
    'rejects %j with PATH_OUTSIDE_ROOT',
    async (rel) => {
      expect(await codeOf(resolveInsideRoot(root(), rel, { forWrite: false }))).toBe('PATH_OUTSIDE_ROOT');
    },
  );

  it('rejects a symlink that escapes the root', async () => {
    expect(await codeOf(resolveInsideRoot(root(), 'out/secret', { forWrite: false }))).toBe('PATH_OUTSIDE_ROOT');
  });

  it('rejects a dangling symlink instead of joining through it', async () => {
    expect(await codeOf(resolveInsideRoot(root(), 'dangling', { forWrite: true }))).toBe('PATH_OUTSIDE_ROOT');
  });

  it.each(['.git/config', 'GIT~1/config', '.GIT/x', '.git./x', 'g/config', 'inner/hooks/pre-commit'])(
    'rejects %j for writes with PATH_IN_GIT_DIR',
    async (rel) => {
      expect(await codeOf(resolveInsideRoot(root(), rel, { forWrite: true }))).toBe('PATH_IN_GIT_DIR');
    },
  );

  it('allows reading .git paths', async () => {
    expect(await resolveInsideRoot(root(), '.git/HEAD', { forWrite: false })).toBe(join(rootPath, '.git/HEAD'));
  });

  it.each(['a/b.txt', '../x'])('rejects %j on a project root for writes with EDIT_WORKSPACE_REQUIRED', async (rel) => {
    expect(await codeOf(resolveInsideRoot(root('project'), rel, { forWrite: true }))).toBe('EDIT_WORKSPACE_REQUIRED');
  });

  it('resolves existing and missing paths inside the root', async () => {
    expect(await resolveInsideRoot(root(), 'a/b.txt', { forWrite: false })).toBe(join(rootPath, 'a/b.txt'));
    expect(await resolveInsideRoot(root(), 'a/new/deep.txt', { forWrite: true })).toBe(join(rootPath, 'a/new/deep.txt'));
  });

  it('resolves the root itself only with allowRoot', async () => {
    expect(await resolveInsideRoot(root(), '', { forWrite: false, allowRoot: true })).toBe(rootPath);
    expect(await codeOf(resolveInsideRoot(root(), '', { forWrite: false }))).toBe('PATH_OUTSIDE_ROOT');
  });
});
