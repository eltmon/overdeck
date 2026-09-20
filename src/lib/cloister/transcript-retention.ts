import type { Dirent, Stats } from 'node:fs';
import { readdir, rm, rmdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';

import { isConversationDirectory } from '../agent-directory-cleanup.js';
import { listArchivedConversations, listConversations } from '../overdeck/conversations.js';
import { AGENTS_DIR } from '../paths.js';
import { listSessionNames } from '../tmux.js';

interface TranscriptRetentionConversation {
  name: string;
  status: 'active' | 'ended';
  archivedAt: string | null;
}

export interface TranscriptRetentionDeps {
  readDir(path: string): Promise<Dirent[]>;
  stat(path: string): Promise<Stats>;
  removeFile(path: string): Promise<void>;
  removeDir(path: string): Promise<void>;
  removeTree(path: string): Promise<void>;
  listSessionNames(): Promise<readonly string[]>;
  listConversations(): readonly TranscriptRetentionConversation[];
  listArchivedConversations(): readonly TranscriptRetentionConversation[];
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
  removeTree: async (path) => { await rm(path, { recursive: true, force: true }); },
  listSessionNames: () => Effect.runPromise(listSessionNames()),
  listConversations,
  listArchivedConversations,
  now: () => Date.now(),
  log: (message) => console.log(`[deacon] ${message}`),
};

function hasErrorCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code;
}

function conversationEligibility(deps: TranscriptRetentionDeps): Map<string, boolean> | null {
  try {
    const eligible = new Map<string, boolean>();
    for (const conversation of deps.listConversations()) {
      if (conversation.status === 'active') eligible.set(conversation.name, false);
      else if (!eligible.has(conversation.name)) eligible.set(conversation.name, true);
    }
    for (const conversation of deps.listArchivedConversations()) {
      if (!eligible.has(conversation.name)) eligible.set(conversation.name, true);
    }
    return eligible;
  } catch {
    return null;
  }
}

async function pruneTranscriptFiles(
  dirPath: string,
  cutoffMs: number,
  deps: TranscriptRetentionDeps,
): Promise<{ deletedFiles: number; prunedDirs: number; remainingTranscripts: number; removedDir: boolean }> {
  let entries: Dirent[];
  try {
    entries = await deps.readDir(dirPath);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return { deletedFiles: 0, prunedDirs: 0, remainingTranscripts: 0, removedDir: true };
    }
    throw error;
  }

  let deletedFiles = 0;
  let prunedDirs = 0;
  let remainingTranscripts = 0;
  for (const entry of entries) {
    const entryPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await pruneTranscriptFiles(entryPath, cutoffMs, deps);
      deletedFiles += nested.deletedFiles;
      prunedDirs += nested.prunedDirs;
      remainingTranscripts += nested.remainingTranscripts;
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
    if (fileStat.mtimeMs >= cutoffMs) {
      remainingTranscripts++;
      continue;
    }

    await deps.removeFile(entryPath);
    deletedFiles++;
  }

  let removedDir = false;
  try {
    await deps.removeDir(dirPath);
    prunedDirs++;
    removedDir = true;
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) removedDir = true;
    else if (!hasErrorCode(error, 'ENOTEMPTY') && !hasErrorCode(error, 'EEXIST')) throw error;
  }

  return { deletedFiles, prunedDirs, remainingTranscripts, removedDir };
}

async function collectJsonlFiles(
  dirPath: string,
  deps: TranscriptRetentionDeps,
  files: string[],
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await deps.readDir(dirPath);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return;
    throw error;
  }
  for (const entry of entries) {
    const entryPath = join(dirPath, entry.name);
    if (entry.isDirectory()) await collectJsonlFiles(entryPath, deps, files);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(entryPath);
  }
}

async function agentRetentionArtifacts(
  agentDir: string,
  deps: TranscriptRetentionDeps,
): Promise<{ newestMtimeMs: number; rollouts: string[] } | null> {
  let entries: Dirent[];
  try {
    entries = await deps.readDir(agentDir);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return null;
    throw error;
  }

  const rollouts: string[] = [];
  const candidates: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name === 'activity.jsonl') {
      candidates.push(join(agentDir, entry.name));
    } else if (entry.isDirectory() && entry.name.startsWith('codex-home')) {
      await collectJsonlFiles(join(agentDir, entry.name, 'sessions'), deps, rollouts);
    }
  }
  candidates.push(...rollouts);
  if (candidates.length === 0) return null;

  const mtimes = await Promise.all(candidates.map(async (path) => {
    try {
      return (await deps.stat(path)).mtimeMs;
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return Number.NEGATIVE_INFINITY;
      throw error;
    }
  }));
  const newestMtimeMs = Math.max(...mtimes);
  return Number.isFinite(newestMtimeMs) ? { newestMtimeMs, rollouts } : null;
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
  let liveSessions: Set<string>;
  try {
    liveSessions = new Set(await deps.listSessionNames());
  } catch {
    const action = 'Transcript retention sweep skipped: tmux liveness census unavailable';
    deps.log(action);
    return [action];
  }

  const agentsDir = options.agentsDir ?? AGENTS_DIR;
  let agentEntries: Dirent[];
  try {
    agentEntries = await deps.readDir(agentsDir);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) agentEntries = [];
    else throw error;
  }

  const cutoffMs = deps.now() - transcriptDays * 24 * 60 * 60 * 1000;
  let conversationEligibilityMap: Map<string, boolean> | null = null;
  let conversationEligibilityLoaded = false;
  let eligibleDirs = 0;
  let deletedFiles = 0;
  let prunedDirs = 0;

  for (const entry of agentEntries) {
    if (!entry.isDirectory() || liveSessions.has(entry.name)) continue;

    const conversation = isConversationDirectory(entry.name);
    if (conversation) {
      if (!conversationEligibilityLoaded) {
        conversationEligibilityMap = conversationEligibility(deps);
        conversationEligibilityLoaded = true;
      }
      if (conversationEligibilityMap === null) continue;
      const conversationName = entry.name.slice('conv-'.length);
      if (conversationEligibilityMap.get(conversationName) !== true) continue;
    } else {
      const agentDir = join(agentsDir, entry.name);
      const artifacts = await agentRetentionArtifacts(agentDir, deps);
      if (!artifacts || artifacts.newestMtimeMs >= cutoffMs) continue;
      eligibleDirs++;
      for (const rollout of artifacts.rollouts) await deps.removeFile(rollout);
      deletedFiles += artifacts.rollouts.length;
      await deps.removeTree(agentDir);
      prunedDirs++;
      continue;
    }

    eligibleDirs++;
    const agentDir = join(agentsDir, entry.name);
    const result = await pruneTranscriptFiles(agentDir, cutoffMs, deps);
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
