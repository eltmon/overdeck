import { createReadStream } from 'node:fs';
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
  let lineChunks: Buffer[] = [];
  let lineLength = 0;
  let lineStart = 0;
  let chunkStart = 0;
  let sequence = 0;

  for await (const rawChunk of createReadStream(sessionFile)) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    let segmentStart = 0;

    for (;;) {
      const newlineIndex = chunk.indexOf(0x0a, segmentStart);
      if (newlineIndex === -1) break;

      const segment = chunk.subarray(segmentStart, newlineIndex);
      if (segment.length > 0) {
        lineChunks.push(segment);
        lineLength += segment.length;
      }

      const lineEndWithNewline = chunkStart + newlineIndex + 1;
      const line = lineChunks.length === 1 ? lineChunks[0]! : Buffer.concat(lineChunks, lineLength);
      lineChunks = [];
      lineLength = 0;

      if (isNonEmptyJsonlLine(line)) {
        if (byteOffset >= lineStart && byteOffset < lineEndWithNewline) return sequence;
        sequence += 1;
      }
      if (byteOffset < lineEndWithNewline) return null;

      lineStart = lineEndWithNewline;
      segmentStart = newlineIndex + 1;
    }

    const remainder = chunk.subarray(segmentStart);
    if (remainder.length > 0) {
      lineChunks.push(remainder);
      lineLength += remainder.length;
    }
    chunkStart += chunk.length;
  }

  if (lineLength > 0) {
    const line = lineChunks.length === 1 ? lineChunks[0]! : Buffer.concat(lineChunks, lineLength);
    if (isNonEmptyJsonlLine(line) && byteOffset >= lineStart && byteOffset < lineStart + lineLength) return sequence;
  }
  return null;
}

function isNonEmptyJsonlLine(buffer: Buffer): boolean {
  const end = buffer.length > 0 && buffer[buffer.length - 1] === 0x0d ? buffer.length - 1 : buffer.length;
  return buffer.subarray(0, end).some((byte) => byte !== 0x20 && byte !== 0x09);
}
