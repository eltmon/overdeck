import type { Dirent, Stats } from 'node:fs';
import { readdir, realpath, rm, rmdir, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { isConversationDirectory } from '../agent-directory-cleanup.js';
import { pruneAgentStateDir } from '../agents/state-dir-removal.js';
import { listArchivedConversations, listConversations } from '../overdeck/conversations.js';
import { AGENTS_DIR } from '../paths.js';
import { listLiveAgentIds } from '../terminal-backends/inventory.js';

interface TranscriptRetentionConversation { name: string; status: 'active' | 'ended'; archivedAt: string | null }

export interface TranscriptRetentionDeps {
  readDir(path: string): Promise<Dirent[]>;
  stat(path: string): Promise<Stats>;
  removeFile(path: string): Promise<void>;
  removeDir(path: string): Promise<void>;
  removeTree(path: string): Promise<void>;
  realpath(path: string): Promise<string>;
  pruneAgentDir(path: string, agentsRoot: string): Promise<unknown>;
  listLiveAgentIds(): Promise<ReadonlySet<string> | null>;
  listConversations(): readonly TranscriptRetentionConversation[];
  listArchivedConversations(): readonly TranscriptRetentionConversation[];
  now(): number;
  log(message: string): void;
}

export interface TranscriptRetentionOptions {
  transcriptDays?: number; agentsDir?: string; deps?: Partial<TranscriptRetentionDeps>;
}

const defaultDeps: TranscriptRetentionDeps = {
  readDir: (path) => readdir(path, { withFileTypes: true }),
  stat,
  removeFile: async (path) => { await rm(path, { force: true }); },
  removeDir: rmdir,
  removeTree: async (path) => { await rm(path, { recursive: true, force: true }); },
  realpath,
  pruneAgentDir: pruneAgentStateDir,
  listLiveAgentIds,
  listConversations,
  listArchivedConversations,
  now: () => Date.now(),
  log: (message) => console.log(`[deacon] ${message}`),
};

const hasErrorCode = (error: unknown, code: string): boolean => (error as NodeJS.ErrnoException).code === code;

function isContained(root: string, candidate: string, allowRoot = false): boolean {
  const fromRoot = relative(root, candidate);
  return (allowRoot && fromRoot === '') || (
    fromRoot !== '' &&
    fromRoot !== '..' &&
    !fromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(fromRoot)
  );
}

async function canonicalTarget(path: string, canonicalRoot: string, deps: TranscriptRetentionDeps, allowRoot = false): Promise<string> {
  const canonical = await deps.realpath(path);
  if (!isContained(canonicalRoot, canonical, allowRoot)) throw new Error(`Transcript retention target escapes agent directory: ${path}`);
  return canonical;
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
  dirPath: string, cutoffMs: number, deps: TranscriptRetentionDeps, canonicalAgentDir: string,
): Promise<{ deletedFiles: number; prunedDirs: number; remainingTranscripts: number; removedDir: boolean }> {
  await canonicalTarget(dirPath, canonicalAgentDir, deps, true);
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
      const nested = await pruneTranscriptFiles(entryPath, cutoffMs, deps, canonicalAgentDir);
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

    await canonicalTarget(entryPath, canonicalAgentDir, deps);
    await deps.removeFile(entryPath);
    deletedFiles++;
  }

  let removedDir = false;
  try {
    await canonicalTarget(dirPath, canonicalAgentDir, deps, true);
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
  dirPath: string, deps: TranscriptRetentionDeps, files: string[], canonicalAgentDir: string,
): Promise<void> {
  try {
    await canonicalTarget(dirPath, canonicalAgentDir, deps, true);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return;
    throw error;
  }
  let entries: Dirent[];
  try {
    entries = await deps.readDir(dirPath);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return;
    throw error;
  }
  for (const entry of entries) {
    const entryPath = join(dirPath, entry.name);
    if (entry.isDirectory()) await collectJsonlFiles(entryPath, deps, files, canonicalAgentDir);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(entryPath);
  }
}

async function agentRetentionArtifacts(
  agentDir: string, deps: TranscriptRetentionDeps, canonicalAgentDir: string,
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
      await collectJsonlFiles(join(agentDir, entry.name, 'sessions'), deps, rollouts, canonicalAgentDir);
    }
  }
  candidates.push(...rollouts);
  if (candidates.length === 0) return null;

  const mtimes = await Promise.all(candidates.map(async (path) => {
    try {
      await canonicalTarget(path, canonicalAgentDir, deps);
      return (await deps.stat(path)).mtimeMs;
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return Number.NEGATIVE_INFINITY;
      throw error;
    }
  }));
  const newestMtimeMs = Math.max(...mtimes);
  return Number.isFinite(newestMtimeMs) ? { newestMtimeMs, rollouts } : null;
}

export async function sweepTranscriptRetention(options: TranscriptRetentionOptions): Promise<string[]> {
  const transcriptDays = options.transcriptDays;
  if (transcriptDays === undefined || !Number.isFinite(transcriptDays) || transcriptDays <= 0) {
    return [];
  }

  const deps = { ...defaultDeps, ...options.deps };
  let liveSessions: ReadonlySet<string>;
  try {
    const inventory = await deps.listLiveAgentIds();
    if (inventory === null) throw new Error('indeterminate backend inventory');
    liveSessions = inventory;
  } catch {
    const action = 'Transcript retention sweep skipped: backend liveness inventory unavailable';
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

  let canonicalAgentsDir: string;
  try {
    canonicalAgentsDir = await deps.realpath(resolve(agentsDir));
  } catch {
    const action = 'Transcript retention sweep skipped: agent root cannot be canonicalized';
    deps.log(action);
    return [action];
  }

  const cutoffMs = deps.now() - transcriptDays * 24 * 60 * 60 * 1000;
  let conversationEligibilityMap: Map<string, boolean> | null = null;
  let conversationEligibilityLoaded = false;
  let eligibleDirs = 0;
  let deletedFiles = 0;
  let prunedDirs = 0;

  for (const entry of agentEntries) {
    if (!entry.isDirectory() || liveSessions.has(entry.name)) continue;

    const agentDir = join(agentsDir, entry.name);
    let canonicalAgentDir: string;
    try {
      canonicalAgentDir = await canonicalTarget(agentDir, canonicalAgentsDir, deps);
      if (relative(canonicalAgentsDir, canonicalAgentDir).includes(sep)) {
        throw new Error(`not a direct child: ${agentDir}`);
      }
    } catch {
      continue;
    }

    try {
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
        const artifacts = await agentRetentionArtifacts(agentDir, deps, canonicalAgentDir);
        if (!artifacts || artifacts.newestMtimeMs >= cutoffMs) continue;
        eligibleDirs++;
        for (const rollout of artifacts.rollouts) {
          await canonicalTarget(rollout, canonicalAgentDir, deps);
          await deps.removeFile(rollout);
        }
        deletedFiles += artifacts.rollouts.length;
        await deps.pruneAgentDir(agentDir, agentsDir);
        const recanonicalizedAgentDir = await canonicalTarget(agentDir, canonicalAgentsDir, deps);
        if (recanonicalizedAgentDir !== canonicalAgentDir || relative(canonicalAgentsDir, recanonicalizedAgentDir).includes(sep)) {
          throw new Error(`Transcript retention target changed during sweep: ${agentDir}`);
        }
        await deps.removeTree(agentDir);
        prunedDirs++;
        continue;
      }

      eligibleDirs++;
      const result = await pruneTranscriptFiles(agentDir, cutoffMs, deps, canonicalAgentDir);
      deletedFiles += result.deletedFiles;
      prunedDirs += result.prunedDirs;
    } catch { continue; }
  }

  const fileLabel = `transcript file${deletedFiles === 1 ? '' : 's'}`;
  const dirLabel = `ended agent state dir${eligibleDirs === 1 ? '' : 's'}`;
  const prunedLabel = `empty director${prunedDirs === 1 ? 'y' : 'ies'}`;
  const action = `Transcript retention sweep: deleted ${deletedFiles} ${fileLabel} older than ${transcriptDays} day${transcriptDays === 1 ? '' : 's'} from ${eligibleDirs} ${dirLabel}; pruned ${prunedDirs} ${prunedLabel}`;
  deps.log(action);
  return [action];
}
