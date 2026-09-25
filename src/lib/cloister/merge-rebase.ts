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
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
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
}

export interface RebaseOptions {
  /**
   * #4066 review: rebase exactly this commit, the approved head of an
   * automatic merge. The work agent's worktree must be at it, but the rebase
   * does not run there: the agent shares that worktree, so a commit it made
   * during or right after an in-place rebase would be read back as the
   * rebased head and pushed. The server rebases in its own detached worktree,
   * created at this commit under a temporary path no agent uses, pushes the
   * result from there by sha with a lease on this head, and always removes
   * it. See {@link rebaseApprovedHead}.
   */
  expectedHead?: string;
}

function sameSha(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  return x.length > 0 && y.length > 0 && (x.startsWith(y) || y.startsWith(x));
}

/**
 * #4066 review: the automatic merge's rebase of its approved head.
 *
 * The rebase, and the read of the commit it produced, happen in a detached
 * worktree the server creates at `expectedHead` under a fresh temporary
 * directory. The work agent never uses that path, so nothing it commits in
 * its own worktree, during or after the rebase, can become the pushed head.
 * The rebased commit is pushed from there by sha, with a lease on the
 * approved head, so a push that landed on the PR branch meanwhile fails it.
 *
 * The work agent's worktree is then moved to the rebased commit
 * (`git reset --keep`), because the merge's local verification runs there.
 * That happens only while it is still at the approved head and before the
 * push; a worktree that moved is refused and nothing is pushed. The temporary
 * worktree is removed whatever happens.
 */
async function rebaseApprovedHead(
  workspacePath: string,
  featureBranch: string,
  baseBranch: string,
  issueId: string,
  expectedHead: string,
): Promise<RebaseResult> {
  const logPrefix = `[merge-rebase] ${issueId}`;
  const inWorkspace = { cwd: workspacePath, encoding: 'utf-8' as const, timeout: 120_000 };
  const workspaceHead = async (): Promise<string> =>
    (await execAsync('git rev-parse HEAD', inWorkspace)).stdout.trim();

  // It is interpolated into git commands: a sha, nothing else.
  if (!/^[0-9a-f]{7,64}$/.test(expectedHead)) {
    return { success: false, reason: `the approved head ${expectedHead.slice(0, 12)} is not a commit sha` };
  }
  let tempParent: string | null = null;
  let tempWorktree: string | null = null;
  try {
    const head = await workspaceHead();
    if (!sameSha(head, expectedHead)) {
      return {
        success: false,
        reason: `worktree HEAD ${head.slice(0, 12)} is not the approved head ${expectedHead.slice(0, 12)}`,
      };
    }

    console.log(`${logPrefix} Fetching origin/${baseBranch}...`);
    await execAsync(`git fetch origin ${baseBranch}`, inWorkspace);
    const { stdout: behindCount } = await execAsync(
      `git rev-list --count ${expectedHead}..origin/${baseBranch}`,
      inWorkspace,
    );
    if (parseInt(behindCount.trim(), 10) === 0) {
      // Nothing to rebase and nothing to push: the approved head is the head.
      console.log(`${logPrefix} Already up-to-date with origin/${baseBranch}`);
      return { success: true, skipped: true, newHead: expectedHead };
    }

    tempParent = await mkdtemp(join(tmpdir(), 'overdeck-merge-rebase-'));
    const worktree = join(tempParent, 'worktree');
    await execAsync(`git worktree add --detach "${worktree}" ${expectedHead}`, inWorkspace);
    tempWorktree = worktree;
    const inTemp = { ...inWorkspace, cwd: worktree };

    console.log(`${logPrefix} Rebasing approved head ${expectedHead.slice(0, 8)} onto origin/${baseBranch} in a server worktree...`);
    try {
      await execAsync(`git rebase origin/${baseBranch}`, inTemp);
    } catch (rebaseErr: any) {
      let conflictFiles: string[] = [];
      try {
        const { stdout } = await execAsync('git diff --name-only --diff-filter=U', inTemp);
        conflictFiles = stdout.trim().split('\n').filter(Boolean);
      } catch { /* ignore */ }
      try {
        await execAsync('git rebase --abort', inTemp);
      } catch { /* the worktree is removed below either way */ }
      const reason = conflictFiles.length > 0
        ? `Rebase conflicts in: ${conflictFiles.join(', ')}`
        : `Rebase failed: ${rebaseErr.message?.slice(0, 200) || 'unknown error'}`;
      return { success: false, conflictFiles, reason };
    }
    const rebased = (await execAsync('git rev-parse HEAD', inTemp)).stdout.trim();

    // Local verification runs in the work agent's worktree: move it to the
    // rebased commit, but only from the approved head.
    const now = await workspaceHead();
    if (!sameSha(now, expectedHead)) {
      return {
        success: false,
        reason: `the worktree moved to ${now.slice(0, 12)} during the rebase of the approved head ${expectedHead.slice(0, 12)}; nothing was pushed`,
      };
    }
    await execAsync(`git reset --keep ${rebased}`, inWorkspace);

    console.log(`${logPrefix} Pushing rebased approved head ${rebased.slice(0, 8)}...`);
    await execAsync(
      `git push --force-with-lease=refs/heads/${featureBranch}:${expectedHead} origin ${rebased}:refs/heads/${featureBranch}`,
      inTemp,
    );
    return { success: true, newHead: rebased };
  } catch (err: any) {
    const reason = `Rebase error: ${err.message?.slice(0, 300) || 'unknown'}`;
    console.error(`${logPrefix} ${reason}`);
    return { success: false, reason };
  } finally {
    if (tempWorktree) {
      try {
        await execAsync(`git worktree remove --force "${tempWorktree}"`, inWorkspace);
      } catch { /* pruned below */ }
    }
    if (tempParent) {
      await rm(tempParent, { recursive: true, force: true }).catch(() => undefined);
      await execAsync('git worktree prune', inWorkspace).catch(() => undefined);
    }
  }
}

async function rebaseFeatureBranchBody(
  workspacePath: string,
  featureBranch: string,
  baseBranch: string,
  issueId: string,
  options: RebaseOptions = {},
): Promise<RebaseResult> {
  const expectedHead = options.expectedHead?.trim().toLowerCase();
  if (expectedHead) return rebaseApprovedHead(workspacePath, featureBranch, baseBranch, issueId, expectedHead);

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
  options: RebaseOptions = {},
): Effect.Effect<RebaseResult, GitError | MergeConflictError> {
  const wrapped: Effect.Effect<RebaseResult, GitError> = Effect.tryPromise({
    try: () => rebaseFeatureBranchBody(workspacePath, featureBranch, baseBranch, issueId, options),
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
