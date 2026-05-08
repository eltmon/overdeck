/**
 * Unit tests for the localStorage snapshot cache (PAN-437)
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { saveSnapshotToCache, loadSnapshotFromCache, clearSnapshotCache } from '../snapshotCache'
import type { DashboardSnapshot } from '@panctl/contracts'

function makeSnapshot(sequence = 1, issueCount = 0): DashboardSnapshot {
  return {
    sequence,
    agents: [],
    specialists: [],
    reviewStatuses: [],
    issues: Array.from({ length: issueCount }, (_, i) => ({ id: `issue-${i}` })),
    timestamp: new Date().toISOString(),
  }
}

beforeEach(() => {
  clearSnapshotCache()
})

// ─── load ─────────────────────────────────────────────────────────────────────

describe('loadSnapshotFromCache', () => {
  it('returns null when nothing is cached', () => {
    expect(loadSnapshotFromCache()).toBeNull()
  })

  it('returns the saved snapshot', () => {
    const snapshot = makeSnapshot(7)
    saveSnapshotToCache(snapshot)
    const loaded = loadSnapshotFromCache()
    expect(loaded).not.toBeNull()
    expect(loaded!.sequence).toBe(7)
  })

  it('returns null for corrupt JSON', () => {
    localStorage.setItem('pan-snapshot-cache-v1', 'INVALID JSON {{{')
    expect(loadSnapshotFromCache()).toBeNull()
  })

  it('returns null when cached entry has no sequence field', () => {
    localStorage.setItem('pan-snapshot-cache-v1', JSON.stringify({ data: { foo: 'bar' }, timestamp: new Date().toISOString() }))
    expect(loadSnapshotFromCache()).toBeNull()
  })

  it('ignores entries stored under a different (old) version key', () => {
    localStorage.setItem('pan-snapshot-cache-v0', JSON.stringify({ data: makeSnapshot(99), timestamp: new Date().toISOString() }))
    expect(loadSnapshotFromCache()).toBeNull()
  })
})

// ─── save ─────────────────────────────────────────────────────────────────────

describe('saveSnapshotToCache', () => {
  it('persists and retrieves a snapshot round-trip', () => {
    const snapshot = makeSnapshot(42)
    saveSnapshotToCache(snapshot)
    const loaded = loadSnapshotFromCache()
    expect(loaded!.sequence).toBe(42)
    expect(loaded!.agents).toEqual([])
  })

  it('strips issues when localStorage throws QuotaExceededError', () => {
    const originalSetItem = Storage.prototype.setItem
    let calls = 0
    Storage.prototype.setItem = function (key: string, value: string) {
      calls++
      if (calls === 1) {
        const err = new DOMException('Quota exceeded', 'QuotaExceededError')
        throw err
      }
      return originalSetItem.call(this, key, value)
    }

    try {
      const bigSnapshot = makeSnapshot(1, 120_000)
      saveSnapshotToCache(bigSnapshot)

      const loaded = loadSnapshotFromCache()
      expect(loaded).not.toBeNull()
      // Issues should be stripped to empty array after QuotaExceededError fallback
      expect(loaded!.issues).toEqual([])
      expect(calls).toBe(2)
    } finally {
      Storage.prototype.setItem = originalSetItem
    }
  })

  it('preserves full snapshot when it fits within localStorage quota', () => {
    // 120,000 issue entries ≈ 2.5MB serialized — well under the 8MB cap
    const bigSnapshot = makeSnapshot(1, 120_000)
    saveSnapshotToCache(bigSnapshot)

    const loaded = loadSnapshotFromCache()
    expect(loaded).not.toBeNull()
    expect(loaded!.issues.length).toBe(120_000)
  })

  it('overwrites a previous entry on re-save', () => {
    saveSnapshotToCache(makeSnapshot(1))
    saveSnapshotToCache(makeSnapshot(2))
    expect(loadSnapshotFromCache()!.sequence).toBe(2)
  })
})

// ─── clear ────────────────────────────────────────────────────────────────────

describe('clearSnapshotCache', () => {
  it('removes the cached entry', () => {
    saveSnapshotToCache(makeSnapshot(5))
    clearSnapshotCache()
    expect(loadSnapshotFromCache()).toBeNull()
  })
})
