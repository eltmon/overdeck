import { beforeEach, describe, expect, it } from 'vitest'
import {
  flushPanesPersistence,
  selectActivePaneId,
  selectPanesForWorkspace,
  usePanesStore,
  type WorkspacePane,
} from '../panesStore'

const ALL = '__all-projects__'

function panes(ws = ALL): readonly WorkspacePane[] {
  return selectPanesForWorkspace(ws)(usePanesStore.getState())
}
function activeId(ws = ALL): string | null {
  return selectActivePaneId(ws)(usePanesStore.getState())
}

const home: WorkspacePane = { paneId: 'home-1', paneType: 'home', label: 'Home', createdAt: 1, isPermanent: true }
const agentA: WorkspacePane = { paneId: 'agent-a', paneType: 'agent', label: 'A', createdAt: 2, conversationId: 'conv-a' }

beforeEach(() => {
  flushPanesPersistence()
  localStorage.clear()
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} })
})

describe('Home-less All projects deck (PAN-5343 H-D15)', () => {
  it('ensureHome on empty storage gives no panes and no active id', () => {
    usePanesStore.getState().ensureHome(ALL)
    expect(usePanesStore.getState().panesByWorkspace[ALL]).toEqual([])
    expect(activeId()).toBeNull()
    expect(ALL in usePanesStore.getState().activePaneByWorkspace).toBe(false)
  })

  it('drops a stored Home pane when hydrating', () => {
    localStorage.setItem(`pan-panes:${ALL}`, JSON.stringify([home, agentA]))
    usePanesStore.getState().ensureHome(ALL)
    expect(panes()).toEqual([agentA])
    expect(activeId()).toBe('agent-a')
  })

  it('addPane on a deck not yet in memory keeps the stored panes and appends', () => {
    localStorage.setItem(`pan-panes:${ALL}`, JSON.stringify([agentA]))
    const id = usePanesStore.getState().addPane(ALL, { paneType: 'agent', label: 'B', conversationId: 'conv-b' })
    expect(panes().map((p) => p.paneId)).toEqual(['agent-a', id])
    expect(panes().some((p) => p.paneType === 'home')).toBe(false)
    expect(activeId()).toBe(id)
  })

  it('addPane on a deck not yet in memory focuses a stored duplicate', () => {
    localStorage.setItem(`pan-panes:${ALL}`, JSON.stringify([agentA]))
    const id = usePanesStore.getState().addPane(ALL, { paneType: 'agent', label: 'A', conversationId: 'conv-a' })
    expect(id).toBe('agent-a')
    expect(panes()).toHaveLength(1)
  })

  it('closing the last pane leaves [] and removes the stored active id', () => {
    const store = usePanesStore.getState()
    const id = store.addPane(ALL, { paneType: 'agent', label: 'A', conversationId: 'conv-a' })
    flushPanesPersistence()
    expect(localStorage.getItem(`pan-active-pane:${ALL}`)).toBe(id)
    expect(() => usePanesStore.getState().closePane(ALL, id)).not.toThrow()
    expect(panes()).toEqual([])
    expect(activeId()).toBeNull()
    flushPanesPersistence()
    expect(localStorage.getItem(`pan-active-pane:${ALL}`)).toBeNull()
    expect(localStorage.getItem(`pan-panes:${ALL}`)).toBe('[]')
    // ensureHome on the now-empty deck stays empty and does not throw.
    expect(() => usePanesStore.getState().ensureHome(ALL)).not.toThrow()
    expect(panes()).toEqual([])
  })

  it('a project deck still gets a Home pane', () => {
    usePanesStore.getState().ensureHome('overdeck')
    const p = panes('overdeck')
    expect(p).toHaveLength(1)
    expect(p[0].paneType).toBe('home')
    expect(activeId('overdeck')).toBe(p[0].paneId)
  })
})
