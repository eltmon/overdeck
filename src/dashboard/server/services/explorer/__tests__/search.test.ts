import { realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PanRpcError } from '@overdeck/contracts';
import type { ExplorerRoot } from '../roots.js';
import { fuzzyScore, invalidateFileListCache, searchContent, searchFiles } from '../search.js';
import { makeFixtureRepo, type FixtureRepo } from './fixture-repo.js';

const cleanups: Array<() => Promise<void>> = [];
let nextRoot = 0;

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function fixture(files: Record<string, string>): Promise<{ repo: FixtureRepo; root: ExplorerRoot }> {
  const repo = await makeFixtureRepo(files);
  repo.dir = await realpath(repo.dir);
  cleanups.push(repo.cleanup);
  // A fresh root id per test keeps the module-level file-list cache isolated.
  nextRoot += 1;
  const root: ExplorerRoot = {
    kind: 'issue',
    id: `issue:PAN-${nextRoot}`,
    absPath: repo.dir,
    writable: true,
    projectKey: 'p',
    defaultBranch: 'main',
  };
  return { repo, root };
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

const search = (root: ExplorerRoot, query: string, extra: Partial<Parameters<typeof searchContent>[1]> = {}) =>
  searchContent(root, { query, regex: false, caseSensitive: false, limit: 100, ...extra });

describe('fuzzyScore and searchFiles', () => {
  it('ranks word-start and consecutive matches, then shorter paths', async () => {
    const { root } = await fixture({
      'src/foo/bar.ts': '',
      'src/fixtures/barrel.ts': '',
      'lib/f/b/a/r.txt': '',
      'src/zzz.ts': '',
    });
    expect(fuzzyScore('src/foo/bar.ts', 'fbar')).toBe(20);
    expect(fuzzyScore('src/fixtures/barrel.ts', 'fbar')).toBe(20);
    expect(fuzzyScore('lib/f/b/a/r.txt', 'fbar')).toBe(16);
    expect(fuzzyScore('a', '')).toBeNull();
    expect(await searchFiles(root, 'fbar', 50)).toEqual({
      paths: ['src/foo/bar.ts', 'src/fixtures/barrel.ts', 'lib/f/b/a/r.txt'],
    });
  });

  it('finds untracked files but not ignored ones', async () => {
    const { repo, root } = await fixture({ '.gitignore': '*.log\n' });
    await writeFile(join(repo.dir, 'fresh.txt'), 'x');
    await writeFile(join(repo.dir, 'fresh.log'), 'x');
    expect((await searchFiles(root, 'fresh', 50)).paths).toEqual(['fresh.txt']);
  });

  it('caches the file list for 30 seconds unless invalidated', async () => {
    const { repo, root } = await fixture({ 'one.txt': '' });
    let now = 1_000_000;
    const clock = { now: () => now };
    expect((await searchFiles(root, 'two', 50, clock)).paths).toEqual([]);
    await writeFile(join(repo.dir, 'two.txt'), '');
    now += 10_000;
    expect((await searchFiles(root, 'two', 50, clock)).paths).toEqual([]);
    invalidateFileListCache(root.id);
    expect((await searchFiles(root, 'two', 50, clock)).paths).toEqual(['two.txt']);

    await writeFile(join(repo.dir, 'three.txt'), '');
    now += 31_000;
    expect((await searchFiles(root, 'three', 50, clock)).paths).toEqual(['three.txt']);
  });
});

describe('searchContent', () => {
  it('matches literally by default and as a regex on request', async () => {
    const { root } = await fixture({ 'x.txt': 'axb\n' });
    expect((await search(root, 'a.b')).matches).toEqual([]);
    expect((await search(root, 'a.b', { regex: true })).matches).toEqual([
      { path: 'x.txt', line: 1, column: 1, preview: 'axb' },
    ]);
  });

  it('is case-insensitive unless asked', async () => {
    const { root } = await fixture({ 'x.txt': 'Hello\n', 'y.txt': 'hello\n' });
    expect((await search(root, 'hello')).matches.map((m) => m.path).sort()).toEqual(['x.txt', 'y.txt']);
    expect((await search(root, 'hello', { caseSensitive: true })).matches.map((m) => m.path)).toEqual(['y.txt']);
  });

  it('limits matches to scopePath', async () => {
    const { root } = await fixture({ 'src/a.txt': 'needle\n', 'lib/b.txt': 'needle\n' });
    expect((await search(root, 'needle', { scopePath: 'src' })).matches.map((m) => m.path)).toEqual(['src/a.txt']);
  });

  it('rejects an invalid regex with INVALID_QUERY', async () => {
    const { root } = await fixture({ 'x.txt': 'x\n' });
    expect(await codeOf(search(root, '(', { regex: true }))).toBe('INVALID_QUERY');
  });

  it('reports UTF-16 columns', async () => {
    const { root } = await fixture({ 'x.txt': 'é = needle\n' });
    expect((await search(root, 'needle')).matches).toEqual([{ path: 'x.txt', line: 1, column: 5, preview: 'é = needle' }]);
  });

  it('stops at limit and reports truncation', async () => {
    const { root } = await fixture({ 'x.txt': 'hit\nhit\nhit\n' });
    const result = await search(root, 'hit', { limit: 2 });
    expect(result.matches).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it('returns nothing for an empty query', async () => {
    const { root } = await fixture({ 'x.txt': 'x\n' });
    expect(await search(root, '')).toEqual({ matches: [], truncated: false });
  });
});
