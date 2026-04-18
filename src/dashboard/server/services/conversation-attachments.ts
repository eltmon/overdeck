import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

import { listArchivedConversationNames } from '../../../lib/database/conversations-db.js';
import { getPanopticonHome } from '../../../lib/paths.js';

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

export async function cleanupInactiveConversationAttachments(): Promise<void> {
  const names = listArchivedConversationNames();
  await Promise.all(names.map((name) => cleanupConversationAttachments(name)));
}

export function extractConversationAttachmentPaths(message: string): string[] {
  return message
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('@/'))
    .map((line) => line.slice(1));
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
