import {
  decodeTimelineCursor,
  encodeTimelineCursor,
  timelineKeyOfMessage,
  timelineKeyOfWork,
  type ChatMessage,
  type WorkLogEntry,
} from '@overdeck/contracts';
import { describe, expect, it } from 'vitest';

import {
  readPageParams,
  selectInitialWindow,
  selectPageBefore,
  selectResumeDelta,
  transcriptIdOf,
  type WindowInput,
} from '../window.js';

function at(i: number): string {
  return new Date(Date.UTC(2026, 9, 19) + i * 1000).toISOString();
}

function message(i: number, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id: `m${i}`, role: i % 2 === 0 ? 'user' : 'assistant', text: `message ${i}`, createdAt: at(i), sequence: i, completedAt: at(i), ...overrides };
}

function tool(i: number, overrides: Partial<WorkLogEntry> = {}): WorkLogEntry {
  return { id: `t${i}`, createdAt: at(i), label: 'Bash', tone: 'tool', result: 'ok', sequence: i, ...overrides };
}

/** n entries alternating message, tool, message, tool... so every entry is its own row. */
function alternating(n: number): WindowInput {
  const messages: ChatMessage[] = [];
  const workLog: WorkLogEntry[] = [];
  for (let i = 0; i < n; i++) {
    if (i % 2 === 0) messages.push(message(i));
    else workLog.push(tool(i));
  }
  return { messages, workLog };
}

function ids(rows: { messages: readonly { id: string }[]; workLog: readonly { id: string }[] }): string[] {
  return [...rows.messages.map((m) => m.id), ...rows.workLog.map((w) => w.id)];
}

/** Walks window + every older page to the start; returns all ids in fetch order. */
function pageToStart(input: WindowInput, limit = 75): { ids: string[]; pages: number } {
  const first = selectInitialWindow(input);
  const all = ids(first);
  let window = first.window;
  let pages = 0;
  while (window.hasOlder) {
    const before = decodeTimelineCursor(window.cursor!);
    expect(before).not.toBeNull();
    const page = selectPageBefore(input, before!, limit);
    all.push(...ids(page));
    window = page.window;
    pages++;
    expect(pages).toBeLessThan(1000);
  }
  return { ids: all, pages };
}

describe('transcriptIdOf', () => {
  it('formats dev and inode', () => {
    expect(transcriptIdOf({ dev: 2049, ino: 123 })).toBe('2049:123');
  });
});

describe('readPageParams', () => {
  const cursor = encodeURIComponent(encodeTimelineCursor([at(1), 1, 0, 'm1']));

  it('returns null without a before cursor', () => {
    expect(readPageParams(new URLSearchParams('limit=10'))).toBeNull();
  });

  it('rejects a malformed cursor', () => {
    expect(readPageParams(new URLSearchParams('before=x'))).toBe('invalid-cursor');
  });

  it('defaults the limit to 75 and clamps it to [1, 200]', () => {
    expect(readPageParams(new URLSearchParams(`before=${cursor}`))).toEqual({ before: [at(1), 1, 0, 'm1'], limit: 75 });
    expect(readPageParams(new URLSearchParams(`before=${cursor}&limit=abc`))).toMatchObject({ limit: 75 });
    expect(readPageParams(new URLSearchParams(`before=${cursor}&limit=0`))).toMatchObject({ limit: 1 });
    expect(readPageParams(new URLSearchParams(`before=${cursor}&limit=5000`))).toMatchObject({ limit: 200 });
    expect(readPageParams(new URLSearchParams(`before=${cursor}&limit=40`))).toMatchObject({ limit: 40 });
  });
});

describe('selectInitialWindow (PAN-4558)', () => {
  it('takes the newest 75 rows from 300 alternating entries', () => {
    const input = alternating(300);
    const result = selectInitialWindow(input, '1:2');
    expect(result.messages.length + result.workLog.length).toBe(75);
    expect(result.window.hasOlder).toBe(true);
    expect(result.window.transcript).toBe('1:2');
    // Oldest taken entry is index 225 (300 - 75), a tool entry.
    expect(result.window.cursor).toBe(encodeTimelineCursor(timelineKeyOfWork(tool(225))));
    expect(result.messages.every((m) => m.sequence! >= 225)).toBe(true);
  });

  it('counts a run of consecutive work entries as one row', () => {
    const messages = [message(0), message(10)];
    const workLog = Array.from({ length: 8 }, (_, k) => tool(k + 1));
    const result = selectInitialWindow({ messages, workLog }, undefined, { maxRows: 2, maxBytes: Number.POSITIVE_INFINITY });
    expect(ids(result).sort()).toEqual(['m10', ...workLog.map((w) => w.id)].sort());
    expect(result.window.hasOlder).toBe(true);
    expect(result.window.cursor).toBe(encodeTimelineCursor(timelineKeyOfWork(tool(1))));
  });

  it('returns entries sorted ascending in each array', () => {
    const input = alternating(20);
    const result = selectInitialWindow({ messages: [...input.messages].reverse(), workLog: [...input.workLog].reverse() });
    expect(result.messages.map((m) => m.sequence)).toEqual(input.messages.map((m) => m.sequence));
    expect(result.workLog.map((w) => w.sequence)).toEqual(input.workLog.map((w) => w.sequence));
  });

  it('stops early at the byte cap with 200 KB messages', () => {
    const messages = Array.from({ length: 20 }, (_, i) => message(i, { text: 'x'.repeat(200 * 1024) }));
    const result = selectInitialWindow({ messages, workLog: [] });
    // 960 KiB holds four 200 KiB messages plus JSON overhead, not five.
    expect(result.messages).toHaveLength(4);
    expect(result.messages.map((m) => m.id)).toEqual(['m16', 'm17', 'm18', 'm19']);
    expect(result.window.hasOlder).toBe(true);
  });

  it('always sends a single newest message larger than the budget', () => {
    const messages = [message(0), message(1, { text: 'y'.repeat(2 * 1024 * 1024) })];
    const result = selectInitialWindow({ messages, workLog: [] });
    expect(result.messages.map((m) => m.id)).toEqual(['m1']);
    expect(result.window.hasOlder).toBe(true);
  });

  it('measures and returns projected tool entries', () => {
    const workLog = [tool(1, { result: 'z'.repeat(50_000) })];
    const result = selectInitialWindow({ messages: [], workLog });
    expect(result.workLog[0]!.result).toBeUndefined();
    expect(result.workLog[0]!.resultBytes).toBe(50_000);
    expect(workLog[0]!.result).toHaveLength(50_000);
  });

  it('returns a null cursor and no older history for an empty transcript', () => {
    const result = selectInitialWindow({ messages: [], workLog: [] }, '1:2');
    expect(result).toEqual({ messages: [], workLog: [], window: { cursor: null, hasOlder: false, transcript: '1:2' } });
  });

  it('reports no older history when everything fits', () => {
    const result = selectInitialWindow(alternating(10));
    expect(result.window.hasOlder).toBe(false);
    expect(result.window.cursor).toBe(encodeTimelineCursor(timelineKeyOfMessage(message(0))));
  });

  it('pins an open tool call older than the window without moving the cursor', () => {
    const input = alternating(300);
    const openTool = tool(1, { result: undefined });
    const workLog = input.workLog.map((w) => (w.id === 't1' ? openTool : w));
    const result = selectInitialWindow({ messages: input.messages, workLog });
    expect(result.workLog.some((w) => w.id === 't1')).toBe(true);
    expect(result.workLog[0]!.id).toBe('t1');
    expect(result.window.cursor).toBe(encodeTimelineCursor(timelineKeyOfWork(tool(225))));
  });

  it('pins at most 10 open tool calls, the newest ones', () => {
    const input = alternating(300);
    const workLog = input.workLog.map((w) => (w.sequence! < 100 ? { ...w, result: undefined } : w));
    const result = selectInitialWindow({ messages: input.messages, workLog });
    const pinned = result.workLog.filter((w) => w.sequence! < 225);
    expect(pinned.map((w) => w.id)).toEqual(['t81', 't83', 't85', 't87', 't89', 't91', 't93', 't95', 't97', 't99']);
  });

  it('does not pin a tool whose result was elided', () => {
    const input = alternating(300);
    const workLog = input.workLog.map((w) => (w.id === 't1' ? { ...w, result: undefined, resultBytes: 9000 } : w));
    const result = selectInitialWindow({ messages: input.messages, workLog });
    expect(result.workLog.some((w) => w.id === 't1')).toBe(false);
  });
});

describe('selectPageBefore (PAN-4558)', () => {
  it('returns the next older rows with no overlap', () => {
    const input = alternating(300);
    const first = selectInitialWindow(input);
    const page = selectPageBefore(input, decodeTimelineCursor(first.window.cursor!)!, 75);
    const firstIds = new Set(ids(first));
    expect(ids(page).some((id) => firstIds.has(id))).toBe(false);
    expect(page.messages.length + page.workLog.length).toBe(75);
    expect(page.window.cursor).toBe(encodeTimelineCursor(timelineKeyOfMessage(message(150))));
    expect(page.window.hasOlder).toBe(true);
  });

  it('pages to the start yielding every entry exactly once', () => {
    const input = alternating(400);
    const { ids: all } = pageToStart(input, 60);
    expect(all).toHaveLength(400);
    expect(new Set(all).size).toBe(400);
  });

  it('pages through ties on createdAt with missing sequences in key order', () => {
    const tie = at(5);
    const messages: ChatMessage[] = [];
    const workLog: WorkLogEntry[] = [];
    for (let i = 0; i < 100; i++) messages.push({ id: `tm${i}`, role: 'assistant', text: 'tie', createdAt: tie });
    for (let i = 0; i < 40; i++) workLog.push({ id: `tw${i}`, createdAt: tie, label: 'Read', tone: 'tool', result: 'ok' });
    messages.push(message(100));
    // Sorted: 100 tied messages (kindRank 0, by id), 40 tied work entries (one row), then m100.
    const { ids: all, pages } = pageToStart({ messages, workLog }, 7);
    expect(pages).toBeGreaterThan(1);
    expect(all).toHaveLength(141);
    expect(new Set(all).size).toBe(141);
  });

  it('pages without duplicating a pinned open tool', () => {
    const input = alternating(300);
    const workLog = input.workLog.map((w) => (w.id === 't1' ? { ...w, result: undefined } : w));
    const { ids: all } = pageToStart({ messages: input.messages, workLog });
    // t1 arrives pinned and again on the last page; the client dedupes by id.
    expect(all.filter((id) => id === 't1')).toHaveLength(2);
    expect(new Set(all).size).toBe(300);
  });

  it('returns nothing before the oldest entry', () => {
    const input = alternating(10);
    const page = selectPageBefore(input, timelineKeyOfMessage(message(0)), 75);
    expect(page).toEqual({ messages: [], workLog: [], window: { cursor: null, hasOlder: false } });
  });
});

describe('selectResumeDelta (PAN-4558)', () => {
  const input = alternating(20);

  it('returns entries newer than afterSequence plus the current copy of open entries', () => {
    const openTool = tool(5, { result: 'now settled' });
    const workLog = input.workLog.map((w) => (w.id === 't5' ? openTool : w));
    const delta = selectResumeDelta({ messages: input.messages, workLog }, { afterSequence: 17, openIds: ['t5'], transcript: '1:2' }, '1:2');
    expect(delta).not.toBeNull();
    expect(delta!.messages.map((m) => m.id)).toEqual(['m18']);
    expect(delta!.workLog.map((w) => w.id)).toEqual(['t5', 't19']);
    expect(delta!.workLog[0]!.result).toBe('now settled');
  });

  it('lists an open entry with a newer sequence once', () => {
    const delta = selectResumeDelta(input, { afterSequence: 17, openIds: ['t19', 'm18'], transcript: '1:2' }, '1:2');
    expect(ids(delta!)).toEqual(['m18', 't19']);
  });

  it('returns an empty delta when the client is current', () => {
    const delta = selectResumeDelta(input, { afterSequence: 19, openIds: ['missing'], transcript: '1:2' }, '1:2');
    expect(delta).toEqual({ messages: [], workLog: [] });
  });

  it('projects tool entries in the delta', () => {
    const workLog = [...input.workLog, tool(25, { result: 'q'.repeat(10_000) })];
    const delta = selectResumeDelta({ messages: input.messages, workLog }, { afterSequence: 19, openIds: [], transcript: '1:2' }, '1:2');
    expect(delta!.workLog[0]!.resultBytes).toBe(10_000);
    expect(delta!.workLog[0]!.result).toBeUndefined();
  });

  it('returns null on a transcript mismatch or unknown transcript', () => {
    expect(selectResumeDelta(input, { afterSequence: 10, openIds: [], transcript: '1:2' }, '1:3')).toBeNull();
    expect(selectResumeDelta(input, { afterSequence: 10, openIds: [], transcript: '1:2' }, undefined)).toBeNull();
  });

  it('returns null when a row lacks a sequence', () => {
    const messages = input.messages.map((m, i) => (i === 0 ? { ...m, sequence: undefined } : m));
    expect(selectResumeDelta({ messages, workLog: input.workLog }, { afterSequence: 10, openIds: [], transcript: '1:2' }, '1:2')).toBeNull();
    const workLog = input.workLog.map((w, i) => (i === 0 ? { ...w, sequence: undefined } : w));
    expect(selectResumeDelta({ messages: input.messages, workLog }, { afterSequence: 10, openIds: [], transcript: '1:2' }, '1:2')).toBeNull();
  });

  it('returns null when afterSequence is past the newest row or not finite', () => {
    expect(selectResumeDelta(input, { afterSequence: 20, openIds: [], transcript: '1:2' }, '1:2')).toBeNull();
    expect(selectResumeDelta(input, { afterSequence: Number.NaN, openIds: [], transcript: '1:2' }, '1:2')).toBeNull();
  });

  it('returns null when the delta exceeds the byte budget', () => {
    const messages = [...input.messages, message(30, { text: 'x'.repeat(1024 * 1024) })];
    expect(selectResumeDelta({ messages, workLog: input.workLog }, { afterSequence: 19, openIds: [], transcript: '1:2' }, '1:2')).toBeNull();
  });

  it('ignores open ids past the cap', () => {
    const openIds = [...Array.from({ length: 200 }, (_, i) => `x${i}`), 't5'];
    const delta = selectResumeDelta(input, { afterSequence: 19, openIds, transcript: '1:2' }, '1:2');
    expect(delta).toEqual({ messages: [], workLog: [] });
  });
});
