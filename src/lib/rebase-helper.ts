/**
 * Rebase-onto-target helper for `pan done`.
 *
 * Before creating review artifacts (PRs/MRs), synchronize each repo in the
 * merge set with its target branch and push only when needed. GitLab branches
 * preserve history with a merge; GitHub branches retain the rebase flow.
 * This keeps `pan done` as the single completion command.
 *
 * Conflict handling:
 *   - `.pan/*` files: auto-resolved with `--ours` (local workspace state wins
 *     since these are workspace-local artifacts, never shared in main).
 *   - Legacy `.planning/*` files are treated the same during transition.
 *   - Any other conflicts: abort rebase, surface error, agent resolves manually.
 */

import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Data, Effect } from 'effect';
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
}async function rebaseAndPushReposPromise(
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

    const result = await rebaseOneRepo(
      repoPath,
      repo.sourceBranch,
      repo.targetBranch,
      repo.repoKey,
      repo.forge === 'gitlab',
    );
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
  repoKey: string,
  preserveHistory: boolean,
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
  await execAsync(`git fetch origin ${sourceBranch}`, {
    cwd: repoPath,
    encoding: 'utf-8',
    timeout: 60000,
  }).catch(() => {});

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

  if (alreadyRebased) {
    const { stdout: localHead } = await execAsync(
      'git rev-parse HEAD',
      { cwd: repoPath, encoding: 'utf-8', timeout: 10000 },
    );
    try {
      const { stdout: remoteHead } = await execAsync(
        `git rev-parse origin/${sourceBranch}`,
        { cwd: repoPath, encoding: 'utf-8', timeout: 10000 },
      );
      if (localHead.trim() === remoteHead.trim()) {
        return { repoKey, outcome: 'already-current' };
      }
    } catch {
      // A new branch has no remote ref yet; the plain push below creates it.
    }
  }

  let rewroteHistory = false;
  if (!alreadyRebased) {
    if (preserveHistory) {
      try {
        await execAsync(`git merge --no-edit origin/${targetBranch}`, {
          cwd: repoPath,
          encoding: 'utf-8',
          timeout: 120000,
        });
      } catch (mergeErr: any) {
        const conflictFiles = await getConflictFiles(repoPath);
        if (!await tryResolvePlanningMergeConflicts(repoPath, conflictFiles)) {
          await execAsync('git merge --abort', { cwd: repoPath }).catch(() => {});
          return conflictFiles.length > 0
            ? {
                repoKey,
                outcome: 'conflict',
                message: `Merge conflicts: ${conflictFiles.join(', ')}`,
                conflictFiles,
              }
            : {
                repoKey,
                outcome: 'error',
                message: `Merge failed: ${mergeErr.message?.trim() || mergeErr.message}`,
              };
        }
      }
    } else {
      try {
        await execAsync(`git rebase origin/${targetBranch}`, {
          cwd: repoPath,
          encoding: 'utf-8',
          timeout: 120000,
          env: { ...process.env, GIT_EDITOR: 'true' },
        });
        rewroteHistory = true;
      } catch (rebaseErr: any) {
        const resolution = await tryResolvePlanningConflicts(repoPath);

        if (!resolution.resolved) {
          await execAsync('git rebase --abort', { cwd: repoPath }).catch(() => {});

          // Fallback: try merge instead of rebase for non-planning conflicts.
          // Rebasing large branches (many commits) across file conflicts is painful;
          // a single merge commit is acceptable and far safer.
          if (resolution.remainingConflicts.length > 0) {
            try {
              await execAsync(`git merge origin/${targetBranch}`, {
                cwd: repoPath,
                encoding: 'utf-8',
                timeout: 120000,
              });
            } catch (mergeErr: any) {
              await execAsync('git merge --abort', { cwd: repoPath }).catch(() => {});
              return {
                repoKey,
                outcome: 'conflict',
                message: `Merge conflicts: ${resolution.remainingConflicts.join(', ')}`,
                conflictFiles: resolution.remainingConflicts,
              };
            }
          } else {
            return {
              repoKey,
              outcome: 'error',
              message: `Rebase failed: ${rebaseErr.message?.trim() || rebaseErr.message}`,
            };
          }
        } else {
          rewroteHistory = true;
        }
      }
    }
  }

  const pushCommand = rewroteHistory
    ? `git push --force-with-lease origin HEAD:refs/heads/${sourceBranch}`
    : `git push origin HEAD:refs/heads/${sourceBranch}`;
  try {
    await execAsync(pushCommand, { cwd: repoPath, encoding: 'utf-8', timeout: 60000 });
  } catch (err: any) {
    return { repoKey, outcome: 'error', message: `Push failed: ${err.message?.trim() || err.message}` };
  }

  return { repoKey, outcome: alreadyRebased ? 'already-current' : 'rebased' };
}

async function getConflictFiles(repoPath: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync('git diff --name-only --diff-filter=U', {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 10000,
    });
    return stdout.split('\n').map(file => file.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function tryResolvePlanningMergeConflicts(repoPath: string, conflictFiles: string[]): Promise<boolean> {
  if (conflictFiles.length === 0 || conflictFiles.some(
    file => !file.startsWith('.pan/') && !file.startsWith('.planning/'),
  )) return false;

  try {
    for (const file of conflictFiles) {
      await execAsync(`git checkout --ours "${file}"`, { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
      await execAsync(`git add "${file}"`, { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
    }
    await execAsync('git commit --no-edit', { cwd: repoPath, encoding: 'utf-8', timeout: 60000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Auto-resolve rebase conflicts if they are limited to workspace-local
 * orchestration artifacts in `.pan/*` or legacy `.planning/*`.
 * Uses `--ours` (local wins) because these files should never collide with
 * upstream main in practice.
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

    const nonPlanningConflicts = conflictFiles.filter(
      f => !f.startsWith('.pan/') && !f.startsWith('.planning/'),
    );
    if (nonPlanningConflicts.length > 0) {
      return { resolved: false, remainingConflicts: nonPlanningConflicts };
    }

    for (const file of conflictFiles) {
      await execAsync(`git checkout --ours "${file}"`, { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
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

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
//
// Additive Effect-channel variant of the rebase helper. The Promise-returning
// API is preserved for existing callers; new Effect-based callers can compose
// `rebaseAndPushReposProgram` directly without round-tripping through
// `Effect.runPromise`.

/** Tagged error for rebase-helper Effect variants. */
export class RebaseError extends Data.TaggedError('RebaseError')<{
  readonly workspacePath: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Effect variant of `rebaseAndPushRepos`. Failure shape never throws — the
 *  result's `success: false` carries the failed-repo details. The Effect
 *  channel surfaces unexpected exceptions only. */
export const rebaseAndPushRepos = (
  workspacePath: string,
  mergeSet: MergeSet,
): Effect.Effect<RebaseAllResult, RebaseError> =>
  Effect.tryPromise({
    try: () => rebaseAndPushReposPromise(workspacePath, mergeSet),
    catch: (cause) =>
      new RebaseError({
        workspacePath,
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

