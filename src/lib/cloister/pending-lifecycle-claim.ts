import { link, readFile, rename, unlink } from 'node:fs/promises';

import { resolveCanonicalReviewStatus } from './review-status-source.js';

let claimCounter = 0;

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

function isAlreadyExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'EEXIST';
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
  claimCounter += 1;
  const claimPath = `${pendingFile}.claimed-${process.pid}-${claimCounter}`;
  try {
    await rename(pendingFile, claimPath);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }

  try {
    const raw = await readFile(claimPath, 'utf-8');
    let settled = false;
    const removeClaim = async (): Promise<void> => {
      try {
        await unlink(claimPath);
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      settled = true;
    };
    return {
      path: claimPath,
      raw,
      discard: async () => {
        if (settled) return;
        await removeClaim();
      },
      restore: async () => {
        if (settled) return;
        try {
          await link(claimPath, pendingFile);
        } catch (error) {
          if (!isAlreadyExists(error)) throw error;
        }
        await removeClaim();
      },
    };
  } catch (error) {
    try {
      await unlink(claimPath);
    } catch {
      // Preserve the original read error.
    }
    throw error;
  }
}

export async function settlePendingLifecycleClaim(
  claim: PendingLifecycleClaim,
  issueId: string,
  succeeded: boolean,
): Promise<'discarded' | 'restored'> {
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
  return 'restored';
}
