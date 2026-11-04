/**
 * Agent-state cleanup doors.
 *
 * Close-out pruning keeps durable state and transcripts, removing only direct
 * regenerable children. Full removal remains a separate retention-owned door.
 */
import { lstat, readdir, realpath, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { AGENTS_DIR } from '../paths.js';

export interface RemoveAgentStateDirResult {
  removedFiles: number;
  preservedTranscripts: number;
  /** true when the dir was fully removed (no transcripts existed) */
  removedDir: boolean;
}

export interface PruneAgentStateDirResult { kept: string[]; removed: string[]; bytesFreed: number }

export const RETAINED_TRANSCRIPTS_MARKER = '.retained-transcripts';

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

async function listKeptFiles(dirPath: string, root: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const kept: string[] = [];
  for (const entry of entries) {
    const entryPath = join(dirPath, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      kept.push(...await listKeptFiles(entryPath, root));
    } else {
      kept.push(relative(root, entryPath));
    }
  }
  return kept;
}

async function validateDirectDeletion(parent: string, path: string): Promise<number> {
  if (relative(parent, path).includes(sep)) {
    throw new Error(`pruneAgentStateDir: expected direct child: ${path}`);
  }
  const pathStat = await lstat(path);
  if (pathStat.isSymbolicLink()) {
    throw new Error(`pruneAgentStateDir: refusing symbolic-link child: ${path}`);
  }
  const canonicalPath = await realpath(path);
  assertContained(parent, canonicalPath);
  if (relative(parent, canonicalPath).includes(sep)) {
    throw new Error(`pruneAgentStateDir: canonical path is not a direct child: ${canonicalPath}`);
  }
  return pathStat.size;
}

export async function pruneAgentStateDir(
  dirPath: string,
  agentsRootPath: string = AGENTS_DIR,
): Promise<PruneAgentStateDirResult> {
  const agentsRoot = resolve(agentsRootPath);
  const candidate = resolve(dirPath);
  assertContained(agentsRoot, candidate);
  if (relative(agentsRoot, candidate).includes(sep)) {
    throw new Error(`pruneAgentStateDir: expected direct child of AGENTS_DIR: ${candidate}`);
  }

  let candidateStat;
  try {
    candidateStat = await lstat(candidate);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return { kept: [], removed: [], bytesFreed: 0 };
    throw error;
  }
  if (candidateStat.isSymbolicLink()) {
    throw new Error(`pruneAgentStateDir: refusing symbolic-link root: ${candidate}`);
  }
  if (!candidateStat.isDirectory()) {
    throw new Error(`pruneAgentStateDir: expected directory: ${candidate}`);
  }

  const [canonicalRoot, canonicalCandidate] = await Promise.all([realpath(agentsRoot), realpath(candidate)]);
  assertContained(canonicalRoot, canonicalCandidate);
  if (relative(canonicalRoot, canonicalCandidate).includes(sep)) {
    throw new Error(`pruneAgentStateDir: canonical path is not a direct child of AGENTS_DIR: ${canonicalCandidate}`);
  }

  const removed: string[] = [];
  let bytesFreed = 0;
  const entries = await readdir(candidate, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(canonicalCandidate, entry.name);
    if (entry.name === 'pending.lock' || entry.name.endsWith('.sock')) {
      bytesFreed += await validateDirectDeletion(canonicalCandidate, entryPath);
      await rm(entryPath, { recursive: true, force: true });
      removed.push(entry.name);
      continue;
    }
    if (!entry.isDirectory() || !entry.name.startsWith('codex-home')) continue;

    await validateDirectDeletion(canonicalCandidate, entryPath);
    const canonicalCodexHome = await realpath(entryPath);
    for (const child of await readdir(entryPath, { withFileTypes: true })) {
      if (child.name === 'sessions') continue;
      const childPath = join(entryPath, child.name);
      bytesFreed += await validateDirectDeletion(canonicalCodexHome, childPath);
      await rm(childPath, { recursive: true, force: true });
      removed.push(relative(canonicalCandidate, childPath));
    }
  }

  return { kept: (await listKeptFiles(candidate, candidate)).sort(), removed: removed.sort(), bytesFreed };
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

export async function hasRetainedTranscriptsMarker(dirPath: string): Promise<boolean> {
  try {
    return (await lstat(join(dirPath, RETAINED_TRANSCRIPTS_MARKER))).isFile();
  } catch {
    return false;
  }
}

export async function markRetainedTranscripts(dirPath: string): Promise<void> {
  try {
    await writeFile(join(dirPath, RETAINED_TRANSCRIPTS_MARKER), '', { flag: 'wx' });
  } catch (error) {
    if (!hasErrorCode(error, 'EEXIST') && !hasErrorCode(error, 'ENOENT')) throw error;
  }
}

async function collectAgentStateFilesForRemoval(
  dirPath: string,
  canonicalRoot: string,
  candidateRoot: string,
): Promise<string[]> {
  const canonicalDir = await realpath(dirPath);
  assertContained(canonicalRoot, canonicalDir);
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = join(dirPath, entry.name);
    if (entry.isSymbolicLink()) {
      files.push(relative(candidateRoot, entryPath));
    } else if (entry.isDirectory()) {
      files.push(...await collectAgentStateFilesForRemoval(
        entryPath,
        canonicalRoot,
        candidateRoot,
      ));
    } else if (!entry.name.endsWith('.jsonl')) {
      files.push(relative(candidateRoot, entryPath));
    }
  }
  return files;
}

/** List the runtime files the sanctioned cleanup door would remove. */
export async function listAgentStateFilesForRemoval(
  dirPath: string,
  agentsRootPath: string = AGENTS_DIR,
): Promise<string[]> {
  const agentsRoot = resolve(agentsRootPath);
  const candidate = resolve(dirPath);
  assertContained(agentsRoot, candidate);
  if (relative(agentsRoot, candidate).includes(sep)) {
    throw new Error(`listAgentStateFilesForRemoval: expected direct child of AGENTS_DIR: ${candidate}`);
  }

  try {
    const candidateStat = await lstat(candidate);
    if (candidateStat.isSymbolicLink()) {
      throw new Error(`listAgentStateFilesForRemoval: refusing symbolic-link root: ${candidate}`);
    }
    if (!candidateStat.isDirectory()) {
      throw new Error(`listAgentStateFilesForRemoval: expected directory: ${candidate}`);
    }
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return [];
    throw error;
  }

  const [canonicalRoot, canonicalCandidate] = await Promise.all([
    realpath(agentsRoot),
    realpath(candidate),
  ]);
  assertContained(canonicalRoot, canonicalCandidate);
  if (relative(canonicalRoot, canonicalCandidate).includes(sep)) {
    throw new Error(`listAgentStateFilesForRemoval: canonical path is not a direct child of AGENTS_DIR: ${canonicalCandidate}`);
  }
  return (await collectAgentStateFilesForRemoval(
    candidate,
    canonicalRoot,
    candidate,
  )).sort();
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

const CODEX_CACHE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * PAN-4727: remove one plugin's copy from every agent's Codex plugin cache,
 * `<agent>/codex-home*\/plugins/cache/<marketplace>/<plugin>`. Only that cache
 * directory goes; nothing else in the agent dir (no session, no transcript) is
 * touched. Symbolic links are never followed or removed, and a path whose
 * canonical form leaves the agents root is refused. Returns the removed paths.
 */
export async function removeCodexPluginCaches(
  marketplace: string,
  plugin: string,
  agentsRootPath: string = AGENTS_DIR,
): Promise<string[]> {
  for (const name of [marketplace, plugin]) {
    if (!CODEX_CACHE_NAME_PATTERN.test(name)) {
      throw new Error(`removeCodexPluginCaches: invalid name: ${JSON.stringify(name)}`);
    }
  }
  const agentsRoot = resolve(agentsRootPath);
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(agentsRoot);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return [];
    throw error;
  }

  const removed: string[] = [];
  for (const agent of await readdir(agentsRoot, { withFileTypes: true })) {
    if (!agent.isDirectory()) continue;
    const agentDir = join(agentsRoot, agent.name);
    for (const home of await readdir(agentDir, { withFileTypes: true })) {
      if (!home.isDirectory() || !home.name.startsWith('codex-home')) continue;
      const cache = join(agentDir, home.name, 'plugins', 'cache', marketplace, plugin);
      let cacheStat;
      try {
        cacheStat = await lstat(cache);
      } catch (error) {
        if (hasErrorCode(error, 'ENOENT') || hasErrorCode(error, 'ENOTDIR')) continue;
        throw error;
      }
      if (cacheStat.isSymbolicLink() || !cacheStat.isDirectory()) continue;
      assertContained(canonicalRoot, await realpath(cache));
      await rm(cache, { recursive: true, force: true });
      removed.push(cache);
    }
  }
  return removed;
}

/**
 * PAN-4941 — delete an agent's or conversation's delivered secrets: only the
 * `secrets/` child of `ownerDir` (`<agent dir>` or `<conversation dir>`), never
 * the owner directory or its transcripts. A missing directory is not an error.
 */
export async function removeAgentSecretsDir(ownerDir: string): Promise<void> {
  await rm(join(ownerDir, 'secrets'), { recursive: true, force: true });
}
