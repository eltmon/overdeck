import type { Dirent, Stats } from 'node:fs';
import { readdir, rm, rmdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';

import { isConversationDirectory } from '../agent-directory-cleanup.js';
import { getConversationByName } from '../overdeck/conversations.js';
import { AGENTS_DIR } from '../paths.js';
import { sessionExists } from '../tmux.js';

interface TranscriptRetentionConversation {
  status: 'active' | 'ended';
  archivedAt: string | null;
}

export interface TranscriptRetentionDeps {
  readDir(path: string): Promise<Dirent[]>;
  stat(path: string): Promise<Stats>;
  removeFile(path: string): Promise<void>;
  removeDir(path: string): Promise<void>;
  sessionExists(name: string): Promise<boolean>;
  getConversationByName(name: string): TranscriptRetentionConversation | null;
  now(): number;
  log(message: string): void;
}

export interface TranscriptRetentionOptions {
  transcriptDays?: number;
  agentsDir?: string;
  deps?: Partial<TranscriptRetentionDeps>;
}

const defaultDeps: TranscriptRetentionDeps = {
  readDir: (path) => readdir(path, { withFileTypes: true }),
  stat,
  removeFile: async (path) => { await rm(path, { force: true }); },
  removeDir: rmdir,
  sessionExists: (name) => Effect.runPromise(sessionExists(name)),
  getConversationByName,
  now: Date.now,
  log: (message) => console.log(`[deacon] ${message}`),
};

function hasErrorCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code;
}

async function pruneTranscriptFiles(
  dirPath: string,
  cutoffMs: number,
  deps: TranscriptRetentionDeps,
): Promise<{ deletedFiles: number; prunedDirs: number }> {
  let entries: Dirent[];
  try {
    entries = await deps.readDir(dirPath);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return { deletedFiles: 0, prunedDirs: 0 };
    throw error;
  }

  let deletedFiles = 0;
  let prunedDirs = 0;
  for (const entry of entries) {
    const entryPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await pruneTranscriptFiles(entryPath, cutoffMs, deps);
      deletedFiles += nested.deletedFiles;
      prunedDirs += nested.prunedDirs;
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;

    let fileStat: Stats;
    try {
      fileStat = await deps.stat(entryPath);
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) continue;
      throw error;
    }
    if (fileStat.mtimeMs >= cutoffMs) continue;

    await deps.removeFile(entryPath);
    deletedFiles++;
  }

  try {
    await deps.removeDir(dirPath);
    prunedDirs++;
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT') &&
        !hasErrorCode(error, 'ENOTEMPTY') &&
        !hasErrorCode(error, 'EEXIST')) {
      throw error;
    }
  }

  return { deletedFiles, prunedDirs };
}

/**
 * Delete explicitly expired transcript artifacts from ended agent state dirs.
 * Unset, non-finite, zero, or negative retention never traverses the filesystem.
 */
export async function sweepTranscriptRetention(
  options: TranscriptRetentionOptions,
): Promise<string[]> {
  const transcriptDays = options.transcriptDays;
  if (transcriptDays === undefined || !Number.isFinite(transcriptDays) || transcriptDays <= 0) {
    return [];
  }

  const deps = { ...defaultDeps, ...options.deps };
  const agentsDir = options.agentsDir ?? AGENTS_DIR;
  let agentEntries: Dirent[];
  try {
    agentEntries = await deps.readDir(agentsDir);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) agentEntries = [];
    else throw error;
  }

  const cutoffMs = deps.now() - transcriptDays * 24 * 60 * 60 * 1000;
  let eligibleDirs = 0;
  let deletedFiles = 0;
  let prunedDirs = 0;

  for (const entry of agentEntries) {
    if (!entry.isDirectory()) continue;

    try {
      if (await deps.sessionExists(entry.name)) continue;
    } catch {
      continue;
    }

    if (isConversationDirectory(entry.name)) {
      let conversation: TranscriptRetentionConversation | null;
      try {
        conversation = deps.getConversationByName(entry.name);
      } catch {
        continue;
      }
      if (!conversation || (conversation.status !== 'ended' && !conversation.archivedAt)) continue;
    }

    eligibleDirs++;
    const result = await pruneTranscriptFiles(join(agentsDir, entry.name), cutoffMs, deps);
    deletedFiles += result.deletedFiles;
    prunedDirs += result.prunedDirs;
  }

  const fileLabel = `transcript file${deletedFiles === 1 ? '' : 's'}`;
  const dirLabel = `ended agent state dir${eligibleDirs === 1 ? '' : 's'}`;
  const prunedLabel = `empty director${prunedDirs === 1 ? 'y' : 'ies'}`;
  const action = `Transcript retention sweep: deleted ${deletedFiles} ${fileLabel} older than ${transcriptDays} day${transcriptDays === 1 ? '' : 's'} from ${eligibleDirs} ${dirLabel}; pruned ${prunedDirs} ${prunedLabel}`;
  deps.log(action);
  return [action];
}
