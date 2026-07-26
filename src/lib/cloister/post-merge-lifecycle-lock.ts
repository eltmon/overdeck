import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { OVERDECK_HOME } from '../paths.js';

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

function isAlreadyExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'EEXIST';
}

export async function acquirePostMergeLifecycleLock(
  issueId: string,
): Promise<(() => Promise<void>) | null> {
  const lockDir = join(OVERDECK_HOME, 'locks', 'post-merge-lifecycle');
  const lockPath = join(lockDir, `${issueId.trim().toUpperCase()}.lock`);
  await mkdir(lockDir, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeFile(lockPath, String(process.pid), { flag: 'wx', mode: 0o600 });
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try {
          await unlink(lockPath);
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
      };
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      let ownerPid: number;
      try {
        ownerPid = Number.parseInt((await readFile(lockPath, 'utf-8')).trim(), 10);
      } catch (readError) {
        if (isMissing(readError)) continue;
        return null;
      }
      if (!Number.isInteger(ownerPid) || ownerPid <= 0 || isProcessAlive(ownerPid)) return null;
      try {
        await unlink(lockPath);
      } catch (unlinkError) {
        if (!isMissing(unlinkError)) return null;
      }
    }
  }
  return null;
}

export async function withPostMergeLifecycleLock<T>(
  issueId: string,
  run: () => Promise<T>,
): Promise<T> {
  const release = await acquirePostMergeLifecycleLock(issueId);
  if (!release) throw new Error(`postMergeLifecycle already running in another process for ${issueId}`);
  try {
    return await run();
  } finally {
    await release();
  }
}
