import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

import { getOverdeckHome } from '../paths.js';
import { acquireRecordLock, releaseRecordLock } from './fs-lock.js';

export const STATE_GIT_LOCK_RETRY_DELAYS_MS = [
  10,
  20,
  40,
  80,
  160,
  320,
  640,
  1_280,
  2_560,
  5_120,
  10_240,
  10_240,
] as const;

const processQueues = new Map<string, Promise<void>>();

/**
 * PAN-3848 (W23): the state git lock is keyed per issue, not per project. A
 * project-wide lock held across a network push starved peer writers (F1: one
 * patrol took it 23 times in 70 seconds and starved a spawn). The lock scope id
 * is the issue id for record writes; the agent-plane flush passes its own
 * per-agent scope.
 */
export function stateGitLockPath(gitRoot: string, issueId: string): string {
  const key = createHash('sha256').update(`${resolve(gitRoot)}::${issueId.toUpperCase()}`).digest('hex');
  return join(getOverdeckHome(), 'locks', 'state-git', `${key}.lock`);
}

export async function withStateGitLock<T>(
  gitRoot: string,
  issueId: string,
  writerId: string,
  recordPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = `${resolve(gitRoot)}::${issueId.toUpperCase()}`;
  const prior = processQueues.get(key) ?? Promise.resolve();
  let releaseQueue!: () => void;
  const gate = new Promise<void>((resolveGate) => {
    releaseQueue = resolveGate;
  });
  const tail = prior.catch(() => undefined).then(() => gate);
  processQueues.set(key, tail);

  await prior.catch(() => undefined);
  const lockPath = stateGitLockPath(gitRoot, issueId);
  try {
    await acquireRecordLock(lockPath, {
      writerId,
      recordPath,
      issueId,
      retryDelaysMs: STATE_GIT_LOCK_RETRY_DELAYS_MS,
    });
    try {
      return await operation();
    } finally {
      await releaseRecordLock(lockPath);
    }
  } finally {
    releaseQueue();
    if (processQueues.get(key) === tail) processQueues.delete(key);
  }
}
