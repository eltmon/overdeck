import { statfs } from 'node:fs/promises';

const GIB = 1024 ** 3;

export const DISK_SAFETY_FLOOR_BYTES = 10 * GIB;

export async function readAvailableBytes(path: string): Promise<number> {
  const stats = await statfs(path);
  return stats.bavail * stats.bsize;
}

/**
 * Refuse an operation before it can run the filesystem out of space:
 * ENOSPC mid-write zero-fills files rather than failing cleanly (PAN-1674
 * truncated ~/.claude.json this way), so this checks ahead of time instead
 * of only warning.
 */
export async function checkDiskFloor(path: string, read: (path: string) => Promise<number> = readAvailableBytes): Promise<string | null> {
  let availableBytes: number;
  try {
    availableBytes = await read(path);
  } catch {
    return null;
  }

  if (availableBytes >= DISK_SAFETY_FLOOR_BYTES) {
    return null;
  }

  const availableGib = (availableBytes / GIB).toFixed(1);
  return `Only ${availableGib} GiB free on the filesystem holding ${path}; workspace creation needs at least 10.0 GiB. Free disk space (see /resources) and retry.`;
}
