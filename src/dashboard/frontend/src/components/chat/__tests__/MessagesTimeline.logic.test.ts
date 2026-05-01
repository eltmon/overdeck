import { describe, it, expect } from 'vitest';
import {
  deriveTimelineEntries,
  deriveMessagesTimelineRows,
  estimateMessagesTimelineRowHeight,
  computeMessageDurationStart,
} from '../MessagesTimeline.logic';
import type { ChatMessage, WorkLogEntry } from '../chat-types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function msg(overrides: Partial<ChatMessage> & { id: string; createdAt: string }): ChatMessage {
  return {
    role: 'user',
    text: 'hello',
    ...overrides,
  };
}

function work(overrides: Partial<WorkLogEntry> & { id: string; createdAt: string }): WorkLogEntry {
  return {
    label: 'Bash',
    tone: 'tool',
    ...overrides,
  };
}

// ─── computeMessageDurationStart ──────────────────────────────────────────────

describe('computeMessageDurationStart', () => {
  it('sets duration start to the preceding user message timestamp', () => {
    const messages: ChatMessage[] = [
      msg({ id: 'u1', role: 'user', createdAt: '2024-01-01T00:00:00Z', text: 'hi' }),
      msg({ id: 'a1', role: 'assistant', createdAt: '2024-01-01T00:00:05Z', text: 'ok' }),
    ];
    const map = computeMessageDurationStart(messages);
    expect(map.get('a1')).toBe('2024-01-01T00:00:00Z');
  });

  it('falls back to message.createdAt when no user message precedes it', () => {
    const messages: ChatMessage[] = [
      msg({ id: 'a1', role: 'assistant', createdAt: '2024-01-01T00:00:05Z', text: 'ok' }),
    ];
    const map = computeMessageDurationStart(messages);
    expect(map.get('a1')).toBe('2024-01-01T00:00:05Z');
  });

  it('uses the most recent user message for multiple assistant responses', () => {
    const messages: ChatMessage[] = [
      msg({ id: 'u1', role: 'user', createdAt: '2024-01-01T00:00:00Z', text: 'first' }),
      msg({ id: 'a1', role: 'assistant', createdAt: '2024-01-01T00:00:02Z', text: 'resp 1' }),
      msg({ id: 'u2', role: 'user', createdAt: '2024-01-01T00:00:10Z', text: 'second' }),
      msg({ id: 'a2', role: 'assistant', createdAt: '2024-01-01T00:00:15Z', text: 'resp 2' }),
    ];
    const map = computeMessageDurationStart(messages);
    expect(map.get('a1')).toBe('2024-01-01T00:00:00Z');
    expect(map.get('a2')).toBe('2024-01-01T00:00:10Z');
  });

  it('advances boundary after a completed assistant message', () => {
    const messages: ChatMessage[] = [
      msg({ id: 'u1', role: 'user', createdAt: '2024-01-01T00:00:00Z', text: 'hi' }),
      msg({
        id: 'a1',
        role: 'assistant',
        createdAt: '2024-01-01T00:00:02Z',
        completedAt: '2024-01-01T00:00:05Z',
        text: 'ok',
      }),
      msg({ id: 'a2', role: 'assistant', createdAt: '2024-01-01T00:00:06Z', text: 'more' }),
    ];
    const map = computeMessageDurationStart(messages);
    expect(map.get('a2')).toBe('2024-01-01T00:00:05Z');
  });
});

// ─── deriveTimelineEntries ────────────────────────────────────────────────────

describe('deriveTimelineEntries', () => {
  it('returns an empty array when both inputs are empty', () => {
    expect(deriveTimelineEntries([], [])).toEqual([]);
  });

  it('converts messages to timeline entries with kind "message"', () => {
    const messages = [msg({ id: 'm1', createdAt: '2024-01-01T00:00:00Z' })];
    const entries = deriveTimelineEntries(messages, []);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: 'm1', kind: 'message' });
  });

  it('converts work log entries to timeline entries with kind "work"', () => {
    const workLog = [work({ id: 'w1', createdAt: '2024-01-01T00:00:00Z' })];
    const entries = deriveTimelineEntries([], workLog);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: 'w1', kind: 'work' });
  });

  it('sorts entries by createdAt ascending', () => {
    const messages = [
      msg({ id: 'm-late', createdAt: '2024-01-01T00:00:02Z' }),
      msg({ id: 'm-early', createdAt: '2024-01-01T00:00:00Z' }),
    ];
    const workLog = [work({ id: 'w-mid', createdAt: '2024-01-01T00:00:01Z' })];

    const entries = deriveTimelineEntries(messages, workLog);

    expect(entries.map((e) => e.id)).toEqual(['m-early', 'w-mid', 'm-late']);
  });

  it('interleaves messages and work log entries by timestamp', () => {
    const messages = [msg({ id: 'm1', createdAt: '2024-01-01T00:00:00Z' })];
    const workLog = [
      work({ id: 'w1', createdAt: '2024-01-01T00:00:01Z' }),
      work({ id: 'w2', createdAt: '2024-01-01T00:00:02Z' }),
    ];

    const entries = deriveTimelineEntries(messages, workLog);

    expect(entries.map((e) => e.id)).toEqual(['m1', 'w1', 'w2']);
  });

  it('preserves original message data in entries', () => {
    const m = msg({ id: 'm1', createdAt: '2024-01-01T00:00:00Z', role: 'assistant', text: 'hi' });
    const [entry] = deriveTimelineEntries([m], []);

    expect((entry as { message: ChatMessage }).message).toEqual(m);
  });

  it('interleaves assistant text and tools with same timestamp (stable sort)', () => {
    // Simulates one assistant turn at T2 that produced both text and a tool_use.
    // Messages are spread before workLog, so stable sort preserves message first.
    const messages = [
      msg({ id: 'u1', role: 'user', createdAt: '2024-01-01T00:00:00Z', text: 'do it' }),
      msg({ id: 'a1', role: 'assistant', createdAt: '2024-01-01T00:00:02Z', text: 'Let me check...' }),
    ];
    const workLog = [
      work({ id: 't1', createdAt: '2024-01-01T00:00:02Z', label: 'Bash' }),
    ];

    const entries = deriveTimelineEntries(messages, workLog);
    expect(entries.map((e) => e.id)).toEqual(['u1', 'a1', 't1']);
  });
});

// ─── deriveMessagesTimelineRows ───────────────────────────────────────────────

describe('deriveMessagesTimelineRows', () => {
  it('returns empty rows for empty timeline', () => {
    expect(deriveMessagesTimelineRows([], false)).toEqual([]);
  });

  it('appends a "working" row when isWorking is true', () => {
    const rows = deriveMessagesTimelineRows([], true);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'working', id: 'working-indicator', createdAt: null });
  });

  it('sets working row createdAt to last entry timestamp', () => {
    const entries = deriveTimelineEntries(
      [msg({ id: 'm1', createdAt: '2024-01-01T00:01:00Z' })],
      [],
    );
    const rows = deriveMessagesTimelineRows(entries, true);

    const workingRow = rows.find((r) => r.kind === 'working')!;
    expect(workingRow.createdAt).toBe('2024-01-01T00:01:00Z');
  });

  it('renders a message entry as a "message" row with durationStart', () => {
    const m = msg({ id: 'm1', createdAt: '2024-01-01T00:00:00Z', role: 'user', text: 'hi' });
    const entries = deriveTimelineEntries([m], []);
    const rows = deriveMessagesTimelineRows(entries, false);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'message', id: 'm1' });
    expect((rows[0] as { durationStart: string }).durationStart).toBe('2024-01-01T00:00:00Z');
  });

  it('groups consecutive work entries into a single "work" row', () => {
    const workLog = [
      work({ id: 'w1', createdAt: '2024-01-01T00:00:00Z' }),
      work({ id: 'w2', createdAt: '2024-01-01T00:00:01Z' }),
      work({ id: 'w3', createdAt: '2024-01-01T00:00:02Z' }),
    ];
    const entries = deriveTimelineEntries([], workLog);
    const rows = deriveMessagesTimelineRows(entries, false);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'work' });
    expect((rows[0] as { groupedEntries: WorkLogEntry[] }).groupedEntries).toHaveLength(3);
  });

  it('does not group work entries separated by a message', () => {
    const entries = deriveTimelineEntries(
      [msg({ id: 'm1', createdAt: '2024-01-01T00:00:01Z' })],
      [
        work({ id: 'w1', createdAt: '2024-01-01T00:00:00Z' }),
        work({ id: 'w2', createdAt: '2024-01-01T00:00:02Z' }),
      ],
    );
    const rows = deriveMessagesTimelineRows(entries, false);

    // Should be: [work(w1)], [message(m1)], [work(w2)]
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ kind: 'work' });
    expect(rows[1]).toMatchObject({ kind: 'message' });
    expect(rows[2]).toMatchObject({ kind: 'work' });
  });

  it('does NOT append working row when isWorking is false', () => {
    const entries = deriveTimelineEntries([msg({ id: 'm1', createdAt: '2024-01-01T00:00:00Z' })], []);
    const rows = deriveMessagesTimelineRows(entries, false);

    expect(rows.some((r) => r.kind === 'working')).toBe(false);
  });
});

// ─── estimateMessagesTimelineRowHeight ────────────────────────────────────────

describe('estimateMessagesTimelineRowHeight', () => {
  it('returns 40 for a working row', () => {
    const row = { kind: 'working' as const, id: 'working-indicator', createdAt: null };
    expect(estimateMessagesTimelineRowHeight(row)).toBe(40);
  });

  it('returns a fixed base height for a single work entry row', () => {
    const row = {
      kind: 'work' as const,
      id: 'w1',
      createdAt: '2024-01-01T00:00:00Z',
      groupedEntries: [work({ id: 'w1', createdAt: '2024-01-01T00:00:00Z' })],
    };
    // 28 + 1 * 32 = 60
    expect(estimateMessagesTimelineRowHeight(row)).toBe(60);
  });

  it('caps work row height at MAX_VISIBLE_WORK_LOG_ENTRIES (6)', () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      work({ id: `w${i}`, createdAt: '2024-01-01T00:00:00Z' }),
    );
    const row = { kind: 'work' as const, id: 'w0', createdAt: '2024-01-01T00:00:00Z', groupedEntries: entries };
    // max 6 visible: 28 + 6 * 32 = 220
    expect(estimateMessagesTimelineRowHeight(row)).toBe(220);
  });

  it('returns a positive height for a user message row', () => {
    const row = {
      kind: 'message' as const,
      id: 'm1',
      createdAt: '2024-01-01T00:00:00Z',
      message: msg({ id: 'm1', createdAt: '2024-01-01T00:00:00Z', role: 'user', text: 'Hello!' }),
      durationStart: '2024-01-01T00:00:00Z',
    };
    expect(estimateMessagesTimelineRowHeight(row)).toBeGreaterThan(0);
  });
});
