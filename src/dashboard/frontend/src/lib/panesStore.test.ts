import { describe, it, expect, beforeEach } from 'vitest'
import {
  usePanesStore,
  selectPanesForWorkspace,
  selectActivePaneId,
  selectActivePane,
  type WorkspacePane,
} from './panesStore'

const WS = 'PAN-1549'
const WS2 = 'PAN-2000'

function panes(ws = WS): WorkspacePane[] {
  return selectPanesForWorkspace(ws)(usePanesStore.getState())
}
function activeId(ws = WS): string | null {
  return selectActivePaneId(ws)(usePanesStore.getState())
}

beforeEach(() => {
  localStorage.clear()
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} })
})

describe('ensureHome', () => {
  it('synthesizes a permanent HOME pane when no panes exist (ac1)', () => {
    usePanesStore.getState().ensureHome(WS)
    const p = panes()
    expect(p).toHaveLength(1)
    expect(p[0].paneType).toBe('home')
    expect(p[0].isPermanent).toBe(true)
    expect(activeId()).toBe(p[0].paneId)
  })

  it('is idempotent — repeated calls do not add HOME panes', () => {
    const ensure = usePanesStore.getState().ensureHome
    ensure(WS)
    const firstId = panes()[0].paneId
    ensure(WS)
    ensure(WS)
    expect(panes()).toHaveLength(1)
    expect(panes()[0].paneId).toBe(firstId)
  })
})

describe('addPane / setActivePane', () => {
  beforeEach(() => usePanesStore.getState().ensureHome(WS))

  it('adds a pane and makes it active', () => {
    const id = usePanesStore.getState().addPane(WS, { paneType: 'terminal', label: 'Terminal' })
    expect(panes()).toHaveLength(2)
    expect(activeId()).toBe(id)
    expect(panes()[1].paneType).toBe('terminal')
    expect(typeof panes()[1].createdAt).toBe('number')
  })

  it('switches the active pane back to HOME', () => {
    const homeId = panes()[0].paneId
    usePanesStore.getState().addPane(WS, { paneType: 'plan', label: 'Plan' })
    usePanesStore.getState().setActivePane(WS, homeId)
    expect(activeId()).toBe(homeId)
  })

  it('ignores setActivePane for an unknown pane id', () => {
    const before = activeId()
    usePanesStore.getState().setActivePane(WS, 'does-not-exist')
    expect(activeId()).toBe(before)
  })
})

describe('closePane (ac2)', () => {
  beforeEach(() => usePanesStore.getState().ensureHome(WS))

  it('refuses to close the HOME pane', () => {
    const homeId = panes()[0].paneId
    usePanesStore.getState().closePane(WS, homeId)
    expect(panes()).toHaveLength(1)
    expect(panes()[0].paneId).toBe(homeId)
  })

  it('closes a non-HOME pane', () => {
    const id = usePanesStore.getState().addPane(WS, { paneType: 'docs', label: 'Docs' })
    usePanesStore.getState().closePane(WS, id)
    expect(panes()).toHaveLength(1)
    expect(panes().some((p) => p.paneId === id)).toBe(false)
  })

  it('falls active back to HOME when the active pane is closed', () => {
    const homeId = panes()[0].paneId
    const id = usePanesStore.getState().addPane(WS, { paneType: 'commits', label: 'Commits' })
    expect(activeId()).toBe(id)
    usePanesStore.getState().closePane(WS, id)
    expect(activeId()).toBe(homeId)
  })

  it('keeps active pointing at a surviving pane when a different pane is closed', () => {
    const a = usePanesStore.getState().addPane(WS, { paneType: 'docs', label: 'A' })
    const b = usePanesStore.getState().addPane(WS, { paneType: 'plan', label: 'B' })
    usePanesStore.getState().setActivePane(WS, a)
    usePanesStore.getState().closePane(WS, b)
    expect(activeId()).toBe(a)
  })
})

describe('updatePane', () => {
  beforeEach(() => usePanesStore.getState().ensureHome(WS))

  it('patches fields without changing paneId', () => {
    const id = usePanesStore.getState().addPane(WS, {
      paneType: 'agent',
      label: 'Agent',
      isRunning: false,
    })
    usePanesStore.getState().updatePane(WS, id, { isRunning: true, viewMode: 'terminal' })
    const pane = panes().find((p) => p.paneId === id)!
    expect(pane.isRunning).toBe(true)
    expect(pane.viewMode).toBe('terminal')
    expect(pane.paneId).toBe(id)
  })
})

describe('per-workspace isolation', () => {
  it('keeps panes separate across workspaces', () => {
    const store = usePanesStore.getState()
    store.ensureHome(WS)
    store.ensureHome(WS2)
    store.addPane(WS, { paneType: 'terminal', label: 'T' })
    expect(panes(WS)).toHaveLength(2)
    expect(panes(WS2)).toHaveLength(1)
  })
})

describe('localStorage persistence (ac3)', () => {
  it('round-trips panes + activePaneId keyed by workspaceId', () => {
    const store = usePanesStore.getState()
    store.ensureHome(WS)
    const id = store.addPane(WS, { paneType: 'plan', label: 'Plan' })

    // Storage written under the right keys.
    expect(localStorage.getItem(`pan-active-pane:${WS}`)).toBe(id)
    const stored = JSON.parse(localStorage.getItem(`pan-panes:${WS}`)!)
    expect(stored).toHaveLength(2)

    // Fresh in-memory state, then rehydrate from storage.
    usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} })
    usePanesStore.getState().ensureHome(WS)
    expect(panes()).toHaveLength(2)
    expect(activeId()).toBe(id)
    expect(panes()[1].paneType).toBe('plan')
  })

  it('degrades to HOME-only when storage is corrupt', () => {
    localStorage.setItem(`pan-panes:${WS}`, '{not valid json')
    usePanesStore.getState().ensureHome(WS)
    expect(panes()).toHaveLength(1)
    expect(panes()[0].paneType).toBe('home')
  })

  it('degrades to HOME-only when stored value is not an array', () => {
    localStorage.setItem(`pan-panes:${WS}`, JSON.stringify({ foo: 'bar' }))
    usePanesStore.getState().ensureHome(WS)
    expect(panes()).toHaveLength(1)
    expect(panes()[0].paneType).toBe('home')
  })

  it('drops invalid pane entries and guarantees a single HOME on hydrate', () => {
    localStorage.setItem(
      `pan-panes:${WS}`,
      JSON.stringify([
        { paneId: 'h', paneType: 'home', label: 'Home', createdAt: 1, isPermanent: true },
        { paneType: 'terminal' }, // invalid — missing required fields
        { paneId: 't', paneType: 'terminal', label: 'T', createdAt: 2 },
      ]),
    )
    usePanesStore.getState().ensureHome(WS)
    const p = panes()
    expect(p).toHaveLength(2)
    expect(p[0].paneType).toBe('home')
    expect(p.filter((x) => x.paneType === 'home')).toHaveLength(1)
  })

  it('repairs a stored active id that points at a missing pane (falls to HOME)', () => {
    localStorage.setItem(
      `pan-panes:${WS}`,
      JSON.stringify([
        { paneId: 'h', paneType: 'home', label: 'Home', createdAt: 1, isPermanent: true },
      ]),
    )
    localStorage.setItem(`pan-active-pane:${WS}`, 'ghost')
    usePanesStore.getState().ensureHome(WS)
    expect(activeId()).toBe('h')
  })
})

describe('selectActivePane', () => {
  it('returns the active pane object', () => {
    usePanesStore.getState().ensureHome(WS)
    const id = usePanesStore.getState().addPane(WS, { paneType: 'docs', label: 'Docs' })
    const active = selectActivePane(WS)(usePanesStore.getState())
    expect(active?.paneId).toBe(id)
    expect(active?.paneType).toBe('docs')
  })

  it('returns null before ensureHome runs', () => {
    expect(selectActivePane('never-seen')(usePanesStore.getState())).toBeNull()
  })
})
