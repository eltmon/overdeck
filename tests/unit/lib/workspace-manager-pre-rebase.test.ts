import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installPreRebaseHook } from '../../../src/lib/workspace-manager.js';

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

describe('installPreRebaseHook', () => {
  let tempDir: string;
  let repoPath: string;
  let worktreePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pan-806-pre-rebase-'));
    repoPath = join(tempDir, 'repo');
    worktreePath = join(tempDir, 'worktree');
    mkdirSync(repoPath);

    git(repoPath, 'init', '-b', 'main');
    git(repoPath, 'config', 'user.email', 'test@example.com');
    git(repoPath, 'config', 'user.name', 'Test User');
    writeFileSync(join(repoPath, 'README.md'), 'initial\n');
    git(repoPath, 'add', 'README.md');
    git(repoPath, 'commit', '-m', 'initial');
    git(repoPath, 'worktree', 'add', '-b', 'feature/pan-806', worktreePath);
    git(worktreePath, 'config', 'core.hooksPath', '.test-hooks');

    writeFileSync(join(worktreePath, 'feature.txt'), 'feature\n');
    git(worktreePath, 'add', 'feature.txt');
    git(worktreePath, 'commit', '-m', 'feature');
    writeFileSync(join(repoPath, 'main.txt'), 'main\n');
    git(repoPath, 'add', 'main.txt');
    git(repoPath, 'commit', '-m', 'main');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function runRebase(envOverrides: Record<string, string | undefined>) {
    const env = { ...process.env };
    delete env.OVERDECK_AGENT_ID;
    delete env.OVERDECK_PAN_GIT_OP;
    for (const [key, value] of Object.entries(envOverrides)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
    return spawnSync('git', ['rebase', 'main'], {
      cwd: worktreePath,
      encoding: 'utf-8',
      env,
    });
  }

  it('writes an executable hook at Git’s resolved hooks path', async () => {
    const hookPath = await installPreRebaseHook(worktreePath);

    expect(hookPath).toBe(join(worktreePath, '.test-hooks', 'pre-rebase'));
    expect(statSync(hookPath).mode & 0o777).toBe(0o755);
  });

  it('preserves an existing project pre-rebase hook for human shells', async () => {
    const hooksDir = join(worktreePath, '.test-hooks');
    const hookPath = join(hooksDir, 'pre-rebase');
    const markerPath = join(worktreePath, 'existing-hook-ran');
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(hookPath, `#!/bin/sh\nprintf preserved > "${markerPath}"\n`);
    chmodSync(hookPath, 0o755);

    await installPreRebaseHook(worktreePath);
    const result = runRebase({});

    expect(result.status).toBe(0);
    expect(readFileSync(markerPath, 'utf-8')).toBe('preserved');
  });

  it('runs an existing project pre-rebase hook for pan-owned rebases', async () => {
    const hooksDir = join(worktreePath, '.test-hooks');
    const hookPath = join(hooksDir, 'pre-rebase');
    const markerPath = join(worktreePath, 'existing-hook-ran');
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(hookPath, `#!/bin/sh\nprintf preserved > "${markerPath}"\n`);
    chmodSync(hookPath, 0o755);

    await installPreRebaseHook(worktreePath);
    const result = runRebase({
      OVERDECK_AGENT_ID: 'agent-pan-806',
      OVERDECK_PAN_GIT_OP: '1',
    });

    expect(result.status).toBe(0);
    expect(readFileSync(markerPath, 'utf-8')).toBe('preserved');
  });

  it('exits 1 from the hook and blocks agent rebases with pan guidance', async () => {
    const hookPath = await installPreRebaseHook(worktreePath);
    const env = { ...process.env, OVERDECK_AGENT_ID: 'agent-pan-806' };
    delete env.OVERDECK_PAN_GIT_OP;

    const hookResult = spawnSync(hookPath, [], { encoding: 'utf-8', env });
    const rebaseResult = runRebase({ OVERDECK_AGENT_ID: 'agent-pan-806' });

    expect(hookResult.status).toBe(1);
    expect(rebaseResult.status).not.toBe(0);
    expect(rebaseResult.stderr).toContain('pan sync-main');
    expect(rebaseResult.stderr).toContain('pan done');
  });

  it('allows pan-owned rebases through the sentinel', async () => {
    await installPreRebaseHook(worktreePath);

    const result = runRebase({
      OVERDECK_AGENT_ID: 'agent-pan-806',
      OVERDECK_PAN_GIT_OP: '1',
    });

    expect(result.status).toBe(0);
  });

  it('allows rebases from human shells without an agent id', async () => {
    await installPreRebaseHook(worktreePath);

    const result = runRebase({});

    expect(result.status).toBe(0);
  });
});
