import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { Stage, type StageApi } from './index'
import { usePanesStore } from '../../lib/panesStore'

// AgentPane pulls in ConversationPanel (heavy, needs many providers); stub it so
// this test stays focused on the Stage's pane open/switch mechanics.
vi.mock('./panes/AgentPane', () => ({
  AgentPane: () => <div data-testid="agent-pane" />,
}))

const DECK = 'panopticon'

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

  it('switching the active pane swaps the rendered body', () => {
    const { container } = renderStage(<Stage deckKey={DECK} renderHome={renderHome} renderIssue={renderIssue} />)

    // Open a second pane via the + button → terminal becomes active. The new
    // terminal pane has no session, so TerminalPane shows its empty state.
    fireEvent.click(screen.getByLabelText('Open new pane'))
    expect(screen.getByText(/no terminal session/i)).toBeTruthy()
    expect(screen.getAllByRole('tab')).toHaveLength(2)

    // Switch back to HOME — the project home body renders again.
    const homeTab = screen.getAllByRole('tab')[0]
    fireEvent.click(homeTab)
    expect(homeTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText(/no terminal session/i)).toBeNull()
    expect(container.querySelector('[data-section="header"]')).not.toBeNull()
  })

  it('opens (and focuses) an agent pane via the StageApi', async () => {
    renderStage(<Stage deckKey={DECK} renderHome={renderHome} renderIssue={renderIssue} />)
    fireEvent.click(screen.getByRole('button', { name: /open agent/ }))
    await screen.findByRole('tab', { name: /Agent/ })
    expect(screen.getAllByRole('tab')).toHaveLength(2)
  })
})
