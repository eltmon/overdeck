/**
 * Unit tests for the EventStore (PAN-434)
 *
 * Uses an in-memory SQLite adapter database so tests are fast, isolated,
 * and do not touch the filesystem.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase, type SqliteDatabase } from '../../src/lib/database/driver.js'
import { createEventStore, DbAdapter } from '../../src/dashboard/server/event-store.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDb(): DbAdapter {
  const db = openDatabase(':memory:')
  db.exec(`
    CREATE TABLE events (
      sequence  INTEGER PRIMARY KEY AUTOINCREMENT,
      type      TEXT    NOT NULL,
      timestamp INTEGER NOT NULL,
      payload   TEXT    NOT NULL DEFAULT '{}'
    )
  `)
  db.exec(`CREATE INDEX events_timestamp_idx ON events (timestamp)`)
  // PAN-3092: the at-most-once claim table.
  db.exec(`
    CREATE TABLE event_idempotency (
      key        TEXT    PRIMARY KEY,
      sequence   INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
  return db as unknown as DbAdapter
}

function ts(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString()
}

// ─── append ──────────────────────────────────────────────────────────────────

describe('EventStore.append', () => {
  let store: ReturnType<typeof createEventStore>

  beforeEach(() => {
    store = createEventStore(makeDb())
  })

  it('returns sequence number starting at 1', () => {
    const seq = store.append({ type: 'agent.started', timestamp: ts(), payload: { agentId: 'a1' } } as any)
    expect(seq).toBe(1)
  })

  it('increments sequence for each appended event', () => {
    const s1 = store.append({ type: 'agent.started', timestamp: ts(), payload: {} } as any)
    const s2 = store.append({ type: 'agent.stopped', timestamp: ts(), payload: {} } as any)
    const s3 = store.append({ type: 'resources.updated', timestamp: ts(), payload: {} } as any)
    expect(s1).toBe(1)
    expect(s2).toBe(2)
    expect(s3).toBe(3)
  })

  it('emits event to subscribers', () => {
    const received: any[] = []
    store.subscribe((e) => received.push(e))

    store.append({ type: 'agent.started', timestamp: ts(), payload: { agentId: 'a1' } } as any)

    expect(received).toHaveLength(1)
    expect(received[0].type).toBe('agent.started')
    expect(received[0].sequence).toBe(1)
  })

  it('emits to multiple subscribers', () => {
    const r1: any[] = []
    const r2: any[] = []
    store.subscribe((e) => r1.push(e))
    store.subscribe((e) => r2.push(e))

    store.append({ type: 'agent.started', timestamp: ts(), payload: {} } as any)

    expect(r1).toHaveLength(1)
    expect(r2).toHaveLength(1)
  })

  it('preserves payload through round-trip', () => {
    const payload = { agentId: 'agent-42', issueId: 'PAN-100', status: 'running' }
    const received: any[] = []
    store.subscribe((e) => received.push(e))

    store.append({ type: 'agent.status_changed', timestamp: ts(), payload } as any)

    expect(received[0].payload).toEqual(payload)
  })
})

// ─── readFrom ────────────────────────────────────────────────────────────────

describe('EventStore.readFrom', () => {
  let store: ReturnType<typeof createEventStore>

  beforeEach(() => {
    store = createEventStore(makeDb())
    store.append({ type: 'agent.started', timestamp: ts(), payload: { seq: 1 } } as any)
    store.append({ type: 'agent.started', timestamp: ts(), payload: { seq: 2 } } as any)
    store.append({ type: 'agent.started', timestamp: ts(), payload: { seq: 3 } } as any)
  })

  it('returns all events from sequence 0', () => {
    const events = store.readFrom(0)
    expect(events).toHaveLength(3)
  })

  it('returns events after fromSequence (exclusive)', () => {
    const events = store.readFrom(1)
    expect(events).toHaveLength(2)
    expect(events[0].sequence).toBe(2)
    expect(events[1].sequence).toBe(3)
  })

  it('returns empty array when fromSequence is at latest', () => {
    const events = store.readFrom(3)
    expect(events).toHaveLength(0)
  })

  it('returns events in ascending sequence order', () => {
    const events = store.readFrom(0)
    const seqs = events.map((e) => e.sequence)
    expect(seqs).toEqual([1, 2, 3])
  })

  it('deserializes payload from JSON', () => {
    const events = store.readFrom(0)
    expect((events[0].payload as any).seq).toBe(1)
    expect((events[1].payload as any).seq).toBe(2)
  })
})

// ─── queryLatestPerIssue ─────────────────────────────────────────────────────

describe('EventStore.queryLatestPerIssue', () => {
  it('returns the latest event for each payload issue ID', () => {
    const store = createEventStore(makeDb())
    store.append({
      type: 'review.status_changed',
      timestamp: ts(),
      payload: { issueId: 'PAN-1', status: { updatedAt: '2026-07-22T20:00:00.000Z' } },
    } as any)
    store.append({
      type: 'review.status_changed',
      timestamp: ts(1),
      payload: { issueId: 'PAN-2', status: { updatedAt: '2026-07-22T20:01:00.000Z' } },
    } as any)
    store.append({
      type: 'review.status_changed',
      timestamp: ts(2),
      payload: { issueId: 'PAN-1', status: { updatedAt: '2026-07-22T20:02:00.000Z' } },
    } as any)
    store.append({
      type: 'agent.started',
      timestamp: ts(3),
      payload: { issueId: 'PAN-1' },
    } as any)

    const latest = store.queryLatestPerIssue('review.status_changed')
    const byIssue = new Map(latest.map((event) => [
      (event.payload as { issueId: string }).issueId,
      event,
    ]))

    expect(latest).toHaveLength(2)
    expect(byIssue.get('PAN-1')?.sequence).toBe(3)
    expect(byIssue.get('PAN-2')?.sequence).toBe(2)
  })
})

// ─── subscribe / unsubscribe ─────────────────────────────────────────────────

describe('EventStore.subscribe', () => {
  let store: ReturnType<typeof createEventStore>

  beforeEach(() => {
    store = createEventStore(makeDb())
  })

  it('returns unsubscribe function that stops delivery', () => {
    const received: any[] = []
    const unsub = store.subscribe((e) => received.push(e))

    store.append({ type: 'agent.started', timestamp: ts(), payload: {} } as any)
    expect(received).toHaveLength(1)

    unsub()
    store.append({ type: 'agent.stopped', timestamp: ts(), payload: {} } as any)
    expect(received).toHaveLength(1) // No new events after unsub
  })

  it('unsubscribing one subscriber does not affect others', () => {
    const r1: any[] = []
    const r2: any[] = []
    const unsub1 = store.subscribe((e) => r1.push(e))
    store.subscribe((e) => r2.push(e))

    store.append({ type: 'agent.started', timestamp: ts(), payload: {} } as any)
    unsub1()
    store.append({ type: 'agent.stopped', timestamp: ts(), payload: {} } as any)

    expect(r1).toHaveLength(1)
    expect(r2).toHaveLength(2)
  })
})

// ─── getLatestSequence ───────────────────────────────────────────────────────

describe('EventStore.getLatestSequence', () => {
  it('returns 0 on empty store', () => {
    const store = createEventStore(makeDb())
    expect(store.getLatestSequence()).toBe(0)
  })

  it('returns highest sequence after appends', () => {
    const store = createEventStore(makeDb())
    store.append({ type: 'agent.started', timestamp: ts(), payload: {} } as any)
    store.append({ type: 'agent.stopped', timestamp: ts(), payload: {} } as any)
    store.append({ type: 'resources.updated', timestamp: ts(), payload: {} } as any)
    expect(store.getLatestSequence()).toBe(3)
  })
})

// ─── compact ─────────────────────────────────────────────────────────────────

describe('EventStore.compact', () => {
  it('removes events older than 7 days', () => {
    const store = createEventStore(makeDb())
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    const recent = new Date().toISOString()

    store.append({ type: 'agent.started', timestamp: eightDaysAgo, payload: {} } as any)
    store.append({ type: 'agent.started', timestamp: eightDaysAgo, payload: {} } as any)
    store.append({ type: 'agent.started', timestamp: recent, payload: {} } as any)

    store.compact()

    const remaining = store.readFrom(0)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].timestamp).toBe(recent)
  })

  it('keeps all events when none are older than 7 days', () => {
    const store = createEventStore(makeDb())
    store.append({ type: 'agent.started', timestamp: ts(), payload: {} } as any)
    store.append({ type: 'agent.stopped', timestamp: ts(), payload: {} } as any)

    store.compact()

    expect(store.readFrom(0)).toHaveLength(2)
  })
})

// ─── JSON-normalized payload distribution (PAN-2225) ─────────────────────────
// The write door must distribute the same JSON round-tripped payload it
// persists. An explicitly-undefined key (e.g. `details: undefined` from an
// activity emitter) survives in a raw in-memory object but is dropped by
// JSON.stringify — the divergence poisons RpcSerialization.layerJson encode
// of getSnapshot/subscribeDomainEvents ("Reconnecting to the dashboard…").

describe('EventStore payload normalization (PAN-2225)', () => {
  let store: ReturnType<typeof createEventStore>

  beforeEach(() => {
    store = createEventStore(makeDb())
  })

  it('append distributes payload identical to the persisted round-trip', () => {
    const received: any[] = []
    store.subscribe((e) => received.push(e))

    store.append({
      type: 'activity.entry',
      timestamp: ts(),
      payload: { id: 'e1', message: 'verification passed', details: undefined, link: undefined },
    } as any)

    expect(received).toHaveLength(1)
    expect('details' in received[0].payload).toBe(false)
    expect('link' in received[0].payload).toBe(false)
    expect(received[0].payload).toEqual(store.readFrom(0)[0].payload)
  })

  it('appendAsync distributes payload identical to the persisted round-trip', async () => {
    const received: any[] = []
    store.subscribe((e) => received.push(e))

    await store.appendAsync({
      type: 'activity.entry',
      timestamp: ts(),
      payload: { id: 'e2', message: 'review passed', details: undefined },
    } as any)

    expect(received).toHaveLength(1)
    expect('details' in received[0].payload).toBe(false)
    expect(received[0].payload).toEqual(store.readFrom(0)[0].payload)
  })

  it('emitOnly distributes a JSON-normalized payload', () => {
    const received: any[] = []
    store.subscribe((e) => received.push(e))

    store.emitOnly({
      type: 'activity.entry',
      timestamp: ts(),
      payload: { id: 'e3', message: 'in-memory only', details: undefined },
    } as any)

    expect(received).toHaveLength(1)
    expect('details' in received[0].payload).toBe(false)
    expect(received[0].payload).toEqual({ id: 'e3', message: 'in-memory only' })
  })
})

// ─── appendOnce (PAN-3092) ───────────────────────────────────────────────────

/**
 * The at-most-once primitive behind FR-4's one-warning-per-episode rule. A
 * check-then-append pair cannot provide this: two callers can both observe
 * absence, and a caller cannot tell a committed write from a failed one.
 */
describe('EventStore.appendOnce (PAN-3092)', () => {
  let store: ReturnType<typeof createEventStore>

  const warning = (message: string) => ({
    type: 'activity.entry',
    timestamp: ts(),
    payload: { id: 'verdict-fallback:PAN-3092:gen-1', message },
  }) as Parameters<ReturnType<typeof createEventStore>['appendOnce']>[0]

  beforeEach(() => {
    store = createEventStore(makeDb())
  })

  it('appends once and reports every later call for the same key as a duplicate', () => {
    const first = store.appendOnce(warning('contended'), 'episode-1')
    const second = store.appendOnce(warning('contended'), 'episode-1')
    const third = store.appendOnce(warning('contended'), 'episode-1')

    expect(first.outcome).toBe('appended')
    expect(first.sequence).toBeGreaterThan(0)
    expect(second).toEqual({ outcome: 'duplicate', sequence: first.sequence })
    expect(third).toEqual({ outcome: 'duplicate', sequence: first.sequence })

    // ONE durable event, not three — the whole point.
    expect(store.queryByType('activity.entry', 10)).toHaveLength(1)
  })

  it('publishes to subscribers only for the append, never for a duplicate', () => {
    const seen: number[] = []
    store.subscribe((event) => { seen.push(event.sequence) })

    store.appendOnce(warning('contended'), 'episode-1')
    store.appendOnce(warning('contended'), 'episode-1')

    // A duplicate that re-published would be a second operator warning.
    expect(seen).toHaveLength(1)
  })

  it('keeps distinct keys independent', () => {
    expect(store.appendOnce(warning('a'), 'episode-1').outcome).toBe('appended')
    expect(store.appendOnce(warning('b'), 'episode-2').outcome).toBe('appended')
    expect(store.queryByType('activity.entry', 10)).toHaveLength(2)
  })

  it('throws instead of reporting success when the transaction cannot commit', () => {
    // A caller must be able to distinguish "durably appended" from "not
    // written": appendAsync resolves with sequence 0 on a failed batch, which
    // is exactly the false-success this replaces.
    const broken = makeDb()
    const brokenStore = createEventStore(broken)
    // Break it after construction — statements are prepared eagerly.
    broken.exec('DROP TABLE event_idempotency')

    expect(() => brokenStore.appendOnce(warning('contended'), 'episode-1')).toThrow()
    // And the failed attempt left no event behind.
    expect(brokenStore.queryByType('activity.entry', 10)).toHaveLength(0)
  })

  it('leaves no half-written state when the event insert fails inside the claim', () => {
    const broken = makeDb()
    const brokenStore = createEventStore(broken)
    broken.exec('DROP TABLE events')

    expect(() => brokenStore.appendOnce(warning('contended'), 'episode-1')).toThrow()

    // The claim was rolled back with the insert, so a later healthy retry for
    // the same key still appends rather than being wrongly seen as a duplicate.
    const rows = (broken as unknown as SqliteDatabase)
      .prepare('SELECT COUNT(*) AS n FROM event_idempotency').all() as Array<{ n: number }>
    expect(rows[0]!.n).toBe(0)
  })
})
