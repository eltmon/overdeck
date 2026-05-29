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
      <BrowserPane pane={pane({ browserInitialUrl: 'https://example.com/x' })} ctx={ctx} />,
    )
    const iframe = container.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe).toHaveAttribute('src', 'https://example.com/x')
    // Sandbox must not allow same-origin access to the dashboard DOM.
    expect(iframe?.getAttribute('sandbox')).not.toContain('allow-same-origin')
  })

  it('renders a neutral empty state when no URL is set', () => {
    const { container } = render(<BrowserPane pane={pane()} ctx={ctx} />)
    expect(container.querySelector('iframe')).toBeNull()
    expect(screen.getByText(/no web page/i)).toBeTruthy()
  })

  it('rejects non-http(s) URLs (javascript:, data:)', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'not a url']) {
      const { container } = render(<BrowserPane pane={pane({ browserInitialUrl: bad })} ctx={ctx} />)
      expect(container.querySelector('iframe')).toBeNull()
    }
  })
})
