import { readFile, rename, unlink } from 'node:fs/promises';

let claimCounter = 0;

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

export interface PendingLifecycleClaim {
  path: string;
  raw: string;
  discard(): Promise<void>;
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
    let discarded = false;
    return {
      path: claimPath,
      raw,
      discard: async () => {
        if (discarded) return;
        discarded = true;
        try {
          await unlink(claimPath);
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
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
