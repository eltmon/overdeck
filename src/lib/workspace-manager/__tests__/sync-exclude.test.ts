/**
 * PAN-5395: ensureWorkspaceSyncExclude hides Overdeck's .claude/ sync output
 * from git in a single-repo issue workspace.
 *
 * Scaffold copied from src/lib/git/__tests__/worktree-exclude.test.ts: a real
 * scratch repo with one linked worktree and an isolated global git config
 * (GIT_CONFIG_GLOBAL, XDG_CONFIG_HOME).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setExcludeBlock, readExcludeBlock } from '../../git/worktree-exclude.js';
import { filterUncommittedPorcelainLines } from '../../work/done-preflight.js';
import { ensureWorkspaceSyncExclude } from '../sync-exclude.js';

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

function write(base: string, path: string, content: string): void {
  mkdirSync(join(base, path, '..'), { recursive: true });
  writeFileSync(join(base, path), content);
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'sync-exclude-'));
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

describe('ensureWorkspaceSyncExclude', () => {
  it('hides every sync path and leaves pan done nothing to report', async () => {
    write(wt, '.claude/settings.json', '{}\n');
    write(wt, '.claude/mcp.json', '{}\n');
    write(wt, '.claude/settings.local.json', '{}\n');
    write(wt, '.claude/agents/pan-work-agent.md', 'x\n');
    write(wt, '.claude/skills/x/SKILL.md', 'x\n');
    write(wt, '.claude/.overdeck-manifest.json', '{}\n');
    write(wt, '.claude/.caveman-variant', 'x\n');
    write(wt, '.overdeck/continue.json', '{}\n');

    const result = await ensureWorkspaceSyncExclude(wt);
    expect(result.status).toBe('written');

    const porcelain = git(wt, 'status', '--porcelain', '-uall');
    expect(porcelain).not.toContain('.claude/');
    expect(filterUncommittedPorcelainLines(porcelain)).toEqual([]);
  });

  it("keeps a project's own agent definition visible", async () => {
    write(wt, '.claude/agents/my-agent.md', 'x\n');

    await ensureWorkspaceSyncExclude(wt);

    expect(git(wt, 'status', '--porcelain', '-uall')).toContain('.claude/agents/my-agent.md');
  });

  it("keeps a project's own .claude files and nested paths visible", async () => {
    write(wt, '.claude/notes.md', 'x\n');
    write(wt, '.claude/commands/x.md', 'x\n');
    write(wt, 'src/.claude/settings.json', '{}\n');

    await ensureWorkspaceSyncExclude(wt);

    const porcelain = git(wt, 'status', '--porcelain', '-uall');
    expect(porcelain).toContain('.claude/notes.md');
    expect(porcelain).toContain('.claude/commands/x.md');
    expect(porcelain).toContain('src/.claude/settings.json');
  });

  it('does not touch the primary checkout', async () => {
    const mainExclude = join(main, '.git', 'info', 'exclude');
    const before = readFileSync(mainExclude, 'utf8');

    await ensureWorkspaceSyncExclude(wt);
    write(main, '.claude/settings.json', '{}\n');

    expect(git(main, 'status', '--porcelain', '-uall')).toContain('.claude/settings.json');
    expect(readFileSync(mainExclude, 'utf8')).toBe(before);
  });

  it('returns unchanged on a second call', async () => {
    const first = await ensureWorkspaceSyncExclude(wt);
    expect(first.status).toBe('written');

    const second = await ensureWorkspaceSyncExclude(wt);
    expect(second).toEqual({ status: 'unchanged', file: first.file });
  });

  it('skips the primary checkout', async () => {
    const mainExclude = join(main, '.git', 'info', 'exclude');
    const before = readFileSync(mainExclude, 'utf8');

    const result = await ensureWorkspaceSyncExclude(main);

    expect(result).toEqual({ status: 'skipped' });
    expect(readFileSync(mainExclude, 'utf8')).toBe(before);
  });

  it('returns a warning instead of throwing outside a git repository', async () => {
    const outside = mkdtempSync(join(scratch, 'not-a-repo-'));

    const result = await ensureWorkspaceSyncExclude(outside);

    expect(result.status).toBe('skipped');
    expect(result.warning).toBeTruthy();
  });

  it('leaves a foreign worktree excludes file alone', async () => {
    git(main, 'config', 'extensions.worktreeConfig', 'true');
    const gitDir = join(main, '.git', 'worktrees', 'wt');
    const foreign = join(gitDir, 'info', 'my-ignore');
    write(main, '.git/worktrees/wt/info/my-ignore', '/local-only.txt\n');
    git(wt, 'config', '--worktree', 'core.excludesFile', foreign);
    write(wt, 'local-only.txt', 'x\n');
    expect(git(wt, 'status', '--porcelain')).not.toContain('local-only.txt');

    const result = await ensureWorkspaceSyncExclude(wt);

    expect(result.status).toBe('skipped');
    expect(result.warning).toContain(foreign);
    expect(git(wt, 'config', '--worktree', '--get', 'core.excludesFile').trim()).toBe(foreign);
    expect(git(wt, 'status', '--porcelain')).not.toContain('local-only.txt');
  });

  it('keeps an existing sageox block', async () => {
    await setExcludeBlock(wt, 'sageox', ['/.sageox/']);

    await ensureWorkspaceSyncExclude(wt);

    expect(await readExcludeBlock(wt, 'sageox')).toEqual(['/.sageox/']);
  });
});
