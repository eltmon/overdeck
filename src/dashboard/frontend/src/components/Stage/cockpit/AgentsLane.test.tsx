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

vi.mock('../../issue-view/AgentStepRow', () => ({
  AgentStepRow: ({ session, onClick }: { session: { sessionId: string; role?: string; type: string; model: string; duration: number | null }; onClick?: () => void }) => (
    <button type="button" data-testid={`agent-step-${session.sessionId}`} onClick={onClick}>
      {session.role ?? session.type} · {session.model} · {session.duration ?? 0}s
    </button>
  ),
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

  it('moves CrewStage into the presence header and nests the review convoy', () => {
    const onSelectSession = vi.fn()
    const sessions = [
      { type: 'work', sessionId: 'agent-pan-2842', model: 'sonnet-5', startedAt: '2026-07-31T00:00:00Z', duration: 120, status: 'running', presence: 'active' },
      { type: 'review', sessionId: 'agent-pan-2842-review', model: 'opus-5', startedAt: '2026-07-31T00:01:00Z', duration: 60, status: 'running', presence: 'active' },
      { type: 'reviewer', role: 'security', sessionId: 'agent-pan-2842-review-security', model: 'sonnet-5', startedAt: '2026-07-31T00:02:00Z', duration: 30, status: 'running', presence: 'active' },
      { type: 'reviewer', role: 'correctness', sessionId: 'agent-pan-2842-review-correctness', model: 'sonnet-5', startedAt: '2026-07-31T00:02:00Z', duration: 30, status: 'stopped', presence: 'ended' },
    ] as const

    const { container } = render(
      <AgentsLane
        issueId="PAN-2842"
        sessions={sessions}
        branch="feature/pan-2842"
        selectedSessionId={null}
        onSelectSession={onSelectSession}
        onOpenVerification={() => {}}
        onExpandSpine={() => {}}
      />,
    )

    const presenceHeader = container.querySelector('[data-section="CrewStage"]')
    expect(presenceHeader).toHaveTextContent('The crew')
    expect(presenceHeader).toHaveTextContent('3 working')
    const convoy = screen.getByTestId('review-convoy')
    expect(convoy.className).toContain('reviewChildren')
    expect(screen.getByTestId('agent-step-agent-pan-2842-review-security')).toBeInTheDocument()
    expect(screen.getByTestId('agent-step-agent-pan-2842-review-correctness')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('agent-step-agent-pan-2842-review-security'))
    expect(onSelectSession).toHaveBeenCalledWith(sessions[2])
  })
})
