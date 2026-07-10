import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectConfig } from '../projects.js';
import {
  clearStateMigrationCache,
  ensureStateWorktree,
  inspectStateMigration,
  isStateMigrated,
  parseMigrationCompleteMarker,
  resolveStateHome,
  stateWorktreePath,
} from '../state-home.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function configure(cwd: string): void {
  git(cwd, ['config', 'user.name', 'State Home Test']);
  git(cwd, ['config', 'user.email', 'state-home@example.com']);
  git(cwd, ['config', 'commit.gpgsign', 'false']);
}

describe('state home', () => {
  let root: string;
  let repo: string;
  let remote: string;
  let publisher: string;
  let overdeckHome: string;
  let project: ProjectConfig;
  const originalHome = process.env.OVERDECK_HOME;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'state-home-'));
    repo = join(root, 'repo');
    remote = join(root, 'remote.git');
    publisher = join(root, 'publisher');
    overdeckHome = join(root, 'overdeck-home');
    mkdirSync(repo);
    git(repo, ['init', '--quiet']);
    configure(repo);
    writeFileSync(join(repo, 'README.md'), 'main\n');
    git(repo, ['add', 'README.md']);
    git(repo, ['commit', '--quiet', '-m', 'main']);
    git(repo, ['branch', '-M', 'main']);
    git(root, ['init', '--bare', '--quiet', remote]);
    git(repo, ['remote', 'add', 'origin', remote]);
    git(repo, ['push', '--quiet', '-u', 'origin', 'main']);
    git(root, ['clone', '--quiet', '-b', 'main', remote, publisher]);
    configure(publisher);
    process.env.OVERDECK_HOME = overdeckHome;
    project = { name: 'Fixture', path: repo };
    clearStateMigrationCache();
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    clearStateMigrationCache();
    rmSync(root, { recursive: true, force: true });
  });

  function pushUnmarkedStateBranch(): string {
    git(publisher, ['switch', '--orphan', 'overdeck-state']);
    writeFileSync(join(publisher, 'records.json'), '{}\n');
    git(publisher, ['add', 'records.json']);
    git(publisher, ['commit', '--quiet', '-m', 'seed state']);
    git(publisher, ['push', '--quiet', '-u', 'origin', 'overdeck-state']);
    return git(publisher, ['rev-parse', 'HEAD']);
  }

  function pushCompletionMarker(parent: string): string {
    const sourceMainSha = git(repo, ['rev-parse', 'main']);
    writeFileSync(join(publisher, 'migration-complete.json'), `${JSON.stringify({
      sourceMainSha,
      stateBranchSha: parent,
      completedAt: '2026-07-09T20:00:00.000Z',
      version: 1,
    }, null, 2)}\n`);
    git(publisher, ['add', 'migration-complete.json']);
    git(publisher, ['commit', '--quiet', '-m', 'complete migration']);
    git(publisher, ['push', '--quiet', 'origin', 'overdeck-state']);
    return git(publisher, ['rev-parse', 'HEAD']);
  }

  it('validates the completion marker schema', () => {
    expect(parseMigrationCompleteMarker({})).toBeNull();
    expect(parseMigrationCompleteMarker({
      sourceMainSha: 'a'.repeat(40),
      stateBranchSha: 'b'.repeat(40),
      completedAt: '2026-07-09T20:00:00.000Z',
      version: 1,
    })).not.toBeNull();
  });

  it('is false with no branch and with an unmarked in-progress branch', async () => {
    await expect(isStateMigrated(project)).resolves.toBe(false);
    pushUnmarkedStateBranch();
    await expect(inspectStateMigration(project)).resolves.toMatchObject({
      migrated: false,
      migrationInProgress: true,
    });
  });

  it('becomes true only at a valid marked tip and invalidates the negative cache on tip change', async () => {
    const parent = pushUnmarkedStateBranch();
    await expect(isStateMigrated(project)).resolves.toBe(false);
    const markedTip = pushCompletionMarker(parent);

    await expect(inspectStateMigration(project)).resolves.toEqual({
      migrated: true,
      migrationInProgress: false,
      remoteTip: markedTip,
    });
  });

  it('resolves legacy paths until marked, then resolves the flat state worktree', async () => {
    const expectedPath = stateWorktreePath(project, { projectKey: 'fixture' });
    await expect(resolveStateHome(project, { projectKey: 'fixture' })).resolves.toMatchObject({
      migrated: false,
      repoPath: repo,
      recordsPath: '.pan',
      worktreePath: expectedPath,
    });
    const parent = pushUnmarkedStateBranch();
    pushCompletionMarker(parent);
    await expect(resolveStateHome(project, { projectKey: 'fixture' })).resolves.toMatchObject({
      migrated: true,
      repoPath: expectedPath,
      recordsPath: '.',
    });
  });

  it('creates a marked state worktree and is idempotent when healthy', async () => {
    const parent = pushUnmarkedStateBranch();
    pushCompletionMarker(parent);
    const path = stateWorktreePath(project, { projectKey: 'fixture' });

    await expect(ensureStateWorktree(project, { projectKey: 'fixture' })).resolves.toEqual({ status: 'created', path });
    expect(git(path, ['branch', '--show-current'])).toBe('overdeck-state');
    await expect(ensureStateWorktree(project, { projectKey: 'fixture' })).resolves.toEqual({ status: 'healthy', path });
  });

  it('recreates a clean wrong-branch state worktree on overdeck-state', async () => {
    const parent = pushUnmarkedStateBranch();
    pushCompletionMarker(parent);
    const path = stateWorktreePath(project, { projectKey: 'fixture' });
    mkdirSync(join(overdeckHome, 'state'), { recursive: true });
    git(repo, ['branch', 'wrong-state-branch', 'main']);
    git(repo, ['worktree', 'add', '--quiet', path, 'wrong-state-branch']);

    await expect(ensureStateWorktree(project, { projectKey: 'fixture' })).resolves.toEqual({ status: 'recreated', path });
    expect(git(path, ['branch', '--show-current'])).toBe('overdeck-state');
  });

  it('refuses destructive repair of a dirty state worktree', async () => {
    const parent = pushUnmarkedStateBranch();
    pushCompletionMarker(parent);
    const path = stateWorktreePath(project, { projectKey: 'fixture' });
    await ensureStateWorktree(project, { projectKey: 'fixture' });
    writeFileSync(join(path, 'dirty.txt'), 'preserve me\n');

    await expect(ensureStateWorktree(project, { projectKey: 'fixture' })).resolves.toMatchObject({
      status: 'dirty',
      path,
    });
  });
});
