import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const workspace = {
  exists: true,
  containers: {
    frontend: {
      running: true,
      health: 'healthy',
      status: 'Up 2 minutes',
    },
  },
  stackHealth: { healthy: true },
  git: {
    branch: 'feature/pan-2842',
    ahead: 2,
    behind: 0,
    dirty: false,
  },
  services: [],
}

vi.mock('../../CommandDeck/ZoneCOverviewTabs/queries', () => ({
  useIssueCostsQuery: () => ({ data: { sessions: [] } }),
  useReviewStatusQuery: () => ({
    data: {
      verificationStatus: 'passed',
      testStatus: 'pending',
    },
  }),
  useWorkspaceQuery: () => ({ data: workspace }),
}))

vi.mock('../../IssueActionMenu/useIssueActions', () => ({
  useIssueActions: () => ({ all: [] }),
}))

import { AgentsLane } from './AgentsLane'

describe('AgentsLane StackDrawer', () => {
  it('keeps stack health accessible in the collapsed spine and expands into the open drawer', () => {
    const onExpandSpine = vi.fn()
    const view = render(
      <div data-spine-collapsed="true">
        <AgentsLane
          issueId="PAN-2842"
          sessions={[]}
          branch="feature/pan-2842"
          selectedSessionId={null}
          onSelectSession={() => {}}
          onOpenVerification={() => {}}
          onExpandSpine={onExpandSpine}
        />
      </div>,
    )

    expect(document.querySelector('[data-section="StackDrawer"]')).toBeInTheDocument()
    const compactStack = screen.getByTestId('stack-compact-control')
    expect(compactStack).toHaveAccessibleName(
      'UAT stack 1/1 healthy. 2 commits ahead. 0 pull requests. Expand agent spine for details.',
    )
    expect(compactStack).toHaveAttribute(
      'title',
      'UAT stack 1/1 healthy. 2 commits ahead. 0 pull requests. Expand agent spine for details.',
    )

    fireEvent.click(compactStack)
    expect(onExpandSpine).toHaveBeenCalledOnce()

    view.rerender(
      <div data-spine-collapsed="false">
        <AgentsLane
          issueId="PAN-2842"
          sessions={[]}
          branch="feature/pan-2842"
          selectedSessionId={null}
          onSelectSession={() => {}}
          onOpenVerification={() => {}}
          onExpandSpine={onExpandSpine}
        />
      </div>,
    )

    expect(screen.getByRole('button', { name: /Stack 1 ctr/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('feature/pan-2842')).toBeInTheDocument()
  })
})
