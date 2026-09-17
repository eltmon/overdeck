import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { dirname } from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isPreWorktreeMetadataOnlyDir, stagePreWorktreeMetadataSync } from '../worktree-ops.js';

describe('isPreWorktreeMetadataOnlyDir / stagePreWorktreeMetadataSync', () => {
  let workspacePath: string;
  const cleanup: string[] = [];

  beforeEach(() => {
    workspacePath = mkdtempSync(join(tmpdir(), 'pre-worktree-meta-'));
  });

  afterEach(() => {
    rmSync(workspacePath, { recursive: true, force: true });
    for (const path of cleanup.splice(0)) {
      rmSync(path, { recursive: true, force: true });
    }
  });

  it('stages a directory containing only .pan/ and .overdeck/', () => {
    mkdirSync(join(workspacePath, '.pan'));
    mkdirSync(join(workspacePath, '.overdeck'));

    expect(isPreWorktreeMetadataOnlyDir(workspacePath)).toBe(true);

    const stagedPath = stagePreWorktreeMetadataSync(workspacePath);
    expect(stagedPath).not.toBeNull();
    cleanup.push(stagedPath!);
    expect(existsSync(stagedPath!)).toBe(true);
    expect(existsSync(workspacePath)).toBe(false);
  });

  it('does not stage a directory containing .git', () => {
    mkdirSync(join(workspacePath, '.pan'));
    mkdirSync(join(workspacePath, '.git'));

    expect(isPreWorktreeMetadataOnlyDir(workspacePath)).toBe(false);
    expect(stagePreWorktreeMetadataSync(workspacePath)).toBeNull();
  });

  it('does not stage a directory containing a plain file', () => {
    mkdirSync(join(workspacePath, '.overdeck'));
    mkdirSync(join(workspacePath, 'src'));

    expect(isPreWorktreeMetadataOnlyDir(workspacePath)).toBe(false);
    expect(stagePreWorktreeMetadataSync(workspacePath)).toBeNull();
  });
});

describe('createWorktree — CWE-78: branch config never reaches a shell', () => {
  let repoPath: string;
  let marker: string;
  const cleanup: string[] = [];

  beforeEach(() => {
    repoPath = mkdtempSync(join(tmpdir(), 'worktree-cwe78-repo-'));
    marker = join(mkdtempSync(join(tmpdir(), 'worktree-cwe78-marker-')), 'pwned');
    execSync('git init -q && git commit --allow-empty -qm init', {
      cwd: repoPath,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'test',
        GIT_AUTHOR_EMAIL: 'test@test.com',
        GIT_COMMITTER_NAME: 'test',
        GIT_COMMITTER_EMAIL: 'test@test.com',
      },
    });
  });

  afterEach(() => {
    for (const path of cleanup.splice(0)) {
      execSync(`git worktree remove --force "${path}" 2>/dev/null || true`, { cwd: repoPath, shell: '/bin/bash' });
      rmSync(path, { recursive: true, force: true });
    }
    rmSync(repoPath, { recursive: true, force: true });
    rmSync(dirname(marker), { recursive: true, force: true });
  });

  it('a defaultBranch containing shell syntax is never executed', async () => {
    const { createWorktree } = await import('../worktree-ops.js');
    const targetPath = join(repoPath, 'wt-out');
    cleanup.push(targetPath);

    // Shell metacharacters in a config-supplied branch name must travel as an
    // argv element, not be interpolated into a shell command.
    const malicious = `main; touch ${marker}`;
    const warn = (await import('node:console')).default;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await createWorktree(repoPath, targetPath, 'scratch/cwe78', malicious);
    warnSpy.mockRestore();

    expect(existsSync(marker)).toBe(false);
    // The fetch fails (unknown refspec), the local-ref fallback fails the same
    // way — the command reports failure, never execution.
    expect(result.success).toBe(false);
    expect(warn).toBeDefined();
  });

  it('a legitimate defaultBranch still fetches and cuts the worktree from origin/<default>', async () => {
    const { createWorktree } = await import('../worktree-ops.js');
    // Give the repo an origin with a real main branch.
    const remotePath = mkdtempSync(join(tmpdir(), 'worktree-cwe78-remote-'));
    cleanup.push(remotePath);
    execSync('git init -q --bare .', { cwd: remotePath });
    execSync(`git remote add origin "${remotePath}"`, { cwd: repoPath });
    execSync('git branch -M main && git push -q origin main', { cwd: repoPath, env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@test.com',
      GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@test.com',
    } });

    const targetPath = join(repoPath, 'wt-ok');
    cleanup.push(targetPath);
    const result = await createWorktree(repoPath, targetPath, 'scratch/ok', 'main');

    expect(result.success).toBe(true);
    expect(existsSync(join(targetPath, '.git'))).toBe(true);
  });

  it('a $(...) payload in branchName or targetPath is never executed', async () => {
    const { createWorktree } = await import('../worktree-ops.js');
    const markerBranch = join(dirname(marker), 'pwned-branch');
    const markerPath = join(dirname(marker), 'pwned-path');

    const maliciousBranch = `scratch/$(touch ${markerBranch})`;
    const maliciousPath = join(repoPath, `wt-$(touch ${markerPath})`);
    cleanup.push(maliciousPath);

    const result = await createWorktree(repoPath, maliciousPath, maliciousBranch, 'main');

    expect(existsSync(markerBranch)).toBe(false);
    expect(existsSync(markerPath)).toBe(false);
    expect(result.success).toBe(false);
  });

  it('removeWorktree never executes a $(...) payload in targetPath or branchName', async () => {
    const { removeWorktree } = await import('../worktree-ops.js');
    const markerRemove = join(dirname(marker), 'pwned-remove');
    const markerBranch = join(dirname(marker), 'pwned-rmbranch');

    await removeWorktree(
      repoPath,
      join(repoPath, `wt-$(touch ${markerRemove})`),
      `scratch/$(touch ${markerBranch})`,
    );

    expect(existsSync(markerRemove)).toBe(false);
    expect(existsSync(markerBranch)).toBe(false);
  });

  it('a quoted-breakout payload in defaultBranch is never executed', async () => {
    const { createWorktree } = await import('../worktree-ops.js');
    const markerQuote = join(dirname(marker), 'pwned-quote');

    // An embedded double-quote would break out of a "..."-interpolated shell string.
    const result = await createWorktree(repoPath, join(repoPath, 'wt-q'), 'scratch/q', `main"; touch ${markerQuote}; echo "`);
    cleanup.push(join(repoPath, 'wt-q'));

    expect(existsSync(markerQuote)).toBe(false);
    expect(result.success).toBe(false);
  });

  it('a refspec payload in defaultBranch is rejected before any fetch (CWE-78 residual)', async () => {
    const { createWorktree } = await import('../worktree-ops.js');

    // argv stops the shell but NOT refspec parsing: this payload would make
    // git update refs/heads/pwned locally if it ever reached the fetch.
    const result = await createWorktree(
      repoPath,
      join(repoPath, 'wt-refspec'),
      'scratch/refspec',
      '+refs/heads/main:refs/heads/pwned',
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid branch name');
    const refs = execSync('git show-ref --heads || true', { cwd: repoPath, encoding: 'utf-8' });
    expect(refs).not.toContain('pwned');
  });

  it('shared validator accepts real branch names and rejects refspecs', async () => {
    const { isValidBranchNamePromise } = await import('../../git-utils.js');

    await expect(isValidBranchNamePromise('main')).resolves.toBe(true);
    await expect(isValidBranchNamePromise('feature/pan-3847')).resolves.toBe(true);
    await expect(isValidBranchNamePromise('release/1.2.x')).resolves.toBe(true);
    await expect(isValidBranchNamePromise('+refs/heads/main:refs/heads/pwned')).resolves.toBe(false);
    await expect(isValidBranchNamePromise('main:refs/heads/pwned')).resolves.toBe(false);
    await expect(isValidBranchNamePromise('')).resolves.toBe(false);
  });
});
