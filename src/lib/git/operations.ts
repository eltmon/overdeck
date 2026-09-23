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
import { appendGitOperationSync } from '../git-activity.js';

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

/** Resolve a git ref to its SHA. Returns null if the ref does not exist. */
export async function gitRevParse(cwd: string, ref: string): Promise<string | null> {
  const ts = new Date().toISOString();
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', ref], { cwd, encoding: 'utf-8' });
    const sha = stdout.trim();
    appendGitOperationSync({ operation: 'rev_parse', branch: ref, issueId: undefined, afterSha: sha, status: 'success', ts });
    return sha || null;
  } catch {
    return null;
  }
}

/** Fetch from a remote. */
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
    appendGitOperationSync({
      operation: 'fetch',
      branch: branch ?? remote,
      issueId: opts.issueId,
      status: 'success',
      ts,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    appendGitOperationSync({
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
 * Push a branch to a remote with a divergence guard. Rejects with
 * {@link MainDivergedError} when the remote head is not an ancestor of the
 * local head, and with the git error otherwise.
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
      appendGitOperationSync({
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
    appendGitOperationSync({
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
    appendGitOperationSync({
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
