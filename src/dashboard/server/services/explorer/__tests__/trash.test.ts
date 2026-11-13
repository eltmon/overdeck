import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PanRpcError } from '@overdeck/contracts';
import type { ExplorerRoot } from '../roots.js';
import {
  formatStamp,
  parseStamp,
  pruneTrash,
  restore,
  rootSlug,
  TRASH_MANIFEST,
  TRASH_MAX_AGE_MS,
  trashPaths,
} from '../trash.js';
import { makeFixtureRepo, type FixtureRepo } from './fixture-repo.js';

const NOW = Date.UTC(2026, 10, 13, 14, 27, 11, 946);
const clock = () => NOW;

let repo: FixtureRepo;
let root: ExplorerRoot;
let home: string;
let previousHome: string | undefined;

function rootAt(absPath: string, kind: ExplorerRoot['kind'] = 'issue', id = 'issue:PAN-1'): ExplorerRoot {
  return { kind, id, absPath, writable: kind !== 'project', projectKey: 'p', defaultBranch: 'main' };
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

async function exists(abs: string): Promise<boolean> {
  try {
    await lstat(abs);
    return true;
  } catch {
    return false;
  }
}

function trashEntry(id: string): string {
  return join(home, 'trash', id);
}

beforeEach(async () => {
  previousHome = process.env.OVERDECK_HOME;
  home = await mkdtemp(join(tmpdir(), 'explorer-trash-home-'));
  process.env.OVERDECK_HOME = home;
  repo = await makeFixtureRepo({ 'a.txt': 'alpha\n', 'src/x.js': 'export {};\n', 'src/deep/y.js': 'y\n' });
  root = rootAt(await realpath(repo.dir));
});

afterEach(async () => {
  process.env.OVERDECK_HOME = previousHome;
  await repo.cleanup();
  await rm(home, { recursive: true, force: true });
});

describe('stamps and slugs', () => {
  it('formats and parses a compact UTC stamp', () => {
    expect(formatStamp(NOW)).toBe('20261113T142711946Z');
    expect(parseStamp('20261113T142711946Z-0')).toBe(NOW);
    expect(parseStamp('20261113T142711946Z-12')).toBe(NOW);
  });

  it('rejects names that are not <stamp>-<n>', () => {
    expect(parseStamp('notes')).toBeNull();
    expect(parseStamp('20261113T142711946Z')).toBeNull();
    expect(parseStamp('20261313T142711946Z-0')).toBeNull();
  });

  it('slugs a root id', () => {
    expect(rootSlug('issue:PAN-1')).toBe('issue-PAN-1');
    expect(rootSlug('workspace:a/b c')).toBe('workspace-a-b-c');
  });
});

describe('trashPaths and restore', () => {
  it('round-trips a file and a folder with contents', async () => {
    const ids = await trashPaths(root, ['a.txt', 'src'], clock);
    expect(ids).toEqual(['issue-PAN-1/20261113T142711946Z-0', 'issue-PAN-1/20261113T142711946Z-1']);
    expect(await exists(join(root.absPath, 'a.txt'))).toBe(false);
    expect(await exists(join(root.absPath, 'src'))).toBe(false);
    expect(JSON.parse(await readFile(join(trashEntry(ids[0]!), TRASH_MANIFEST), 'utf8'))).toEqual({
      rootId: 'issue:PAN-1',
      path: 'a.txt',
      trashedAt: '2026-11-13T14:27:11.946Z',
    });

    expect(await restore(root, ids[0]!)).toEqual({ path: 'a.txt' });
    expect(await restore(root, ids[1]!)).toEqual({ path: 'src' });
    expect(await readFile(join(root.absPath, 'a.txt'), 'utf8')).toBe('alpha\n');
    expect(await readFile(join(root.absPath, 'src/x.js'), 'utf8')).toBe('export {};\n');
    expect(await readFile(join(root.absPath, 'src/deep/y.js'), 'utf8')).toBe('y\n');
    expect(await exists(trashEntry(ids[0]!))).toBe(false);
    expect(await exists(trashEntry(ids[1]!))).toBe(false);
  });

  it('restores a nested path, recreating its parent folder', async () => {
    const [id] = await trashPaths(root, ['src/deep/y.js'], clock);
    await rm(join(root.absPath, 'src'), { recursive: true });
    await restore(root, id!);
    expect(await readFile(join(root.absPath, 'src/deep/y.js'), 'utf8')).toBe('y\n');
  });

  it('trashes a symlink as a link and leaves its target', async () => {
    await symlink('a.txt', join(root.absPath, 'link.txt'));
    const [id] = await trashPaths(root, ['link.txt'], clock);
    expect(await readFile(join(root.absPath, 'a.txt'), 'utf8')).toBe('alpha\n');
    expect((await lstat(join(trashEntry(id!), 'files/link.txt'))).isSymbolicLink()).toBe(true);
  });

  it('increments n past an entry directory that already exists', async () => {
    const first = await trashPaths(root, ['a.txt'], clock);
    const second = await trashPaths(root, ['src'], clock);
    expect(first).toEqual(['issue-PAN-1/20261113T142711946Z-0']);
    expect(second).toEqual(['issue-PAN-1/20261113T142711946Z-1']);
  });

  it('gives a and a/b in one call exactly one trash id', async () => {
    const ids = await trashPaths(root, ['src', 'src/x.js', 'src/deep/y.js'], clock);
    expect(ids).toHaveLength(1);
    expect(await exists(join(trashEntry(ids[0]!), 'files/src/x.js'))).toBe(true);
  });

  it('moves nothing when one path is missing', async () => {
    expect(await codeOf(trashPaths(root, ['a.txt', 'missing.txt', 'src'], clock))).toBe('NOT_FOUND');
    expect(await exists(join(root.absPath, 'a.txt'))).toBe(true);
    expect(await exists(join(root.absPath, 'src/x.js'))).toBe(true);
    expect(await exists(join(home, 'trash', 'issue-PAN-1'))).toBe(false);
  });

  it('refuses to restore over an occupied path', async () => {
    const [id] = await trashPaths(root, ['a.txt'], clock);
    await writeFile(join(root.absPath, 'a.txt'), 'new\n');
    expect(await codeOf(restore(root, id!))).toBe('ALREADY_EXISTS');
    expect(await readFile(join(root.absPath, 'a.txt'), 'utf8')).toBe('new\n');
    expect(await exists(trashEntry(id!))).toBe(true);
  });

  it('refuses a trash id of another root, a malformed id and an id containing ..', async () => {
    const [id] = await trashPaths(root, ['a.txt'], clock);
    const other = rootAt(root.absPath, 'issue', 'issue:PAN-2');
    expect(await codeOf(restore(other, id!))).toBe('NOT_FOUND');
    expect(await codeOf(restore(other, id!.replace('issue-PAN-1', 'issue-PAN-2')))).toBe('NOT_FOUND');
    expect(await codeOf(restore(root, 'issue-PAN-1/latest'))).toBe('NOT_FOUND');
    expect(await codeOf(restore(root, 'issue-PAN-1/../issue-PAN-1/20261113T142711946Z-0'))).toBe('NOT_FOUND');
    expect(await codeOf(restore(root, '../20261113T142711946Z-0'))).toBe('NOT_FOUND');
    expect(await exists(join(root.absPath, 'a.txt'))).toBe(false);
  });

  it('refuses a manifest edited to point outside the root', async () => {
    const [id] = await trashPaths(root, ['a.txt'], clock);
    const manifestPath = join(trashEntry(id!), TRASH_MANIFEST);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, string>;
    await writeFile(manifestPath, JSON.stringify({ ...manifest, path: '../outside' }));
    expect(await codeOf(restore(root, id!))).toBe('PATH_OUTSIDE_ROOT');
    expect(await exists(join(root.absPath, '..', 'outside'))).toBe(false);
  });

  it('refuses a manifest whose rootId is another root', async () => {
    const [id] = await trashPaths(root, ['a.txt'], clock);
    const manifestPath = join(trashEntry(id!), TRASH_MANIFEST);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, string>;
    await writeFile(manifestPath, JSON.stringify({ ...manifest, rootId: 'issue:PAN-9' }));
    expect(await codeOf(restore(root, id!))).toBe('NOT_FOUND');
  });

  it('refuses a project root for delete and restore', async () => {
    const [id] = await trashPaths(root, ['a.txt'], clock);
    const project = rootAt(root.absPath, 'project', 'issue:PAN-1');
    expect(await codeOf(trashPaths(project, ['src'], clock))).toBe('EDIT_WORKSPACE_REQUIRED');
    expect(await codeOf(restore(project, id!))).toBe('EDIT_WORKSPACE_REQUIRED');
    expect(await exists(join(root.absPath, 'src/x.js'))).toBe(true);
  });

  it('stores trash only under the OVERDECK_HOME of the test', async () => {
    await trashPaths(root, ['a.txt'], clock);
    expect(await readdir(join(home, 'trash'))).toEqual(['issue-PAN-1']);
  });
});

describe('pruneTrash', () => {
  it('removes entries older than 7 days and keeps newer and unparseable ones', async () => {
    const slugDir = join(home, 'trash', 'issue-PAN-1');
    const old = `${formatStamp(NOW - TRASH_MAX_AGE_MS - 1)}-0`;
    const fresh = `${formatStamp(NOW - TRASH_MAX_AGE_MS + 1000)}-0`;
    for (const name of [old, fresh, 'keep-me']) await mkdir(join(slugDir, name), { recursive: true });

    await pruneTrash(clock);
    expect((await readdir(slugDir)).sort()).toEqual([fresh, 'keep-me'].sort());
  });

  it('does nothing when the trash folder does not exist', async () => {
    await pruneTrash(clock);
    expect(await exists(join(home, 'trash'))).toBe(false);
  });

  it('runs at the start of trashPaths', async () => {
    const old = join(home, 'trash', 'issue-PAN-1', `${formatStamp(NOW - TRASH_MAX_AGE_MS - 1)}-0`);
    await mkdir(old, { recursive: true });
    await trashPaths(root, ['a.txt'], clock);
    expect(await exists(old)).toBe(false);
  });
});
