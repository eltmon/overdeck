/**
 * MessagesTimeline.logic.ts (PAN-826)
 *
 * Transforms raw ChatMessage[] + WorkLogEntry[] into TimelineEntry[],
 * which can then be rendered or converted to MessagesTimelineRow[].
 *
 * Mirrors the core pattern from T3Code's MessagesTimeline.logic.ts, simplified
 * for Overdeck (no attachment handling, etc.).
 */

import type { ChatMessage, CompactBoundary, ProposedPlan, WorkLogEntry } from './chat-types';

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
      plan: ProposedPlan;
    }
  | {
      kind: 'compact-boundary';
      id: string;
      createdAt: string;
      boundary: CompactBoundary;
    }
  | {
      kind: 'compacting';
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
 * Compact boundaries are interleaved by timestamp at entry granularity and
 * split work groups — placing them against grouped rows (whose createdAt is
 * the group's FIRST entry) pushed every mid-group boundary to the end of the
 * timeline (PAN-2576).
 * A "working" indicator row is appended when isWorking is true.
 */
export function deriveMessagesTimelineRows(
  timelineEntries: TimelineEntry[],
  isWorking: boolean,
  compactBoundaries?: CompactBoundary[],
): MessagesTimelineRow[] {
  const rows: MessagesTimelineRow[] = [];
  let i = 0;

  const boundaries = [...(compactBoundaries ?? [])].sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0,
  );
  let boundaryIdx = 0;
  // Emit every boundary that precedes `createdAt`; entries stamped exactly at
  // the boundary timestamp stay before it (matches the old insert-before-first-
  // strictly-greater semantics).
  const flushBoundariesBefore = (createdAt: string): void => {
    while (boundaryIdx < boundaries.length && boundaries[boundaryIdx]!.timestamp < createdAt) {
      const boundary = boundaries[boundaryIdx]!;
      rows.push({
        kind: 'compact-boundary',
        id: `compact-${boundary.id}`,
        createdAt: boundary.timestamp,
        boundary,
      });
      boundaryIdx++;
    }
  };
  const hasBoundaryBefore = (createdAt: string): boolean =>
    boundaryIdx < boundaries.length && boundaries[boundaryIdx]!.timestamp < createdAt;

  const durationStartByMessageId = computeMessageDurationStart(
    timelineEntries.flatMap((entry) => (entry.kind === 'message' ? [entry.message] : [])),
  );

  while (i < timelineEntries.length) {
    const entry = timelineEntries[i]!;
    flushBoundariesBefore(entry.createdAt);

    if (entry.kind === 'work') {
      // Group consecutive work entries, breaking at compact boundaries
      const groupedEntries: WorkLogEntry[] = [entry.entry];
      let cursor = i + 1;
      while (
        cursor < timelineEntries.length &&
        timelineEntries[cursor]!.kind === 'work' &&
        !hasBoundaryBefore(timelineEntries[cursor]!.createdAt)
      ) {
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

  // Boundaries newer than every entry (e.g. compaction just finished) land at
  // the end, but still before the working indicator.
  while (boundaryIdx < boundaries.length) {
    const boundary = boundaries[boundaryIdx]!;
    rows.push({
      kind: 'compact-boundary',
      id: `compact-${boundary.id}`,
      createdAt: boundary.timestamp,
      boundary,
    });
    boundaryIdx++;
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

export interface EstimateHeightInput {
  timelineWidth?: number;
  /** When true, tool-only work groups are collapsed to a single muted line. */
  hideToolCalls?: boolean;
}

/** Estimate height in pixels for a MessagesTimelineRow. Used by useVirtualizer. */
export function estimateMessagesTimelineRowHeight(
  row: MessagesTimelineRow,
  input: EstimateHeightInput = {},
): number {
  const { timelineWidth = 800, hideToolCalls = false } = input;
  if (row.kind === 'working') return 40;
  if (row.kind === 'compact-boundary') return 40;
  if (row.kind === 'compacting') return 40;
  if (row.kind === 'proposed-plan') {
    const lines = Math.max(3, Math.ceil(row.plan.plan.length / 60));
    return 120 + lines * 20;
  }

  if (row.kind === 'work') {
    const onlyToolEntries = row.groupedEntries.every((entry) => entry.tone === 'tool' || entry.tone === 'error');
    if (hideToolCalls && onlyToolEntries) {
      return 32;
    }
    const visible = Math.min(row.groupedEntries.length, MAX_VISIBLE_WORK_LOG_ENTRIES);
    return 28 + visible * 32;
  }

  // message
  const { message } = row;
  if (message.role === 'system') return 28;
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
