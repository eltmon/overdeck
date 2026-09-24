/**
 * Review of #3998 (PAN-3996): the legacy `.pan/` ignore repair on its own.
 * `repairLegacyPanIgnore` removes Overdeck's legacy line and commits
 * `.gitignore` alone — no artifacts, nothing else in the plan home — and puts
 * the line back when the commit does not happen. Temp git repos only.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlanHomeGitError } from '../../../../src/lib/pan-dir/legacy-pan-ignore.js';
import {
  IGNORE_REPAIR_COMMIT_SUBJECT,
  MigratePlanHomeError,
  repairLegacyPanIgnore,
  uncommittedPaths,
} from '../../../../src/lib/pan-dir/plan-home-commit.js';

const LEGACY_GITIGNORE = 'node_modules/\n# Overdeck state\n.pan/\ndist/\n';

let root: string;
let planHome: string;

function write(base: string, rel: string, content: string): void {
  const path = join(base, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

const headFiles = (): string[] =>
  git(planHome, 'show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean).sort();
const status = (): string => git(planHome, 'status', '--porcelain', '--untracked-files=all');

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'plan-home-commit-')));
  planHome = join(root, 'repo');
  mkdirSync(planHome, { recursive: true });
  write(root, 'empty-gitconfig', '');
  vi.stubEnv('GIT_CONFIG_GLOBAL', join(root, 'empty-gitconfig'));
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  git(planHome, 'init', '-q', '-b', 'main');
  git(planHome, 'config', 'user.email', 'test@overdeck.local');
  git(planHome, 'config', 'user.name', 'Overdeck Test');
  git(planHome, 'config', 'commit.gpgsign', 'false');
  write(planHome, '.gitignore', LEGACY_GITIGNORE);
  write(planHome, 'tracked.txt', 'v1\n');
  git(planHome, 'add', '--', '.gitignore', 'tracked.txt');
  git(planHome, 'commit', '-q', '-m', 'init');
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe('repairLegacyPanIgnore', () => {
  it('removes the legacy line and commits .gitignore alone', async () => {
    // Everything the operator has in flight stays exactly where it is.
    write(planHome, '.pan/drafts/pan-1.md', '# ignored until now, never ours to commit\n');
    write(planHome, 'tracked.txt', 'operator edit, unstaged\n');
    write(planHome, 'staged.txt', 'operator work, staged\n');
    git(planHome, 'add', '--', 'staged.txt');

    const result = await repairLegacyPanIgnore(planHome);

    expect(result.panIgnore).toMatchObject({ kind: 'legacy', line: 3 });
    expect(result.linesRemoved).toEqual([3]);
    expect(result.committed).toBe(true);
    expect(git(planHome, 'log', '-1', '--format=%s').trim()).toBe(IGNORE_REPAIR_COMMIT_SUBJECT);
    expect(headFiles()).toEqual(['.gitignore']);
    expect(git(planHome, 'show', 'HEAD:.gitignore')).toBe('node_modules/\n# Overdeck state\ndist/\n');
    expect(status().split('\n').filter(Boolean).sort()).toEqual([
      ' M tracked.txt',
      '?? .pan/drafts/pan-1.md',
      'A  staged.txt',
    ].sort());
  });

  it('restores the line and leaves nothing staged when the commit fails', async () => {
    write(planHome, '.git/hooks/pre-commit', '#!/bin/sh\necho "hook says no" >&2\nexit 1\n');
    chmodSync(join(planHome, '.git/hooks/pre-commit'), 0o755);

    const failure = await repairLegacyPanIgnore(planHome).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(PlanHomeGitError);
    expect((failure as PlanHomeGitError).step).toBe('commit');
    expect(readFileSync(join(planHome, '.gitignore'), 'utf8')).toBe(LEGACY_GITIGNORE);
    expect(status()).toBe('');
    expect(git(planHome, 'log', '-1', '--format=%s').trim()).toBe('init');
  });

  it('refuses a .gitignore with other uncommitted changes and edits nothing', async () => {
    write(planHome, '.gitignore', `${LEGACY_GITIGNORE}operator-rule/\n`);

    const failure = await repairLegacyPanIgnore(planHome).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(MigratePlanHomeError);
    expect((failure as MigratePlanHomeError).code).toBe('gitignore-dirty');
    expect(readFileSync(join(planHome, '.gitignore'), 'utf8')).toBe(`${LEGACY_GITIGNORE}operator-rule/\n`);
  });

  it('refuses a foreign rule and edits nothing', async () => {
    write(planHome, '.gitignore', 'node_modules/\n');
    git(planHome, 'commit', '-q', '-am', 'drop legacy line');
    write(planHome, '.git/info/exclude', '.pan/\n');

    const failure = await repairLegacyPanIgnore(planHome).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(MigratePlanHomeError);
    expect((failure as MigratePlanHomeError).code).toBe('pan-ignored-by-foreign-rule');
    expect(readFileSync(join(planHome, '.git/info/exclude'), 'utf8')).toBe('.pan/\n');
    expect(git(planHome, 'log', '-1', '--format=%s').trim()).toBe('drop legacy line');
  });

  it('restores the legacy line when a foreign rule sits behind it', async () => {
    write(planHome, '.git/info/exclude', '.pan/\n');

    const failure = await repairLegacyPanIgnore(planHome).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(MigratePlanHomeError);
    expect((failure as MigratePlanHomeError).code).toBe('pan-ignored-by-foreign-rule');
    expect(readFileSync(join(planHome, '.gitignore'), 'utf8')).toBe(LEGACY_GITIGNORE);
    expect(status()).toBe('');
  });

  it('--dry-run reports the rule and writes nothing', async () => {
    const result = await repairLegacyPanIgnore(planHome, { dryRun: true });

    expect(result.panIgnore.kind).toBe('legacy');
    expect(result.committed).toBe(false);
    expect(readFileSync(join(planHome, '.gitignore'), 'utf8')).toBe(LEGACY_GITIGNORE);
  });

  it('does nothing when .pan/ is not ignored', async () => {
    write(planHome, '.gitignore', 'node_modules/\n');
    git(planHome, 'commit', '-q', '-am', 'drop legacy line');

    const result = await repairLegacyPanIgnore(planHome);

    expect(result).toMatchObject({ panIgnore: { kind: 'not-ignored' }, linesRemoved: [], committed: false });
    expect(git(planHome, 'log', '-1', '--format=%s').trim()).toBe('drop legacy line');
  });
});

describe('uncommittedPaths', () => {
  it('names new, modified, and staged paths, relative to a plan home below the repo root', async () => {
    const nested = join(planHome, 'plans');
    write(nested, 'clean.md', 'clean\n');
    write(nested, 'modified.md', 'v1\n');
    git(planHome, 'add', '--', 'plans');
    git(planHome, 'commit', '-q', '-m', 'plans');
    write(nested, 'modified.md', 'v2\n');
    write(nested, 'new.md', 'new\n');
    write(nested, 'staged.md', 'staged\n');
    git(planHome, 'add', '--', 'plans/staged.md');

    const dirty = await uncommittedPaths(nested, ['clean.md', 'modified.md', 'new.md', 'staged.md', 'missing.md']);

    expect(dirty).toEqual(['modified.md', 'new.md', 'staged.md']);
  });
});
