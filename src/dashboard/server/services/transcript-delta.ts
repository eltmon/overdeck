/** Full parsers keep their history in the worker; the wire carries only changed rows. */
import { isDeepStrictEqual } from 'node:util';
import type { ConversationEvent, ConversationResume } from '@overdeck/contracts';
import { contextUsageFromParseResult } from './conversation/context-usage.js';
import type { ParseResult } from './conversation/types.js';
import { projectWorkLog } from './conversation/wire-projection.js';
import { selectInitialWindow, selectResumeDelta } from './conversation/window.js';

type MessagesEvent = Extract<ConversationEvent, { kind: 'messages' }>;

function diffRows<T extends { id: string }>(previous: readonly T[], next: readonly T[]) {
  // Insertions, removals, and reordering cannot be expressed by the append/upsert
  // protocol. Send a snapshot rather than silently changing transcript order.
  const snapshot = previous.length > next.length || previous.some((row, i) => row.id !== next[i]?.id);
  if (snapshot) return { rows: next, snapshot };
  return { rows: next.filter((row, i) => !isDeepStrictEqual(row, previous[i])), snapshot };
}

/**
 * One bounded baseline per subscription; no serialized copies of large tool results.
 *
 * PAN-4558: the baseline keeps the full rows so diffs stay incremental, but
 * every snapshot that leaves here is windowed (newest rows plus a `window`
 * cursor) and every delta is wire-projected. On the first emission a `resume`
 * that still matches the transcript sends only the rows the client lacks.
 */
export function createTranscriptDelta(model: string | null, resume?: ConversationResume) {
  let previous: MessagesEvent | undefined;
  const windowed = (next: MessagesEvent, transcript: string | undefined, reset: boolean): MessagesEvent => {
    const rows = selectInitialWindow(next, transcript);
    return { ...next, ...rows, snapshot: true, ...(reset ? { reset: true } : {}) };
  };
  return (result: ParseResult, reset = false, transcript?: string): MessagesEvent | null => {
    const next: MessagesEvent = {
      kind: 'messages', messages: result.messages, workLog: result.workLog,
      streaming: result.streaming, totalCost: result.totalCost, snapshot: true, metadataSnapshot: true,
      proposedPlan: result.proposedPlan, compactBoundaries: result.compactBoundaries,
      contextUsage: contextUsageFromParseResult(result, model),
    };
    const first = !previous;
    if (first || reset) {
      previous = next;
      if (first && resume) {
        const resumed = selectResumeDelta(next, resume, transcript);
        if (resumed) return { ...next, ...resumed, snapshot: false };
        // An empty fallback never wipes what the client already shows.
        return windowed(next, transcript, next.messages.length + next.workLog.length > 0);
      }
      return windowed(next, transcript, reset);
    }
    const before = previous!;
    const messages = diffRows(before.messages, next.messages);
    const workLog = diffRows(before.workLog, next.workLog);
    const metadataChanged = before.streaming !== next.streaming || before.totalCost !== next.totalCost ||
      !isDeepStrictEqual(before.proposedPlan, next.proposedPlan) ||
      !isDeepStrictEqual(before.compactBoundaries, next.compactBoundaries) ||
      !isDeepStrictEqual(before.contextUsage, next.contextUsage);
    previous = next;
    if (messages.snapshot || workLog.snapshot) return windowed(next, transcript, true);
    if (!messages.rows.length && !workLog.rows.length && !metadataChanged) return null;
    return { ...next, snapshot: false, messages: messages.rows, workLog: projectWorkLog(workLog.rows) };
  };
}
