/**
 * PAN-4820 WI-4: a rebase runs with a hidden Deft install lifted, and the
 * install's change goes back on top of the new base.
 *
 * A real scratch repo, a worktree on a feature branch, a fake installer that
 * changes the tracked package.json, and an isolated global git config.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DeftInstallRun, installDeftIntoWorktree } from '../install.js';
import { readDeftSnapshot } from '../install-snapshot.js';
import { DeftLiftError, withDeftInstallLifted } from '../lift.js';

let scratch: string;
let main: string;
let wt: string;
const savedEnv = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM };

const BASE_PACKAGE = ['{', '  "name": "probe",', '  "version": "1.0.0",', '  "license": "MIT",', '  "type": "module",', '  "private": true', '}', ''].join('\n');

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

/** The install appends a devDependencies block after "private". */
async function fakeInstall(worktree: string): Promise<DeftInstallRun> {
  write(worktree, 'AGENTS.md', '<!-- deft:managed-section v3 -->\n');
  write(
    worktree,
    'package.json',
    BASE_PACKAGE.replace('  "private": true\n', '  "private": true,\n  "devDependencies": { "@deftai/directive-runtime": "0.127.0" }\n'),
  );
  return { exitCode: 0, stdout: '', stderr: '' };
}

/** Commit a change on main. */
function commitOnMain(path: string, content: string): void {
  write(main, path, content);
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', `change ${path}`);
}

const rebase = async (): Promise<string> => git(wt, 'rebase', '-q', 'main');

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'deft-lift-'));
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
  const root = mkdtempSync(join(scratch, 'repo-'));
  main = join(root, 'main');
  wt = join(root, 'wt');
  mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  write(main, 'package.json', BASE_PACKAGE);
  write(main, 'README.md', 'seed\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'seed');
  git(main, 'worktree', 'add', '-q', '-b', 'feat', wt);
  write(wt, 'feature.txt', 'feature\n');
  git(wt, 'add', 'feature.txt');
  git(wt, 'commit', '-q', '-m', 'feature');

  expect(await installDeftIntoWorktree(wt, 'TST-1', { runInstall: fakeInstall })).toMatchObject({ ok: true });
});

describe('withDeftInstallLifted', () => {
  it('rebases onto a main that changed a hidden file and leaves status empty', async () => {
    commitOnMain('package.json', BASE_PACKAGE.replace('"1.0.0"', '"2.0.0"'));

    await withDeftInstallLifted(wt, 'main', rebase);

    expect(git(wt, 'status', '--porcelain')).toBe('');
    expect(git(wt, 'log', '-1', '--format=%s', 'HEAD~1')).toBe('change package.json\n');
  });

  it('merges main\'s change with the install\'s change and records the new base', async () => {
    commitOnMain('package.json', BASE_PACKAGE.replace('"1.0.0"', '"2.0.0"'));

    await withDeftInstallLifted(wt, 'main', rebase);

    const text = readFileSync(join(wt, 'package.json'), 'utf8');
    expect(text).toContain('"version": "2.0.0"');
    expect(text).toContain('"@deftai/directive-runtime": "0.127.0"');
    expect(git(wt, 'ls-files', '-v', 'package.json')).toBe('S package.json\n');
    const entry = (await readDeftSnapshot(wt))?.modifiedTracked[0];
    expect(entry?.baseBlob).toBe(git(wt, 'rev-parse', 'HEAD:package.json').trim());
    expect(Buffer.from(entry?.restoreContentB64 ?? '', 'base64').toString()).toContain('"version": "2.0.0"');
    expect((await readDeftSnapshot(wt))?.liftConflicts).toBeUndefined();
  });

  it('unsets the worktree hooks path during the operation and restores it after', async () => {
    let during = -1;
    await withDeftInstallLifted(wt, 'main', async () => {
      during = gitCode(wt, 'config', '--worktree', '--get', 'core.hooksPath');
    });

    expect(during).toBe(1);
    expect(git(wt, 'config', '--worktree', '--get', 'core.hooksPath').trim()).toBe('.githooks');
  });

  it('keeps the install\'s bytes and records a conflict when both changed the same lines', async () => {
    commitOnMain('package.json', BASE_PACKAGE.replace('  "private": true\n', '  "private": false\n'));

    await withDeftInstallLifted(wt, 'main', rebase);

    expect(readFileSync(join(wt, 'package.json'), 'utf8')).toContain('"@deftai/directive-runtime"');
    expect((await readDeftSnapshot(wt))?.liftConflicts).toEqual(['package.json']);
    expect(git(wt, 'status', '--porcelain')).toBe('');
  });

  it('refuses when the target ref tracks a created install path', async () => {
    commitOnMain('AGENTS.md', '# main now has one\n');
    const fn = vi.fn(async () => 'ran');

    await expect(withDeftInstallLifted(wt, 'main', fn)).rejects.toBeInstanceOf(DeftLiftError);
    await expect(withDeftInstallLifted(wt, 'main', fn)).rejects.toThrow(
      'main now tracks Deft install path AGENTS.md; switch the issue back to Overdeck',
    );
    expect(fn).not.toHaveBeenCalled();
    expect(git(wt, 'ls-files', '-v', 'package.json')).toBe('S package.json\n');
  });

  it('fetches the target before checking it, so a stale origin ref cannot hide a newly tracked path', async () => {
    git(wt, 'remote', 'add', 'origin', main);
    git(wt, 'fetch', '-q', 'origin', 'main');
    commitOnMain('AGENTS.md', '# main now has one\n');
    expect(gitCode(wt, 'cat-file', '-e', 'origin/main:AGENTS.md')).not.toBe(0);
    const fn = vi.fn(async () => 'ran');

    await expect(withDeftInstallLifted(wt, 'origin/main', fn)).rejects.toBeInstanceOf(DeftLiftError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('runs fn alone without a snapshot', async () => {
    // Not a git repository: any git command would fail.
    const plain = mkdtempSync(join(scratch, 'plain-'));

    expect(await withDeftInstallLifted(plain, 'main', async () => 42)).toBe(42);
  });
});
