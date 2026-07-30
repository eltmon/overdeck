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

export function stateGitLockPath(gitRoot: string): string {
  const key = createHash('sha256').update(resolve(gitRoot)).digest('hex');
  return join(getOverdeckHome(), 'locks', 'state-git', `${key}.lock`);
}

export async function withStateGitLock<T>(
  gitRoot: string,
  writerId: string,
  recordPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = resolve(gitRoot);
  const prior = processQueues.get(key) ?? Promise.resolve();
  let releaseQueue!: () => void;
  const gate = new Promise<void>((resolveGate) => {
    releaseQueue = resolveGate;
  });
  const tail = prior.catch(() => undefined).then(() => gate);
  processQueues.set(key, tail);

  await prior.catch(() => undefined);
  const lockPath = stateGitLockPath(gitRoot);
  try {
    await acquireRecordLock(lockPath, {
      writerId,
      recordPath,
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
