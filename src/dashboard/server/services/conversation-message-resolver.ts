import { readFile } from 'node:fs/promises';
import type { ChatMessage } from '@panctl/contracts';

import { parseConversationMessages } from './conversation-service.js';

export interface ConversationMessageLocator {
  messageId: string;
  messageIndex: number;
  sequence: number;
  byteOffset: number;
}

export interface ResolveConversationMessageOptions {
  parseMessages?: typeof parseConversationMessages;
}

/**
 * Resolve a JSONL byte offset to the rendered message locator used by the drawer.
 *
 * Conversation-search chunks store offsets inside the source JSONL line. The
 * message parser assigns `sequence` from non-empty JSONL line order, so the
 * resolver first maps the byte offset to that line sequence, then finds the
 * rendered ChatMessage with the same sequence.
 */
export async function resolveConversationMessageLocator(
  sessionFile: string,
  byteOffset: number,
  options: ResolveConversationMessageOptions = {},
): Promise<ConversationMessageLocator | null> {
  if (!Number.isInteger(byteOffset) || byteOffset < 0) return null;

  const targetSequence = await findJsonlSequenceForByteOffset(sessionFile, byteOffset);
  if (targetSequence === null) return null;

  const parseMessages = options.parseMessages ?? parseConversationMessages;
  const parsed = await parseMessages(sessionFile);
  const messageIndex = parsed.messages.findIndex((message: ChatMessage) => message.sequence === targetSequence);
  if (messageIndex === -1) return null;

  const message = parsed.messages[messageIndex]!;
  return {
    messageId: message.id,
    messageIndex,
    sequence: targetSequence,
    byteOffset,
  };
}

async function findJsonlSequenceForByteOffset(sessionFile: string, byteOffset: number): Promise<number | null> {
  const buffer = await readFile(sessionFile);
  if (byteOffset >= buffer.length) return null;

  let lineStart = 0;
  let sequence = 0;
  for (let index = 0; index <= buffer.length; index++) {
    if (index < buffer.length && buffer[index] !== 0x0a) continue;

    const lineEndExclusive = index;
    const lineEndWithNewline = index < buffer.length ? index + 1 : index;
    const line = buffer.subarray(lineStart, stripTrailingCarriageReturn(buffer, lineStart, lineEndExclusive));
    const isNonEmpty = line.some((byte) => byte !== 0x20 && byte !== 0x09);

    if (isNonEmpty) {
      if (byteOffset >= lineStart && byteOffset < lineEndWithNewline) return sequence;
      sequence += 1;
    }

    lineStart = index + 1;
  }

  return null;
}

function stripTrailingCarriageReturn(buffer: Buffer, start: number, end: number): number {
  if (end > start && buffer[end - 1] === 0x0d) return end - 1;
  return end;
}
