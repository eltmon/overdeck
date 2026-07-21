import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { autoCommitWorkspaceChangesBeforeSync } from '../merge-agent.js';

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

describe('sync-main auto-commit safety', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-sync-main-autocommit-'));
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 'test@overdeck.local');
    git(root, 'config', 'user.name', 'Overdeck Test');
    git(root, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(root, 'tracked.txt'), 'base\n');
    git(root, 'add', 'tracked.txt');
    git(root, 'commit', '-q', '-m', 'base');
    git(root, 'branch', '-M', 'main');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('does not complete an unresolved merge', async () => {
    git(root, 'switch', '-q', '-c', 'side');
    writeFileSync(join(root, 'tracked.txt'), 'side\n');
    git(root, 'commit', '-qam', 'side');
    git(root, 'switch', '-q', 'main');
    writeFileSync(join(root, 'tracked.txt'), 'main\n');
    git(root, 'commit', '-qam', 'main');
    const headBeforeMerge = git(root, 'rev-parse', 'HEAD');
    expect(() => git(root, 'merge', 'side')).toThrow();

    const result = await autoCommitWorkspaceChangesBeforeSync(root);

    expect(result).toMatchObject({ success: false, committed: false });
    expect(result.reason).toContain('MERGE_HEAD');
    expect(git(root, 'rev-parse', 'HEAD')).toBe(headBeforeMerge);
    expect(git(root, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).not.toBe('');
  });

  it('rejects tracked conflict-marker content without staging or committing it', async () => {
    const headBefore = git(root, 'rev-parse', 'HEAD');
    writeFileSync(join(root, 'tracked.txt'), '<<<<<<< HEAD\nleft\n=======\nright\n>>>>>>> side\n');

    const result = await autoCommitWorkspaceChangesBeforeSync(root);

    expect(result).toMatchObject({ success: false, committed: false });
    expect(result.reason).toContain('tracked.txt');
    expect(git(root, 'rev-parse', 'HEAD')).toBe(headBefore);
    expect(git(root, 'diff', '--cached', '--name-only')).toBe('');
    expect(readFileSync(join(root, 'tracked.txt'), 'utf8')).toContain('<<<<<<< HEAD');
  });
});
