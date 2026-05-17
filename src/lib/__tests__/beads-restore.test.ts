import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { restoreTrackedBeadsExport } from '../beads-restore.js';

describe('restoreTrackedBeadsExport', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'beads-restore-test-'));
    execSync('git init -q', { cwd: workspace });
    execSync('git config user.email test@test', { cwd: workspace });
    execSync('git config user.name test', { cwd: workspace });
    mkdirSync(join(workspace, '.beads'), { recursive: true });
    writeFileSync(join(workspace, '.beads', 'issues.jsonl'), '{"id":"x"}\n');
    execSync('git add .beads/issues.jsonl', { cwd: workspace });
    execSync('git commit -q -m init', { cwd: workspace });
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('restores the tracked export when it has been deleted on disk', async () => {
    unlinkSync(join(workspace, '.beads', 'issues.jsonl'));
    expect(existsSync(join(workspace, '.beads', 'issues.jsonl'))).toBe(false);

    await restoreTrackedBeadsExport(workspace);

    expect(existsSync(join(workspace, '.beads', 'issues.jsonl'))).toBe(true);
  });

  it('is a no-op when the export is present and clean', async () => {
    const before = execSync('git status --porcelain', { cwd: workspace, encoding: 'utf-8' });
    expect(before).toBe('');

    await restoreTrackedBeadsExport(workspace);

    const after = execSync('git status --porcelain', { cwd: workspace, encoding: 'utf-8' });
    expect(after).toBe('');
  });

  it('is a no-op when the export was modified but not deleted', async () => {
    writeFileSync(join(workspace, '.beads', 'issues.jsonl'), '{"id":"y"}\n');

    await restoreTrackedBeadsExport(workspace);

    // The modified content should still be there — only deletions get reverted.
    const content = execSync('cat .beads/issues.jsonl', { cwd: workspace, encoding: 'utf-8' });
    expect(content).toBe('{"id":"y"}\n');
  });

  it('does not throw on a non-git directory', async () => {
    const notGit = mkdtempSync(join(tmpdir(), 'not-a-git-'));
    try {
      await expect(restoreTrackedBeadsExport(notGit)).resolves.toBeUndefined();
    } finally {
      rmSync(notGit, { recursive: true, force: true });
    }
  });
});
