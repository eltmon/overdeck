/**
 * PAN-4852 WI-9: owner blocks in the worktree exclude file and in the
 * primary checkout's info/exclude.
 *
 * A real scratch repo with one linked worktree and an isolated global git
 * config (GIT_CONFIG_GLOBAL, XDG_CONFIG_HOME).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { excludeTarget, readExcludeBlock, removeExcludeBlock, setExcludeBlock } from '../worktree-exclude.js';

let scratch: string;
let globalConfig: string;
let main: string;
let wt: string;
const savedEnv = {
  GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
  GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
};
const GLOBAL_CONFIG = '[user]\n\tname = Overdeck Test\n\temail = test@overdeck.local\n[commit]\n\tgpgsign = false\n';

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

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'worktree-exclude-'));
  globalConfig = join(scratch, 'gitconfig');
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
});

beforeEach(() => {
  writeFileSync(globalConfig, GLOBAL_CONFIG);
  const root = mkdtempSync(join(scratch, 'repo-'));
  main = join(root, 'main');
  wt = join(root, 'wt');
  mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  write(main, 'README.md', 'seed\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'seed');
  git(main, 'worktree', 'add', '-q', '-b', 'feat', wt);
});

describe('excludeTarget', () => {
  it('picks the worktree exclude file in a linked worktree and info/exclude in the primary checkout', async () => {
    expect(await excludeTarget(wt)).toEqual({
      scope: 'worktree',
      file: join(main, '.git', 'worktrees', 'wt', 'info', 'overdeck-exclude'),
    });
    expect(await excludeTarget(main)).toEqual({ scope: 'common', file: join(main, '.git', 'info', 'exclude') });
  });
});

describe('setExcludeBlock in a linked worktree', () => {
  it('hides .sageox/ in the worktree only', async () => {
    write(wt, '.sageox/config.json', '{}\n');
    write(main, '.sageox/config.json', '{}\n');

    const target = await setExcludeBlock(wt, 'sageox', ['/.sageox/']);

    expect(target.scope).toBe('worktree');
    expect(git(wt, 'status', '--porcelain')).toBe('');
    expect(git(main, 'status', '--porcelain')).toBe('?? .sageox/\n');
    expect(git(wt, 'config', '--worktree', '--get', 'core.excludesFile').trim()).toBe(target.file);
    expect(git(wt, 'config', '--get', 'extensions.worktreeConfig').trim()).toBe('true');
  });

  it('keeps both owner blocks, and removing the last one unsets the key and deletes the file', async () => {
    await setExcludeBlock(wt, 'deft', ['/AGENTS.md']);
    const target = await setExcludeBlock(wt, 'sageox', ['/.sageox/']);
    expect(await readExcludeBlock(wt, 'deft')).toEqual(['/AGENTS.md']);
    expect(await readExcludeBlock(wt, 'sageox')).toEqual(['/.sageox/']);

    expect(await removeExcludeBlock(wt, 'deft')).toBe(true);
    expect(await readExcludeBlock(wt, 'deft')).toBeNull();
    expect(await readExcludeBlock(wt, 'sageox')).toEqual(['/.sageox/']);
    expect(git(wt, 'config', '--worktree', '--get', 'core.excludesFile').trim()).toBe(target.file);

    expect(await removeExcludeBlock(wt, 'sageox')).toBe(true);
    expect(gitCode(wt, 'config', '--worktree', '--get', 'core.excludesFile')).toBe(1);
    expect(existsSync(target.file)).toBe(false);
    expect(git(wt, 'config', '--get', 'extensions.worktreeConfig').trim()).toBe('true');
  });

  it('replaces an owner block in place on a second call', async () => {
    await setExcludeBlock(wt, 'deft', ['/AGENTS.md']);
    await setExcludeBlock(wt, 'sageox', ['/.sageox/']);
    const target = await setExcludeBlock(wt, 'deft', ['/xbrief/']);

    const text = readFileSync(target.file, 'utf8');
    expect(text).toBe('# overdeck:deft begin\n/xbrief/\n# overdeck:deft end\n# overdeck:sageox begin\n/.sageox/\n# overdeck:sageox end\n');
  });

  it('keeps the global excludes pattern applying in the worktree', async () => {
    const globalIgnore = join(scratch, 'global-ignore');
    writeFileSync(globalIgnore, '*.globalpattern\n');
    writeFileSync(globalConfig, `${GLOBAL_CONFIG}[core]\n\texcludesFile = ${globalIgnore}\n`);

    const target = await setExcludeBlock(wt, 'sageox', ['/.sageox/']);
    write(wt, 'notes.globalpattern', 'x');
    write(wt, '.sageox/config.json', '{}\n');

    expect(readFileSync(target.file, 'utf8')).toContain('# overdeck: copy of the global excludes file\n*.globalpattern\n');
    expect(git(wt, 'status', '--porcelain')).toBe('');

    // A rewrite must copy the global file again, never read back its own worktree value.
    await setExcludeBlock(wt, 'deft', ['/AGENTS.md']);
    expect(readFileSync(target.file, 'utf8')).toContain('# overdeck: copy of the global excludes file\n*.globalpattern\n');
    expect(git(wt, 'status', '--porcelain')).toBe('');
  });
});

describe('setExcludeBlock in the primary checkout', () => {
  it('writes the block into info/exclude, keeps other lines, and removal restores them', async () => {
    const exclude = join(main, '.git', 'info', 'exclude');
    writeFileSync(exclude, '# my own line\n*.mine\n');
    write(main, '.sageox/config.json', '{}\n');

    const target = await setExcludeBlock(main, 'sageox', ['/.sageox/']);

    expect(target).toEqual({ scope: 'common', file: exclude });
    expect(readFileSync(exclude, 'utf8')).toBe('# my own line\n*.mine\n# overdeck:sageox begin\n/.sageox/\n# overdeck:sageox end\n');
    expect(git(main, 'status', '--porcelain')).toBe('');
    expect(await readExcludeBlock(main, 'sageox')).toEqual(['/.sageox/']);
    expect(gitCode(main, 'config', '--get', 'core.excludesFile')).toBe(1);

    expect(await removeExcludeBlock(main, 'sageox')).toBe(true);
    expect(readFileSync(exclude, 'utf8')).toBe('# my own line\n*.mine\n');
    expect(await removeExcludeBlock(main, 'sageox')).toBe(false);
  });
});

describe('legacy Deft exclude file (pre-PAN-4852)', () => {
  it('carries its Deft patterns into a deft block when SageOx repoints core.excludesFile', async () => {
    const legacy = join(main, '.git', 'worktrees', 'wt', 'info', 'overdeck-deft-exclude');
    write(main, '.git/worktrees/wt/info/overdeck-deft-exclude', '*.global-copy\n# overdeck:deft TST-1\n/.deft/\n/deft-made.md\n');
    git(main, 'config', 'extensions.worktreeConfig', 'true');
    git(wt, 'config', '--worktree', 'core.excludesFile', legacy);
    write(wt, 'deft-made.md', 'x\n');
    write(wt, '.sageox/config.json', '{}\n');
    expect(git(wt, 'status', '--porcelain')).not.toContain('deft-made.md');

    await setExcludeBlock(wt, 'sageox', ['/.sageox/']);

    expect(git(wt, 'status', '--porcelain')).toBe('');
    expect(await readExcludeBlock(wt, 'deft')).toEqual(['/.deft/', '/deft-made.md']);
    expect(await readExcludeBlock(wt, 'sageox')).toEqual(['/.sageox/']);
    expect(existsSync(legacy)).toBe(true);
  });
});

