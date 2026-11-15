/**
 * PAN-5395: the start gate (isOnlyOverdeckRuntimeWorkspaceChanges) must pass
 * on a single-repo workspace once ensureWorkspaceSyncExclude has hidden the
 * .claude/ sync output from git status.
 *
 * Scaffold copied from agents-spawn-dirty-workspace.test.ts: a real scratch
 * repo with one linked worktree and an isolated global git config.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEmitActivityEntrySync = vi.hoisted(() => vi.fn());

vi.mock('../../../../lib/activity-logger.js', () => ({
  emitActivityEntry: mockEmitActivityEntrySync,
}));

import { isOnlyOverdeckRuntimeWorkspaceChanges } from '../agents/spawn.js';
import { ensureWorkspaceSyncExclude } from '../../../../lib/workspace-manager/sync-exclude.js';

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
  scratch = mkdtempSync(join(tmpdir(), 'agents-spawn-sync-exclude-'));
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

describe('isOnlyOverdeckRuntimeWorkspaceChanges after ensureWorkspaceSyncExclude (PAN-5395)', () => {
  it('lets the start gate proceed in a single-repo workspace with untracked .claude/settings.json and .overdeck/', async () => {
    write(wt, '.claude/settings.json', '{}\n');
    write(wt, '.claude/mcp.json', '{}\n');
    write(wt, '.claude/agents/pan-work-agent.md', 'x\n');
    write(wt, '.overdeck/continue.json', '{}\n');

    const before = git(wt, 'status', '--porcelain', '--untracked-files=all');
    expect(isOnlyOverdeckRuntimeWorkspaceChanges(before)).toBe(false);

    await ensureWorkspaceSyncExclude(wt);

    const after = git(wt, 'status', '--porcelain', '--untracked-files=all');
    expect(isOnlyOverdeckRuntimeWorkspaceChanges(after)).toBe(true);
  });
});
