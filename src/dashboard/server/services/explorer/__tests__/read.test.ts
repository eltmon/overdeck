import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PanRpcError, type ExplorerEntry } from '@overdeck/contracts';
import { listDir, readFile } from '../read.js';
import type { ExplorerRoot } from '../roots.js';
import { diskSignature } from '../signature.js';
import { makeFixtureRepo, type FixtureRepo } from './fixture-repo.js';

let repo: FixtureRepo;
let plainDir: string;

function rootAt(absPath: string, writable = true): ExplorerRoot {
  return { kind: 'issue', id: 'issue:PAN-1', absPath, writable, projectKey: 'p', defaultBranch: 'main' };
}

function byName(entries: readonly ExplorerEntry[], name: string): ExplorerEntry | undefined {
  return entries.find((e) => e.name === name);
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
  repo = await makeFixtureRepo({
    '.gitignore': 'node_modules/\n*.log\n',
    'a.txt': 'alpha\n',
    'b.log': 'log\n',
    'src/x.ts': 'export {};\n',
    'src/y.ts': 'export {};\n',
    'node_modules/pkg/index.js': 'module.exports = 1;\n',
    'bin.dat': 'abcd\0efgh',
    'big.txt': 'twenty bytes of text',
  });
  repo.dir = await realpath(repo.dir);
  await symlink('a.txt', join(repo.dir, 'link'));
  plainDir = await mkdtemp(join(tmpdir(), 'explorer-plain-'));
  await writeFile(join(plainDir, 'q.log'), 'q');
});

afterAll(async () => {
  await repo.cleanup();
  await rm(plainDir, { recursive: true, force: true });
});

describe('listDir', () => {
  it('lists the root with kinds, root-relative paths and ignore flags', async () => {
    const result = await listDir(rootAt(repo.dir), '');
    expect(result.truncated).toBe(false);
    expect(result.absPath).toBe(repo.dir);
    expect(byName(result.entries, 'a.txt')).toMatchObject({ path: 'a.txt', kind: 'file', size: 6, ignored: false });
    expect(byName(result.entries, 'b.log')).toMatchObject({ path: 'b.log', kind: 'file', ignored: true });
    expect(byName(result.entries, 'node_modules')).toMatchObject({ path: 'node_modules', kind: 'dir', ignored: true });
    expect(byName(result.entries, 'src')).toMatchObject({ path: 'src', kind: 'dir', ignored: false });
    expect(byName(result.entries, 'link')).toMatchObject({ path: 'link', kind: 'symlink', ignored: false });
    expect(byName(result.entries, 'src')?.size).toBeUndefined();
  });

  it('marks every entry of an ignored directory ignored', async () => {
    const result = await listDir(rootAt(repo.dir), 'node_modules');
    expect(result.entries).toEqual([expect.objectContaining({ name: 'pkg', path: 'node_modules/pkg', ignored: true })]);
  });

  it('stops at maxEntries and reports truncation', async () => {
    const result = await listDir(rootAt(repo.dir), 'src', { maxEntries: 1 });
    expect(result.entries).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });

  it('flags nothing outside a git repository', async () => {
    const result = await listDir(rootAt(plainDir), '');
    expect(result.entries.map((e) => [e.name, e.ignored])).toEqual([['q.log', false]]);
  });

  it('rejects a missing directory with NOT_FOUND', async () => {
    expect(await codeOf(listDir(rootAt(repo.dir), 'missing'))).toBe('NOT_FOUND');
  });
});

describe('readFile', () => {
  it('reads text with its signature and language', async () => {
    const result = await readFile(rootAt(repo.dir), 'a.txt');
    expect(result).toMatchObject({ kind: 'text', text: 'alpha\n', size: 6, lang: 'plaintext', writable: true });
    expect(result.signature).toBe(diskSignature('alpha\n'));
    expect((await readFile(rootAt(repo.dir), 'src/x.ts')).lang).toBe('typescript');
  });

  it('classifies a file with a NUL byte as binary', async () => {
    const result = await readFile(rootAt(repo.dir), 'bin.dat');
    expect(result.kind).toBe('binary');
    expect(result.text).toBeUndefined();
    expect(result.signature).toBe('');
  });

  it('classifies a file over largeTextBytes as large-text', async () => {
    const result = await readFile(rootAt(repo.dir), 'big.txt', { largeTextBytes: 10 });
    expect(result.kind).toBe('large-text');
    expect(result.text).toBeUndefined();
    expect(result.size).toBe(20);
  });

  it('reports a read-only root as not writable', async () => {
    expect((await readFile(rootAt(repo.dir, false), 'a.txt')).writable).toBe(false);
  });

  it('reads the committed version with ref HEAD', async () => {
    await writeFile(join(repo.dir, 'a.txt'), 'changed on disk\n');
    await writeFile(join(repo.dir, 'untracked.txt'), 'new\n');
    const head = await readFile(rootAt(repo.dir), 'a.txt', { ref: 'HEAD' });
    expect(head).toMatchObject({ kind: 'text', text: 'alpha\n', size: 6, mtimeMs: 0, writable: false });
    expect(head.signature).toBe(diskSignature('alpha\n'));
    const untracked = await readFile(rootAt(repo.dir), 'untracked.txt', { ref: 'HEAD' });
    expect(untracked).toMatchObject({ kind: 'text', text: '', size: 0, writable: false });
    const binary = await readFile(rootAt(repo.dir), 'bin.dat', { ref: 'HEAD' });
    expect(binary.kind).toBe('binary');
  });

  it('rejects a directory with NOT_FOUND', async () => {
    expect(await codeOf(readFile(rootAt(repo.dir), 'src'))).toBe('NOT_FOUND');
  });

  it('rejects a missing file with NOT_FOUND', async () => {
    expect(await codeOf(readFile(rootAt(repo.dir), 'nope.txt'))).toBe('NOT_FOUND');
  });
});
