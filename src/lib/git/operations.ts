/**
 * Git Operations Helpers (PAN-653)
 *
 * Thin wrappers over raw git commands that:
 * 1. Use execAsync (never execSync) — safe for dashboard server use
 * 2. Record before/after/remote SHAs for each operation
 * 3. Emit structured git.* events to the git_operations SQLite table
 * 4. For gitPush: perform a pre-push fetch + ancestor check and throw
 *    MainDivergedError if origin/main has advanced past the local ancestor
 *
 * Usage: import { gitPush, gitFetch, gitForcePush, gitMerge, gitRevParse }
 *        from 'src/lib/git/operations.js'
 *
 * NEVER add execSync, readFileSync, writeFileSync here — this module is
 * imported by dashboard server code (CLAUDE.md rule).
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { Effect } from 'effect';
import { appendGitOperation } from '../git-activity.js';
import { GitError, VcsError } from '../errors.js';

const execFileAsync = promisify(execFile);

// ============== Error types ==============

/**
 * Thrown by gitPush when origin/main has advanced beyond the local ancestor.
 * The caller must NOT push — it should call markWorkspaceStuck instead.
 */
export class MainDivergedError extends Error {
  readonly localSha: string;
  readonly remoteSha: string;

  constructor(localSha: string, remoteSha: string) {
    super(
      `Main diverged: remote HEAD (${remoteSha.slice(0, 7)}) is not an ancestor of local HEAD (${localSha.slice(0, 7)}). Aborting push to protect the hotfix commit.`
    );
    this.name = 'MainDivergedError';
    this.localSha = localSha;
    this.remoteSha = remoteSha;
  }
}

// ============== Helpers ==============

/**
 * Resolve a git ref to its SHA in the given working directory.
 * Returns null if the ref does not exist.
 */
export async function gitRevParse(cwd: string, ref: string): Promise<string | null> {
  const ts = new Date().toISOString();
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', ref], { cwd, encoding: 'utf-8' });
    const sha = stdout.trim();
    appendGitOperation({ operation: 'rev_parse', branch: ref, issueId: undefined, afterSha: sha, status: 'success', ts });
    return sha || null;
  } catch {
    return null;
  }
}

/**
 * Fetch from a remote. Updates remote-tracking branches.
 */
export async function gitFetch(
  cwd: string,
  remote = 'origin',
  branch?: string,
  opts: { issueId?: string } = {},
): Promise<void> {
  const ts = new Date().toISOString();
  const args = branch ? ['fetch', remote, branch] : ['fetch', remote];
  try {
    await execFileAsync('git', args, { cwd, encoding: 'utf-8', timeout: 30000 });
    appendGitOperation({
      operation: 'fetch',
      branch: branch ?? remote,
      issueId: opts.issueId,
      status: 'success',
      ts,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    appendGitOperation({
      operation: 'fetch',
      branch: branch ?? remote,
      issueId: opts.issueId,
      status: 'failure',
      error: msg,
      ts,
    });
    throw err;
  }
}

/**
 * Push a branch to a remote.
 *
 * DIVERGENCE GUARD: Before pushing, this function fetches origin/branch and
 * checks that origin/branch is an ancestor of the local HEAD. If origin has
 * advanced (i.e. a hotfix was pushed between our last pull and now), we throw
 * MainDivergedError instead of clobbering the hotfix.
 *
 * @throws MainDivergedError if origin has advanced beyond the local ancestor
 */
export async function gitPush(
  cwd: string,
  remote = 'origin',
  branch = 'main',
  opts: { issueId?: string } = {},
): Promise<void> {
  const ts = new Date().toISOString();

  // Step 1: record the local HEAD before the push
  const localSha = await gitRevParse(cwd, 'HEAD') ?? 'unknown';

  // Step 2: fetch latest remote state
  await gitFetch(cwd, remote, branch, opts);

  // Step 3: read the remote tracking SHA
  const remoteSha = await gitRevParse(cwd, `${remote}/${branch}`) ?? '';

  // Step 4: ancestor check — is remoteSha an ancestor of localSha?
  if (remoteSha) {
    try {
      // git merge-base --is-ancestor <commit> <commit> exits 0 if true, 1 if false
      await execFileAsync('git', ['merge-base', '--is-ancestor', remoteSha, localSha], {
        cwd,
        encoding: 'utf-8',
        timeout: 10000,
      });
    } catch (err: unknown) {
      // exit code 1 = "not an ancestor" (true divergence); any other code is a real git error
      if ((err as { code?: number }).code !== 1) throw err;
      appendGitOperation({
        operation: 'main_diverged',
        branch,
        issueId: opts.issueId,
        beforeSha: localSha,
        remoteSha,
        status: 'aborted',
        error: `origin/${branch} (${remoteSha.slice(0, 7)}) is not ancestor of local HEAD (${localSha.slice(0, 7)})`,
        ts,
      });
      throw new MainDivergedError(localSha, remoteSha);
    }
  }

  // Step 5: push
  try {
    await execFileAsync('git', ['push', remote, branch], { cwd, encoding: 'utf-8', timeout: 60000 });
    const afterSha = await gitRevParse(cwd, 'HEAD') ?? localSha;
    appendGitOperation({
      operation: 'push',
      branch,
      issueId: opts.issueId,
      beforeSha: localSha,
      afterSha,
      remoteSha,
      status: 'success',
      ts,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    appendGitOperation({
      operation: 'push',
      branch,
      issueId: opts.issueId,
      beforeSha: localSha,
      remoteSha,
      status: 'failure',
      error: msg,
      ts,
    });
    throw err;
  }
}

/**
 * Force-push a branch (with --force-with-lease for safety).
 * Does NOT perform the divergence guard — force-push callers are
 * responsible for deciding when a force push is appropriate.
 */
export async function gitForcePush(
  cwd: string,
  remote = 'origin',
  branch = 'main',
  opts: { issueId?: string; reason?: string } = {},
): Promise<void> {
  const ts = new Date().toISOString();
  const localSha = await gitRevParse(cwd, 'HEAD') ?? 'unknown';
  const remoteSha = await gitRevParse(cwd, `${remote}/${branch}`) ?? undefined;

  try {
    await execFileAsync('git', ['push', '--force-with-lease', remote, branch], {
      cwd,
      encoding: 'utf-8',
      timeout: 60000,
    });
    const afterSha = await gitRevParse(cwd, 'HEAD') ?? localSha;
    appendGitOperation({
      operation: 'force_push',
      branch,
      issueId: opts.issueId,
      beforeSha: localSha,
      afterSha,
      remoteSha,
      status: 'success',
      error: opts.reason,
      ts,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    appendGitOperation({
      operation: 'force_push',
      branch,
      issueId: opts.issueId,
      beforeSha: localSha,
      remoteSha,
      status: 'failure',
      error: msg,
      ts,
    });
    throw err;
  }
}

/**
 * Merge a branch into the current branch.
 */
export async function gitMerge(
  cwd: string,
  branch: string,
  opts: { issueId?: string; noFf?: boolean } = {},
): Promise<void> {
  const ts = new Date().toISOString();
  const beforeSha = await gitRevParse(cwd, 'HEAD') ?? 'unknown';
  const args = opts.noFf ? ['merge', '--no-ff', branch] : ['merge', branch];
  try {
    await execFileAsync('git', args, { cwd, encoding: 'utf-8', timeout: 60000 });
    const afterSha = await gitRevParse(cwd, 'HEAD') ?? beforeSha;
    appendGitOperation({
      operation: 'merge',
      branch,
      issueId: opts.issueId,
      beforeSha,
      afterSha,
      status: 'success',
      ts,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    appendGitOperation({
      operation: 'merge',
      branch,
      issueId: opts.issueId,
      beforeSha,
      status: 'failure',
      error: msg,
      ts,
    });
    throw err;
  }
}

// ─── Effect variants (PAN-1249, additive) ────────────────────────────────────
//
// These wrap the existing Promise-based functions with typed Effect error
// channels (GitError / VcsError). The underlying impl is unchanged; this is
// an additive surface for callers that already speak Effect. MainDivergedError
// is thrown by the underlying gitPush; the Effect variant surfaces it
// preserved as the cause inside a VcsError tagged 'main-diverged'.

/** Resolve a git ref to its SHA. Returns null if the ref does not exist. */
export function gitRevParseEffect(
  cwd: string,
  ref: string,
): Effect.Effect<string | null> {
  return Effect.promise(() => gitRevParse(cwd, ref));
}

/** Fetch from a remote. */
export function gitFetchEffect(
  cwd: string,
  remote = 'origin',
  branch?: string,
  opts: { issueId?: string } = {},
): Effect.Effect<void, GitError> {
  return Effect.tryPromise({
    try: () => gitFetch(cwd, remote, branch, opts),
    catch: (cause) =>
      new GitError({
        command: branch ? ['git', 'fetch', remote, branch] : ['git', 'fetch', remote],
        stderr: cause instanceof Error ? cause.message : String(cause),
        exitCode: -1,
        cause,
      }),
  });
}

/**
 * Push a branch to a remote with divergence guard.
 * Fails with VcsError tagged 'main-diverged' when MainDivergedError is thrown.
 */
export function gitPushEffect(
  cwd: string,
  remote = 'origin',
  branch = 'main',
  opts: { issueId?: string } = {},
): Effect.Effect<void, VcsError | GitError> {
  return Effect.tryPromise({
    try: () => gitPush(cwd, remote, branch, opts),
    catch: (cause) => {
      if (cause instanceof MainDivergedError) {
        return new VcsError({
          operation: 'main-diverged',
          message: cause.message,
          cause,
        });
      }
      return new GitError({
        command: ['git', 'push', remote, branch],
        stderr: cause instanceof Error ? cause.message : String(cause),
        exitCode: -1,
        cause,
      });
    },
  });
}

/** Force-push a branch (--force-with-lease). */
export function gitForcePushEffect(
  cwd: string,
  remote = 'origin',
  branch = 'main',
  opts: { issueId?: string; reason?: string } = {},
): Effect.Effect<void, GitError> {
  return Effect.tryPromise({
    try: () => gitForcePush(cwd, remote, branch, opts),
    catch: (cause) =>
      new GitError({
        command: ['git', 'push', '--force-with-lease', remote, branch],
        stderr: cause instanceof Error ? cause.message : String(cause),
        exitCode: -1,
        cause,
      }),
  });
}

/** Merge a branch into the current branch. */
export function gitMergeEffect(
  cwd: string,
  branch: string,
  opts: { issueId?: string; noFf?: boolean } = {},
): Effect.Effect<void, GitError> {
  return Effect.tryPromise({
    try: () => gitMerge(cwd, branch, opts),
    catch: (cause) =>
      new GitError({
        command: opts.noFf ? ['git', 'merge', '--no-ff', branch] : ['git', 'merge', branch],
        stderr: cause instanceof Error ? cause.message : String(cause),
        exitCode: -1,
        cause,
      }),
  });
}
