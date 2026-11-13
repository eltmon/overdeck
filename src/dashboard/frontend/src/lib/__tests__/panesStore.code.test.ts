import { describe, it, expect, beforeEach } from 'vitest'
import { usePanesStore, selectPanesForWorkspace, selectActivePaneId } from '../panesStore'

const WS = 'PAN-5186'

const panes = () => selectPanesForWorkspace(WS)(usePanesStore.getState())
const activeId = () => selectActivePaneId(WS)(usePanesStore.getState())

beforeEach(() => {
  localStorage.clear()
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} })
  usePanesStore.getState().ensureHome(WS)
})

describe('addPane — code panes dedupe on (explorerRootId, explorerPath)', () => {
  it('keeps one pane and focuses it when the same root and path open twice', () => {
    const { addPane, setActivePane } = usePanesStore.getState()
    const first = addPane(WS, { paneType: 'code', label: 'a.ts', explorerRootId: 'issue:PAN-1', explorerPath: 'src/a.ts' })
    setActivePane(WS, panes()[0].paneId)
    const second = addPane(WS, { paneType: 'code', label: 'a.ts', explorerRootId: 'issue:PAN-1', explorerPath: 'src/a.ts' })
    expect(second).toBe(first)
    expect(panes().filter((p) => p.paneType === 'code')).toHaveLength(1)
    expect(activeId()).toBe(first)
  })

  it('adds a second pane for a different path', () => {
    const { addPane } = usePanesStore.getState()
    const a = addPane(WS, { paneType: 'code', label: 'a.ts', explorerRootId: 'issue:PAN-1', explorerPath: 'src/a.ts' })
    const b = addPane(WS, { paneType: 'code', label: 'b.ts', explorerRootId: 'issue:PAN-1', explorerPath: 'src/b.ts' })
    expect(b).not.toBe(a)
    expect(panes().filter((p) => p.paneType === 'code')).toHaveLength(2)
  })

  it('adds a second pane for the same path under a different root', () => {
    const { addPane } = usePanesStore.getState()
    const a = addPane(WS, { paneType: 'code', label: 'a.ts', explorerRootId: 'issue:PAN-1', explorerPath: 'src/a.ts' })
    const b = addPane(WS, { paneType: 'code', label: 'a.ts', explorerRootId: 'project:overdeck', explorerPath: 'src/a.ts' })
    expect(b).not.toBe(a)
    expect(panes().filter((p) => p.paneType === 'code')).toHaveLength(2)
  })
})
