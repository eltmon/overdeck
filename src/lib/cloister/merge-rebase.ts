/**
 * In-Process Rebase (PAN-632)
 *
 * Replaces spawnRebaseAgentForBranch with direct git operations via Effect.
 * No specialist, no polling, no tmux session — just git commands.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { Effect, FileSystem } from 'effect';
import { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner';
import { ChildProcess } from 'effect/unstable/process';
import { layer as NodeServicesLayer } from '@effect/platform-node/NodeServices';
import { GitError, MergeConflictError } from '../errors.js';

export interface RebaseResult {
  newHead: string;
  skipped?: boolean;
}

const runGit = (args: readonly string[], cwd: string): Effect.Effect<string, GitError> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner;
    const cmd = ChildProcess.make('git', args, { cwd });
    return yield* spawner.string(cmd).pipe(
      Effect.mapError(
        (cause) =>
          new GitError({
            command: ['git', ...args],
            stderr: cause instanceof Error ? cause.message : String(cause),
            exitCode: -1,
            cause,
          }),
      ),
    );
  }).pipe(Effect.provide(NodeServicesLayer));

const removeLockFile = (path: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.remove(path).pipe(Effect.orElseSucceed(() => undefined));
  }).pipe(Effect.provide(NodeServicesLayer));

/**
 * On rebase conflict: collect conflict files, abort, and fail with MergeConflictError.
 * Used as the catchTag handler for the rebase step.
 */
const onRebaseFailure = (
  workspacePath: string,
  featureBranch: string,
  baseBranch: string,
  logPrefix: string,
): Effect.Effect<never, MergeConflictError> =>
  runGit(['diff', '--name-only', '--diff-filter=U'], workspacePath).pipe(
    Effect.orElseSucceed(() => ''),
    Effect.flatMap((conflictOutput) => {
      const conflictFiles = conflictOutput.trim().split('\n').filter(Boolean);
      return runGit(['rebase', '--abort'], workspacePath).pipe(
        Effect.orElseSucceed(() => ''),
        Effect.flatMap(() => {
          console.log(
            `${logPrefix} Rebase failed, conflicts: ${conflictFiles.join(', ') || 'none detected'}`,
          );
          return Effect.fail(
            new MergeConflictError({
              branch: featureBranch,
              targetBranch: baseBranch,
              conflictedFiles: conflictFiles,
            }),
          );
        }),
      );
    }),
  );

/**
 * Rebase a feature branch onto a base branch in-process.
 * Returns immediately with a typed result — no specialist, no polling.
 *
 * Steps:
 * 1. Fetch latest base branch
 * 2. Check if rebase is needed (commits behind)
 * 3. Rebase onto base branch
 * 4. Push with --force-with-lease
 *
 * On conflict: aborts rebase and fails with MergeConflictError.
 */
export function rebaseFeatureBranch(
  workspacePath: string,
  featureBranch: string,
  baseBranch: string,
  issueId: string,
): Effect.Effect<RebaseResult, GitError | MergeConflictError> {
  const logPrefix = `[merge-rebase] ${issueId}`;

  return Effect.gen(function* () {
    // Pre-flight: clean up stale git locks
    const lockFile = join(workspacePath, '.git', 'index.lock');
    if (existsSync(lockFile)) {
      yield* removeLockFile(lockFile);
      console.log(`${logPrefix} Removed stale git index.lock`);
    }

    // Step 1: Fetch latest base branch
    console.log(`${logPrefix} Fetching origin/${baseBranch}...`);
    yield* runGit(['fetch', 'origin', baseBranch], workspacePath);

    // Step 2: Check if rebase is needed
    const behindOutput = yield* runGit(
      ['rev-list', '--count', `HEAD..origin/${baseBranch}`],
      workspacePath,
    );
    const behind = parseInt(behindOutput.trim(), 10);

    if (behind === 0) {
      console.log(`${logPrefix} Already up-to-date with origin/${baseBranch}`);
      // Push any cleanup commit we just made (non-fatal).
      yield* runGit(
        ['push', '--force-with-lease', 'origin', `HEAD:${featureBranch}`],
        workspacePath,
      ).pipe(Effect.orElseSucceed(() => ''));
      const currentHead = yield* runGit(['rev-parse', 'HEAD'], workspacePath);
      return { newHead: currentHead.trim(), skipped: true };
    }

    console.log(`${logPrefix} ${behind} commits behind origin/${baseBranch}, rebasing...`);

    // Step 3: Rebase — on GitError, collect conflict files, abort, fail with MergeConflictError
    yield* runGit(['rebase', `origin/${baseBranch}`], workspacePath).pipe(
      Effect.asVoid,
      Effect.catchTag('GitError', () =>
        onRebaseFailure(workspacePath, featureBranch, baseBranch, logPrefix),
      ),
    );

    console.log(`${logPrefix} Rebase successful`);

    // Step 4: Push with --force-with-lease
    console.log(`${logPrefix} Pushing rebased branch...`);
    yield* runGit(
      ['push', '--force-with-lease', 'origin', `HEAD:${featureBranch}`],
      workspacePath,
    );

    const newHead = yield* runGit(['rev-parse', 'HEAD'], workspacePath);
    console.log(`${logPrefix} Rebase complete, new HEAD: ${newHead.trim().slice(0, 8)}`);

    return { newHead: newHead.trim() };
  });
}
