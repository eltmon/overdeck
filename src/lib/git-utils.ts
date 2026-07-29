/**
 * Git utilities for handling common git operations and recovery
 */

import { existsSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  exec,
  execFile,
  type ChildProcess,
  type ExecException,
} from 'child_process';
import { promisify } from 'util';
import { Effect } from 'effect';
import { GitError, FsError } from './errors.js';

const execAsync = promisify(exec);
const DEFAULT_PROCESS_PROBE_TIMEOUT_MS = 30_000;

export interface StaleLockCleanupOptions {
  signal?: AbortSignal;
  processProbeTimeoutMs?: number;
}

type GitProcessProbeResult =
  | { status: 'running' | 'idle' }
  | { status: 'inconclusive'; reason: string };

class ProcessProbeTerminationError extends Error {
  constructor(
    public readonly command: string,
    public readonly kind: 'abort' | 'timeout',
    public readonly budgetMs: number,
  ) {
    super(kind === 'abort'
      ? `${command} was cancelled`
      : `${command} timed out after ${budgetMs / 1_000}s`);
    this.name = 'ProcessProbeTerminationError';
  }
}

const execFileDetached = execFile as unknown as (
  file: string,
  args: string[],
  options: { cwd: string; encoding: BufferEncoding; detached: boolean },
  callback: (error: ExecException | null, stdout: string, stderr: string) => void,
) => ChildProcess;

function killProcessTree(child: ChildProcess | undefined): void {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    try { child.kill('SIGKILL'); } catch { /* process already exited */ }
  }
}

function runProcessProbe(
  file: string,
  args: string[],
  repoPath: string,
  options: Required<Pick<StaleLockCleanupOptions, 'processProbeTimeoutMs'>>
    & Pick<StaleLockCleanupOptions, 'signal'>,
): Promise<string> {
  const command = `${file} ${args.join(' ')}`;
  if (options.signal?.aborted) {
    return Promise.reject(new ProcessProbeTerminationError(
      command,
      'abort',
      options.processProbeTimeoutMs,
    ));
  }

  return new Promise((resolve, reject) => {
    let child: ChildProcess | undefined;
    let termination: 'abort' | 'timeout' | undefined;
    const terminate = (kind: 'abort' | 'timeout') => {
      if (termination) return;
      termination = kind;
      killProcessTree(child);
    };
    const timeout = setTimeout(
      () => terminate('timeout'),
      options.processProbeTimeoutMs,
    );
    const onAbort = () => terminate('abort');
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child = execFileDetached(file, args, {
      cwd: repoPath,
      encoding: 'utf-8',
      detached: process.platform !== 'win32',
    }, (error, stdout, stderr) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
      if (termination) {
        reject(Object.assign(new ProcessProbeTerminationError(
          command,
          termination,
          options.processProbeTimeoutMs,
        ), { stdout, stderr }));
      } else if (error) {
        reject(Object.assign(error, { stdout, stderr }));
      } else {
        resolve(stdout);
      }
    });

    if (options.signal?.aborted) terminate('abort');
  });
}

function probeErrorReason(command: string, error: unknown): string {
  if (error instanceof ProcessProbeTerminationError) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  return `${command} failed: ${message}`;
}

/** Check whether a repository has active Git processes without guessing on probe failure. */
async function hasRunningGitProcesses(
  repoPath: string,
  options: StaleLockCleanupOptions,
): Promise<GitProcessProbeResult> {
  const probeOptions = {
    signal: options.signal,
    processProbeTimeoutMs:
      options.processProbeTimeoutMs ?? DEFAULT_PROCESS_PROBE_TIMEOUT_MS,
  };

  try {
    const stdout = await runProcessProbe(
      'fuser',
      [join(repoPath, '.git')],
      repoPath,
      probeOptions,
    );
    return { status: stdout.trim() ? 'running' : 'idle' };
  } catch (error) {
    const code = (error as { code?: number | string } | null)?.code;
    if (code === 1) return { status: 'idle' };
    if (code !== 127 && code !== 'ENOENT') {
      return { status: 'inconclusive', reason: probeErrorReason('fuser', error) };
    }
  }

  try {
    const stdout = await runProcessProbe(
      'ps',
      ['-eo', 'args='],
      repoPath,
      probeOptions,
    );
    const running = stdout.split('\n').some((line) =>
      line.includes('git') && line.includes(repoPath));
    return { status: running ? 'running' : 'idle' };
  } catch (error) {
    return { status: 'inconclusive', reason: probeErrorReason('ps', error) };
  }
}

/**
 * Find all git lock files in a repository
 */
function findGitLockFiles(repoPath: string): string[] {
  const lockFiles: string[] = [];

  // Check for index.lock in .git directory
  const indexLock = join(repoPath, '.git', 'index.lock');
  if (existsSync(indexLock)) {
    lockFiles.push(indexLock);
  }

  // Check for ref locks in .git/refs
  const refsDir = join(repoPath, '.git', 'refs');
  if (existsSync(refsDir)) {
    const findLocksRecursive = (dir: string) => {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          findLocksRecursive(fullPath);
        } else if (entry.name.endsWith('.lock')) {
          lockFiles.push(fullPath);
        }
      }
    };
    try {
      findLocksRecursive(refsDir);
    } catch {
      // Ignore errors reading refs directory
    }
  }

  return lockFiles;
}

async function cleanupStaleLocksPromise(
  repoPath: string,
  options: StaleLockCleanupOptions,
): Promise<{
  found: string[];
  removed: string[];
  errors: Array<{ file: string; error: string }>;
}> {
  const result = {
    found: [] as string[],
    removed: [] as string[],
    errors: [] as Array<{ file: string; error: string }>,
  };

  // Find all lock files
  const lockFiles = findGitLockFiles(repoPath);
  result.found = lockFiles;

  if (lockFiles.length === 0) {
    return result;
  }

  const processProbe = await hasRunningGitProcesses(repoPath, options);

  if (processProbe.status === 'running') {
    result.errors.push({
      file: 'N/A',
      error: 'Git processes are running - not safe to remove locks',
    });
    return result;
  }
  if (processProbe.status === 'inconclusive') {
    result.errors.push({
      file: 'N/A',
      error: `Could not verify Git process state: ${processProbe.reason}`,
    });
    return result;
  }

  // Remove stale lock files
  for (const lockFile of lockFiles) {
    try {
      unlinkSync(lockFile);
      result.removed.push(lockFile);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      result.errors.push({ file: lockFile, error: msg });
    }
  }

  return result;
}

/**
 * Result of getWorkspaceGitInfo.
 * Note: `branch` is the branch name (not a hash) despite the parent function name.
 */
export interface WorkspaceCommitInfo {
  /** Full SHA of the HEAD commit */
  HEAD: string;
  /** Current branch name (e.g. "feature/pan-342") */
  branch: string;
}

export interface WorkspaceHeadAnchorEntry {
  repoKey: string;
  sha: string;
}

export type WorkspaceGitShow = (
  repoPath: string,
  sha: string,
  args: string[],
) => Promise<string>;

/**
 * Parse a polyrepo head anchor such as `fe@<sha> api@<sha>`.
 * Plain single-repo refs return null. Malformed composite anchors fail before
 * any caller can accidentally pass the whitespace-containing value to git.
 */
export function parseWorkspaceHeadAnchor(anchor: string): WorkspaceHeadAnchorEntry[] | null {
  const normalized = anchor.trim();
  if (!normalized.includes('@')) {
    if (/\s/.test(normalized)) {
      throw new Error(`Invalid workspace head anchor: ${anchor}`);
    }
    return null;
  }

  const entries = normalized.split(/\s+/).map((token) => {
    const match = /^([^@\s]+)@([0-9a-fA-F]{40,64})$/.exec(token);
    if (!match) {
      throw new Error(`Invalid workspace head anchor token '${token}' in '${anchor}'`);
    }
    return { repoKey: match[1], sha: match[2] };
  });

  return entries;
}

/**
 * Render `git show` for a single-repo ref or every entry in a polyrepo anchor.
 * Composite entries are resolved to their nested worktree and labeled using
 * the same repo-section convention as review and inspect diff summaries.
 */
export async function renderWorkspaceGitShowPromise(
  issueId: string | undefined,
  workspacePath: string,
  anchor: string,
  args: string[],
  gitShow: WorkspaceGitShow,
): Promise<string> {
  const entries = parseWorkspaceHeadAnchor(anchor);
  if (!entries) return gitShow(workspacePath, anchor.trim(), args);
  if (!issueId) {
    throw new Error(`Cannot resolve composite workspace head anchor '${anchor}' without an issue id`);
  }

  const { resolveWorkspaceRepoRootsSync } = await import('./project-repos.js');
  const rootsByKey = new Map(
    resolveWorkspaceRepoRootsSync(issueId, workspacePath).map(root => [root.repoKey, root]),
  );

  const sections = await Promise.all(entries.map(async ({ repoKey, sha }) => {
    const root = rootsByKey.get(repoKey);
    if (!root) {
      throw new Error(`Composite workspace head anchor repo '${repoKey}' was not found in ${workspacePath}`);
    }
    const diff = await gitShow(root.dir, sha, args);
    return `── ${repoKey} ──\n${diff.trimEnd()}`;
  }));

  return sections.join('\n');
}

async function getWorkspaceGitInfoPromise(workspacePath: string): Promise<WorkspaceCommitInfo> {
  try {
    const [headResult, branchResult] = await Promise.all([
      execAsync('git rev-parse HEAD', { cwd: workspacePath }),
      execAsync('git rev-parse --abbrev-ref HEAD', { cwd: workspacePath }),
    ]);
    return {
      HEAD: headResult.stdout.trim(),
      branch: branchResult.stdout.trim(),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`getWorkspaceGitInfo failed for ${workspacePath}: ${msg}`);
  }
}

declare const headAnchorBrand: unique symbol;

/** A producer-issued snapshot of every code HEAD in a workspace. */
export type HeadAnchor = string & { readonly [headAnchorBrand]: true };

/** Rehydrate a persisted anchor after it crosses an unbranded storage boundary. */
export function rehydrateHeadAnchor(anchor: string): HeadAnchor {
  return anchor as HeadAnchor;
}

export function parseCompositeSnapshot(snapshot: string | undefined): Map<string, string> {
  const heads = new Map<string, string>();
  if (!snapshot) return heads;
  for (const token of snapshot.split(/\s+/)) {
    const separator = token.lastIndexOf('@');
    if (separator <= 0 || separator === token.length - 1) continue;
    heads.set(token.slice(0, separator), token.slice(separator + 1));
  }
  return heads;
}

export function formatAnchorShort(anchor: string): string {
  return anchor.split(/\s+/).map((token) => {
    const separator = token.lastIndexOf('@');
    if (separator <= 0 || separator === token.length - 1) return token.substring(0, 8);
    return `${token.slice(0, separator)}@${token.slice(separator + 1, separator + 9)}`;
  }).join(' ');
}

/**
 * Snapshot the code HEAD(s) of a workspace for drift comparison (PAN-2948).
 *
 * Monorepo: returns the workspace HEAD SHA (unchanged behavior). Polyrepo:
 * returns a composite `fe@<sha> api@<sha>` over the sub-repo worktrees —
 * the wrapper repo at the workspace root is a one-commit artifacts repo whose
 * SHA never changes, so snapshotting it makes every drift comparison
 * (reviewedAtCommit vs lastVerifiedCommit, reviewer verdict anchors) report
 * "no drift" forever. Composite snapshots compare equal iff every sub-repo
 * head is unchanged; consumers that try to use the anchor as a git ref fail
 * the ref lookup and fall back to their conservative full-rerun path.
 *
 * Its branded return value is the only legitimate source for reviewedAtCommit,
 * lastVerifiedCommit, and roleRunHead. Persisted values regain that brand only
 * through rehydrateHeadAnchor at an explicitly documented storage boundary.
 */
export async function snapshotWorkspaceHeadsPromise(issueId: string, workspacePath: string): Promise<HeadAnchor | undefined> {
  // Dynamic import: project-repos → projects sits above this low-level module
  // in the layering; a static edge here would risk a require cycle.
  const { resolveWorkspaceRepoRootsSync } = await import('./project-repos.js');
  const roots = resolveWorkspaceRepoRootsSync(issueId, workspacePath);
  // PAN-3254: a degraded polyrepo resolution would snapshot the wrapper repo,
  // whose HEAD never moves — every drift comparison against a real composite
  // anchor then false-drifts forever (426 review cycles on MIN-901). No
  // snapshot → consumers take their conservative unreadable/skip path.
  if (roots.some(root => root.degradedPolyrepo)) return undefined;
  const isPolyrepo = roots.some(root => root.isPolyrepo);
  const heads: string[] = [];
  for (const root of roots) {
    try {
      const { stdout } = await execAsync('git rev-parse HEAD', { cwd: root.dir, encoding: 'utf-8', timeout: 10_000 });
      const sha = stdout.trim();
      if (sha) heads.push(isPolyrepo ? `${root.repoKey}@${sha}` : sha);
    } catch { /* unreadable root — omit from the snapshot */ }
  }
  return heads.length > 0 ? heads.join(' ') as HeadAnchor : undefined;
}

async function hasStaleLocksPromise(repoPath: string): Promise<boolean> {
  const lockFiles = findGitLockFiles(repoPath);
  if (lockFiles.length === 0) {
    return false;
  }

  const processProbe = await hasRunningGitProcesses(repoPath, {});
  return processProbe.status === 'idle';
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/**
 * Effect-native cleanupStaleLocks. Removes stale `*.lock` files in `.git/`
 * when no git processes hold the repo. Fails with FsError if lock removal
 * throws unexpectedly (e.g. permission denied at unlink); per-file errors
 * are reported in the `errors` payload like the original.
 */
export const cleanupStaleLocks = (
  repoPath: string,
  options: StaleLockCleanupOptions = {},
): Effect.Effect<
  {
    found: string[];
    removed: string[];
    errors: Array<{ file: string; error: string }>;
  },
  FsError
> =>
  Effect.tryPromise({
    try: () => cleanupStaleLocksPromise(repoPath, options),
    catch: (cause) =>
      new FsError({ path: repoPath, operation: 'cleanupStaleLocks', cause }),
  });

/**
 * Effect-native getWorkspaceGitInfo. Returns the HEAD SHA and current branch
 * name. Fails with GitError if rev-parse exits non-zero (e.g. path is not a
 * git repository).
 */
export const getWorkspaceGitInfo = (
  workspacePath: string,
): Effect.Effect<WorkspaceCommitInfo, GitError> =>
  Effect.tryPromise({
    try: () => getWorkspaceGitInfoPromise(workspacePath),
    catch: (cause) =>
      new GitError({
        command: ['rev-parse', 'HEAD'],
        stderr: cause instanceof Error ? cause.message : String(cause),
        exitCode: -1,
        cause,
      }),
  });

/**
 * Effect-native hasStaleLocks — predicate variant. Never fails; defers to
 * the Promise implementation which already swallows errors conservatively.
 */
export const hasStaleLocks = (
  repoPath: string,
): Effect.Effect<boolean, never> =>
  Effect.promise(() => hasStaleLocksPromise(repoPath));
