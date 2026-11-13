import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { healPolyrepoWorkspaceGitignoreAsync } from '../polyrepo-gitignore.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Overdeck Test',
  GIT_AUTHOR_EMAIL: 'test@overdeck.ai',
  GIT_COMMITTER_NAME: 'Overdeck Test',
  GIT_COMMITTER_EMAIL: 'test@overdeck.ai',
};

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf-8', env: GIT_ENV }).trim();
}

const MIN_1141_GITIGNORE = ['api/', '.overdeck/', '.devcontainer/', 'dev', ''].join('\n');

function initWrapperRepo(root: string): void {
  execFileSync('git', ['init', '--quiet'], { cwd: root, env: GIT_ENV });
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['config', 'core.hooksPath', '.git/hooks']);
}

function commitGitignore(root: string): void {
  writeFileSync(join(root, '.gitignore'), MIN_1141_GITIGNORE);
  git(root, ['add', '.gitignore']);
  git(root, ['commit', '-m', 'seed .gitignore', '--quiet']);
}

describe('healPolyrepoWorkspaceGitignoreAsync', () => {
  let workspacePath: string;

  beforeEach(() => {
    workspacePath = mkdtempSync(join(tmpdir(), 'polyrepo-gitignore-heal-'));
  });

  afterEach(() => {
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it('commits the sync entries into an existing wrapper and leaves it clean', async () => {
    initWrapperRepo(workspacePath);
    commitGitignore(workspacePath);
    mkdirSync(join(workspacePath, '.claude'), { recursive: true });
    writeFileSync(join(workspacePath, '.claude', 'settings.json'), '{}');
    writeFileSync(join(workspacePath, '.mcp.json'), '{}');
    writeFileSync(join(workspacePath, '.hume-config'), '{}');

    const result = await healPolyrepoWorkspaceGitignoreAsync(workspacePath, [{ name: 'api' }]);

    expect(result.committed).toBe(true);
    expect(git(workspacePath, ['status', '--porcelain', '--untracked-files=all'])).toBe('');
    expect(git(workspacePath, ['log', '--oneline']).split('\n')).toHaveLength(2);
  });

  it('is a no-op on a healed wrapper', async () => {
    initWrapperRepo(workspacePath);
    commitGitignore(workspacePath);

    const first = await healPolyrepoWorkspaceGitignoreAsync(workspacePath, [{ name: 'api' }]);
    expect(first.committed).toBe(true);

    const second = await healPolyrepoWorkspaceGitignoreAsync(workspacePath, [{ name: 'api' }]);

    expect(second.added).toEqual([]);
    expect(second.committed).toBe(false);
    expect(git(workspacePath, ['log', '--oneline']).split('\n')).toHaveLength(2);
  });

  it('restores the original .gitignore when the commit cannot land', async () => {
    initWrapperRepo(workspacePath);
    commitGitignore(workspacePath);
    const originalContent = readFileSync(join(workspacePath, '.gitignore'), 'utf-8');
    const hookPath = join(workspacePath, '.git', 'hooks', 'pre-commit');
    writeFileSync(hookPath, '#!/bin/sh\nexit 1\n');
    chmodSync(hookPath, 0o755);

    const result = await healPolyrepoWorkspaceGitignoreAsync(workspacePath, [{ name: 'api' }]);

    expect(result.committed).toBe(false);
    expect(result.warning).toBeTruthy();
    expect(readFileSync(join(workspacePath, '.gitignore'), 'utf-8')).toBe(originalContent);
    expect(git(workspacePath, ['status', '--porcelain', '--', '.gitignore'])).toBe('');
  });

  it('does nothing without a wrapper .git', async () => {
    const result = await healPolyrepoWorkspaceGitignoreAsync(workspacePath, [{ name: 'api' }]);

    expect(result).toEqual({ added: [], committed: false, warning: null });
    expect(existsSync(join(workspacePath, '.gitignore'))).toBe(false);
  });

  it('commits only .gitignore and leaves an unrelated staged file staged', async () => {
    initWrapperRepo(workspacePath);
    commitGitignore(workspacePath);
    writeFileSync(join(workspacePath, 'notes.txt'), 'hello');
    git(workspacePath, ['add', 'notes.txt']);

    const result = await healPolyrepoWorkspaceGitignoreAsync(workspacePath, [{ name: 'api' }]);

    expect(result.committed).toBe(true);
    expect(git(workspacePath, ['show', '--name-only', '--format=', 'HEAD'])).toBe('.gitignore');
    expect(git(workspacePath, ['status', '--porcelain'])).toContain('A  notes.txt');
  });

  it('leaves an uncommitted .gitignore edit alone', async () => {
    initWrapperRepo(workspacePath);
    commitGitignore(workspacePath);
    const originalContent = readFileSync(join(workspacePath, '.gitignore'), 'utf-8');
    writeFileSync(join(workspacePath, '.gitignore'), `${originalContent}# local edit\n`);

    const result = await healPolyrepoWorkspaceGitignoreAsync(workspacePath, [{ name: 'api' }]);

    expect(result).toEqual({ added: [], committed: false, warning: null });
    expect(readFileSync(join(workspacePath, '.gitignore'), 'utf-8')).toBe(`${originalContent}# local edit\n`);
  });
});
