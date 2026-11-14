/**
 * PAN-5246: the Stage frame. IssueMissionControl is IssueTitleRow + the ONE
 * IssueDetail at page density; these tests cover the frame (tab state, the
 * title row, the Details footer) through a props-recording IssueDetail stub.
 * The shared view itself is covered by IssueDetail.test.tsx and, unmocked,
 * by IssueMissionControl.sections.test.tsx.
 */
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PaneType } from '../../../lib/panesStore'
import { useDashboardStore } from '../../../lib/store'

const actionInvoke = vi.fn()
let queryClient: QueryClient | undefined
let unexpectedRequests: string[] = []

const ISSUE_ROW = {
  id: 'PAN-1661',
  identifier: 'PAN-1661',
  title: 'Mission control',
  status: 'In Progress',
  url: 'https://github.com/eltmon/overdeck/issues/1661',
}

const queryMocks = vi.hoisted(() => ({
  issueCostsQuery: { data: { totalCost: 1.23, totalTokens: 1000, byModel: {}, sessions: [] } },
  issueActionState: { hasPlan: true, hasTasks: true },
  /** Adds an enabled "Open pull request" registry action when true. */
  withViewPr: { value: false },
}))

beforeEach(() => {
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
  actionInvoke.mockClear()
  queryMocks.withViewPr.value = false
  useDashboardStore.setState({
    agentsById: {},
    backendPanesById: {},
    derivedIssueStateByIssueId: {
      'PAN-1661': {
        issueId: 'PAN-1661',
        state: 'changes-requested',
        pr: { url: 'https://github.com/eltmon/overdeck/pull/1661', number: 1661, reviewState: 'changes-requested', checks: 'green', mergeable: true },
      },
    },
  } as Parameters<typeof useDashboardStore.setState>[0])
  unexpectedRequests = []
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    // useIssueRecord's per-issue read: the frame's title and tracker link.
    if (method === 'GET' && url === '/api/issues/PAN-1661') return Response.json(ISSUE_ROW)
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

vi.mock('../../CommandDeck/ZoneCOverviewTabs/queries', () => ({
  useIssueCostsQuery: () => queryMocks.issueCostsQuery,
}))

vi.mock('../../../lib/useSharedTick', () => ({
  useSharedTick: () => new Date('2026-06-07T00:05:00Z'),
}))

vi.mock('../../../lib/issueActions', () => ({
  GROUP_LABELS: {
    communicate: 'Communicate',
    lifecycle: 'Actions',
    inspect: 'Inspect',
    danger: 'Danger',
  },
  GROUP_ORDER: ['communicate', 'lifecycle', 'inspect', 'danger'],
  ISSUE_ACTIONS: [
    { key: 'plan', label: 'Plan', description: 'Plan this issue.', group: 'lifecycle', kind: 'dialog', placement: 'menu' },
    { key: 'startAgent', label: 'Start agent', description: 'Start work on this issue.', group: 'lifecycle', kind: 'dialog', placement: 'menu' },
    { key: 'tell', label: 'Tell agent', description: 'Send the agent a message.', group: 'communicate', kind: 'dialog', placement: 'menu' },
    { key: 'viewPr', label: 'Open pull request', description: 'Open the pull request.', group: 'inspect', kind: 'safe', placement: 'menu' },
    { key: 'resetIssue', label: 'Reset to Todo', description: 'Erase this issue.', group: 'danger', kind: 'destructive', placement: 'menu' },
  ],
}))

vi.mock('../../IssueActionMenu/useIssueActions', () => ({
  useIssueActions: () => {
    const all = [
      { action: { key: 'plan', label: 'Plan', description: 'Plan this issue.', group: 'lifecycle', kind: 'dialog', placement: 'menu' }, enabled: true, isPending: false, invoke: actionInvoke },
      { action: { key: 'startAgent', label: 'Start agent', description: 'Start work on this issue.', group: 'lifecycle', kind: 'dialog', placement: 'menu' }, enabled: true, isPending: false, invoke: actionInvoke },
      { action: { key: 'tell', label: 'Tell agent', description: 'Send the agent a message.', group: 'communicate', kind: 'dialog', placement: 'menu' }, enabled: true, isPending: false, invoke: actionInvoke },
      { action: { key: 'merge', label: 'Merge to main', description: 'Merge the approved branch.', group: 'lifecycle', kind: 'safe', placement: 'menu' }, enabled: false, disabledReason: 'Merge is available once review has approved and the PR is mergeable.', isPending: false, invoke: actionInvoke },
      { action: { key: 'resetIssue', label: 'Reset to Todo', description: 'Erase this issue.', group: 'danger', kind: 'destructive', placement: 'menu' }, enabled: false, disabledReason: 'Reset to Todo is unavailable.', isPending: false, invoke: actionInvoke },
      ...(queryMocks.withViewPr.value
        ? [{ action: { key: 'viewPr', label: 'Open pull request', description: 'Open the pull request.', group: 'inspect', kind: 'safe', placement: 'menu' }, enabled: true, isPending: false, invoke: actionInvoke }]
        : []),
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

// The ONE IssueDetail pulls in the whole transcript/WS chain; these tests
// cover the Stage frame. The mount contract is asserted via this
// props-recording stub.
vi.mock('../../issue-detail/IssueDetail', () => ({
  IssueDetail: (props: {
    issueId: string;
    density: string;
    tab: string;
    showTabs?: boolean;
    onSelectTab: (tab: string) => void;
    detailsFooter?: ReactNode;
  }) => (
    <div
      data-testid="issue-detail-page-mock"
      data-issue-id={props.issueId}
      data-density={props.density}
      data-tab={props.tab}
      data-show-tabs={String(props.showTabs ?? true)}
    >
      <div role="tablist" aria-label="Agent session view">
        <button type="button" role="tab" aria-selected={props.tab === 'conversation'} onClick={() => props.onSelectTab('conversation')}>
          Conversation
        </button>
        <button type="button" role="tab" aria-selected={props.tab === 'terminal'} onClick={() => props.onSelectTab('terminal')}>
          Terminal
        </button>
      </div>
      <div data-testid="issue-detail-footer">{props.detailsFooter}</div>
    </div>
  ),
}))

import { IssueMissionControl } from './IssueMissionControl'

function renderMissionControl() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { gcTime: 0, retry: false },
      mutations: { retry: false },
    },
  })
  queryClient = client
  return render(
    <QueryClientProvider client={client}>
      <IssueMissionControl
        issueId="PAN-1661"
        title="Mission control"
        branch="feature/pan-1661"
        projectName="overdeck"
        launcher={<div>Launcher</div>}
        agentDock={<div>Agent dock</div>}
        actionDock={<div>Action dock</div>}
        timeline={<div>Timeline</div>}
        onOpenPane={vi.fn() as (pane: PaneType) => void}
      />
    </QueryClientProvider>,
  )
}

/** "Tab values" table in .pan/drafts/pan-5246.md: the `?tab=` value and what the Stage passes. */
const TAB_VALUES: Array<[string, string]> = [
  ['conversation', 'conversation'],
  ['session', 'conversation'],
  ['terminal', 'terminal'],
  ['tasks', 'tasks'],
  ['plan', 'plan'],
  ['prd', 'prd'],
  ['files', 'files'],
  ['changes', 'files'],
  ['code', 'checks'],
  ['checks', 'checks'],
  ['artifacts', 'artifacts'],
  ['activity', 'activity'],
  ['timeline', 'activity'],
  ['history', 'history'],
  ['discussion', 'discussion'],
  ['decisions', 'decisions'],
  ['skills', 'skills'],
  ['overview', 'overview'],
  ['costs', 'overview'],
  ['ship', 'overview'],
]

describe('IssueMissionControl (Stage frame, PAN-5246)', () => {
  it('mounts the shared view at page density with its tab strip', () => {
    renderMissionControl()
    const detail = screen.getByTestId('issue-detail-page-mock')
    expect(detail).toHaveAttribute('data-density', 'page')
    expect(detail).toHaveAttribute('data-show-tabs', 'true')
    expect(detail).toHaveAttribute('data-issue-id', 'PAN-1661')
  })

  it('opens the Conversation tab by default, with and without sessions', () => {
    renderMissionControl()
    expect(screen.getByTestId('issue-detail-page-mock')).toHaveAttribute('data-tab', 'conversation')
    cleanup()

    useDashboardStore.setState({
      agentsById: {
        'agent-pan-1661': { id: 'agent-pan-1661', issueId: 'PAN-1661', role: 'work', status: 'running', runtime: 'claude-code', model: 'sonnet', startedAt: '2026-06-07T00:00:00Z', consecutiveFailures: 0, killCount: 0 },
      },
    } as Parameters<typeof useDashboardStore.setState>[0])
    renderMissionControl()
    expect(screen.getByTestId('issue-detail-page-mock')).toHaveAttribute('data-tab', 'conversation')
  })

  it.each(TAB_VALUES)('passes the ?tab=%s deep link through its canonical value', (raw, expected) => {
    window.history.replaceState(null, '', `/?tab=${raw}`)
    renderMissionControl()
    expect(screen.getByTestId('issue-detail-page-mock')).toHaveAttribute('data-tab', expected)
  })

  it('falls back to Conversation for an unknown ?tab= value', () => {
    window.history.replaceState(null, '', '/?tab=no-such-tab')
    renderMissionControl()
    expect(screen.getByTestId('issue-detail-page-mock')).toHaveAttribute('data-tab', 'conversation')
  })

  it('reflects a tab change from the shared view', () => {
    renderMissionControl()
    fireEvent.click(screen.getByRole('tab', { name: 'Terminal' }))
    expect(screen.getByTestId('issue-detail-page-mock')).toHaveAttribute('data-tab', 'terminal')
  })

  it('renders the title row: heading, breadcrumb, one cost figure and the tracker link', async () => {
    renderMissionControl()
    expect(await screen.findByRole('heading', { level: 1, name: 'Mission control' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByTestId('header-breadcrumb')).toHaveTextContent('Issues')
    expect(screen.getByTestId('header-tracker-link')).toHaveAttribute('href', ISSUE_ROW.url)
    expect(screen.getAllByText('$1.23')).toHaveLength(1)
  })

  it('renders no crew spine, awareness rail, phase rail or cockpit tab band', () => {
    const { container } = renderMissionControl()
    expect(screen.queryByLabelText('Issue tree')).toBeNull()
    expect(container.querySelector('[data-section="Awareness rail"]')).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Issue cockpit tabs' })).toBeNull()
    expect(container.querySelector('[data-spine-collapsed]')).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Cost breakdown' })).toBeNull()
  })

  it('passes the launch composition as the Details footer', () => {
    renderMissionControl()
    const footer = screen.getByTestId('issue-detail-footer')
    for (const text of ['Launcher', 'Agent dock', 'Action dock', 'Timeline']) {
      expect(footer).toHaveTextContent(text)
    }
  })

  it('renders the shared issue action menu with grouped overflow and no empty Danger disclosure', () => {
    const { container } = renderMissionControl()

    // Phase-primary strip renders inline buttons.
    expect(screen.getByTestId('issue-action-plan')).toBeInTheDocument()
    expect(screen.getByTestId('issue-action-startAgent')).toBeInTheDocument()

    // The grouped body lives behind the shared overflow button.
    fireEvent.click(screen.getByTestId('issue-action-overflow-button'))

    expect(container.querySelector('[data-issue-action-section="communicate"]')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Tell agent' })).toHaveAttribute('title', 'Send the agent a message.')

    // PAN-4198 (FR-4): nothing in Danger is enabled here, so the disclosure is
    // absent rather than offering an empty drawer. The gated Reset to Todo and
    // Merge rows are not rendered at all (FR-1).
    expect(screen.queryByRole('menuitem', { name: 'Danger' })).toBeNull()
    expect(container.querySelector('[data-issue-action-section="danger"]')).toBeNull()
    expect(screen.queryByTestId('issue-action-disabled-resetIssue')).toBeNull()
    expect(screen.queryByTestId('issue-action-resetIssue')).toBeNull()
    expect(screen.queryByTestId('issue-action-disabled-merge')).toBeNull()
  })

  it('pins Open pull request in the action strip', () => {
    queryMocks.withViewPr.value = true
    renderMissionControl()

    const pinned = screen.getByTestId('issue-action-viewPr')
    expect(pinned).toHaveTextContent('Open pull request')
    // Pinned, so it sits after the strip's spacer and is not an overflow menu item.
    expect(screen.getByTestId('issue-action-pin-spacer').compareDocumentPosition(pinned) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(screen.getByTestId('issue-action-overflow-button'))
    expect(screen.queryByRole('menuitem', { name: 'Open pull request' })).toBeNull()
  })
})
