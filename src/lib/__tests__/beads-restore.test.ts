import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { execSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('../tasks/export.js', () => ({
  exportTasksJsonl: async (root: string) => {
    mkdirSync(join(root, '.tasks'), { recursive: true });
    writeFileSync(join(root, '.tasks', 'issues.jsonl'), '{"id":"x"}\n');
  },
}));
import { restoreTrackedTasksExport } from '../tasks-restore.js';

describe('restoreTrackedTasksExport', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'tasks-restore-test-'));
    execSync('git init -q', { cwd: workspace });
    execSync('git config user.email test@test', { cwd: workspace });
    execSync('git config user.name test', { cwd: workspace });
    mkdirSync(join(workspace, '.tasks'), { recursive: true });
    writeFileSync(join(workspace, '.tasks', 'issues.jsonl'), '{"id":"x"}\n');
    execSync('git add .tasks/issues.jsonl', { cwd: workspace });
    execSync('git commit -q -m init', { cwd: workspace });
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('restores the tracked export when it has been deleted on disk', async () => {
    unlinkSync(join(workspace, '.tasks', 'issues.jsonl'));
    expect(existsSync(join(workspace, '.tasks', 'issues.jsonl'))).toBe(false);

    await Effect.runPromise(restoreTrackedTasksExport(workspace));

    expect(existsSync(join(workspace, '.tasks', 'issues.jsonl'))).toBe(true);
  });

  it('restores the tracked export when the deletion has already been staged', async () => {
    // `git rm` removes the file from both worktree AND index. `git restore --` alone
    // is a no-op in this state because the index has no entry to restore from — we
    // need `git restore --source=HEAD --staged --worktree` to recover from HEAD.
    execSync('git rm -q .tasks/issues.jsonl', { cwd: workspace });
    const before = execSync('git status --porcelain', { cwd: workspace, encoding: 'utf-8' });
    expect(before).toMatch(/^D\s+\.tasks\/issues\.jsonl/m);
    expect(existsSync(join(workspace, '.tasks', 'issues.jsonl'))).toBe(false);

    await Effect.runPromise(restoreTrackedTasksExport(workspace));

    expect(existsSync(join(workspace, '.tasks', 'issues.jsonl'))).toBe(true);
  });

  it('is a no-op when the export is present and clean', async () => {
    const before = execSync('git status --porcelain', { cwd: workspace, encoding: 'utf-8' });
    expect(before).toBe('');

    await Effect.runPromise(restoreTrackedTasksExport(workspace));

    const after = execSync('git status --porcelain', { cwd: workspace, encoding: 'utf-8' });
    expect(after).toBe('');
  });

  it('is a no-op when the export was modified but not deleted', async () => {
    writeFileSync(join(workspace, '.tasks', 'issues.jsonl'), '{"id":"y"}\n');

    await Effect.runPromise(restoreTrackedTasksExport(workspace));

    // A derived export is regenerated from canonical state rather than preserved.
    const content = execSync('cat .tasks/issues.jsonl', { cwd: workspace, encoding: 'utf-8' });
    expect(content).toBe('{"id":"x"}\n');
  });

  it('does not throw on a non-git directory', async () => {
    const notGit = mkdtempSync(join(tmpdir(), 'not-a-git-'));
    try {
      await expect(Effect.runPromise(restoreTrackedTasksExport(notGit))).resolves.toBeUndefined();
    } finally {
      rmSync(notGit, { recursive: true, force: true });
    }
  });
});
