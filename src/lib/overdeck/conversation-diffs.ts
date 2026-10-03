import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { ChatMessage } from '@overdeck/contracts';

import {
  findCommitAtTime,
  diffFilesAgainstHead,
  diffPatchSinceCommit,
  diffPatchFilesAgainstHead,
  type TurnDiffFileChange,
} from '../checkpoint/checkpoint-manager.js';
import { diffVsDefaultBranch } from '../checkpoint/vs-default-branch.js';
import {
  getConversationById,
  getConversationByName,
  type LegacyConversation as Conversation,
} from './conversations.js';

export interface ConversationDiffResult {
  body: unknown;
  status?: number;
}

export interface ConversationDiffParseResult {
  messages: Array<Pick<ChatMessage, 'role' | 'id' | 'createdAt' | 'completedAt'>>;
  fileEditsByAssistantId?: Map<string, Array<{ filePath: string }>>;
}

export interface ConversationDiffDependencies {
  resolveSessionFile(conv: Conversation): Promise<string | null>;
  getCachedMessages(sessionFile: string, isSpecialist: boolean): Promise<ConversationDiffParseResult>;
}

function result(body: unknown, status?: number): ConversationDiffResult {
  return status === undefined ? { body } : { body, status };
}

const DIFFS_CACHE_MAX = 32;
const DIFFS_CACHE_TTL_MS = 30_000;
interface DiffsCacheEntry {
  size: number;
  mtimeMs: number;
  at: number;
  body: { summaries: unknown[] };
}
const diffsCache = new Map<string, DiffsCacheEntry>();

function cacheDiffsResult(cacheKey: string, entry: DiffsCacheEntry): void {
  diffsCache.set(cacheKey, entry);
  if (diffsCache.size > DIFFS_CACHE_MAX) {
    const firstKey = diffsCache.keys().next().value;
    if (firstKey !== undefined) diffsCache.delete(firstKey);
  }
}

function lookupConversation(name: string): Conversation | null {
  return getConversationByName(name) ?? (/^\d+$/.test(name) ? getConversationById(parseInt(name, 10)) : null);
}

/** The git top-level of `dir`, or null when `dir` is not inside a repository (PAN-4501). */
async function repoRootForDir(dir: string): Promise<string | null> {
  try {
    const { stdout } = await promisify(exec)(
      'git rev-parse --show-toplevel',
      { cwd: dir, encoding: 'utf-8' },
    );
    return stdout.trim();
  } catch {
    return null;
  }
}

async function repoRootForFile(filePath: string, repoRootCache: Map<string, string | null>): Promise<string | null> {
  const dir = filePath.substring(0, filePath.lastIndexOf('/')) || filePath;
  let repoRoot = repoRootCache.get(dir);
  if (repoRoot !== undefined) return repoRoot;

  repoRoot = await repoRootForDir(dir);
  repoRootCache.set(dir, repoRoot);
  return repoRoot;
}

/** Files de-duplicated by path (first wins) and sorted by path (PAN-4501). */
function sortedFiles(filesByPath: Map<string, TurnDiffFileChange>): TurnDiffFileChange[] {
  return [...filesByPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function repoRelativePath(filePath: string, repoRoot: string): string {
  return filePath.startsWith(repoRoot + '/')
    ? filePath.slice(repoRoot.length + 1)
    : filePath;
}

async function groupFilesByRepo(
  edits: Array<{ filePath: string }>,
  repoRootCache: Map<string, string | null>,
  fileFilter?: string,
): Promise<Map<string, string[]>> {
  const filesByRepo = new Map<string, string[]>();

  for (const edit of edits) {
    const repoRoot = await repoRootForFile(edit.filePath, repoRootCache);
    if (!repoRoot) continue;
    const relativePath = repoRelativePath(edit.filePath, repoRoot);
    if (fileFilter && relativePath !== fileFilter) continue;

    let repoFiles = filesByRepo.get(repoRoot);
    if (!repoFiles) {
      repoFiles = [];
      filesByRepo.set(repoRoot, repoFiles);
    }
    if (!repoFiles.includes(relativePath)) {
      repoFiles.push(relativePath);
    }
  }

  return filesByRepo;
}

async function diffFilesSinceBase(
  repoRoot: string,
  baseCommit: string,
  filePaths: string[],
): Promise<TurnDiffFileChange[]> {
  // An empty pathspec means "the whole repository" explicitly (PAN-4501) — omit
  // `-- ""` so that intent is not an accident of joining zero paths.
  const pathspec = filePaths.length > 0 ? ` -- ${filePaths.map(p => JSON.stringify(p)).join(' ')}` : '';
  // --no-renames: a per-turn lookup keyed by the input path would otherwise drop a
  // file entirely when git's rename detection folds "a.ts => b.ts" into one line.
  // -c core.quotePath=false: keep non-ASCII paths unquoted so the lookup key matches.
  const { stdout: numstat } = await promisify(exec)(
    `git -c core.quotePath=false diff --no-renames --numstat --no-color ${baseCommit}${pathspec}`,
    { cwd: repoRoot, encoding: 'utf-8' },
  );
  const { stdout: nameStatus } = await promisify(exec)(
    `git -c core.quotePath=false diff --no-renames --name-status --no-color ${baseCommit}${pathspec}`,
    { cwd: repoRoot, encoding: 'utf-8' },
  );
  const statusMap = new Map<string, string>();
  for (const line of nameStatus.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length >= 2) statusMap.set(parts[parts.length - 1], parts[0]);
  }

  const diffs: TurnDiffFileChange[] = [];
  for (const line of numstat.split('\n')) {
    if (!line.trim()) continue;
    const [addStr, delStr, ...pathParts] = line.split('\t');
    const path = pathParts.join('\t');
    if (!path) continue;
    diffs.push({
      path,
      kind: statusMap.get(path),
      additions: parseInt(addStr, 10) || 0,
      deletions: parseInt(delStr, 10) || 0,
    });
  }
  return diffs;
}

async function diffPatchForFiles(
  repoRoot: string,
  createdAt: string,
  filePaths: string[],
): Promise<string> {
  const baseCommit = await findCommitAtTime(repoRoot, createdAt);
  if (!baseCommit) {
    return diffPatchFilesAgainstHead(repoRoot, filePaths);
  }

  const quotedPaths = filePaths.map(p => JSON.stringify(p)).join(' ');
  const { stdout } = await promisify(exec)(
    `git diff --patch --minimal --no-color ${baseCommit} -- ${quotedPaths}`,
    { cwd: repoRoot, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 },
  );
  return stdout;
}

export async function getConversationDiffs(
  name: string,
  deps: ConversationDiffDependencies,
): Promise<ConversationDiffResult> {
  try {
    const conv = lookupConversation(name);
    if (!conv) return result({ error: 'Conversation not found' }, 404);

    const sessionFile = await deps.resolveSessionFile(conv);
    if (!sessionFile || !existsSync(sessionFile)) {
      return result({ summaries: [] });
    }

    // Repo HEAD is deliberately not part of the cache key: `git diff <base> -- <paths>`
    // compares against the working tree, so the transcript's own stat signature is
    // what decides whether the edited-file set (and therefore the diff) could differ.
    const cacheKey = `${conv.name}\0${sessionFile}`;
    const fileStats = await stat(sessionFile);
    const cached = diffsCache.get(cacheKey);
    if (
      cached &&
      cached.size === fileStats.size &&
      cached.mtimeMs === fileStats.mtimeMs &&
      Date.now() - cached.at < DIFFS_CACHE_TTL_MS
    ) {
      return result(cached.body);
    }

    const parsed = await deps.getCachedMessages(sessionFile, false);
    const { fileEditsByAssistantId } = parsed;
    if (!fileEditsByAssistantId || fileEditsByAssistantId.size === 0) {
      const body = { summaries: [] };
      cacheDiffsResult(cacheKey, { size: fileStats.size, mtimeMs: fileStats.mtimeMs, at: Date.now(), body });
      return result(body);
    }

    const summaries: Array<{
      turnId: string;
      completedAt: string;
      status: string;
      files: TurnDiffFileChange[];
      assistantMessageId: string;
    }> = [];

    const assistantMessages = parsed.messages.filter(m => m.role === 'assistant');
    const assistantById = new Map(assistantMessages.map(m => [m.id, m]));

    const repoRootCache = new Map<string, string | null>();
    const baseCommitCache = new Map<string, string | null>();

    // First pass: group each turn's edits by repo, and build the per-repo
    // union of paths so each repo's diff runs once instead of once per turn.
    const turnFiles = new Map<string, Map<string, string[]>>();
    const repoFiles = new Map<string, Set<string>>();
    for (const [assistantId, edits] of fileEditsByAssistantId) {
      const filesByRepo = await groupFilesByRepo(edits, repoRootCache);
      turnFiles.set(assistantId, filesByRepo);
      for (const [repoRoot, filePaths] of filesByRepo) {
        let union = repoFiles.get(repoRoot);
        if (!union) { union = new Set(); repoFiles.set(repoRoot, union); }
        for (const filePath of filePaths) union.add(filePath);
      }
    }

    // Second pass: one diff pair per repo over the union of edited paths,
    // indexed by path so each turn's summary can pull out only its own files.
    const repoChanges = new Map<string, Map<string, TurnDiffFileChange>>();
    for (const [repoRoot, pathSet] of repoFiles) {
      try {
        if (!baseCommitCache.has(repoRoot)) {
          baseCommitCache.set(repoRoot, await findCommitAtTime(repoRoot, conv.createdAt));
        }
        const baseCommit = baseCommitCache.get(repoRoot) ?? null;
        const filePaths = [...pathSet];
        const diffs = baseCommit
          ? await diffFilesSinceBase(repoRoot, baseCommit, filePaths)
          : await diffFilesAgainstHead(repoRoot, filePaths);
        repoChanges.set(repoRoot, new Map(diffs.map(change => [change.path, change])));
      } catch {
        // git diff failed — skip this repo
      }
    }

    for (const assistantId of fileEditsByAssistantId.keys()) {
      const asstMsg = assistantById.get(assistantId);
      const completedAt = asstMsg?.completedAt ?? asstMsg?.createdAt ?? new Date().toISOString();
      const filesByRepo = turnFiles.get(assistantId) ?? new Map<string, string[]>();

      const files: TurnDiffFileChange[] = [];
      for (const [repoRoot, filePaths] of filesByRepo) {
        const changes = repoChanges.get(repoRoot);
        if (!changes) continue;
        for (const filePath of filePaths) {
          const change = changes.get(filePath);
          if (change) files.push(change);
        }
      }

      if (files.length > 0) {
        summaries.push({
          turnId: `conv-turn-${assistantId}`,
          completedAt,
          status: 'completed',
          files,
          assistantMessageId: assistantId,
        });
      }
    }

    const body = { summaries };
    cacheDiffsResult(cacheKey, { size: fileStats.size, mtimeMs: fileStats.mtimeMs, at: Date.now(), body });
    return result(body);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[conversations] diffs failed:', msg);
    return result({ error: 'Internal server error' }, 500);
  }
}

export async function getConversationDiffFull(
  name: string,
  fileFilter: string | undefined,
  deps: ConversationDiffDependencies,
): Promise<ConversationDiffResult> {
  try {
    const conv = lookupConversation(name);
    if (!conv) return result({ error: 'Conversation not found' }, 404);

    const cwd = conv.cwd;
    const cwdRepoRoot = await repoRootForDir(cwd);
    const patches: string[] = [];
    const filesByPath = new Map<string, TurnDiffFileChange>();
    const addFiles = (files: TurnDiffFileChange[]): void => {
      for (const file of files) {
        if (!filesByPath.has(file.path)) filesByPath.set(file.path, file);
      }
    };

    if (cwdRepoRoot) {
      const baseCommit = await findCommitAtTime(cwdRepoRoot, conv.createdAt);
      if (baseCommit) {
        const patch = await diffPatchSinceCommit(cwdRepoRoot, baseCommit, fileFilter);
        if (patch) patches.push(patch);
        addFiles(await diffFilesSinceBase(cwdRepoRoot, baseCommit, []));
      }
    }

    const sessionFile = await deps.resolveSessionFile(conv);
    if (!sessionFile || !existsSync(sessionFile)) {
      return result({ diff: patches.join('\n'), files: sortedFiles(filesByPath) });
    }

    const parsed = await deps.getCachedMessages(sessionFile, false);
    const { fileEditsByAssistantId } = parsed;
    if (!fileEditsByAssistantId || fileEditsByAssistantId.size === 0) {
      return result({ diff: patches.join('\n'), files: sortedFiles(filesByPath) });
    }

    const repoRootCache = new Map<string, string | null>();
    const allEdits = [...fileEditsByAssistantId.values()].flat();
    const filteredFilesByRepo = await groupFilesByRepo(allEdits, repoRootCache, fileFilter);
    const unfilteredFilesByRepo = await groupFilesByRepo(allEdits, repoRootCache);

    for (const [repoRoot, filePaths] of filteredFilesByRepo) {
      if (repoRoot === cwdRepoRoot) continue;
      try {
        const patch = await diffPatchForFiles(repoRoot, conv.createdAt, filePaths);
        if (patch) patches.push(patch);
      } catch {
        // file may have been committed or repo unavailable
      }
    }

    for (const [repoRoot, filePaths] of unfilteredFilesByRepo) {
      if (repoRoot === cwdRepoRoot) continue;
      try {
        const baseCommit = await findCommitAtTime(repoRoot, conv.createdAt);
        const diffs = baseCommit
          ? await diffFilesSinceBase(repoRoot, baseCommit, filePaths)
          : await diffFilesAgainstHead(repoRoot, filePaths);
        addFiles(diffs);
      } catch {
        // file may have been committed or repo unavailable
      }
    }

    return result({ diff: patches.join('\n'), files: sortedFiles(filesByPath) });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[conversations] diff full failed:', msg);
    return result({ error: 'Internal server error' }, 500);
  }
}

export async function getConversationDiffTurn(
  name: string,
  turnId: string,
  fileFilter: string | undefined,
  deps: ConversationDiffDependencies,
): Promise<ConversationDiffResult> {
  try {
    const conv = lookupConversation(name);
    if (!conv) return result({ error: 'Conversation not found' }, 404);

    const cwd = conv.cwd;
    const cwdRepoRoot = existsSync(join(cwd, '.git')) ? cwd : null;
    const patches: string[] = [];

    if (cwdRepoRoot) {
      const baseCommit = await findCommitAtTime(cwdRepoRoot, conv.createdAt);
      if (baseCommit) {
        const patch = await diffPatchSinceCommit(cwdRepoRoot, baseCommit, fileFilter);
        if (patch) patches.push(patch);
      }
    }

    const assistantId = turnId.startsWith('conv-turn-') ? turnId.slice('conv-turn-'.length) : turnId;
    const sessionFile = await deps.resolveSessionFile(conv);
    if (!sessionFile || !existsSync(sessionFile)) return result({ turnId, diff: patches.join('\n') });

    const parsed = await deps.getCachedMessages(sessionFile, false);
    const edits = parsed.fileEditsByAssistantId?.get(assistantId);
    if (!edits || edits.length === 0) return result({ turnId, diff: patches.join('\n') });

    const repoRootCache = new Map<string, string | null>();
    const filesByRepo = await groupFilesByRepo(edits, repoRootCache, fileFilter);

    for (const [repoRoot, filePaths] of filesByRepo) {
      if (repoRoot === cwdRepoRoot) continue;
      try {
        const patch = await diffPatchForFiles(repoRoot, conv.createdAt, filePaths);
        if (patch) patches.push(patch);
      } catch {
        // file may have been committed or repo unavailable
      }
    }

    return result({ turnId, diff: patches.join('\n') });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[conversations] diff turn failed:', msg);
    return result({ error: 'Internal server error' }, 500);
  }
}

/**
 * "vs main" for a conversation (PAN-4501): the conversation's repository
 * (git top-level of its cwd) diffed three-dot against the project's default
 * branch. Before this route existed, `/diffs/vs-main` fell through to
 * `/diffs/:turnId` and returned "conversation start vs working tree".
 */
export async function getConversationDiffVsMain(
  name: string,
  fileFilter: string | undefined,
): Promise<ConversationDiffResult> {
  try {
    const conv = lookupConversation(name);
    if (!conv) return result({ error: 'Conversation not found' }, 404);
    const repoRoot = await repoRootForDir(conv.cwd);
    if (!repoRoot) {
      return result({ repoRoot: null, baseBranch: null, baseRef: null, files: [], ...(fileFilter !== undefined && { diff: '' }) });
    }
    const diff = await diffVsDefaultBranch(repoRoot, { projectKey: conv.projectKey, ...(fileFilter !== undefined && { filePath: fileFilter }) });
    return result({ repoRoot, ...diff });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[conversations] diff vs-main failed:', msg);
    return result({ error: 'Internal server error' }, 500);
  }
}
