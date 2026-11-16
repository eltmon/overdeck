/**
 * PAN-5343: the Stage in the All projects deck. Stage.test.tsx is not in the
 * CI subset, so the All-deck Stage assertions live here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('../panes/AgentPane', () => ({
  AgentPane: () => <div data-testid="agent-pane" />,
}))
vi.mock('../../terminal/TerminalDrawer', () => ({
  TerminalDrawer: () => <div data-testid="terminal-drawer" />,
}))

import { Stage } from '../index'
import { LayoutPresetBar } from '../LayoutPresetBar'
import { flushPanesPersistence, usePanesStore, type WorkspacePane } from '../../../lib/panesStore'
import { resetDeckLayoutStore, useDeckLayoutStore } from '../../../lib/deckLayoutStore'
import { presetLayout, type PaneLayout } from '../../../lib/paneLayout'
import { installWorkDockFetchMock } from '../../../test-utils/strictFetchMock'
import type { Conversation } from '../../CommandDeck/ConversationList'
import { CONVERSATION_DRAG_TYPE, useConversationDragStore } from '../conversationDragStore'

const ALL = '__all-projects__'

let workDockFetch: ReturnType<typeof installWorkDockFetchMock>
beforeEach(() => {
  workDockFetch = installWorkDockFetchMock()
  flushPanesPersistence()
  localStorage.clear()
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} })
  resetDeckLayoutStore()
  useConversationDragStore.setState({ dragging: null })
})
afterEach(async () => {
  await workDockFetch.assertNoUnexpectedRequests()
  vi.unstubAllGlobals()
})

function agent(id: string): WorkspacePane {
  return { paneId: id, paneType: 'agent', label: `Chat ${id}`, createdAt: 1, conversationId: `conv-${id}` }
}

function renderStage(deckKey: string, conversations?: Conversation[]): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  qc.setQueryData(['registered-projects'], [
    { key: 'overdeck', name: 'overdeck', path: '/p/overdeck' },
    { key: 'dfai', name: 'DFAI', path: '/p/dfai' },
  ])
  render(
    <QueryClientProvider client={qc}>
      <Stage deckKey={deckKey} conversations={conversations} renderHome={() => <div data-testid="home" />} renderIssue={(id: string) => <div>{id}</div>} />
    </QueryClientProvider>,
  )
}

function conversationOf(name: string, projectKey: string | null): Conversation {
  return {
    id: name.length, name, title: name, projectKey, cwd: projectKey ? `/p/${projectKey}` : '/tmp/x', tmuxSession: `conv-${name}`,
    status: 'active', issueId: null, createdAt: '2026-11-15T00:00:00Z', endedAt: null, lastAttachedAt: null, sessionAlive: true,
  } as Conversation
}

function renderBar(panes: WorkspacePane[], layout: PaneLayout | null, activePaneId: string | null): void {
  usePanesStore.setState({ panesByWorkspace: { [ALL]: panes }, activePaneByWorkspace: activePaneId ? { [ALL]: activePaneId } : {} })
  render(<LayoutPresetBar deckKey={ALL} panes={panes} layout={layout} activePaneId={activePaneId} />)
}

describe('LayoutPresetBar (PAN-5343 H-D7)', () => {
  it('disables presets that need more agent panes than exist', () => {
    renderBar([agent('a'), agent('b'), agent('c')], null, 'a')
    expect(screen.getByRole('button', { name: 'Grid of four' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Three columns' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'One' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('Two side by side stores the preset of the first two candidates', () => {
    renderBar([agent('a'), agent('b'), agent('c')], null, 'b')
    fireEvent.click(screen.getByRole('button', { name: 'Two side by side' }))
    // Candidates: the visible (active) pane b first, then tab order a, c.
    expect(JSON.parse(localStorage.getItem(`pan-layout:${ALL}`) ?? 'null')).toEqual(presetLayout(['b', 'a'], 2))
  })

  it('orders other candidates by focus history before tab order and activates the first when needed', () => {
    useDeckLayoutStore.getState().noteFocus(ALL, 'c')
    renderBar([agent('a'), agent('b'), agent('c'), { paneId: 'h', paneType: 'files', label: 'Files', createdAt: 1 }], presetLayout(['a', 'b'], 2), 'h')
    fireEvent.click(screen.getByRole('button', { name: 'Three columns' }))
    expect(JSON.parse(localStorage.getItem(`pan-layout:${ALL}`) ?? 'null')).toEqual(presetLayout(['a', 'b', 'c'], 3))
    expect(usePanesStore.getState().activePaneByWorkspace[ALL]).toBe('a')
  })

  it('One clears the layout', () => {
    renderBar([agent('a'), agent('b')], presetLayout(['a', 'b'], 2), 'a')
    act(() => { useDeckLayoutStore.getState().setLayout(ALL, presetLayout(['a', 'b'], 2)) })
    fireEvent.click(screen.getByRole('button', { name: 'One' }))
    expect(localStorage.getItem(`pan-layout:${ALL}`)).toBeNull()
  })

  it('presses Grid of four for a 2×2 layout', () => {
    renderBar([agent('a'), agent('b'), agent('c'), agent('d')], presetLayout(['a', 'b', 'c', 'd'], 4), 'a')
    expect(screen.getByRole('button', { name: 'Grid of four' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'One' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('Stage Layout bar (PAN-5343 H-D7)', () => {
  it('renders the Layout bar in the All projects deck', () => {
    localStorage.setItem(`pan-panes:${ALL}`, JSON.stringify([agent('a'), agent('b')]))
    renderStage(ALL)
    expect(screen.getByRole('button', { name: 'Grid of four' })).toBeInTheDocument()
  })

  it('renders no Layout bar in a project deck', () => {
    renderStage('overdeck')
    expect(screen.queryByRole('button', { name: 'Grid of four' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('layout-preset-bar')).not.toBeInTheDocument()
  })
})

describe('Stage make-only button (PAN-5343 H-D19)', () => {
  it('collapses a 2-leaf layout to the chosen pane and keeps the other tab', () => {
    localStorage.setItem('pan-panes:overdeck', JSON.stringify([
      { paneId: 'home', paneType: 'home', label: 'Home', createdAt: 1, isPermanent: true },
      agent('a'),
      agent('b'),
    ]))
    localStorage.setItem('pan-active-pane:overdeck', 'a')
    localStorage.setItem('pan-layout:overdeck', JSON.stringify(presetLayout(['a', 'b'], 2)))
    renderStage('overdeck')
    const buttons = screen.getAllByRole('button', { name: 'Make this the only pane' })
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[1]!)
    expect(localStorage.getItem('pan-layout:overdeck')).toBeNull()
    expect(usePanesStore.getState().activePaneByWorkspace.overdeck).toBe('b')
    expect(screen.queryByRole('button', { name: 'Make this the only pane' })).not.toBeInTheDocument()
    // Both agent tabs stay in the strip; the second (pane b) is the selected one.
    const agentTabs = screen.getAllByRole('tab').filter((t) => t.getAttribute('data-tab-type') === 'agent')
    expect(agentTabs).toHaveLength(2)
    expect(agentTabs[1]).toHaveAttribute('aria-selected', 'true')
    expect(agentTabs[0]).toHaveAttribute('aria-selected', 'false')
  })
})

describe('Stage conversation drop (PAN-5343 H-D8)', () => {
  it('a project deck shows no overlay for another project\'s conversation, but does for its own', () => {
    localStorage.setItem('pan-panes:overdeck', JSON.stringify([{ paneId: 'home', paneType: 'home', label: 'Home', createdAt: 1, isPermanent: true }]))
    renderStage('overdeck')
    act(() => { useConversationDragStore.getState().start({ name: 'df-model', deckKey: 'dfai' }) })
    expect(screen.queryByTestId('pane-drop-overlay')).not.toBeInTheDocument()
    act(() => { useConversationDragStore.getState().start({ name: 'od-build', deckKey: 'overdeck' }) })
    expect(screen.getByTestId('pane-drop-overlay')).toBeInTheDocument()
  })

  it('dropping on the right edge of a one-pane All deck gives two leaves', () => {
    localStorage.setItem(`pan-panes:${ALL}`, JSON.stringify([agent('a')]))
    localStorage.setItem(`pan-active-pane:${ALL}`, 'a')
    renderStage(ALL)
    act(() => { useConversationDragStore.getState().start({ name: 'conv-new', deckKey: 'dfai' }) })
    const overlay = screen.getByTestId('pane-drop-overlay')
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) })
    // happy-dom ignores clientX/clientY in a drag event's init, so set them on the event (right edge).
    const drop = createEvent.drop(overlay, { dataTransfer: { getData: (type: string) => (type === CONVERSATION_DRAG_TYPE ? 'conv-new' : '') } })
    Object.defineProperty(drop, 'clientX', { value: 95 })
    Object.defineProperty(drop, 'clientY', { value: 50 })
    fireEvent(overlay, drop)
    const layout = JSON.parse(localStorage.getItem(`pan-layout:${ALL}`) ?? 'null') as PaneLayout
    const panes = usePanesStore.getState().panesByWorkspace[ALL] ?? []
    const created = panes.find((p) => p.conversationId === 'conv-new')
    expect(layout).toEqual(presetLayout(['a', created!.paneId], 2))
    expect(useConversationDragStore.getState().dragging).toBeNull()
  })
})

describe('Stage project marks (PAN-5343 H-D9)', () => {
  const dfaiPane: WorkspacePane = { paneId: 'd', paneType: 'agent', label: 'Tune the model', createdAt: 1, conversationId: 'df-model' }
  const orphanPane: WorkspacePane = { paneId: 'n', paneType: 'agent', label: 'Scratch', createdAt: 1, conversationId: 'scratch' }

  it('marks agent tabs and split headers with their project in the All deck', () => {
    localStorage.setItem(`pan-panes:${ALL}`, JSON.stringify([dfaiPane, orphanPane]))
    localStorage.setItem(`pan-active-pane:${ALL}`, 'd')
    localStorage.setItem(`pan-layout:${ALL}`, JSON.stringify(presetLayout(['d', 'n'], 2)))
    renderStage(ALL, [conversationOf('df-model', 'dfai'), conversationOf('scratch', null)])
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]).toHaveTextContent('DF')
    expect(tabs[1]).toHaveTextContent('–')
    // Each split header carries the same mark.
    expect(screen.getAllByText('DF').length).toBeGreaterThanOrEqual(2)
  })

  it('renders no project mark on agent tabs in a project deck', () => {
    localStorage.setItem('pan-panes:dfai', JSON.stringify([{ paneId: 'home', paneType: 'home', label: 'Home', createdAt: 1, isPermanent: true }, dfaiPane]))
    localStorage.setItem('pan-active-pane:dfai', 'd')
    renderStage('dfai', [conversationOf('df-model', 'dfai')])
    const agentTab = screen.getAllByRole('tab').find((t) => t.getAttribute('data-tab-type') === 'agent')!
    expect(agentTab).not.toHaveTextContent('DF')
    expect(screen.queryByText('DF')).not.toBeInTheDocument()
  })
})

describe('Stage empty All deck (PAN-5343 H-D10)', () => {
  it('shows the empty state and no Home tab when the All deck has no panes', () => {
    renderStage(ALL)
    expect(screen.getByTestId('all-projects-empty')).toHaveTextContent('Pick conversations on the left. Ctrl+Click opens one beside another.')
    expect(screen.queryAllByRole('tab').filter((t) => t.getAttribute('data-tab-type') === 'home')).toHaveLength(0)
  })

  it('offers no "Changes in" action in the new-pane menu', () => {
    renderStage(ALL)
    fireEvent.click(screen.getByRole('button', { name: 'Open new tab' }))
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent ?? '')
    expect(items.length).toBeGreaterThan(0)
    expect(items.some((label) => label.startsWith('Changes in'))).toBe(false)
  })

  it('hides the empty state once a pane is open', () => {
    localStorage.setItem(`pan-panes:${ALL}`, JSON.stringify([agent('a')]))
    renderStage(ALL)
    expect(screen.queryByTestId('all-projects-empty')).not.toBeInTheDocument()
  })
})

