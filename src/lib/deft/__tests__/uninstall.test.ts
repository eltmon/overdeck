/**
 * PAN-4820 WI-3: removeDeftInstall puts a worktree back exactly as it was
 * before a temporary Directive install.
 *
 * A real scratch repo with one worktree, a fake installer (the same deposit
 * shape as install.test.ts), and an isolated global git config.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { excludeTarget, readExcludeBlock, setExcludeBlock } from '../../git/worktree-exclude.js';
import { type DeftInstallRun, installDeftIntoWorktree } from '../install.js';
import { deftSnapshotPath, legacyDeftExcludeFilePath, readDeftSnapshot, writeDeftSnapshot } from '../install-snapshot.js';
import { removeDeftInstall } from '../uninstall.js';

let scratch: string;
let root: string;
let wt: string;
const savedEnv = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM };

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function gitCode(cwd: string, ...args: string[]): number {
  try {
    execFileSync('git', args, { cwd, stdio: 'ignore' });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? 1;
  }
}

function write(base: string, path: string, content: string): void {
  mkdirSync(join(base, path, '..'), { recursive: true });
  writeFileSync(join(base, path), content);
}

const read = (path: string): string => readFileSync(join(wt, path), 'utf8');

async function fakeInstall(worktree: string): Promise<DeftInstallRun> {
  write(worktree, 'AGENTS.md', '<!-- deft:managed-section v3 -->\n');
  write(worktree, '.claude/settings.json', '{"hooks":{"SessionStart":[]}}\n');
  write(worktree, '.githooks/pre-push', '#!/bin/sh\nexit 0\n');
  write(worktree, 'xbrief/active/.gitkeep', '');
  write(worktree, 'package.json', '{"name":"probe","devDependencies":{"@deftai/directive-runtime":"0.127.0"}}\n');
  write(worktree, 'README.md', 'deft rewrote this\n');
  write(worktree, 'node_modules/@deftai/directive-runtime/package.json', '{}\n');
  git(worktree, 'add', '-A');
  git(worktree, 'config', 'core.hooksPath', '.githooks');
  return { exitCode: 0, stdout: '', stderr: '' };
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'deft-uninstall-'));
  const globalConfig = join(scratch, 'gitconfig');
  writeFileSync(globalConfig, '[user]\n\tname = Overdeck Test\n\temail = test@overdeck.local\n[commit]\n\tgpgsign = false\n');
  process.env.GIT_CONFIG_GLOBAL = globalConfig;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(scratch, { recursive: true, force: true });
});

beforeEach(async () => {
  root = mkdtempSync(join(scratch, 'repo-'));
  const main = join(root, 'main');
  wt = join(root, 'wt');
  mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  write(main, '.gitignore', 'node_modules/\n.claude/settings.json\n');
  write(main, 'package.json', '{"name":"probe"}\n');
  write(main, 'README.md', 'seed\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'seed');
  git(main, 'worktree', 'add', '-q', '-b', 'feat', wt);
  write(wt, '.claude/settings.json', '{"mine":true}\n');
  write(wt, 'node_modules/left-pad/index.js', 'module.exports = 1;\n');
  write(wt, 'README.md', 'my local edit\n');

  const result = await installDeftIntoWorktree(wt, 'TST-1', { runInstall: fakeInstall });
  expect(result).toMatchObject({ ok: true, mode: 'installed' });
});

describe('removeDeftInstall', () => {
  it('deletes every created path in the snapshot', async () => {
    const snapshot = await readDeftSnapshot(wt);
    expect(snapshot?.createdPaths).toEqual(['.githooks/', 'AGENTS.md', 'xbrief/']);

    const result = await removeDeftInstall(wt);

    for (const path of snapshot?.createdPaths ?? []) expect(existsSync(join(wt, path))).toBe(false);
    expect(result.removed).toEqual(expect.arrayContaining(['.githooks/', 'AGENTS.md', 'xbrief/', 'node_modules/@deftai']));
    expect(result.refused).toEqual([]);
  });

  it('clears skip-worktree flags and the worktree hooks path and exclude file', async () => {
    const { file: excludeFile } = await excludeTarget(wt);
    expect(existsSync(excludeFile)).toBe(true);

    await removeDeftInstall(wt);

    expect(git(wt, 'ls-files', '-v').split('\n').filter(line => line.startsWith('S '))).toEqual([]);
    expect(gitCode(wt, 'config', '--worktree', '--get', 'core.hooksPath')).toBe(1);
    expect(gitCode(wt, 'config', '--worktree', '--get', 'core.excludesFile')).toBe(1);
    expect(existsSync(excludeFile)).toBe(false);
    expect(existsSync(deftSnapshotPath(wt))).toBe(false);
    expect(git(wt, 'config', '--get', 'extensions.worktreeConfig').trim()).toBe('true');
  });

  it('restores pre-install bytes: a dirty tracked file, a tracked file, and an ignored settings file', async () => {
    await removeDeftInstall(wt);

    expect(read('README.md')).toBe('my local edit\n');
    expect(read('package.json')).toBe('{"name":"probe"}\n');
    expect(read('.claude/settings.json')).toBe('{"mine":true}\n');
    expect(existsSync(join(wt, 'node_modules', 'left-pad', 'index.js'))).toBe(true);
    expect(existsSync(join(wt, 'node_modules', '@deftai'))).toBe(false);
    expect(git(wt, 'status', '--porcelain')).toBe(' M README.md\n');
  });

  it('refuses a created path outside the worktree and deletes nothing there', async () => {
    write(root, 'outside/keep.txt', 'keep\n');
    const snapshot = await readDeftSnapshot(wt);
    if (!snapshot) throw new Error('no snapshot');
    await writeDeftSnapshot(wt, { ...snapshot, createdPaths: [...snapshot.createdPaths, '../outside/', '', root] });

    const result = await removeDeftInstall(wt);

    expect(result.refused).toEqual(['../outside/', '', root]);
    expect(readFileSync(join(root, 'outside', 'keep.txt'), 'utf8')).toBe('keep\n');
    expect(existsSync(wt)).toBe(true);
    expect(existsSync(join(wt, 'AGENTS.md'))).toBe(false);
  });

  it('does nothing without a snapshot once the install is gone', async () => {
    await removeDeftInstall(wt);

    expect(await removeDeftInstall(wt)).toEqual({ removed: [], restored: [], refused: [] });
  });

  it('reports a deleted snapshot and makes the install visible instead of guessing', async () => {
    rmSync(join(wt, '.overdeck'), { recursive: true, force: true });

    const result = await removeDeftInstall(wt);

    expect(result).toMatchObject({ snapshotMissing: true, removed: [], restored: [] });
    expect(result.unhidden?.sort()).toEqual(['README.md', 'package.json']);
    expect(git(wt, 'ls-files', '-v').split('\n').filter(line => line.startsWith('S '))).toEqual([]);
    expect(gitCode(wt, 'config', '--worktree', '--get', 'core.hooksPath')).toBe(1);
    expect(gitCode(wt, 'config', '--worktree', '--get', 'core.excludesFile')).toBe(1);
    expect(git(wt, 'status', '--porcelain')).toContain('?? AGENTS.md');
    expect(git(wt, 'status', '--porcelain')).toContain(' M package.json');
  });

  it('refuses a created path under a symlinked directory that leads outside the worktree', async () => {
    write(root, 'outside/keep.txt', 'keep\n');
    symlinkSync(join(root, 'outside'), join(wt, 'link'));
    const snapshot = await readDeftSnapshot(wt);
    if (!snapshot) throw new Error('no snapshot');
    await writeDeftSnapshot(wt, { ...snapshot, createdPaths: [...snapshot.createdPaths, 'link/keep.txt'] });

    const result = await removeDeftInstall(wt);

    expect(result.refused).toEqual(['link/keep.txt']);
    expect(readFileSync(join(root, 'outside', 'keep.txt'), 'utf8')).toBe('keep\n');
  });

  it('never writes a restored file through a planted symlink', async () => {
    write(root, 'outside/target.txt', 'outside\n');
    rmSync(join(wt, '.claude', 'settings.json'));
    symlinkSync(join(root, 'outside', 'target.txt'), join(wt, '.claude', 'settings.json'));

    const result = await removeDeftInstall(wt);

    expect(result.refused).toContain('.claude/settings.json');
    expect(readFileSync(join(root, 'outside', 'target.txt'), 'utf8')).toBe('outside\n');
  });

  it('keeps another owner\'s exclude block and the worktree excludes file', async () => {
    const { file: excludeFile } = await setExcludeBlock(wt, 'sageox', ['/.sageox/']);

    await removeDeftInstall(wt);

    expect(await readExcludeBlock(wt, 'deft')).toBeNull();
    expect(await readExcludeBlock(wt, 'sageox')).toEqual(['/.sageox/']);
    expect(git(wt, 'config', '--worktree', '--get', 'core.excludesFile').trim()).toBe(excludeFile);
  });

  it('clears the pre-PAN-4852 Deft exclude file and the excludesFile that points at it', async () => {
    const legacy = await legacyDeftExcludeFilePath(wt);
    writeFileSync(legacy, '# overdeck:deft TST-1\n/AGENTS.md\n');
    git(wt, 'config', '--worktree', 'core.excludesFile', legacy);

    await removeDeftInstall(wt);

    expect(existsSync(legacy)).toBe(false);
    expect(gitCode(wt, 'config', '--worktree', '--get', 'core.excludesFile')).toBe(1);
  });
});
