import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { ChatMessage } from '@overdeck/contracts';
import { Effect } from 'effect';

import {
  findCommitAtTime,
  diffFilesAgainstHead,
  diffPatchSinceCommit,
  diffPatchFilesAgainstHead,
  type TurnDiffFileChange,
} from '../checkpoint/checkpoint-manager.js';
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

function lookupConversation(name: string): Conversation | null {
  return getConversationByName(name) ?? (/^\d+$/.test(name) ? getConversationById(parseInt(name, 10)) : null);
}

async function repoRootForFile(filePath: string, repoRootCache: Map<string, string | null>): Promise<string | null> {
  const dir = filePath.substring(0, filePath.lastIndexOf('/')) || filePath;
  let repoRoot = repoRootCache.get(dir);
  if (repoRoot !== undefined) return repoRoot;

  try {
    const { stdout } = await promisify(exec)(
      'git rev-parse --show-toplevel',
      { cwd: dir, encoding: 'utf-8' },
    );
    repoRoot = stdout.trim();
  } catch {
    repoRoot = null;
  }
  repoRootCache.set(dir, repoRoot);
  return repoRoot;
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
  const quotedPaths = filePaths.map(p => JSON.stringify(p)).join(' ');
  const { stdout: numstat } = await promisify(exec)(
    `git diff --numstat --no-color ${baseCommit} -- ${quotedPaths}`,
    { cwd: repoRoot, encoding: 'utf-8' },
  );
  const { stdout: nameStatus } = await promisify(exec)(
    `git diff --name-status --no-color ${baseCommit} -- ${quotedPaths}`,
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

    const parsed = await deps.getCachedMessages(sessionFile, false);
    const { fileEditsByAssistantId } = parsed;
    if (!fileEditsByAssistantId || fileEditsByAssistantId.size === 0) {
      return result({ summaries: [] });
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

    for (const [assistantId, edits] of fileEditsByAssistantId) {
      const asstMsg = assistantById.get(assistantId);
      const completedAt = asstMsg?.completedAt ?? asstMsg?.createdAt ?? new Date().toISOString();
      const filesByRepo = await groupFilesByRepo(edits, repoRootCache);

      const allFiles: TurnDiffFileChange[] = [];
      for (const [repoRoot, filePaths] of filesByRepo) {
        try {
          if (!baseCommitCache.has(repoRoot)) {
            baseCommitCache.set(repoRoot, await Effect.runPromise(findCommitAtTime(repoRoot, conv.createdAt)));
          }
          const baseCommit = baseCommitCache.get(repoRoot) ?? null;
          const diffs = baseCommit
            ? await diffFilesSinceBase(repoRoot, baseCommit, filePaths)
            : await Effect.runPromise(diffFilesAgainstHead(repoRoot, filePaths));
          allFiles.push(...diffs);
        } catch {
          // git diff failed — skip this repo
        }
      }

      if (allFiles.length > 0) {
        summaries.push({
          turnId: `conv-turn-${assistantId}`,
          completedAt,
          status: 'completed',
          files: allFiles,
          assistantMessageId: assistantId,
        });
      }
    }

    return result({ summaries });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[conversations] diffs failed:', msg);
    return result({ error: 'Internal server error' }, 500);
  }
}

export async function getConversationDiffFull(
  name: string,
  deps: ConversationDiffDependencies,
): Promise<ConversationDiffResult> {
  try {
    const conv = getConversationByName(name);
    if (!conv) return result({ error: 'Conversation not found' }, 404);

    const cwd = conv.cwd;
    const isInRepo = existsSync(join(cwd, '.git'));

    if (isInRepo) {
      const baseCommit = await Effect.runPromise(findCommitAtTime(cwd, conv.createdAt));
      if (!baseCommit) return result({ diff: '' });
      const diff = await Effect.runPromise(diffPatchSinceCommit(cwd, baseCommit));
      return result({ diff });
    }

    const sessionFile = await deps.resolveSessionFile(conv);
    if (!sessionFile || !existsSync(sessionFile)) return result({ diff: '' });

    const parsed = await deps.getCachedMessages(sessionFile, false);
    const { fileEditsByAssistantId } = parsed;
    if (!fileEditsByAssistantId || fileEditsByAssistantId.size === 0) return result({ diff: '' });

    const repoRootCache = new Map<string, string | null>();
    const allEdits = [...fileEditsByAssistantId.values()].flat();
    const filesByRepo = await groupFilesByRepo(allEdits, repoRootCache);

    const patches: string[] = [];
    for (const [repoRoot, filePaths] of filesByRepo) {
      try {
        const patch = await Effect.runPromise(diffPatchFilesAgainstHead(repoRoot, filePaths));
        if (patch) patches.push(patch);
      } catch {
        // file may have been committed
      }
    }

    return result({ diff: patches.join('\n') });
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
    const isInRepo = existsSync(join(cwd, '.git'));

    if (isInRepo) {
      const baseCommit = await Effect.runPromise(findCommitAtTime(cwd, conv.createdAt));
      if (baseCommit) {
        const diff = await Effect.runPromise(diffPatchSinceCommit(cwd, baseCommit, fileFilter));
        return result({ turnId, diff });
      }
    }

    const assistantId = turnId.startsWith('conv-turn-') ? turnId.slice('conv-turn-'.length) : turnId;
    const sessionFile = await deps.resolveSessionFile(conv);
    if (!sessionFile || !existsSync(sessionFile)) return result({ diff: '' });

    const parsed = await deps.getCachedMessages(sessionFile, false);
    const edits = parsed.fileEditsByAssistantId?.get(assistantId);
    if (!edits || edits.length === 0) return result({ diff: '' });

    const repoRootCache = new Map<string, string | null>();
    const filesByRepo = await groupFilesByRepo(edits, repoRootCache, fileFilter);

    const baseCommitByRepo = new Map<string, string | null>();
    const patches: string[] = [];
    for (const [repoRoot, filePaths] of filesByRepo) {
      try {
        if (!baseCommitByRepo.has(repoRoot)) {
          baseCommitByRepo.set(repoRoot, await Effect.runPromise(findCommitAtTime(repoRoot, conv.createdAt)));
        }
        const baseCommit = baseCommitByRepo.get(repoRoot) ?? null;
        let patch: string;
        if (baseCommit) {
          const { stdout } = await promisify(exec)(
            `git diff --patch --minimal --no-color ${baseCommit} -- ${filePaths.map(p => JSON.stringify(p)).join(' ')}`,
            { cwd: repoRoot, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 },
          );
          patch = stdout;
        } else {
          patch = await Effect.runPromise(diffPatchFilesAgainstHead(repoRoot, filePaths));
        }
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
