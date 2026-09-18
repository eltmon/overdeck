/**
 * Auto-commit helper for operational state files (.pan/, .beads/).
 *
 * Background: planning and work agents continuously write to .pan/continues/,
 * .pan/specs/, .pan/drafts/, and .beads/issues.jsonl on the project root.
 * Without this helper those writes accumulate uncommitted on `main`, requiring
 * periodic manual "chore: sync workspace state" passes from the operator and
 * making the project repo stay perpetually dirty.
 *
 * This module exposes a serialized write-through commit primitive that pan-dir
 * writers call after they update a file. Commits are:
 *   - scheduled on the next event-loop turn so every state update reaches git + origin
 *   - serialized within a process so the git index is never contested
 *   - best-effort for synchronous callers: failures are logged and reported by flushes
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
import { findProjectByPathSync, listProjectsSync } from '../projects.js';
import { resolveStateReadHomeSync, STATE_BRANCH } from '../state-read-home.js';
import { isStateMigrationLocked } from '../state-migration-lock.js';
import { isStatePlaneOnlyDiff } from '../state-plane.js';
import { withStateRepoLock } from './state-git-lock.js';

const spawnerLayer = NodeChildProcessSpawner.layer.pipe(
  Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))
);

const DEFAULT_STATE_GIT_TIMEOUT_MS = 30_000;
const DEFAULT_STATE_PUSH_TIMEOUT_MS = 30_000;
const DEFAULT_STATE_FLUSH_TIMEOUT_MS = 60_000;

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

interface QueuedCommit {
  paths: Set<string>;
  subjects: string[];
  timer: NodeJS.Timeout | null;
  /** PAN-1908: git checkout to commit into (defaults to projectRoot). */
  repoRoot?: string;
  expectedBranch: string;
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
  /** True only when the new commit is confirmed on origin. */
  pushed?: boolean;
  /**
   * True when the commit landed locally but the push was deliberately deferred
   * to a post-lock `pushAutoCommits` call (PAN-3848 W23): the record writer
   * holds its per-issue locks only across the commit, never across the push.
   */
  pushDeferred?: boolean;
  /**
   * True when a git operation actually errored (branch resolution, `git add`,
   * or `git commit` exited non-zero) as opposed to a benign no-op such as
   * "no diff" or "not on main". Door writers that await the flush surface this
   * loudly so a failed commit never silently leaves the state worktree dirty
   * (PAN-2677).
   */
  errored?: boolean;
  reason?: string;
}

interface ActiveFlush {
  controller: AbortController;
  /** Aborts the detached push phase (PAN-3848 F2). */
  pushController: AbortController;
  gitRoot: string;
  /** Full flush: local commit, then the push (absent for deferred flushes). */
  promise: Promise<FlushResult>;
  /**
   * Resolves when the LOCAL COMMIT lands (PAN-3848 F2). Deferred waiters
   * (commitAutoCommits under a per-issue lock) await this, never another
   * flush's network tail.
   */
  committed: Promise<FlushResult>;
}

const pending = new Map<string, QueuedCommit>();
const active = new Map<string, ActiveFlush>();
/**
 * Every in-flight flush (PAN-3848 F2). `active` keeps the latest flush per
 * project root for the test hook; this set keeps superseded-but-pushing
 * flushes visible to flush-wide waits and shutdown settling.
 */
const inFlight = new Set<ActiveFlush>();
const serializers = new Map<string, Promise<unknown>>();

interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Run a git subcommand. Fails with GitError on non-zero exit. */
function runGitRaw(
  args: readonly string[],
  cwd: string,
): Effect.Effect<GitResult, unknown> {
  return Effect.gen(function* () {
    // HUSKY=0 disables client-side git hooks for the door's own commits.
    // A migrated state worktree shares `core.hooksPath` with the code repo's
    // `.husky/_`, so a `git commit` here would run the code repo's pre-commit
    // hooks with cwd = the state worktree. Those hook scripts don't exist on
    // the `overdeck-state` orphan branch and exit 127, failing the commit and
    // stranding the worktree dirty (PAN-2677). HUSKY=0 is husky's native
    // disable, not a `--no-verify` bypass of the door's own guarantees — the
    // state branch has no hooks of its own, and the door is a trusted
    // single-writer with its own verified-write + push guarantees.
    const handle = yield* ChildProcess.make('git', [...args], {
      cwd,
      env: { HUSKY: '0' },
      extendEnv: true,
    });
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
  );
}

function runGit(
  args: readonly string[],
  cwd: string,
): Effect.Effect<GitResult, GitError> {
  const timeoutMs = parsePositiveInteger(
    process.env.OVERDECK_STATE_GIT_TIMEOUT_MS,
    DEFAULT_STATE_GIT_TIMEOUT_MS,
  );
  return runGitWithTimeout(args, cwd, timeoutMs);
}

function runGitWithTimeout(
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
): Effect.Effect<GitResult, GitError> {
  return runGitRaw(args, cwd).pipe(
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
 * Queue an auto-commit for one or more files. Returns immediately; the
 * serialized commit-and-push starts on the next timer turn. Callers whose
 * success depends on remote durability must also await flushAutoCommits().
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
  /** Keep the batch pending until an explicit flush. */
  defer?: boolean;
}): void {
  const { projectRoot, paths, subject } = opts;
  let { repoRoot } = opts;
  if (paths.length === 0) return;

  let expectedBranch = 'main';
  if (repoRoot && existsSync(join(repoRoot, 'migration-complete.json'))) expectedBranch = STATE_BRANCH;
  const project = findProjectByPathSync(projectRoot);
  if (project) {
    const key = listProjectsSync().find(({ config }) => config.path === project.path)?.key;
    if (key && isStateMigrationLocked(key)) {
      console.warn(`[pan-dir/auto-commit] refusing state write while migration lock is held for ${key}`);
      return;
    }
    const stateHome = resolveStateReadHomeSync(project);
    if (stateHome.migrated) {
      repoRoot = stateHome.root;
      expectedBranch = STATE_BRANCH;
    }
  }

  const existing = pending.get(projectRoot);
  if (existing) {
    paths.forEach((p) => existing.paths.add(p));
    existing.subjects.push(subject);
    existing.repoRoot ??= repoRoot;
    if (expectedBranch === STATE_BRANCH) existing.expectedBranch = STATE_BRANCH;
    if (!opts.defer && !existing.timer) {
      existing.timer = setTimeout(() => void flushInner(projectRoot), 0);
    }
    return;
  }
  pending.set(projectRoot, {
    paths: new Set(paths),
    subjects: [subject],
    timer: opts.defer ? null : setTimeout(() => void flushInner(projectRoot), 0),
    repoRoot,
    expectedBranch,
  });
}

/**
 * PAN-2516 belt-and-suspenders reconciliation for state writes that predate or
 * bypassed the canonical writer. Patrols commit only the owned spec/record
 * surfaces; unrelated source or operator changes are never staged.
 */
export function reconcileStatePlaneDrift(
  projectRoot: string,
): Effect.Effect<FlushResult, never> {
  const project = findProjectByPathSync(projectRoot);
  const stateHome = project ? resolveStateReadHomeSync(project) : null;
  const gitRoot = stateHome?.migrated ? stateHome.root : projectRoot;
  const ownedPaths = stateHome?.migrated
    ? ['specs', 'records', 'agents']
    : ['.pan/specs', '.pan/records'];

  return Effect.gen(function* () {
    const status = yield* runGit(
      ['status', '--porcelain=v1', '--untracked-files=all', '--', ...ownedPaths],
      gitRoot,
    ).pipe(Effect.match({
      onSuccess: (result) => result.stdout,
      onFailure: () => '',
    }));
    const paths = status
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map((line) => line.slice(3))
      .map((path) => path.includes(' -> ') ? path.split(' -> ').at(-1)! : path)
      .map((path) => join(gitRoot, path));
    if (paths.length === 0) return { committed: false, reason: 'no state-plane drift' };

    queueAutoCommit({
      projectRoot,
      repoRoot: gitRoot,
      paths,
      subject: `chore(state): reconcile ${paths.length} pending spec/record update(s)`,
    });
    return yield* flushAutoCommits(projectRoot);
  });
}

/**
 * Force a flush of every pending or active commit that targets the same Git
 * checkout as `projectRoot`. Callers may pass either a logical project root or
 * the effective Git root; the Effect resolves only after every matching writer
 * has settled.
 */
export function flushAutoCommits(
  projectRoot: string,
  signal?: AbortSignal,
): Effect.Effect<FlushResult, never> {
  return Effect.promise(() => flushPromise(projectRoot, signal));
}

/**
 * PAN-3848 (W23): the commit half of a flush, with the push deferred. The
 * record writer runs this under its per-issue locks and then pushes after the
 * locks are released via `pushAutoCommits`, so a slow network push never
 * starves peer writers. The result carries `pushDeferred: true` when a commit
 * landed and still needs the post-lock push.
 */
export function commitAutoCommits(
  projectRoot: string,
  signal?: AbortSignal,
): Effect.Effect<FlushResult, never> {
  return Effect.promise(() => flushPromise(projectRoot, signal, true));
}

/**
 * The push half of a split flush (PAN-3848 W23): push whatever local commits
 * already exist on the checkout's state-plane branch. Resolves `projectRoot`
 * the same way the queue does (state worktree for migrated projects), so the
 * caller can pass the same root it passed to `commitAutoCommits`. Returns null
 * when there is no repo, no matching branch, or no `origin` remote — the same
 * "not part of the write" convention as `maybePushStateCommit`.
 */
export function pushAutoCommits(
  projectRoot: string,
): Effect.Effect<PushResult | null, never> {
  let gitRoot = projectRoot;
  let expectedBranch = existsSync(join(projectRoot, 'migration-complete.json')) ? STATE_BRANCH : 'main';
  const project = findProjectByPathSync(projectRoot);
  if (project) {
    const stateHome = resolveStateReadHomeSync(project);
    if (stateHome.migrated) {
      gitRoot = stateHome.root;
      expectedBranch = STATE_BRANCH;
    }
  }
  if (!existsSync(join(gitRoot, '.git'))) return Effect.succeed(null);

  return runGit(['rev-parse', '--abbrev-ref', 'HEAD'], gitRoot).pipe(
    Effect.matchEffect({
      onSuccess: (r) => Effect.succeed(r.stdout.trim() as string | null),
      onFailure: () => Effect.succeed(null as string | null),
    }),
    Effect.flatMap((branch) => branch === expectedBranch ? maybePushStateCommit(gitRoot, expectedBranch) : Effect.succeed(null)),
  );
}

/**
 * Force a flush of every project root with a pending auto-commit. Used during
 * graceful process shutdown so the fixed window does not strand committable
 * state as a dirty tree.
 */
export function flushAllPendingAutoCommits(): Effect.Effect<FlushResult[], never> {
  return Effect.promise(() => {
    const projectRoots = [...new Set([...pending.keys(), ...active.keys()])];
    return Promise.all(projectRoots.map((projectRoot) => flushPromise(projectRoot)));
  });
}

function flushPromise(
  projectRoot: string,
  signal?: AbortSignal,
  deferPush = false,
): Promise<FlushResult> {
  const gitRoot = pending.get(projectRoot)?.repoRoot
    ?? active.get(projectRoot)?.gitRoot
    ?? projectRoot;
  const matching = new Set<ActiveFlush>();

  for (const [queuedProjectRoot, batch] of pending) {
    if ((batch.repoRoot ?? queuedProjectRoot) !== gitRoot) continue;
    if (batch.timer) clearTimeout(batch.timer);
    const started = flushInner(queuedProjectRoot, deferPush);
    if (started) matching.add(started);
  }
  for (const activeFlush of inFlight) {
    if (activeFlush.gitRoot === gitRoot) matching.add(activeFlush);
  }

  if (matching.size === 0) {
    signal?.throwIfAborted();
    return Promise.resolve({ committed: false, reason: 'no pending' });
  }
  // A deferred flush awaits only local commits (PAN-3848 F2) — never an
  // existing flush's push tail.
  return deferPush
    ? waitForFlushCommits(gitRoot, [...matching], signal)
    : waitForFlushes(gitRoot, [...matching], signal);
}

function flushInner(projectRoot: string, deferPush = false): ActiveFlush | undefined {
  const batch = pending.get(projectRoot);
  if (!batch) return active.get(projectRoot);
  pending.delete(projectRoot);

  const gitRoot = batch.repoRoot ?? projectRoot;
  const commitOperation = doLocalCommit(projectRoot, batch);
  // A deferred flush commits locally only; the caller pushes after releasing
  // its locks. A non-deferred flush pushes inline — as a detached phase (F2).
  const pushOperation = deferPush
    ? null
    : (commitResult: FlushResult): Effect.Effect<FlushResult, never> =>
      commitResult.committed ? doBoundedPush(gitRoot, batch.expectedBranch) : Effect.succeed(commitResult);
  return startSerializedFlush(
    projectRoot,
    gitRoot,
    commitOperation,
    pushOperation,
  );
}

function startSerializedFlush(
  projectRoot: string,
  gitRoot: string,
  commitOperation: Effect.Effect<FlushResult, never>,
  pushOperation: ((commitResult: FlushResult) => Effect.Effect<FlushResult, never>) | null = null,
): ActiveFlush {
  const prior = serializers.get(gitRoot) ?? Promise.resolve();
  const controller = new AbortController();
  const pushController = new AbortController();
  // The commit gate advances when the LOCAL COMMIT lands (PAN-3848 F2), not
  // when the full flush settles: the next flush's commit may proceed while
  // this flush's push is still in flight, so a lock-held deferred waiter
  // never sits behind another flush's network tail. Commits stay serialized
  // (the gate) and cross-process excluded (the repo lock inside); overlapping
  // a push with the next commit is safe because push-race reconciliation
  // downstream owns the resulting ref races. The push itself runs detached
  // and is awaited only through `promise`.
  const committed = prior.catch(() => undefined).then(() => {
    controller.signal.throwIfAborted();
    // Cross-process index exclusion (PAN-3848 F7): the per-issue locks do not
    // exclude peer issues on this checkout. The lock wraps the commit op
    // including its best-effort fetch; the push stays outside it.
    return withStateRepoLock(gitRoot, `autocommit:${projectRoot}`, () =>
      Effect.runPromise(boundStateFlush(commitOperation), { signal: controller.signal }),
    );
  });
  const commitTail = committed.catch(() => undefined);
  serializers.set(gitRoot, commitTail);
  void commitTail.then(() => {
    if (serializers.get(gitRoot) === commitTail) serializers.delete(gitRoot);
  });
  const promise = pushOperation === null
    ? committed
    : committed.then((commitResult) => {
      pushController.signal.throwIfAborted();
      return Effect.runPromise(pushOperation(commitResult), { signal: pushController.signal });
    });
  const activeFlush: ActiveFlush = {
    controller,
    pushController,
    gitRoot,
    promise,
    committed: committed.catch((error) => {
      // A commit-phase waiter must observe aborts as results, not hangs: the
      // full `promise` still rejects for the owner.
      if (error instanceof Error) return { committed: false, errored: true, reason: error.message };
      return { committed: false, errored: true, reason: String(error) };
    }),
  };
  active.set(projectRoot, activeFlush);
  inFlight.add(activeFlush);

  void promise.then(
    () => clearActiveFlush(projectRoot, activeFlush),
    () => clearActiveFlush(projectRoot, activeFlush),
  );
  return activeFlush;
}

function waitForFlush(
  activeFlush: ActiveFlush,
  signal?: AbortSignal,
): Promise<FlushResult> {
  return waitForFlushes(activeFlush.gitRoot, [activeFlush], signal);
}

async function waitForFlushes(
  gitRoot: string,
  activeFlushes: readonly ActiveFlush[],
  signal?: AbortSignal,
): Promise<FlushResult> {
  return settleFlushWaits(
    gitRoot,
    Promise.all(activeFlushes.map((flush) => flush.promise)).then(combineFlushResults),
    signal,
  );
}

/** Commit-phase wait for deferred flushes (PAN-3848 F2). */
async function waitForFlushCommits(
  gitRoot: string,
  activeFlushes: readonly ActiveFlush[],
  signal?: AbortSignal,
): Promise<FlushResult> {
  return settleFlushWaits(
    gitRoot,
    Promise.all(activeFlushes.map((flush) => flush.committed)).then(combineFlushResults),
    signal,
  );
}

async function settleFlushWaits<T>(
  gitRoot: string,
  completion: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return completion;
  if (signal.aborted) {
    await abortAndSettleGitRoot(gitRoot, signal.reason);
    throw signal.reason;
  }

  return new Promise((resolve, reject) => {
    let completed = false;
    const onAbort = () => {
      if (completed) return;
      completed = true;
      signal.removeEventListener('abort', onAbort);
      void abortAndSettleGitRoot(gitRoot, signal.reason).then(
        () => reject(signal.reason),
        reject,
      );
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void completion.then(
      (result) => {
        if (completed) return;
        completed = true;
        signal.removeEventListener('abort', onAbort);
        resolve(result);
      },
      (error) => {
        if (completed) return;
        completed = true;
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
    if (signal.aborted) onAbort();
  });
}

function combineFlushResults(results: FlushResult[]): FlushResult {
  if (results.length === 1) return results[0];

  const combined: FlushResult = {
    committed: results.some((result) => result.committed),
  };
  const committed = results.filter((result) => result.committed);
  if (committed.some((result) => result.pushed === false)) combined.pushed = false;
  else if (committed.length > 0 && committed.every((result) => result.pushed === true)) {
    combined.pushed = true;
  }
  // A deferred push still needs the post-lock pushAutoCommits unless one of the
  // combined flushes already pushed (PAN-3848 W23).
  if (results.some((result) => result.pushDeferred) && !results.some((result) => result.pushed === true)) {
    combined.pushDeferred = true;
  }
  if (results.some((result) => result.errored)) combined.errored = true;
  const reasons = results.flatMap((result) => result.reason ? [result.reason] : []);
  if (reasons.length > 0) combined.reason = reasons.join('; ');
  return combined;
}

async function abortAndSettleGitRoot(
  gitRoot: string,
  reason: unknown,
): Promise<void> {
  const matching = [...inFlight].filter((flush) => flush.gitRoot === gitRoot);
  for (const flush of matching) {
    flush.controller.abort(reason);
    flush.pushController.abort(reason);
  }
  await Promise.allSettled(matching.map((flush) => flush.promise));
}

function clearActiveFlush(
  projectRoot: string,
  activeFlush: ActiveFlush,
): void {
  if (active.get(projectRoot) === activeFlush) active.delete(projectRoot);
  inFlight.delete(activeFlush);
}

function doBoundedPush(
  gitRoot: string,
  branch: string,
): Effect.Effect<FlushResult, never> {
  return boundStateFlush(Effect.gen(function* () {
    const push = yield* maybePushStateCommit(gitRoot, branch);
    if (push && !push.pushed) {
      return { committed: true, pushed: false, reason: push.reason };
    }
    return { committed: true, pushed: push?.pushed };
  }));
}

function boundStateFlush(
  operation: Effect.Effect<FlushResult, never>,
  timeoutMs = parsePositiveInteger(
    process.env.OVERDECK_STATE_FLUSH_TIMEOUT_MS,
    DEFAULT_STATE_FLUSH_TIMEOUT_MS,
  ),
): Effect.Effect<FlushResult, never> {
  return operation.pipe(
    Effect.timeout(Duration.millis(timeoutMs)),
    Effect.catchCause((cause) => {
      const reason = `state writer timed out after ${timeoutMs / 1_000}s: ${String(Cause.squash(cause))}`;
      console.warn(`[pan-dir/auto-commit] ${reason}`);
      return Effect.succeed({ committed: false, errored: true, reason });
    }),
  );
}

function doLocalCommit(
  projectRoot: string,
  batch: QueuedCommit,
): Effect.Effect<FlushResult, never> {
  const gitRoot = batch.repoRoot ?? projectRoot;
  return Effect.gen(function* () {
    if (!existsSync(join(gitRoot, '.git'))) {
      if (batch.expectedBranch === STATE_BRANCH) {
        console.warn(`[pan-dir/auto-commit] refusing state write: state worktree is missing at ${gitRoot}`);
        return { committed: false, reason: `state worktree missing: ${gitRoot}` };
      }
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
            errored: true as const,
            reason: `branch check failed: ${err.stderr || err._tag}`,
          } satisfies FlushResult),
      }),
    );
    if (typeof branchResult !== 'string') return branchResult;

    const expectedBranch = batch.expectedBranch;
    if (branchResult !== expectedBranch) {
      return { committed: false, reason: expectedBranch === 'main'
        ? `not on main (${branchResult})`
        : `expected ${expectedBranch}, found ${branchResult}` };
    }

    const branch = branchResult;

    yield* runGit(['fetch', 'origin', expectedBranch], gitRoot).pipe(
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

    // Refuse to stage any path whose case-insensitive twin is already tracked
    // under different casing. Case-insensitive checkouts (macOS APFS) can
    // materialize only one of the pair, leaving the other as a permanent
    // phantom modification (PAN-3287).
    const lsFiles: FlushResult | string = yield* runGit(['ls-files', '-z'], gitRoot).pipe(
      Effect.matchEffect({
        onSuccess: (r) => Effect.succeed(r.stdout),
        onFailure: (err) =>
          Effect.succeed({
            committed: false as const,
            errored: true as const,
            reason: `ls-files failed: ${err.stderr || err._tag}`,
          } satisfies FlushResult),
      }),
    );
    if (typeof lsFiles !== 'string') return lsFiles;
    const trackedByFold = new Map<string, string>();
    for (const tracked of lsFiles.split('\0')) {
      if (tracked) trackedByFold.set(tracked.toLowerCase(), tracked);
    }
    const caseCollisions = relativePaths.flatMap((p) => {
      const tracked = trackedByFold.get(p.toLowerCase());
      return tracked !== undefined && tracked !== p ? [`${p} vs tracked ${tracked}`] : [];
    });
    if (caseCollisions.length > 0) {
      const reason = `refusing case-colliding add on ${branch}: ${caseCollisions.join('; ')}`;
      console.warn(`[pan-dir/auto-commit] ${reason}`);
      return { committed: false, errored: true, reason };
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
            errored: true as const,
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
            errored: true as const,
            reason: err.stderr || err._tag,
          } satisfies FlushResult);
        },
      }),
    );
    if (typeof commitOk !== 'boolean') return commitOk;

    // PAN-3848 (W23/F2): the commit phase reports the deferral instead of
    // pushing here — the record writer pushes after releasing its per-issue
    // locks, and non-deferred flushes push as a detached phase.
    return { committed: true, pushDeferred: true };
  });
}

export interface PushResult {
  pushed: boolean;
  reason?: string;
}

/**
 * Push whatever local commits already exist on a project's state-plane
 * branch, without requiring a new diff to stage.
 *
 * Review fix (PAN-1990 cycle 3): a durable-cleanup caller (e.g.
 * removeMemoryStateMirror) that deletes a file, commits the deletion, but
 * fails to push leaves a REAL local commit on disk. A naive retry that only
 * checks "does the file still exist locally" sees it's already gone and
 * skips straight to "nothing to do" — the stuck commit never gets another
 * push attempt. `git push` sends every local commit ahead of the remote
 * tracking ref, not just the newest one, so retrying the push alone (with no
 * new file change required) is enough to carry the earlier stuck commit
 * along. Returns null when there's no repo, the branch doesn't match, or no
 * `origin` remote is configured (mirrors maybePushStateCommit's own
 * "no origin = not part of the write" convention for local/test repos).
 */
export function pushPendingStateCommits(projectRoot: string): Effect.Effect<PushResult | null, never> {
  return pushAutoCommits(projectRoot);
}

function maybePushStateCommit(
  gitRoot: string,
  branch: string,
): Effect.Effect<PushResult | null, never> {
  return runGit(['remote', 'get-url', 'origin'], gitRoot).pipe(
    Effect.matchEffect({
      // Unit-test and local scratch repositories may intentionally have no
      // origin. A configured origin, however, makes push part of the write.
      onFailure: () => Effect.succeed(null),
      onSuccess: () => pushStateBranch(gitRoot, branch),
    }),
  );
}

function pushStateBranch(
  gitRoot: string,
  branch: string,
): Effect.Effect<PushResult, never> {
  if (branch === 'main') return pushOriginMain(gitRoot, branch, false);
  const timeoutMs = parsePositiveInteger(
    process.env.OVERDECK_STATE_PUSH_TIMEOUT_MS,
    DEFAULT_STATE_PUSH_TIMEOUT_MS,
  );

  const attempt = runGitWithTimeout(['push', 'origin', branch], gitRoot, timeoutMs).pipe(
    Effect.match({
      onSuccess: (): PushAttemptOutcome => ({ ok: true }),
      onFailure: (err): PushAttemptOutcome => ({ ok: false, message: err.stderr || err._tag }),
    }),
  );

  return Effect.promise(() => pushWithRetry(() => Effect.runPromise(attempt))).pipe(
    Effect.map((result) => {
      // The paths-only queue has no mutation intent and must never replay or
      // rebase. Domain writers resolve non-fast-forward conflicts before
      // enqueuing a new concrete file version (PAN-2541 D10).
      if (!result.pushed) warnAutoPush(branch, result.reason ?? 'push failed');
      return result;
    }),
  );
}

const DEFAULT_PUSH_RETRY_DELAYS_MS: readonly number[] = [500, 1500, 3000];

/**
 * Delays between push attempts after a `cannot lock ref` rejection. Override
 * with OVERDECK_STATE_PUSH_RETRY_DELAYS_MS (comma-separated ms; an empty
 * string disables retries) — the same env idiom as OVERDECK_STATE_PUSH_TIMEOUT_MS.
 * Tests that keep a ref-lock race alive on purpose set it to `0,0,0`.
 */
function pushRetryDelaysMs(): readonly number[] {
  const raw = process.env.OVERDECK_STATE_PUSH_RETRY_DELAYS_MS;
  if (raw === undefined) return DEFAULT_PUSH_RETRY_DELAYS_MS;
  return raw.split(',').map((v) => v.trim()).filter((v) => v.length > 0)
    .map((v) => Number.parseInt(v, 10)).filter((n) => Number.isFinite(n) && n >= 0);
}

/**
 * A rejected push is retried only on git's `cannot lock ref` rejection: another
 * writer pushed the same local branch at the same instant, the rejection is
 * transient, and a plain retry succeeds once the ref lock clears. Anything
 * else (non-fast-forward, auth, network, hooks) fails immediately as before. No fetch, no rebase,
 * no force. Total added delay is at most 5s (D11: the record writer's state
 * git lock has a 30s durability budget).
 */
function isRetryablePushRejection(message: string): boolean {
  // Only the ref-lock race is transient. A non-fast-forward rejection means
  // origin really advanced; the PAN-3291 merge reconciliation owns that case
  // and must not wait behind 5s of pointless retries.
  return message.includes('cannot lock ref');
}

interface PushAttemptOutcome {
  ok: boolean;
  message?: string;
}

async function pushWithRetry(
  attempt: () => Promise<PushAttemptOutcome>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<PushResult> {
  const delays = pushRetryDelaysMs();
  const maxAttempts = delays.length + 1;
  let lastMessage = 'unknown error';
  for (let n = 1; n <= maxAttempts; n++) {
    const outcome = await attempt();
    if (outcome.ok) return { pushed: true };
    lastMessage = outcome.message ?? 'unknown error';
    if (n < maxAttempts && isRetryablePushRejection(lastMessage)) {
      const delayMs = delays[n - 1]!;
      console.log(`[auto-commit] push rejected (attempt ${n}/${maxAttempts}): ${lastMessage.split('\n')[0]}; retrying in ${delayMs}ms`);
      await sleep(delayMs);
      continue;
    }
    break;
  }
  return { pushed: false, reason: `push failed: ${lastMessage}` };
}

function pushOriginMain(gitRoot: string, branch: string, retry: boolean): Effect.Effect<PushResult, never> {
  const timeoutMs = parsePositiveInteger(process.env.OVERDECK_STATE_PUSH_TIMEOUT_MS, DEFAULT_STATE_PUSH_TIMEOUT_MS);
  return runGitWithTimeout(['push', 'origin', 'main'], gitRoot, timeoutMs).pipe(
    Effect.matchEffect({
      onSuccess: () => Effect.succeed({ pushed: true }),
      onFailure: (err) => {
        const message = err.stderr || err._tag;
        if (!retry && isNonFastForwardPushError(message)) return rebaseLegacyMainAndRetry(gitRoot, branch);
        warnAutoPush(branch, `push failed: ${message}`);
        return Effect.succeed({ pushed: false, reason: `push failed: ${message}` });
      },
    }),
  );
}

function rebaseLegacyMainAndRetry(gitRoot: string, branch: string): Effect.Effect<PushResult, never> {
  const timeoutMs = parsePositiveInteger(process.env.OVERDECK_STATE_PUSH_TIMEOUT_MS, DEFAULT_STATE_PUSH_TIMEOUT_MS);
  return Effect.gen(function* () {
    const fetched = yield* runGitWithTimeout(['fetch', 'origin', 'main'], gitRoot, timeoutMs).pipe(
      Effect.match({ onSuccess: () => true, onFailure: () => false }),
    );
    if (!fetched || !(yield* isWorkingTreeClean(gitRoot, branch))) {
      return { pushed: false, reason: 'push rejected and reconciliation preconditions failed' };
    }
    if (!(yield* areLocalAheadCommitsStatePlaneOnly(gitRoot, branch))) {
      warnAutoPush(branch, 'non-fast-forward push rejected and at least one local-ahead commit is not state-plane-only; leaving local main ahead of origin/main');
      return { pushed: false, reason: 'push rejected with non-state local commits' };
    }
    const rebased = yield* runGitWithTimeout(['rebase', 'origin/main'], gitRoot, timeoutMs).pipe(
      Effect.match({ onSuccess: () => true, onFailure: () => false }),
    );
    if (rebased) return yield* pushOriginMain(gitRoot, branch, true);
    return { pushed: false, reason: 'push rejected and state rebase failed' };
  });
}

function areLocalAheadCommitsStatePlaneOnly(gitRoot: string, branch: string): Effect.Effect<boolean, never> {
  const timeoutMs = parsePositiveInteger(process.env.OVERDECK_STATE_PUSH_TIMEOUT_MS, DEFAULT_STATE_PUSH_TIMEOUT_MS);
  return Effect.gen(function* () {
    const commits = yield* runGitWithTimeout(['rev-list', '--reverse', 'origin/main..main'], gitRoot, timeoutMs).pipe(
      Effect.match({
        onSuccess: (result) => result.stdout.split('\n').map((line) => line.trim()).filter(Boolean),
        onFailure: (err) => {
          warnAutoPush(branch, `local-ahead commit list failed: ${err.stderr || err._tag}`);
          return null;
        },
      }),
    );
    if (commits === null) return false;
    for (const commit of commits) {
      const parent = yield* runGitWithTimeout(['rev-list', '--parents', '-n', '1', commit], gitRoot, timeoutMs).pipe(
        Effect.match({
          onSuccess: (result) => result.stdout.trim().split(/\s+/)[1] ?? null,
          onFailure: () => null,
        }),
      );
      if (!parent) return false;
      const stateOnly = yield* Effect.promise(() => isStatePlaneOnlyDiff(parent, commit, gitRoot)).pipe(
        Effect.catchCause(() => Effect.succeed(false)),
      );
      if (!stateOnly) return false;
    }
    return true;
  });
}

function isWorkingTreeClean(gitRoot: string, branch: string): Effect.Effect<boolean, never> {
  return runGit(['status', '--porcelain'], gitRoot).pipe(
    Effect.match({
      onSuccess: (result) => {
        const clean = result.stdout.trim().length === 0;
        if (!clean) warnAutoPush(branch, 'non-fast-forward push rejected and working tree is dirty; leaving local main ahead of origin/main');
        return clean;
      },
      onFailure: (err) => {
        warnAutoPush(branch, `working-tree cleanliness check failed: ${err.stderr || err._tag}`);
        return false;
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
 * Find the project root for a `.pan/` file path. Returns null otherwise.
 */
export function deriveProjectRoot(path: string): string | null {
  const marker = `${sep}.pan${sep}`;
  const idx = path.indexOf(marker);
  if (idx !== -1) return path.slice(0, idx);
  // Edge case: the path is the .pan directory itself.
  const base = dirname(path);
  if (base.endsWith(`${sep}.pan`)) {
    return dirname(base);
  }
  return null;
}

export const __testInternals = {
  boundStateFlush,
  startSerializedFlush,
  waitForFlush,
  pushWithRetry,
  /**
   * The flush a timer turn (or an explicit flush) started for `projectRoot`,
   * or `undefined` when nothing is in flight. Tests use this to await the
   * timer-initiated flush deterministically instead of polling Git history.
   */
  getActiveFlush: (projectRoot: string): ActiveFlush | undefined => active.get(projectRoot),
  /**
   * Cancel every queued flush and wait for every in-flight one to settle,
   * whatever its outcome. Test teardown calls this so removing a temporary
   * repository cannot race a running git process.
   */
  settleAllFlushes: async (): Promise<void> => {
    for (const batch of pending.values()) if (batch.timer) clearTimeout(batch.timer);
    pending.clear();
    await Promise.allSettled([...inFlight].map((flush) => flush.promise));
  },
};

function relativizeToRoot(absOrRel: string, projectRoot: string): string {
  const rootPrefix = projectRoot.endsWith(sep) ? projectRoot : projectRoot + sep;
  if (absOrRel.startsWith(rootPrefix)) return absOrRel.slice(rootPrefix.length);
  return absOrRel;
}
