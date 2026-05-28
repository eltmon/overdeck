import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { Stage } from './index'
import { usePanesStore } from '../../lib/panesStore'

// The re-homed tab bodies (OverviewTab etc.) require DialogProvider + live
// data; HomePaneSections has its own test, so stub it here to keep this test
// focused on the Stage's pane mechanics.
vi.mock('./HomePane/HomePaneSections', () => ({
  HomePaneSections: () => <div data-testid="home-sections" />,
}))

const WS = 'PAN-1549'

// The composed HOME pane renders re-homed tab bodies (HomePaneSections) that
// use react-query, so the Stage must render inside a QueryClientProvider.
function renderStage(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  localStorage.clear()
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} })
})

describe('Stage', () => {
  it('auto-creates HOME and renders it active for a fresh workspace', () => {
    renderStage(<Stage workspaceId={WS} />)
    // HOME tab present and selected.
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toHaveTextContent('Home')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('renders a safe placeholder for an unknown pane type (defensive default)', () => {
    usePanesStore.getState().ensureHome(WS)
    // Inject a paneType outside the union (e.g. corrupt persisted state).
    usePanesStore.getState().addPane(WS, { paneType: 'bogus' as never, label: 'Bogus' })
    const { container } = renderStage(<Stage workspaceId={WS} />)
    const body = container.querySelector('[data-pane-type]')
    expect(body).not.toBeNull()
    expect(body).toHaveAttribute('data-pane-type', 'bogus')
    expect(screen.getByText(/not implemented yet/i)).toBeTruthy()
  })

  it('switching the active pane swaps the rendered body', () => {
    const { container } = renderStage(<Stage workspaceId={WS} />)

    // Open a second pane via the + button → terminal becomes active. The new
    // terminal pane has no session, so TerminalPane shows its empty state.
    fireEvent.click(screen.getByLabelText('Open new pane'))
    expect(screen.getByText(/no terminal session/i)).toBeTruthy()
    expect(screen.getAllByRole('tab')).toHaveLength(2)

    // Switch back to HOME — rendered body changes to the HomePane scaffold.
    const homeTab = screen.getAllByRole('tab')[0]
    fireEvent.click(homeTab)
    expect(homeTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText(/no terminal session/i)).toBeNull()
    expect(container.querySelector('[data-section="header"]')).not.toBeNull()
  })
})
