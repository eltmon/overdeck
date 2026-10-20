import { describe, expect, it } from 'vitest';
import { createTranscriptDelta } from '../transcript-delta.js';
import type { ParseResult } from '../conversation/types.js';

function result(overrides: Partial<ParseResult> = {}): ParseResult {
  return {
    messages: [{ id: 'user', role: 'user', text: 'Keep all history', createdAt: '2026-09-09' }],
    workLog: [{ id: 'tool', label: 'Shell', tone: 'tool', createdAt: '2026-09-09', command: 'pwd' }],
    streaming: false, totalCost: 1, totalTokens: 12, byteOffset: 100, mtimeMs: 1,
    latestAssistantUsage: null, contextBoundaryOffset: 0, contextActiveBytes: 100,
    pendingToolUse: new Map(), unresolvedResults: new Map(), lastSequence: 2,
    ...overrides,
  };
}

describe('transcript deltas', () => {
  it('sends all history initially, updates a tool in place, and omits unchanged large results', () => {
    const delta = createTranscriptDelta(null);
    const initial = result();
    expect(delta(initial)).toMatchObject({ snapshot: true, messages: initial.messages, workLog: initial.workLog,
      window: { cursor: expect.any(String), hasOlder: false } });
    const completed = result({ workLog: [{ ...initial.workLog[0], result: 'x'.repeat(100_000), tone: 'error' }] });
    // PAN-4558: the 100 KB result leaves the wire; its size stays as a hint.
    const completedEvent = delta(completed)!;
    expect(completedEvent).toMatchObject({ snapshot: false, messages: [],
      workLog: [{ id: 'tool', tone: 'error', resultBytes: 100_000, bodyOmitted: true }] });
    expect(completedEvent.workLog[0]!.result).toBeUndefined();
    const next = result({ ...completed, messages: [...completed.messages,
      { id: 'assistant', role: 'assistant', text: 'Done', createdAt: '2026-09-09' }] });
    const event = delta(next)!;
    expect(event).toMatchObject({ snapshot: false, messages: [next.messages[1]], workLog: [] });
    expect(JSON.stringify(event).length).toBeLessThan(1000);
    expect(delta(structuredClone(next))).toBeNull();
  });

  it('emits metadata-only changes and explicitly clears plans, compacts and context', () => {
    const delta = createTranscriptDelta(null);
    const initial = result({ proposedPlan: { id: 'plan', plan: 'Build it', status: 'pending', createdAt: '2026-09-09' },
      compactBoundaries: [{ id: 'compact', timestamp: '2026-09-09', trigger: 'auto' }] });
    delta(initial);
    const event = delta(result({ totalCost: 2, streaming: true, compactBoundaries: [] }))!;
    expect(event).toMatchObject({ messages: [], workLog: [], snapshot: false, metadataSnapshot: true,
      totalCost: 2, streaming: true, contextUsage: null, compactBoundaries: [] });
    expect(event.proposedPlan).toBeUndefined();
  });

  it('uses full snapshots for removals/reordering and marks confirmed rewrites as resets', () => {
    const delta = createTranscriptDelta(null);
    delta(result());
    expect(delta(result({ messages: [], workLog: [] }), true)).toMatchObject({ snapshot: true, reset: true, messages: [], workLog: [] });
    delta(result());
    const inserted = result({ messages: [{ id: 'older', role: 'user', text: 'Earlier', createdAt: '2026-09-08' }, ...result().messages] });
    expect(delta(inserted)).toMatchObject({ snapshot: true, messages: inserted.messages });
  });
});

function at(i: number): string {
  return new Date(Date.UTC(2026, 9, 19) + i * 1000).toISOString();
}

/** n rows alternating message and tool, each its own timeline row. */
function rows(n: number, withSequence = true): Pick<ParseResult, 'messages' | 'workLog'> {
  const messages: ParseResult['messages'] = [];
  const workLog: ParseResult['workLog'] = [];
  for (let i = 0; i < n; i++) {
    const sequence = withSequence ? { sequence: i } : {};
    if (i % 2 === 0) messages.push({ id: `m${i}`, role: 'user', text: `message ${i}`, createdAt: at(i), ...sequence });
    else workLog.push({ id: `t${i}`, label: 'Shell', tone: 'tool', createdAt: at(i), result: 'ok', ...sequence });
  }
  return { messages, workLog };
}

describe('windowed transcript deltas (PAN-4558)', () => {
  it('bounds the first event of a 400-row transcript', () => {
    const event = createTranscriptDelta(null)(result(rows(400)), false, '1:2')!;
    expect(event.snapshot).toBe(true);
    expect(event.messages.length + event.workLog.length).toBe(75);
    expect(event.window).toMatchObject({ hasOlder: true, transcript: '1:2' });
    expect(event.reset).toBeUndefined();
  });

  it('keeps diffing against the full rows after a windowed first event', () => {
    const delta = createTranscriptDelta(null);
    const initial = rows(400);
    delta(result(initial), false, '1:2');
    const appended = { ...initial, messages: [...initial.messages, { id: 'm400', role: 'user' as const, text: 'new', createdAt: at(400), sequence: 400 }] };
    expect(delta(result(appended), false, '1:2')).toMatchObject({ snapshot: false, messages: [{ id: 'm400' }], workLog: [] });
  });

  it('sends a windowed reset snapshot when rows are reordered', () => {
    const delta = createTranscriptDelta(null);
    const initial = rows(400);
    delta(result(initial), false, '1:2');
    const reordered = { ...initial, messages: [{ id: 'early', role: 'user' as const, text: 'x', createdAt: at(-1), sequence: -1 }, ...initial.messages] };
    const event = delta(result(reordered), false, '1:2')!;
    expect(event).toMatchObject({ snapshot: true, reset: true, window: { hasOlder: true } });
    expect(event.messages.length + event.workLog.length).toBe(75);
  });

  it('resumes with only the new row when the transcript matches', () => {
    const event = createTranscriptDelta(null, { afterSequence: 398, openIds: [], transcript: '1:2' })(result(rows(400)), false, '1:2')!;
    expect(event).toMatchObject({ snapshot: false, metadataSnapshot: true, messages: [], workLog: [{ id: 't399' }] });
    expect(event.window).toBeUndefined();
  });

  it('falls back to a windowed reset when rows carry no sequence (prime-agent)', () => {
    const event = createTranscriptDelta(null, { afterSequence: 10, openIds: [], transcript: '1:2' })(result(rows(400, false)), false, '1:2')!;
    expect(event).toMatchObject({ snapshot: true, reset: true });
    expect(event.messages.length + event.workLog.length).toBe(75);
  });

  it('does not mark an empty resume fallback as a reset', () => {
    const event = createTranscriptDelta(null, { afterSequence: 10, openIds: [], transcript: '1:2' })(result({ messages: [], workLog: [] }), false, '1:2')!;
    expect(event).toMatchObject({ snapshot: true, messages: [], workLog: [] });
    expect(event.reset).toBeUndefined();
  });
});
