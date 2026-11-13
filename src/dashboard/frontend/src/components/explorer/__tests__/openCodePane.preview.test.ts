import { beforeEach, describe, expect, it } from 'vitest'
import { selectActivePaneId, selectPanesForWorkspace, usePanesStore } from '../../../lib/panesStore'
import { openCodePane } from '../openCodePane'

const WS = 'PAN-5187'

const codePanes = () => selectPanesForWorkspace(WS)(usePanesStore.getState()).filter((p) => p.paneType === 'code')
const active = () => selectActivePaneId(WS)(usePanesStore.getState())

beforeEach(() => {
  localStorage.clear()
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} })
  usePanesStore.getState().ensureHome(WS)
})

describe('openCodePane preview', () => {
  it('reuses one preview pane for two preview opens in one root', () => {
    const first = openCodePane(WS, { rootId: 'issue:PAN-1', path: 'src/a.ts', preview: true })
    const second = openCodePane(WS, { rootId: 'issue:PAN-1', path: 'src/b.ts', preview: true })
    expect(second).toBe(first)
    const panes = codePanes()
    expect(panes).toHaveLength(1)
    expect(panes[0]).toMatchObject({ explorerPath: 'src/b.ts', label: 'b.ts', explorerPreview: true })
    expect(active()).toBe(first)
  })

  it('makes the preview pane permanent on a non-preview open of its file, and the next preview adds a pane', () => {
    const id = openCodePane(WS, { rootId: 'issue:PAN-1', path: 'src/a.ts', preview: true })
    expect(openCodePane(WS, { rootId: 'issue:PAN-1', path: 'src/a.ts' })).toBe(id)
    expect(codePanes()).toHaveLength(1)
    expect(codePanes()[0]!.explorerPreview).toBe(false)

    const next = openCodePane(WS, { rootId: 'issue:PAN-1', path: 'src/b.ts', preview: true })
    expect(next).not.toBe(id)
    expect(codePanes().map((p) => [p.explorerPath, p.explorerPreview])).toEqual([
      ['src/a.ts', false],
      ['src/b.ts', true],
    ])
  })

  it('a preview open of a file that already has a permanent pane focuses that pane', () => {
    const permanent = openCodePane(WS, { rootId: 'issue:PAN-1', path: 'src/a.ts' })
    openCodePane(WS, { rootId: 'issue:PAN-1', path: 'src/b.ts', preview: true })
    expect(openCodePane(WS, { rootId: 'issue:PAN-1', path: 'src/a.ts', preview: true })).toBe(permanent)
    expect(active()).toBe(permanent)
    expect(codePanes().find((p) => p.paneId === permanent)?.explorerPreview).toBe(false)
  })

  it('keeps preview panes in two roots independent', () => {
    const a = openCodePane(WS, { rootId: 'issue:PAN-1', path: 'src/a.ts', preview: true })
    const b = openCodePane(WS, { rootId: 'issue:PAN-2', path: 'src/a.ts', preview: true })
    openCodePane(WS, { rootId: 'issue:PAN-2', path: 'src/c.ts', preview: true })
    expect(b).not.toBe(a)
    expect(codePanes().map((p) => [p.explorerRootId, p.explorerPath, p.explorerPreview])).toEqual([
      ['issue:PAN-1', 'src/a.ts', true],
      ['issue:PAN-2', 'src/c.ts', true],
    ])
  })

  it('carries a reveal target into the retargeted preview pane', () => {
    openCodePane(WS, { rootId: 'issue:PAN-1', path: 'src/a.ts', preview: true })
    openCodePane(WS, { rootId: 'issue:PAN-1', path: 'src/b.ts', line: 12, column: 3, preview: true })
    expect(codePanes()[0]).toMatchObject({ explorerPath: 'src/b.ts', explorerRevealLine: 12, explorerRevealColumn: 3 })
  })
})
