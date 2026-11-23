import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsControl = vi.hoisted(() => ({ failRename: false }));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      if (fsControl.failRename) throw Object.assign(new Error('rename blocked'), { code: 'EACCES' });
      return actual.renameSync(...args);
    },
  };
});

import { claudeTrustTargets, preTrustDirectory } from '../../../../src/lib/workspace-manager/worktree-ops.js';

/**
 * PAN-3905: preTrustDirectory read-modify-writes ~/.claude.json, which Claude
 * Code also writes. It takes Claude Code's own lock (`~/.claude.json.lock`, a
 * mkdir lock that goes stale after 10 s), re-reads under it, and never leaves
 * its temp file behind. HOME is a temp dir for every test here.
 */

let tempHome: string;
let claudeJsonPath: string;
let lockDir: string;
let prevHome: string | undefined;

function readClaudeJson(): { bypassPermissionsModeAccepted?: boolean; projects: Record<string, { hasTrustDialogAccepted?: boolean }> } {
  return JSON.parse(readFileSync(claudeJsonPath, 'utf8'));
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'pan-3905-pretrust-home-'));
  prevHome = process.env.HOME;
  process.env.HOME = tempHome;
  claudeJsonPath = join(tempHome, '.claude.json');
  lockDir = `${claudeJsonPath}.lock`;
  writeFileSync(claudeJsonPath, JSON.stringify({ numStartups: 7, projects: {} }));
  fsControl.failRename = false;
});

afterEach(() => {
  vi.useRealTimers();
  fsControl.failRename = false;
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  rmSync(tempHome, { recursive: true, force: true });
});

describe('preTrustDirectory (PAN-3905)', () => {
  it('keeps both entries when two calls run concurrently', async () => {
    await Promise.all([preTrustDirectory('/work/a'), preTrustDirectory('/work/b')]);

    const data = readClaudeJson();
    expect(data.projects['/work/a']).toMatchObject({ hasTrustDialogAccepted: true });
    expect(data.projects['/work/b']).toMatchObject({ hasTrustDialogAccepted: true });
    expect(data.bypassPermissionsModeAccepted).toBe(true);
    expect(existsSync(lockDir)).toBe(false);
  });

  it('keeps a change another writer made after an earlier call', async () => {
    await preTrustDirectory('/work/a');
    // Claude Code writes its own change between two of our launches.
    writeFileSync(claudeJsonPath, JSON.stringify({ ...readClaudeJson(), numStartups: 8 }));

    await preTrustDirectory('/work/b');

    const data = readClaudeJson() as ReturnType<typeof readClaudeJson> & { numStartups: number };
    expect(data.numStartups).toBe(8);
    expect(Object.keys(data.projects).sort()).toEqual(['/work/a', '/work/b']);
  });

  it('waits while another process holds ~/.claude.json.lock, then writes', async () => {
    vi.useFakeTimers();
    mkdirSync(lockDir);
    let settled = false;
    const pending = preTrustDirectory('/work/a').then(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(200);
    expect(settled).toBe(false);
    expect(readClaudeJson().projects['/work/a']).toBeUndefined();

    rmdirSync(lockDir);
    await vi.advanceTimersByTimeAsync(2_000);
    await pending;

    expect(readClaudeJson().projects['/work/a']).toMatchObject({ hasTrustDialogAccepted: true });
    expect(existsSync(lockDir)).toBe(false);
  });

  it('gives up without writing when the lock stays held', async () => {
    vi.useFakeTimers();
    mkdirSync(lockDir);
    const before = readFileSync(claudeJsonPath, 'utf8');
    const outcome = expect(preTrustDirectory('/work/a')).rejects.toThrow(/is held by another process/);

    await vi.advanceTimersByTimeAsync(5_000);
    await outcome;

    expect(readFileSync(claudeJsonPath, 'utf8')).toBe(before);
    // Someone else's lock is theirs to release.
    expect(existsSync(lockDir)).toBe(true);
  });

  it('breaks a stale lock (older than 10 s) left by a dead holder', async () => {
    mkdirSync(lockDir);
    const old = new Date(Date.now() - 20_000);
    utimesSync(lockDir, old, old);

    await preTrustDirectory('/work/a');

    expect(readClaudeJson().projects['/work/a']).toMatchObject({ hasTrustDialogAccepted: true });
    expect(existsSync(lockDir)).toBe(false);
  });

  it('removes its temp file and releases the lock when the rename fails', async () => {
    fsControl.failRename = true;
    const before = readFileSync(claudeJsonPath, 'utf8');

    await expect(preTrustDirectory('/work/a')).rejects.toThrow('rename blocked');

    expect(readdirSync(tempHome).sort()).toEqual(['.claude.json']);
    expect(readFileSync(claudeJsonPath, 'utf8')).toBe(before);
  });

  it('creates ~/.claude.json when Claude Code has never run on the host', async () => {
    rmSync(claudeJsonPath);

    await preTrustDirectory('/work/a');

    const data = readClaudeJson();
    expect(data.bypassPermissionsModeAccepted).toBe(true);
    expect(data.projects['/work/a']).toMatchObject({ hasTrustDialogAccepted: true });
    expect(statSync(claudeJsonPath).mode & 0o777).toBe(0o600);
    expect(readdirSync(tempHome).sort()).toEqual(['.claude.json']);
  });

  it('skips the parse when the file is unchanged and the cwd is already trusted', async () => {
    await preTrustDirectory('/work/a');
    const { mtimeMs } = statSync(claudeJsonPath);
    // Hold the lock: a call that needed it would wait here, not return.
    mkdirSync(lockDir);
    const parse = vi.spyOn(JSON, 'parse');

    try {
      await preTrustDirectory('/work/a');
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
      rmdirSync(lockDir);
    }
    expect(statSync(claudeJsonPath).mtimeMs).toBe(mtimeMs);
  });
});

/** A real repository with one linked worktree, under a fresh temp dir. */
function makeRepoWithWorktree(base: string): { root: string; worktree: string } {
  const root = join(base, 'proj');
  const worktree = join(root, 'workspaces', 'feature-x');
  mkdirSync(root, { recursive: true });
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'ignore' });
  git(root, 'init', '-q');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'init');
  git(root, 'worktree', 'add', '-q', '-b', 'feature/x', worktree);
  return { root, worktree };
}

describe('claudeTrustTargets (PAN-4242)', () => {
  let base: string;
  let prevCeiling: string | undefined;

  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'pan-4242-targets-')));
    prevCeiling = process.env.GIT_CEILING_DIRECTORIES;
    // A temp dir never resolves to a repository above the test's own base.
    process.env.GIT_CEILING_DIRECTORIES = base;
  });

  afterEach(() => {
    if (prevCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = prevCeiling;
    rmSync(base, { recursive: true, force: true });
  });

  it('adds the repository root for a linked worktree', async () => {
    const { root, worktree } = makeRepoWithWorktree(base);

    expect(await claudeTrustTargets(worktree)).toEqual([worktree, root]);
  });

  it('adds the realpath without the trailing slash', async () => {
    const { root, worktree } = makeRepoWithWorktree(base);

    expect(await claudeTrustTargets(`${worktree}/`)).toEqual([`${worktree}/`, worktree, root]);
  });

  it('adds the real path of a symlinked cwd', async () => {
    const { root, worktree } = makeRepoWithWorktree(base);
    const link = join(base, 'link');
    symlinkSync(worktree, link);

    expect(await claudeTrustTargets(link)).toEqual([link, worktree, root]);
  });

  it('returns only the directory outside a git work tree', async () => {
    const plain = join(base, 'plain');
    mkdirSync(plain);

    expect(await claudeTrustTargets(plain)).toEqual([plain]);
  });

  it('returns only the path given when it does not exist', async () => {
    expect(await claudeTrustTargets('/work/missing/dir')).toEqual(['/work/missing/dir']);
  });

  it('never adds the home directory or / as a repository root', async () => {
    const home = join(base, 'home');
    mkdirSync(join(home, 'scratch'), { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: home, stdio: 'ignore' });
    process.env.HOME = home;

    const targets = await claudeTrustTargets(join(home, 'scratch'));

    expect(targets).toEqual([join(home, 'scratch')]);
    expect(targets).not.toContain('/');
  });
});
