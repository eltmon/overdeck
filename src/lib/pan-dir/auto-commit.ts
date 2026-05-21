/**
 * Auto-commit helper for operational state files (.pan/, .beads/).
 *
 * Background: planning and work agents continuously write to .pan/continues/,
 * .pan/specs/, .pan/drafts/, and .beads/issues.jsonl on the project root.
 * Without this helper those writes accumulate uncommitted on `main`, requiring
 * periodic manual "chore: sync workspace state" passes from the operator and
 * making the project repo stay perpetually dirty.
 *
 * This module exposes a fire-and-forget commit primitive that the pan-dir
 * writers call after they update a file. Commits are:
 *   - debounced (default 2s) so a burst of writes coalesces into one commit
 *   - serialized within a process so the git index is never contested
 *   - best-effort: failures are logged and never thrown back to the caller
 *   - main-only: feature branches have their own commit cadence owned by agents
 *
 * Cross-machine concern: when an agent's state is canonical on `main`, moving
 * the agent between machines becomes "stop on A, pull on B, resume on B." The
 * sync-state-via-commit shape this helper produces is the substrate for that.
 */

import { existsSync } from 'fs';
import { dirname, join, sep } from 'path';
import { Effect, Layer, Stream } from 'effect';
import { ChildProcess } from 'effect/unstable/process';
import * as NodeChildProcessSpawner from '@effect/platform-node/NodeChildProcessSpawner';
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem';
import * as NodePath from '@effect/platform-node/NodePath';
import { GitError } from '../errors.js';

const spawnerLayer = NodeChildProcessSpawner.layer.pipe(
  Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))
);

const DEBOUNCE_MS = 2_000;

interface QueuedCommit {
  paths: Set<string>;
  subjects: string[];
  timer: NodeJS.Timeout;
}

export interface FlushResult {
  committed: boolean;
  reason?: string;
}

const pending = new Map<string, QueuedCommit>();
let serializer: Promise<unknown> = Promise.resolve();

interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Run a git subcommand. Fails with GitError on non-zero exit. */
function runGit(
  args: readonly string[],
  cwd: string,
): Effect.Effect<GitResult, GitError> {
  return Effect.gen(function* () {
    const handle = yield* ChildProcess.make('git', [...args], { cwd });
    const stdoutBuf = yield* Stream.runFold(
      handle.stdout,
      () => Buffer.alloc(0),
      (acc, chunk) => Buffer.concat([acc, Buffer.from(chunk)]),
    );
    const stderrBuf = yield* Stream.runFold(
      handle.stderr,
      () => Buffer.alloc(0),
      (acc, chunk) => Buffer.concat([acc, Buffer.from(chunk)]),
    );
    const exitCode = yield* handle.exitCode;
    if (exitCode !== 0) {
      return yield* Effect.fail(
        new GitError({
          command: ['git', ...args],
          stderr: stderrBuf.toString('utf-8'),
          exitCode,
        }),
      );
    }
    return {
      stdout: stdoutBuf.toString('utf-8'),
      stderr: stderrBuf.toString('utf-8'),
      exitCode,
    };
  }).pipe(
    Effect.scoped,
    Effect.provide(spawnerLayer),
    Effect.catchCause((cause) =>
      Effect.fail(
        new GitError({
          command: ['git', ...args],
          stderr: String(cause),
          exitCode: -1,
          cause,
        }),
      ),
    ),
  );
}

/**
 * Queue an auto-commit for one or more files. Returns immediately; the actual
 * git commit happens after the debounce window. Multiple calls for the same
 * project root inside the window coalesce.
 */
export function queueAutoCommit(opts: {
  projectRoot: string;
  paths: string[];
  subject: string;
}): void {
  const { projectRoot, paths, subject } = opts;
  if (paths.length === 0) return;

  const existing = pending.get(projectRoot);
  if (existing) {
    paths.forEach((p) => existing.paths.add(p));
    existing.subjects.push(subject);
    clearTimeout(existing.timer);
    existing.timer = setTimeout(() => void flushInner(projectRoot), DEBOUNCE_MS);
    return;
  }
  pending.set(projectRoot, {
    paths: new Set(paths),
    subjects: [subject],
    timer: setTimeout(() => void flushInner(projectRoot), DEBOUNCE_MS),
  });
}

/**
 * Force a flush of any pending commits for `projectRoot`. Returns an Effect that
 * resolves after the commit attempt (success or no-op).
 */
export function flushAutoCommits(
  projectRoot: string,
): Effect.Effect<FlushResult, never> {
  return Effect.promise(() => flushPromise(projectRoot));
}

function flushPromise(projectRoot: string): Promise<FlushResult> {
  const batch = pending.get(projectRoot);
  if (!batch) return Promise.resolve({ committed: false, reason: 'no pending' });
  clearTimeout(batch.timer);
  return flushInner(projectRoot);
}

function flushInner(projectRoot: string): Promise<FlushResult> {
  const batch = pending.get(projectRoot);
  if (!batch) return Promise.resolve({ committed: false, reason: 'no pending' });
  pending.delete(projectRoot);

  const task = serializer.then(() => Effect.runPromise(doCommit(projectRoot, batch)));
  serializer = task.catch(() => undefined);
  return task;
}

function doCommit(
  projectRoot: string,
  batch: QueuedCommit,
): Effect.Effect<FlushResult, never> {
  return Effect.gen(function* () {
    if (!existsSync(join(projectRoot, '.git'))) {
      return { committed: false, reason: 'not a git repo' };
    }

    // Check current branch.
    const branchResult: FlushResult | string = yield* runGit(
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      projectRoot,
    ).pipe(
      Effect.matchEffect({
        onSuccess: (r) => Effect.succeed(r.stdout.trim()),
        onFailure: (err) =>
          Effect.succeed({
            committed: false as const,
            reason: `branch check failed: ${err.stderr || err._tag}`,
          } satisfies FlushResult),
      }),
    );
    if (typeof branchResult !== 'string') return branchResult;

    if (branchResult !== 'main') {
      return { committed: false, reason: `not on main (${branchResult})` };
    }

    const branch = branchResult;
    const paths = Array.from(batch.paths);
    const relativePaths = paths.map((p) => relativizeToRoot(p, projectRoot));

    // git add
    const addOk: boolean | FlushResult = yield* runGit(
      ['add', '--', ...relativePaths],
      projectRoot,
    ).pipe(
      Effect.matchEffect({
        onSuccess: () => Effect.succeed(true as const),
        onFailure: (err) => {
          console.warn(`[pan-dir/auto-commit] failed for ${branch}: ${err.stderr || err._tag}`);
          return Effect.succeed({
            committed: false as const,
            reason: err.stderr || err._tag,
          } satisfies FlushResult);
        },
      }),
    );
    if (typeof addOk !== 'boolean') return addOk;

    // git diff --cached --quiet exits 0 if NO diff, 1 if diff present.
    // So a successful run means "no diff" — bail out.
    const noDiff: boolean = yield* runGit(
      ['diff', '--cached', '--quiet', '--', ...relativePaths],
      projectRoot,
    ).pipe(
      Effect.matchEffect({
        onSuccess: () => Effect.succeed(true),
        onFailure: () => Effect.succeed(false),
      }),
    );
    if (noDiff) {
      return { committed: false, reason: 'no diff' };
    }

    const subject =
      batch.subjects.length === 1
        ? batch.subjects[0]
        : `chore(state): batch update ${relativePaths.length} pan/beads file(s)`;

    const commitOk: boolean | FlushResult = yield* runGit(
      ['commit', '-m', subject, '--', ...relativePaths],
      projectRoot,
    ).pipe(
      Effect.matchEffect({
        onSuccess: () => Effect.succeed(true as const),
        onFailure: (err) => {
          console.warn(`[pan-dir/auto-commit] failed for ${branch}: ${err.stderr || err._tag}`);
          return Effect.succeed({
            committed: false as const,
            reason: err.stderr || err._tag,
          } satisfies FlushResult);
        },
      }),
    );
    if (typeof commitOk !== 'boolean') return commitOk;

    return { committed: true };
  });
}

/**
 * Find the project root for a `.pan/` or `.beads/` file path. Returns null
 * when the path is not under either marker.
 */
export function deriveProjectRoot(path: string): string | null {
  for (const marker of [`${sep}.pan${sep}`, `${sep}.beads${sep}`]) {
    const idx = path.indexOf(marker);
    if (idx !== -1) return path.slice(0, idx);
  }
  // Edge case: the path is the .pan/.beads directory itself.
  const base = dirname(path);
  if (base.endsWith(`${sep}.pan`) || base.endsWith(`${sep}.beads`)) {
    return dirname(base);
  }
  return null;
}

function relativizeToRoot(absOrRel: string, projectRoot: string): string {
  const rootPrefix = projectRoot.endsWith(sep) ? projectRoot : projectRoot + sep;
  if (absOrRel.startsWith(rootPrefix)) return absOrRel.slice(rootPrefix.length);
  return absOrRel;
}
