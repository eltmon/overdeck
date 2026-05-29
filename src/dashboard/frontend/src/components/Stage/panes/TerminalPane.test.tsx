import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TerminalPane } from './TerminalPane'
import type { StageContext } from '../types'
import type { WorkspacePane } from '../../../lib/panesStore'

// Mock XTerminal so the test is deterministic and free of WebSocket/PTY setup.
vi.mock('../../XTerminal', () => ({
  XTerminal: ({ sessionName }: { sessionName: string }) => (
    <div data-testid="xterminal" data-session={sessionName} />
  ),
}))

const ctx: StageContext = { workspaceId: 'PAN-1549', openPane: () => {} }
const pane = (over: Partial<WorkspacePane>): WorkspacePane => ({
  paneId: 'p',
  paneType: 'terminal',
  label: 'Terminal',
  createdAt: 1,
  ...over,
})

describe('TerminalPane', () => {
  it('mounts XTerminal bound to the pane terminalId', () => {
    render(<TerminalPane pane={pane({ terminalId: 'agent-pan-1549' })} ctx={ctx} />)
    const term = screen.getByTestId('xterminal')
    expect(term).toHaveAttribute('data-session', 'agent-pan-1549')
  })

  it('renders an empty state when no session is set', () => {
    render(<TerminalPane pane={pane({ terminalId: null })} ctx={ctx} />)
    expect(screen.queryByTestId('xterminal')).toBeNull()
    expect(screen.getByText(/no terminal session/i)).toBeTruthy()
  })

  it('unmounts without throwing (tmux session survives — no kill on unmount)', () => {
    const { unmount } = render(
      <TerminalPane pane={pane({ terminalId: 'agent-pan-1549' })} ctx={ctx} />,
    )
    expect(() => unmount()).not.toThrow()
  })
})
