import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { parseIssueIdSync } from '../issue-id.js';
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
  const trimmedIssueId = issueId.trim();
  const parsedIssueId = parseIssueIdSync(trimmedIssueId);
  if (!parsedIssueId) {
    throw new Error(`Invalid issue ID for post-merge lifecycle lock: ${issueId}`);
  }

  const lockDir = resolve(OVERDECK_HOME, 'locks', 'post-merge-lifecycle');
  const lockPath = resolve(lockDir, `${parsedIssueId.normalized.toUpperCase()}.lock`);
  if (dirname(lockPath) !== lockDir) {
    throw new Error(`Post-merge lifecycle lock escaped its lock directory: ${issueId}`);
  }
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
