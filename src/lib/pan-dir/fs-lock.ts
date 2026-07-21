/** Cross-process per-issue record locking (PAN-2648 CD-2). */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { getOverdeckHome } from '../paths.js';
import { listProjectsSync, type ProjectConfig } from '../projects.js';

export const RECORD_LOCK_RETRY_DELAYS_MS = [5, 10, 20, 40, 80, 160, 320, 360] as const;

export interface RecordLockOwner {
  writerId: string;
  pid: number;
  acquiredAt: string;
}

export interface RecordLockOptions {
  writerId: string;
  recordPath: string;
  retryDelaysMs?: readonly number[];
}

export class RecordLockError extends Error {
  constructor(
    public readonly lockPath: string,
    public readonly owner: string,
  ) {
    super(`The per-issue record lock at ${lockPath} is held by ${owner}. Retry the command after that writer finishes.`);
    this.name = 'RecordLockError';
  }
}

function safeSegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
}

export function recordLockPath(project: ProjectConfig, issueId: string): string {
  const configuredKey = listProjectsSync().find(({ config }) => config.path === project.path)?.key;
  const projectKey = safeSegment(configuredKey ?? project.name ?? project.path) || 'unknown-project';
  return join(getOverdeckHome(), 'locks', 'records', projectKey, `${issueId.toUpperCase()}.lock`);
}

export function isPidDead(pid: number | undefined): boolean {
  if (!pid || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

async function sweepRecordTmpFiles(recordPath: string): Promise<void> {
  try {
    const dir = dirname(recordPath);
    const base = recordPath.slice(dir.length + 1);
    const entries = await readdir(dir);
    await Promise.all(entries
      .filter((entry) => entry.startsWith(`${base}.`) && entry.endsWith('.tmp'))
      .map((entry) => rm(join(dir, entry), { force: true })));
  } catch {
    // A first record write has no directory or transaction files to sweep.
  }
}

async function readOwner(lockPath: string): Promise<{ description: string; pid?: number }> {
  try {
    const owner = JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8')) as Partial<RecordLockOwner>;
    return {
      description: `${owner.writerId ?? 'unknown writer'} pid=${owner.pid ?? 'unknown'} acquiredAt=${owner.acquiredAt ?? 'unknown'}`,
      pid: owner.pid,
    };
  } catch {
    return { description: 'unknown writer' };
  }
}

export async function acquireRecordLock(lockPath: string, options: RecordLockOptions): Promise<RecordLockOwner> {
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
  const delays = options.retryDelaysMs ?? RECORD_LOCK_RETRY_DELAYS_MS;
  let lastOwner = 'unknown writer';

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      const owner = { writerId: options.writerId, pid: process.pid, acquiredAt: new Date().toISOString() };
      try {
        await writeFile(join(lockPath, 'owner.json'), JSON.stringify(owner, null, 2), 'utf8');
      } catch (error) {
        try { await rm(lockPath, { recursive: true, force: true }); } catch { /* best effort */ }
        throw error;
      }
      await sweepRecordTmpFiles(options.recordPath);
      return owner;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const owner = await readOwner(lockPath);
      lastOwner = owner.description;
      if (isPidDead(owner.pid)) {
        await rm(lockPath, { recursive: true, force: true });
        continue;
      }
    }

    const delay = delays[attempt];
    if (delay === undefined) break;
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }
  throw new RecordLockError(lockPath, lastOwner);
}

export async function releaseRecordLock(lockPath: string): Promise<void> {
  await rm(lockPath, { recursive: true, force: true });
}

export async function withRecordFsLock<T>(
  project: ProjectConfig,
  issueId: string,
  options: RecordLockOptions,
  operation: () => Promise<T>,
): Promise<T> {
  const lockPath = recordLockPath(project, issueId);
  await acquireRecordLock(lockPath, options);
  try {
    return await operation();
  } finally {
    await releaseRecordLock(lockPath);
  }
}
