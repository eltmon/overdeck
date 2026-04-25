import { existsSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { readdir, mkdir, rm, stat, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

import type { Conversation } from '../../../lib/database/conversations-db.js';
import { getPanopticonHome } from '../../../lib/paths.js';

const CONVERSATION_ATTACHMENTS_DIR = 'conversation-attachments';

/** Run async tasks in bounded batches to avoid unbounded Promise.all
 *  that can exhaust file descriptors or memory under heavy load. */
async function runInBatches<T>(items: T[], batchSize: number, fn: (item: T) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map(fn));
  }
}

/** Max JSONL line length to process. Lines larger than this are skipped to
 *  prevent readline from stalling permanently on oversized input (e.g. a
 *  single-line base64 payload >15 MB). */
const MAX_JSONL_LINE_LENGTH = 15 * 1024 * 1024;

/** Bounded LRU cache for readSessionAttachmentBasenames to avoid full JSONL
 *  rescans when the session file has not changed. Key = sessionFile:mtimeMs. */
const SESSION_ATTACHMENT_CACHE_MAX = 100;
const sessionAttachmentCache = new Map<string, Set<string>>();

function getAttachmentCacheKey(sessionFile: string, mtimeMs: number): string {
  return `${sessionFile}:${mtimeMs}`;
}

function setAttachmentCache(sessionFile: string, mtimeMs: number, basenames: Set<string>): void {
  const key = getAttachmentCacheKey(sessionFile, mtimeMs);
  sessionAttachmentCache.set(key, basenames);
  // Evict oldest entries if over max
  if (sessionAttachmentCache.size > SESSION_ATTACHMENT_CACHE_MAX) {
    const firstKey = sessionAttachmentCache.keys().next().value;
    if (firstKey !== undefined) {
      sessionAttachmentCache.delete(firstKey);
    }
  }
}

function getAttachmentCache(sessionFile: string, mtimeMs: number): Set<string> | undefined {
  const key = getAttachmentCacheKey(sessionFile, mtimeMs);
  return sessionAttachmentCache.get(key);
}

/** Conversation names are sanitized to [a-zA-Z0-9_-]{1,64} on creation.
 *  Re-validate here for defense-in-depth against path traversal. */
function assertSafeName(name: string): void {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
    throw new Error('Invalid conversation name');
  }
}

export function getConversationAttachmentsRoot(): string {
  return join(getPanopticonHome(), CONVERSATION_ATTACHMENTS_DIR);
}

export function getConversationAttachmentDir(name: string): string {
  assertSafeName(name);
  return join(getConversationAttachmentsRoot(), name);
}

export async function ensureConversationAttachmentDir(name: string): Promise<string> {
  const dir = getConversationAttachmentDir(name);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function cleanupConversationAttachments(name: string): Promise<void> {
  assertSafeName(name);
  await rm(getConversationAttachmentDir(name), { recursive: true, force: true });
}

/** Safety-net cleanup: remove attachment directories for conversations that no
 *  longer exist in the database. Catches orphaned files from abandoned/crashed
 *  sessions that the lifecycle poller missed. */
export async function cleanupOrphanedConversationAttachments(): Promise<void> {
  try {
    const { listConversations } = await import('../../../lib/database/conversations-db.js');
    const convNames = new Set(listConversations().map((c) => c.name));
    const root = getConversationAttachmentsRoot();
    const dirs = await readdir(root, { withFileTypes: true });
    const orphaned = dirs
      .filter((entry) => entry.isDirectory() && !convNames.has(entry.name))
      .map((entry) => join(root, entry.name));
    await runInBatches(orphaned, 10, (path) => rm(path, { recursive: true, force: true }).catch(() => {}));
  } catch {
    // ignore — directory may not exist yet
  }
}

async function listConversationAttachmentPaths(name: string): Promise<string[]> {
  const dir = getConversationAttachmentDir(name);
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => join(dir, entry.name));
  } catch {
    return [];
  }
}

/** Synchronous containment check: does the normalized path start with the
 *  pre-resolved attachment directory prefix?  Uses resolve() (not realpath)
 *  so the check is I/O-free — safe because we are only cataloguing references
 *  in the JSONL, not accessing the filesystem. */
function isUnderAttachmentDir(resolvedAttachmentDir: string, attachmentPath: string): boolean {
  try {
    const normalized = resolve(attachmentPath);
    return normalized.startsWith(`${resolvedAttachmentDir}/`);
  } catch {
    return false;
  }
}

async function readSessionAttachmentBasenames(sessionFile: string, name: string): Promise<Set<string>> {
  try {
    let mtimeMs: number;
    try {
      mtimeMs = (await stat(sessionFile)).mtimeMs;
    } catch {
      return new Set<string>();
    }

    const cached = getAttachmentCache(sessionFile, mtimeMs);
    if (cached) {
      return cached;
    }

    // Pre-resolve the attachment directory once (I/O outside the loop).
    // realpath follows symlinks for accuracy; resolve() is the fallback if
    // the directory has not been created yet.
    let resolvedAttachmentDir: string;
    try {
      resolvedAttachmentDir = await realpath(getConversationAttachmentDir(name));
    } catch {
      resolvedAttachmentDir = resolve(getConversationAttachmentDir(name));
    }

    const referenced = new Set<string>();
    const stream = createReadStream(sessionFile, { encoding: 'utf-8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of rl) {
        if (!line.trim()) continue;
        // Skip oversized lines that could stall the reader (e.g. huge base64)
        if (line.length > MAX_JSONL_LINE_LENGTH) continue;
        let text: string | undefined;
        try {
          const entry = JSON.parse(line);
          // Extract text from known Claude Code JSONL shapes
          if (typeof entry?.message?.content === 'string') {
            text = entry.message.content;
          } else if (Array.isArray(entry?.message?.content)) {
            text = entry.message.content
              .map((c: unknown) => (typeof c === 'string' ? c : (c as { text?: string })?.text ?? ''))
              .join('');
          } else if (typeof entry?.message?.text === 'string') {
            text = entry.message.text;
          } else if (typeof entry?.text === 'string') {
            text = entry.text;
          }
        } catch {
          // Not valid JSON — fall back to raw line regex
          text = line;
        }
        if (text) {
          for (const attachmentPath of extractConversationAttachmentPaths(text)) {
            if (isUnderAttachmentDir(resolvedAttachmentDir, attachmentPath)) {
              referenced.add(basename(attachmentPath));
            }
          }
        }
        // Also search the raw JSON line for @/attachment paths. This catches
        // tool-use and other shapes where the path may be in nested fields
        // (e.g. tool_use.input, tool_result.content) that structured extraction
        // above does not reach. We JSON-decode the captured value to handle
        // escaped slashes (\/) that appear in raw JSON strings.
        for (const match of line.matchAll(/"@([^"]+)"/g)) {
          const rawValue = match[1];
          // Only consider values that look like attachment paths
          if (!rawValue.startsWith('/') && !rawValue.startsWith('\\/')) continue;
          let attachmentPath: string;
          try {
            attachmentPath = JSON.parse(`"${rawValue}"`);
          } catch {
            attachmentPath = rawValue;
          }
          if (typeof attachmentPath === 'string' && attachmentPath.startsWith('/')) {
            if (isUnderAttachmentDir(resolvedAttachmentDir, attachmentPath)) {
              referenced.add(basename(attachmentPath));
            }
          }
        }
      }
    } finally {
      rl.close();
      stream.destroy();
    }
    setAttachmentCache(sessionFile, mtimeMs, referenced);
    return referenced;
  } catch {
    return new Set<string>();
  }
}

export async function cleanupUnreferencedConversationAttachments(conversation: Pick<Conversation, 'name' | 'sessionFile'>): Promise<void> {
  const attachmentPaths = await listConversationAttachmentPaths(conversation.name);
  if (attachmentPaths.length === 0) {
    return;
  }

  // No session file means nothing can reference attachments — delete them all.
  if (!conversation.sessionFile) {
    await runInBatches(attachmentPaths, 10, async (attachmentPath) => {
      await rm(attachmentPath, { force: true });
    });
    return;
  }

  let sessionMtimeMs: number;
  try {
    sessionMtimeMs = (await stat(conversation.sessionFile)).mtimeMs;
  } catch {
    return;
  }

  const referencedBasenames = await readSessionAttachmentBasenames(conversation.sessionFile, conversation.name);

  // Re-stat the session file to tighten against a /stop race: a JSONL write
  // may have landed while we were reading attachment basenames.
  try {
    const freshStats = await stat(conversation.sessionFile);
    if (freshStats.mtimeMs > sessionMtimeMs) {
      sessionMtimeMs = freshStats.mtimeMs;
    }
  } catch {
    // ignore
  }

  await runInBatches(
    attachmentPaths,
    10,
    async (attachmentPath) => {
      if (referencedBasenames.has(basename(attachmentPath))) {
        return;
      }

      try {
        const attachmentMtimeMs = (await stat(attachmentPath)).mtimeMs;
        // >= preserves attachments uploaded in the same mtime tick as the
        // session JSONL write, preventing a race where a just-uploaded file
        // is deleted on stop/archive.
        if (attachmentMtimeMs >= sessionMtimeMs) {
          return;
        }
      } catch {
        return;
      }

      await rm(attachmentPath, { force: true });
    },
  );
}

export function extractConversationAttachmentPaths(message: string): string[] {
  return Array.from(
    // Use a negative lookbehind (?<!\S) instead of a consuming group so that
    // adjacent @-paths (e.g. "@/a @/b") are matched independently. Strip
    // trailing punctuation that is accidentally captured when a sentence or
    // parenthetical ends immediately after the path.
    message.matchAll(/(?<!\S)@(\/[^\s]+)/g),
    ([, attachmentPath]) => {
      let path = attachmentPath;
      while (path.length > 1 && /[.,;:!?)\]}+]$/.test(path)) {
        path = path.slice(0, -1);
      }
      return path;
    },
  );
}

/** Resolve a path for containment checking, walking parent directories with
 *  realpath to preserve symlink detection even when the target file is missing. */
async function resolveForContainment(attachmentPath: string): Promise<string> {
  try {
    return await realpath(attachmentPath);
  } catch {
    // File does not exist — walk up the directory tree and realpath the
    // nearest existing parent, then append the remaining segments.
    let dir = dirname(attachmentPath);
    const remaining = [basename(attachmentPath)];
    while (dir !== '/' && dir !== '.') {
      try {
        const realDir = await realpath(dir);
        return join(realDir, ...remaining);
      } catch {
        remaining.unshift(basename(dir));
        dir = dirname(dir);
      }
    }
    // Nothing in the path exists — fall back to resolve (still safe against ..)
    return resolve(attachmentPath);
  }
}

export async function isManagedConversationAttachmentPath(attachmentPath: string): Promise<boolean> {
  try {
    const attachmentsRoot = resolve(getConversationAttachmentsRoot());
    const candidate = await resolveForContainment(attachmentPath);
    return candidate.startsWith(`${attachmentsRoot}/`);
  } catch {
    return false;
  }
}

export async function isConversationAttachmentPath(name: string, attachmentPath: string): Promise<boolean> {
  try {
    const attachmentDir = resolve(getConversationAttachmentDir(name));
    const candidate = await resolveForContainment(attachmentPath);
    return candidate.startsWith(`${attachmentDir}/`);
  } catch {
    return false;
  }
}

export async function hasConversationAttachment(name: string, attachmentPath: string): Promise<boolean> {
  return (await isConversationAttachmentPath(name, attachmentPath)) && existsSync(attachmentPath);
}

export async function removeConversationAttachment(name: string, attachmentPath: string): Promise<boolean> {
  if (!(await isConversationAttachmentPath(name, attachmentPath))) return false;
  await rm(attachmentPath, { force: true });
  return true;
}
