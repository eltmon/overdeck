import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Same stubs as Stage.test.tsx: keep the mount focused on the deck-load effect.
vi.mock('../panes/AgentPane', () => ({
  AgentPane: () => <div data-testid="agent-pane" />,
}))
vi.mock('../../terminal/TerminalDrawer', () => ({
  TerminalDrawer: () => <div data-testid="terminal-drawer" />,
}))
// The dock's Changes count reads git status of an issue root; no RPC transport here.
vi.mock('../../explorer/git/useExplorerGitStatus', () => ({
  useExplorerGitStatus: () => ({ result: null, decorations: { files: new Map(), folders: new Map() }, errorCode: undefined, errorMessage: undefined, refresh: () => {} }),
}))
// The explorer body is covered by ExplorerPane.test.tsx; here it only shows which root it got.
vi.mock('../../explorer/ExplorerPane', () => ({
  ExplorerFiles: ({ rootId }: { rootId: string }) => <div data-testid="explorer-files">{rootId}</div>,
}))

import { Stage } from '../index'
import { usePanesStore, selectPanesForWorkspace, selectActivePaneId } from '../../../lib/panesStore'
import { useTerminalStateStore } from '../../terminal/terminalStateStore'
import { useWorkDockStore } from '../../dock/workDockStore'
import { installWorkDockFetchMock } from '../../../test-utils/strictFetchMock'

// PAN-5289: the Stage mounts the work dock, which loads the project and workspace registries.
let workDockFetch: ReturnType<typeof installWorkDockFetchMock>
beforeEach(() => {
  workDockFetch = installWorkDockFetchMock()
})
afterEach(async () => {
  await workDockFetch.assertNoUnexpectedRequests()
  vi.unstubAllGlobals()
})

const DECK = 'overdeck'

beforeEach(() => {
  localStorage.clear()
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} })
  useTerminalStateStore.setState({ terminalStateByThreadId: {} })
  useWorkDockStore.setState({ byDeck: {} })
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

const explorerPanes = () => selectPanesForWorkspace(DECK)(usePanesStore.getState()).filter((p) => p.paneType === 'files')
const dock = () => useWorkDockStore.getState().byDeck[DECK]

describe('Stage deck load: Files panes move into the dock (PAN-5289 FR-4)', () => {
  it('closes a legacy issue-scoped files pane and opens the dock on its issue root, anchored to the next active pane', async () => {
    const { addPane } = usePanesStore.getState()
    addPane(DECK, { paneType: 'files', label: 'Files', issueId: 'PAN-1', agentId: 'agent-pan-1' })
    mountStage()
    await waitFor(() => expect(explorerPanes()).toHaveLength(0))
    const active = selectActivePaneId(DECK)(usePanesStore.getState())
    expect(active).toBeTruthy()
    expect(dock()).toMatchObject({ open: true, tab: 'files', rootOverride: 'issue:PAN-1', rootOverrideAnchor: active })
    // The Files tab shows that root, not the FR-13 message.
    expect(await screen.findByTestId('work-dock')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Files/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Follow the active tab' })).toBeInTheDocument()
    expect(screen.queryByText('No project is selected, so there are no files to show.')).toBeNull()
    expect(screen.getByTestId('explorer-files')).toHaveTextContent('issue:PAN-1')
  })

  it('closes a files pane with neither an issue nor a root and leaves the dock closed', async () => {
    const { addPane, setActivePane } = usePanesStore.getState()
    addPane(DECK, { paneType: 'files', label: 'Files' })
    setActivePane(DECK, selectPanesForWorkspace(DECK)(usePanesStore.getState())[0].paneId)
    mountStage()
    await waitFor(() => expect(explorerPanes()).toHaveLength(0))
    expect(dock()?.open ?? false).toBe(false)
    expect(dock()?.rootOverride).toBeUndefined()
    expect(screen.queryByTestId('work-dock')).toBeNull()
  })

  it('closes a project-root files pane and opens the dock on that root', async () => {
    const { addPane, setActivePane } = usePanesStore.getState()
    addPane(DECK, { paneType: 'files', label: 'Files', explorerRootId: 'project:overdeck' })
    setActivePane(DECK, selectPanesForWorkspace(DECK)(usePanesStore.getState())[0].paneId)
    mountStage()
    await waitFor(() => expect(explorerPanes()).toHaveLength(0))
    expect(dock()).toMatchObject({ open: true, tab: 'files', rootOverride: 'project:overdeck' })
  })

  it('uses the last files pane root when there are two', async () => {
    const { addPane } = usePanesStore.getState()
    addPane(DECK, { paneType: 'files', label: 'Files', explorerRootId: 'project:a' })
    addPane(DECK, { paneType: 'files', label: 'Files', explorerRootId: 'issue:B' })
    mountStage()
    await waitFor(() => expect(explorerPanes()).toHaveLength(0))
    expect(dock()?.rootOverride).toBe('issue:B')
  })
})
