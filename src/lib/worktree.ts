import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { Effect, Stream } from 'effect';
import { ChildProcess } from 'effect/unstable/process';
import { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner';
import { FsError, GitError } from './errors.js';

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
  prunable: boolean;
}

function gitRun(
  args: ReadonlyArray<string>,
  cwd: string,
): Effect.Effect<string, GitError, ChildProcessSpawner> {
  return Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner;
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* spawner
          .spawn(ChildProcess.make('git', args, { cwd, stderr: 'ignore' }))
          .pipe(
            Effect.mapError(
              (e) => new GitError({ command: ['git', ...args], stderr: '', exitCode: -1, cause: e }),
            ),
          );
        const text = yield* Stream.runCollect(Stream.decodeText(handle.stdout)).pipe(
          Effect.map((lines) => lines.join('')),
          Effect.mapError(
            (e) => new GitError({ command: ['git', ...args], stderr: '', exitCode: -1, cause: e }),
          ),
        );
        const code = yield* handle.exitCode.pipe(
          Effect.mapError(
            (e) => new GitError({ command: ['git', ...args], stderr: '', exitCode: -1, cause: e }),
          ),
        );
        if (Number(code) !== 0) {
          return yield* Effect.fail(
            new GitError({ command: ['git', ...args], stderr: '', exitCode: Number(code) }),
          );
        }
        return text;
      }),
    );
  });
}

export function listWorktrees(
  repoPath: string,
): Effect.Effect<WorktreeInfo[], GitError, ChildProcessSpawner> {
  return gitRun(['worktree', 'list', '--porcelain'], repoPath).pipe(
    Effect.map((output) => {
      const worktrees: WorktreeInfo[] = [];
      let current: Partial<WorktreeInfo> = {};

      for (const line of output.split('\n')) {
        if (line.startsWith('worktree ')) {
          if (current.path) worktrees.push(current as WorktreeInfo);
          current = { path: line.slice(9), prunable: false };
        } else if (line.startsWith('HEAD ')) {
          current.head = line.slice(5);
        } else if (line.startsWith('branch ')) {
          current.branch = line.slice(7).replace('refs/heads/', '');
        } else if (line === 'prunable') {
          current.prunable = true;
        }
      }
      if (current.path) worktrees.push(current as WorktreeInfo);
      return worktrees;
    }),
  );
}

export function createWorktree(
  repoPath: string,
  targetPath: string,
  branchName: string,
): Effect.Effect<void, FsError | GitError, ChildProcessSpawner> {
  return Effect.gen(function* () {
    yield* Effect.try({
      try: () => mkdirSync(dirname(targetPath), { recursive: true }),
      catch: (cause) => new FsError({ path: dirname(targetPath), operation: 'mkdir', cause }),
    });

    const branchExists = yield* gitRun(
      ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`],
      repoPath,
    ).pipe(
      Effect.map(() => true),
      Effect.catchTag('GitError', () => Effect.succeed(false)),
    );

    if (branchExists) {
      yield* gitRun(['worktree', 'add', targetPath, branchName], repoPath);
    } else {
      yield* gitRun(['worktree', 'add', '-b', branchName, targetPath], repoPath);
    }

    yield* gitRun(['config', 'beads.role', 'contributor'], targetPath).pipe(
      Effect.catch(() => Effect.void),
    );
  });
}

export function removeWorktree(
  repoPath: string,
  worktreePath: string,
): Effect.Effect<void, GitError, ChildProcessSpawner> {
  return gitRun(['worktree', 'remove', worktreePath, '--force'], repoPath).pipe(
    Effect.asVoid,
  );
}

export function pruneWorktrees(
  repoPath: string,
): Effect.Effect<void, GitError, ChildProcessSpawner> {
  return gitRun(['worktree', 'prune'], repoPath).pipe(Effect.asVoid);
}
