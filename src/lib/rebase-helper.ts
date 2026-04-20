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

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { MergeSet } from './merge-set.js';

const execFileAsync = promisify(execFile);

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.trim() : String(error).trim();
}

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
    await execFileAsync('git', ['fetch', 'origin', targetBranch], {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 60000,
    });
  } catch (err: unknown) {
    return { repoKey, outcome: 'error', message: `Failed to fetch origin/${targetBranch}: ${getErrorMessage(err)}` };
  }

  // Is the branch already rebased onto target?
  let alreadyRebased = false;
  try {
    const remoteTarget = `origin/${targetBranch}`;
    const { stdout: mergeBase } = await execFileAsync(
      'git',
      ['merge-base', 'HEAD', remoteTarget],
      { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }
    );
    const { stdout: targetHead } = await execFileAsync(
      'git',
      ['rev-parse', remoteTarget],
      { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }
    );
    alreadyRebased = mergeBase.trim() === targetHead.trim();
  } catch {
    // If the check fails we just run the rebase.
  }

  if (!alreadyRebased) {
    try {
      await execFileAsync('git', ['rebase', `origin/${targetBranch}`], {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: 120000,
        env: { ...process.env, GIT_EDITOR: 'true' },
      });
    } catch (rebaseErr: unknown) {
      let lastError = rebaseErr;
      let recovered = false;

      for (let attempts = 0; attempts < 20; attempts++) {
        const resolution = await tryResolvePlanningConflicts(repoPath);
        const rebaseInProgress = await isRebaseInProgress(repoPath);

        if (!resolution.shouldRetry && resolution.remainingConflicts.length === 0 && !rebaseInProgress) {
          if (attempts > 0) {
            recovered = true;
            break;
          }
          return {
            repoKey,
            outcome: 'error',
            message: `Rebase failed: ${getErrorMessage(lastError)}`,
          };
        }

        if (resolution.shouldRetry) {
          try {
            await execFileAsync('git', ['rebase', '--continue'], {
              cwd: repoPath,
              encoding: 'utf-8',
              timeout: 60000,
              env: { ...process.env, GIT_EDITOR: 'true' },
            });

            if (await isRebaseInProgress(repoPath)) {
              continue;
            }

            recovered = true;
            break;
          } catch (continueErr: unknown) {
            lastError = continueErr;
            continue;
          }
        }

        if (!rebaseInProgress) {
          return {
            repoKey,
            outcome: 'error',
            message: `Rebase failed: ${getErrorMessage(lastError)}`,
          };
        }

        await execFileAsync('git', ['rebase', '--abort'], { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }).catch(() => {});
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
          message: `Rebase failed: ${getErrorMessage(lastError)}`,
        };
      }

      if (!recovered) {
        await execFileAsync('git', ['rebase', '--abort'], { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }).catch(() => {});
        return {
          repoKey,
          outcome: 'error',
          message: `Rebase failed after 20 auto-resolution attempts: ${getErrorMessage(lastError)}`,
        };
      }
    }
  }

  // Push — always, even if already rebased. The agent may have new local commits
  // that were never pushed.
  try {
    await execFileAsync(
      'git',
      ['push', '--force-with-lease', 'origin', `HEAD:refs/heads/${sourceBranch}`],
      { cwd: repoPath, encoding: 'utf-8', timeout: 60000 }
    );
  } catch (err: unknown) {
    return { repoKey, outcome: 'error', message: `Push failed: ${getErrorMessage(err)}` };
  }

  return { repoKey, outcome: alreadyRebased ? 'already-current' : 'rebased' };
}

/**
 * Auto-resolve rebase conflicts if they are limited to `.planning/*` files.
 * Uses `--theirs` so the rebased local branch wins. During a rebase, "ours"
 * is the target branch state and "theirs" is the commit being replayed.
 */
async function isRebaseInProgress(repoPath: string): Promise<boolean> {
  try {
    const { stdout: gitDirOutput } = await execFileAsync('git', ['rev-parse', '--git-dir'], {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 10000,
    });

    const gitDir = gitDirOutput.trim();
    const resolvedGitDir = isAbsolute(gitDir) ? gitDir : join(repoPath, gitDir);
    return existsSync(join(resolvedGitDir, 'rebase-merge')) || existsSync(join(resolvedGitDir, 'rebase-apply'));
  } catch {
    return false;
  }
}

async function tryResolvePlanningConflicts(
  repoPath: string
): Promise<{ shouldRetry: boolean; remainingConflicts: string[] }> {
  try {
    const { stdout } = await execFileAsync('git', ['diff', '--name-only', '--diff-filter=U', '-z'], {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });

    const conflictFiles = stdout
      .split('\0')
      .filter(Boolean);

    if (conflictFiles.length === 0) {
      return { shouldRetry: false, remainingConflicts: [] };
    }

    const unsafeConflicts = conflictFiles.filter(file => file.split('/').includes('..'));
    if (unsafeConflicts.length > 0) {
      return { shouldRetry: false, remainingConflicts: unsafeConflicts };
    }

    const nonPlanningConflicts = conflictFiles.filter(f => !f.startsWith('.planning/'));
    if (nonPlanningConflicts.length > 0) {
      return { shouldRetry: false, remainingConflicts: nonPlanningConflicts };
    }

    for (const file of conflictFiles) {
      await execFileAsync('git', ['checkout', '--theirs', '--', file], {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: 10000,
      });
      await execFileAsync('git', ['add', '-A', '--', file], {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: 10000,
      });
    }

    return { shouldRetry: true, remainingConflicts: [] };
  } catch {
    return { shouldRetry: false, remainingConflicts: ['(error checking rebase status)'] };
  }
}
