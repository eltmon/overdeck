/**
 * Unit tests for the Event Store (PAN-428 B2)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { closeDatabase, getDatabase } from '../../src/lib/database/index.js';
import { createEventStore, type DbAdapter } from '../../src/dashboard/server/event-store.js';

// Override PANOPTICON_HOME to isolate each test in its own temp DB
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'pan-event-store-test-'));
  process.env['PANOPTICON_HOME'] = tmpDir;
  // Reset the DB singleton so each test gets a fresh connection
  closeDatabase();
});

afterEach(() => {
  closeDatabase();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env['PANOPTICON_HOME'];
});

describe('EventStore', () => {
  it('append returns monotonically increasing sequence numbers', () => {
    const store = createEventStore(getDatabase() as unknown as DbAdapter);

    const s1 = store.append({ type: 'agent.started', timestamp: new Date().toISOString(), payload: { agentId: 'a1', issueId: 'PAN-1' } } as any);
    const s2 = store.append({ type: 'agent.stopped', timestamp: new Date().toISOString(), payload: { agentId: 'a1', issueId: 'PAN-1' } } as any);
    const s3 = store.append({ type: 'merge.ready', timestamp: new Date().toISOString(), payload: { issueId: 'PAN-1' } } as any);

    expect(s1).toBeLessThan(s2);
    expect(s2).toBeLessThan(s3);
    expect(s1).toBeGreaterThan(0);
  });

  it('readFrom(0) returns all appended events', () => {
    const store = createEventStore(getDatabase() as unknown as DbAdapter);

    store.append({ type: 'agent.started', timestamp: new Date().toISOString(), payload: { agentId: 'a1' } } as any);
    store.append({ type: 'agent.stopped', timestamp: new Date().toISOString(), payload: { agentId: 'a1' } } as any);

    const events = store.readFrom(0);
    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe('agent.started');
    expect(events[1]!.type).toBe('agent.stopped');
  });

  it('readFrom(N) returns only events with sequence > N', () => {
    const store = createEventStore(getDatabase() as unknown as DbAdapter);

    const s1 = store.append({ type: 'agent.created', timestamp: new Date().toISOString(), payload: {} } as any);
    store.append({ type: 'agent.started', timestamp: new Date().toISOString(), payload: {} } as any);
    store.append({ type: 'agent.stopped', timestamp: new Date().toISOString(), payload: {} } as any);

    const events = store.readFrom(s1);
    expect(events).toHaveLength(2);
    expect(events.every(e => e.sequence > s1)).toBe(true);
  });

  it('events are returned in sequence order', () => {
    const store = createEventStore(getDatabase() as unknown as DbAdapter);

    store.append({ type: 'event.a', timestamp: new Date().toISOString(), payload: {} } as any);
    store.append({ type: 'event.b', timestamp: new Date().toISOString(), payload: {} } as any);
    store.append({ type: 'event.c', timestamp: new Date().toISOString(), payload: {} } as any);

    const events = store.readFrom(0);
    const seqs = events.map(e => e.sequence);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it('subscribe delivers live events in real time', () => {
    const store = createEventStore(getDatabase() as unknown as DbAdapter);
    const received: string[] = [];

    const unsub = store.subscribe(e => received.push(e.type));

    store.append({ type: 'merge.ready', timestamp: new Date().toISOString(), payload: { issueId: 'PAN-1' } } as any);
    store.append({ type: 'agent.started', timestamp: new Date().toISOString(), payload: { agentId: 'a1' } } as any);

    // EventEmitter is synchronous — events delivered inline
    expect(received).toHaveLength(2);
    expect(received[0]).toBe('merge.ready');
    expect(received[1]).toBe('agent.started');

    unsub();

    // After unsubscribe, no more events
    store.append({ type: 'agent.stopped', timestamp: new Date().toISOString(), payload: {} } as any);
    expect(received).toHaveLength(2);
  });

  it('payload is round-tripped through JSON correctly', () => {
    const store = createEventStore(getDatabase() as unknown as DbAdapter);
    const payload = { issueId: 'PAN-42', agentId: 'agent-xyz', nested: { count: 7 } };

    store.append({ type: 'agent.created', timestamp: new Date().toISOString(), payload } as any);

    const events = store.readFrom(0);
    expect(events[0]!.payload).toEqual(payload);
  });

  it('compact removes events older than 7 days', () => {
    const store = createEventStore(getDatabase() as unknown as DbAdapter);
    const db = getDatabase();

    // Insert a stale event directly into DB with old timestamp
    const oldTimestamp = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO events (type, timestamp, payload) VALUES (?, ?, ?)').run(
      'agent.created', oldTimestamp, '{}'
    );

    // Insert a fresh event
    store.append({ type: 'agent.started', timestamp: new Date().toISOString(), payload: {} } as any);

    const beforeCompact = store.readFrom(0);
    expect(beforeCompact.length).toBe(2);

    store.compact();

    const afterCompact = store.readFrom(0);
    expect(afterCompact.length).toBe(1);
    expect(afterCompact[0]!.type).toBe('agent.started');
  });
});
