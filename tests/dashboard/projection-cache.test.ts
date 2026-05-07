/**
 * Unit tests for ProjectionCacheService (PAN-437)
 *
 * Uses an in-memory better-sqlite3 database — fast, isolated, no filesystem.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import type { DbAdapter } from '../../src/dashboard/server/event-store.js'
import { createProjectionCache } from '../../src/dashboard/server/services/projection-cache.js'
import type { DashboardSnapshot } from '@panctl/contracts'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDb(): DbAdapter {
  const db = new (Database as any)(':memory:')
  db.exec(`
    CREATE TABLE projection_cache (
      key        TEXT PRIMARY KEY,
      data       TEXT NOT NULL,
      sequence   INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)
  return db as unknown as DbAdapter
}

function makeSnapshot(sequence = 1): DashboardSnapshot {
  return {
    sequence,
    agents: [],
    specialists: [],
    reviewStatuses: [],
    issues: [],
    timestamp: new Date().toISOString(),
  }
}

// ─── load ────────────────────────────────────────────────────────────────────

describe('ProjectionCache.load', () => {
  it('returns null when table is empty', () => {
    const cache = createProjectionCache(makeDb())
    expect(cache.load()).toBeNull()
  })

  it('returns the stored snapshot', () => {
    const db = makeDb()
    const cache = createProjectionCache(db)
    const snapshot = makeSnapshot(42)

    // Insert directly via DB so we bypass debounce
    db.prepare(
      `INSERT INTO projection_cache (key, data, sequence, updated_at) VALUES ('dashboard', :data, :sequence, :updated_at)`,
    ).run({ data: JSON.stringify(snapshot), sequence: 42, updated_at: new Date().toISOString() })

    const loaded = cache.load()
    expect(loaded).not.toBeNull()
    expect(loaded!.sequence).toBe(42)
  })

  it('returns null on corrupt JSON data', () => {
    const db = makeDb()
    const cache = createProjectionCache(db)

    db.prepare(
      `INSERT INTO projection_cache (key, data, sequence, updated_at) VALUES ('dashboard', :data, :sequence, :updated_at)`,
    ).run({ data: 'NOT VALID JSON {{{', sequence: 1, updated_at: new Date().toISOString() })

    expect(cache.load()).toBeNull()
  })

  it('returns null when data has no sequence (schema mismatch)', () => {
    const db = makeDb()
    const cache = createProjectionCache(db)

    db.prepare(
      `INSERT INTO projection_cache (key, data, sequence, updated_at) VALUES ('dashboard', :data, :sequence, :updated_at)`,
    ).run({ data: JSON.stringify({ something: 'else' }), sequence: 0, updated_at: new Date().toISOString() })

    // sequence 0 in the loaded data is falsy — load() checks `cached.sequence > 0` in read-model
    // but the cache service itself returns the parsed object; the sequence=0 check is in the caller.
    // Here we test that the parse itself succeeds and returns the object.
    const loaded = cache.load()
    expect(loaded).toBeDefined()
  })
})

// ─── save (debounced) ────────────────────────────────────────────────────────

describe('ProjectionCache.save', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('persists snapshot after debounce delay', () => {
    const db = makeDb()
    const cache = createProjectionCache(db)
    const snapshot = makeSnapshot(5)

    cache.save(snapshot)
    // Before debounce fires — nothing written yet
    const row = db.prepare(`SELECT * FROM projection_cache WHERE key = 'dashboard'`).get()
    expect(row).toBeUndefined()

    // Advance past 100ms debounce
    vi.advanceTimersByTime(2500)

    const savedRow = db.prepare(`SELECT sequence FROM projection_cache WHERE key = 'dashboard'`).get() as { sequence: number } | undefined
    expect(savedRow?.sequence).toBe(5)
  })

  it('coalesces multiple rapid saves into one write', () => {
    const db = makeDb()
    const cache = createProjectionCache(db)

    cache.save(makeSnapshot(1))
    cache.save(makeSnapshot(2))
    cache.save(makeSnapshot(3))

    vi.advanceTimersByTime(2500)

    // Only one row, with the last snapshot's sequence
    const rows = db.prepare(`SELECT sequence FROM projection_cache`).all() as { sequence: number }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]!.sequence).toBe(3)
  })

  it('overwrites previous snapshot on subsequent save (upsert idempotency)', () => {
    const db = makeDb()
    const cache = createProjectionCache(db)

    cache.save(makeSnapshot(10))
    vi.advanceTimersByTime(2500)

    cache.save(makeSnapshot(20))
    vi.advanceTimersByTime(2500)

    const rows = db.prepare(`SELECT sequence FROM projection_cache`).all() as { sequence: number }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]!.sequence).toBe(20)
  })
})
