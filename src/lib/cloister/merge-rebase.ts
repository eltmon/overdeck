/**
 * In-Process Rebase (PAN-632)
 *
 * Replaces spawnRebaseAgentForBranch with direct git operations via execAsync.
 * No specialist, no polling, no tmux session — just git commands.
 *
 * PAN-1249: Additive Effect variant `rebaseFeatureBranchProgram` exposed for
 * Effect-typed callers. The Promise-based `rebaseFeatureBranch` retains its
 * legacy "result-object on success-or-failure" contract used by existing
 * cloister merge plumbing.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { join } from 'path';
import { Effect } from 'effect';
import { GitError, MergeConflictError } from '../errors.js';

const execAsync = promisify(exec);

export interface RebaseResult {
  success: boolean;
  skipped?: boolean;
  conflictFiles?: string[];
  reason?: string;
  newHead?: string;
}async function rebaseFeatureBranchPromise(
  workspacePath: string,
  featureBranch: string,
  baseBranch: string,
  issueId: string,
): Promise<RebaseResult> {
  const execOpts = { cwd: workspacePath, encoding: 'utf-8' as const, timeout: 120_000 };
  const logPrefix = `[merge-rebase] ${issueId}`;

  try {
    // Pre-flight: clean up stale git locks
    const lockFile = join(workspacePath, '.git', 'index.lock');
    if (existsSync(lockFile)) {
      try {
        const { unlinkSync } = await import('fs');
        unlinkSync(lockFile);
        console.log(`${logPrefix} Removed stale git index.lock`);
      } catch { /* non-fatal */ }
    }

    // Step 1: Fetch latest base branch
    console.log(`${logPrefix} Fetching origin/${baseBranch}...`);
    await execAsync(`git fetch origin ${baseBranch}`, execOpts);

    // Step 2: Check if rebase is needed
    const { stdout: behindCount } = await execAsync(
      `git rev-list --count HEAD..origin/${baseBranch}`,
      execOpts,
    );
    const behind = parseInt(behindCount.trim(), 10);

    if (behind === 0) {
      console.log(`${logPrefix} Already up-to-date with origin/${baseBranch}`);
      // Push any cleanup commit we just made.
      try {
        await execAsync(
          `git push --force-with-lease origin HEAD:${featureBranch}`,
          execOpts,
        );
      } catch { /* up-to-date push is non-fatal */ }
      const { stdout: currentHead } = await execAsync('git rev-parse HEAD', execOpts);
      return { success: true, skipped: true, newHead: currentHead.trim() };
    }

    console.log(`${logPrefix} ${behind} commits behind origin/${baseBranch}, rebasing...`);

    // Step 4: Rebase onto base branch
    try {
      await execAsync(`git rebase origin/${baseBranch}`, execOpts);
      console.log(`${logPrefix} Rebase successful`);
    } catch (rebaseErr: any) {
      // Rebase failed — likely conflicts
      console.log(`${logPrefix} Rebase failed, checking for conflicts...`);

      // Get conflict files
      let conflictFiles: string[] = [];
      try {
        const { stdout: conflictOutput } = await execAsync(
          'git diff --name-only --diff-filter=U 2>/dev/null || true',
          execOpts,
        );
        conflictFiles = conflictOutput.trim().split('\n').filter(Boolean);
      } catch { /* ignore */ }

      // Abort the rebase
      try {
        await execAsync('git rebase --abort', execOpts);
        console.log(`${logPrefix} Rebase aborted`);
      } catch {
        // May not be in rebase state
      }

      const reason = conflictFiles.length > 0
        ? `Rebase conflicts in: ${conflictFiles.join(', ')}`
        : `Rebase failed: ${rebaseErr.message?.slice(0, 200) || 'unknown error'}`;

      return { success: false, conflictFiles, reason };
    }

    // Step 5: Push with --force-with-lease
    console.log(`${logPrefix} Pushing rebased branch...`);
    await execAsync(
      `git push --force-with-lease origin HEAD:${featureBranch}`,
      execOpts,
    );

    // Get new HEAD
    const { stdout: newHead } = await execAsync('git rev-parse HEAD', execOpts);
    console.log(`${logPrefix} Rebase complete, new HEAD: ${newHead.trim().slice(0, 8)}`);

    return { success: true, newHead: newHead.trim() };
  } catch (err: any) {
    const reason = `Rebase error: ${err.message?.slice(0, 300) || 'unknown'}`;
    console.error(`${logPrefix} ${reason}`);
    return { success: false, reason };
  }
}

/**
 * Effect-typed variant of {@link rebaseFeatureBranch} (PAN-1249).
 *
 * Returns a typed error channel:
 * - `MergeConflictError` when rebase produced conflicts (which are then aborted)
 * - `GitError` for any other git failure (fetch / rev-list / push)
 *
 * On success resolves to the same `RebaseResult` shape.
 */
export function rebaseFeatureBranch(
  workspacePath: string,
  featureBranch: string,
  baseBranch: string,
  issueId: string,
): Effect.Effect<RebaseResult, GitError | MergeConflictError> {
  const wrapped: Effect.Effect<RebaseResult, GitError> = Effect.tryPromise({
    try: () => rebaseFeatureBranchPromise(workspacePath, featureBranch, baseBranch, issueId),
    catch: (cause) =>
      new GitError({
        command: ['git', 'rebase', baseBranch],
        stderr: cause instanceof Error ? cause.message : String(cause),
        exitCode: -1,
        cause,
      }),
  });
  return Effect.flatMap(wrapped, (result): Effect.Effect<RebaseResult, GitError | MergeConflictError> => {
    if (result.success) return Effect.succeed(result);
    if (result.conflictFiles && result.conflictFiles.length > 0) {
      return Effect.fail(
        new MergeConflictError({
          branch: featureBranch,
          targetBranch: baseBranch,
          conflictedFiles: result.conflictFiles,
        }),
      );
    }
    return Effect.fail(
      new GitError({
        command: ['git', 'rebase', baseBranch],
        stderr: result.reason ?? 'rebase failed',
        exitCode: 1,
      }),
    );
  });
}
