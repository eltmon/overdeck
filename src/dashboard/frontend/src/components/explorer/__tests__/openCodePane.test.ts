import { describe, it, expect, beforeEach } from 'vitest'
import { usePanesStore, selectPanesForWorkspace, selectActivePaneId } from '../../../lib/panesStore'
import { openCodePane, codePaneLabel } from '../openCodePane'

const WS = 'PAN-5186'

const panes = () => selectPanesForWorkspace(WS)(usePanesStore.getState())
const codePanes = () => panes().filter((p) => p.paneType === 'code')

beforeEach(() => {
  localStorage.clear()
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} })
  usePanesStore.getState().ensureHome(WS)
})

describe('codePaneLabel', () => {
  it('is the basename of the path', () => {
    expect(codePaneLabel('src/dashboard/server/ws-rpc.ts')).toBe('ws-rpc.ts')
    expect(codePaneLabel('README.md')).toBe('README.md')
  })

  it('falls back to the path when there is no basename', () => {
    expect(codePaneLabel('')).toBe('')
  })
})

describe('openCodePane', () => {
  it('opens a new code pane labelled with the basename and no reveal fields', () => {
    const id = openCodePane(WS, { rootId: 'issue:PAN-1', path: 'src/dashboard/server/ws-rpc.ts' })
    const [pane] = codePanes()
    expect(pane.paneId).toBe(id)
    expect(pane.paneType).toBe('code')
    expect(pane.label).toBe('ws-rpc.ts')
    expect(pane.explorerRootId).toBe('issue:PAN-1')
    expect(pane.explorerPath).toBe('src/dashboard/server/ws-rpc.ts')
    expect(pane.explorerRevealLine).toBeUndefined()
    expect(pane.explorerRevealColumn).toBeUndefined()
    expect(pane.explorerRevealNonce).toBeUndefined()
    expect(selectActivePaneId(WS)(usePanesStore.getState())).toBe(id)
  })

  it('patches an existing pane with the reveal target and a larger nonce, and focuses it', () => {
    const first = openCodePane(WS, { rootId: 'issue:PAN-1', path: 'src/a.ts', line: 10 })
    const nonce1 = codePanes()[0].explorerRevealNonce ?? 0
    usePanesStore.getState().setActivePane(WS, panes()[0].paneId)

    const second = openCodePane(WS, { rootId: 'issue:PAN-1', path: 'src/a.ts', line: 40 })
    expect(second).toBe(first)
    expect(codePanes()).toHaveLength(1)
    const pane = codePanes()[0]
    expect(pane.explorerRevealLine).toBe(40)
    expect(pane.explorerRevealColumn).toBe(1)
    expect(pane.explorerRevealNonce ?? 0).toBeGreaterThan(nonce1)
    expect(selectActivePaneId(WS)(usePanesStore.getState())).toBe(first)
  })

  it('keeps the column a caller passes', () => {
    openCodePane(WS, { rootId: 'issue:PAN-1', path: 'src/a.ts', line: 3, column: 7 })
    expect(codePanes()[0].explorerRevealColumn).toBe(7)
  })
})
