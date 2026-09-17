import { describe, expect, it, beforeEach, afterEach } from 'vitest';
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
