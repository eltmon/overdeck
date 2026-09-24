import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../CommandDeck/ZoneCOverviewTabs/queries', () => ({
  useWorkspaceQuery: () => ({
    isLoading: false,
    data: { exists: true, issueId: 'PAN-1', path: '/w/feature-pan-1', agentSessionId: 'agent-pan-1' },
  }),
}))
vi.mock('../../IssueActionMenu/useIssueActions', () => ({
  useIssueActions: () => ({ all: [] }),
}))
vi.mock('../../CommandDeck/UatStackStatus', () => ({
  UatStackStatus: () => null,
  getUatStackSummary: () => null,
}))

import { WorkspaceCard } from './WorkspaceCard'

describe('WorkspaceCard attach hint', () => {
  it('points at the Terminal tab instead of guessing a tmux command', () => {
    render(<WorkspaceCard issueId="PAN-1" />)
    const attach = screen.getByText('agent-pan-1')
    expect(attach).toHaveAttribute('title', "Open the agent's Terminal tab to attach")
    expect(attach.getAttribute('title')).not.toContain('tmux')
  })
})
