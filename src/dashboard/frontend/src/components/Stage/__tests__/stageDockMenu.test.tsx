import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('../panes/AgentPane', () => ({ AgentPane: () => <div data-testid="agent-pane" /> }))
vi.mock('../../terminal/TerminalDrawer', () => ({ TerminalDrawer: () => <div data-testid="terminal-drawer" /> }))
// The dock bodies are covered by their own tests; the menu only opens them.
vi.mock('../../explorer/ExplorerPane', () => ({ ExplorerFiles: ({ rootId }: { rootId: string }) => <div data-testid="explorer-files">{rootId}</div> }))
vi.mock('../../explorer/git/useExplorerGitStatus', () => ({
  useExplorerGitStatus: () => ({ result: null, decorations: { files: new Map(), folders: new Map() }, errorCode: undefined, errorMessage: undefined, refresh: () => {} }),
}))
vi.mock('../../explorer/search/QuickOpen', () => ({
  QuickOpen: ({ open, rootId }: { open: boolean; rootId: string }) => (open ? <div data-testid="quick-open">{rootId}</div> : null),
}))

import { Stage } from '../index'
import { usePanesStore, selectActivePaneId } from '../../../lib/panesStore'
import { useTerminalStateStore } from '../../terminal/terminalStateStore'
import { useWorkDockStore } from '../../dock/workDockStore'
import { installStrictFetchMock } from '../../../test-utils/strictFetchMock'

const DECK = 'workflow-fixture'
let fetchGuard: ReturnType<typeof installStrictFetchMock>

beforeEach(() => {
  localStorage.clear()
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} })
  useTerminalStateStore.setState({ terminalStateByThreadId: {} })
  useWorkDockStore.setState({ byDeck: {} })
  fetchGuard = installStrictFetchMock(({ method, url }) => {
    if (method !== 'GET') return undefined
    if (url === '/api/registered-projects') return Response.json([{ key: 'workflow-fixture', name: 'Workflow fixture', path: '/home/u/wf' }])
    if (url === '/api/workspace-registry') return Response.json({ workspaces: [] })
    if (url === '/api/conversations/pending-input') return Response.json([])
    if (url.startsWith('/api/projects/workflow-fixture/changes')) return Response.json({ projectKey: 'workflow-fixture', branch: 'main', commits: [] })
    return undefined
  })
})

afterEach(async () => {
  await fetchGuard.assertNoUnexpectedRequests()
  vi.unstubAllGlobals()
})

function renderStage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <Stage deckKey={DECK} renderHome={() => <div data-testid="home" />} renderIssue={(id: string) => <div>{id}</div>} />
    </QueryClientProvider>,
  )
}

async function openMenu() {
  fireEvent.click(screen.getByLabelText('Open new tab'))
  await waitFor(() => expect(screen.getByRole('menuitem', { name: /Changes in Workflow fixture/ })).toBeInTheDocument())
}

describe('Stage + menu dock entries (PAN-5289)', () => {
  it('lists Files, Changes in <project name> and Go to file…', async () => {
    renderStage()
    await openMenu()
    expect(screen.getByRole('menuitem', { name: /^Files$/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Go to file…/ })).toBeInTheDocument()
  })

  it('opens the dock on Files', async () => {
    renderStage()
    await openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /^Files$/ }))
    expect(useWorkDockStore.getState().byDeck[DECK]).toMatchObject({ open: true, tab: 'files' })
    expect(await screen.findByTestId('work-dock')).toBeInTheDocument()
  })

  it('opens Changes on the project root, anchored to the active tab', async () => {
    renderStage()
    await openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /Changes in Workflow fixture/ }))
    const active = selectActivePaneId(DECK)(usePanesStore.getState())
    expect(useWorkDockStore.getState().byDeck[DECK]).toMatchObject({ open: true, tab: 'changes', rootOverride: 'project:workflow-fixture', rootOverrideAnchor: active })
  })

  it('opens Go to file', async () => {
    renderStage()
    await openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /Go to file…/ }))
    expect(useWorkDockStore.getState().byDeck[DECK]?.quickOpen).toBe(true)
    expect(await screen.findByTestId('quick-open')).toHaveTextContent('project:workflow-fixture')
  })
})

describe('Stage + menu order and keycaps (PAN-5295)', () => {
  it('lists New conversation, Files, Changes in <project>, Go to file…, Terminal, Web page in order', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <Stage
          deckKey={DECK}
          renderHome={() => <div data-testid="home" />}
          renderIssue={(id: string) => <div>{id}</div>}
          onCreateConversation={vi.fn(async () => ({ error: 'unused' }))}
        />
      </QueryClientProvider>,
    )
    await openMenu()
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent?.replace(/\s*(Ctrl|⌘).*$/, ''))).toEqual([
      'New conversation', 'Files', 'Changes in Workflow fixture', 'Go to file…', 'Terminal', 'Web page',
    ])
    expect(screen.getAllByRole('separator')).toHaveLength(1)
  })

  it('shows the registered keycap for this platform and none for an unbound shortcut', async () => {
    vi.stubGlobal('navigator', { ...navigator, platform: 'Linux x86_64' })
    renderStage()
    await openMenu()
    const files = screen.getByRole('menuitem', { name: /^Files$/ })
    await waitFor(() => expect(files).toHaveTextContent('Ctrl Shift E'))
    expect(files).toHaveAttribute('aria-keyshortcuts', 'Control+Shift+E')
    expect(screen.getByRole('menuitem', { name: /^Terminal$/ }).querySelector('kbd')).toBeNull()
  })
})
