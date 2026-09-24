import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));

import { finishStrike, isStrikeBranchMerged } from '../strike-completion.js';

const BRANCH = 'strike/pan-1';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function configure(repo: string): void {
  git(repo, 'config', 'user.email', 'test@overdeck.local');
  git(repo, 'config', 'user.name', 'Overdeck Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.hooksPath', '/dev/null');
}

function branchExists(project: string, branch: string): boolean {
  try {
    git(project, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`);
    return true;
  } catch {
    return false;
  }
}

describe('strike completion (PAN-3981)', () => {
  let root: string;
  let project: string;
  let strikeWorktree: string;

  /** Commit a file on the strike branch, inside its worktree. */
  function commitOnStrike(file: string, content: string): void {
    writeFileSync(join(strikeWorktree, file), content);
    git(strikeWorktree, 'add', file);
    git(strikeWorktree, 'commit', '-q', '-m', `strike: ${file}`);
  }

  /** Land the strike branch on origin/main as a squash merge, the way GitHub does. */
  function squashMergeStrike(): void {
    git(project, 'merge', '--squash', '-q', BRANCH);
    git(project, 'commit', '-q', '-m', 'fix: the strike (#1)');
    git(project, 'push', '-q', 'origin', 'main');
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'strike-completion-'));
    const remote = join(root, 'origin.git');
    project = join(root, 'project');
    git(root, 'init', '--bare', '-q', remote);
    git(root, 'clone', '-q', remote, project);
    configure(project);
    writeFileSync(join(project, 'value.txt'), 'base\n');
    git(project, 'add', 'value.txt');
    git(project, 'commit', '-q', '-m', 'base');
    git(project, 'branch', '-M', 'main');
    git(project, 'push', '-q', '-u', 'origin', 'main');
    strikeWorktree = join(project, 'workspaces', 'feature-pan-1-strike');
    git(project, 'worktree', 'add', '-q', '-b', BRANCH, strikeWorktree, 'origin/main');
    commitOnStrike('fix-a.txt', 'a\n');
    commitOnStrike('fix-b.txt', 'b\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('isStrikeBranchMerged', () => {
    it('sees through a squash merge that --is-ancestor cannot', async () => {
      squashMergeStrike();
      expect(() => git(project, 'merge-base', '--is-ancestor', BRANCH, 'origin/main')).toThrow();

      const result = await isStrikeBranchMerged(project, BRANCH);
      expect(result.merged).toBe(true);
    });

    it('answers not merged for a branch that has not landed', async () => {
      expect((await isStrikeBranchMerged(project, BRANCH)).merged).toBe(false);
    });

    it('answers not merged when the branch gained a commit after its squash merge', async () => {
      squashMergeStrike();
      commitOnStrike('late.txt', 'late\n');
      expect((await isStrikeBranchMerged(project, BRANCH)).merged).toBe(false);
    });

    it('answers not merged for a missing branch', async () => {
      expect((await isStrikeBranchMerged(project, 'strike/pan-404')).merged).toBe(false);
    });
  });

  describe('finishStrike', () => {
    it('stops the agent, removes the worktree and deletes the squash-merged branch', async () => {
      squashMergeStrike();
      const stopAgent = vi.fn(async () => undefined);
      const journal = vi.fn();

      const result = await finishStrike('PAN-1', project, { source: 'webhook' }, { stopAgent, journal });

      expect(stopAgent).toHaveBeenCalledWith('strike-pan-1');
      expect(result).toMatchObject({ agentStopped: true, worktreeRemoved: true, branchDeleted: true });
      expect(existsSync(strikeWorktree)).toBe(false);
      expect(branchExists(project, BRANCH)).toBe(false);
      expect(journal).toHaveBeenCalledWith('PAN-1', expect.objectContaining({
        reason: 'landed',
        source: 'webhook',
        worktreeRemoved: true,
        branchDeleted: true,
      }));
    });

    it('keeps the branch when it holds a commit that is not on main', async () => {
      squashMergeStrike();
      commitOnStrike('late.txt', 'late\n');
      const result = await finishStrike('PAN-1', project, { source: 'webhook' }, { stopAgent: async () => undefined, journal: () => undefined });

      expect(result.worktreeRemoved).toBe(true);
      expect(result.branchDeleted).toBe(false);
      expect(branchExists(project, BRANCH)).toBe(true);
      expect(git(project, 'log', '-1', '--format=%s', BRANCH)).toBe('strike: late.txt');
    });

    it('keeps a worktree with uncommitted changes to tracked files, and its branch', async () => {
      squashMergeStrike();
      writeFileSync(join(strikeWorktree, 'fix-a.txt'), 'uncommitted edit\n');
      const result = await finishStrike('PAN-1', project, { source: 'webhook' }, { stopAgent: async () => undefined, journal: () => undefined });

      expect(result.worktreeRemoved).toBe(false);
      expect(result.branchDeleted).toBe(false);
      expect(existsSync(join(strikeWorktree, 'fix-a.txt'))).toBe(true);
      expect(branchExists(project, BRANCH)).toBe(true);
    });

    it('is idempotent: a duplicate delivery joins the run in flight, and a repeat finds nothing to do', async () => {
      squashMergeStrike();
      const stopAgent = vi.fn(async () => undefined);
      const deps = { stopAgent, journal: () => undefined };

      const [first, second] = await Promise.all([
        finishStrike('PAN-1', project, { source: 'webhook' }, deps),
        finishStrike('PAN-1', project, { source: 'webhook' }, deps),
      ]);
      expect(second).toBe(first);
      expect(stopAgent).toHaveBeenCalledTimes(1);

      const again = await finishStrike('PAN-1', project, { source: 'webhook' }, deps);
      expect(again).toMatchObject({ worktreeRemoved: false, branchDeleted: false });
      expect(again.notes).toEqual([]);
    });

    it('still cleans the worktree and branch when stopping the agent fails', async () => {
      squashMergeStrike();
      const result = await finishStrike('PAN-1', project, { source: 'webhook' }, {
        stopAgent: async () => { throw new Error('herdr down'); },
        journal: () => undefined,
      });
      expect(result.agentStopped).toBe(false);
      expect(result.worktreeRemoved).toBe(true);
      expect(result.branchDeleted).toBe(true);
    });
  });
});
