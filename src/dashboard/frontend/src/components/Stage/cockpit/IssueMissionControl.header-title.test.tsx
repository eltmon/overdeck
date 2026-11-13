import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { resetDashboardStore, seedDashboardStore } from '../../../test-utils/renderCounter'

// Same minimal mock surface as IssueMissionControl.render-count.test.tsx, but
// useIssueRecord stays real so this file can exercise PAN-5171's header logic.
const queryMocks = vi.hoisted(() => {
  const result = <T,>(data: T) => ({ data, isLoading: false, isError: false, error: null, refetch: () => {} })
  return {
    activityQuery: result({ issueId: 'PAN-1', sections: [] }),
    issueCheckRunsQuery: result(null),
    planningQuery: result(null),
    prQuery: result(null),
    issueCostsQuery: result(null),
    workspaceQuery: result(null),
    actions: { all: [], primary: [], secondary: [], overflow: [], phase: 'WORK_RUNNING', state: {}, activeDialog: null },
  }
})

vi.mock('../../CommandDeck/ZoneCOverviewTabs/queries', () => ({
  useActivityQuery: () => queryMocks.activityQuery,
  useIssueCheckRunsQuery: () => queryMocks.issueCheckRunsQuery,
  usePlanningQuery: () => queryMocks.planningQuery,
  usePrQuery: () => queryMocks.prQuery,
  useIssueCostsQuery: () => queryMocks.issueCostsQuery,
  useWorkspaceQuery: () => queryMocks.workspaceQuery,
}))
vi.mock('../../../lib/useSharedTick', () => ({ useSharedTick: () => new Date('2026-10-19T00:05:00Z') }))
vi.mock('../../../lib/simple/useSimpleActions', () => ({ useSimpleActions: () => ({}) }))
vi.mock('../../IssueActionMenu/useIssueActions', () => ({ useIssueActions: () => queryMocks.actions }))
vi.mock('../../MergeButton', () => ({ MergeButton: () => <div /> }))
vi.mock('../../issue-view/StartAgentCta', () => ({ StartAgentCta: () => <div /> }))
vi.mock('../../drawer/DrawerReviewSpecialists', () => ({ default: () => <div /> }))
vi.mock('../../drawer/DrawerArtifactsPanel', () => ({ default: () => <div /> }))
vi.mock('../../drawer/DrawerActivityRail', () => ({ DrawerActivityRailView: () => <div />, default: () => <div /> }))
vi.mock('../../PanOpenInPicker', () => ({ PanOpenInPicker: () => <div /> }))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/ActivityTab', () => ({ ActivityTab: () => <div /> }))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/BeadsTab', () => ({ BeadsTab: () => <div /> }))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/TasksTab', () => ({ TasksTab: () => <div /> }))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/CostsTab', () => ({ CostsTab: () => <div /> }))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/DiscussionsTab', () => ({ DiscussionsTab: () => <div /> }))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/MarkdownTab', () => ({ MarkdownTab: () => <div /> }))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/PrDiffTab', () => ({
  PrDiffTab: () => <div />,
  statusColor: () => ({ bg: 'transparent', fg: 'currentColor', label: 'pass' }),
}))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/XBriefTab', () => ({ XBriefTab: () => <div /> }))
vi.mock('../../TasksPanel', () => ({ TasksPanel: () => <div /> }))
vi.mock('../../PrdViewer', () => ({ PrdViewer: () => <div /> }))
vi.mock('../../CommandDeck/SessionView/SessionPanel', () => ({ SessionPanel: () => <div /> }))
vi.mock('./ReviewVerificationCard', () => ({ ReviewVerificationCard: () => <div /> }))
vi.mock('./IssueBlockerSpotlight', () => ({ IssueBlockerSpotlight: () => <div /> }))
vi.mock('./AgentsLane', () => ({ AgentsLane: () => <div /> }))
vi.mock('./TasksRail', async () => {
  const actual = await vi.importActual<typeof import('./TasksRail')>('./TasksRail')
  return { ...actual, TasksRail: () => <div /> }
})
vi.mock('./PickupGateCard', () => ({ PickupGateCard: () => <div /> }))
vi.mock('./ChangedFilesView', () => ({ ChangedFilesView: () => <div /> }))
vi.mock('../../issue-detail/IssueDetail', () => ({
  IssueDetail: () => <div data-testid="issue-detail-agents" />,
}))

import { IssueMissionControl } from './IssueMissionControl'

function renderCockpit() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <IssueMissionControl
        issueId="PAN-1"
        title="PAN-1"
        branch="feature/pan-1"
        launcher={<div />}
        agentDock={<div />}
        actionDock={<div />}
        timeline={<div />}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
  seedDashboardStore({ issuesRaw: [] })
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetDashboardStore()
})

describe('IssueMissionControl header title (PAN-5171)', () => {
  it('renders the fetched title when the title prop equals the identifier', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/issues/PAN-1') {
        return Response.json({ id: 'PAN-1', identifier: 'PAN-1', title: 'Cockpit title' })
      }
      return Response.json({})
    }))

    renderCockpit()

    expect(await screen.findByText('Cockpit title')).toBeInTheDocument()
  })

  it('renders the skeleton while the per-issue read is unresolved', () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/issues/PAN-1') return new Promise<never>(() => {})
      return Promise.resolve(Response.json({}))
    }))

    renderCockpit()

    expect(screen.getByTestId('issue-title-skeleton')).toBeInTheDocument()
  })
})
