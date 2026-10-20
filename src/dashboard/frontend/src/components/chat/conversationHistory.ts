import {
  compareTimelineKeys,
  decodeTimelineCursor,
  encodeTimelineCursor,
  hasToolResult,
  RESUME_OPEN_IDS_MAX,
  timelineKeyOfMessage,
  timelineKeyOfWork,
  type ConversationResume,
  type TimelineKey,
} from '@overdeck/contracts';
import type { ChatMessage, ConversationWindow, WorkLogEntry } from './chat-types';

// ─── Windowed conversation history (PAN-4558) ────────────────────────────────
//
// The server sends the newest window of a transcript and pages older rows by
// cursor. The client cache keeps every row it has paged in, and a later
// window (WS snapshot or HTTP poll) only replaces the rows from its cursor on.

export interface HistoryRows {
  messages: ChatMessage[];
  workLog: WorkLogEntry[];
  /** Where the oldest loaded contiguous row sits; absent for a legacy full body. */
  history?: ConversationWindow;
}

export interface IncomingWindow {
  messages: ChatMessage[];
  workLog: WorkLogEntry[];
  window?: ConversationWindow;
  reset?: boolean;
}

function sortedMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.sort((a, b) => compareTimelineKeys(timelineKeyOfMessage(a), timelineKeyOfMessage(b)));
}

function sortedWorkLog(workLog: WorkLogEntry[]): WorkLogEntry[] {
  return workLog.sort((a, b) => compareTimelineKeys(timelineKeyOfWork(a), timelineKeyOfWork(b)));
}

function newestKey(rows: Pick<HistoryRows, 'messages' | 'workLog'>): TimelineKey | null {
  let newest: TimelineKey | null = null;
  for (const message of rows.messages) {
    const key = timelineKeyOfMessage(message);
    if (!newest || compareTimelineKeys(key, newest) > 0) newest = key;
  }
  for (const entry of rows.workLog) {
    const key = timelineKeyOfWork(entry);
    if (!newest || compareTimelineKeys(key, newest) > 0) newest = key;
  }
  return newest;
}

function oldestKey(rows: Pick<HistoryRows, 'messages' | 'workLog'>): TimelineKey | null {
  let oldest: TimelineKey | null = null;
  for (const message of rows.messages) {
    const key = timelineKeyOfMessage(message);
    if (!oldest || compareTimelineKeys(key, oldest) < 0) oldest = key;
  }
  for (const entry of rows.workLog) {
    const key = timelineKeyOfWork(entry);
    if (!oldest || compareTimelineKeys(key, oldest) < 0) oldest = key;
  }
  return oldest;
}

function replaceWith(incoming: IncomingWindow): HistoryRows {
  return { messages: incoming.messages, workLog: incoming.workLog, history: incoming.window };
}

/**
 * FR-9: merge a windowed response into the cache. Rows older than the
 * response's cursor that the cache already holds are kept; from the cursor to
 * the response's newest row the response is authoritative. A reset, an empty cache, a different
 * transcript, a legacy full body, a window that reaches the first row, or a
 * gap between the cache's newest row and the response's cursor replaces the
 * cache. An empty window that is not a reset keeps the cache.
 */
export function mergeWindowIntoCache(previous: HistoryRows | undefined, incoming: IncomingWindow): HistoryRows {
  const window = incoming.window;
  if (!window || incoming.reset || !previous) return replaceWith(incoming);
  const previousNewest = newestKey(previous);
  if (!previousNewest) return replaceWith(incoming);
  const previousTranscript = previous.history?.transcript;
  if (previousTranscript && window.transcript && previousTranscript !== window.transcript) return replaceWith(incoming);

  const cursor = window.cursor === null ? null : decodeTimelineCursor(window.cursor);
  if (window.cursor !== null && !cursor) return replaceWith(incoming);
  if (cursor && compareTimelineKeys(cursor, previousNewest) > 0) return replaceWith(incoming);
  // The window reaches the first row, so nothing older than it exists to keep.
  if (cursor && !window.hasOlder) return replaceWith(incoming);

  const incomingIds = new Set<string>();
  for (const message of incoming.messages) incomingIds.add(message.id);
  for (const entry of incoming.workLog) incomingIds.add(entry.id);
  // Rows newer than the response arrived after it was read (a stream delta
  // racing an HTTP read); deltas never resend them, so they are kept too.
  const incomingNewest = newestKey(incoming);
  const isKept = (id: string, key: TimelineKey) => !incomingIds.has(id) && (
    !cursor
    || compareTimelineKeys(key, cursor) < 0
    || (incomingNewest !== null && compareTimelineKeys(key, incomingNewest) > 0));
  const keptMessages = previous.messages.filter((message) => isKept(message.id, timelineKeyOfMessage(message)));
  const keptWorkLog = previous.workLog.filter((entry) => isKept(entry.id, timelineKeyOfWork(entry)));
  if (keptMessages.length === 0 && keptWorkLog.length === 0) return replaceWith(incoming);

  const transcript = window.transcript ?? previousTranscript;
  const kept = { messages: keptMessages, workLog: keptWorkLog };
  const history: ConversationWindow = previous.history
    ? { ...previous.history, ...(transcript !== undefined ? { transcript } : {}) }
    // A legacy full body held the whole transcript, so nothing older remains.
    : { cursor: encodeTimelineCursor(oldestKey(kept)!), hasOlder: false, ...(transcript !== undefined ? { transcript } : {}) };
  return {
    messages: sortedMessages([...keptMessages, ...incoming.messages]),
    workLog: sortedWorkLog([...keptWorkLog, ...incoming.workLog]),
    history,
  };
}

/**
 * FR-10: prepend an older page. A page fetched for a cursor the cache no
 * longer holds is stale and ignored. Rows the cache already has (pinned open
 * tools) are not duplicated.
 */
export function prependOlderPage<T extends HistoryRows>(
  previous: T,
  page: { messages: ChatMessage[]; workLog: WorkLogEntry[]; window: ConversationWindow },
  requestedCursor: string,
): T {
  if (previous.history?.cursor !== requestedCursor) return previous;
  const messageIds = new Set(previous.messages.map((message) => message.id));
  const workIds = new Set(previous.workLog.map((entry) => entry.id));
  return {
    ...previous,
    messages: sortedMessages([...page.messages.filter((message) => !messageIds.has(message.id)), ...previous.messages]),
    workLog: sortedWorkLog([...page.workLog.filter((entry) => !workIds.has(entry.id)), ...previous.workLog]),
    history: { ...previous.history, cursor: page.window.cursor, hasOlder: page.window.hasOlder },
  };
}

function isOpenMessage(message: ChatMessage): boolean {
  return message.role === 'assistant' && !message.completedAt;
}

function isOpenWork(entry: WorkLogEntry): boolean {
  return entry.tone === 'tool' && !hasToolResult(entry);
}

/**
 * FR-8: what this cache already holds, sent on every (re)subscribe so the
 * server replies with only newer or newly settled rows.
 */
export function resumePayloadFromCache(cache: HistoryRows | undefined): ConversationResume | undefined {
  const transcript = cache?.history?.transcript;
  if (!cache || !transcript) return undefined;
  let afterSequence = Number.NEGATIVE_INFINITY;
  for (const message of cache.messages) {
    if (typeof message.sequence === 'number') afterSequence = Math.max(afterSequence, message.sequence);
  }
  for (const entry of cache.workLog) {
    if (typeof entry.sequence === 'number') afterSequence = Math.max(afterSequence, entry.sequence);
  }
  if (!Number.isFinite(afterSequence)) return undefined;

  const open: Array<{ key: TimelineKey; id: string }> = [];
  for (const message of cache.messages) {
    if (isOpenMessage(message)) open.push({ key: timelineKeyOfMessage(message), id: message.id });
  }
  for (const entry of cache.workLog) {
    if (isOpenWork(entry)) open.push({ key: timelineKeyOfWork(entry), id: entry.id });
  }
  open.sort((a, b) => compareTimelineKeys(b.key, a.key));
  return { afterSequence, openIds: open.slice(0, RESUME_OPEN_IDS_MAX).map((item) => item.id), transcript };
}
