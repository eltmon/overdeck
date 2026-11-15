import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const toast = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast }))
vi.mock('../../Stage/panes/AgentPane', () => ({ AgentPane: () => <div data-testid="agent-pane" /> }))
vi.mock('../../terminal/TerminalDrawer', () => ({ TerminalDrawer: () => <div data-testid="terminal-drawer" /> }))
// The explorer body is covered by ExplorerPane.test.tsx; here it only shows which root it got.
// The Changes lists read git status over the explorer RPC, which these tests do not run.
vi.mock('../../explorer/git/useExplorerGitStatus', () => ({
  useExplorerGitStatus: () => ({ result: null, decorations: { files: new Map(), folders: new Map() }, errorCode: undefined, errorMessage: undefined, refresh: () => {} }),
}))
vi.mock('../../explorer/ExplorerPane', () => ({
  ExplorerFiles: ({ rootId, changedPaths }: { rootId: string; changedPaths: ReadonlySet<string> }) => (
    <div data-testid="explorer-files" data-changed={[...changedPaths].join(',')}>
      {rootId}
    </div>
  ),
}))

import { WorkDock, type WorkDockProps } from '../WorkDock'
import { useWorkDockStore, dockStorageKey } from '../workDockStore'
import { useActiveDock } from '../activeDock'
import { useExplorerStore } from '../../explorer/explorerStore'
import { StageDeckProvider, type StageDeckContextValue } from '../../Stage/StageDeckContext'
import { Stage } from '../../Stage'
import { installShortcutListener, resetShortcutsForTests } from '../../../lib/shortcuts/registry'
import { useDashboardStore } from '../../../lib/store'
import { usePanesStore, type WorkspacePane } from '../../../lib/panesStore'
import { useTerminalStateStore } from '../../terminal/terminalStateStore'
import type { Conversation } from '../../CommandDeck/ConversationList'
import { NO_PROJECT_KEY } from '../../CommandDeck/projectsData'

const DECK = 'p'
const NO_CHANGES = {
  conversation: 'c1',
  repoRoot: '/home/u/Projects/p',
  rootId: 'project:p',
  branch: 'main',
  scope: 'conversation',
  uncommitted: [],
  commits: [],
  totals: { files: 0, additions: 0, deletions: 0, commitsPushed: 0, commitsLocal: 0, uncommittedFiles: 0 },
}
const PROJECTS = [{ key: 'p', name: 'Project P', path: '/home/u/Projects/p' }]

function pane(fields: Partial<WorkspacePane> & { paneId: string; paneType: WorkspacePane['paneType'] }): WorkspacePane {
  return { label: fields.paneId, createdAt: 0, ...fields }
}

function conv(fields: Partial<Conversation> & { name: string }): Conversation {
  return { cwd: '/home/u/Projects/p', issueId: null, title: 'Fix the bug', branch: 'main', ...fields } as Conversation
}

const chatPane = pane({ paneId: 'a1', paneType: 'agent', conversationId: 'c1' })
const homePane = pane({ paneId: 'home', paneType: 'home' })
const issuePane = pane({ paneId: 'i1', paneType: 'issue', issueId: 'PAN-9' })

function deckValue(over: Partial<StageDeckContextValue> = {}): StageDeckContextValue {
  return { deckKey: DECK, openOrFocusEditorPane: vi.fn(), openOrFocusAgentPane: vi.fn(), openBeside: vi.fn(() => 'code-1'), ...over }
}

function wrap(children: ReactNode, deck: StageDeckContextValue = deckValue()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <StageDeckProvider value={deck}>{children}</StageDeckProvider>
    </QueryClientProvider>
  )
}

function props(over: Partial<WorkDockProps> = {}): WorkDockProps {
  return { deckKey: DECK, activePane: homePane, layoutLeafIds: [], panesById: new Map(), conversations: [], ...over }
}

function openDock(tab: 'files' | 'changes' | 'search' | 'live' = 'files'): void {
  act(() => useWorkDockStore.getState().openDock(DECK, { tab }))
}

function scopeText(): string {
  return screen.getByTestId('work-dock-scope').textContent ?? ''
}

beforeEach(() => {
  localStorage.clear()
  useWorkDockStore.setState({ byDeck: {} })
  useActiveDock.setState({ current: null })
  useDashboardStore.setState({ issuesRaw: [{ id: 'PAN-9', title: 'Fix the gate' }] })
  toast.mockReset()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/registered-projects') return Response.json(PROJECTS)
      if (url === '/api/workspace-registry') return Response.json({ workspaces: [] })
      if (url.startsWith('/api/conversations/') && url.includes('/changes?')) return Response.json(NO_CHANGES)
      if (url.startsWith('/api/projects/') && url.includes('/changes?')) return Response.json({ projectKey: 'p', branch: 'main', commits: [] })
      return Response.json([])
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetShortcutsForTests()
})

describe('WorkDock', () => {
  it('renders no dock while closed, opens at the stored width and hides from the close button', () => {
    render(wrap(<WorkDock {...props()} />))
    expect(screen.queryByTestId('work-dock')).toBeNull()
    openDock()
    expect(screen.getByTestId('work-dock')).toHaveStyle({ width: '340px' })
    fireEvent.click(screen.getByRole('button', { name: 'Hide panel' }))
    expect(screen.queryByTestId('work-dock')).toBeNull()
    expect(useWorkDockStore.getState().byDeck[DECK].open).toBe(false)
  })

  it('widens by the drag distance, persists on release and clamps at 720', () => {
    render(wrap(<WorkDock {...props()} />))
    openDock()
    const handle = screen.getByTestId('work-dock-resize')
    fireEvent.mouseDown(handle, { clientX: 500 })
    fireEvent.mouseMove(window, { clientX: 400 })
    expect(screen.getByTestId('work-dock')).toHaveStyle({ width: '440px' })
    fireEvent.mouseUp(window)
    expect(screen.getByTestId('work-dock')).toHaveStyle({ width: '440px' })
    expect(JSON.parse(localStorage.getItem(dockStorageKey(DECK)) ?? '{}').width).toBe(440)
    fireEvent.mouseDown(handle, { clientX: 500 })
    fireEvent.mouseMove(window, { clientX: -2000 })
    fireEvent.mouseUp(window)
    expect(screen.getByTestId('work-dock')).toHaveStyle({ width: '720px' })
  })

  it('reads the scope line for a conversation, a project Home and an issue', async () => {
    const conversations = [conv({ name: 'c1' })]
    const { rerender } = render(wrap(<WorkDock {...props({ activePane: chatPane, conversations })} />))
    openDock()
    await waitFor(() => expect(scopeText()).toBe('For Fix the bug · Project P · main'))
    rerender(wrap(<WorkDock {...props({ activePane: homePane, conversations })} />))
    await waitFor(() => expect(scopeText()).toBe('Project Project P · main checkout'))
    rerender(wrap(<WorkDock {...props({ activePane: issuePane, conversations })} />))
    await waitFor(() => expect(scopeText()).toBe('Issue PAN-9 · Fix the gate'))
  })

  it('offers Open project files for a linked conversation, anchored to that pane, and Follow tab undoes it', async () => {
    const conversations = [conv({ name: 'c1', origin: 'linked' } as Partial<Conversation> & { name: string }), conv({ name: 'c2', title: 'Other' })]
    const otherChat = pane({ paneId: 'a2', paneType: 'agent', conversationId: 'c2' })
    const deck = deckValue()
    const { rerender } = render(wrap(<WorkDock {...props({ activePane: chatPane, conversations })} />, deck))
    openDock()
    expect(await screen.findByText("This conversation's files are not on this machine")).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Open project files' }))
    expect(useWorkDockStore.getState().byDeck[DECK]).toMatchObject({ rootOverride: 'project:p', rootOverrideAnchor: 'a1' })
    expect(screen.queryByText("This conversation's files are not on this machine")).toBeNull()
    expect(screen.getByRole('button', { name: 'Follow the active tab' })).toBeInTheDocument()

    // Another tab shows its own root; back on the anchor tab the override returns.
    rerender(wrap(<WorkDock {...props({ activePane: otherChat, conversations })} />, deck))
    expect(screen.queryByRole('button', { name: 'Follow the active tab' })).toBeNull()
    expect(scopeText()).toContain('For Other')
    rerender(wrap(<WorkDock {...props({ activePane: chatPane, conversations })} />, deck))
    expect(screen.getByRole('button', { name: 'Follow the active tab' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Follow the active tab' }))
    expect(useWorkDockStore.getState().byDeck[DECK].rootOverride).toBeUndefined()
    expect(screen.getByText("This conversation's files are not on this machine")).toBeInTheDocument()
  })

  it('explains an outside conversation and the no-project deck', async () => {
    const outside = [conv({ name: 'c1', cwd: '/srv/elsewhere' })]
    const { unmount } = render(wrap(<WorkDock {...props({ activePane: chatPane, conversations: outside })} />))
    openDock('search')
    expect(await screen.findByText("This conversation's folder is outside the project")).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Open project files' })).toBeInTheDocument()
    unmount()

    render(wrap(<WorkDock {...props({ deckKey: NO_PROJECT_KEY })} />))
    act(() => useWorkDockStore.getState().openDock(NO_PROJECT_KEY, { tab: 'files' }))
    expect(screen.getByText('No project is selected, so there are no files to show.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open project files' })).toBeNull()
    expect(scopeText()).toBe('No project')
  })

  it('toggles the dock on Files with Ctrl+Shift+E', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Linux x86_64')
    const uninstall = installShortcutListener()
    render(wrap(<WorkDock {...props()} />))
    act(() => {
      fireEvent.keyDown(document.body, { key: 'E', ctrlKey: true, shiftKey: true })
    })
    expect(screen.getByTestId('work-dock')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Files/ })).toHaveAttribute('aria-selected', 'true')
    act(() => {
      fireEvent.keyDown(document.body, { key: 'E', ctrlKey: true, shiftKey: true })
    })
    expect(screen.queryByTestId('work-dock')).toBeNull()
    uninstall()
  })

  it('shows Files for a persisted live tab while Live has nothing to watch, and Ctrl+Shift+E closes it', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Linux x86_64')
    const uninstall = installShortcutListener()
    localStorage.setItem(dockStorageKey(DECK), JSON.stringify({ open: true, tab: 'live', width: 400 }))
    render(wrap(<WorkDock {...props()} />))
    expect(screen.getByRole('tab', { name: /Files/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('tab', { name: /Live/ })).toBeNull()
    act(() => {
      fireEvent.keyDown(document.body, { key: 'E', ctrlKey: true, shiftKey: true })
    })
    expect(screen.queryByTestId('work-dock')).toBeNull()
    uninstall()
  })

  it('shows a toast for Go to file when there is no root at all', () => {
    render(wrap(<WorkDock {...props({ deckKey: NO_PROJECT_KEY })} />))
    act(() => useWorkDockStore.getState().setQuickOpen(NO_PROJECT_KEY, true))
    expect(toast).toHaveBeenCalledWith('No project files to search here.')
    expect(useWorkDockStore.getState().byDeck[NO_PROJECT_KEY].quickOpen).toBe(false)
    expect(screen.queryByRole('dialog', { name: 'Quick open' })).toBeNull()
  })

  it('publishes activeDock with the active pane and clears it on unmount', async () => {
    const deck = deckValue()
    const conversations = [conv({ name: 'c1' })]
    const { unmount } = render(wrap(<WorkDock {...props({ activePane: chatPane, conversations })} />, deck))
    await waitFor(() => expect(useActiveDock.getState().current?.rootId).toBe('project:p'))
    const current = useActiveDock.getState().current
    expect(current).toMatchObject({ deckKey: DECK, activePaneId: 'a1' })
    current?.openFile('src/a.ts')
    expect(deck.openBeside).toHaveBeenCalledWith({ rootId: 'project:p', path: 'src/a.ts' })
    act(() => current?.revealFile('src/b.ts'))
    expect(useWorkDockStore.getState().byDeck[DECK]).toMatchObject({ open: true, tab: 'files' })
    // The Files tab handled the one-shot request: the file is selected and the request is gone.
    await waitFor(() => expect(useExplorerStore.getState().roots['project:p']?.selection).toEqual(['src/b.ts']))
    expect(useWorkDockStore.getState().byDeck[DECK].reveal).toBeUndefined()
    unmount()
    expect(useActiveDock.getState().current).toBeNull()
  })
})

describe('WorkDock scope changes (PAN-5289 review)', () => {
  it('drops an open diff and a Search folder when the scope changes, and keeps them otherwise', async () => {
    const conversations = [conv({ name: 'c1' })]
    const { rerender } = render(wrap(<WorkDock {...props({ activePane: chatPane, conversations })} />))
    openDock()
    // A diff is opened from a loaded list, so the scope has settled by then.
    await waitFor(() => expect(scopeText()).toBe('For Fix the bug · Project P · main'))
    act(() => useWorkDockStore.getState().openDock(DECK, { tab: 'changes', diff: { path: 'src/a.ts' }, diffList: [{ path: 'src/a.ts' }] }))
    rerender(wrap(<WorkDock {...props({ activePane: chatPane, conversations })} />))
    expect(useWorkDockStore.getState().byDeck[DECK].diff).toEqual({ path: 'src/a.ts' })

    rerender(wrap(<WorkDock {...props({ activePane: issuePane, conversations })} />))
    await waitFor(() => expect(useWorkDockStore.getState().byDeck[DECK].diff).toBeUndefined())
    expect(useWorkDockStore.getState().byDeck[DECK].diffList).toBeUndefined()

    act(() => useWorkDockStore.getState().openDock(DECK, { tab: 'search', searchPath: 'src' }))
    rerender(wrap(<WorkDock {...props({ activePane: homePane, conversations })} />))
    await waitFor(() => expect(useWorkDockStore.getState().byDeck[DECK].searchPath).toBeUndefined())
  })
})

describe('WorkDock after a Reveal (PAN-5289 review cycle 2)', () => {
  const conversations = () => [conv({ name: 'c1' })]

  it('keeps following the active tab: no override after revealing on an issue tab and switching to Home', async () => {
    const { rerender } = render(wrap(<WorkDock {...props({ activePane: issuePane, conversations: conversations() })} />))
    openDock()
    await waitFor(() => expect(scopeText()).toBe('Issue PAN-9 · Fix the gate'))
    act(() => useWorkDockStore.getState().openDock(DECK, { tab: 'files', reveal: { rootId: 'issue:PAN-9', path: 'src/a.ts' } }))
    await waitFor(() => expect(useWorkDockStore.getState().byDeck[DECK].reveal).toBeUndefined())

    rerender(wrap(<WorkDock {...props({ activePane: homePane, conversations: conversations() })} />))
    await waitFor(() => expect(scopeText()).toBe('Project Project P · main checkout'))
    expect(screen.getByTestId('explorer-files')).toHaveTextContent('project:p')
    expect(useWorkDockStore.getState().byDeck[DECK].rootOverride).toBeUndefined()

    rerender(wrap(<WorkDock {...props({ activePane: issuePane, conversations: conversations() })} />))
    await waitFor(() => expect(scopeText()).toBe('Issue PAN-9 · Fix the gate'))
    expect(screen.queryByRole('button', { name: 'Follow the active tab' })).toBeNull()
  })

  it('keeps a conversation scope after revealing from it, visiting an issue tab and coming back', async () => {
    const { rerender } = render(wrap(<WorkDock {...props({ activePane: chatPane, conversations: conversations() })} />))
    openDock()
    await waitFor(() => expect(scopeText()).toBe('For Fix the bug · Project P · main'))
    act(() => useWorkDockStore.getState().openDock(DECK, { tab: 'files', reveal: { rootId: 'project:p', path: 'src/a.ts' } }))
    await waitFor(() => expect(useWorkDockStore.getState().byDeck[DECK].reveal).toBeUndefined())

    rerender(wrap(<WorkDock {...props({ activePane: issuePane, conversations: conversations() })} />))
    await waitFor(() => expect(scopeText()).toBe('Issue PAN-9 · Fix the gate'))
    rerender(wrap(<WorkDock {...props({ activePane: chatPane, conversations: conversations() })} />))
    await waitFor(() => expect(scopeText()).toBe('For Fix the bug · Project P · main'))
    expect(useWorkDockStore.getState().byDeck[DECK].rootOverride).toBeUndefined()
    expect(screen.queryByRole('button', { name: 'Follow the active tab' })).toBeNull()
  })

  it('drops an unhandled reveal when the scope changes before the Files tab shows', async () => {
    const { rerender } = render(wrap(<WorkDock {...props({ activePane: issuePane, conversations: conversations() })} />))
    act(() => useWorkDockStore.getState().openDock(DECK, { tab: 'changes' }))
    await waitFor(() => expect(scopeText()).toBe('Issue PAN-9 · Fix the gate'))
    // A reveal request that the Files tab never handled (the dock is on Changes).
    act(() => useWorkDockStore.setState((s) => ({ byDeck: { ...s.byDeck, [DECK]: { ...s.byDeck[DECK], reveal: { rootId: 'issue:PAN-9', path: 'x.ts' } } } })))
    rerender(wrap(<WorkDock {...props({ activePane: homePane, conversations: conversations() })} />))
    await waitFor(() => expect(useWorkDockStore.getState().byDeck[DECK].reveal).toBeUndefined())
    act(() => useWorkDockStore.getState().setTab(DECK, 'files'))
    expect(screen.getByTestId('explorer-files')).toHaveTextContent('project:p')
    expect(useWorkDockStore.getState().byDeck[DECK].rootOverride).toBeUndefined()
  })

  it('revealFile on the deck root, when the dock has no root, points the dock there anchored to the active pane', async () => {
    const outside = [conv({ name: 'c1', cwd: '/srv/elsewhere' })]
    render(wrap(<WorkDock {...props({ activePane: chatPane, conversations: outside })} />))
    openDock('changes')
    act(() => useWorkDockStore.getState().setTab(DECK, 'files'))
    // The deck root is known once Open project files is offered.
    await screen.findByRole('button', { name: 'Open project files' })
    act(() => useActiveDock.getState().current?.revealFile('README.md'))
    expect(useWorkDockStore.getState().byDeck[DECK]).toMatchObject({ rootOverride: 'project:p', rootOverrideAnchor: 'a1', tab: 'files' })
    await waitFor(() => expect(screen.getByTestId('explorer-files')).toHaveTextContent('project:p'))
    await waitFor(() => expect(useWorkDockStore.getState().byDeck[DECK].reveal).toBeUndefined())
  })
})

describe('WorkDock changed paths', () => {
  it('publishes the same changed paths the Files tab passes to the tree', async () => {
    const withChanges = {
      ...NO_CHANGES,
      uncommitted: [{ path: 'src/a.ts', status: 'M', additions: 1, deletions: 0, attribution: 'file', turnIds: [] }],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/registered-projects') return Response.json(PROJECTS)
        if (url === '/api/workspace-registry') return Response.json({ workspaces: [] })
        if (url.includes('/changes?scope=conversation')) return Response.json(withChanges)
        return Response.json([])
      }),
    )
    render(wrap(<WorkDock {...props({ activePane: chatPane, conversations: [conv({ name: 'c1' })] })} />))
    openDock()
    await waitFor(() => expect(screen.getByTestId('explorer-files')).toHaveAttribute('data-changed', 'src/a.ts'))
    expect([...(useActiveDock.getState().current?.changedPaths ?? [])]).toEqual(['src/a.ts'])
  })
})

describe('WorkDock in the Stage', () => {
  beforeEach(() => {
    usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} })
    useTerminalStateStore.setState({ terminalStateByThreadId: {} })
  })

  it('keeps both leaves of a split deck when the dock opens, and registers the deck', () => {
    usePanesStore.getState().ensureHome(DECK)
    const home = (usePanesStore.getState().panesByWorkspace[DECK] ?? [])[0]?.paneId ?? ''
    const agent = usePanesStore.getState().addPane(DECK, { paneType: 'agent', label: 'Chat', conversationId: 'c1' })
    usePanesStore.getState().setActivePane(DECK, agent)
    localStorage.setItem(
      `pan-layout:${DECK}`,
      JSON.stringify({ kind: 'split', dir: 'row', ratio: 0.5, a: { kind: 'leaf', paneId: agent }, b: { kind: 'leaf', paneId: home } }),
    )
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { unmount } = render(
      <QueryClientProvider client={qc}>
        <Stage deckKey={DECK} conversations={[conv({ name: 'c1' })]} renderHome={() => <div data-testid="home" />} renderIssue={(id: string) => <div>{id}</div>} />
      </QueryClientProvider>,
    )
    openDock()
    expect(screen.getByTestId('work-dock')).toBeInTheDocument()
    expect(screen.getByTestId('agent-pane')).toBeInTheDocument()
    expect(screen.getByTestId('home')).toBeInTheDocument()
    expect(useActiveDock.getState().current?.deckKey).toBe(DECK)
    unmount()
    expect(useActiveDock.getState().current).toBeNull()
  })
})
