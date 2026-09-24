/**
 * Events Tests - Verify event log management including deduplication (PAN-220)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  appendCostEvent,
  CostEvent,
  deduplicateEvents,
  getLastEventMetadata,
  readEventsFromByteOffset,
  readEventsFromLine,
  readEvents,
  tailEvents,
} from '../events.js';

let TEST_ROOT: string;
const originalHome = process.env.HOME;

beforeEach(() => {
  TEST_ROOT = join(tmpdir(), `overdeck-events-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(TEST_ROOT, '.overdeck', 'costs'), { recursive: true });
  process.env.HOME = TEST_ROOT;
});

afterEach(() => {
  process.env.HOME = originalHome;
  if (TEST_ROOT && existsSync(TEST_ROOT)) {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  }
});

function eventsFile(): string {
  return join(TEST_ROOT, '.overdeck', 'costs', 'events.jsonl');
}

function makeEvent(overrides: Partial<CostEvent> = {}): CostEvent {
  return {
    ts: new Date().toISOString(),
    type: 'cost',
    agentId: 'agent-pan-100',
    issueId: 'PAN-100',
    sessionType: 'implementation',
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    input: 1000,
    output: 500,
    cacheRead: 200,
    cacheWrite: 100,
    cost: 0.01,
    ...overrides,
  };
}

describe('bounded event readers', () => {
  it('filters and limits while scanning the log', () => {
    appendCostEvent(makeEvent({ issueId: 'PAN-1', provider: 'anthropic' }));
    appendCostEvent(makeEvent({ issueId: 'PAN-2', provider: 'openai' }));
    appendCostEvent(makeEvent({ issueId: 'PAN-1', provider: 'anthropic', input: 2000 }));

    expect(readEvents({ issueId: 'pan-1', offset: 1, limit: 1 })).toMatchObject([
      { issueId: 'PAN-1', input: 2000 },
    ]);
    expect(tailEvents(2).map((event) => event.issueId)).toEqual(['PAN-2', 'PAN-1']);
    expect(readEvents({ offset: -1 }).map((event) => event.input)).toEqual([2000]);
    expect(readEvents({ limit: -1 }).map((event) => event.issueId)).toEqual(['PAN-1', 'PAN-2']);
  });

  it('tracks line and byte cursors across appended events', () => {
    appendCostEvent(makeEvent({ issueId: 'PAN-1' }));
    const first = getLastEventMetadata();

    appendCostEvent(makeEvent({ issueId: 'PAN-2' }));
    const delta = readEventsFromByteOffset(first.byteOffset);
    const fromLine = readEventsFromLine(first.lastEventLine);

    expect(first.lastEventLine).toBe(1);
    expect(first.byteOffset).toBeGreaterThan(0);
    expect(delta.events.map((event) => event.issueId)).toEqual(['PAN-2']);
    expect(delta.linesRead).toBe(1);
    expect(delta.newOffset).toBeGreaterThan(first.byteOffset);
    expect(fromLine.events.map((event) => event.issueId)).toEqual(['PAN-2']);
    expect(fromLine.newLine).toBe(2);
  });

  it('does not advance the byte cursor past a partial append', () => {
    appendCostEvent(makeEvent({ issueId: 'PAN-1' }));
    const first = getLastEventMetadata();
    const partial = JSON.stringify(makeEvent({ issueId: 'PAN-2' }));
    writeFileSync(eventsFile(), partial, { flag: 'a' });

    const incomplete = readEventsFromByteOffset(first.byteOffset);
    expect(incomplete.events).toEqual([]);
    expect(incomplete.newOffset).toBe(first.byteOffset);

    writeFileSync(eventsFile(), '\n', { flag: 'a' });
    const complete = readEventsFromByteOffset(first.byteOffset);
    expect(complete.events.map((event) => event.issueId)).toEqual(['PAN-2']);
  });

  it('handles an event larger than the read chunk without truncating UTF-8', () => {
    const event = { ...makeEvent({ issueId: 'PAN-LARGE' }), detail: 'é'.repeat(40_000) };
    writeFileSync(eventsFile(), `${JSON.stringify(event)}\n`);

    const [read] = readEvents();
    expect(read.issueId).toBe('PAN-LARGE');
    expect((read as CostEvent & { detail: string }).detail).toBe(event.detail);
    expect(getLastEventMetadata().byteOffset).toBe(Buffer.byteLength(`${JSON.stringify(event)}\n`));
  });
});

describe('deduplicateEvents', () => {
  it('should return 0 when no events file exists', () => {
    expect(deduplicateEvents()).toBe(0);
  });

  it('should return 0 when no duplicates exist', () => {
    appendCostEvent(makeEvent({ input: 1000 }));
    appendCostEvent(makeEvent({ input: 2000 })); // Different tokens — not a duplicate
    expect(deduplicateEvents()).toBe(0);
    expect(readEvents()).toHaveLength(2);
  });

  it('should remove duplicate events with identical fields within 60-second window', () => {
    const ts = new Date().toISOString();
    const event = makeEvent({ ts });
    appendCostEvent(event);
    appendCostEvent(event); // Exact duplicate (same ts, same tokens)
    appendCostEvent(event); // Third copy

    const removed = deduplicateEvents();
    expect(removed).toBe(2);
    expect(readEvents()).toHaveLength(1);
  });

  it('should not deduplicate events with same tokens but different agents', () => {
    const ts = new Date().toISOString();
    appendCostEvent(makeEvent({ ts, agentId: 'agent-1', input: 1000 }));
    appendCostEvent(makeEvent({ ts, agentId: 'agent-2', input: 1000 })); // Different agent

    expect(deduplicateEvents()).toBe(0);
    expect(readEvents()).toHaveLength(2);
  });

  it('should not deduplicate events with same tokens but timestamps > 60 seconds apart', () => {
    const ts1 = new Date(Date.now() - 120_000).toISOString(); // 2 minutes ago
    const ts2 = new Date().toISOString();
    appendCostEvent(makeEvent({ ts: ts1, input: 1000 }));
    appendCostEvent(makeEvent({ ts: ts2, input: 1000 })); // Same tokens, different session turn

    expect(deduplicateEvents()).toBe(0);
    expect(readEvents()).toHaveLength(2);
  });

  it('should deduplicate events with slightly different timestamps within 60-second window', () => {
    const ts1 = new Date(Date.now() - 5_000).toISOString(); // 5 seconds ago
    const ts2 = new Date().toISOString();                    // now (same parallel session)
    const base = { input: 5000, output: 2000, cacheRead: 0, cacheWrite: 0 };
    appendCostEvent(makeEvent({ ts: ts1, ...base }));
    appendCostEvent(makeEvent({ ts: ts2, ...base }));

    expect(deduplicateEvents()).toBe(1);
    expect(readEvents()).toHaveLength(1);
  });

  it('should preserve legitimate consecutive events with same token counts', () => {
    const ts1 = new Date(Date.now() - 180_000).toISOString(); // 3 min ago
    const ts2 = new Date(Date.now() - 120_000).toISOString(); // 2 min ago
    const ts3 = new Date().toISOString();
    const base = { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 };
    appendCostEvent(makeEvent({ ts: ts1, ...base }));
    appendCostEvent(makeEvent({ ts: ts2, ...base })); // > 60s from ts1 — not a duplicate
    appendCostEvent(makeEvent({ ts: ts3, ...base })); // > 60s from ts2 — not a duplicate

    expect(deduplicateEvents()).toBe(0);
    expect(readEvents()).toHaveLength(3);
  });

  // requestId-based dedup tests (PAN-238)

  it('should remove events with duplicate requestIds regardless of timestamp distance', () => {
    const requestId = 'req-abc-123';
    // Timestamps > 60s apart — heuristic would keep both, but requestId dedup removes the dup
    const ts1 = new Date(Date.now() - 300_000).toISOString(); // 5 min ago
    const ts2 = new Date().toISOString();
    appendCostEvent(makeEvent({ ts: ts1, requestId, input: 1000 }));
    appendCostEvent(makeEvent({ ts: ts2, requestId, input: 1000 })); // same requestId

    const removed = deduplicateEvents();
    expect(removed).toBe(1);
    expect(readEvents()).toHaveLength(1);
  });

  it('should keep events with different requestIds even with identical token counts', () => {
    const base = { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 };
    appendCostEvent(makeEvent({ requestId: 'req-1', ...base }));
    appendCostEvent(makeEvent({ requestId: 'req-2', ...base })); // different request

    expect(deduplicateEvents()).toBe(0);
    expect(readEvents()).toHaveLength(2);
  });

  it('should handle mixed events: requestId-based and legacy heuristic in the same file', () => {
    const ts = new Date().toISOString();
    // Event with requestId — dedup by requestId
    appendCostEvent(makeEvent({ ts, requestId: 'req-xyz', input: 1000 }));
    appendCostEvent(makeEvent({ ts, requestId: 'req-xyz', input: 1000 })); // dup by requestId
    // Event without requestId — dedup by heuristic
    appendCostEvent(makeEvent({ ts, input: 2000 }));
    appendCostEvent(makeEvent({ ts, input: 2000 })); // dup by heuristic (same ts, same tokens)

    const removed = deduplicateEvents();
    expect(removed).toBe(2);
    expect(readEvents()).toHaveLength(2);
  });
});
