/**
 * PAN-4852 WI-11: placing a SageOx binding into a worktree or the primary
 * checkout, hidden from `git status`, and leaving tracked or hand-made
 * `.sageox/` folders alone. WI-12: removing a placed binding at switch-off.
 *
 * A fresh scratch repo with two linked worktrees per test, an isolated global
 * git config, and the binding store under a temp OVERDECK_HOME.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { overdeckHome } = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sageox-placement-home-'));
  process.env.OVERDECK_HOME = home;
  return { overdeckHome: home };
});

import { bindingDir } from '../binding.js';
import { ensureSageoxPlaced, PLACEMENT_MARKER, removeSageoxPlacement, sageoxDirState } from '../placement.js';

const FIVE_FILES = ['.gitignore', '.repo_0a1b2c3d-1111-2222-3333-444455556666', 'README.md', 'config.json', 'skills.lock.json'];
const savedEnv = {
  GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
  GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
};

let scratch: string;
let main: string;
let wt: string;
let wt2: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function write(base: string, path: string, content: string): void {
  mkdirSync(dirname(join(base, path)), { recursive: true });
  writeFileSync(join(base, path), content);
}

function storeBinding(projectKey: string, files: Record<string, string>): void {
  rmSync(bindingDir(projectKey), { recursive: true, force: true });
  for (const [file, content] of Object.entries(files)) write(bindingDir(projectKey), file, content);
}

function fiveFileBinding(): Record<string, string> {
  return Object.fromEntries(FIVE_FILES.map(file => [file, `binding ${file}\n`]));
}

function readMarker(root: string): { version: number; projectKey: string; files: string[]; placedAt: string } {
  return JSON.parse(readFileSync(join(root, '.sageox', PLACEMENT_MARKER), 'utf8'));
}

/** A repo whose `main` has a README (and optionally a tracked `.sageox/config.json`), plus two worktrees. */
function makeRepo(trackSageox: boolean): void {
  const dir = mkdtempSync(join(scratch, 'repo-'));
  main = join(dir, 'main');
  wt = join(dir, 'wt');
  wt2 = join(dir, 'wt2');
  mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  write(main, 'README.md', 'readme\n');
  if (trackSageox) write(main, '.sageox/config.json', '{"tracked":true}\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'init');
  git(main, 'worktree', 'add', '-q', '-b', 'feature/one', wt);
  git(main, 'worktree', 'add', '-q', '-b', 'feature/two', wt2);
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'sageox-placement-'));
  const globalConfig = join(scratch, 'gitconfig');
  writeFileSync(globalConfig, '[user]\n\tname = Overdeck Test\n\temail = test@overdeck.local\n[commit]\n\tgpgsign = false\n');
  process.env.GIT_CONFIG_GLOBAL = globalConfig;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  process.env.XDG_CONFIG_HOME = join(scratch, 'xdg');
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(scratch, { recursive: true, force: true });
  rmSync(overdeckHome, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(overdeckHome, 'packs'), { recursive: true, force: true });
  makeRepo(false);
});

describe('sageoxDirState', () => {
  it('reports absent, hand-made and placed', async () => {
    expect(await sageoxDirState(wt)).toBe('absent');
    write(wt, '.sageox/config.json', '{}\n');
    expect(await sageoxDirState(wt)).toBe('hand-made');
    write(wt, `.sageox/${PLACEMENT_MARKER}`, '{}\n');
    expect(await sageoxDirState(wt)).toBe('placed');
  });

  it('reports absent for a .sageox/ holding only runtime leftovers (no marker, no config.json)', async () => {
    write(wt, '.sageox/logs/x.log', 'runtime\n');
    expect(await sageoxDirState(wt)).toBe('absent');
  });

  it('reports tracked when git tracks .sageox/config.json', async () => {
    makeRepo(true);
    expect(await sageoxDirState(wt)).toBe('tracked');
  });
});

describe('ensureSageoxPlaced', () => {
  it('places the binding in an issue worktree, hidden, and nowhere else', async () => {
    storeBinding('app', fiveFileBinding());

    expect(await ensureSageoxPlaced(wt, 'app')).toEqual({ ok: true, state: 'placed' });

    for (const file of FIVE_FILES) expect(readFileSync(join(wt, '.sageox', file), 'utf8')).toBe(`binding ${file}\n`);
    expect(readMarker(wt)).toMatchObject({ version: 1, projectKey: 'app', files: [...FIVE_FILES].sort() });
    expect(git(wt, 'status', '--porcelain')).toBe('');
    expect(existsSync(join(main, '.sageox'))).toBe(false);
    expect(existsSync(join(wt2, '.sageox'))).toBe(false);
    // The worktree's hide does not reach the primary checkout.
    write(main, '.sageox/config.json', '{}\n');
    expect(git(main, 'status', '--porcelain')).toContain('.sageox/');
  });

  it('places in the primary checkout and hides it with an info/exclude block', async () => {
    storeBinding('app', fiveFileBinding());

    expect(await ensureSageoxPlaced(main, 'app')).toEqual({ ok: true, state: 'placed' });

    expect(readFileSync(join(main, '.git', 'info', 'exclude'), 'utf8')).toContain(
      '# overdeck:sageox begin\n/.sageox/\n# overdeck:sageox end\n',
    );
    expect(existsSync(join(main, '.sageox', 'config.json'))).toBe(true);
    expect(git(main, 'status', '--porcelain')).toBe('');
  });

  it('leaves a tracked .sageox/ untouched', async () => {
    makeRepo(true);
    storeBinding('app', fiveFileBinding());

    expect(await ensureSageoxPlaced(wt, 'app')).toEqual({ ok: true, state: 'tracked' });

    expect(readFileSync(join(wt, '.sageox', 'config.json'), 'utf8')).toBe('{"tracked":true}\n');
    expect(existsSync(join(wt, '.sageox', PLACEMENT_MARKER))).toBe(false);
    expect(existsSync(join(wt, '.sageox', 'README.md'))).toBe(false);
  });

  it('leaves a hand-made .sageox/ untouched and adds no hide', async () => {
    storeBinding('app', fiveFileBinding());
    write(wt, '.sageox/config.json', '{"hand":true}\n');

    expect(await ensureSageoxPlaced(wt, 'app')).toEqual({ ok: true, state: 'hand-made' });

    expect(readFileSync(join(wt, '.sageox', 'config.json'), 'utf8')).toBe('{"hand":true}\n');
    expect(existsSync(join(wt, '.sageox', PLACEMENT_MARKER))).toBe(false);
    const gitDir = git(wt, 'rev-parse', '--absolute-git-dir').trim();
    expect(existsSync(join(gitDir, 'info', 'overdeck-exclude'))).toBe(false);
    expect(git(wt, 'status', '--porcelain')).toContain('.sageox/');
  });

  it('warns with the link command when the project has no binding', async () => {
    const result = await ensureSageoxPlaced(wt, 'app');

    expect(result).toEqual({
      ok: false,
      warning: 'SageOx not applied: project app has no SageOx link; run pan skills pack sageox link --project app',
    });
    expect(existsSync(join(wt, '.sageox'))).toBe(false);
  });

  it('refreshes a placed binding: rewrites changed files, keeps matching ones, deletes dropped ones', async () => {
    storeBinding('app', fiveFileBinding());
    await ensureSageoxPlaced(wt, 'app');
    write(wt, '.sageox/logs/x.log', 'runtime\n');
    const readmeInode = statSync(join(wt, '.sageox', 'README.md')).ino;

    const next = fiveFileBinding();
    delete next['skills.lock.json'];
    next['config.json'] = '{"v":2}\n';
    storeBinding('app', next);

    expect(await ensureSageoxPlaced(wt, 'app')).toEqual({ ok: true, state: 'placed' });

    expect(readFileSync(join(wt, '.sageox', 'config.json'), 'utf8')).toBe('{"v":2}\n');
    expect(statSync(join(wt, '.sageox', 'README.md')).ino).toBe(readmeInode);
    expect(existsSync(join(wt, '.sageox', 'skills.lock.json'))).toBe(false);
    expect(readFileSync(join(wt, '.sageox', 'logs', 'x.log'), 'utf8')).toBe('runtime\n');
    expect(readMarker(wt).files).toEqual(Object.keys(next).sort());
    expect(git(wt, 'status', '--porcelain')).toBe('');
  });

  it('does not rewrite an unchanged marker', async () => {
    storeBinding('app', fiveFileBinding());
    await ensureSageoxPlaced(wt, 'app');
    const before = readFileSync(join(wt, '.sageox', PLACEMENT_MARKER), 'utf8');

    await ensureSageoxPlaced(wt, 'app');

    expect(readFileSync(join(wt, '.sageox', PLACEMENT_MARKER), 'utf8')).toBe(before);
  });

  it('does not delete a stale marker entry through a symlinked folder inside .sageox/', async () => {
    storeBinding('app', fiveFileBinding());
    const elsewhere = mkdtempSync(join(scratch, 'elsewhere-'));
    write(elsewhere, 'victim', 'keep me\n');
    mkdirSync(join(wt, '.sageox'), { recursive: true });
    symlinkSync(elsewhere, join(wt, '.sageox', 'link'));
    write(wt, `.sageox/${PLACEMENT_MARKER}`, JSON.stringify({ version: 1, projectKey: 'app', files: ['link/victim'] }));

    expect(await ensureSageoxPlaced(wt, 'app')).toEqual({ ok: true, state: 'placed' });

    expect(readFileSync(join(elsewhere, 'victim'), 'utf8')).toBe('keep me\n');
  });

  it('never deletes a marker entry that escapes .sageox/ or resolves to a binding file', async () => {
    storeBinding('app', fiveFileBinding());
    write(wt, 'outside', 'keep me\n');
    write(wt, `.sageox/${PLACEMENT_MARKER}`, JSON.stringify({ version: 1, projectKey: 'app', files: ['../outside', '/etc/hostname', './config.json'] }));

    expect(await ensureSageoxPlaced(wt, 'app')).toEqual({ ok: true, state: 'placed' });

    expect(readFileSync(join(wt, 'outside'), 'utf8')).toBe('keep me\n');
    expect(existsSync(join(wt, '.sageox', 'config.json'))).toBe(true);
    expect(readMarker(wt).files).toEqual([...FIVE_FILES].sort());
  });
});

describe('removeSageoxPlacement', () => {
  it('returns at once when no marker exists', async () => {
    expect(await removeSageoxPlacement(wt)).toEqual({ removed: [] });
    write(wt, '.sageox/config.json', '{"hand":true}\n');
    expect(await removeSageoxPlacement(wt)).toEqual({ removed: [] });
    expect(readFileSync(join(wt, '.sageox', 'config.json'), 'utf8')).toBe('{"hand":true}\n');
  });

  it('deletes the placed files and the marker, and keeps the hide and runtime files', async () => {
    storeBinding('app', fiveFileBinding());
    await ensureSageoxPlaced(wt, 'app');
    write(wt, '.sageox/logs/x.log', 'runtime\n');
    write(wt, '.sageox/cache/y', 'cache\n');

    const result = await removeSageoxPlacement(wt);

    expect(result.removed.sort()).toEqual([...FIVE_FILES].sort());
    for (const file of FIVE_FILES) expect(existsSync(join(wt, '.sageox', file))).toBe(false);
    expect(existsSync(join(wt, '.sageox', PLACEMENT_MARKER))).toBe(false);
    expect(readFileSync(join(wt, '.sageox', 'logs', 'x.log'), 'utf8')).toBe('runtime\n');
    expect(readFileSync(join(wt, '.sageox', 'cache', 'y'), 'utf8')).toBe('cache\n');
    expect(git(wt, 'status', '--porcelain')).toBe('');
  });

  it('places the binding again after switch-off left only runtime files', async () => {
    storeBinding('app', fiveFileBinding());
    await ensureSageoxPlaced(wt, 'app');
    write(wt, '.sageox/logs/x.log', 'runtime\n');
    await removeSageoxPlacement(wt);

    expect(await ensureSageoxPlaced(wt, 'app')).toEqual({ ok: true, state: 'placed' });

    for (const file of FIVE_FILES) expect(existsSync(join(wt, '.sageox', file))).toBe(true);
    expect(readFileSync(join(wt, '.sageox', 'logs', 'x.log'), 'utf8')).toBe('runtime\n');
    expect(git(wt, 'status', '--porcelain')).toBe('');
  });

  it('keeps a file git tracks even when a stale marker lists it', async () => {
    makeRepo(true);
    write(wt, '.sageox/README.md', 'placed\n');
    write(wt, `.sageox/${PLACEMENT_MARKER}`, JSON.stringify({ version: 1, projectKey: 'app', files: ['config.json', 'README.md'] }));

    expect(await removeSageoxPlacement(wt)).toEqual({ removed: ['README.md'] });

    expect(readFileSync(join(wt, '.sageox', 'config.json'), 'utf8')).toBe('{"tracked":true}\n');
    expect(existsSync(join(wt, '.sageox', 'README.md'))).toBe(false);
    expect(existsSync(join(wt, '.sageox', PLACEMENT_MARKER))).toBe(false);
    expect(git(wt, 'status', '--porcelain')).toBe('');
  });

  it('deletes nothing outside .sageox/', async () => {
    write(wt, 'outside', 'keep me\n');
    const elsewhere = mkdtempSync(join(scratch, 'elsewhere-'));
    write(elsewhere, 'victim', 'keep me too\n');
    mkdirSync(join(wt, '.sageox'), { recursive: true });
    symlinkSync(elsewhere, join(wt, '.sageox', 'link'));
    write(
      wt,
      `.sageox/${PLACEMENT_MARKER}`,
      JSON.stringify({ version: 1, projectKey: 'app', files: ['../outside', join(wt, 'outside'), 'link/victim', 'link'] }),
    );

    expect(await removeSageoxPlacement(wt)).toEqual({ removed: ['link'] });

    expect(readFileSync(join(wt, 'outside'), 'utf8')).toBe('keep me\n');
    expect(readFileSync(join(elsewhere, 'victim'), 'utf8')).toBe('keep me too\n');
    expect(existsSync(join(wt, '.sageox', PLACEMENT_MARKER))).toBe(false);
  });
});
