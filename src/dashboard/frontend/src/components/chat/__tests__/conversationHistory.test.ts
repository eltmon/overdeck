import { encodeTimelineCursor, timelineKeyOfMessage, timelineKeyOfWork } from '@overdeck/contracts';
import { describe, expect, it } from 'vitest';
import type { ChatMessage, ConversationWindow, WorkLogEntry } from '../chat-types';
import { mergeWindowIntoCache, prependOlderPage, resumePayloadFromCache, type HistoryRows } from '../conversationHistory';

function at(i: number): string {
  return new Date(Date.UTC(2026, 9, 19) + i * 1000).toISOString();
}

function message(i: number, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id: `m${i}`, role: 'user', text: `message ${i}`, createdAt: at(i), sequence: i, ...overrides };
}

function tool(i: number, overrides: Partial<WorkLogEntry> = {}): WorkLogEntry {
  return { id: `t${i}`, label: 'Bash', tone: 'tool', createdAt: at(i), result: 'ok', sequence: i, ...overrides };
}

/** Rows i in [from, to): even i are messages, odd i are tools. */
function rows(from: number, to: number): Pick<HistoryRows, 'messages' | 'workLog'> {
  const messages: ChatMessage[] = [];
  const workLog: WorkLogEntry[] = [];
  for (let i = from; i < to; i++) {
    if (i % 2 === 0) messages.push(message(i));
    else workLog.push(tool(i));
  }
  return { messages, workLog };
}

function cursorAt(i: number): string {
  return encodeTimelineCursor(i % 2 === 0 ? timelineKeyOfMessage(message(i)) : timelineKeyOfWork(tool(i)));
}

function window(i: number, hasOlder = true, transcript = '1:2'): ConversationWindow {
  return { cursor: cursorAt(i), hasOlder, transcript };
}

function ids(cache: Pick<HistoryRows, 'messages' | 'workLog'>): string[] {
  return [...cache.messages.map((m) => m.id), ...cache.workLog.map((w) => w.id)].sort();
}

function idsBetween(from: number, to: number): string[] {
  return ids(rows(from, to));
}

describe('mergeWindowIntoCache (PAN-4558)', () => {
  it('keeps paged-in older rows when a new window overlaps the cache', () => {
    // Cache holds rows 100..300 (window from 225 plus paged-in 100..224).
    const previous: HistoryRows = { ...rows(100, 300), history: window(100) };
    const incoming = { ...rows(226, 302), window: window(226) };
    const merged = mergeWindowIntoCache(previous, incoming);
    expect(ids(merged)).toEqual(idsBetween(100, 302));
    expect(merged.history).toEqual(window(100));
  });

  it('takes the incoming copy of a row that changed inside the window', () => {
    const previous: HistoryRows = { ...rows(0, 10), history: window(0, true) };
    const incoming = { messages: [], workLog: [tool(9, { result: 'changed' })], window: window(9) };
    const merged = mergeWindowIntoCache(previous, incoming);
    expect(merged.workLog.find((w) => w.id === 't9')!.result).toBe('changed');
    expect(ids(merged)).toEqual(idsBetween(0, 10));
  });

  it('keeps cached rows newer than the response (a stream delta that raced the read)', () => {
    const previous: HistoryRows = { ...rows(100, 305), history: window(100) };
    const incoming = { ...rows(225, 300), window: window(225) };
    expect(ids(mergeWindowIntoCache(previous, incoming))).toEqual(idsBetween(100, 305));
  });

  it('replaces the cache when the window starts after the newest cached row (a gap)', () => {
    const previous: HistoryRows = { ...rows(0, 50), history: window(0, false) };
    const incoming = { ...rows(200, 275), window: window(200) };
    expect(mergeWindowIntoCache(previous, incoming)).toEqual({ messages: incoming.messages, workLog: incoming.workLog, history: incoming.window });
  });

  it('replaces the cache on a reset', () => {
    const previous: HistoryRows = { ...rows(0, 100), history: window(0, false) };
    const incoming = { ...rows(50, 60), window: window(50), reset: true };
    expect(ids(mergeWindowIntoCache(previous, incoming))).toEqual(idsBetween(50, 60));
  });

  it('replaces the cache for a legacy full body without a window', () => {
    const previous: HistoryRows = { ...rows(0, 100), history: window(0, false) };
    const merged = mergeWindowIntoCache(previous, rows(0, 5));
    expect(ids(merged)).toEqual(idsBetween(0, 5));
    expect(merged.history).toBeUndefined();
  });

  it('replaces the cache when the transcript changed', () => {
    const previous: HistoryRows = { ...rows(0, 100), history: window(0, false, '1:2') };
    const incoming = { ...rows(50, 101), window: window(50, true, '9:9') };
    expect(ids(mergeWindowIntoCache(previous, incoming))).toEqual(idsBetween(50, 101));
  });

  it('replaces the cache when the window reaches the first row', () => {
    const previous: HistoryRows = { ...rows(0, 100), history: window(0, false) };
    const incoming = { ...rows(50, 101), window: window(50, false) };
    expect(ids(mergeWindowIntoCache(previous, incoming))).toEqual(idsBetween(50, 101));
  });

  it('keeps the cache for an empty window that is not a reset', () => {
    const previous: HistoryRows = { ...rows(0, 10), history: window(0, false) };
    const merged = mergeWindowIntoCache(previous, { messages: [], workLog: [], window: { cursor: null, hasOlder: false, transcript: '1:2' } });
    expect(ids(merged)).toEqual(idsBetween(0, 10));
  });

  it('treats a legacy full cache as the whole history', () => {
    const previous: HistoryRows = rows(0, 300);
    const merged = mergeWindowIntoCache(previous, { ...rows(225, 301), window: window(225) });
    expect(ids(merged)).toEqual(idsBetween(0, 301));
    expect(merged.history).toEqual({ cursor: cursorAt(0), hasOlder: false, transcript: '1:2' });
  });

  it('keeps arrays in timeline order when a pinned older row arrives with the window', () => {
    const previous: HistoryRows = { ...rows(100, 300), history: window(100) };
    const incoming = { messages: rows(226, 300).messages, workLog: [tool(101, { result: undefined }), ...rows(226, 300).workLog], window: window(226) };
    const merged = mergeWindowIntoCache(previous, incoming);
    expect(merged.workLog.filter((w) => w.id === 't101')).toHaveLength(1);
    expect(merged.workLog.map((w) => w.sequence)).toEqual([...merged.workLog.map((w) => w.sequence!)].sort((a, b) => a - b));
  });
});

describe('prependOlderPage (PAN-4558)', () => {
  it('prepends the page and advances the cursor', () => {
    const previous = { ...rows(150, 300), history: window(150), streaming: false };
    const next = prependOlderPage(previous, { ...rows(75, 150), window: window(75) }, cursorAt(150));
    expect(ids(next)).toEqual(idsBetween(75, 300));
    expect(next.history).toEqual(window(75));
    expect(next.streaming).toBe(false);
  });

  it('ignores a stale page fetched for another cursor', () => {
    const previous = { ...rows(150, 300), history: window(150) };
    expect(prependOlderPage(previous, { ...rows(75, 150), window: window(75) }, cursorAt(200))).toBe(previous);
  });

  it('does not duplicate a pinned row already in the cache', () => {
    const previous = { messages: rows(150, 300).messages, workLog: [tool(101, { result: undefined }), ...rows(150, 300).workLog], history: window(150) };
    const next = prependOlderPage(previous, { ...rows(75, 150), window: window(75) }, cursorAt(150));
    expect(next.workLog.filter((w) => w.id === 't101')).toHaveLength(1);
    expect(next.history?.hasOlder).toBe(true);
  });

  it('records the start of the conversation', () => {
    const previous = { ...rows(75, 300), history: window(75) };
    const next = prependOlderPage(previous, { ...rows(0, 75), window: window(0, false) }, cursorAt(75));
    expect(next.history).toEqual(window(0, false));
    expect(ids(next)).toEqual(idsBetween(0, 300));
  });
});

describe('resumePayloadFromCache (PAN-4558)', () => {
  it('lists the newest sequence and open tool and assistant ids', () => {
    const cache: HistoryRows = {
      messages: [message(0), message(2, { role: 'assistant', completedAt: at(2) }), message(4, { role: 'assistant' })],
      workLog: [tool(1), tool(3, { result: undefined }), tool(5, { result: undefined, resultBytes: 9000 })],
      history: window(0, false),
    };
    expect(resumePayloadFromCache(cache)).toEqual({ afterSequence: 5, openIds: ['m4', 't3'], transcript: '1:2' });
  });

  it('is undefined without a transcript id, rows, or sequences', () => {
    expect(resumePayloadFromCache(undefined)).toBeUndefined();
    expect(resumePayloadFromCache(rows(0, 4))).toBeUndefined();
    expect(resumePayloadFromCache({ messages: [], workLog: [], history: window(0) })).toBeUndefined();
    expect(resumePayloadFromCache({ messages: [message(0, { sequence: undefined })], workLog: [], history: window(0) })).toBeUndefined();
  });

  it('caps open ids at 200, newest first', () => {
    const workLog = Array.from({ length: 250 }, (_, i) => tool(2 * i + 1, { result: undefined }));
    const resume = resumePayloadFromCache({ messages: [], workLog, history: window(1) })!;
    expect(resume.openIds).toHaveLength(200);
    expect(resume.openIds[0]).toBe('t499');
  });
});
