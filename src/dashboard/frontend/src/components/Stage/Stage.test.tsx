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
    // Seed an agent pane and make it active.
    usePanesStore.getState().ensureHome(WS)
    usePanesStore.getState().addPane(WS, { paneType: 'agent', label: 'Agent' })
    const { container } = render(<Stage workspaceId={WS} />)
    const body = container.querySelector('[data-pane-type]')
    expect(body).not.toBeNull()
    expect(body).toHaveAttribute('data-pane-type', 'agent')
    expect(screen.getByText(/not implemented yet/i)).toBeTruthy()
  })

  it('switching the active pane swaps the rendered body', () => {
    const { container } = render(<Stage workspaceId={WS} />)
    const activeType = () => container.querySelector('[data-pane-type]')?.getAttribute('data-pane-type')

    // Open a second pane via the + button → terminal becomes active.
    fireEvent.click(screen.getByLabelText('Open new pane'))
    expect(activeType()).toBe('terminal')
    expect(screen.getAllByRole('tab')).toHaveLength(2)

    // Switch back to HOME — rendered body changes to the HomePane scaffold.
    const homeTab = screen.getAllByRole('tab')[0]
    fireEvent.click(homeTab)
    expect(homeTab).toHaveAttribute('aria-selected', 'true')
    expect(activeType()).toBeUndefined() // terminal placeholder gone
    expect(container.querySelector('[data-section="header"]')).not.toBeNull()
  })
})
