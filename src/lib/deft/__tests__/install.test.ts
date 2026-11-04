/**
 * PAN-4820 WI-2: a temporary Directive install is hidden from git in its own
 * worktree and leaves sibling worktrees and the shared config untouched.
 *
 * A real scratch repo with two worktrees and a fake installer that writes a
 * representative deposit, stages it, and sets the shared core.hooksPath, the
 * way older Directive releases did. Git runs with an isolated global config.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type DeftInstallRun, installDeftIntoWorktree } from '../install.js';
import { readDeftSnapshot } from '../install-snapshot.js';

let scratch: string;
let main: string;
let wt: string;
let sibling: string;
const savedEnv = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM };

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/** Exit code and stdout of a git command that may fail. */
function gitTry(cwd: string, ...args: string[]): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) };
  } catch (error) {
    return { code: (error as { status?: number }).status ?? 1, out: '' };
  }
}

function write(root: string, path: string, content: string): void {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), content);
}

/** Writes a representative deposit, stages it, and sets the shared hooks path. */
async function fakeInstall(worktree: string): Promise<DeftInstallRun> {
  write(worktree, 'AGENTS.md', '<!-- deft:managed-section v3 -->\nDeft\n<!-- /deft:managed-section -->\n');
  write(worktree, '.claude/settings.json', '{"hooks":{"SessionStart":[]}}\n');
  write(worktree, '.githooks/pre-push', '#!/bin/sh\nexit 0\n');
  write(worktree, 'xbrief/active/.gitkeep', '');
  write(worktree, 'package.json', '{"name":"probe","devDependencies":{"@deftai/directive-runtime":"0.127.0"}}\n');
  write(worktree, 'node_modules/@deftai/directive-runtime/package.json', '{}\n');
  git(worktree, 'add', '-A');
  git(worktree, 'config', 'core.hooksPath', '.githooks');
  return { exitCode: 0, stdout: 'installed', stderr: '' };
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'deft-install-'));
  const globalConfig = join(scratch, 'gitconfig');
  const globalIgnore = join(scratch, 'global-ignore');
  writeFileSync(globalIgnore, '*.globalpattern\n');
  writeFileSync(
    globalConfig,
    `[user]\n\tname = Overdeck Test\n\temail = test@overdeck.local\n[commit]\n\tgpgsign = false\n[core]\n\texcludesFile = ${globalIgnore}\n`,
  );
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

beforeEach(() => {
  const root = mkdtempSync(join(scratch, 'repo-'));
  main = join(root, 'main');
  wt = join(root, 'wt');
  sibling = join(root, 'sibling');
  mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  write(main, '.gitignore', 'node_modules/\n.claude/settings.json\n');
  write(main, 'package.json', '{"name":"probe"}\n');
  write(main, 'README.md', 'seed\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'seed');
  git(main, 'worktree', 'add', '-q', '-b', 'feat', wt);
  git(main, 'worktree', 'add', '-q', '-b', 'other', sibling);
  write(wt, '.claude/settings.json', '{}\n');
  write(wt, 'node_modules/left-pad/index.js', 'module.exports = 1;\n');
});

describe('installDeftIntoWorktree', () => {
  it('leaves git status empty in the install worktree', async () => {
    const result = await installDeftIntoWorktree(wt, 'TST-1', { runInstall: fakeInstall });

    expect(result).toMatchObject({ ok: true, mode: 'installed', alreadyInstalled: false });
    expect(git(wt, 'status', '--porcelain')).toBe('');
    expect(git(wt, 'diff', '--cached', '--name-only')).toBe('');
  });

  it('leaves the sibling worktree without a hooks path or skip-worktree entries', async () => {
    await installDeftIntoWorktree(wt, 'TST-1', { runInstall: fakeInstall });

    expect(gitTry(sibling, 'config', '--get', 'core.hooksPath').code).toBe(1);
    expect(git(sibling, 'ls-files', '-v').split('\n').filter(line => line.startsWith('S '))).toEqual([]);
    expect(git(wt, 'ls-files', '-v')).toContain('S package.json');
    expect(git(wt, 'config', '--worktree', '--get', 'core.hooksPath').trim()).toBe('.githooks');
  });

  it('restores an unset shared core.hooksPath', async () => {
    await installDeftIntoWorktree(wt, 'TST-1', { runInstall: fakeInstall });

    expect(gitTry(wt, 'config', '--local', '--get', 'core.hooksPath').code).toBe(1);
  });

  it('restores a foreign shared core.hooksPath and still installs', async () => {
    git(main, 'config', 'core.hooksPath', '.husky/_');

    const result = await installDeftIntoWorktree(wt, 'TST-1', { runInstall: fakeInstall });

    expect(result).toMatchObject({ ok: true, mode: 'installed' });
    expect(git(main, 'config', '--local', '--get', 'core.hooksPath').trim()).toBe('.husky/_');
    expect(git(sibling, 'config', '--get', 'core.hooksPath').trim()).toBe('.husky/_');
    expect(result.ok && result.mode === 'installed' && result.snapshot.sharedHooksPathBefore).toBe('.husky/_');
  });

  it('records created paths, modified files with their pre-install bytes, and touched directories', async () => {
    const result = await installDeftIntoWorktree(wt, 'TST-1', { runInstall: fakeInstall });
    const snapshot = await readDeftSnapshot(wt);

    expect(result.ok && result.mode === 'installed' && result.snapshot).toEqual(snapshot);
    expect(snapshot?.createdPaths).toEqual(['.githooks/', 'AGENTS.md', 'xbrief/']);
    expect(snapshot?.modifiedTracked.map(entry => entry.path)).toEqual(['package.json']);
    expect(Buffer.from(snapshot?.modifiedTracked[0]?.restoreContentB64 ?? '', 'base64').toString()).toBe('{"name":"probe"}\n');
    expect(snapshot?.modifiedTracked[0]?.baseBlob).toBe(git(wt, 'rev-parse', 'HEAD:package.json').trim());
    expect(snapshot?.modifiedUntracked.map(entry => entry.path)).toEqual(['.claude/settings.json']);
    expect(Buffer.from(snapshot?.modifiedUntracked[0]?.restoreContentB64 ?? '', 'base64').toString()).toBe('{}\n');
    expect(snapshot?.touchedPreexisting).toEqual(['node_modules/']);
    expect(snapshot?.runtimeVersion).toBe('0.127.0');
  });

  it('seeds the exclude file with the global excludes and the runtime lines', async () => {
    await installDeftIntoWorktree(wt, 'TST-1', { runInstall: fakeInstall });
    const snapshot = await readDeftSnapshot(wt);
    const text = readFileSync(snapshot?.excludeFile ?? '', 'utf8');

    expect(git(wt, 'config', '--worktree', '--get', 'core.excludesFile').trim()).toBe(snapshot?.excludeFile);
    expect(text).toContain('*.globalpattern');
    expect(text).toContain('# overdeck:deft begin');
    expect(text).toContain('/.overdeck/deft-install.json');
    expect(text).toContain('/.githooks/');
    write(wt, 'notes.globalpattern', 'x');
    expect(git(wt, 'status', '--porcelain')).toBe('');
  });

  it('returns the existing snapshot on a second call', async () => {
    await installDeftIntoWorktree(wt, 'TST-1', { runInstall: fakeInstall });

    const again = await installDeftIntoWorktree(wt, 'TST-1', {
      runInstall: async () => {
        throw new Error('must not run');
      },
    });

    expect(again).toMatchObject({ ok: true, mode: 'installed', alreadyInstalled: true });
  });

  it('reports a failed install that changed nothing and leaves the worktree as it was', async () => {
    const result = await installDeftIntoWorktree(wt, 'TST-1', {
      runInstall: async () => ({ exitCode: 2, stdout: '', stderr: 'Bun projects are not supported (AC5.7).' }),
    });

    expect(result).toEqual({ ok: false, error: 'directive install failed: Bun projects are not supported (AC5.7).' });
    expect(existsSync(join(wt, '.githooks'))).toBe(false);
    expect(gitTry(wt, 'config', '--worktree', '--get', 'core.hooksPath').code).toBe(1);
    expect(await readDeftSnapshot(wt)).toBeNull();
    expect(git(wt, 'status', '--porcelain')).toBe('');
  });

  it('refuses staged changes', async () => {
    write(wt, 'README.md', 'changed\n');
    git(wt, 'add', 'README.md');

    const result = await installDeftIntoWorktree(wt, 'TST-1', { runInstall: fakeInstall });

    expect(result).toEqual({ ok: false, error: 'commit or discard staged changes first' });
    expect(existsSync(join(wt, 'AGENTS.md'))).toBe(false);
  });

  it('returns directive-project when the default branch tracks a Directive deposit', async () => {
    write(main, 'AGENTS.md', '<!-- deft:managed-section v3 -->\n');
    git(main, 'add', 'AGENTS.md');
    git(main, 'commit', '-q', '-m', 'deposit');

    const result = await installDeftIntoWorktree(wt, 'TST-1', { runInstall: fakeInstall });

    expect(result).toEqual({ ok: true, mode: 'directive-project' });
  });

  it('installs when the Directive markers exist only in the worktree, not on the default branch', async () => {
    write(wt, 'AGENTS.md', '<!-- deft:managed-section v3 -->\n');
    write(wt, '.deft/core/VERSION', '0.127.0\n');

    const result = await installDeftIntoWorktree(wt, 'TST-1', { runInstall: async () => ({ exitCode: 0, stdout: '', stderr: '' }) });

    expect(result).toMatchObject({ ok: true, mode: 'installed' });
  });

  it('refuses a directory that is not the root of a linked worktree', async () => {
    mkdirSync(join(wt, 'sub'));

    expect(await installDeftIntoWorktree(join(wt, 'sub'), 'TST-1', { runInstall: fakeInstall }))
      .toMatchObject({ ok: false, error: expect.stringContaining('is not the root of its git worktree') });
    expect(await installDeftIntoWorktree(main, 'TST-1', { runInstall: fakeInstall }))
      .toMatchObject({ ok: false, error: expect.stringContaining('is a primary checkout') });
    expect(gitTry(main, 'config', '--worktree', '--get', 'core.hooksPath').code).not.toBe(0);
  });

  it('rolls back everything when the installer throws before the snapshot exists', async () => {
    const before = git(wt, 'status', '--porcelain', '--ignored=matching');

    await expect(installDeftIntoWorktree(wt, 'TST-1', {
      runInstall: async (worktree) => {
        await fakeInstall(worktree);
        throw new Error('installer crashed');
      },
    })).rejects.toThrow('installer crashed');

    expect(git(wt, 'status', '--porcelain', '--ignored=matching')).toBe(before);
    expect(readFileSync(join(wt, 'package.json'), 'utf8')).toBe('{"name":"probe"}\n');
    expect(readFileSync(join(wt, '.claude', 'settings.json'), 'utf8')).toBe('{}\n');
    expect(existsSync(join(wt, 'node_modules', '@deftai'))).toBe(false);
    expect(gitTry(wt, 'config', '--worktree', '--get', 'core.hooksPath').code).toBe(1);
    expect(gitTry(wt, 'config', '--local', '--get', 'core.hooksPath').code).toBe(1);
    expect(git(wt, 'ls-files', '-v').split('\n').filter(line => line.startsWith('S '))).toEqual([]);
    expect(await readDeftSnapshot(wt)).toBeNull();
  });
});
