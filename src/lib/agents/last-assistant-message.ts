/**
 * Reads the last assistant message from an agent's transcript tail, for turn-end
 * classification (PAN-4371). Reads only the trailing bytes of large transcripts —
 * never the whole file — since only the final message matters here.
 */
import { open, stat } from 'node:fs/promises';

import { resolveAgentTranscriptCandidate } from './transcript-resolver.js';
import type { TranscriptCandidate, TranscriptCandidateKind } from '../session-history.js';
import { parseConversationMessages } from '../../dashboard/server/services/conversation/parser.js';
import { createCodexConversationAccumulator } from '../../dashboard/server/services/codex-conversation-parser.js';

/** Only the trailing bytes of the transcript are read — the final message is all that matters here. */
export const LAST_ASSISTANT_TAIL_BYTES = 256 * 1024;

export type LastAssistantMessage =
  | { ok: true; messageId: string; text: string; transcriptKind: TranscriptCandidateKind }
  | { ok: false; reason: 'no-transcript' | 'unsupported-harness' | 'no-assistant-message' | 'read-failed' };

export async function readLastAssistantMessage(agentId: string, workspace: string): Promise<LastAssistantMessage> {
  const candidate = await resolveAgentTranscriptCandidate(agentId, workspace);
  if (!candidate) return { ok: false, reason: 'no-transcript' };
  return readLastAssistantMessageFromCandidate(candidate);
}

export async function readLastAssistantMessageFromCandidate(
  candidate: TranscriptCandidate,
): Promise<LastAssistantMessage> {
  try {
    const messages = await readMessages(candidate);
    if (!messages) return { ok: false, reason: 'unsupported-harness' };

    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.role === 'assistant' && message.text.trim().length > 0) {
        return { ok: true, messageId: message.id, text: message.text, transcriptKind: candidate.kind };
      }
    }
    return { ok: false, reason: 'no-assistant-message' };
  } catch {
    return { ok: false, reason: 'read-failed' };
  }
}

async function readMessages(
  candidate: TranscriptCandidate,
): Promise<ReadonlyArray<{ id: string; role: string; text: string }> | null> {
  if (candidate.kind === 'claude') {
    const { size } = await stat(candidate.path);
    const result = await parseConversationMessages(candidate.path, Math.max(0, size - LAST_ASSISTANT_TAIL_BYTES));
    return result.messages;
  }

  if (candidate.kind === 'codex') {
    return readCodexTailMessages(candidate.path);
  }

  return null;
}

async function readCodexTailMessages(
  path: string,
): Promise<ReadonlyArray<{ id: string; role: string; text: string }>> {
  const accumulator = createCodexConversationAccumulator(path);
  const handle = await open(path, 'r');
  try {
    const { size, mtimeMs } = await handle.stat();
    const offset = Math.max(0, size - LAST_ASSISTANT_TAIL_BYTES);
    const length = size - offset;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    let text = buffer.subarray(0, bytesRead).toString('utf8');

    // A tail offset mid-file may start inside a line — drop the partial first line.
    if (offset !== 0) {
      const firstNewline = text.indexOf('\n');
      text = firstNewline === -1 ? '' : text.slice(firstNewline + 1);
    }

    let from = 0;
    for (let end = text.indexOf('\n'); end !== -1; end = text.indexOf('\n', from)) {
      accumulator.push(text.slice(from, end));
      from = end + 1;
    }
    // A trailing write in progress may leave an incomplete final record — only push it
    // once it parses, mirroring incremental-transcript-reader.ts.
    const pending = text.slice(from);
    if (pending.trim()) {
      try {
        JSON.parse(pending);
        accumulator.push(pending);
      } catch {
        // incomplete final record — drop it
      }
    }

    return accumulator.result(size, mtimeMs).messages;
  } finally {
    await handle.close();
  }
}
