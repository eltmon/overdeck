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
    clearTimeout(existing.timer);
    existing.timer = setTimeout(() => void flushInner(projectRoot), DEBOUNCE_MS);
    return;
  }
  pending.set(projectRoot, {
    paths: new Set(paths),
    subjects: [subject],
    timer: setTimeout(() => void flushInner(projectRoot), DEBOUNCE_MS),
    repoRoot,
  });
}

/**
 * PAN-1441: queue an auto-commit of the host-main beads export files.
 *
 * Unlike the .pan/* writers, there is no single Panopticon write site for these:
 * `.beads/issues.jsonl` and `.beads/export-state.json` drift on `main` as a
 * side-effect of the `bd` binary re-exporting after dolt syncs (other machines /
 * workspaces pushing to the shared dolt remote). So this is called from the
 * deacon's periodic patrol as a drift sweep rather than wired to a write site.
 *
 * Only existing files are queued: a missing/deleted `issues.jsonl` is skipped so
 * the janitor never stages — and propagates — a transient empty-DB deletion (the
 * PAN-1158 hazard). queueAutoCommit is main-only, debounced, and a no-op when
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

    // PAN-1395 root-cause: fetch origin/main before committing so we can
    // rebase after the commit, preventing local main from diverging when
    // a PR merges between beads sync cycles. Fetch is safe with a dirty
    // working tree (unlike pull --rebase).
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

    // PAN-1929: never rebase (or otherwise rewrite history) in the shared
    // primary worktree. The auto-commit is made locally on `main`; integrating
    // remote commits is left to explicit operator/flywheel merge actions so the
    // shared tree is never mutated or left in a conflicted state by a background
    // process. This preserves the original purpose — records reach git durably
    // — without the "rebase failed for main" hazard.
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
