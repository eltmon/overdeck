/** Full parsers keep their history in the worker; the wire carries only changed rows. */
import { isDeepStrictEqual } from 'node:util';
import type { ConversationEvent } from '@overdeck/contracts';
import { contextUsageFromParseResult } from './conversation/context-usage.js';
import type { ParseResult } from './conversation/types.js';

type MessagesEvent = Extract<ConversationEvent, { kind: 'messages' }>;

function diffRows<T extends { id: string }>(previous: readonly T[], next: readonly T[]) {
  // Insertions, removals, and reordering cannot be expressed by the append/upsert
  // protocol. Send a snapshot rather than silently changing transcript order.
  const snapshot = previous.length > next.length || previous.some((row, i) => row.id !== next[i]?.id);
  if (snapshot) return { rows: next, snapshot };
  return { rows: next.filter((row, i) => !isDeepStrictEqual(row, previous[i])), snapshot };
}

/** One bounded baseline per subscription; no serialized copies of large tool results. */
export function createTranscriptDelta(model: string | null) {
  let previous: MessagesEvent | undefined;
  return (result: ParseResult, reset = false): MessagesEvent | null => {
    const next: MessagesEvent = {
      kind: 'messages', messages: result.messages, workLog: result.workLog,
      streaming: result.streaming, totalCost: result.totalCost, snapshot: true, metadataSnapshot: true,
      proposedPlan: result.proposedPlan, compactBoundaries: result.compactBoundaries,
      contextUsage: contextUsageFromParseResult(result, model),
      ...(reset ? { reset: true } : {}),
    };
    if (!previous || reset) { previous = next; return next; }
    const messages = diffRows(previous.messages, next.messages);
    const workLog = diffRows(previous.workLog, next.workLog);
    const metadataChanged = previous.streaming !== next.streaming || previous.totalCost !== next.totalCost ||
      !isDeepStrictEqual(previous.proposedPlan, next.proposedPlan) ||
      !isDeepStrictEqual(previous.compactBoundaries, next.compactBoundaries) ||
      !isDeepStrictEqual(previous.contextUsage, next.contextUsage);
    previous = next;
    if (messages.snapshot || workLog.snapshot) return { ...next, reset: true };
    if (!messages.rows.length && !workLog.rows.length && !metadataChanged) return null;
    return { ...next, snapshot: false, messages: messages.rows, workLog: workLog.rows };
  };
}
