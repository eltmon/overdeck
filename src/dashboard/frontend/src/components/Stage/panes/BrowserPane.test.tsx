import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrowserPane } from './BrowserPane'
import type { StageContext } from '../types'
import type { WorkspacePane } from '../../../lib/panesStore'

const ctx: StageContext = { workspaceId: 'PAN-1549', openPane: () => {} }
const pane = (over: Partial<WorkspacePane> = {}): WorkspacePane => ({
  paneId: 'b',
  paneType: 'browser',
  label: 'Web',
  createdAt: 1,
  ...over,
})

describe('BrowserPane', () => {
  it('renders an iframe to the pane browserInitialUrl', () => {
    const { container } = render(
      <BrowserPane pane={pane({ browserInitialUrl: 'https://example.com' })} ctx={ctx} />,
    )
    const iframe = container.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe).toHaveAttribute('src', 'https://example.com')
  })

  it('renders a neutral empty state when no URL is set', () => {
    const { container } = render(<BrowserPane pane={pane()} ctx={ctx} />)
    expect(container.querySelector('iframe')).toBeNull()
    expect(screen.getByText(/no web page/i)).toBeTruthy()
  })
})
