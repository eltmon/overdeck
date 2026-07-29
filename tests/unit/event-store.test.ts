/**
 * Unit tests for the Event Store (PAN-428 B2)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, type SqliteDatabase } from '../../src/lib/database/driver.js';
import { createEventStore, type DbAdapter } from '../../src/dashboard/server/event-store.js';

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

describe('trimReviewStatusHistoryPayloads (PAN-3253)', () => {
  function insertReviewEvent(historyLength: number, issueId = 'MIN-901'): number {
    const history = Array.from({ length: historyLength }, (_, i) => ({
      type: 'review',
      status: i % 2 === 0 ? 'pending' : 'passed',
      timestamp: new Date(1_753_000_000_000 + i * 1000).toISOString(),
      notes: 'Approved unchanged review: frontend has no PR diff, padding padding padding',
    }));
    const payload = JSON.stringify({ issueId, status: { issueId, reviewStatus: 'passed', history } });
    db.prepare('INSERT INTO events (type, timestamp, payload) VALUES (?, ?, ?)').run(
      'review.status_changed', Date.now(), payload,
    );
    return payload.length;
  }

  it('trims oversized payload history to the bounded tail and reports saved space', async () => {
    const { trimReviewStatusHistoryPayloads } = await import('../../src/dashboard/server/event-store.js');
    const originalLength = insertReviewEvent(500);

    const result = trimReviewStatusHistoryPayloads(db as unknown as DbAdapter);

    expect(result.trimmed).toBe(1);
    expect(result.savedChars).toBeGreaterThan(0);
    const row = db.prepare("SELECT payload FROM events WHERE type = 'review.status_changed'").get() as { payload: string };
    expect(row.payload.length).toBeLessThan(originalLength);
    const parsed = JSON.parse(row.payload);
    expect(parsed.status.history).toHaveLength(20);
    // Keeps the most recent tail, not the head
    expect(parsed.status.history[19].timestamp).toBe(new Date(1_753_000_000_000 + 499 * 1000).toISOString());
    expect(parsed.issueId).toBe('MIN-901');
  });

  it('trim converges to a no-op on second run (boot-trim-notes.ac2)', async () => {
    const { trimReviewStatusHistoryPayloads } = await import('../../src/dashboard/server/event-store.js');
    // Create a large payload with long notes to exceed 16KB threshold
    const longNote = 'x'.repeat(1000);
    const largeHistory = Array.from({ length: 30 }, (_, i) => ({
      type: 'review',
      status: i % 2 === 0 ? 'pending' : 'passed',
      timestamp: new Date(1_753_000_000_000 + i * 1000).toISOString(),
      notes: longNote,
    }));
    const payload = JSON.stringify({ issueId: 'MIN-905', status: { issueId: 'MIN-905', reviewStatus: 'passed', history: largeHistory } });
    db.prepare('INSERT INTO events (type, timestamp, payload) VALUES (?, ?, ?)').run(
      'review.status_changed', Date.now(), payload,
    );

    // First trim
    const result1 = trimReviewStatusHistoryPayloads(db as unknown as DbAdapter);
    expect(result1.trimmed).toBe(1);
    expect(result1.savedChars).toBeGreaterThan(0);

    // Second trim on already-trimmed row should be a no-op
    const result2 = trimReviewStatusHistoryPayloads(db as unknown as DbAdapter);
    expect(result2.trimmed).toBe(0);
    expect(result2.savedChars).toBe(0);

    // Payload should remain identical after second run
    const row = db.prepare("SELECT payload FROM events WHERE type = 'review.status_changed'").get() as { payload: string };
    const parsed = JSON.parse(row.payload);
    expect(parsed.status.history).toHaveLength(20);
    // All notes should still be <= 500 chars
    for (const entry of parsed.status.history) {
      if (entry.notes) {
        expect(entry.notes.length).toBeLessThanOrEqual(500);
      }
    }
  });

  it('payload size is bounded regardless of how many transitions occurred', async () => {
    const { trimReviewStatusHistoryPayloads } = await import('../../src/dashboard/server/event-store.js');
    insertReviewEvent(500, 'MIN-901');
    insertReviewEvent(2140, 'MIN-891');

    trimReviewStatusHistoryPayloads(db as unknown as DbAdapter);

    const rows = db.prepare("SELECT payload FROM events WHERE type = 'review.status_changed'").all() as Array<{ payload: string }>;
    const sizes = rows.map((r) => r.payload.length);
    // Both trimmed payloads carry the same bounded 20-entry tail, so their
    // sizes are equal — independent of the 500 vs 2140 original transitions.
    expect(sizes[0]).toBe(sizes[1]);
  });

  it('leaves small payloads and other event types untouched', async () => {
    const { trimReviewStatusHistoryPayloads } = await import('../../src/dashboard/server/event-store.js');
    const small = JSON.stringify({ issueId: 'PAN-1', status: { reviewStatus: 'passed', history: [] } });
    db.prepare('INSERT INTO events (type, timestamp, payload) VALUES (?, ?, ?)').run('review.status_changed', Date.now(), small);
    const other = JSON.stringify({ agentId: 'a1', big: 'x'.repeat(20_000) });
    db.prepare('INSERT INTO events (type, timestamp, payload) VALUES (?, ?, ?)').run('agent.activity_changed', Date.now(), other);

    const result = trimReviewStatusHistoryPayloads(db as unknown as DbAdapter);

    expect(result.trimmed).toBe(0);
    const rows = db.prepare('SELECT payload FROM events ORDER BY sequence').all() as Array<{ payload: string }>;
    expect(rows[0]!.payload).toBe(small);
    expect(rows[1]!.payload).toBe(other);
  });
});

describe('append() bounding of review.status_changed (PAN-3253 append-door-bound)', () => {
  it('bounds oversized review.status_changed at append door (FR-1)', () => {
    const store = createEventStore(db as unknown as DbAdapter);

    const longNote = 'x'.repeat(1000);
    const largeHistory = Array.from({ length: 30 }, (_, i) => ({
      type: 'review',
      status: i % 2 === 0 ? 'pending' : 'passed',
      timestamp: new Date(1_753_000_000_000 + i * 1000).toISOString(),
      notes: longNote,
    }));

    const seq = store.append({
      type: 'review.status_changed',
      timestamp: new Date().toISOString(),
      payload: {
        status: {
          history: largeHistory,
          issueId: 'PAN-3260',
          reviewStatus: 'passed',
        },
      },
    } as any);

    const rows = db.prepare('SELECT payload FROM events WHERE sequence = ?').all([seq]) as Array<{ payload: string }>;
    expect(rows).toHaveLength(1);

    const parsed = JSON.parse(rows[0]!.payload) as {
      status?: { history?: Array<{ notes?: string }> };
    };
    expect(parsed.status?.history).toHaveLength(20);
    for (const entry of parsed.status?.history || []) {
      if (entry.notes) {
        expect(entry.notes.length).toBeLessThanOrEqual(500);
      }
    }
  });

  it('preserves large non-review payloads byte-identically at append door', () => {
    const store = createEventStore(db as unknown as DbAdapter);

    const largePayload = { big: 'x'.repeat(100_000), nested: { data: 'y'.repeat(50_000) } };

    const seq = store.append({
      type: 'agent.activity_changed',
      timestamp: new Date().toISOString(),
      payload: largePayload,
    } as any);

    const rows = db.prepare('SELECT payload FROM events WHERE sequence = ?').all([seq]) as Array<{ payload: string }>;
    expect(rows).toHaveLength(1);

    const parsed = JSON.parse(rows[0]!.payload);
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(largePayload));
  });

  it('handles unparseable review.status_changed payloads gracefully at append door', () => {
    const store = createEventStore(db as unknown as DbAdapter);

    const event = {
      type: 'review.status_changed',
      timestamp: new Date().toISOString(),
      payload: { some: 'data', status: { issueId: 'PAN-1' } },
    } as any;

    expect(() => {
      store.append(event);
    }).not.toThrow();

    const rows = db.prepare('SELECT payload FROM events WHERE type = ?').all(['review.status_changed']) as Array<{ payload: string }>;
    expect(rows.length).toBeGreaterThan(0);
  });

  it('bounds oversized review.status_changed at appendAsync door (FR-1)', async () => {
    const store = createEventStore(db as unknown as DbAdapter);

    const longNote = 'x'.repeat(1000);
    const largeHistory = Array.from({ length: 30 }, (_, i) => ({
      type: 'review',
      status: i % 2 === 0 ? 'pending' : 'passed',
      timestamp: new Date(1_753_000_000_000 + i * 1000).toISOString(),
      notes: longNote,
    }));

    await store.appendAsync({
      type: 'review.status_changed',
      timestamp: new Date().toISOString(),
      payload: {
        status: {
          history: largeHistory,
          issueId: 'PAN-3261',
          reviewStatus: 'passed',
        },
      },
    } as any);

    const rows = db.prepare('SELECT payload FROM events WHERE type = ?').all(['review.status_changed']) as Array<{ payload: string }>;
    const mostRecent = rows[rows.length - 1]!;

    const parsed = JSON.parse(mostRecent.payload) as {
      status?: { history?: Array<{ notes?: string }> };
    };
    expect(parsed.status?.history).toHaveLength(20);
    for (const entry of parsed.status?.history || []) {
      if (entry.notes) {
        expect(entry.notes.length).toBeLessThanOrEqual(500);
      }
    }
  });

  it('bounds oversized review.status_changed at appendOnce door (FR-1)', () => {
    const store = createEventStore(db as unknown as DbAdapter);

    const longNote = 'x'.repeat(1000);
    const largeHistory = Array.from({ length: 30 }, (_, i) => ({
      type: 'review',
      status: i % 2 === 0 ? 'pending' : 'passed',
      timestamp: new Date(1_753_000_000_000 + i * 1000).toISOString(),
      notes: longNote,
    }));

    const result = store.appendOnce(
      {
        type: 'review.status_changed',
        timestamp: new Date().toISOString(),
        payload: {
          status: {
            history: largeHistory,
            issueId: 'PAN-3262',
            reviewStatus: 'passed',
          },
        },
      } as any,
      'test-idempotency-key-1'
    );

    expect(result.appended).toBe(true);

    const rows = db.prepare('SELECT payload FROM events WHERE type = ?').all(['review.status_changed']) as Array<{ payload: string }>;
    const mostRecent = rows[rows.length - 1]!;

    const parsed = JSON.parse(mostRecent.payload) as {
      status?: { history?: Array<{ notes?: string }> };
    };
    expect(parsed.status?.history).toHaveLength(20);
    for (const entry of parsed.status?.history || []) {
      if (entry.notes) {
        expect(entry.notes.length).toBeLessThanOrEqual(500);
      }
    }

    // Second call with same key should return duplicate
    const result2 = store.appendOnce(
      {
        type: 'review.status_changed',
        timestamp: new Date().toISOString(),
        payload: {
          status: {
            history: largeHistory,
            issueId: 'PAN-3263',
            reviewStatus: 'passed',
          },
        },
      } as any,
      'test-idempotency-key-1'
    );
    expect(result2.duplicate).toBe(true);
  });

  it('preserves raw notes in status_history table while bounding event payload (FR-2)', () => {
    const store = createEventStore(db as unknown as DbAdapter);

    // Create a status update with notes that exceed the truncation limit
    const longNote = 'x'.repeat(600); // Exceeds 500-char limit
    const history = [
      {
        type: 'review',
        status: 'passed',
        timestamp: new Date().toISOString(),
        notes: longNote,
      },
    ];

    // Write a status update
    db.prepare(`
      INSERT INTO status_history (issue_id, type, status, timestamp, notes)
      VALUES (?, ?, ?, ?, ?)
    `).run('PAN-3264', history[0]!.type, history[0]!.status, Date.now(), history[0]!.notes);

    // Append an event with this history
    store.append({
      type: 'review.status_changed',
      timestamp: new Date().toISOString(),
      payload: {
        status: {
          history,
          issueId: 'PAN-3264',
          reviewStatus: 'passed',
        },
      },
    } as any);

    // Verify event payload has truncated notes
    const eventRows = db.prepare('SELECT payload FROM events WHERE type = ?').all(['review.status_changed']) as Array<{ payload: string }>;
    const mostRecent = eventRows[eventRows.length - 1]!;
    const eventParsed = JSON.parse(mostRecent.payload) as {
      status?: { history?: Array<{ notes?: string }> };
    };
    expect(eventParsed.status?.history?.[0]?.notes?.length).toBeLessThanOrEqual(500);

    // Verify status_history table has the full raw notes
    const dbRows = db.prepare('SELECT notes FROM status_history WHERE issue_id = ?').all(['PAN-3264']) as Array<{ notes: string | null }>;
    expect(dbRows[0]?.notes?.length).toBe(600);
  });

  it('handles malformed stored JSON gracefully through trimReviewStatusHistoryPayloads', () => {
    const store = createEventStore(db as unknown as DbAdapter);

    // Insert a review.status_changed event with invalid JSON payload
    const invalidJson = '{"status": {"history": [{"notes": "x'.repeat(100) + '}'; // Malformed JSON
    db.prepare('INSERT INTO events (type, timestamp, payload) VALUES (?, ?, ?)').run(
      'review.status_changed',
      Date.now(),
      invalidJson
    );

    // trimReviewStatusHistoryPayloads should handle this gracefully
    const result = trimReviewStatusHistoryPayloads(db as unknown as DbAdapter);

    // Should not error; malformed events are skipped
    expect(result.trimmed).toBeGreaterThanOrEqual(0);

    // The malformed row should remain in the database unchanged
    const rows = db.prepare('SELECT payload FROM events WHERE type = ?').all(['review.status_changed']) as Array<{ payload: string }>;
    expect(rows.length).toBeGreaterThan(0);
    // The malformed payload should still be there
    expect(rows.some((r) => r.payload === invalidJson)).toBe(true);
  });

  it('appendAsync bounding produces subscriber-visible bounded payload', async () => {
    const store = createEventStore(db as unknown as DbAdapter);

    const longNote = 'x'.repeat(1000);
    const largeHistory = Array.from({ length: 40 }, (_, i) => ({
      type: 'review',
      status: i % 2 === 0 ? 'pending' : 'passed',
      timestamp: new Date(1_753_000_000_000 + i * 1000).toISOString(),
      notes: longNote,
    }));

    // Track subscriber notifications
    const notifications: Array<any> = [];
    store.events$.subscribe((evt) => notifications.push(evt));

    // Append via async path
    await store.appendAsync({
      type: 'review.status_changed',
      timestamp: new Date().toISOString(),
      payload: {
        status: {
          history: largeHistory,
          issueId: 'PAN-3265',
          reviewStatus: 'passed',
        },
      },
    } as any);

    // Find the event in subscriber notifications
    const boundedEvent = notifications.find((e) => e.payload?.status?.issueId === 'PAN-3265');
    expect(boundedEvent).toBeDefined();

    // Verify bounded in subscriber
    expect(boundedEvent?.payload?.status?.history).toHaveLength(20);
    for (const entry of boundedEvent?.payload?.status?.history || []) {
      if (entry.notes) {
        expect(entry.notes.length).toBeLessThanOrEqual(500);
      }
    }

    // Verify bounded in persisted data
    const persisted = db.prepare('SELECT payload FROM events WHERE type = ?').all(['review.status_changed']) as Array<{ payload: string }>;
    const parsed = JSON.parse(persisted[persisted.length - 1]!.payload) as { status?: { history?: any[] } };
    expect(parsed.status?.history).toHaveLength(20);
  });
});
