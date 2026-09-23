/**
 * PAN-3996: `pan admin migrate-plan-home` reports a plan home that ignores
 * `.pan/`, and a refused or failed migration exits 1 with a one-line message
 * instead of an unhandled exception. Temp git repos only.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/projects.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/lib/projects.js')>()),
  getProjectSync: () => null,
}));

import { panIgnoreReport, runMigratePlanHome } from '../../../src/cli/commands/admin/migrate-plan-home.js';

let root: string;
let stateRoot: string;
let planHome: string;
let openIssues: string;

function write(base: string, rel: string, content: string): void {
  const path = join(base, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'admin-migrate-plan-home-')));
  write(root, 'empty-gitconfig', '');
  vi.stubEnv('GIT_CONFIG_GLOBAL', join(root, 'empty-gitconfig'));
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  stateRoot = join(root, 'state');
  planHome = join(root, 'repo');
  write(stateRoot, 'drafts/pan-100.md', '# open draft\n');
  openIssues = join(root, 'open.txt');
  write(root, 'open.txt', 'PAN-100\n');
  mkdirSync(planHome, { recursive: true });
  git(planHome, 'init', '-q', '-b', 'main');
  git(planHome, 'config', 'user.email', 'test@overdeck.local');
  git(planHome, 'config', 'user.name', 'Overdeck Test');
  git(planHome, 'config', 'commit.gpgsign', 'false');
  write(planHome, '.gitignore', '.pan/\n');
  git(planHome, 'add', '.gitignore');
  git(planHome, 'commit', '-q', '-m', 'init');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe('runMigratePlanHome on a plan home that ignores .pan/', () => {
  it('--commit repairs the legacy rule, commits, and says so', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = await runMigratePlanHome('fixture', { stateRoot, planHome, openIssues, commit: true });

    expect(code).toBe(0);
    const output = log.mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain("Removed Overdeck's legacy .pan/ ignore rule");
    expect(output).toContain('Committed.');
    expect(git(planHome, 'status', '--porcelain')).toBe('');
  });

  it('a refused --commit exits 1 with one clear line and no stack trace', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    write(planHome, '.gitignore', '.pan/\nlocal-edit/\n'); // uncommitted change to .gitignore

    const code = await runMigratePlanHome('fixture', { stateRoot, planHome, openIssues, commit: true });

    expect(code).toBe(1);
    expect(error).toHaveBeenCalledTimes(1);
    const message = String(error.mock.calls[0][0]);
    expect(message).toMatch(/^migrate-plan-home: .*\.gitignore has uncommitted changes/);
    expect(message).not.toMatch(/\n\s+at /);
  });

  it('a git failure during commit exits 1 with the typed git error', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    write(planHome, '.git/hooks/pre-commit', '#!/bin/sh\nexit 1\n');
    execFileSync('chmod', ['+x', join(planHome, '.git/hooks/pre-commit')]);

    const code = await runMigratePlanHome('fixture', { stateRoot, planHome, openIssues, commit: true });

    expect(code).toBe(1);
    expect(String(error.mock.calls[0][0])).toMatch(/^migrate-plan-home: git commit failed in /);
  });
});

// Review of #3998: the ignore repair runs on its own, with no copy and no
// tracker (getProjectSync is mocked to "unregistered" and no --open-issues is
// given, so the migration path would exit 1 before doing anything).
describe('runMigratePlanHome --repair-ignore', () => {
  it('removes the legacy line and commits .gitignore alone, without a tracker', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    write(planHome, 'wip.txt', 'operator work\n');

    const code = await runMigratePlanHome('fixture', { stateRoot, planHome, repairIgnore: true });

    expect(code).toBe(0);
    const output = log.mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain("Removed Overdeck's legacy .pan/ ignore rule");
    expect(output).toContain('Committed .gitignore.');
    expect(git(planHome, 'show', '--name-only', '--format=', 'HEAD').trim()).toBe('.gitignore');
    expect(git(planHome, 'status', '--porcelain')).toBe('?? wip.txt\n');
  });

  it('--dry-run names the rule and changes nothing', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = await runMigratePlanHome('fixture', { stateRoot, planHome, repairIgnore: true, dryRun: true });

    expect(code).toBe(0);
    expect(log.mock.calls.map((call) => String(call[0])).join('\n')).toContain('Would remove');
    expect(git(planHome, 'status', '--porcelain')).toBe('');
  });

  it('says so when there is nothing to repair', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    write(planHome, '.gitignore', 'node_modules/\n');
    git(planHome, 'commit', '-q', '-am', 'drop legacy line');

    const code = await runMigratePlanHome('fixture', { stateRoot, planHome, repairIgnore: true });

    expect(code).toBe(0);
    expect(log.mock.calls.map((call) => String(call[0])).join('\n')).toContain('nothing to repair');
  });

  it('refuses to combine with --commit', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const code = await runMigratePlanHome('fixture', { stateRoot, planHome, repairIgnore: true, commit: true });

    expect(code).toBe(1);
    expect(String(error.mock.calls[0][0])).toContain('do not combine it with --commit');
    expect(git(planHome, 'status', '--porcelain')).toBe('');
  });
});

describe('panIgnoreReport', () => {
  const legacy = { kind: 'legacy', repoRoot: '/r', source: '/r/.gitignore', line: 44, pattern: '.pan/' } as const;
  const foreign = { kind: 'foreign', repoRoot: '/r', source: '/r/.git/info/exclude', line: 2, pattern: '.pan/' } as const;

  it('says nothing when .pan/ is not ignored', () => {
    expect(panIgnoreReport({ panIgnore: { kind: 'not-ignored', repoRoot: '/r' }, ignoreLinesRemoved: [] }, {})).toEqual([]);
    expect(panIgnoreReport({ panIgnore: { kind: 'not-a-repo' }, ignoreLinesRemoved: [] }, {})).toEqual([]);
  });

  it('--dry-run names the rule and what --commit would do', () => {
    const lines = panIgnoreReport({ panIgnore: legacy, ignoreLinesRemoved: [] }, { dryRun: true, commit: true });
    expect(lines.join('\n')).toContain('/r/.gitignore:44 (.pan/)');
    expect(lines.join('\n')).toContain('removes that line');
  });

  it('without --commit warns that the copies are ignored and how to fix it', () => {
    const text = panIgnoreReport({ panIgnore: legacy, ignoreLinesRemoved: [] }, {}).join('\n');
    expect(text).toMatch(/^Warning: .*\/r\/\.gitignore:44/);
    expect(text).toContain('ignored by git and were not committed');
    expect(text).toContain('rerun with --commit');
    expect(text).toContain('rerun with --repair-ignore');
  });

  it('reports a failed ignore check instead of staying silent', () => {
    const text = panIgnoreReport(
      { panIgnore: { kind: 'check-failed', detail: 'git rev-parse failed in /r: bad config' }, ignoreLinesRemoved: [] },
      { dryRun: true },
    ).join('\n');
    expect(text).toContain('could not check whether the plan home ignores .pan/');
    expect(text).toContain('bad config');
  });

  it('warns about a foreign rule and says it was not edited', () => {
    const text = panIgnoreReport({ panIgnore: foreign, ignoreLinesRemoved: [] }, {}).join('\n');
    expect(text).toContain("/r/.git/info/exclude:2 (.pan/), which is not Overdeck's legacy line");
    expect(text).toContain('it was not edited');
  });
});
