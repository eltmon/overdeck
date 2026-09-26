/**
 * Detects a provider error (billing, usage limit, ...) at the very end of a
 * Claude Code conversation transcript (PAN-4222 WI-8, decision D8).
 *
 * A conversation stopped on a provider error looks identical to a normally
 * idle one — `sessionAlive`, not working, nothing pending — so the Live view
 * misreads it as quietly finished. The distinguishing fact lives in the
 * transcript's own last turn: Claude Code marks a provider-rejected assistant
 * turn with `isApiErrorMessage: true`. Any conversation whose pane title
 * happens to mention "billing" or "credits" is not evidence of this — only
 * the transcript's own record is (the conv-3870 trap: that conversation's
 * example was a normal reply whose *topic* was billing, not a provider
 * error).
 */
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

const TAIL_BYTES = 64 * 1024;
const MESSAGE_MAX = 200;

export interface ConversationProviderError {
  message: string;
  at: string;
  status: number | null;
  code: string | null;
}

type JsonRecord = { [key: string]: unknown };

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

/** Plain text out of a Claude `message.content` (string or a block array of `{text}`). */
function messageTextOf(record: JsonRecord): string {
  const message = asRecord(record['message']);
  const content = message?.['content'];
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    const b = asRecord(block);
    if (b && typeof b['text'] === 'string') parts.push(b['text']);
  }
  return parts.join('');
}

/**
 * Walks the transcript tail newest first, skipping every record that is not
 * `user`/`assistant` or is a sidechain (subagent) record. The first remaining
 * record decides the answer: a provider error only when it is an assistant
 * record with `isApiErrorMessage === true`; anything else (including a
 * perfectly normal assistant reply, or a user record) means null — this is a
 * structural check, never a scan of message text for keywords.
 *
 * @param cutFirstLine Whether the tail read started mid-file, so its first
 *   line may be a torn write and must be dropped.
 */
export function providerErrorFromTranscriptTail(text: string, cutFirstLine: boolean): ConversationProviderError | null {
  const lines = text.split('\n');
  if (cutFirstLine) lines.shift();
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!;
    if (!line.trim()) continue;
    let record: JsonRecord | null;
    try {
      record = asRecord(JSON.parse(line));
    } catch {
      continue;
    }
    if (!record) continue;
    if (record['isSidechain'] === true) continue;
    const type = record['type'];
    if (type !== 'user' && type !== 'assistant') continue;
    if (type !== 'assistant' || record['isApiErrorMessage'] !== true) return null;
    const trimmed = messageTextOf(record).trim();
    return {
      message: trimmed.length > MESSAGE_MAX ? trimmed.slice(0, MESSAGE_MAX) : trimmed,
      at: typeof record['timestamp'] === 'string' ? record['timestamp'] : '',
      status: typeof record['apiErrorStatus'] === 'number' ? record['apiErrorStatus'] : null,
      code: typeof record['error'] === 'string' ? record['error'] : null,
    };
  }
  return null;
}

/** Reads the transcript's last 64 KB and parses it; null on any error (missing file, non-file, read failure). */
export async function readConversationProviderError(path: string): Promise<ConversationProviderError | null> {
  try {
    const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const info = await handle.stat();
      if (!info.isFile()) return null;
      const start = Math.max(0, info.size - TAIL_BYTES);
      const buffer = Buffer.alloc(info.size - start);
      await handle.read(buffer, 0, buffer.length, start);
      return providerErrorFromTranscriptTail(buffer.toString('utf8'), start > 0);
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}
