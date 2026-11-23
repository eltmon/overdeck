/** PAN-5609 WI-5: the indexing indicator's visibility state machine (D-7/D-8/D-10). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationSearchActivitySnapshot } from '@overdeck/contracts'
import {
  chipText,
  createIndicatorVisibility,
  formatIndexingElapsed,
  HIDE_LINGER_MS,
  INCREMENTAL_SHOW_DELAY_MS,
  kindLabel,
} from './indicatorVisibility'

function snapshot(overrides: Partial<ConversationSearchActivitySnapshot> = {}): ConversationSearchActivitySnapshot {
  return {
    active: true,
    kind: 'incremental',
    filesScanned: 0,
    filesIndexed: 0,
    chunksIndexed: 0,
    currentFile: null,
    queued: 0,
    inFlight: 0,
    startedAt: '2026-11-15T20:00:00.000Z',
    endedAt: null,
    lastError: null,
    lastErrorAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  // Anchored to the default snapshot()'s startedAt so endedAt fixtures expressed
  // as offsets from it (including ones before "now", for resubscribe tests)
  // produce deterministic Date.now()-based elapsed calculations.
  vi.useFakeTimers({ now: new Date('2026-11-15T20:00:00.000Z') })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createIndicatorVisibility (D-7)', () => {
  it('shows a startup active snapshot immediately', () => {
    const visibility = createIndicatorVisibility()
    visibility.update(snapshot({ kind: 'startup' }))
    expect(visibility.getView().visible).toBe(true)
  })

  it('never shows an incremental run that ends after 2.9s', () => {
    const visibility = createIndicatorVisibility()
    visibility.update(snapshot({ kind: 'incremental' }))
    vi.advanceTimersByTime(2_900)
    expect(visibility.getView().visible).toBe(false)

    visibility.update(snapshot({ kind: 'incremental', active: false, endedAt: '2026-11-15T20:00:03.000Z' }))
    vi.advanceTimersByTime(1_000)
    expect(visibility.getView().visible).toBe(false)
  })

  it('shows an incremental run active for the full 3s at 3000ms, not at 2999ms', () => {
    const visibility = createIndicatorVisibility()
    visibility.update(snapshot({ kind: 'incremental' }))
    vi.advanceTimersByTime(INCREMENTAL_SHOW_DELAY_MS - 1)
    expect(visibility.getView().visible).toBe(false)
    vi.advanceTimersByTime(1)
    expect(visibility.getView().visible).toBe(true)
  })

  it('follows the incremental 3s rule for a catch-up run', () => {
    const visibility = createIndicatorVisibility()
    visibility.update(snapshot({ kind: 'catch-up' }))
    vi.advanceTimersByTime(INCREMENTAL_SHOW_DELAY_MS - 1)
    expect(visibility.getView().visible).toBe(false)
    vi.advanceTimersByTime(1)
    expect(visibility.getView().visible).toBe(true)
  })

  it('stays visible for 2000ms after the run ends, then hides; a new active snapshot inside the linger keeps it visible', () => {
    const visibility = createIndicatorVisibility()
    visibility.update(snapshot({ kind: 'startup' }))
    expect(visibility.getView().visible).toBe(true)

    const ended = snapshot({ kind: 'startup', active: false, endedAt: '2026-11-15T20:00:01.000Z' })
    visibility.update(ended)
    expect(visibility.getView().visible).toBe(true)

    vi.advanceTimersByTime(HIDE_LINGER_MS - 1)
    expect(visibility.getView().visible).toBe(true)
    vi.advanceTimersByTime(1)
    expect(visibility.getView().visible).toBe(false)
  })

  it('keeps the indicator visible when a new run starts inside the hide linger', () => {
    const visibility = createIndicatorVisibility()
    visibility.update(snapshot({ kind: 'startup' }))
    visibility.update(snapshot({ kind: 'startup', active: false, endedAt: '2026-11-15T20:00:01.000Z' }))
    vi.advanceTimersByTime(HIDE_LINGER_MS - 500)

    visibility.update(snapshot({ kind: 'catch-up' }))
    vi.advanceTimersByTime(600)
    expect(visibility.getView().visible).toBe(true)
  })

  it('does not hide on a kind change from startup to incremental while visible', () => {
    const visibility = createIndicatorVisibility()
    visibility.update(snapshot({ kind: 'startup' }))
    visibility.update(snapshot({ kind: 'incremental' }))
    expect(visibility.getView().visible).toBe(true)
    vi.advanceTimersByTime(INCREMENTAL_SHOW_DELAY_MS)
    expect(visibility.getView().visible).toBe(true)
  })

  it('restarts the 3s show gate when a hidden run is replaced by a different one (CodeRabbit)', () => {
    const visibility = createIndicatorVisibility()
    // A catch-up run starts hidden; 1s later it's replaced by a fresh incremental
    // run (no terminal snapshot in between — the tracker's burst takes over directly).
    visibility.update(snapshot({ kind: 'catch-up', startedAt: '2026-11-15T20:00:00.000Z' }))
    vi.advanceTimersByTime(1_000)
    visibility.update(snapshot({ kind: 'incremental', startedAt: '2026-11-15T20:00:01.000Z' }))

    // The old timer's deadline (3000ms after the catch-up run started, i.e. at
    // t=3000) must NOT reveal the chip: the incremental run's own 3s gate runs
    // from its own start (t=1000) to t=4000.
    vi.advanceTimersByTime(INCREMENTAL_SHOW_DELAY_MS - 1)
    expect(visibility.getView().visible).toBe(false)
    vi.advanceTimersByTime(1)
    expect(visibility.getView().visible).toBe(true)
  })

  it('skips an already-expired linger on resubscribe (CodeRabbit)', () => {
    const visibility = createIndicatorVisibility()
    visibility.update(snapshot({ kind: 'startup' }))
    expect(visibility.getView().visible).toBe(true)

    // The run ended 5s ago (longer than the 2s linger) but this is the first
    // update the instance has seen since — as if every subscriber unmounted
    // while active and only resubscribed well after the run finished.
    visibility.update(snapshot({ kind: 'startup', active: false, endedAt: '2026-11-15T19:59:55.000Z' }))
    expect(visibility.getView().visible).toBe(false)
  })

  it('shows only the unelapsed linger on resubscribe for a run that ended recently (CodeRabbit)', () => {
    const visibility = createIndicatorVisibility()
    visibility.update(snapshot({ kind: 'startup' }))
    // Ended 500ms before "now" — only 1500ms of the 2000ms linger remains.
    visibility.update(snapshot({ kind: 'startup', active: false, endedAt: '2026-11-15T19:59:59.500Z' }))

    vi.advanceTimersByTime(1_499)
    expect(visibility.getView().visible).toBe(true)
    vi.advanceTimersByTime(1)
    expect(visibility.getView().visible).toBe(false)
  })

  it('returns the same view object across update calls that change neither visibility nor snapshot', () => {
    const visibility = createIndicatorVisibility()
    const same = snapshot({ kind: 'startup' })
    visibility.update(same)
    const firstView = visibility.getView()
    visibility.update(same)
    expect(visibility.getView()).toBe(firstView)
  })
})

describe('labels and formatting (D-10)', () => {
  it('formats elapsed time under 60s, under 60min, and above', () => {
    expect(formatIndexingElapsed(42_000)).toBe('42s')
    expect(formatIndexingElapsed(185_000)).toBe('3m 05s')
    expect(formatIndexingElapsed(62 * 60_000)).toBe('1h 02m')
  })

  it('formats the chip text with and without a file count', () => {
    expect(chipText(snapshot({ filesIndexed: 1_200, filesScanned: 4_312 }))).toBe('Indexing 1,200/4,312')
    expect(chipText(snapshot({ filesScanned: 0 }))).toBe('Indexing')
    expect(chipText(null)).toBe('Indexing')
  })

  it('labels every kind', () => {
    expect(kindLabel('startup')).toBe('Startup sweep')
    expect(kindLabel('catch-up')).toBe('Catch-up after watcher restart')
    expect(kindLabel('incremental')).toBe('New transcript changes')
    expect(kindLabel('full-reindex')).toBe('Full reindex')
  })
})
