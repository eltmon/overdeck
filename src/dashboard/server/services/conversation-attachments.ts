import { existsSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { readdir, mkdir, rm, stat, realpath } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';

import type { Conversation } from '../../../lib/database/conversations-db.js';
import { getPanopticonHome } from '../../../lib/paths.js';

const CONVERSATION_ATTACHMENTS_DIR = 'conversation-attachments';

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

async function readSessionAttachmentBasenames(sessionFile: string): Promise<Set<string>> {
  try {
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
            if (await isManagedConversationAttachmentPath(attachmentPath)) {
              referenced.add(basename(attachmentPath));
            }
          }
        }
      }
    } finally {
      rl.close();
      stream.destroy();
    }
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

  const referencedBasenames = await readSessionAttachmentBasenames(conversation.sessionFile);

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

export async function isManagedConversationAttachmentPath(attachmentPath: string): Promise<boolean> {
  try {
    const attachmentsRoot = resolve(getConversationAttachmentsRoot());
    const candidate = await realpath(attachmentPath);
    return candidate.startsWith(`${attachmentsRoot}${sep}`);
  } catch {
    return false;
  }
}

export async function isConversationAttachmentPath(name: string, attachmentPath: string): Promise<boolean> {
  try {
    const attachmentDir = resolve(getConversationAttachmentDir(name));
    const candidate = await realpath(attachmentPath);
    return candidate.startsWith(`${attachmentDir}${sep}`);
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
