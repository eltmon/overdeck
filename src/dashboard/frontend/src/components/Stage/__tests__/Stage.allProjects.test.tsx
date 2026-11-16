/**
 * PAN-5343: the Stage in the All projects deck. Stage.test.tsx is not in the
 * CI subset, so the All-deck Stage assertions live here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
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

const ALL = '__all-projects__'

let workDockFetch: ReturnType<typeof installWorkDockFetchMock>
beforeEach(() => {
  workDockFetch = installWorkDockFetchMock()
  flushPanesPersistence()
  localStorage.clear()
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} })
  resetDeckLayoutStore()
})
afterEach(async () => {
  await workDockFetch.assertNoUnexpectedRequests()
  vi.unstubAllGlobals()
})

function agent(id: string): WorkspacePane {
  return { paneId: id, paneType: 'agent', label: `Chat ${id}`, createdAt: 1, conversationId: `conv-${id}` }
}

function renderStage(deckKey: string): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <Stage deckKey={deckKey} renderHome={() => <div data-testid="home" />} renderIssue={(id: string) => <div>{id}</div>} />
    </QueryClientProvider>,
  )
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

