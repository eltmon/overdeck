import { exec, type ChildProcess, type ExecException } from 'child_process';
import { Effect } from 'effect';
import { cleanupStaleLocks } from '../git-utils.js';

export const GIT_OPERATION_HEADS = [
  'MERGE_HEAD',
  'REBASE_HEAD',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
] as const;

export class SyncGitCommandTimeoutError extends Error {
  readonly killed = true;

  constructor(
    public readonly command: string,
    public readonly budgetMs: number,
  ) {
    super(`${command} timed out after ${budgetMs / 1_000}s`);
    this.name = 'SyncGitCommandTimeoutError';
  }
}

export class SyncGitCommandAbortError extends Error {
  readonly code = 'ABORT_ERR';
  readonly killed = true;

  constructor(public readonly command: string) {
    super(`${command} was cancelled`);
    this.name = 'SyncGitCommandAbortError';
  }
}

export class UnsafeSyncMainStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeSyncMainStateError';
  }
}

interface SyncGitExecOptions {
  cwd: string;
  timeout: number;
  signal?: AbortSignal;
}

const execDetached = exec as unknown as (
  command: string,
  options: { cwd: string; encoding: BufferEncoding; detached: boolean; timeout: number },
  callback: (error: ExecException | null, stdout: string, stderr: string) => void,
) => ChildProcess;

function killCommandTree(child: ChildProcess | undefined): void {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    try { child.kill('SIGKILL'); } catch { /* process already exited */ }
  }
}

export function runSyncGitCommand(
  command: string,
  options: SyncGitExecOptions,
): Promise<{ stdout: string; stderr: string }> {
  if (options.signal?.aborted) return Promise.reject(new SyncGitCommandAbortError(command));

  return new Promise((resolve, reject) => {
    let child: ChildProcess | undefined;
    let termination: 'timeout' | 'abort' | undefined;
    const finishTermination = (kind: 'timeout' | 'abort') => {
      if (termination) return;
      termination = kind;
      killCommandTree(child);
    };
    const timeout = setTimeout(() => finishTermination('timeout'), options.timeout);
    const onAbort = () => finishTermination('abort');
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child = execDetached(command, {
      cwd: options.cwd,
      encoding: 'utf-8',
      detached: process.platform !== 'win32',
      timeout: options.timeout,
    }, (error, stdout, stderr) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
      if (termination === 'abort') {
        reject(Object.assign(new SyncGitCommandAbortError(command), { stdout, stderr }));
      } else if (termination === 'timeout') {
        reject(Object.assign(new SyncGitCommandTimeoutError(command, options.timeout), { stdout, stderr }));
      } else if (error?.killed) {
        reject(Object.assign(new SyncGitCommandTimeoutError(command, options.timeout), { stdout, stderr }));
      } else if (error) {
        reject(Object.assign(error, { stdout, stderr }));
      } else {
        resolve({ stdout, stderr });
      }
    });
    if (options.signal?.aborted) finishTermination('abort');
  });
}

export interface OperationHeadProbeResult {
  success: boolean;
  present: string[];
  reason?: string;
}

export async function probeGitOperationHeads(
  projectPath: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<OperationHeadProbeResult> {
  const present: string[] = [];
  for (const operationHead of GIT_OPERATION_HEADS) {
    try {
      await runSyncGitCommand(`git rev-parse -q --verify ${operationHead}`, {
        cwd: projectPath,
        timeout: timeoutMs,
        signal,
      });
      present.push(operationHead);
    } catch (error) {
      if (error instanceof SyncGitCommandAbortError) throw error;
      if (error instanceof SyncGitCommandTimeoutError) {
        return { success: false, present, reason: `${operationHead} probe timed out after ${timeoutMs / 1_000}s` };
      }
      if ((error as { code?: number | string } | null)?.code !== 1) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, present, reason: `${operationHead} probe failed: ${message}` };
      }
    }
  }
  return { success: true, present };
}

export async function ensureSyncGitQuiescent(
  projectPath: string,
  abortMerge: boolean,
  timeoutMs = 30_000,
): Promise<void> {
  let lockCleanup: { found: string[]; removed: string[]; errors: Array<{ file: string; error: string }> };
  try {
    lockCleanup = await Effect.runPromise(cleanupStaleLocks(projectPath));
  } catch (error) {
    throw new UnsafeSyncMainStateError(`Could not verify Git lock state after cancellation: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (lockCleanup.errors.length > 0) {
    throw new UnsafeSyncMainStateError(`Could not establish Git quiescence: ${lockCleanup.errors.map(({ file, error }) => `${file}: ${error}`).join('; ')}`);
  }

  const before = await probeGitOperationHeads(projectPath, timeoutMs);
  if (!before.success) throw new UnsafeSyncMainStateError(`Could not verify Git operation state: ${before.reason}`);
  const nonMergeHeads = before.present.filter((head) => head !== 'MERGE_HEAD');
  if (nonMergeHeads.length > 0 || (before.present.includes('MERGE_HEAD') && !abortMerge)) {
    throw new UnsafeSyncMainStateError(`Git operation remains active after cancellation: ${before.present.join(', ')}`);
  }
  if (before.present.includes('MERGE_HEAD')) {
    try {
      await runSyncGitCommand('git merge --abort', { cwd: projectPath, timeout: timeoutMs });
    } catch (error) {
      throw new UnsafeSyncMainStateError(`Could not abort timed-out sync merge: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const after = await probeGitOperationHeads(projectPath, timeoutMs);
  if (!after.success) throw new UnsafeSyncMainStateError(`Could not verify Git operation state after cleanup: ${after.reason}`);
  if (after.present.length > 0) throw new UnsafeSyncMainStateError(`Git operation remains active after cleanup: ${after.present.join(', ')}`);
}
