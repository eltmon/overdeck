/**
 * PAN-4849 WI-21: the review-cycle loader reads fix-batch commits from the
 * branch with one async `git log`, and turns a failing loader into an error
 * entry instead of throwing.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { defaultDeftReviewCycleLoadDeps, listFixBatchCommits, loadDeftReviewCycle } from '../review-cycle-load.js';

const scratch = mkdtempSync(join(tmpdir(), 'deft-review-load-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function repoWithBranch(): string {
  const repo = mkdtempSync(join(scratch, 'repo-'));
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 'T');
  git(repo, 'config', 'commit.gpgsign', 'false');
  const commit = (subject: string) => {
    writeFileSync(join(repo, 'f.txt'), subject);
    git(repo, 'add', 'f.txt');
    git(repo, 'commit', '-q', '--no-verify', '-m', subject);
  };
  commit('fix: address Greptile review findings (on main, not in range)');
  git(repo, 'checkout', '-q', '-b', 'feature/pan-1');
  commit('feat: the change');
  commit('fix: address Greptile review findings (batch)');
  commit('fix: address Greptile review findings (batch 2)');
  return repo;
}

describe('listFixBatchCommits', () => {
  it('lists only fix-batch commits since the base branch, oldest first', async () => {
    const commits = await listFixBatchCommits(repoWithBranch());
    expect(commits.map(commit => commit.subject)).toEqual([
      'fix: address Greptile review findings (batch)',
      'fix: address Greptile review findings (batch 2)',
    ]);
    expect(commits[0]!.sha).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('loadDeftReviewCycle', () => {
  it('turns a failing git log into an error entry', async () => {
    const cycle = await loadDeftReviewCycle('PAN-1', {
      ...defaultDeftReviewCycleLoadDeps,
      workspacePath: () => join(scratch, 'missing'),
      pullRequest: async () => null,
      checkRuns: async () => [],
      discussions: async () => [],
      fixCommits: async () => {
        throw new Error('not a git repository');
      },
      readState: async () => {
        throw new Error('unreadable');
      },
      now: () => 0,
    });
    expect(cycle.errors).toEqual(['git log failed: not a git repository', 'deft state failed: unreadable']);
    expect(cycle).toMatchObject({ verdict: 'NO_REVIEWER_INSTALLED', prNumber: null, headSha: null });
  });
});
