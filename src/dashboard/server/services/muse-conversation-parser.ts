/** Muse's durable root-session events projected into the dashboard chat feed. */
import { readFile, stat } from 'node:fs/promises';
import type { ChatMessage } from '@overdeck/contracts';
import type { ParseResult } from './conversation/types.js';
import { parseMuseRecords, museTimestamp, summarizeMuseRecords } from '../../../lib/cost-parsers/muse-parser.js';

export async function parseMuseConversationMessages(sessionFile: string): Promise<ParseResult> {
  const [raw, info] = await Promise.all([readFile(sessionFile, 'utf8'), stat(sessionFile)]);
  const records = parseMuseRecords(raw);
  const messages: ChatMessage[] = [];
  let streaming = false;
  let lastTurnCompletedAt: string | undefined;
  let sequence = 0;
  const seen = new Set<string>();
  for (const record of records) {
    if (record.id && seen.has(record.id)) continue;
    if (record.id) seen.add(record.id);
    if (record.payload?.kind !== 'run') continue;
    const event = record.payload.event;
    const createdAt = museTimestamp(record);
    if (event?.kind === 'started') {
      streaming = true;
      lastTurnCompletedAt = undefined;
      if (event.prompt) messages.push({ id: record.id ?? `muse-${sequence + 1}`, role: 'user', text: event.prompt,
        createdAt, completedAt: createdAt, streaming: false, sequence: ++sequence });
    } else if (event?.kind === 'assistant_message_committed' && event.text) {
      messages.push({ id: event.message_id ?? record.id ?? `muse-${sequence + 1}`, role: 'assistant', text: event.text,
        turnId: record.payload.run_id, createdAt, completedAt: createdAt, streaming: false, sequence: ++sequence });
    } else if (event?.kind === 'terminal') {
      streaming = false;
      lastTurnCompletedAt = createdAt;
    }
  }
  const usage = summarizeMuseRecords(records, sessionFile);
  return {
    messages, workLog: [], byteOffset: info.size, streaming, lastTurnCompletedAt,
    totalCost: usage?.cost_v2 ?? 0,
    totalTokens: usage ? usage.usage.inputTokens + usage.usage.outputTokens + (usage.usage.cacheReadTokens ?? 0) : 0,
    latestAssistantUsage: null, contextBoundaryOffset: 0, contextActiveBytes: info.size,
    pendingToolUse: new Map(), unresolvedResults: new Map(), lastSequence: sequence,
    mtimeMs: info.mtimeMs, planToolUseIds: new Set(), compactBoundaries: [], fileEditsByAssistantId: new Map(),
  };
}
