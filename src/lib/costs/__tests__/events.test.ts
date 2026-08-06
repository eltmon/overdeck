/**
 * Events Tests - Verify event log management including deduplication (PAN-220)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  appendCostEventSync,
  CostEvent,
  deduplicateEventsSync,
  getLastEventMetadataSync,
  readEventsFromByteOffsetSync,
  readEventsFromLineSync,
  readEventsSync,
  tailEventsSync,
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
    appendCostEventSync(makeEvent({ issueId: 'PAN-1', provider: 'anthropic' }));
    appendCostEventSync(makeEvent({ issueId: 'PAN-2', provider: 'openai' }));
    appendCostEventSync(makeEvent({ issueId: 'PAN-1', provider: 'anthropic', input: 2000 }));

    expect(readEventsSync({ issueId: 'pan-1', offset: 1, limit: 1 })).toMatchObject([
      { issueId: 'PAN-1', input: 2000 },
    ]);
    expect(tailEventsSync(2).map((event) => event.issueId)).toEqual(['PAN-2', 'PAN-1']);
    expect(readEventsSync({ offset: -1 }).map((event) => event.input)).toEqual([2000]);
    expect(readEventsSync({ limit: -1 }).map((event) => event.issueId)).toEqual(['PAN-1', 'PAN-2']);
  });

  it('tracks line and byte cursors across appended events', () => {
    appendCostEventSync(makeEvent({ issueId: 'PAN-1' }));
    const first = getLastEventMetadataSync();

    appendCostEventSync(makeEvent({ issueId: 'PAN-2' }));
    const delta = readEventsFromByteOffsetSync(first.byteOffset);
    const fromLine = readEventsFromLineSync(first.lastEventLine);

    expect(first.lastEventLine).toBe(1);
    expect(first.byteOffset).toBeGreaterThan(0);
    expect(delta.events.map((event) => event.issueId)).toEqual(['PAN-2']);
    expect(delta.linesRead).toBe(1);
    expect(delta.newOffset).toBeGreaterThan(first.byteOffset);
    expect(fromLine.events.map((event) => event.issueId)).toEqual(['PAN-2']);
    expect(fromLine.newLine).toBe(2);
  });

  it('does not advance the byte cursor past a partial append', () => {
    appendCostEventSync(makeEvent({ issueId: 'PAN-1' }));
    const first = getLastEventMetadataSync();
    const partial = JSON.stringify(makeEvent({ issueId: 'PAN-2' }));
    writeFileSync(eventsFile(), partial, { flag: 'a' });

    const incomplete = readEventsFromByteOffsetSync(first.byteOffset);
    expect(incomplete.events).toEqual([]);
    expect(incomplete.newOffset).toBe(first.byteOffset);

    writeFileSync(eventsFile(), '\n', { flag: 'a' });
    const complete = readEventsFromByteOffsetSync(first.byteOffset);
    expect(complete.events.map((event) => event.issueId)).toEqual(['PAN-2']);
  });

  it('handles an event larger than the read chunk without truncating UTF-8', () => {
    const event = { ...makeEvent({ issueId: 'PAN-LARGE' }), detail: 'é'.repeat(40_000) };
    writeFileSync(eventsFile(), `${JSON.stringify(event)}\n`);

    const [read] = readEventsSync();
    expect(read.issueId).toBe('PAN-LARGE');
    expect((read as CostEvent & { detail: string }).detail).toBe(event.detail);
    expect(getLastEventMetadataSync().byteOffset).toBe(Buffer.byteLength(`${JSON.stringify(event)}\n`));
  });
});

describe('deduplicateEvents', () => {
  it('should return 0 when no events file exists', () => {
    expect(deduplicateEventsSync()).toBe(0);
  });

  it('should return 0 when no duplicates exist', () => {
    appendCostEventSync(makeEvent({ input: 1000 }));
    appendCostEventSync(makeEvent({ input: 2000 })); // Different tokens — not a duplicate
    expect(deduplicateEventsSync()).toBe(0);
    expect(readEventsSync()).toHaveLength(2);
  });

  it('should remove duplicate events with identical fields within 60-second window', () => {
    const ts = new Date().toISOString();
    const event = makeEvent({ ts });
    appendCostEventSync(event);
    appendCostEventSync(event); // Exact duplicate (same ts, same tokens)
    appendCostEventSync(event); // Third copy

    const removed = deduplicateEventsSync();
    expect(removed).toBe(2);
    expect(readEventsSync()).toHaveLength(1);
  });

  it('should not deduplicate events with same tokens but different agents', () => {
    const ts = new Date().toISOString();
    appendCostEventSync(makeEvent({ ts, agentId: 'agent-1', input: 1000 }));
    appendCostEventSync(makeEvent({ ts, agentId: 'agent-2', input: 1000 })); // Different agent

    expect(deduplicateEventsSync()).toBe(0);
    expect(readEventsSync()).toHaveLength(2);
  });

  it('should not deduplicate events with same tokens but timestamps > 60 seconds apart', () => {
    const ts1 = new Date(Date.now() - 120_000).toISOString(); // 2 minutes ago
    const ts2 = new Date().toISOString();
    appendCostEventSync(makeEvent({ ts: ts1, input: 1000 }));
    appendCostEventSync(makeEvent({ ts: ts2, input: 1000 })); // Same tokens, different session turn

    expect(deduplicateEventsSync()).toBe(0);
    expect(readEventsSync()).toHaveLength(2);
  });

  it('should deduplicate events with slightly different timestamps within 60-second window', () => {
    const ts1 = new Date(Date.now() - 5_000).toISOString(); // 5 seconds ago
    const ts2 = new Date().toISOString();                    // now (same parallel session)
    const base = { input: 5000, output: 2000, cacheRead: 0, cacheWrite: 0 };
    appendCostEventSync(makeEvent({ ts: ts1, ...base }));
    appendCostEventSync(makeEvent({ ts: ts2, ...base }));

    expect(deduplicateEventsSync()).toBe(1);
    expect(readEventsSync()).toHaveLength(1);
  });

  it('should preserve legitimate consecutive events with same token counts', () => {
    const ts1 = new Date(Date.now() - 180_000).toISOString(); // 3 min ago
    const ts2 = new Date(Date.now() - 120_000).toISOString(); // 2 min ago
    const ts3 = new Date().toISOString();
    const base = { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 };
    appendCostEventSync(makeEvent({ ts: ts1, ...base }));
    appendCostEventSync(makeEvent({ ts: ts2, ...base })); // > 60s from ts1 — not a duplicate
    appendCostEventSync(makeEvent({ ts: ts3, ...base })); // > 60s from ts2 — not a duplicate

    expect(deduplicateEventsSync()).toBe(0);
    expect(readEventsSync()).toHaveLength(3);
  });

  // requestId-based dedup tests (PAN-238)

  it('should remove events with duplicate requestIds regardless of timestamp distance', () => {
    const requestId = 'req-abc-123';
    // Timestamps > 60s apart — heuristic would keep both, but requestId dedup removes the dup
    const ts1 = new Date(Date.now() - 300_000).toISOString(); // 5 min ago
    const ts2 = new Date().toISOString();
    appendCostEventSync(makeEvent({ ts: ts1, requestId, input: 1000 }));
    appendCostEventSync(makeEvent({ ts: ts2, requestId, input: 1000 })); // same requestId

    const removed = deduplicateEventsSync();
    expect(removed).toBe(1);
    expect(readEventsSync()).toHaveLength(1);
  });

  it('should keep events with different requestIds even with identical token counts', () => {
    const base = { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 };
    appendCostEventSync(makeEvent({ requestId: 'req-1', ...base }));
    appendCostEventSync(makeEvent({ requestId: 'req-2', ...base })); // different request

    expect(deduplicateEventsSync()).toBe(0);
    expect(readEventsSync()).toHaveLength(2);
  });

  it('should handle mixed events: requestId-based and legacy heuristic in the same file', () => {
    const ts = new Date().toISOString();
    // Event with requestId — dedup by requestId
    appendCostEventSync(makeEvent({ ts, requestId: 'req-xyz', input: 1000 }));
    appendCostEventSync(makeEvent({ ts, requestId: 'req-xyz', input: 1000 })); // dup by requestId
    // Event without requestId — dedup by heuristic
    appendCostEventSync(makeEvent({ ts, input: 2000 }));
    appendCostEventSync(makeEvent({ ts, input: 2000 })); // dup by heuristic (same ts, same tokens)

    const removed = deduplicateEventsSync();
    expect(removed).toBe(2);
    expect(readEventsSync()).toHaveLength(2);
  });
});
