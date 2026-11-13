import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Same stubs as Stage.test.tsx: keep the mount focused on the deck-load effect.
vi.mock('../panes/AgentPane', () => ({
  AgentPane: () => <div data-testid="agent-pane" />,
}))
vi.mock('../../terminal/TerminalDrawer', () => ({
  TerminalDrawer: () => <div data-testid="terminal-drawer" />,
}))
vi.mock('../../explorer/ExplorerPane', () => ({
  ExplorerPane: () => <div data-testid="explorer-pane" />,
}))

import { Stage } from '../index'
import { usePanesStore, selectPanesForWorkspace } from '../../../lib/panesStore'
import { useTerminalStateStore } from '../../terminal/terminalStateStore'

const DECK = 'overdeck'

beforeEach(() => {
  localStorage.clear()
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} })
  useTerminalStateStore.setState({ terminalStateByThreadId: {} })
  usePanesStore.getState().ensureHome(DECK)
})

function mountStage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <Stage
        deckKey={DECK}
        renderHome={() => <div data-testid="home" />}
        renderIssue={(issueId: string) => <div data-testid="issue-overview">{issueId}</div>}
      />
    </QueryClientProvider>,
  )
}

const filesPanes = () => selectPanesForWorkspace(DECK)(usePanesStore.getState()).filter((p) => p.paneType === 'files')

describe('Stage deck load — legacy Files pane migration (PAN-5186)', () => {
  it('gives a legacy issue-scoped files pane its issue root', async () => {
    const { addPane, setActivePane } = usePanesStore.getState()
    const id = addPane(DECK, { paneType: 'files', label: 'Files', issueId: 'PAN-1', agentId: 'agent-pan-1' })
    setActivePane(DECK, selectPanesForWorkspace(DECK)(usePanesStore.getState())[0].paneId)
    mountStage()
    await waitFor(() => expect(filesPanes()).toEqual([expect.objectContaining({ paneId: id, explorerRootId: 'issue:PAN-1' })]))
  })

  it('closes a files pane with neither an issue nor a root', async () => {
    const { addPane, setActivePane } = usePanesStore.getState()
    addPane(DECK, { paneType: 'files', label: 'Files' })
    setActivePane(DECK, selectPanesForWorkspace(DECK)(usePanesStore.getState())[0].paneId)
    mountStage()
    await waitFor(() => expect(filesPanes()).toHaveLength(0))
  })

  it('keeps a project-root files pane that has no issueId', async () => {
    const { addPane, setActivePane } = usePanesStore.getState()
    addPane(DECK, { paneType: 'files', label: 'Files', explorerRootId: 'project:overdeck' })
    setActivePane(DECK, selectPanesForWorkspace(DECK)(usePanesStore.getState())[0].paneId)
    mountStage()
    await waitFor(() => expect(filesPanes()).toEqual([expect.objectContaining({ explorerRootId: 'project:overdeck' })]))
    expect(filesPanes()[0].issueId).toBeUndefined()
  })
})
