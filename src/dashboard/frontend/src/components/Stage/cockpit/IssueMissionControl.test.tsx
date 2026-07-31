import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PaneType } from '../../../lib/panesStore'
import { useDashboardStore } from '../../../lib/store'

const actionInvoke = vi.fn()
let queryClient: QueryClient | undefined
let unexpectedRequests: string[] = []

beforeEach(() => {
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
  actionInvoke.mockClear()
  for (const action of Object.values(queryMocks.exactAgentActions)) action.mutate.mockClear()
  useDashboardStore.setState({ xbriefViewerIssueId: null })
  queryMocks.issueActionState.hasPlan = true
  queryMocks.issueActionState.hasTasks = true
  queryMocks.activityQuery.data.sections = [
    { type: 'work', sessionId: 'agent-pan-1661', model: 'gpt-5.5', status: 'completed', startedAt: '2026-06-07T00:00:00Z', duration: 1 },
  ]
  Object.assign(queryMocks.reviewStatusQuery.data, {
    reviewStatus: 'blocked',
    testStatus: 'pending',
    mergeStatus: 'pending',
    verificationStatus: 'passed',
    reviewNotes: 'Security blocker',
    readyForMerge: false,
  })
  queryMocks.prQuery.data.pr = { number: 1661, url: 'https://github.com/eltmon/overdeck/pull/1661', additions: 4, deletions: 1, changedFiles: 2, isDraft: false, state: 'OPEN' }
  queryMocks.issueCostsQuery.data.totalCost = 1.23
  queryMocks.workspaceQuery.data = null
  useDashboardStore.setState({ agentsById: {}, reviewStatusByIssueId: {} })
  Object.assign(queryMocks.issueCheckRunsQuery.data.pr!, {
    number: 1661,
    url: 'https://github.com/eltmon/overdeck/pull/1661',
    headRefName: 'feature/pan-1661',
    mergeable: 'MERGEABLE',
    statusCheckRollup: [],
  })
  Object.assign(queryMocks.issueCheckRunsQuery.data.summary, {
    total: 1,
    passed: 1,
    failed: 0,
    running: 0,
    skipped: 0,
    pending: 0,
    cancelled: 0,
  })
  unexpectedRequests = []
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    if (method !== 'GET') {
      if (url.includes('/api/dashboard/session')) return Response.json({ csrfToken: 'test-csrf' })
      if (/\/api\/agents\/[^/]+\/(tell|resume)$/.test(url)) return Response.json({ messageDelivered: true })
      unexpectedRequests.push(`${method} ${url}`)
      return Response.json({}, { status: 500 })
    }
    if (url === '/api/issues/resource-allocated') {
      return Response.json([])
    }
    if (url === '/api/workspaces/PAN-1661/plan') {
      return Response.json({
        plan: {
          items: [
            { id: 'done-1', title: 'Done one', status: 'completed' },
            { id: 'done-2', title: 'Done two', status: 'completed' },
            { id: 'working', title: 'Working', status: 'running' },
            { id: 'upcoming-1', title: 'Upcoming one', status: 'planned' },
            { id: 'upcoming-2', title: 'Upcoming two', status: 'pending' },
          ],
        },
      })
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
    if (url.includes('/api/dashboard/session')) return Response.json({ csrfToken: 'test-csrf' })
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
  const prQuery: {
    data: {
      pr: { number: number; url: string; additions: number; deletions: number; changedFiles: number; isDraft: boolean; state: string; mergeCommit?: { oid?: string } | string | null } | null
    }
  } = { data: { pr: { number: 1661, url: 'https://github.com/eltmon/overdeck/pull/1661', additions: 4, deletions: 1, changedFiles: 2, isDraft: false, state: 'OPEN' } } }
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
  const issueActionState = { hasPlan: true, hasTasks: true }
  const exactAgentActions = {
    tell: { mutate: vi.fn(), isPending: false },
    answer: { mutate: vi.fn(), isPending: false },
    recover: { mutate: vi.fn(), isPending: false },
    unpause: { mutate: vi.fn(), isPending: false },
    untroubled: { mutate: vi.fn(), isPending: false },
    unstick: { mutate: vi.fn(), isPending: false },
    merge: { mutate: vi.fn(), isPending: false },
    startWork: { mutate: vi.fn(), isPending: false },
    startPlanning: { mutate: vi.fn(), isPending: false },
  }
  return { activityQuery, issueCheckRunsQuery, planningQuery, prQuery, reviewStatusQuery, issueCostsQuery, workspaceQuery, shipLogQuery, issueActionState, exactAgentActions }
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

vi.mock('../../../lib/useSharedTick', () => ({
  useSharedTick: () => new Date('2026-06-07T00:05:00Z'),
}))

vi.mock('../../../lib/simple/useSimpleActions', () => ({
  useSimpleActions: () => queryMocks.exactAgentActions,
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
      state: { ...queryMocks.issueActionState, hasBeads: queryMocks.issueActionState.hasTasks },
      activeDialog: null,
    }
  },
}))

vi.mock('../../MergeButton', () => ({ MergeButton: () => <div>Merge button</div> }))
vi.mock('../../ReviewPolicyControl', () => ({ ReviewPolicyControl: () => <div>Review policy</div> }))
vi.mock('../../issue-view/StartAgentCta', () => ({
  StartAgentCta: ({ issueId, density }: { issueId: string; density: string }) => (
    <div data-testid="start-agent-cta" data-issue-id={issueId} data-density={density}>Start work agent · Overrides · model · harness</div>
  ),
}))
vi.mock('../../drawer/DrawerReviewSpecialists', () => ({ default: () => <div>Review specialists</div> }))
vi.mock('../../drawer/DrawerArtifactsPanel', () => ({ default: () => <div>Artifacts panel</div> }))
vi.mock('../../drawer/DrawerActivityRail', () => ({
  default: () => <div data-testid="drawer-activity-rail">Activity rail</div>,
  DrawerActivityRailView: ({ compact, limit }: { compact?: boolean; limit?: number }) => <div data-testid="drawer-activity-rail">Activity rail · {String(compact)} · {limit}</div>,
}))
vi.mock('../../PanOpenInPicker', () => ({ PanOpenInPicker: ({ openInCwd }: { openInCwd: string }) => <div data-testid="pan-open-picker">Open {openInCwd}</div> }))
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
vi.mock('../../TasksPanel', () => ({ TasksPanel: ({ issueId }: { issueId: string }) => <div data-testid="tasks-panel">Tasks for {issueId}</div> }))
vi.mock('../../PrdViewer', () => ({ PrdViewer: ({ issueId }: { issueId: string }) => <div data-testid="prd-viewer">PRD for {issueId}</div> }))
vi.mock('../../CommandDeck/SessionView/SessionPanel', () => ({
  SessionPanel: ({ session }: { session: { sessionId: string } }) => <div data-testid="session-panel">{session.sessionId}</div>,
}))
vi.mock('./ReviewVerificationCard', () => ({ ReviewVerificationCard: () => <div>Review card</div> }))
vi.mock('./StatusHistoryTab', () => ({ StatusHistoryTab: () => <div>Status history</div> }))
vi.mock('./IssueBlockerSpotlight', () => ({ IssueBlockerSpotlight: () => <div>Blocker spotlight</div> }))
vi.mock('./AgentsLane', () => ({
  AgentsLane: ({ sessions, onSelectSession }: {
    sessions?: ReadonlyArray<{ sessionId: string }>
    onSelectSession?: (session: { sessionId: string }) => void
  }) => (
    <div>
      <div>Agents lane</div>
      {(sessions ?? []).map((session) => (
        <button
          key={session.sessionId}
          type="button"
          data-testid={`lane-session-${session.sessionId}`}
          onClick={() => onSelectSession?.(session)}
        >
          {session.sessionId}
        </button>
      ))}
    </div>
  ),
}))
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
// The ONE IssueDetail pulls in the whole transcript/WS chain; these tests
// cover the cockpit chrome (tabs, header, lane). The mount contract is
// asserted via this props-recording stub.
vi.mock('../../issue-detail/IssueDetail', () => ({
  IssueDetail: (props: { issueId: string; density: string; tab: string; showTabs?: boolean }) => (
    <div
      data-testid="issue-detail-page-mock"
      data-issue-id={props.issueId}
      data-density={props.density}
      data-tab={props.tab}
      data-show-tabs={String(props.showTabs ?? true)}
    >
      {props.tab === 'conversation' ? <div data-testid="issue-detail-composer" /> : null}
    </div>
  ),
}))

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
    // A known session makes Session the default: route chrome + the ONE
    // IssueDetail at page density.
    for (const section of ['Header bar', 'StatusNarrative', 'Pipeline Band', 'AgentsLane', 'Detail Tabs', 'ReviewPolicyControl', 'Session tab']) {
      expect(container.querySelector(`[data-section="${section}"]`), section).toBeInTheDocument();
    }
    expect(container.querySelectorAll('[data-section="Pipeline Band"]')).toHaveLength(1);
    // Task progress lives inside Plan rather than in a floating tab-band chip.
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Issue cockpit tabs' })).getByRole('button', { name: 'Plan' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Tasks' }));
    expect(container.querySelector('[data-section="TasksRail / TasksTab"]')).toBeInTheDocument();
    // The cockpit's own overview sections render on its (appended) Overview tab.
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    for (const section of ['Awareness rail', 'UatEnvironmentPanel', 'NowPanel', 'PickupGateCard']) {
      expect(container.querySelector(`[data-section="${section}"]`), section).toBeInTheDocument();
    }
  });
  it('renders the mission header, issue tree, and six persistent top tabs', () => {
    renderMissionControl()

    expect(screen.getByRole('heading', { name: 'Mission control' })).toBeTruthy()
    expect(screen.getAllByText('PAN-1661').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Issue tree')).toBeTruthy()
    expect(screen.getByTestId('status-narrative')).toBeTruthy()

    const nav = screen.getByRole('navigation', { name: 'Issue cockpit tabs' })
    const buttons = Array.from(nav.querySelectorAll('button[aria-selected]'))
    expect(buttons).toHaveLength(6)
    expect(buttons.map((button) => button.textContent?.replace(/\d+\/\d+$/, ''))).toEqual([
      'Overview',
      'Session',
      'Plan',
      'Changes✓',
      'Activity',
      'Discussion',
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Overview' }))
    expect(screen.getByTestId('overview-live')).toBeInTheDocument()
  })

  it('renders one cost chip, the tracker link, and the narrative phase sentence in the header', () => {
    const { container } = renderMissionControl()
    const header = container.querySelector('[data-section="Header bar"]') as HTMLElement
    const costChip = within(header).getByTestId('header-cost-chip')
    const narrative = within(header).getByTestId('status-narrative')

    expect(within(header).getAllByText('$1.23')).toHaveLength(1)
    expect(costChip).toHaveClass('badge-bg-signal-cost', 'badge-border-signal-cost', 'tabular-nums')
    expect(within(header).queryByRole('link', { name: 'Create PR' })).toBeNull()
    expect(within(header).getByTestId('header-tracker-link')).toHaveAttribute(
      'href',
      'https://github.com/eltmon/overdeck/issues/1661',
    )
    expect(narrative).toHaveTextContent('The reviewer found problems')
    expect(narrative).toHaveAttribute('data-section', 'StatusNarrative')
  })

  it('renders a GitHub compare link when the issue has no pull request', () => {
    queryMocks.prQuery.data.pr = null
    renderMissionControl()

    expect(screen.getByRole('link', { name: 'Create PR' })).toHaveAttribute(
      'href',
      'https://github.com/eltmon/overdeck/compare/main...feature%2Fpan-1661?expand=1',
    )
  })

  it('uses the canonical PR query URL for the header chip', () => {
    Object.assign(queryMocks.issueCheckRunsQuery.data.pr!, { url: 'https://github.com/eltmon/overdeck/pull/9999' })
    renderMissionControl()

    expect(screen.getByRole('link', { name: /PR #1661/ })).toHaveAttribute(
      'href',
      'https://github.com/eltmon/overdeck/pull/1661',
    )
  })

  it('mounts the needs-you slot before the pipeline band and tabs', () => {
    Object.assign(queryMocks.activityQuery.data.sections[0]!, {
      awaitingInput: true,
      awaitingInputPrompt: 'Choose the persistence location',
    })
    const { container } = renderMissionControl()
    const header = container.querySelector('[data-section="Header bar"]')
    const slot = screen.getByTestId('needs-you-slot')
    const pipeline = container.querySelector('[data-section="Pipeline Band"]')
    const nav = screen.getByRole('navigation', { name: 'Issue cockpit tabs' })

    expect(header?.nextElementSibling).toBe(slot)
    expect(slot.nextElementSibling).toBe(pipeline)
    expect(pipeline?.nextElementSibling).toBe(nav)
    expect(slot).toHaveAttribute('data-section', 'NeedsYouSlot')
    expect(slot).toHaveTextContent('Choose the persistence location')
    expect(screen.getByRole('button', { name: 'Open conversation' })).toBeInTheDocument()
  })

  it('routes a needs-you action to the exact non-primary affected agent', () => {
    queryMocks.activityQuery.data.sections = [
      { type: 'work', sessionId: 'agent-pan-1661', model: 'gpt-5.5', status: 'running', startedAt: '2026-06-07T00:00:00Z', duration: 1 },
      {
        type: 'reviewer',
        role: 'security',
        sessionId: 'agent-pan-1661-review-security',
        model: 'claude-sonnet-5',
        status: 'stopped',
        startedAt: '2026-06-07T00:01:00Z',
        duration: 1,
        paused: true,
        pausedReason: 'operator pause',
      },
    ]
    useDashboardStore.setState({
      agentsById: {
        'agent-pan-1661': {
          id: 'agent-pan-1661',
          issueId: 'PAN-1661',
          status: 'running',
          role: 'work',
        },
        'agent-pan-1661-review-security': {
          id: 'agent-pan-1661-review-security',
          issueId: 'PAN-1661',
          status: 'stopped',
          role: 'review',
          paused: true,
          pausedReason: 'operator pause',
        },
      },
    } as Parameters<typeof useDashboardStore.setState>[0])
    renderMissionControl()

    fireEvent.click(screen.getByRole('button', { name: 'Unpause agent' }))

    expect(queryMocks.exactAgentActions.unpause.mutate).toHaveBeenCalledWith({
      agentId: 'agent-pan-1661-review-security',
    })
  })

  it('lifts the detail tabs between the header and body without wrapping', () => {
    const { container } = renderMissionControl()
    const pipeline = container.querySelector('[data-section="Pipeline Band"]')
    const nav = screen.getByRole('navigation', { name: 'Issue cockpit tabs' })

    expect(container.querySelectorAll('[data-section="Detail Tabs"]')).toHaveLength(1)
    expect(pipeline?.nextElementSibling).toBe(nav)
    expect(nav.nextElementSibling?.querySelector('main')).toBeInTheDocument()
    expect(nav.closest('main')).toBeNull()
    expect(nav).toHaveClass('flex-nowrap', 'overflow-x-auto')
    expect(nav).not.toHaveClass('flex-wrap')
  })

  it('uses Session as the default when the issue has any historical or live session', () => {
    const { container } = renderMissionControl()
    const sessionTab = screen.getByRole('button', { name: 'Session' })

    expect(sessionTab).toHaveClass('rounded-[9px]', 'font-medium', 'bg-primary/9', 'text-primary')
    expect(container.querySelector('main')).toHaveAttribute('data-active-tab', 'session')
    expect(container.querySelector('main')).toHaveAttribute('data-active-subview', 'conversation')
    expect(screen.getByTestId('issue-detail-page-mock')).toHaveAttribute('data-tab', 'conversation')
  })

  it('switches Conversation and Terminal inside Session without leaving the top-level tab', () => {
    const { container } = renderMissionControl()
    const sessionViews = screen.getByRole('tablist', { name: 'Session views' })
    const conversation = within(sessionViews).getByRole('tab', { name: 'Conversation' })
    const terminal = within(sessionViews).getByRole('tab', { name: 'Terminal' })

    expect(conversation).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('issue-detail-page-mock')).toHaveAttribute('data-tab', 'conversation')

    fireEvent.click(terminal)

    expect(screen.getByRole('button', { name: 'Session' })).toHaveAttribute('aria-selected', 'true')
    expect(container.querySelector('main')).toHaveAttribute('data-active-subview', 'terminal')
    expect(screen.getByTestId('issue-detail-page-mock')).toHaveAttribute('data-tab', 'terminal')
    expect(terminal).toHaveAttribute('aria-selected', 'true')
  })

  it('shows a blue live signal and leaves composer ownership with IssueDetail', () => {
    queryMocks.activityQuery.data.sections[0]!.status = 'running'
    const { container } = renderMissionControl()

    expect(screen.getByTestId('session-live-dot')).toHaveClass('bg-info')
    expect(screen.getAllByTestId('issue-detail-composer')).toHaveLength(1)
    expect(container.querySelector('[data-section="active-agent-panel-tell"]')).toBeNull()
  })

  it('opens the exact actor displayed by the pipeline rail', () => {
    queryMocks.activityQuery.data.sections = [
      { type: 'work', sessionId: 'agent-pan-1661-slot-1', model: 'gpt-5.5', status: 'completed', startedAt: '2026-06-07T00:00:00Z', duration: 30 },
      { type: 'work', sessionId: 'agent-pan-1661-slot-2', model: 'gpt-5.5', status: 'running', startedAt: '2026-06-07T00:01:00Z', duration: null },
    ]
    const { container } = renderMissionControl()
    const pipeline = container.querySelector('[data-section="Pipeline Band"]') as HTMLElement

    fireEvent.click(within(pipeline).getByRole('button', { name: /Work/ }))

    expect(screen.getByTestId('session-panel')).toHaveTextContent('agent-pan-1661-slot-2')
  })

  it('uses Overview as the default when the issue has no agent sessions', () => {
    queryMocks.activityQuery.data.sections = []
    queryMocks.issueActionState.hasPlan = false
    queryMocks.issueActionState.hasTasks = false

    const { container } = renderMissionControl()

    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    expect(container.querySelector('main')).toHaveAttribute('data-active-tab', 'overview')
    expect(container.querySelector('main')).not.toHaveAttribute('data-active-subview')
  })

  it('keeps the ONE IssueDetail at page density for the Session transcript', () => {
    renderMissionControl()
    const detail = screen.getByTestId('issue-detail-page-mock')
    expect(detail).toHaveAttribute('data-density', 'page')
    expect(detail).toHaveAttribute('data-tab', 'conversation')
    expect(detail).toHaveAttribute('data-issue-id', 'PAN-1661')
    expect(detail).toHaveAttribute('data-show-tabs', 'false')
  })

  it.each([
    ['conversation', 'session', 'conversation'],
    ['terminal', 'session', 'terminal'],
    ['tasks', 'plan', 'tasks'],
    ['code', 'changes', 'checks'],
    ['files', 'changes', 'files'],
    ['artifacts', 'changes', 'artifacts'],
    ['timeline', 'activity', 'history'],
    ['costs', 'overview', undefined],
    ['ship', 'overview', undefined],
  ] as const)('maps the legacy %s deep link to %s/%s', (legacyTab, expectedTab, expectedSubView) => {
    window.history.replaceState(null, '', `/?tab=${legacyTab}`)
    const { container } = renderMissionControl()
    const main = container.querySelector('main')

    expect(main).toHaveAttribute('data-active-tab', expectedTab)
    if (expectedSubView) expect(main).toHaveAttribute('data-active-subview', expectedSubView)
    else expect(main).not.toHaveAttribute('data-active-subview')
    if (legacyTab === 'ship') {
      expect(main?.querySelector('[data-section="ship-progress-full"]')).toBeInTheDocument()
    }
  })

  it('treats the new plan deep link as the plan map sub-view', () => {
    window.history.replaceState(null, '', '/?tab=plan')
    const { container } = renderMissionControl()

    expect(container.querySelector('main')).toHaveAttribute('data-active-tab', 'plan')
    expect(container.querySelector('main')).toHaveAttribute('data-active-subview', 'map')
    expect(screen.getByTestId('plan-map-card')).toBeInTheDocument()
  })

  it('moves task progress into Plan and renders Tasks, Map, PRD, and fullscreen promotion', async () => {
    const { container } = renderMissionControl()
    const cockpitTabs = screen.getByRole('navigation', { name: 'Issue cockpit tabs' })
    const planTab = within(cockpitTabs).getByRole('button', { name: 'Plan' })

    await waitFor(() => expect(planTab).toHaveTextContent('2/5'))
    expect(screen.queryByRole('button', { name: /Open plan progress/ })).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Plan progress' })).toBeNull()

    fireEvent.click(planTab)
    const planViews = screen.getByRole('tablist', { name: 'Plan views' })
    expect(screen.getByTestId('plan-map-card')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand xBRIEF full screen' }))
    expect(useDashboardStore.getState().xbriefViewerIssueId).toBe('PAN-1661')

    fireEvent.click(within(planViews).getByRole('tab', { name: 'Tasks' }))
    expect(container.querySelector('[data-section="TasksRail / TasksTab"]')).toBeInTheDocument()
    expect(screen.getByTestId('tasks-panel')).toHaveTextContent('Tasks for PAN-1661')

    fireEvent.click(within(planViews).getByRole('tab', { name: 'PRD' }))
    expect(screen.getByTestId('prd-viewer')).toHaveTextContent('PRD for PAN-1661')
    expect(within(cockpitTabs).getByRole('button', { name: 'Plan' })).toHaveAttribute('aria-selected', 'true')
  })

  it('renders Files, Checks, and Artifacts inside the Changes tab', () => {
    const { container } = renderMissionControl()
    const cockpitTabs = screen.getByRole('navigation', { name: 'Issue cockpit tabs' })
    fireEvent.click(within(cockpitTabs).getByRole('button', { name: /Changes/ }))

    const changeViews = screen.getByRole('tablist', { name: 'Change views' })
    expect(screen.getByText('Changed files')).toBeInTheDocument()
    expect(container.querySelector('[data-section="Changes tab"]')).toBeInTheDocument()

    fireEvent.click(within(changeViews).getByRole('tab', { name: 'Checks' }))
    expect(screen.getAllByText('GitHub CI/CD').length).toBeGreaterThan(0)
    expect(container.querySelector('[data-section="Changes tab"]')).toBeInTheDocument()

    fireEvent.click(within(changeViews).getByRole('tab', { name: 'Artifacts' }))
    expect(screen.getByText('Artifacts panel')).toBeInTheDocument()
    expect(container.querySelector('[data-section="Cost / Artifacts / Ship homes"]')).toBeInTheDocument()
    expect(within(cockpitTabs).getByRole('button', { name: /Changes/ })).toHaveAttribute('aria-selected', 'true')
  })

  it.each([
    [{ total: 1, passed: 0, failed: 1, running: 0 }, '!'],
    [{ total: 1, passed: 0, failed: 0, running: 1 }, '…'],
    [{ total: 1, passed: 1, failed: 0, running: 0 }, '✓'],
    [{ total: 0, passed: 0, failed: 0, running: 0 }, null],
  ] as const)('shows the truthful Changes badge for check summary %j', (summary, expectedBadge) => {
    Object.assign(queryMocks.issueCheckRunsQuery.data.summary, summary)
    renderMissionControl()

    const changes = within(screen.getByRole('navigation', { name: 'Issue cockpit tabs' }))
      .getByRole('button', { name: /Changes/ })
    expect(changes).toHaveTextContent(expectedBadge ? `Changes${expectedBadge}` : 'Changes')
    if (!expectedBadge) expect(changes.textContent).toBe('Changes')
  })

  it('renders Feed and Status history inside Activity without leaving the cockpit tab', () => {
    const { container } = renderMissionControl()
    const cockpitTabs = screen.getByRole('navigation', { name: 'Issue cockpit tabs' })
    fireEvent.click(within(cockpitTabs).getByRole('button', { name: 'Activity' }))

    const activityViews = screen.getByRole('tablist', { name: 'Activity views' })
    expect(screen.getByText('Activity tab')).toBeInTheDocument()
    expect(container.querySelector('main')).toHaveAttribute('data-active-subview', 'feed')

    fireEvent.click(within(activityViews).getByRole('tab', { name: 'Status history' }))
    expect(screen.getAllByText('Status history')).toHaveLength(2)
    expect(screen.queryByText('Activity tab')).toBeNull()
    expect(container.querySelector('main')).toHaveAttribute('data-active-subview', 'history')
    expect(within(cockpitTabs).getByRole('button', { name: 'Activity' })).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps the legacy Timeline deep link on Activity status history', () => {
    window.history.replaceState(null, '', '/?tab=timeline')
    const { container } = renderMissionControl()

    expect(container.querySelector('main')).toHaveAttribute('data-active-tab', 'activity')
    expect(container.querySelector('main')).toHaveAttribute('data-active-subview', 'history')
    expect(screen.getAllByText('Status history')).toHaveLength(2)
  })

  it('renders the six-card awareness rail and routes its cost and activity links', () => {
    queryMocks.workspaceQuery.data = {
      exists: true,
      issueId: 'PAN-1661',
      path: '/workspace/feature-pan-1661',
      services: [],
    }
    useDashboardStore.setState({
      agentsById: {
        'agent-pan-1661': {
          id: 'agent-pan-1661',
          issueId: 'PAN-1661',
          status: 'running',
          runtime: 'claude-code',
          model: 'gpt-5.5',
          role: 'work',
          startedAt: '2026-06-07T00:00:00Z',
        },
      },
    })
    const { container } = renderMissionControl()
    const rail = container.querySelector('[data-section="Awareness rail"]') as HTMLElement

    for (const testId of [
      'right-rail-now',
      'run-details-card',
      'right-rail-gates',
      'right-rail-cost',
      'right-rail-environment',
      'right-rail-activity',
    ]) {
      expect(within(rail).getByTestId(testId), testId).toBeInTheDocument()
    }
    expect(within(rail).getByText('Work')).toBeInTheDocument()
    expect(within(rail).getByText('gpt-5.5')).toBeInTheDocument()
    expect(within(rail).getByText('claude-code')).toBeInTheDocument()
    expect(within(rail).getByText('/workspace/feature-pan-1661')).toBeInTheDocument()
    expect(within(rail).getByTestId('pan-open-picker')).toBeInTheDocument()
    expect(within(rail).getByText('1,000 tokens')).toBeInTheDocument()
    expect(within(rail).getByTestId('drawer-activity-rail')).toHaveTextContent('true · 3')
    expect(rail.querySelector('time')).toHaveAttribute('datetime', '2026-06-07T00:00:00Z')

    fireEvent.click(within(rail).getByRole('button', { name: 'All costs →' }))
    const costDialog = screen.getByRole('dialog', { name: 'Cost breakdown' })
    expect(within(costDialog).getByText('Costs tab')).toBeInTheDocument()

    fireEvent.click(within(costDialog).getByRole('button', { name: 'Close' }))
    fireEvent.click(within(rail).getByRole('button', { name: 'All activity →' }))
    expect(container.querySelector('main')).toHaveAttribute('data-active-tab', 'activity')
    expect(container.querySelector('main')).toHaveAttribute('data-active-subview', 'feed')
    expect(screen.getByText('Activity tab')).toBeInTheDocument()
  })

  it('persists the collapsible agent spine and defaults to collapsed without a saved choice (#2962)', () => {
    const firstView = renderMissionControl()
    const firstBody = firstView.container.querySelector('[data-spine-collapsed]')
    const expand = screen.getByRole('button', { name: 'Expand agent spine' })

    // Operator decision: the lane starts collapsed behind the toggle.
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    expect(firstBody).toHaveAttribute('data-spine-collapsed', 'true')
    expect(firstBody?.className).toContain('spineCollapsed')

    fireEvent.click(expand)

    expect(screen.getByRole('button', { name: 'Collapse agent spine' })).toHaveAttribute('aria-expanded', 'true')
    expect(firstBody).toHaveAttribute('data-spine-collapsed', 'false')
    expect(firstBody?.className).not.toContain('spineCollapsed')
    expect(window.localStorage.getItem('overdeck.cockpit.spineCollapsed')).toBe('false')

    firstView.unmount()
    queryClient?.clear()
    const restoredView = renderMissionControl()
    const restoredBody = restoredView.container.querySelector('[data-spine-collapsed]')

    expect(screen.getByRole('button', { name: 'Collapse agent spine' })).toHaveAttribute('aria-expanded', 'true')
    expect(restoredBody).toHaveAttribute('data-spine-collapsed', 'false')
    expect(restoredBody?.className).not.toContain('spineCollapsed')

    restoredView.unmount()
    queryClient?.clear()
    window.localStorage.removeItem('overdeck.cockpit.spineCollapsed')
    const resetView = renderMissionControl()
    const resetBody = resetView.container.querySelector('[data-spine-collapsed]')

    expect(screen.getByRole('button', { name: 'Expand agent spine' })).toHaveAttribute('aria-expanded', 'false')
    expect(resetBody).toHaveAttribute('data-spine-collapsed', 'true')
    expect(resetBody?.className).toContain('spineCollapsed')
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

    // Lane starts collapsed (#2962): the compact warning shows first.
    const compactWarning = screen.getByRole('button', {
      name: 'Stale review state: 1 leftover review agent. Expand agent spine for details and reset.',
    })
    expect(compactWarning).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Complete review reset' })).toBeNull()

    fireEvent.click(compactWarning)

    // Expanded: the full warning + reset action.
    expect(container.querySelector('[data-section="Stale-review warning"]')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Complete review reset' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse agent spine' }))

    expect(screen.queryByRole('button', { name: 'Complete review reset' })).toBeNull()
    expect(screen.getByRole('button', {
      name: 'Stale review state: 1 leftover review agent. Expand agent spine for details and reset.',
    })).toBeVisible()
  })

  it('renders the status narrative in place of the chip and gate rows (PAN-2398, C-VOCAB)', () => {
    renderMissionControl()

    // ONE status representation in the header: the plain-language narrative.
    // The shared phase rail lives inside IssueDetail (its own tests cover it).
    expect(screen.getByTestId('status-narrative')).toBeTruthy()
    // the fixture's review is blocked — the narrative says so in plain words
    expect(screen.getByText('The reviewer found problems')).toBeTruthy()
    // the old jargon rows are gone
    expect(screen.queryByTestId('cockpit-pipeline-progress')).toBeNull()
    expect(screen.queryByTestId('cockpit-gates')).toBeNull()
    expect(screen.queryByTestId('journey-strip')).toBeNull()
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

  it('derives pipeline state and Ship progress from the same preferred review snapshot', () => {
    useDashboardStore.setState({
      reviewStatusByIssueId: {
        'PAN-1661': {
          issueId: 'PAN-1661',
          reviewStatus: 'passed',
          testStatus: 'passed',
          mergeStatus: 'merging',
          verificationStatus: 'passed',
          readyForMerge: false,
          updatedAt: '2026-06-07T00:02:00Z',
        },
      },
    } as Parameters<typeof useDashboardStore.setState>[0])
    const { container } = renderMissionControl()
    const shipPhase = container.querySelector('[data-section="Pipeline Band"] [data-phase="ship"]')

    expect(shipPhase).toHaveAttribute('data-state', 'current')
    expect(within(shipPhase as HTMLElement).getByTestId('ship-door-row')).toHaveTextContent('Ship')
  })

  it('renders the live Overview summary, specialist results, feed, and pickup gate', () => {
    queryMocks.activityQuery.data.sections.push({
      type: 'reviewer',
      role: 'security',
      sessionId: 'agent-pan-1661-review-security',
      model: 'claude-sonnet-5',
      status: 'completed',
      startedAt: '2026-06-07T00:01:00Z',
      duration: 30,
      roundMetadata: {
        roundCount: 1,
        latestRound: 1,
        latestReviewResult: 'APPROVED',
        history: [],
      },
    })
    renderMissionControl()

    fireEvent.click(screen.getByRole('button', { name: 'Overview' }))
    const overview = screen.getByTestId('overview-live')
    expect(within(overview).getByTestId('status-narrative')).toHaveTextContent('The reviewer found problems')
    const specialist = within(overview).getByText('review.security').closest('button')
    expect(specialist).toHaveAttribute('data-specialist', 'agent-pan-1661-review-security')
    expect(specialist).toBeDisabled()
    expect(within(overview).getAllByText('Approved')).toHaveLength(2)
    expect(within(overview).getByText('What just happened')).toBeInTheDocument()
    expect(within(overview).getByText('Pickup gate')).toBeInTheDocument()
  })

  it('renders the done Overview with an emerald badge, truthful merge metadata, and review summary', () => {
    Object.assign(queryMocks.reviewStatusQuery.data, {
      reviewStatus: 'passed',
      testStatus: 'passed',
      mergeStatus: 'merged',
      reviewNotes: 'Security, correctness, and performance approved.',
      readyForMerge: false,
    })
    Object.assign(queryMocks.prQuery.data.pr!, { mergeCommit: { oid: 'mergeabc123' } })
    renderMissionControl()

    fireEvent.click(screen.getByRole('button', { name: 'Overview' }))
    const done = screen.getByTestId('overview-done')
    expect(within(done).getByText('Done')).toHaveClass('text-success-foreground')
    expect(within(done).getByText('mergeabc123')).toHaveClass('font-mono')
    expect(within(done).getByText('Security, correctness, and performance approved.')).toBeInTheDocument()
  })

  it('renders a teaching pre-work Overview with the configurable StartAgentCta', () => {
    queryMocks.activityQuery.data.sections = []
    queryMocks.issueActionState.hasPlan = false
    queryMocks.issueActionState.hasTasks = false
    Object.assign(queryMocks.reviewStatusQuery.data, {
      reviewStatus: 'pending',
      testStatus: 'pending',
      mergeStatus: 'pending',
      verificationStatus: 'pending',
      reviewNotes: undefined,
      readyForMerge: false,
    })
    renderMissionControl()

    const empty = screen.getByTestId('overview-pre-work')
    expect(within(empty).getByText('Start the first agent run')).toBeInTheDocument()
    expect(within(empty).getByText(/create the workspace, read the approved plan/)).toBeInTheDocument()
    const start = within(empty).getByTestId('start-agent-cta')
    expect(start).toHaveAttribute('data-density', 'cockpit')
    expect(start).toHaveTextContent('Overrides · model · harness')
  })

  it('shows a selected session, then relocates the conversation cards below the issue overview', () => {
    const { container } = renderMissionControl()

    fireEvent.click(screen.getByTestId('lane-session-agent-pan-1661'))

    expect(container.querySelector('[data-section="SessionPanel"]')).toBeInTheDocument()
    expect(screen.getByTestId('session-panel')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Issue overview' }))

    const conversation = container.querySelector('[data-section="Session tab"]')
    expect(conversation).toBeInTheDocument()
    expect(conversation?.previousElementSibling).toHaveTextContent('Current state')
    expect(container.querySelector('[data-section="Awareness rail"]')).toHaveTextContent('Review blocked — awaiting the work agent')
    expect(conversation).toHaveTextContent('Launcher')
    expect(conversation).toHaveTextContent('Agent dock')
    expect(conversation).toHaveTextContent('Action dock')
    expect(conversation).toHaveTextContent('Timeline')
  })

  it('caps the selected session at a centered 980px measure', () => {
    renderMissionControl()

    fireEvent.click(screen.getByTestId('lane-session-agent-pan-1661'))

    expect(screen.getByTestId('session-panel').parentElement).toHaveClass(
      'mx-auto',
      'w-full',
      'max-w-[980px]',
    )
  })

  it('keeps tabs visible but unselected when an issue-tree node drives the pane', () => {
    renderMissionControl()

    fireEvent.click(screen.getByTestId('lane-session-agent-pan-1661'))

    expect(screen.getByTestId('issue-tree-context-panel')).toBeTruthy()
    expect(screen.getByTestId('session-panel')).toBeTruthy()
    expect(screen.getByText('Issue overview')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Overview' }).getAttribute('aria-selected')).toBe('false')
    // Session remains visible while the tree-driven panel owns the body.
    expect(screen.getByRole('button', { name: 'Session' }).getAttribute('aria-selected')).toBe('false')

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

  it('keeps first-class CI checks reachable through the legacy Code deep link', () => {
    window.history.replaceState(null, '', '/?tab=code')
    renderMissionControl()

    expect(screen.getAllByText('GitHub CI/CD').length).toBeGreaterThan(0)
    expect(screen.getAllByText('lint').length).toBeGreaterThan(0)
    expect(screen.getAllByText('1/1 pass').length).toBeGreaterThan(0)
  })

  it('keeps the legacy Files surface reachable inside Changes', () => {
    window.history.replaceState(null, '', '/?tab=files')
    const { container } = renderMissionControl()

    expect(container.querySelector('main')).toHaveAttribute('data-active-tab', 'changes')
    expect(container.querySelector('main')).toHaveAttribute('data-active-subview', 'files')
    expect(screen.getByText('Changed files')).toBeInTheDocument()
  })

  it('keeps the legacy Terminal surface reachable inside Session', () => {
    window.history.replaceState(null, '', '/?tab=terminal')
    const { container } = renderMissionControl()

    expect(container.querySelector('main')).toHaveAttribute('data-active-tab', 'session')
    expect(screen.getByTestId('issue-detail-page-mock')).toHaveAttribute('data-tab', 'terminal')
  })
})
