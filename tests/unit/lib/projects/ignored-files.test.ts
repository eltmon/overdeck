/** PAN-4651 WI-17 (D-4651-14): which ignored files may cross, and the path checks. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  listIgnoredFiles,
  ProjectFileError,
  projectCloneUrl,
  readProjectFile,
  stripUserinfo,
  writeProjectFileExclusive,
} from '../../../../src/lib/projects/ignored-files.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pan-4651-ignored-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  writeFileSync(join(root, '.gitignore'), '.env\nnode_modules/\nbig.bin\n*.log\n');
  mkdirSync(join(root, 'apps', 'web'), { recursive: true });
  writeFileSync(join(root, 'apps', 'web', 'index.ts'), 'export {};\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  writeFileSync(join(root, '.env'), 'TOKEN=abc\n');
  writeFileSync(join(root, 'apps', 'web', '.env'), 'WEB=1\n');
  mkdirSync(join(root, 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'x', 'index.js'), '');
  writeFileSync(join(root, 'big.bin'), Buffer.alloc(2 * 1024 * 1024));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('ignored files (D-4651-14)', () => {
  it('ac17: lists the two .env files preselected and nothing else', async () => {
    expect(await listIgnoredFiles(root)).toEqual([
      { path: '.env', bytes: 10, preselected: true },
      { path: 'apps/web/.env', bytes: 6, preselected: true },
    ]);
  });

  it('ac17: refuses ../etc/passwd, absolute paths and symlinks with bad-path', async () => {
    symlinkSync('/etc/hostname', join(root, 'link.log'));
    for (const path of ['../etc/passwd', '/etc/passwd', 'link.log', 'apps/../../x']) {
      await expect(readProjectFile(root, path)).rejects.toMatchObject({ code: 'bad-path' });
    }
    await expect(readProjectFile(root, 'nope.env')).rejects.toBeInstanceOf(ProjectFileError);
    expect((await readProjectFile(root, 'apps/web/.env')).toString()).toBe('WEB=1\n');
  });

  it('writes 0600 without overwriting, and never through a symlinked directory', async () => {
    expect(await writeProjectFileExclusive(root, 'apps/api/.env', Buffer.from('A=1\n'))).toBe('written');
    expect(statSync(join(root, 'apps', 'api', '.env')).mode & 0o777).toBe(0o600);
    expect(await writeProjectFileExclusive(root, '.env', Buffer.from('changed'))).toBe('skipped');
    symlinkSync(tmpdir(), join(root, 'out'));
    await expect(writeProjectFileExclusive(root, 'out/.env', Buffer.from('x'))).rejects.toMatchObject({ code: 'bad-path' });
  });

  it('ac17: cloneUrl drops user:token@ and falls back to the slug', async () => {
    expect(stripUserinfo('https://user:ghp_secret@github.com/eltmon/overdeck.git')).toBe('https://github.com/eltmon/overdeck.git');
    expect(stripUserinfo('git@github.com:eltmon/overdeck.git')).toBe('git@github.com:eltmon/overdeck.git');
    execFileSync('git', ['remote', 'add', 'origin', 'https://x:tok@github.com/eltmon/overdeck.git'], { cwd: root });
    expect(await projectCloneUrl(root, 'github.com/eltmon/overdeck')).toBe('https://github.com/eltmon/overdeck.git');
    expect(await projectCloneUrl(join(root, 'apps'), null, async () => '')).toBeNull();
    expect(await projectCloneUrl(root, 'github.com/a/b', async () => '')).toBe('https://github.com/a/b.git');
  });
});
