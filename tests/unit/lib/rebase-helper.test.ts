import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { MergeSet } from '../../../src/lib/merge-set.js';
import { rebaseAndPushRepos } from '../../../src/lib/rebase-helper.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

describe('rebaseAndPushRepos', () => {
  let tempDir: string;
  let remoteDir: string;
  let repoDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pan-rebase-helper-'));
    remoteDir = join(tempDir, 'remote.git');
    repoDir = join(tempDir, 'repo');

    await execAsync(`git init --bare "${remoteDir}"`);
    await mkdir(repoDir, { recursive: true });
    await execAsync('git init', { cwd: repoDir });
    await execAsync('git config user.name "Test User"', { cwd: repoDir });
    await execAsync('git config user.email "test@example.com"', { cwd: repoDir });
    await execAsync(`git remote add origin "${remoteDir}"`, { cwd: repoDir });

    await mkdir(join(repoDir, '.planning'), { recursive: true });
    await writeFile(join(repoDir, '.planning', 'plan.vbrief.json'), '{"version":1}\n');
    await writeFile(join(repoDir, '.planning', 'PLANNING_PROMPT.md.archived'), 'base archived prompt\n');
    await writeFile(join(repoDir, 'README.md'), 'base\n');
    await execAsync('git add .', { cwd: repoDir });
    await execAsync('git commit -m "base"', { cwd: repoDir });
    await execAsync('git branch -M main', { cwd: repoDir });
    await execAsync('git push -u origin main', { cwd: repoDir });

    await execAsync('git checkout -b feature/pan-711', { cwd: repoDir });
    await writeFile(join(repoDir, '.planning', 'STATE.md'), '# local state\n');
    await writeFile(join(repoDir, '.planning', 'plan.vbrief.json'), '{"version":2,"local":"keep-me"}\n');
    await execAsync('git add .planning/STATE.md .planning/plan.vbrief.json', { cwd: repoDir });
    await execAsync('git commit -m "local planning change"', { cwd: repoDir });

    await writeFile(join(repoDir, '.planning', 'PLANNING_PROMPT.md.archived'), 'local archived prompt\n');
    await execAsync('git add .planning/PLANNING_PROMPT.md.archived', { cwd: repoDir });
    await execAsync('git commit -m "local archived planning artifact"', { cwd: repoDir });
    await execAsync('git push -u origin feature/pan-711', { cwd: repoDir });

    await execAsync('git checkout main', { cwd: repoDir });
    await execAsync('git rm .planning/STATE.md', { cwd: repoDir }).catch(() => {});
    await writeFile(join(repoDir, '.planning', 'plan.vbrief.json'), '{"version":3,"upstream":"discard-me"}\n');
    await execAsync('git add .planning/plan.vbrief.json', { cwd: repoDir });
    await execAsync('git commit -m "upstream planning change"', { cwd: repoDir });

    await writeFile(join(repoDir, '.planning', 'PLANNING_PROMPT.md.archived'), 'upstream archived prompt\n');
    await execAsync('git add .planning/PLANNING_PROMPT.md.archived', { cwd: repoDir });
    await execAsync('git commit -m "upstream archived planning artifact"', { cwd: repoDir });
    await execAsync('git push origin main', { cwd: repoDir });

    await execAsync('git checkout feature/pan-711', { cwd: repoDir });
  });

  function createMergeSet(): MergeSet {
    return {
      issueId: 'PAN-711',
      projectKey: 'panopticon-cli',
      projectPath: repoDir,
      workspaceType: 'monorepo',
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      repos: [
        {
          repoKey: 'panopticon-cli',
          repoPath: repoDir,
          forge: 'github',
          sourceBranch: 'feature/pan-711',
          targetBranch: 'main',
          reviewStatus: 'pending',
          testStatus: 'pending',
          rebaseStatus: 'pending',
          verificationStatus: 'pending',
          mergeStatus: 'pending',
          mergeOrder: 1,
          required: true,
        },
      ],
    };
  }

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('keeps the rebased branch version when only .planning files conflict', async () => {
    const result = await rebaseAndPushRepos(repoDir, createMergeSet());

    expect(result.success).toBe(true);
    expect(result.results[0]?.outcome).toBe('rebased');

    const planningFile = await readFile(join(repoDir, '.planning', 'plan.vbrief.json'), 'utf-8');
    expect(planningFile).toContain('"local":"keep-me"');
    expect(planningFile).not.toContain('"upstream":"discard-me"');
  });

  it('keeps planning conflicts shell-safe for filenames with shell metacharacters', async () => {
    const hostileFile = '.planning/$(touch injected).md';
    const injectedPath = join(repoDir, 'injected');

    await writeFile(join(repoDir, hostileFile), 'local hostile planning file\n');
    await execFileAsync('git', ['add', '--', hostileFile], { cwd: repoDir, encoding: 'utf-8' });
    await execAsync('git commit -m "local hostile planning file"', { cwd: repoDir });

    await execAsync('git checkout main', { cwd: repoDir });
    await writeFile(join(repoDir, hostileFile), 'upstream hostile planning file\n');
    await execFileAsync('git', ['add', '--', hostileFile], { cwd: repoDir, encoding: 'utf-8' });
    await execAsync('git commit -m "upstream hostile planning file"', { cwd: repoDir });
    await execAsync('git push origin main', { cwd: repoDir });

    await execAsync('git checkout feature/pan-711', { cwd: repoDir });

    const result = await rebaseAndPushRepos(repoDir, createMergeSet());

    expect(result.success).toBe(true);
    expect(result.results[0]?.outcome).toBe('rebased');
    expect(existsSync(injectedPath)).toBe(false);
    expect(await readFile(join(repoDir, hostileFile), 'utf-8')).toBe('local hostile planning file\n');
  });

  it('fails when a later non-planning conflict appears after planning conflicts are auto-resolved', async () => {
    await writeFile(join(repoDir, 'README.md'), 'local readme\n');
    await execAsync('git add README.md', { cwd: repoDir });
    await execAsync('git commit -m "local readme change"', { cwd: repoDir });

    await execAsync('git checkout main', { cwd: repoDir });
    await writeFile(join(repoDir, 'README.md'), 'upstream readme\n');
    await execAsync('git add README.md', { cwd: repoDir });
    await execAsync('git commit -m "upstream readme change"', { cwd: repoDir });
    await execAsync('git push origin main', { cwd: repoDir });

    await execAsync('git checkout feature/pan-711', { cwd: repoDir });

    const result = await rebaseAndPushRepos(repoDir, createMergeSet());

    expect(result.success).toBe(false);
    expect(result.firstFailure?.outcome).toBe('conflict');
    expect(result.firstFailure?.conflictFiles).toEqual(['README.md']);

    const { stdout: rebaseMergePath } = await execAsync('git rev-parse --git-path rebase-merge', {
      cwd: repoDir,
      encoding: 'utf-8',
      timeout: 10000,
    });
    const { stdout: rebaseApplyPath } = await execAsync('git rev-parse --git-path rebase-apply', {
      cwd: repoDir,
      encoding: 'utf-8',
      timeout: 10000,
    });

    expect(await readFile(join(repoDir, 'README.md'), 'utf-8')).toBe('local readme\n');
    expect(existsSync(join(repoDir, rebaseMergePath.trim()))).toBe(false);
    expect(existsSync(join(repoDir, rebaseApplyPath.trim()))).toBe(false);
  });

  it('fails immediately when git rebase cannot start a rebase state', async () => {
    await writeFile(join(repoDir, 'README.md'), 'dirty worktree\n');

    const result = await rebaseAndPushRepos(repoDir, createMergeSet());

    expect(result.success).toBe(false);
    expect(result.firstFailure?.outcome).toBe('error');
    expect(result.firstFailure?.message).toContain('cannot rebase: You have unstaged changes');

    const { stdout: rebaseMergePath } = await execAsync('git rev-parse --git-path rebase-merge', {
      cwd: repoDir,
      encoding: 'utf-8',
      timeout: 10000,
    });
    const { stdout: rebaseApplyPath } = await execAsync('git rev-parse --git-path rebase-apply', {
      cwd: repoDir,
      encoding: 'utf-8',
      timeout: 10000,
    });

    expect(existsSync(join(repoDir, rebaseMergePath.trim()))).toBe(false);
    expect(existsSync(join(repoDir, rebaseApplyPath.trim()))).toBe(false);
  });
});
