import {
  compareTimelineKeys,
  CONVERSATION_PAGE_DEFAULT_LIMIT,
  CONVERSATION_PAGE_MAX_LIMIT,
  CONVERSATION_WINDOW_MAX_BYTES,
  CONVERSATION_WINDOW_MAX_ROWS,
  decodeTimelineCursor,
  encodeTimelineCursor,
  hasToolResult,
  RESUME_OPEN_IDS_MAX,
  timelineKeyOfMessage,
  timelineKeyOfWork,
  WINDOW_PINNED_OPEN_TOOLS_MAX,
  type ChatMessage,
  type ConversationResume,
  type ConversationWindow,
  type TimelineKey,
  type WorkLogEntry,
} from '@overdeck/contracts';
import { projectWorkLogEntry } from './wire-projection.js';

// ─── Conversation windows (PAN-4558) ─────────────────────────────────────────
//
// One module decides which rows of a parsed transcript go on the wire: the
// newest window on a cold open, an older page by cursor, or the delta a
// resubscribing client is missing. Every returned work entry is already
// wire-projected, and bytes are measured on the projected copy. The input
// arrays are the shared parse cache, so nothing here sorts or mutates them.

export interface WindowInput {
  messages: readonly ChatMessage[];
  workLog: readonly WorkLogEntry[];
}

export interface WindowedRows {
  messages: ChatMessage[];
  workLog: WorkLogEntry[];
  window: ConversationWindow;
}

export interface WindowBudget {
  maxRows: number;
  maxBytes: number;
}

type TimelineItem =
  | { key: TimelineKey; kind: 'message'; entry: ChatMessage }
  | { key: TimelineKey; kind: 'work'; entry: WorkLogEntry };

export function transcriptIdOf(stats: { dev: number; ino: number }): string {
  return `${stats.dev}:${stats.ino}`;
}

/**
 * FR-4 query parsing shared by the HTTP routes: `before` (cursor) and `limit`.
 * Returns null when no `before` is present, and 'invalid-cursor' for a cursor
 * that does not decode. `limit` defaults to 75 and clamps to [1, 200].
 */
export function readPageParams(params: URLSearchParams): { before: TimelineKey; limit: number } | 'invalid-cursor' | null {
  const rawBefore = params.get('before');
  if (rawBefore === null) return null;
  const before = decodeTimelineCursor(rawBefore);
  if (!before) return 'invalid-cursor';
  const parsed = Number.parseInt(params.get('limit') ?? '', 10);
  const limit = Number.isNaN(parsed)
    ? CONVERSATION_PAGE_DEFAULT_LIMIT
    : Math.min(CONVERSATION_PAGE_MAX_LIMIT, Math.max(1, parsed));
  return { before, limit };
}

function timelineItems(input: WindowInput): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const entry of input.messages) items.push({ key: timelineKeyOfMessage(entry), kind: 'message', entry });
  for (const entry of input.workLog) items.push({ key: timelineKeyOfWork(entry), kind: 'work', entry });
  return items.sort((a, b) => compareTimelineKeys(a.key, b.key));
}

/** Work entries leave the module wire-projected. */
function toWire(item: TimelineItem): TimelineItem {
  return item.kind === 'work' ? { ...item, entry: projectWorkLogEntry(item.entry) } : item;
}

function encodedBytes(entry: ChatMessage | WorkLogEntry): number {
  return Buffer.byteLength(JSON.stringify(entry), 'utf8');
}

/** Walks from the newest item and takes a contiguous slice under the budget; the newest item is always taken. */
function takeNewest(items: readonly TimelineItem[], budget: WindowBudget): { taken: TimelineItem[]; oldestIndex: number } {
  const taken: TimelineItem[] = [];
  let rows = 0;
  let bytes = 0;
  let previousKind: TimelineItem['kind'] | null = null;
  let oldestIndex = items.length;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    const startsRow = item.kind === 'message' || previousKind !== 'work';
    const wire = toWire(item);
    const nextRows = rows + (startsRow ? 1 : 0);
    const nextBytes = bytes + encodedBytes(wire.entry);
    if (taken.length > 0 && (nextRows > budget.maxRows || nextBytes > budget.maxBytes)) break;
    taken.push(wire);
    rows = nextRows;
    bytes = nextBytes;
    previousKind = item.kind;
    oldestIndex = i;
  }
  return { taken, oldestIndex };
}

function isOpenTool(entry: WorkLogEntry): boolean {
  return entry.tone === 'tool' && !hasToolResult(entry);
}

function splitSorted(items: TimelineItem[]): { messages: ChatMessage[]; workLog: WorkLogEntry[] } {
  items.sort((a, b) => compareTimelineKeys(a.key, b.key));
  const messages: ChatMessage[] = [];
  const workLog: WorkLogEntry[] = [];
  for (const item of items) {
    if (item.kind === 'message') messages.push(item.entry);
    else workLog.push(item.entry);
  }
  return { messages, workLog };
}

function windowOf(items: readonly TimelineItem[], taken: readonly TimelineItem[], oldestIndex: number, transcript?: string): ConversationWindow {
  return {
    cursor: taken.length > 0 ? encodeTimelineCursor(items[oldestIndex]!.key) : null,
    hasOlder: taken.length > 0 && oldestIndex > 0,
    ...(transcript !== undefined ? { transcript } : {}),
  };
}

/** FR-1/FR-3: the newest window plus the newest open tool calls older than it. */
export function selectInitialWindow(
  input: WindowInput,
  transcript?: string,
  budget: WindowBudget = { maxRows: CONVERSATION_WINDOW_MAX_ROWS, maxBytes: CONVERSATION_WINDOW_MAX_BYTES },
): WindowedRows {
  const items = timelineItems(input);
  const { taken, oldestIndex } = takeNewest(items, budget);
  const window = windowOf(items, taken, oldestIndex, transcript);

  // Pinned entries sit older than the cursor and never move it.
  const pinned: TimelineItem[] = [];
  for (let i = oldestIndex - 1; i >= 0 && pinned.length < WINDOW_PINNED_OPEN_TOOLS_MAX; i--) {
    const item = items[i]!;
    if (item.kind === 'work' && isOpenTool(item.entry)) pinned.push(toWire(item));
  }

  return { ...splitSorted([...taken, ...pinned]), window };
}

/** FR-4: the page of entries strictly older than `before`. */
export function selectPageBefore(input: WindowInput, before: TimelineKey, limit: number, transcript?: string): WindowedRows {
  const items = timelineItems(input).filter((item) => compareTimelineKeys(item.key, before) < 0);
  const { taken, oldestIndex } = takeNewest(items, { maxRows: limit, maxBytes: CONVERSATION_WINDOW_MAX_BYTES });
  return { ...splitSorted(taken), window: windowOf(items, taken, oldestIndex, transcript) };
}

function hasNumericSequence(entry: { sequence?: number }): entry is { sequence: number } {
  return typeof entry.sequence === 'number' && Number.isFinite(entry.sequence);
}

/**
 * FR-8: entries newer than `afterSequence` plus the server's current copy of
 * every still-open entry the client named. Returns null when the resume does
 * not apply and the caller must send a windowed reset snapshot instead. An
 * empty delta is a successful resume.
 */
export function selectResumeDelta(
  input: WindowInput,
  resume: ConversationResume,
  transcript: string | undefined,
): { messages: ChatMessage[]; workLog: WorkLogEntry[] } | null {
  if (transcript === undefined || transcript !== resume.transcript) return null;
  if (!Number.isFinite(resume.afterSequence)) return null;
  if (!input.messages.every(hasNumericSequence) || !input.workLog.every(hasNumericSequence)) return null;

  let maxSequence = Number.NEGATIVE_INFINITY;
  for (const entry of input.messages) maxSequence = Math.max(maxSequence, entry.sequence!);
  for (const entry of input.workLog) maxSequence = Math.max(maxSequence, entry.sequence!);
  if (resume.afterSequence > maxSequence) return null;

  const openIds = new Set(resume.openIds.slice(0, RESUME_OPEN_IDS_MAX));
  const wanted = (entry: { id: string; sequence?: number }) => entry.sequence! > resume.afterSequence || openIds.has(entry.id);
  const items: TimelineItem[] = [];
  for (const entry of input.messages) {
    if (wanted(entry)) items.push({ key: timelineKeyOfMessage(entry), kind: 'message', entry });
  }
  for (const entry of input.workLog) {
    if (wanted(entry)) items.push({ key: timelineKeyOfWork(entry), kind: 'work', entry: projectWorkLogEntry(entry) });
  }

  let bytes = 0;
  for (const item of items) {
    bytes += encodedBytes(item.entry);
    if (bytes > CONVERSATION_WINDOW_MAX_BYTES) return null;
  }
  return splitSorted(items);
}
