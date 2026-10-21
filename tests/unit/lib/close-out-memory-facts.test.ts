/**
 * PAN-3957 W14/D17: `.overdeck/memory/` is committed work product, not a
 * pipeline artifact — a branch whose only unmerged diff is a curated fact
 * must not be reaped as "already merged".
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/github-quota/run-gh.js', () => ({ runGh: async () => ({ stdout: '[]' }) }));

import { isBranchMerged, resetCloseOutCacheForTests } from '../../../src/lib/close-out.js';

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function writeFact(root: string, id: string, description: string): void {
  const dir = join(root, '.overdeck', 'memory');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.md`), `---\ntype: feedback\ndescription: ${description}\n---\nBody.\n`);
}

describe('close-out curated-memory carve-out (PAN-3957 W14/D17)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-close-out-memory-facts-'));
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 'test@overdeck.local');
    git(root, 'config', 'user.name', 'Overdeck Test');
    git(root, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(root, 'README.md'), 'base\n');
    git(root, 'add', 'README.md');
    git(root, 'commit', '-q', '-m', 'base');
    git(root, 'branch', '-M', 'main');
    resetCloseOutCacheForTests();
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('a branch whose only change is .overdeck/memory/x.md is unmerged', async () => {
    git(root, 'switch', '-q', '-c', 'feature/pan-x');
    writeFact(root, 'x', 'x');
    git(root, 'add', '.overdeck/memory/x.md');
    git(root, 'commit', '-q', '-m', 'add fact');
    git(root, 'switch', '-q', 'main');

    const result = await isBranchMerged('feature/pan-x', root);

    expect(result.status).toBe('unmerged');
  });

  it('a branch whose only change is .overdeck/continue.json is still merged', async () => {
    git(root, 'switch', '-q', '-c', 'feature/pan-y');
    mkdirSync(join(root, '.overdeck'), { recursive: true });
    writeFileSync(join(root, '.overdeck', 'continue.json'), '{}\n');
    git(root, 'add', '.overdeck/continue.json');
    git(root, 'commit', '-q', '-m', 'runtime state');
    git(root, 'switch', '-q', 'main');

    const result = await isBranchMerged('feature/pan-y', root);

    expect(result.status).toBe('merged');
  });

  it('a squash-merged branch whose fact is on main is merged', async () => {
    git(root, 'switch', '-q', '-c', 'feature/pan-z');
    writeFact(root, 'z', 'z');
    git(root, 'add', '.overdeck/memory/z.md');
    git(root, 'commit', '-q', '-m', 'add fact');

    git(root, 'switch', '-q', 'main');
    // Simulate the squash merge: main gains the identical fact in its own commit.
    writeFact(root, 'z', 'z');
    git(root, 'add', '.overdeck/memory/z.md');
    git(root, 'commit', '-q', '-m', 'squash: add fact');

    const result = await isBranchMerged('feature/pan-z', root);

    expect(result.status).toBe('merged');
  });
});
