import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createWorktree } from '../../../../src/lib/workspace-manager/worktree-ops.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function configureIdentity(cwd: string): void {
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'config', 'user.name', 'Test User');
}

describe('createWorktree fetches the feature branch (PAN-4605)', () => {
  let tempDir: string;
  let origin: string;
  let cloneA: string;
  let cloneB: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pan-4605-worktree-'));
    origin = join(tempDir, 'origin.git');
    cloneA = join(tempDir, 'clone-a');
    cloneB = join(tempDir, 'clone-b');

    git(tempDir, 'init', '--bare', '-b', 'main', origin);
    git(tempDir, 'clone', origin, cloneA);
    configureIdentity(cloneA);
    git(cloneA, 'checkout', '-b', 'main');
    writeFileSync(join(cloneA, 'README.md'), 'initial\n');
    git(cloneA, 'add', 'README.md');
    git(cloneA, 'commit', '-m', 'initial');
    git(cloneA, 'push', 'origin', 'main');

    // Clone B exists before feature/pan-1 reaches origin, so it has no
    // refs/remotes/origin/feature/pan-1 — the handoff-worktree case.
    git(tempDir, 'clone', origin, cloneB);
    configureIdentity(cloneB);

    git(cloneA, 'checkout', '-b', 'feature/pan-1');
    writeFileSync(join(cloneA, 'feature.txt'), 'feature\n');
    git(cloneA, 'add', 'feature.txt');
    git(cloneA, 'commit', '-m', 'feature work');
    git(cloneA, 'push', 'origin', 'feature/pan-1');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('checks out an unfetched remote feature branch at its origin SHA instead of re-cutting it from main', async () => {
    const featureSha = git(cloneA, 'rev-parse', 'feature/pan-1');
    const mainSha = git(cloneA, 'rev-parse', 'main');
    expect(featureSha).not.toBe(mainSha);
    const ws = join(tempDir, 'ws');

    const result = await createWorktree(cloneB, ws, 'feature/pan-1', 'main');

    expect(result).toEqual({ success: true, message: `Created worktree at ${ws}` });
    expect(git(ws, 'rev-parse', 'HEAD')).toBe(featureSha);
  });

  it('cuts a branch absent on origin from origin/main and swallows the failed fetch', async () => {
    const mainSha = git(cloneA, 'rev-parse', 'main');
    const ws = join(tempDir, 'ws-new');

    const result = await createWorktree(cloneB, ws, 'feature/pan-2', 'main');

    expect(result).toEqual({ success: true, message: `Created worktree at ${ws}` });
    expect(git(ws, 'rev-parse', 'HEAD')).toBe(mainSha);
    expect(git(ws, 'branch', '--show-current')).toBe('feature/pan-2');
  });
});
