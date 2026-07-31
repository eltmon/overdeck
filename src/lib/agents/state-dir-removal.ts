import { readdir, rm, rmdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface RemoveAgentStateDirResult {
  removedFiles: number;
  preservedTranscripts: number;
  /** true when the dir was fully removed (no transcripts existed) */
  removedDir: boolean;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code;
}

/**
 * The ONLY sanctioned way to delete or clean an agent state directory
 * (PAN-3357). Deletes runtime residue; preserves every transcript artifact
 * (any file matching **\/*.jsonl) in place, pruning empty subdirectories
 * that held only residue. If no transcript artifacts exist, removes the
 * directory entirely (byte-for-byte equivalent to the old rm -rf).
 */
export async function removeAgentStateDir(dirPath: string): Promise<RemoveAgentStateDirResult> {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return { removedFiles: 0, preservedTranscripts: 0, removedDir: true };
    }
    throw error;
  }

  let removedFiles = 0;
  let preservedTranscripts = 0;

  for (const entry of entries) {
    const entryPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const result = await removeAgentStateDir(entryPath);
      removedFiles += result.removedFiles;
      preservedTranscripts += result.preservedTranscripts;
    } else if (entry.name.endsWith('.jsonl')) {
      preservedTranscripts += 1;
    } else {
      await rm(entryPath, { recursive: true, force: true });
      removedFiles += 1;
    }
  }

  try {
    await rmdir(dirPath);
    return { removedFiles, preservedTranscripts, removedDir: true };
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return { removedFiles, preservedTranscripts, removedDir: true };
    }
    if (hasErrorCode(error, 'ENOTEMPTY') || hasErrorCode(error, 'EEXIST')) {
      return { removedFiles, preservedTranscripts, removedDir: false };
    }
    throw error;
  }
}
