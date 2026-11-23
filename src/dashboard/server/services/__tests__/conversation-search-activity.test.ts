import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConversationSearchActivitySnapshot } from '@overdeck/contracts';
import { createConversationSearchActivityTracker, toLegacyReindexProgress } from '../conversation-search-activity.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createConversationSearchActivityTracker (PAN-5609 WI-2)', () => {
  it('emits at once for beginBatch, then throttles rapid progress to one trailing emit with the latest counts', () => {
    const emit = vi.fn();
    const tracker = createConversationSearchActivityTracker({ emit });
    const handle = tracker.beginBatch('startup');
    expect(emit).toHaveBeenCalledTimes(1);

    for (let i = 1; i <= 10; i++) {
      vi.advanceTimersByTime(40)
      handle.progress({ filesScanned: i, filesIndexed: i, chunksIndexed: i * 2 })
    }
    expect(emit).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(100)
    expect(emit).toHaveBeenCalledTimes(2)
    expect(emit).toHaveBeenLastCalledWith(
      expect.objectContaining({ active: true, kind: 'startup', filesScanned: 10, filesIndexed: 10, chunksIndexed: 20 }),
    )
  })

  it('a trailing emit after end() carries active:false and endedAt set', () => {
    const emit = vi.fn()
    const tracker = createConversationSearchActivityTracker({ emit })
    const handle = tracker.beginBatch('full-reindex')
    vi.advanceTimersByTime(10)
    handle.progress({ filesScanned: 5, filesIndexed: 2, chunksIndexed: 9 })
    vi.advanceTimersByTime(10)
    handle.end()
    expect(emit).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(500)
    expect(emit).toHaveBeenCalledTimes(2)
    const snapshot = emit.mock.calls[1]![0] as ConversationSearchActivitySnapshot
    expect(snapshot.active).toBe(false)
    expect(snapshot.endedAt).not.toBeNull()
    expect(snapshot.filesIndexed).toBe(2)
  })

  it('a stale handle is a no-op', () => {
    const tracker = createConversationSearchActivityTracker({ emit: vi.fn() })
    const first = tracker.beginBatch('startup')
    tracker.beginBatch('catch-up')
    first.progress({ filesScanned: 9, filesIndexed: 9, chunksIndexed: 9 })
    first.end()

    const snapshot = tracker.getSnapshot()
    expect(snapshot.kind).toBe('catch-up')
    expect(snapshot.active).toBe(true)
    expect(snapshot.filesIndexed).toBe(0)
  })

  it('tracks an incremental burst and ends it when the queue drains', () => {
    const tracker = createConversationSearchActivityTracker({ emit: vi.fn() })
    tracker.setQueue(1, 0)
    let snapshot = tracker.getSnapshot()
    expect(snapshot.active).toBe(true)
    expect(snapshot.kind).toBe('incremental')

    tracker.setQueue(0, 1, '/x/a.jsonl')
    snapshot = tracker.getSnapshot()
    expect(snapshot.currentFile).toBe('a.jsonl')
    expect(snapshot.filesScanned).toBe(snapshot.filesIndexed + snapshot.queued + snapshot.inFlight)

    tracker.recordIncrementalFile(4)
    tracker.setQueue(0, 0)
    snapshot = tracker.getSnapshot()
    expect(snapshot).toMatchObject({ active: false, kind: 'incremental', filesIndexed: 1, chunksIndexed: 4, currentFile: null })
  })

  it('shows queue counts during a batch without changing its kind', () => {
    const tracker = createConversationSearchActivityTracker({ emit: vi.fn() })
    tracker.beginBatch('full-reindex')
    tracker.setQueue(3, 2)
    const snapshot = tracker.getSnapshot()
    expect(snapshot.kind).toBe('full-reindex')
    expect(snapshot.queued).toBe(3)
    expect(snapshot.inFlight).toBe(2)
  })

  it('a batch ending with a nonempty queue starts a burst at the end time, not the batch start time', () => {
    const tracker = createConversationSearchActivityTracker({ emit: vi.fn() })
    const handle = tracker.beginBatch('catch-up')
    vi.advanceTimersByTime(1000)
    tracker.setQueue(2, 0)
    const batchStartedAt = tracker.getSnapshot().startedAt

    vi.advanceTimersByTime(500)
    handle.end()
    const snapshot = tracker.getSnapshot()
    expect(snapshot.active).toBe(true)
    expect(snapshot.kind).toBe('incremental')
    expect(snapshot.startedAt).not.toBe(batchStartedAt)
  })
})

describe('toLegacyReindexProgress (PAN-5609 D-6)', () => {
  it('maps a full-reindex snapshot to the legacy shape', () => {
    const snapshot: ConversationSearchActivitySnapshot = {
      active: true,
      kind: 'full-reindex',
      filesScanned: 10,
      filesIndexed: 4,
      chunksIndexed: 12,
      currentFile: 'x.jsonl',
      queued: 0,
      inFlight: 0,
      startedAt: '2026-11-15T20:00:00.000Z',
      endedAt: null,
      lastError: null,
      lastErrorAt: null,
    }
    expect(toLegacyReindexProgress(snapshot)).toEqual({
      active: true,
      filesScanned: 10,
      filesIndexed: 4,
      chunksIndexed: 12,
      currentFile: 'x.jsonl',
      startedAt: Date.parse('2026-11-15T20:00:00.000Z'),
    })
  })

  it('omits a null currentFile and startedAt', () => {
    const snapshot: ConversationSearchActivitySnapshot = {
      active: false,
      kind: 'full-reindex',
      filesScanned: 0,
      filesIndexed: 0,
      chunksIndexed: 0,
      currentFile: null,
      queued: 0,
      inFlight: 0,
      startedAt: null,
      endedAt: null,
      lastError: null,
      lastErrorAt: null,
    }
    expect(toLegacyReindexProgress(snapshot)).toEqual({ active: false, filesScanned: 0, filesIndexed: 0, chunksIndexed: 0 })
  })

  it('maps any other kind to the zero shape', () => {
    const snapshot: ConversationSearchActivitySnapshot = {
      active: true,
      kind: 'incremental',
      filesScanned: 5,
      filesIndexed: 2,
      chunksIndexed: 3,
      currentFile: 'y.jsonl',
      queued: 1,
      inFlight: 1,
      startedAt: '2026-11-15T20:00:00.000Z',
      endedAt: null,
      lastError: null,
      lastErrorAt: null,
    }
    expect(toLegacyReindexProgress(snapshot)).toEqual({ active: false, filesScanned: 0, filesIndexed: 0, chunksIndexed: 0 })
  })
})
