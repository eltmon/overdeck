/**
 * Unit tests for the Event Store (PAN-428 B2)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, type SqliteDatabase } from '../../src/lib/database/driver.js';
import { createEventStore, REPLAY_MAX_EVENTS, type DbAdapter } from '../../src/dashboard/server/event-store.js';

let db: SqliteDatabase;

beforeEach(() => {
  db = openDatabase(':memory:');
  db.exec(`
    CREATE TABLE events (
      sequence  INTEGER PRIMARY KEY AUTOINCREMENT,
      type      TEXT    NOT NULL,
      timestamp INTEGER NOT NULL,
      payload   TEXT    NOT NULL DEFAULT '{}'
    )
  `);
});

afterEach(() => {
  db.close();
});

describe('EventStore', () => {
  it('append returns monotonically increasing sequence numbers', () => {
    const store = createEventStore(db as unknown as DbAdapter);

    const s1 = store.append({ type: 'agent.started', timestamp: new Date().toISOString(), payload: { agentId: 'a1', issueId: 'PAN-1' } } as any);
    const s2 = store.append({ type: 'agent.stopped', timestamp: new Date().toISOString(), payload: { agentId: 'a1', issueId: 'PAN-1' } } as any);
    const s3 = store.append({ type: 'merge.ready', timestamp: new Date().toISOString(), payload: { issueId: 'PAN-1' } } as any);

    expect(s1).toBeLessThan(s2);
    expect(s2).toBeLessThan(s3);
    expect(s1).toBeGreaterThan(0);
  });

  it('readFrom(0) returns all appended events', () => {
    const store = createEventStore(db as unknown as DbAdapter);

    store.append({ type: 'agent.started', timestamp: new Date().toISOString(), payload: { agentId: 'a1' } } as any);
    store.append({ type: 'agent.stopped', timestamp: new Date().toISOString(), payload: { agentId: 'a1' } } as any);

    const events = store.readFrom(0);
    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe('agent.started');
    expect(events[1]!.type).toBe('agent.stopped');
  });

  it('readFrom(N) returns only events with sequence > N', () => {
    const store = createEventStore(db as unknown as DbAdapter);

    const s1 = store.append({ type: 'agent.created', timestamp: new Date().toISOString(), payload: {} } as any);
    store.append({ type: 'agent.started', timestamp: new Date().toISOString(), payload: {} } as any);
    store.append({ type: 'agent.stopped', timestamp: new Date().toISOString(), payload: {} } as any);

    const events = store.readFrom(s1);
    expect(events).toHaveLength(2);
    expect(events.every(e => e.sequence > s1)).toBe(true);
  });

  it('events are returned in sequence order', () => {
    const store = createEventStore(db as unknown as DbAdapter);

    store.append({ type: 'event.a', timestamp: new Date().toISOString(), payload: {} } as any);
    store.append({ type: 'event.b', timestamp: new Date().toISOString(), payload: {} } as any);
    store.append({ type: 'event.c', timestamp: new Date().toISOString(), payload: {} } as any);

    const events = store.readFrom(0);
    const seqs = events.map(e => e.sequence);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it('subscribe delivers live events in real time', () => {
    const store = createEventStore(db as unknown as DbAdapter);
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
    const store = createEventStore(db as unknown as DbAdapter);
    const payload = { issueId: 'PAN-42', agentId: 'agent-xyz', nested: { count: 7 } };

    store.append({ type: 'agent.created', timestamp: new Date().toISOString(), payload } as any);

    const events = store.readFrom(0);
    expect(events[0]!.payload).toEqual(payload);
  });

  it('compact removes events older than 7 days', () => {
    const store = createEventStore(db as unknown as DbAdapter);

    // Insert a stale event directly into DB with old timestamp
    const oldTimestamp = Date.now() - 8 * 24 * 60 * 60 * 1000;
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

describe('workspaceId stamping resolver injection (PAN-1990 review fix, non-blocking)', () => {
  it('uses the injected resolveWorkspaceId instead of the real global resolver', () => {
    const store = createEventStore(db as unknown as DbAdapter, {
      resolveWorkspaceId: (issueId) => (issueId === 'PAN-1' ? 'ws-injected' : undefined),
    });

    store.append({ type: 'agent.started', timestamp: new Date().toISOString(), payload: { agentId: 'a1', issueId: 'PAN-1' } } as any);

    const [event] = store.readFrom(0);
    expect((event!.payload as { workspaceId?: string }).workspaceId).toBe('ws-injected');
  });

  it('never overwrites a payload that already carries a workspaceId, even with an injected resolver', () => {
    const store = createEventStore(db as unknown as DbAdapter, {
      resolveWorkspaceId: () => 'ws-should-not-appear',
    });

    store.append({ type: 'agent.started', timestamp: new Date().toISOString(), payload: { agentId: 'a1', issueId: 'PAN-1', workspaceId: 'ws-explicit' } } as any);

    const [event] = store.readFrom(0);
    expect((event!.payload as { workspaceId?: string }).workspaceId).toBe('ws-explicit');
  });

  it('degrades to "no stamp" instead of failing the append when the resolver throws', () => {
    const store = createEventStore(db as unknown as DbAdapter, {
      resolveWorkspaceId: () => { throw new Error('resolver unavailable in this test context'); },
    });

    const seq = store.append({ type: 'agent.started', timestamp: new Date().toISOString(), payload: { agentId: 'a1', issueId: 'PAN-1' } } as any);

    expect(seq).toBeGreaterThan(0);
    const [event] = store.readFrom(0);
    expect((event!.payload as { workspaceId?: string }).workspaceId).toBeUndefined();
  });
});

describe('startup purge of orphaned review-status events (PAN-3917)', () => {
  it('purgeType removes review.status_changed and pipeline.status_changed rows, leaving others', () => {
    const store = createEventStore(db as unknown as DbAdapter);

    store.append({
      type: 'review.status_changed',
      timestamp: new Date().toISOString(),
      payload: { issueId: 'PAN-1', status: { reviewStatus: 'passed' } },
    } as any);
    store.append({
      type: 'pipeline.status_changed',
      timestamp: new Date().toISOString(),
      payload: { issueId: 'PAN-1', stage: 'merged' },
    } as any);
    store.append({ type: 'agent.started', timestamp: new Date().toISOString(), payload: { agentId: 'a1' } } as any);

    // initEventStore() runs this same purge unconditionally at boot: pipeline
    // state is derived, never stored, so any review.status_changed or
    // pipeline.status_changed row left behind by an older build is orphaned
    // and safe to delete outright.
    const purged = store.purgeType('review.status_changed') + store.purgeType('pipeline.status_changed');
    expect(purged).toBe(2);

    const remaining = store.readFrom(0);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.type).toBe('agent.started');
  });
});

describe('readFromBounded (PAN-4559)', () => {
  function appendN(store: ReturnType<typeof createEventStore>, n: number, payload: unknown = {}): void {
    for (let i = 0; i < n; i++) {
      store.append({ type: 'agent.started', timestamp: new Date().toISOString(), payload } as any);
    }
  }

  it('returns every event after fromSequence when the gap is within the cap', () => {
    const store = createEventStore(db as unknown as DbAdapter, { resolveWorkspaceId: () => undefined });
    appendN(store, 3);

    const result = store.readFromBounded(0, { maxEvents: 5 });

    expect(result.tooFarBehind).toBe(false);
    expect(result.events).toHaveLength(3);
    const seqs = result.events.map(e => e.sequence);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it('returns exactly maxEvents events without tooFarBehind', () => {
    const store = createEventStore(db as unknown as DbAdapter, { resolveWorkspaceId: () => undefined });
    appendN(store, 5);

    const result = store.readFromBounded(0, { maxEvents: 5 });

    expect(result.tooFarBehind).toBe(false);
    expect(result.events).toHaveLength(5);
  });

  it('reports tooFarBehind and reads at most maxEvents + 1 rows when the gap exceeds the cap', () => {
    const recorded: { sql: string; rowCount: number }[] = [];
    const recordingDb: DbAdapter = {
      prepare: <R = Record<string, unknown>>(sql: string) => {
        const stmt = (db as unknown as DbAdapter).prepare<R>(sql);
        return {
          run: (params?: unknown[]) => (params === undefined ? stmt.run() : stmt.run(params)),
          get: (params?: unknown[]) => (params === undefined ? stmt.get() : stmt.get(params)),
          all: (params?: unknown[]) => {
            const rows = params === undefined ? stmt.all() : stmt.all(params);
            recorded.push({ sql, rowCount: rows.length });
            return rows;
          },
        };
      },
      exec: (sql: string) => (db as unknown as DbAdapter).exec(sql),
    };
    const store = createEventStore(recordingDb, { resolveWorkspaceId: () => undefined });
    appendN(store, 20);

    const result = store.readFromBounded(0, { maxEvents: 5 });

    expect(result).toEqual({ events: [], tooFarBehind: true });
    const boundedCall = recorded.find(r => r.sql.includes('LIMIT ?'));
    expect(boundedCall).toBeDefined();
    expect(boundedCall!.rowCount).toBe(6);
  });

  it('uses REPLAY_MAX_EVENTS by default', () => {
    const store = createEventStore(db as unknown as DbAdapter, { resolveWorkspaceId: () => undefined });
    appendN(store, REPLAY_MAX_EVENTS + 1);

    expect(store.readFromBounded(0).tooFarBehind).toBe(true);

    const result = store.readFromBounded(1);
    expect(result.tooFarBehind).toBe(false);
    expect(result.events).toHaveLength(REPLAY_MAX_EVENTS);
  });

  it('reports tooFarBehind when payload bytes exceed maxPayloadBytes', () => {
    const store = createEventStore(db as unknown as DbAdapter, { resolveWorkspaceId: () => undefined });
    appendN(store, 3, { blob: 'x'.repeat(400) });

    expect(store.readFromBounded(0, { maxEvents: 10, maxPayloadBytes: 1000 }).tooFarBehind).toBe(true);

    const result = store.readFromBounded(0, { maxEvents: 10, maxPayloadBytes: 10_000 });
    expect(result.tooFarBehind).toBe(false);
    expect(result.events).toHaveLength(3);
  });

  it('excludes issues.snapshot rows', () => {
    const store = createEventStore(db as unknown as DbAdapter, { resolveWorkspaceId: () => undefined });
    db.prepare(`INSERT INTO events (type, timestamp, payload) VALUES (?, ?, ?)`)
      .run('issues.snapshot', Date.now(), '{}');
    store.append({ type: 'agent.started', timestamp: new Date().toISOString(), payload: {} } as any);

    const result = store.readFromBounded(0, { maxEvents: 10 });

    expect(result.tooFarBehind).toBe(false);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.type).toBe('agent.started');
  });
});
