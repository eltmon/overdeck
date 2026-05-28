import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Stage } from './index'
import { usePanesStore } from '../../lib/panesStore'

const WS = 'PAN-1549'

beforeEach(() => {
  localStorage.clear()
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} })
})

describe('Stage', () => {
  it('auto-creates HOME and renders it active for a fresh workspace', () => {
    render(<Stage workspaceId={WS} />)
    // HOME tab present and selected.
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toHaveTextContent('Home')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('renders a safe placeholder for a not-yet-implemented pane type', () => {
    // 'files' is deferred to #1550, so it still falls through to the placeholder.
    usePanesStore.getState().ensureHome(WS)
    usePanesStore.getState().addPane(WS, { paneType: 'files', label: 'Files' })
    const { container } = render(<Stage workspaceId={WS} />)
    const body = container.querySelector('[data-pane-type]')
    expect(body).not.toBeNull()
    expect(body).toHaveAttribute('data-pane-type', 'files')
    expect(screen.getByText(/not implemented yet/i)).toBeTruthy()
  })

  it('switching the active pane swaps the rendered body', () => {
    const { container } = render(<Stage workspaceId={WS} />)

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
