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
