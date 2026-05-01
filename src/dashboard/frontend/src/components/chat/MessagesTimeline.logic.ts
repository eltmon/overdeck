/**
 * MessagesTimeline.logic.ts (PAN-826)
 *
 * Transforms raw ChatMessage[] + WorkLogEntry[] into TimelineEntry[],
 * which can then be rendered or converted to MessagesTimelineRow[].
 *
 * Mirrors the core pattern from T3Code's MessagesTimeline.logic.ts, simplified
 * for Panopticon (no attachment handling, etc.).
 */

import type { ChatMessage, WorkLogEntry } from './chat-types';

// ─── Timeline entry types ─────────────────────────────────────────────────────

export type TimelineEntry =
  | { id: string; kind: 'message'; createdAt: string; sequence?: number; message: ChatMessage }
  | { id: string; kind: 'work'; createdAt: string; sequence?: number; entry: WorkLogEntry };

// ─── Row types (after grouping consecutive work entries) ──────────────────────

export type MessagesTimelineRow =
  | {
      kind: 'work';
      id: string;
      createdAt: string;
      groupedEntries: WorkLogEntry[];
    }
  | {
      kind: 'message';
      id: string;
      createdAt: string;
      message: ChatMessage;
      /** Timestamp of the preceding user message — used for duration display. */
      durationStart: string;
    }
  | {
      kind: 'proposed-plan';
      id: string;
      createdAt: string;
    }
  | {
      kind: 'working';
      id: string;
      createdAt: string | null;
    };

// ─── deriveTimelineEntries ────────────────────────────────────────────────────

/**
 * Merge ChatMessage[] and WorkLogEntry[] into a single TimelineEntry[]
 * sorted by createdAt timestamp.
 */
export function deriveTimelineEntries(
  messages: ChatMessage[],
  workLog: WorkLogEntry[],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...messages.map(
      (m): TimelineEntry => ({ id: m.id, kind: 'message', createdAt: m.createdAt, sequence: m.sequence, message: m }),
    ),
    ...workLog.map(
      (w): TimelineEntry => ({ id: w.id, kind: 'work', createdAt: w.createdAt, sequence: w.sequence, entry: w }),
    ),
  ];

  return entries.sort((a, b) => {
    // ISO 8601 timestamps sort lexicographically — use direct comparison,
    // not localeCompare, to avoid locale-sensitive ordering surprises.
    if (a.createdAt < b.createdAt) return -1;
    if (a.createdAt > b.createdAt) return 1;
    if (a.sequence !== undefined && b.sequence !== undefined) {
      return a.sequence - b.sequence;
    }
    return 0;
  });
}

// ─── computeMessageDurationStart ──────────────────────────────────────────────

/**
 * Compute the duration-start timestamp for each message.
 *
 * For assistant messages, duration starts at the most recent user message
 * (the request that triggered the response). This lets us keep createdAt as
 * the actual response time (for correct chronological interleaving with work
 * log entries) while still showing accurate response durations.
 *
 * Mirrors T3Code's computeMessageDurationStart.
 */
export function computeMessageDurationStart(
  messages: ReadonlyArray<ChatMessage>,
): Map<string, string> {
  const result = new Map<string, string>();
  let lastBoundary: string | null = null;

  for (const message of messages) {
    if (message.role === 'user') {
      lastBoundary = message.createdAt;
    }
    result.set(message.id, lastBoundary ?? message.createdAt);
    if (message.role === 'assistant' && message.completedAt) {
      lastBoundary = message.completedAt;
    }
  }

  return result;
}

// ─── deriveMessagesTimelineRows ───────────────────────────────────────────────

/**
 * Convert TimelineEntry[] into MessagesTimelineRow[] for rendering.
 * Consecutive work entries are grouped into a single row.
 * A "working" indicator row is appended when isWorking is true.
 */
export function deriveMessagesTimelineRows(
  timelineEntries: TimelineEntry[],
  isWorking: boolean,
): MessagesTimelineRow[] {
  const rows: MessagesTimelineRow[] = [];
  let i = 0;

  const durationStartByMessageId = computeMessageDurationStart(
    timelineEntries.flatMap((entry) => (entry.kind === 'message' ? [entry.message] : [])),
  );

  while (i < timelineEntries.length) {
    const entry = timelineEntries[i]!;

    if (entry.kind === 'work') {
      // Group consecutive work entries
      const groupedEntries: WorkLogEntry[] = [entry.entry];
      let cursor = i + 1;
      while (cursor < timelineEntries.length && timelineEntries[cursor]!.kind === 'work') {
        groupedEntries.push((timelineEntries[cursor]! as { kind: 'work'; entry: WorkLogEntry }).entry);
        cursor++;
      }
      rows.push({
        kind: 'work',
        id: entry.id,
        createdAt: entry.createdAt,
        groupedEntries,
      });
      i = cursor;
    } else {
      rows.push({
        kind: 'message',
        id: entry.id,
        createdAt: entry.createdAt,
        message: entry.message,
        durationStart: durationStartByMessageId.get(entry.message.id) ?? entry.message.createdAt,
      });
      i++;
    }
  }

  if (isWorking) {
    const lastEntry = timelineEntries[timelineEntries.length - 1];
    rows.push({
      kind: 'working',
      id: 'working-indicator',
      createdAt: lastEntry?.createdAt ?? null,
    });
  }

  return rows;
}

// ─── Height estimation ────────────────────────────────────────────────────────

const MAX_VISIBLE_WORK_LOG_ENTRIES = 6;

/** Estimate height in pixels for a MessagesTimelineRow. Used by useVirtualizer. */
export function estimateMessagesTimelineRowHeight(
  row: MessagesTimelineRow,
  timelineWidth = 800,
): number {
  if (row.kind === 'working') return 40;
  if (row.kind === 'proposed-plan') return 40;

  if (row.kind === 'work') {
    const visible = Math.min(row.groupedEntries.length, MAX_VISIBLE_WORK_LOG_ENTRIES);
    return 28 + visible * 32;
  }

  // message
  const { message } = row;
  if (message.role === 'user') {
    const bubbleWidth = Math.max(4, Math.floor((timelineWidth * 0.8 - 32) / 8.4));
    const lines = Math.max(1, Math.ceil(message.text.length / bubbleWidth));
    return 96 + lines * 22;
  }
  // assistant
  const charsPerLine = Math.max(20, Math.floor((timelineWidth - 8) / 7.2));
  const lines = Math.max(1, Math.ceil(message.text.length / charsPerLine));
  return 41 + lines * 22.75;
}
