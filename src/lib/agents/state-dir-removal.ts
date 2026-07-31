import { lstat, readdir, realpath, rmdir, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { AGENTS_DIR } from '../paths.js';

export interface RemoveAgentStateDirResult {
  removedFiles: number;
  preservedTranscripts: number;
  /** true when the dir was fully removed (no transcripts existed) */
  removedDir: boolean;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code;
}

function isContained(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot !== '' &&
    pathFromRoot !== '..' &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot);
}

function assertContained(root: string, candidate: string): void {
  if (!isContained(root, candidate)) {
    throw new Error(`removeAgentStateDir: path escapes AGENTS_DIR: ${candidate}`);
  }
}

async function cleanDirectory(
  dirPath: string,
  canonicalRoot: string,
  isRoot: boolean,
): Promise<RemoveAgentStateDirResult> {
  let pathStat;
  try {
    pathStat = await lstat(dirPath);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return { removedFiles: 0, preservedTranscripts: 0, removedDir: true };
    }
    throw error;
  }

  if (pathStat.isSymbolicLink()) {
    if (isRoot) {
      throw new Error(`removeAgentStateDir: refusing symbolic-link root: ${dirPath}`);
    }
    await unlink(dirPath);
    return { removedFiles: 1, preservedTranscripts: 0, removedDir: true };
  }
  if (!pathStat.isDirectory()) {
    throw new Error(`removeAgentStateDir: expected directory: ${dirPath}`);
  }

  const canonicalDir = await realpath(dirPath);
  assertContained(canonicalRoot, canonicalDir);
  const entries = await readdir(dirPath, { withFileTypes: true });
  let removedFiles = 0;
  let preservedTranscripts = 0;

  for (const entry of entries) {
    const entryPath = join(dirPath, entry.name);
    if (entry.isSymbolicLink()) {
      await unlink(entryPath);
      removedFiles += 1;
    } else if (entry.isDirectory()) {
      const result = await cleanDirectory(entryPath, canonicalRoot, false);
      removedFiles += result.removedFiles;
      preservedTranscripts += result.preservedTranscripts;
    } else if (entry.name.endsWith('.jsonl')) {
      preservedTranscripts += 1;
    } else {
      await unlink(entryPath);
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

/**
 * The ONLY sanctioned way to delete or clean an agent state directory
 * (PAN-3357). Deletes runtime residue; preserves every transcript artifact
 * (any regular file matching **\/*.jsonl) in place, pruning empty
 * subdirectories that held only residue. Symbolic links are never traversed.
 */
export async function removeAgentStateDir(
  dirPath: string,
  agentsRootPath: string = AGENTS_DIR,
): Promise<RemoveAgentStateDirResult> {
  const agentsRoot = resolve(agentsRootPath);
  const candidate = resolve(dirPath);
  assertContained(agentsRoot, candidate);
  if (relative(agentsRoot, candidate).includes(sep)) {
    throw new Error(`removeAgentStateDir: expected direct child of AGENTS_DIR: ${candidate}`);
  }

  let candidateStat;
  try {
    candidateStat = await lstat(candidate);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return { removedFiles: 0, preservedTranscripts: 0, removedDir: true };
    }
    throw error;
  }
  if (candidateStat.isSymbolicLink()) {
    throw new Error(`removeAgentStateDir: refusing symbolic-link root: ${candidate}`);
  }
  if (!candidateStat.isDirectory()) {
    throw new Error(`removeAgentStateDir: expected directory: ${candidate}`);
  }

  const [canonicalRoot, canonicalCandidate] = await Promise.all([
    realpath(agentsRoot),
    realpath(candidate),
  ]);
  assertContained(canonicalRoot, canonicalCandidate);
  if (relative(canonicalRoot, canonicalCandidate).includes(sep)) {
    throw new Error(`removeAgentStateDir: canonical path is not a direct child of AGENTS_DIR: ${canonicalCandidate}`);
  }

  return cleanDirectory(candidate, canonicalRoot, true);
}
