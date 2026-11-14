import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DOCK_DEFAULT_WIDTH, dockStorageKey, useWorkDockStore } from '../workDockStore'

function resetStore(): void {
  useWorkDockStore.setState({ byDeck: {} })
}

function stored(deck: string): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(dockStorageKey(deck)) ?? 'null') as Record<string, unknown>
}

describe('workDockStore', () => {
  beforeEach(() => {
    localStorage.clear()
    resetStore()
  })
  afterEach(() => {
    localStorage.clear()
    resetStore()
  })

  it('starts closed on the files tab at the default width', () => {
    expect(useWorkDockStore.getState().ensureDeck('alpha')).toEqual({ open: false, tab: 'files', width: DOCK_DEFAULT_WIDTH })
    expect(DOCK_DEFAULT_WIDTH).toBe(340)
  })

  it('openDock sets open and tab and persists them', () => {
    useWorkDockStore.getState().openDock('alpha', { tab: 'changes', changesScope: 'uncommitted' })
    const deck = useWorkDockStore.getState().byDeck.alpha
    expect(deck.open).toBe(true)
    expect(deck.tab).toBe('changes')
    expect(deck.changesScope).toBe('uncommitted')
    expect(stored('alpha')).toEqual({ open: true, tab: 'changes', width: 340 })
  })

  it('openDock replaces reveal, diff and scope with the input, clearing absent fields', () => {
    const store = useWorkDockStore.getState()
    store.openDock('alpha', { tab: 'changes', diff: { path: 'a.ts' }, changesScope: 'turn' })
    store.openDock('alpha', { tab: 'files', reveal: { rootId: 'project:alpha', path: 'b.ts' } })
    const deck = useWorkDockStore.getState().byDeck.alpha
    expect(deck.reveal).toEqual({ rootId: 'project:alpha', path: 'b.ts' })
    expect(deck.diff).toBeUndefined()
    expect(deck.changesScope).toBeUndefined()
  })

  it('closeDock keeps tab and width', () => {
    const store = useWorkDockStore.getState()
    store.openDock('alpha', { tab: 'search' })
    store.setWidth('alpha', 500)
    store.closeDock('alpha')
    expect(useWorkDockStore.getState().byDeck.alpha).toMatchObject({ open: false, tab: 'search', width: 500 })
  })

  it('clamps the width to 260..720 and rounds it', () => {
    const store = useWorkDockStore.getState()
    store.setWidth('alpha', 100)
    expect(stored('alpha').width).toBe(260)
    store.setWidth('alpha', 9000)
    expect(stored('alpha').width).toBe(720)
    store.setWidth('alpha', 401.6)
    expect(useWorkDockStore.getState().byDeck.alpha.width).toBe(402)
  })

  it('persists exactly open, tab and width', () => {
    const store = useWorkDockStore.getState()
    store.openDock('alpha', { tab: 'changes', reveal: { rootId: 'issue:PAN-1', path: 'x' }, diff: { path: 'x', sha: 'abc' } })
    store.setRootOverride('alpha', 'issue:PAN-1')
    expect(Object.keys(stored('alpha')).sort()).toEqual(['open', 'tab', 'width'])
  })

  it('restores open, tab and width after a reload', () => {
    const store = useWorkDockStore.getState()
    store.openDock('alpha', { tab: 'search' })
    store.setWidth('alpha', 480)
    resetStore()
    expect(useWorkDockStore.getState().ensureDeck('alpha')).toEqual({ open: true, tab: 'search', width: 480 })
  })

  it('hydrates defaults from corrupt JSON', () => {
    localStorage.setItem(dockStorageKey('alpha'), '{not json')
    expect(useWorkDockStore.getState().ensureDeck('alpha')).toEqual({ open: false, tab: 'files', width: 340 })
  })

  it('falls back field by field on an unknown tab or a non-numeric width, and clamps a stored width', () => {
    localStorage.setItem(dockStorageKey('alpha'), JSON.stringify({ open: true, tab: 'bogus', width: 'wide' }))
    expect(useWorkDockStore.getState().ensureDeck('alpha')).toEqual({ open: true, tab: 'files', width: 340 })
    localStorage.setItem(dockStorageKey('beta'), JSON.stringify({ open: false, tab: 'changes', width: 5000 }))
    expect(useWorkDockStore.getState().ensureDeck('beta')).toEqual({ open: false, tab: 'changes', width: 720 })
  })

  it('keeps two decks independent', () => {
    const store = useWorkDockStore.getState()
    store.openDock('alpha', { tab: 'changes' })
    store.setWidth('beta', 600)
    expect(useWorkDockStore.getState().byDeck.alpha).toMatchObject({ open: true, tab: 'changes', width: 340 })
    expect(useWorkDockStore.getState().byDeck.beta).toMatchObject({ open: false, tab: 'files', width: 600 })
    expect(stored('alpha').width).toBe(340)
    expect(stored('beta').open).toBe(false)
  })
})
