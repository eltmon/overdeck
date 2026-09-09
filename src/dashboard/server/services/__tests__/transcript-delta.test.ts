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
    expect(delta(initial)).toMatchObject({ snapshot: true, messages: initial.messages, workLog: initial.workLog });
    const completed = result({ workLog: [{ ...initial.workLog[0], result: 'x'.repeat(100_000), tone: 'error' }] });
    expect(delta(completed)).toMatchObject({ snapshot: false, messages: [], workLog: completed.workLog });
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
