/**
 * Events Tests - Verify event log management including deduplication (PAN-220)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { appendCostEvent, deduplicateEvents, readEvents, CostEvent } from '../events.js';

let TEST_ROOT: string;
const originalHome = process.env.HOME;

beforeEach(() => {
  TEST_ROOT = join(tmpdir(), `panopticon-events-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(TEST_ROOT, '.panopticon', 'costs'), { recursive: true });
  process.env.HOME = TEST_ROOT;
});

afterEach(() => {
  process.env.HOME = originalHome;
  if (TEST_ROOT && existsSync(TEST_ROOT)) {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  }
});

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
});
