/**
 * Rebase-onto-target helper for `pan done`.
 *
 * Before creating review artifacts (PRs), rebase each repo in the merge set
 * onto its target branch and push. This absorbs the rebase step into
 * `pan done` so work agents don't have to orchestrate rebase → push →
 * submit as a multi-step task that they sometimes drop partway.
 *
 * Conflict handling:
 *   - `.planning/*` files: auto-resolved with `--theirs` (the rebased local
 *     branch wins; during rebase, "theirs" is the commit being replayed).
 *   - Any other conflicts: abort rebase, surface error, agent resolves manually.
 */

import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { MergeSet } from './merge-set.js';

const execAsync = promisify(exec);

export interface RebaseResult {
  repoKey: string;
  outcome: 'rebased' | 'already-current' | 'conflict' | 'error';
  message?: string;
  conflictFiles?: string[];
}

export interface RebaseAllResult {
  success: boolean;
  results: RebaseResult[];
  firstFailure?: RebaseResult;
}

/**
 * Rebase every repo in the merge set onto its target branch and push.
 */
export async function rebaseAndPushRepos(
  workspacePath: string,
  mergeSet: MergeSet
): Promise<RebaseAllResult> {
  const results: RebaseResult[] = [];

  for (const repo of mergeSet.repos) {
    const repoPath = mergeSet.workspaceType === 'polyrepo'
      ? join(workspacePath, repo.repoKey)
      : workspacePath;

    if (!existsSync(join(repoPath, '.git'))) {
      results.push({ repoKey: repo.repoKey, outcome: 'already-current', message: 'No .git directory' });
      continue;
    }

    const result = await rebaseOneRepo(repoPath, repo.sourceBranch, repo.targetBranch, repo.repoKey);
    results.push(result);

    if (result.outcome === 'conflict' || result.outcome === 'error') {
      return { success: false, results, firstFailure: result };
    }
  }

  return { success: true, results };
}

async function rebaseOneRepo(
  repoPath: string,
  sourceBranch: string,
  targetBranch: string,
  repoKey: string
): Promise<RebaseResult> {
  try {
    await execAsync(`git fetch origin ${targetBranch}`, {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 60000,
    });
  } catch (err: any) {
    return { repoKey, outcome: 'error', message: `Failed to fetch origin/${targetBranch}: ${err.message?.trim() || err.message}` };
  }

  // Is the branch already rebased onto target?
  let alreadyRebased = false;
  try {
    const { stdout: mergeBase } = await execAsync(
      `git merge-base HEAD origin/${targetBranch}`,
      { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }
    );
    const { stdout: targetHead } = await execAsync(
      `git rev-parse origin/${targetBranch}`,
      { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }
    );
    alreadyRebased = mergeBase.trim() === targetHead.trim();
  } catch {
    // If the check fails we just run the rebase.
  }

  if (!alreadyRebased) {
    try {
      await execAsync(`git rebase origin/${targetBranch}`, {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: 120000,
        env: { ...process.env, GIT_EDITOR: 'true' },
      });
    } catch (rebaseErr: any) {
      const resolution = await tryResolvePlanningConflicts(repoPath);

      if (!resolution.resolved) {
        await execAsync('git rebase --abort', { cwd: repoPath }).catch(() => {});
        if (resolution.remainingConflicts.length > 0) {
          return {
            repoKey,
            outcome: 'conflict',
            message: `Rebase conflicts in non-planning files: ${resolution.remainingConflicts.join(', ')}`,
            conflictFiles: resolution.remainingConflicts,
          };
        }
        return {
          repoKey,
          outcome: 'error',
          message: `Rebase failed: ${rebaseErr.message?.trim() || rebaseErr.message}`,
        };
      }
    }
  }

  // Push — always, even if already rebased. The agent may have new local commits
  // that were never pushed.
  try {
    await execAsync(
      `git push --force-with-lease origin HEAD:refs/heads/${sourceBranch}`,
      { cwd: repoPath, encoding: 'utf-8', timeout: 60000 }
    );
  } catch (err: any) {
    return { repoKey, outcome: 'error', message: `Push failed: ${err.message?.trim() || err.message}` };
  }

  return { repoKey, outcome: alreadyRebased ? 'already-current' : 'rebased' };
}

/**
 * Auto-resolve rebase conflicts if they are limited to `.planning/*` files.
 * Uses `--theirs` so the rebased local branch wins. During a rebase, "ours"
 * is the target branch state and "theirs" is the commit being replayed.
 */
async function tryResolvePlanningConflicts(
  repoPath: string
): Promise<{ resolved: boolean; remainingConflicts: string[] }> {
  try {
    const { stdout } = await execAsync('git status --porcelain', {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 10000,
    });

    const conflictFiles = stdout
      .split('\n')
      .filter(l => l.startsWith('UU ') || l.startsWith('AA ') || l.startsWith('DU ') || l.startsWith('UD '))
      .map(l => l.substring(3).trim());

    if (conflictFiles.length === 0) {
      return { resolved: false, remainingConflicts: [] };
    }

    const nonPlanningConflicts = conflictFiles.filter(f => !f.startsWith('.planning/'));
    if (nonPlanningConflicts.length > 0) {
      return { resolved: false, remainingConflicts: nonPlanningConflicts };
    }

    for (const file of conflictFiles) {
      await execAsync(`git checkout --theirs "${file}"`, { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
      await execAsync(`git add "${file}"`, { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
    }

    await execAsync('git rebase --continue', {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 60000,
      env: { ...process.env, GIT_EDITOR: 'true' },
    });

    return { resolved: true, remainingConflicts: [] };
  } catch {
    return { resolved: false, remainingConflicts: ['(error checking rebase status)'] };
  }
}
