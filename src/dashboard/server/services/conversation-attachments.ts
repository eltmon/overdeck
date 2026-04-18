import { existsSync } from 'node:fs';
import { readdir, mkdir, rm, stat } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';

import type { Conversation } from '../../../lib/database/conversations-db.js';
import { getPanopticonHome } from '../../../lib/paths.js';
import { parseConversationMessages } from './conversation-service.js';

const CONVERSATION_ATTACHMENTS_DIR = 'conversation-attachments';

export function getConversationAttachmentsRoot(): string {
  return join(getPanopticonHome(), CONVERSATION_ATTACHMENTS_DIR);
}

export function getConversationAttachmentDir(name: string): string {
  return join(getConversationAttachmentsRoot(), name);
}

export async function ensureConversationAttachmentDir(name: string): Promise<string> {
  const dir = getConversationAttachmentDir(name);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function cleanupConversationAttachments(name: string): Promise<void> {
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
    const { messages } = await parseConversationMessages(sessionFile);
    const referenced = new Set<string>();
    for (const message of messages) {
      for (const attachmentPath of extractConversationAttachmentPaths(message.text)) {
        if (isManagedConversationAttachmentPath(attachmentPath)) {
          referenced.add(basename(attachmentPath));
        }
      }
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

  await Promise.all(
    attachmentPaths.map(async (attachmentPath) => {
      if (referencedBasenames.has(basename(attachmentPath))) {
        return;
      }

      try {
        const attachmentMtimeMs = (await stat(attachmentPath)).mtimeMs;
        if (attachmentMtimeMs > sessionMtimeMs) {
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

export function isManagedConversationAttachmentPath(attachmentPath: string): boolean {
  const attachmentsRoot = resolve(getConversationAttachmentsRoot());
  const candidate = resolve(attachmentPath);
  return candidate.startsWith(`${attachmentsRoot}${sep}`);
}

export function isConversationAttachmentPath(name: string, attachmentPath: string): boolean {
  const attachmentDir = resolve(getConversationAttachmentDir(name));
  const candidate = resolve(attachmentPath);
  return candidate.startsWith(`${attachmentDir}${sep}`);
}

export function hasConversationAttachment(name: string, attachmentPath: string): boolean {
  return isConversationAttachmentPath(name, attachmentPath) && existsSync(attachmentPath);
}

export async function removeConversationAttachment(name: string, attachmentPath: string): Promise<boolean> {
  if (!isConversationAttachmentPath(name, attachmentPath)) return false;
  await rm(attachmentPath, { force: true });
  return true;
}
