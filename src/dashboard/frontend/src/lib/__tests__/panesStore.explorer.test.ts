import { describe, it, expect, beforeEach } from 'vitest'
import { usePanesStore, selectPanesForWorkspace, selectActivePaneId } from '../panesStore'

const WS = 'overdeck'

const filesPanes = () => selectPanesForWorkspace(WS)(usePanesStore.getState()).filter((p) => p.paneType === 'files')

beforeEach(() => {
  localStorage.clear()
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} })
  usePanesStore.getState().ensureHome(WS)
})

describe('addPane — explorer (files) panes dedupe on explorerRootId', () => {
  it('focuses the existing pane when files opens twice for the same root', () => {
    const { addPane, setActivePane } = usePanesStore.getState()
    const first = addPane(WS, { paneType: 'files', label: 'Files', issueId: 'PAN-1', explorerRootId: 'issue:PAN-1' })
    setActivePane(WS, selectPanesForWorkspace(WS)(usePanesStore.getState())[0].paneId)
    const second = addPane(WS, { paneType: 'files', label: 'Files', issueId: 'PAN-1', explorerRootId: 'issue:PAN-1' })
    expect(second).toBe(first)
    expect(filesPanes()).toHaveLength(1)
    expect(selectActivePaneId(WS)(usePanesStore.getState())).toBe(first)
  })

  it('gives an issue root and a project root two panes', () => {
    const { addPane } = usePanesStore.getState()
    addPane(WS, { paneType: 'files', label: 'Files', issueId: 'PAN-1', explorerRootId: 'issue:PAN-1' })
    addPane(WS, { paneType: 'files', label: 'Files', explorerRootId: 'project:overdeck' })
    expect(filesPanes().map((p) => p.explorerRootId)).toEqual(['issue:PAN-1', 'project:overdeck'])
  })

  it('does not dedupe a files spec without a root against one with a root', () => {
    const { addPane } = usePanesStore.getState()
    addPane(WS, { paneType: 'files', label: 'Files', issueId: 'PAN-1', explorerRootId: 'issue:PAN-1' })
    addPane(WS, { paneType: 'files', label: 'Files', issueId: 'PAN-1' })
    expect(filesPanes()).toHaveLength(2)
  })
})
