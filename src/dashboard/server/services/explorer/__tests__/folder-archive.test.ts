/** PAN-5188 WI-3: folders stream as .tar.gz from the system tar, with heavy folders left out. */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { archiveFolder } from '../folder-archive.js';
import type { ExplorerRoot } from '../roots.js';

let base: string;

async function tree(files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(dirname(join(base, rel)), { recursive: true });
    await writeFile(join(base, rel), content);
  }
}

function rootAt(absPath: string, kind: ExplorerRoot['kind']): ExplorerRoot {
  return { kind, id: `${kind}:x`, absPath, writable: kind !== 'project', projectKey: 'p', defaultBranch: 'main' };
}

async function members(root: ExplorerRoot, abs: string): Promise<string[]> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of await archiveFolder(root, abs)) chunks.push(chunk);
  const archive = Buffer.concat(chunks);
  const listing = await new Promise<string>((resolve, reject) => {
    const child = execFile('tar', ['-tzf', '-'], (error, stdout) => (error ? reject(error) : resolve(stdout)));
    child.stdin!.end(archive);
  });
  return listing.split('\n').filter(Boolean).sort();
}

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'pan-5188-archive-')));
  await tree({
    'pkg/a.txt': 'a',
    'pkg/node_modules/x.js': 'x',
    'pkg/sub/node_modules/y.js': 'y',
    'pkg/sub/b.txt': 'b',
    'pkg/workspaces/w.txt': 'w',
  });
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('archiveFolder', () => {
  it('archives files and leaves node_modules out at every depth', async () => {
    const pkg = join(base, 'pkg');
    const listed = await members(rootAt(pkg, 'issue'), pkg);
    expect(listed).toEqual(expect.arrayContaining(['pkg/a.txt', 'pkg/sub/b.txt']));
    expect(listed.filter((member) => member.includes('node_modules'))).toEqual([]);
  });

  it('leaves workspaces/ out at the top of a project root but keeps it for an issue root', async () => {
    const pkg = join(base, 'pkg');
    expect((await members(rootAt(pkg, 'project'), pkg)).filter((m) => m.startsWith('pkg/workspaces'))).toEqual([]);
    expect(await members(rootAt(pkg, 'issue'), pkg)).toContain('pkg/workspaces/w.txt');
  });

  it('keeps a nested workspaces/ folder in a project root', async () => {
    await tree({ 'pkg/sub/workspaces/n.txt': 'n' });
    const pkg = join(base, 'pkg');
    expect(await members(rootAt(pkg, 'project'), join(pkg, 'sub'))).toContain('sub/workspaces/n.txt');
  });

  it('archives an empty folder as the single member pkg/', async () => {
    await mkdir(join(base, 'empty', 'pkg'), { recursive: true });
    const pkg = join(base, 'empty', 'pkg');
    expect(await members(rootAt(pkg, 'issue'), pkg)).toEqual(['pkg/']);
  });

  it('archives a folder named build without excluding its own name', async () => {
    await tree({ 'proj/build/x': 'x', 'proj/build/node_modules/z': 'z' });
    const proj = join(base, 'proj');
    const listed = await members(rootAt(proj, 'issue'), join(proj, 'build'));
    expect(listed).toContain('build/x');
    expect(listed.filter((member) => member.includes('node_modules'))).toEqual([]);
  });

  it('treats a member name that looks like a tar option as a plain name', async () => {
    await tree({ 'odd/--checkpoint-action=exec=touch pwned/f': 'f' });
    const odd = join(base, 'odd');
    expect(await members(rootAt(odd, 'issue'), odd)).toContain('odd/--checkpoint-action=exec=touch pwned/f');
  });
});
