import { randomUUID } from 'node:crypto';
import { readdir, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { resolveCanonicalReviewStatus } from './review-status-source.js';

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function findRecoverableLifecycleFiles(pendingFile: string): Promise<string[]> {
  const directory = dirname(pendingFile);
  const name = basename(pendingFile);
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }

  const queuedPrefix = `${name}.queued-`;
  const claimedPrefix = `${name}.claimed-`;
  const queued: string[] = [];
  const abandoned: string[] = [];
  for (const entry of entries.sort()) {
    if (entry.startsWith(queuedPrefix)) {
      queued.push(join(directory, entry));
      continue;
    }
    if (!entry.startsWith(claimedPrefix)) continue;
    const ownerPid = Number.parseInt(entry.slice(claimedPrefix.length).split('-')[0], 10);
    if (Number.isInteger(ownerPid) && ownerPid > 0 && !isProcessAlive(ownerPid)) {
      abandoned.push(join(directory, entry));
    }
  }
  return [...queued, ...abandoned];
}

async function acquireClaimPath(pendingFile: string, claimPath: string): Promise<boolean> {
  try {
    await rename(pendingFile, claimPath);
    return true;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  for (const recoverablePath of await findRecoverableLifecycleFiles(pendingFile)) {
    try {
      await rename(recoverablePath, claimPath);
      return true;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  return false;
}

export interface PendingLifecycleClaim {
  path: string;
  raw: string;
  discard(): Promise<void>;
  restore(): Promise<void>;
}

export async function claimPendingLifecycleFile(
  pendingFile: string,
): Promise<PendingLifecycleClaim | null> {
  const claimPath = `${pendingFile}.claimed-${process.pid}-${randomUUID()}`;
  if (!await acquireClaimPath(pendingFile, claimPath)) return null;

  let settled = false;
  const removeClaim = async (): Promise<void> => {
    try {
      await unlink(claimPath);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    settled = true;
  };
  const queueClaim = async (): Promise<void> => {
    const queuedPath = `${pendingFile}.queued-${randomUUID()}`;
    await rename(claimPath, queuedPath);
    settled = true;
  };

  try {
    const raw = await readFile(claimPath, 'utf-8');
    return {
      path: claimPath,
      raw,
      discard: async () => {
        if (settled) return;
        await removeClaim();
      },
      restore: async () => {
        if (settled) return;
        await queueClaim();
      },
    };
  } catch (error) {
    try {
      await queueClaim();
    } catch {
      // Preserve the claimed artifact and the original read error.
    }
    throw error;
  }
}

export async function settlePendingLifecycleClaim(
  claim: PendingLifecycleClaim,
  issueId: string,
  succeeded: boolean,
): Promise<'discarded' | 'queued'> {
  if (succeeded) {
    await claim.discard();
    return 'discarded';
  }

  const canonical = resolveCanonicalReviewStatus(issueId);
  const durableRetryOwner = canonical.available
    && canonical.status?.mergeStatus === 'merged'
    && (canonical.status.mergeStep === 'post-merge-cleanup'
      || canonical.status.mergeStep === 'merged');
  if (durableRetryOwner) {
    await claim.discard();
    return 'discarded';
  }

  await claim.restore();
  return 'queued';
}
