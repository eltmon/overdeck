/**
 * Unit tests for the public SSE event stream route helpers.
 */
import { describe, it, expect } from 'vitest';
import { formatFrame } from '../events.js';
import type { StoredEvent } from '../../event-store.js';

function makeEvent(sequence: number): StoredEvent {
  return {
    type: 'agent.output_received',
    sequence,
    timestamp: '2026-06-16T20:00:00.000Z',
    payload: { agentId: 'agent-pan-1925', lines: ['line one'] },
  };
}

describe('formatFrame', () => {
  it('omits the SSE id: line for in-memory-only events (sequence < 0)', () => {
    const frame = formatFrame(makeEvent(-1));
    expect(frame).not.toContain('id: -1');
    expect(frame).not.toMatch(/^id:/m);
    expect(frame).toContain('event: agent.output_received');
    expect(frame).toContain('"sequence":-1');
  });

  it('includes the SSE id: line for persisted events (sequence >= 0)', () => {
    const frame = formatFrame(makeEvent(1));
    expect(frame).toContain('id: 1');
    expect(frame).toContain('event: agent.output_received');
    expect(frame).toContain('"sequence":1');
  });

  it('includes id: for sequence 0 boundary', () => {
    const frame = formatFrame(makeEvent(0));
    expect(frame).toContain('id: 0');
  });
});
