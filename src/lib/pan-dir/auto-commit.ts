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
 *   - fixed-window coalesced (default 10m) so a burst of writes becomes one commit
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
import { Cause, Duration, Effect, Layer, Stream } from 'effect';
import { ChildProcess } from 'effect/unstable/process';
import * as NodeChildProcessSpawner from '@effect/platform-node/NodeChildProcessSpawner';
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem';
import * as NodePath from '@effect/platform-node/NodePath';
import { GitError } from '../errors.js';
import { isStatePlaneOnlyDiff } from '../state-plane.js';

const spawnerLayer = NodeChildProcessSpawner.layer.pipe(
  Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))
);

const DEFAULT_STATE_FLUSH_WINDOW_MS = 10 * 60 * 1_000;
const STATE_FLUSH_WINDOW_MS = parseStateFlushWindowMs(process.env.OVERDECK_STATE_FLUSH_WINDOW_MS);
const DEFAULT_STATE_PUSH_TIMEOUT_MS = 30_000;

function parseStateFlushWindowMs(value: string | undefined): number {
  if (!value) return DEFAULT_STATE_FLUSH_WINDOW_MS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_STATE_FLUSH_WINDOW_MS;
  return parsed;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

interface QueuedCommit {
  paths: Set<string>;
  subjects: string[];
  timer: NodeJS.Timeout;
  /** PAN-1908: git checkout to commit into (defaults to projectRoot). */
  repoRoot?: string;
}

/**
 * Paths that must never enter a pipeline auto-commit, regardless of gitignore
 * state. Mirrors the exclusion list in src/lib/cloister/merge-agent.ts.
 */
const AUTO_COMMIT_EXCLUDED_PATHS = [
  '.pan/kickoff.md',
  '.pan/continue.json',
  '.pan/handoff-*.md',
  '.pan/spec.vbrief.json',
  '.claude/rules/',
  '.claude/skills/',
];

function isAutoCommitExcludedPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  for (const pattern of AUTO_COMMIT_EXCLUDED_PATHS) {
    if (pattern.endsWith('/')) {
      if (normalized.startsWith(pattern) || normalized === pattern.slice(0, -1)) {
        return true;
      }
    } else if (pattern.includes('*')) {
      const regex = new RegExp(
        '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '[^/]*') + '$'
      );
      if (regex.test(normalized)) return true;
    } else if (normalized === pattern) {
      return true;
    }
  }
  return false;
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
      Effect.fail(causeToGitError(cause, args)),
    ),
  );
}

function runGitWithTimeout(
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
): Effect.Effect<GitResult, GitError> {
  return runGit(args, cwd).pipe(
    Effect.timeout(Duration.millis(timeoutMs)),
    Effect.catchCause((cause) =>
      Effect.fail(causeToGitError(cause, args)),
    ),
  );
}

function causeToGitError(cause: Cause.Cause<unknown>, args: readonly string[]): GitError {
  const squashed = Cause.squash(cause);
  if (isGitError(squashed)) return squashed;
  return new GitError({
    command: ['git', ...args],
    stderr: String(squashed),
    exitCode: -1,
    cause,
  });
}

function isGitError(value: unknown): value is GitError {
  return typeof value === 'object'
    && value !== null
    && '_tag' in value
    && value._tag === 'GitError';
}

/**
 * Queue an auto-commit for one or more files. Returns immediately; the actual
 * git commit happens at the end of the fixed flush window. Multiple calls for
 * the same project root inside the window coalesce without extending it.
 *
 * PAN-1908: `repoRoot` allows committing files to a different git checkout
 * than the project root (e.g., a declared infra repo for per-issue permanent
 * records). When omitted, commits go to `projectRoot` as before.
 */
export function queueAutoCommit(opts: {
  projectRoot: string;
  paths: string[];
  subject: string;
  repoRoot?: string;
}): void {
  const { projectRoot, paths, subject, repoRoot } = opts;
  if (paths.length === 0) return;

  const existing = pending.get(projectRoot);
  if (existing) {
    paths.forEach((p) => existing.paths.add(p));
    existing.subjects.push(subject);
    existing.repoRoot ??= repoRoot;
    return;
  }
  pending.set(projectRoot, {
    paths: new Set(paths),
    subjects: [subject],
    timer: setTimeout(() => void flushInner(projectRoot), STATE_FLUSH_WINDOW_MS),
    repoRoot,
  });
}

/**
 * PAN-1441: queue an auto-commit of the host-main beads export files.
 *
 * Unlike the .pan/* writers, there is no single Overdeck write site for these:
 * `.beads/issues.jsonl` and `.beads/export-state.json` drift on `main` as a
 * side-effect of the `bd` binary re-exporting after dolt syncs (other machines /
 * workspaces pushing to the shared dolt remote). So this is called from the
 * deacon's periodic patrol as a drift sweep rather than wired to a write site.
 *
 * Only existing files are queued: a missing/deleted `issues.jsonl` is skipped so
 * the janitor never stages — and propagates — a transient empty-DB deletion (the
 * PAN-1158 hazard). queueAutoCommit is main-only, coalesced, and a no-op when
 * nothing changed.
 */
export function queueBeadsAutoCommit(projectRoot: string): void {
  const candidates = [
    join(projectRoot, '.beads', 'issues.jsonl'),
    join(projectRoot, '.beads', 'export-state.json'),
  ];
  const paths = candidates.filter((p) => existsSync(p));
  if (paths.length === 0) return;
  queueAutoCommit({ projectRoot, paths, subject: 'chore(beads): sync beads state on main' });
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

/**
 * Force a flush of every project root with a pending auto-commit. Used during
 * graceful process shutdown so the fixed window does not strand committable
 * state as a dirty tree.
 */
export function flushAllPendingAutoCommits(): Effect.Effect<FlushResult[], never> {
  return Effect.promise(() => {
    const projectRoots = Array.from(pending.keys());
    return Promise.all(projectRoots.map((projectRoot) => flushPromise(projectRoot)));
  });
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
  const gitRoot = batch.repoRoot ?? projectRoot;
  return Effect.gen(function* () {
    if (!existsSync(join(gitRoot, '.git'))) {
      return { committed: false, reason: 'not a git repo' };
    }

    // Check current branch.
    const branchResult: FlushResult | string = yield* runGit(
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      gitRoot,
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

    // Refresh origin/main opportunistically for observability only. Background
    // auto-commit must not integrate remote changes: rebase rewrites history,
    // and even a fast-forward merge would move the shared primary worktree HEAD.
    // Fetch is safe with a dirty working tree because it updates only remote refs.
    yield* runGit(['fetch', 'origin', 'main'], gitRoot).pipe(
      Effect.matchEffect({
        onSuccess: () => Effect.void,
        onFailure: () => Effect.void, // best-effort; network may be down
      }),
    );

    const paths = Array.from(batch.paths);
    // Relativize against the git root where the commit will land, not the
    // logical project root.
    const relativePaths = paths
      .map((p) => relativizeToRoot(p, gitRoot))
      .filter((p) => !isAutoCommitExcludedPath(p));

    if (relativePaths.length === 0) {
      return { committed: false, reason: 'all paths excluded from auto-commit' };
    }

    // git add
    const addOk: boolean | FlushResult = yield* runGit(
      ['add', '--', ...relativePaths],
      gitRoot,
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
      gitRoot,
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
      gitRoot,
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

    yield* maybePushStateCommit(gitRoot, branch);

    return { committed: true };
  });
}

function maybePushStateCommit(
  gitRoot: string,
  branch: string,
): Effect.Effect<void, never> {
  if (process.env.OVERDECK_STATE_AUTOPUSH === '0') {
    return Effect.void;
  }

  return pushOriginMain(gitRoot, branch, false);
}

function pushOriginMain(
  gitRoot: string,
  branch: string,
  retry: boolean,
): Effect.Effect<void, never> {
  const timeoutMs = parsePositiveInteger(
    process.env.OVERDECK_STATE_PUSH_TIMEOUT_MS,
    DEFAULT_STATE_PUSH_TIMEOUT_MS,
  );

  return runGitWithTimeout(['push', 'origin', 'main'], gitRoot, timeoutMs).pipe(
    Effect.matchEffect({
      onSuccess: () => Effect.void,
      onFailure: (err) => {
        const message = err.stderr || err._tag;
        if (!retry && isNonFastForwardPushError(message)) {
          return rebaseStateOnlyAndRetryPush(gitRoot, branch);
        }
        warnAutoPush(branch, `push failed: ${message}`);
        return Effect.void;
      },
    }),
  );
}

function rebaseStateOnlyAndRetryPush(
  gitRoot: string,
  branch: string,
): Effect.Effect<void, never> {
  const timeoutMs = parsePositiveInteger(
    process.env.OVERDECK_STATE_PUSH_TIMEOUT_MS,
    DEFAULT_STATE_PUSH_TIMEOUT_MS,
  );

  return Effect.gen(function* () {
    const fetched = yield* runGitWithTimeout(['fetch', 'origin', 'main'], gitRoot, timeoutMs).pipe(
      Effect.matchEffect({
        onSuccess: () => Effect.succeed(true),
        onFailure: (err) => {
          warnAutoPush(branch, `fetch before rebase failed: ${err.stderr || err._tag}`);
          return Effect.succeed(false);
        },
      }),
    );
    if (!fetched) return;

    const clean = yield* isWorkingTreeClean(gitRoot, branch);
    if (!clean) return;

    const stateOnly = yield* areLocalAheadCommitsStatePlaneOnly(gitRoot, branch);
    if (!stateOnly) {
      warnAutoPush(branch, 'non-fast-forward push rejected and at least one local-ahead commit is not state-plane-only; leaving local main ahead of origin/main');
      return;
    }

    const rebased = yield* runGitWithTimeout(['rebase', 'origin/main'], gitRoot, timeoutMs).pipe(
      Effect.matchEffect({
        onSuccess: () => Effect.succeed(true),
        onFailure: (err) => {
          warnAutoPush(branch, `state-only rebase failed: ${err.stderr || err._tag}`);
          return Effect.succeed(false);
        },
      }),
    );
    if (!rebased) return;

    yield* pushOriginMain(gitRoot, branch, true);
  });
}

function areLocalAheadCommitsStatePlaneOnly(
  gitRoot: string,
  branch: string,
): Effect.Effect<boolean, never> {
  const timeoutMs = parsePositiveInteger(
    process.env.OVERDECK_STATE_PUSH_TIMEOUT_MS,
    DEFAULT_STATE_PUSH_TIMEOUT_MS,
  );

  return Effect.gen(function* () {
    const commits = yield* runGitWithTimeout(
      ['rev-list', '--reverse', 'origin/main..main'],
      gitRoot,
      timeoutMs,
    ).pipe(
      Effect.match({
        onSuccess: (result) => result.stdout.split('\n').map((line) => line.trim()).filter(Boolean),
        onFailure: (err) => {
          warnAutoPush(branch, `local-ahead commit list failed: ${err.stderr || err._tag}`);
          return [];
        },
      }),
    );
    if (commits.length === 0) return true;

    for (const commit of commits) {
      const parent = yield* getSingleParent(gitRoot, branch, commit);
      if (!parent) return false;

      const stateOnly = yield* Effect.promise(() =>
        isStatePlaneOnlyDiff(parent, commit, gitRoot),
      ).pipe(
        Effect.catchCause((cause) => {
          warnAutoPush(branch, `state-plane commit check failed for ${commit}: ${String(Cause.squash(cause))}`);
          return Effect.succeed(false);
        }),
      );
      if (!stateOnly) return false;
    }

    return true;
  });
}

function getSingleParent(
  gitRoot: string,
  branch: string,
  commit: string,
): Effect.Effect<string | null, never> {
  const timeoutMs = parsePositiveInteger(
    process.env.OVERDECK_STATE_PUSH_TIMEOUT_MS,
    DEFAULT_STATE_PUSH_TIMEOUT_MS,
  );

  return runGitWithTimeout(['rev-list', '--parents', '-n', '1', commit], gitRoot, timeoutMs).pipe(
    Effect.match({
      onSuccess: (result) => {
        const parts = result.stdout.trim().split(/\s+/).filter(Boolean);
        if (parts.length === 2) return parts[1] ?? null;
        warnAutoPush(branch, `local-ahead commit ${commit} is not a single-parent commit; leaving local main ahead of origin/main`);
        return null;
      },
      onFailure: (err) => {
        warnAutoPush(branch, `parent lookup failed for ${commit}: ${err.stderr || err._tag}`);
        return null;
      },
    }),
  );
}

function isWorkingTreeClean(
  gitRoot: string,
  branch: string,
): Effect.Effect<boolean, never> {
  return runGit(['status', '--porcelain'], gitRoot).pipe(
    Effect.matchEffect({
      onSuccess: (result) => {
        const clean = result.stdout.trim().length === 0;
        if (!clean) {
          warnAutoPush(branch, 'non-fast-forward push rejected and working tree is dirty; leaving local main ahead of origin/main');
        }
        return Effect.succeed(clean);
      },
      onFailure: (err) => {
        warnAutoPush(branch, `working-tree cleanliness check failed: ${err.stderr || err._tag}`);
        return Effect.succeed(false);
      },
    }),
  );
}

function isNonFastForwardPushError(message: string): boolean {
  return /non-fast-forward|fetch first|failed to push some refs|rejected/i.test(message);
}

function warnAutoPush(branch: string, message: string): void {
  console.warn(`[pan-dir/auto-commit] auto-push warning for ${branch}: ${message}`);
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
