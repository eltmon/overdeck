import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { Stage, type StageApi } from './index'
import { usePanesStore } from '../../lib/panesStore'
import { useTerminalStateStore } from '../terminal/terminalStateStore'

// AgentPane pulls in ConversationPanel (heavy, needs many providers); stub it so
// this test stays focused on the Stage's pane open/switch mechanics.
vi.mock('./panes/AgentPane', () => ({
  AgentPane: () => <div data-testid="agent-pane" />,
}))

// TerminalDrawer mounts XTerminal + fetches /api/terminals; stub it so this test
// stays focused on the Stage's pane/drawer toggle mechanics (PAN-1561).
vi.mock('../terminal/TerminalDrawer', () => ({
  TerminalDrawer: () => <div data-testid="terminal-drawer" />,
}))

const DECK = 'overdeck'

// PAN-1561: the Stage is project-scoped and composes HOME / issue tabs via
// render props. These stubs keep the test focused on pane mechanics; a HOME
// that can open an agent tab exercises the StageApi.
function renderHome(api: StageApi) {
  return (
    <div data-section="header" data-testid="project-home">
      <button type="button" onClick={() => api.openOrFocusAgentPane('conv-new', 'Agent')}>
        open agent
      </button>
    </div>
  )
}
function renderIssue(issueId: string) {
  return <div data-testid="issue-overview">{issueId}</div>
}

function renderStage(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  localStorage.clear()
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} })
  useTerminalStateStore.setState({ terminalStateByThreadId: {} })
})

describe('Stage', () => {
  it('auto-creates HOME and renders it active for a fresh deck', () => {
    renderStage(<Stage deckKey={DECK} renderHome={renderHome} renderIssue={renderIssue} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toHaveTextContent('Home')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('project-home')).toBeTruthy()
  })

  it('renders a safe placeholder for an unknown pane type (defensive default)', () => {
    usePanesStore.getState().ensureHome(DECK)
    usePanesStore.getState().addPane(DECK, { paneType: 'bogus' as never, label: 'Bogus' })
    const { container } = renderStage(<Stage deckKey={DECK} renderHome={renderHome} renderIssue={renderIssue} />)
    const body = container.querySelector('[data-pane-type]')
    expect(body).not.toBeNull()
    expect(body).toHaveAttribute('data-pane-type', 'bogus')
    expect(screen.getByText(/not implemented yet/i)).toBeTruthy()
  })

  it('renders an issue tab body via renderIssue', () => {
    usePanesStore.getState().ensureHome(DECK)
    usePanesStore.getState().addPane(DECK, { paneType: 'issue', label: 'PAN-42', issueId: 'PAN-42' })
    renderStage(<Stage deckKey={DECK} renderHome={renderHome} renderIssue={renderIssue} />)
    expect(screen.getByTestId('issue-overview')).toHaveTextContent('PAN-42')
  })

  it('switching the active pane swaps the rendered body', async () => {
    const { container } = renderStage(<Stage deckKey={DECK} renderHome={renderHome} renderIssue={renderIssue} />)

    // Open an agent pane via the StageApi → it becomes the active tab.
    fireEvent.click(screen.getByRole('button', { name: /open agent/ }))
    await screen.findByTestId('agent-pane')
    expect(screen.getAllByRole('tab')).toHaveLength(2)

    // Switch back to HOME — the project home body renders again.
    const homeTab = screen.getAllByRole('tab')[0]
    fireEvent.click(homeTab)
    expect(homeTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByTestId('agent-pane')).toBeNull()
    expect(container.querySelector('[data-section="header"]')).not.toBeNull()
  })

  it('opens (and focuses) an agent pane via the StageApi', async () => {
    renderStage(<Stage deckKey={DECK} renderHome={renderHome} renderIssue={renderIssue} />)
    fireEvent.click(screen.getByRole('button', { name: /open agent/ }))
    // The agent tab's label is derived from the live conversation (untitled →
    // "Chat <id>"); assert the pane body + tab count rather than a static label.
    await screen.findByTestId('agent-pane')
    expect(screen.getAllByRole('tab')).toHaveLength(2)
  })

  it('the + menu offers New terminal which opens the drawer (PAN-1561)', () => {
    renderStage(<Stage deckKey={DECK} renderHome={renderHome} renderIssue={renderIssue} />)
    expect(screen.queryByTestId('terminal-drawer')).toBeNull()
    // "+" opens a menu of what to create, rather than guessing.
    fireEvent.click(screen.getByLabelText('Open new tab'))
    fireEvent.click(screen.getByRole('menuitem', { name: /New terminal/ }))
    expect(screen.getByTestId('terminal-drawer')).toBeTruthy()
  })
})
