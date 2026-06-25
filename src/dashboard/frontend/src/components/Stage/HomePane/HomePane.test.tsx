import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HomePane } from './index'

describe('HomePane', () => {
  it('renders the section scaffold in mockup order', () => {
    const { container } = render(<HomePane workspaceId="PAN-1549" openPane={() => {}} />)
    const order = Array.from(container.querySelectorAll('[data-section]')).map((el) =>
      el.getAttribute('data-section'),
    )
    expect(order).toEqual(['header', 'launcher', 'agentDock', 'actionDock', 'detail', 'timeline'])
  })

  it('renders provided section content into the matching slot', () => {
    const { container } = render(
      <HomePane
        workspaceId="PAN-1549"
        openPane={() => {}}
        header={<div>My Header</div>}
        timeline={<div>My Timeline</div>}
      />,
    )
    expect(screen.getByText('My Header')).toBeTruthy()
    expect(screen.getByText('My Timeline')).toBeTruthy()
    // Content lands in the right slot.
    const header = container.querySelector('[data-section="header"]')
    expect(header).toHaveTextContent('My Header')
  })

  it('can place detail immediately after the header for project home', () => {
    const { container } = render(<HomePane workspaceId="PAN-1549" openPane={() => {}} detailFirst />)
    const order = Array.from(container.querySelectorAll('[data-section]')).map((el) =>
      el.getAttribute('data-section'),
    )
    expect(order).toEqual(['header', 'detail', 'launcher', 'agentDock', 'actionDock', 'timeline'])
  })

  it('accepts an openPane prop (the dock/launcher/timeline wiring point)', () => {
    const openPane = vi.fn()
    // Smoke: scaffold renders with the callback wired; later beads invoke it.
    expect(() =>
      render(<HomePane workspaceId="PAN-1549" openPane={openPane} />),
    ).not.toThrow()
  })
})
