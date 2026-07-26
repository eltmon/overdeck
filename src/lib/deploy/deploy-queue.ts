import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { getOverdeckHome } from '../paths.js';

export type PendingDeploy = {
  requestedAt: string;
  requestedBy: string[];
  lastReason: string;
  blockedBy: string[];
  deferralCount: number;
  escalated: boolean;
};

type DeployQueueOptions = {
  overdeckHome?: string;
};

type DeployIntent = {
  requestedBy: string;
  reason: string;
  blockedBy: string[];
};

const LOCK_RETRY_DELAYS_MS = [5, 10, 20, 40, 80, 160, 320, 360] as const;
const STALE_LOCK_MS = 30_000;

function pendingDeployPath(options: DeployQueueOptions = {}): string {
  return join(options.overdeckHome ?? getOverdeckHome(), 'pending-deploy.json');
}

function pendingDeployLockPath(options: DeployQueueOptions = {}): string {
  return join(options.overdeckHome ?? getOverdeckHome(), 'pending-deploy.lock');
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isPendingDeploy(value: unknown): value is PendingDeploy {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PendingDeploy>;
  return (
    typeof candidate.requestedAt === 'string'
    && isStringArray(candidate.requestedBy)
    && typeof candidate.lastReason === 'string'
    && isStringArray(candidate.blockedBy)
    && Number.isInteger(candidate.deferralCount)
    && candidate.deferralCount! >= 1
    && typeof candidate.escalated === 'boolean'
  );
}

function sortedUnion(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function isProcessDead(pid: number | undefined): boolean {
  if (!pid || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

async function removeStaleLock(lockPath: string): Promise<boolean> {
  try {
    const owner = JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8')) as {
      pid?: number;
      acquiredAt?: string;
    };
    const acquiredAt = owner.acquiredAt ? Date.parse(owner.acquiredAt) : Number.NaN;
    if (!isProcessDead(owner.pid) && Number.isFinite(acquiredAt) && Date.now() - acquiredAt <= STALE_LOCK_MS) {
      return false;
    }
  } catch {
    try {
      const lockStat = await stat(lockPath);
      if (Date.now() - lockStat.mtimeMs <= STALE_LOCK_MS) return false;
    } catch {
      return true;
    }
  }
  await rm(lockPath, { recursive: true, force: true });
  return true;
}

async function acquireQueueLock(options: DeployQueueOptions): Promise<string> {
  const path = pendingDeployPath(options);
  const lockPath = pendingDeployLockPath(options);
  await mkdir(dirname(path), { recursive: true });
  for (let attempt = 0; attempt <= LOCK_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await mkdir(lockPath);
      try {
        await writeFile(join(lockPath, 'owner.json'), JSON.stringify({
          pid: process.pid,
          acquiredAt: new Date().toISOString(),
        }));
      } catch (error) {
        await rm(lockPath, { recursive: true, force: true });
        throw error;
      }
      return lockPath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (await removeStaleLock(lockPath)) continue;
    }
    const delay = LOCK_RETRY_DELAYS_MS[attempt];
    if (delay === undefined) break;
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }
  throw new Error(`Timed out waiting for deploy queue lock ${lockPath}`);
}

async function withQueueLock<T>(options: DeployQueueOptions, operation: () => Promise<T>): Promise<T> {
  const lockPath = await acquireQueueLock(options);
  try {
    return await operation();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

async function writePendingDeploy(record: PendingDeploy, options: DeployQueueOptions = {}): Promise<void> {
  const path = pendingDeployPath(options);
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`);
  await rename(temp, path);
}

export async function readPendingDeploy(options: DeployQueueOptions = {}): Promise<PendingDeploy | null> {
  try {
    const parsed = JSON.parse(await readFile(pendingDeployPath(options), 'utf8')) as unknown;
    return isPendingDeploy(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function recordDeployIntent(
  intent: DeployIntent,
  options: DeployQueueOptions = {},
): Promise<PendingDeploy> {
  return withQueueLock(options, async () => {
    const existing = await readPendingDeploy(options);
    const record: PendingDeploy = existing
      ? {
        ...existing,
        requestedBy: sortedUnion([...existing.requestedBy, intent.requestedBy]),
        lastReason: intent.reason,
        blockedBy: sortedUnion([...existing.blockedBy, ...intent.blockedBy]),
        deferralCount: existing.deferralCount + 1,
      }
      : {
        requestedAt: new Date().toISOString(),
        requestedBy: [intent.requestedBy],
        lastReason: intent.reason,
        blockedBy: sortedUnion(intent.blockedBy),
        deferralCount: 1,
        escalated: false,
      };
    await writePendingDeploy(record, options);
    return record;
  });
}

export async function clearPendingDeploy(options: DeployQueueOptions = {}): Promise<void> {
  await withQueueLock(options, async () => {
    await rm(pendingDeployPath(options), { force: true });
  });
}

export async function markPendingDeployEscalated(options: DeployQueueOptions = {}): Promise<void> {
  await withQueueLock(options, async () => {
    const existing = await readPendingDeploy(options);
    if (!existing) return;
    await writePendingDeploy({ ...existing, escalated: true }, options);
  });
}
