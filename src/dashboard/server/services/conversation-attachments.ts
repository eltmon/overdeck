import { existsSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { readdir, mkdir, rm, stat, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

import type { Conversation } from '../../../lib/database/conversations-db.js';
import { getPanopticonHome } from '../../../lib/paths.js';

const CONVERSATION_ATTACHMENTS_DIR = 'conversation-attachments';

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
    await Promise.all(
      dirs
        .filter((entry) => entry.isDirectory() && !convNames.has(entry.name))
        .map((entry) => rm(join(root, entry.name), { recursive: true, force: true }).catch(() => {})),
    );
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

    const referenced = new Set<string>();
    const stream = createReadStream(sessionFile, { encoding: 'utf-8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of rl) {
        if (!line.trim()) continue;
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
            if (await isConversationAttachmentPath(name, attachmentPath)) {
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
            if (await isConversationAttachmentPath(name, attachmentPath)) {
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
  if (attachmentPaths.length === 0 || !conversation.sessionFile) {
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

  await Promise.all(
    attachmentPaths.map(async (attachmentPath) => {
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
    }),
  );
}

export function extractConversationAttachmentPaths(message: string): string[] {
  return Array.from(
    message.matchAll(/(?:^|\s)@((?:\/)[^\s]+)/g),
    ([, attachmentPath]) => attachmentPath,
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
