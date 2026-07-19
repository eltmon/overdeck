import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PaneType } from '../../../lib/panesStore'

const actionInvoke = vi.fn()
let queryClient: QueryClient | undefined
let unexpectedRequests: string[] = []

beforeEach(() => {
  window.localStorage.clear()
  actionInvoke.mockClear()
  queryMocks.activityQuery.data.sections = [
    { type: 'work', sessionId: 'agent-pan-1661', model: 'gpt-5.5', status: 'completed', startedAt: '2026-06-07T00:00:00Z', duration: 1 },
  ]
  queryMocks.reviewStatusQuery.data.verificationStatus = 'passed'
  unexpectedRequests = []
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    if (method !== 'GET') {
      unexpectedRequests.push(`${method} ${url}`)
      return Response.json({}, { status: 500 })
    }
    if (url === '/api/issues/resource-allocated') {
      return Response.json([])
    }
    if (url === '/api/workspaces/PAN-1661/plan') {
      return Response.json({ plan: { items: [] } })
    }
    if (url === '/api/issues/PAN-1661/tasks') {
      return Response.json({
        issueId: 'PAN-1661',
        workspacePath: '/workspace',
        tasks: [
          { id: 'done-1', title: 'Done one', status: 'completed', labels: [], blockedBy: [] },
          { id: 'done-2', title: 'Done two', status: 'closed', labels: [], blockedBy: [] },
          { id: 'working', title: 'Working', status: 'running', labels: [], blockedBy: [] },
          { id: 'upcoming-1', title: 'Upcoming one', status: 'planned', labels: [], blockedBy: [] },
          { id: 'upcoming-2', title: 'Upcoming two', status: 'open', labels: [], blockedBy: [] },
        ],
      })
    }
    unexpectedRequests.push(`${method} ${url}`)
    return Response.json({}, { status: 500 })
  }))
})

afterEach(async () => {
  await queryClient?.cancelQueries()
  cleanup()
  queryClient?.clear()
  queryClient = undefined
  const requests = unexpectedRequests
  vi.unstubAllGlobals()
  expect(requests).toEqual([])
})

const queryMocks = vi.hoisted(() => {
  const activityQuery = {
    data: {
      sections: [
        { type: 'work', sessionId: 'agent-pan-1661', model: 'gpt-5.5', status: 'completed', startedAt: '2026-06-07T00:00:00Z', duration: 1 },
      ],
    },
  }
  const issueCheckRunsQuery = {
    isLoading: false,
    data: {
      issueId: 'PAN-1661',
      pr: { number: 1661, url: 'https://github.com/eltmon/overdeck/pull/1661', headRefName: 'feature/pan-1661', mergeable: 'MERGEABLE', statusCheckRollup: [] },
      checkRuns: [{ id: 1, name: 'lint', status: 'completed', conclusion: 'success', htmlUrl: 'https://github/checks/1' }],
      summary: { total: 1, passed: 1, failed: 0, running: 0, skipped: 0, pending: 0, cancelled: 0 },
    },
  }
  const planningQuery = { data: { prd: '# PRD', state: '# STATE' }, isLoading: false }
  const prQuery = { data: { pr: { number: 1661, additions: 4, deletions: 1, changedFiles: 2, isDraft: false, state: 'OPEN' } } }
  const reviewStatusQuery = {
    data: {
      issueId: 'PAN-1661',
      reviewStatus: 'blocked',
      testStatus: 'pending',
      mergeStatus: 'pending',
      verificationStatus: 'passed',
      reviewNotes: 'Security blocker',
      readyForMerge: false,
      updatedAt: '2026-06-07T00:00:00Z',
    },
  }
  const issueCostsQuery = { data: { totalCost: 1.23, totalTokens: 1000, byModel: {}, sessions: [] } }
  const workspaceQuery = { data: null, isLoading: false }
  const shipLogQuery = { data: null, isLoading: false }
  return { activityQuery, issueCheckRunsQuery, planningQuery, prQuery, reviewStatusQuery, issueCostsQuery, workspaceQuery, shipLogQuery }
})

vi.mock('../../CommandDeck/ZoneCOverviewTabs/queries', () => ({
  useActivityQuery: () => queryMocks.activityQuery,
  useIssueCheckRunsQuery: () => queryMocks.issueCheckRunsQuery,
  usePlanningQuery: () => queryMocks.planningQuery,
  usePrQuery: () => queryMocks.prQuery,
  useReviewStatusQuery: () => queryMocks.reviewStatusQuery,
  useIssueCostsQuery: () => queryMocks.issueCostsQuery,
  useWorkspaceQuery: () => queryMocks.workspaceQuery,
  useShipLogQuery: () => queryMocks.shipLogQuery,
}))

vi.mock('../../../lib/issueActions', () => ({
  GROUP_LABELS: {
    communicate: 'Communicate',
    lifecycle: 'Lifecycle',
    recover: 'Recover',
    inspect: 'Inspect',
    navigation: 'Navigate',
    danger: 'Danger',
  },
  GROUP_ORDER: ['communicate', 'lifecycle', 'recover', 'inspect', 'navigation', 'danger'],
  ISSUE_ACTIONS: [
    { key: 'plan', label: 'Plan', description: 'Plan this issue.', group: 'lifecycle', kind: 'dialog' },
    { key: 'startAgent', label: 'Start agent', description: 'Start work on this issue.', group: 'lifecycle', kind: 'dialog' },
    { key: 'tell', label: 'Tell agent', description: 'Send the agent a message.', group: 'communicate', kind: 'dialog' },
    { key: 'wipe', label: 'Wipe', description: 'Erase this issue.', group: 'danger', kind: 'destructive' },
  ],
}))

vi.mock('../../IssueActionMenu/useIssueActions', () => ({
  useIssueActions: () => {
    const all = [
      { action: { key: 'plan', label: 'Plan', description: 'Plan this issue.', group: 'lifecycle', kind: 'dialog' }, enabled: true, isPending: false, invoke: actionInvoke },
      { action: { key: 'startAgent', label: 'Start agent', description: 'Start work on this issue.', group: 'lifecycle', kind: 'dialog' }, enabled: true, isPending: false, invoke: actionInvoke },
      { action: { key: 'tell', label: 'Tell agent', description: 'Send the agent a message.', group: 'communicate', kind: 'dialog' }, enabled: true, isPending: false, invoke: actionInvoke },
      { action: { key: 'merge', label: 'Merge to main', description: 'Merge the approved branch.', group: 'lifecycle', kind: 'safe' }, enabled: false, disabledReason: 'Merge is available once review has approved and the PR is mergeable.', isPending: false, invoke: actionInvoke },
      { action: { key: 'wipe', label: 'Wipe', description: 'Erase this issue.', group: 'danger', kind: 'destructive' }, enabled: false, disabledReason: 'Wipe is unavailable.', isPending: false, invoke: actionInvoke },
    ]
    return {
      all,
      primary: all.slice(0, 2),
      secondary: all.slice(2, 4),
      overflow: all.slice(4),
      phase: 'WORK_RUNNING',
      state: { hasPlan: true, hasBeads: true },
      activeDialog: null,
    }
  },
}))

vi.mock('../../MergeButton', () => ({ MergeButton: () => <div>Merge button</div> }))
vi.mock('../../ReviewPolicyControl', () => ({ ReviewPolicyControl: () => <div>Review policy</div> }))
vi.mock('../../issue-view/StartAgentCta', () => ({ StartAgentCta: () => <div>Start agent</div> }))
vi.mock('../../drawer/DrawerReviewSpecialists', () => ({ default: () => <div>Review specialists</div> }))
vi.mock('../../drawer/DrawerArtifactsPanel', () => ({ default: () => <div>Artifacts panel</div> }))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/ActivityTab', () => ({ ActivityTab: () => <div>Activity tab</div> }))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/BeadsTab', () => ({ BeadsTab: () => <div>Beads tab</div> }))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/TasksTab', () => ({ TasksTab: () => <div>Tasks tab</div> }))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/CostsTab', () => ({ CostsTab: () => <div>Costs tab</div> }))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/DiscussionsTab', () => ({ DiscussionsTab: () => <div>Discussions tab</div> }))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/MarkdownTab', () => ({ MarkdownTab: ({ body }: { body?: string }) => <div>{body ?? 'Markdown tab'}</div> }))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/PrDiffTab', () => ({
  PrDiffTab: () => <div>PR diff tab</div>,
  statusColor: () => ({ bg: 'transparent', fg: 'currentColor', label: 'pass' }),
}))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/XBriefTab', () => ({ XBriefTab: () => <div>xBRIEF tab</div> }))
vi.mock('../../CommandDeck/SessionView/SessionPanel', () => ({
  SessionPanel: ({ session }: { session: { sessionId: string } }) => <div data-testid="session-panel">{session.sessionId}</div>,
}))
vi.mock('./ReviewVerificationCard', () => ({ ReviewVerificationCard: () => <div>Review card</div> }))
vi.mock('./StatusHistoryTab', () => ({ StatusHistoryTab: () => <div>Status history</div> }))
vi.mock('./IssueBlockerSpotlight', () => ({ IssueBlockerSpotlight: () => <div>Blocker spotlight</div> }))
vi.mock('./AgentsLane', () => ({ AgentsLane: () => <div>Agents lane</div> }))
vi.mock('./TasksRail', async () => {
  const actual = await vi.importActual<typeof import('./TasksRail')>('./TasksRail')
  return {
    ...actual,
    TasksRail: ({ onOpenFull }: { onOpenFull: () => void }) => (
      <div data-testid="tasks-rail">
        Tasks rail
        <button type="button" onClick={onOpenFull}>Open full tasks view</button>
      </div>
    ),
  }
})
vi.mock('./PickupGateCard', () => ({ PickupGateCard: () => <div>Pickup gate</div> }))
vi.mock('./ChangedFilesView', () => ({ ChangedFilesView: () => <div>Changed files</div> }))

import { IssueMissionControl } from './IssueMissionControl'

function renderMissionControl(extra?: { onOpenPane?: (pane: string) => void }) {
  const onOpenPane = extra?.onOpenPane ?? vi.fn()
  const client = new QueryClient({
    defaultOptions: {
      queries: { gcTime: 0, retry: false },
      mutations: { retry: false },
    },
  })
  queryClient = client
  const view = render(
    <QueryClientProvider client={client}>
      <IssueMissionControl
        issueId="PAN-1661"
        title="Mission control"
        branch="feature/pan-1661"
        launcher={<div>Launcher</div>}
        agentDock={<div>Agent dock</div>}
        actionDock={<div>Action dock</div>}
        timeline={<div>Timeline</div>}
        onOpenPane={onOpenPane as (pane: PaneType) => void}
      />
    </QueryClientProvider>,
  )
  return { onOpenPane, ...view }
}

describe('IssueMissionControl', () => {
  it('renders cockpit inventory markers on the real overview shell', () => {
    const { container } = renderMissionControl();
    for (const section of ['Header bar', 'StatusNarrative', 'Pipeline Band', 'AgentsLane', 'Detail Tabs', 'TasksRail / TasksTab', 'Awareness rail', 'UatEnvironmentPanel', 'NowPanel', 'PickupGateCard', 'ReviewPolicyControl']) {
      expect(container.querySelector(`[data-section="${section}"]`), section).toBeInTheDocument();
    }
  });
  it('renders the mission header, issue tree, and persistent top tabs', () => {
    renderMissionControl()

    expect(screen.getByRole('heading', { name: 'Mission control' })).toBeTruthy()
    expect(screen.getAllByText('PAN-1661').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Issue tree')).toBeTruthy()
    expect(screen.getByTestId('status-narrative')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Overview' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /Code/ }).length).toBeGreaterThan(0)
    expect(screen.getByText('Blocker spotlight')).toBeTruthy()
  })

  it('lifts the detail tabs between the header and body without wrapping', () => {
    const { container } = renderMissionControl()
    const header = container.querySelector('[data-section="Header bar"]')
    const nav = screen.getByRole('navigation', { name: 'Issue cockpit tabs' })

    expect(container.querySelectorAll('[data-section="Detail Tabs"]')).toHaveLength(1)
    expect(header?.nextElementSibling).toBe(nav)
    expect(nav.nextElementSibling?.querySelector('main')).toBeInTheDocument()
    expect(nav.closest('main')).toBeNull()
    expect(nav).toHaveClass('flex-nowrap', 'overflow-x-auto')
    expect(nav).not.toHaveClass('flex-wrap')
  })

  it('renders every detail tab and badge with the pill treatment', () => {
    renderMissionControl()
    const nav = screen.getByRole('navigation', { name: 'Issue cockpit tabs' })
    const buttons = Array.from(nav.querySelectorAll('button[aria-selected]'))

    expect(buttons).toHaveLength(10)
    for (const label of ['Overview', 'Code', 'PRD / Plan', 'Timeline', 'Discussion', 'Costs', 'Artifacts', 'Ship', 'Files', 'Terminal']) {
      expect(buttons.some((button) => button.textContent?.includes(label)), label).toBe(true)
    }
    expect(screen.queryByRole('button', { name: 'Conversation' })).toBeNull()
    expect(screen.getByRole('button', { name: /Code/ })).toHaveTextContent('✓')
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveClass('rounded-[9px]', 'font-medium', 'bg-primary/9', 'text-primary')
    for (const button of buttons) expect(button).not.toHaveClass('font-semibold')
  })

  it('shows the shared task rollup in an always-visible tab-band chip', async () => {
    const { container } = renderMissionControl()
    const chip = await screen.findByRole('button', {
      name: 'Tasks: 2 of 5 complete. Open plan progress',
    })

    expect(chip).toHaveAttribute('data-section', 'TasksRail / TasksTab')
    expect(chip).toHaveTextContent('Tasks')
    expect(chip).toHaveTextContent('2/5')
    expect(chip).toHaveClass('sticky', 'right-0', 'ml-auto', 'badge-bg-primary', 'badge-border-primary')
    expect(chip).not.toHaveClass('rounded-full')
    expect(chip.querySelector('[style="width: 40%;"]')).toBeInTheDocument()

    const missionBody = container.querySelector('main')?.parentElement
    expect(missionBody?.children).toHaveLength(2)
    expect(screen.queryByTestId('tasks-rail')).toBeNull()
  })

  it('persists the collapsible agent spine and defaults to expanded without a saved choice', () => {
    const firstView = renderMissionControl()
    const firstBody = firstView.container.querySelector('[data-spine-collapsed]')
    const collapse = screen.getByRole('button', { name: 'Collapse agent spine' })

    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    expect(firstBody).toHaveAttribute('data-spine-collapsed', 'false')
    expect(firstBody?.className).not.toContain('spineCollapsed')

    fireEvent.click(collapse)

    expect(screen.getByRole('button', { name: 'Expand agent spine' })).toHaveAttribute('aria-expanded', 'false')
    expect(firstBody).toHaveAttribute('data-spine-collapsed', 'true')
    expect(firstBody?.className).toContain('spineCollapsed')
    expect(window.localStorage.getItem('overdeck.cockpit.spineCollapsed')).toBe('true')

    firstView.unmount()
    queryClient?.clear()
    const restoredView = renderMissionControl()
    const restoredBody = restoredView.container.querySelector('[data-spine-collapsed]')

    expect(screen.getByRole('button', { name: 'Expand agent spine' })).toHaveAttribute('aria-expanded', 'false')
    expect(restoredBody).toHaveAttribute('data-spine-collapsed', 'true')
    expect(restoredBody?.className).toContain('spineCollapsed')

    restoredView.unmount()
    queryClient?.clear()
    window.localStorage.removeItem('overdeck.cockpit.spineCollapsed')
    const resetView = renderMissionControl()
    const resetBody = resetView.container.querySelector('[data-spine-collapsed]')

    expect(screen.getByRole('button', { name: 'Collapse agent spine' })).toHaveAttribute('aria-expanded', 'true')
    expect(resetBody).toHaveAttribute('data-spine-collapsed', 'false')
    expect(resetBody?.className).not.toContain('spineCollapsed')
  })

  it('keeps the stale-review warning visible and actionable in the collapsed spine', () => {
    queryMocks.activityQuery.data.sections.push({
      type: 'reviewer',
      sessionId: 'reviewer-pan-1661',
      model: 'claude-sonnet-5',
      status: 'completed',
      startedAt: '2026-06-07T00:01:00Z',
      duration: 1,
    })
    const { container } = renderMissionControl()

    expect(container.querySelector('[data-section="Stale-review warning"]')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Complete review reset' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse agent spine' }))

    expect(container.querySelector('[data-section="Stale-review warning"]')).toBeVisible()
    const compactWarning = screen.getByRole('button', {
      name: 'Stale review state: 1 leftover review agent. Expand agent spine for details and reset.',
    })
    expect(compactWarning).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Complete review reset' })).toBeNull()

    fireEvent.click(compactWarning)

    expect(screen.getByRole('button', { name: 'Collapse agent spine' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Complete review reset' })).toBeInTheDocument()
  })

  it('opens task progress in a drawer and preserves every close and full-view path', async () => {
    renderMissionControl()
    const chip = await screen.findByRole('button', {
      name: 'Tasks: 2 of 5 complete. Open plan progress',
    })

    fireEvent.click(chip)
    expect(screen.getByRole('dialog', { name: 'Plan progress' })).toBeInTheDocument()
    expect(screen.getByTestId('tasks-rail')).toBeInTheDocument()
    expect(chip).toHaveAttribute('aria-expanded', 'true')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Plan progress' })).toBeNull()

    fireEvent.click(chip)
    fireEvent.click(screen.getByRole('button', { name: 'Close plan progress' }))
    expect(screen.queryByRole('dialog', { name: 'Plan progress' })).toBeNull()

    fireEvent.click(chip)
    fireEvent.click(screen.getByRole('button', { name: 'Open full tasks view' }))
    expect(screen.queryByRole('dialog', { name: 'Plan progress' })).toBeNull()
    expect(screen.getByText('Tasks tab')).toBeInTheDocument()
  })

  it('renders the status narrative + journey strip in place of the chip and gate rows (PAN-2398)', () => {
    renderMissionControl()

    // ONE status representation: plain-language narrative + 5-stage journey.
    expect(screen.getByTestId('status-narrative')).toBeTruthy()
    expect(screen.getByTestId('journey-strip')).toBeTruthy()
    expect(screen.getByText('Building')).toBeTruthy()
    expect(screen.getByText('Reviewing')).toBeTruthy()
    expect(screen.getByText('Shipping')).toBeTruthy()
    // the fixture's review is blocked — the narrative says so in plain words
    expect(screen.getByText('The reviewer found problems')).toBeTruthy()
    // the old jargon rows are gone
    expect(screen.queryByTestId('cockpit-pipeline-progress')).toBeNull()
    expect(screen.queryByTestId('cockpit-gates')).toBeNull()
    expect(screen.queryByText('Merge-ready')).toBeNull()
    // merge surfaces through the shared registry menu as a disabled row with reason
    fireEvent.click(screen.getByTestId('issue-action-overflow-button'))
    expect(screen.getByTestId('issue-action-disabled-merge')).toHaveAttribute(
      'title',
      'Merge is available once review has approved and the PR is mergeable.',
    )
    // breadcrumb context
    expect(screen.getAllByText('Issues').length).toBeGreaterThan(0)
  })

  it('keeps the Overview faithful to the current cockpit summary', () => {
    renderMissionControl()

    expect(screen.getByText('Blocker spotlight')).toBeTruthy()
    expect(screen.getByText('Review blocked — awaiting the work agent')).toBeTruthy()
    fireEvent.click(screen.getByTestId('issue-action-overflow-button'))
    expect(screen.getByTestId('issue-action-disabled-merge')).toBeInTheDocument()
  })

  it('shows a selected session, then relocates the conversation cards below the issue overview', () => {
    const { container } = renderMissionControl()

    fireEvent.click(screen.getByRole('button', { name: /Building/ }))

    expect(container.querySelector('[data-section="SessionPanel"]')).toBeInTheDocument()
    expect(screen.getByTestId('session-panel')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Issue overview' }))

    const conversation = container.querySelector('[data-section="Conversation / Files / Terminal tabs"]')
    expect(conversation).toBeInTheDocument()
    expect(conversation?.previousElementSibling).toHaveTextContent('Review blocked — awaiting the work agent')
    expect(conversation).toHaveTextContent('Launcher')
    expect(conversation).toHaveTextContent('Agent dock')
    expect(conversation).toHaveTextContent('Action dock')
    expect(conversation).toHaveTextContent('Timeline')
  })

  it('caps the selected session at a centered 980px measure', () => {
    renderMissionControl()

    fireEvent.click(screen.getByRole('button', { name: /Building/ }))

    expect(screen.getByTestId('session-panel').parentElement).toHaveClass(
      'mx-auto',
      'w-full',
      'max-w-[980px]',
    )
  })

  it('keeps tabs visible but unselected when an issue-tree node drives the pane', () => {
    renderMissionControl()

    fireEvent.click(screen.getByRole('button', { name: /Building/ }))

    expect(screen.getByTestId('issue-tree-context-panel')).toBeTruthy()
    expect(screen.getByTestId('session-panel')).toBeTruthy()
    expect(screen.getByText('Issue overview')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Overview' }).getAttribute('aria-selected')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Conversation' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Issue overview' }))
    expect(screen.getByText('Review blocked — awaiting the work agent')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Overview' }))

    expect(screen.getByRole('button', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByTestId('issue-tree-context-panel')).toBeNull()
  })

  it('renders the shared issue action menu with grouped overflow and collapsed Danger disclosure', () => {
    const { container } = renderMissionControl()

    // Phase-primary strip renders inline buttons.
    expect(screen.getByTestId('issue-action-plan')).toBeInTheDocument()
    expect(screen.getByTestId('issue-action-startAgent')).toBeInTheDocument()

    // The grouped body lives behind the shared overflow button.
    fireEvent.click(screen.getByTestId('issue-action-overflow-button'))

    expect(container.querySelector('[data-issue-action-section="communicate"]')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Tell agent' })).toHaveAttribute('title', 'Send the agent a message.')
    expect(screen.queryByRole('menuitem', { name: 'Wipe' })).toBeNull()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Danger (0 available)' }))

    expect(container.querySelector('[data-issue-action-section="danger"]')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Wipe' })).toBeDisabled()
    expect(screen.getByTestId('issue-action-disabled-wipe')).toHaveAttribute('title', 'Wipe is unavailable.')
  })

  it('shows first-class CI checks from the Code tab', () => {
    renderMissionControl()

    const codeTab = screen.getAllByRole('button', { name: /Code/ }).at(-1)
    expect(codeTab).toBeTruthy()
    fireEvent.click(codeTab!)

    expect(screen.getAllByText('GitHub CI/CD').length).toBeGreaterThan(0)
    expect(screen.getByText('lint')).toBeTruthy()
    expect(screen.getAllByText('1/1 pass').length).toBeGreaterThan(0)
  })

  it('keeps file and terminal surfaces reachable through top tabs', () => {
    const { onOpenPane } = renderMissionControl()

    fireEvent.click(screen.getByRole('button', { name: 'Files' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open files pane' }))
    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open terminal' }))

    expect(onOpenPane).toHaveBeenCalledWith('files')
    expect(onOpenPane).toHaveBeenCalledWith('terminal')
  })
})
