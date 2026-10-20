import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DomainEvent } from '@overdeck/contracts'
import {
  applyStoreEvents,
  createRenderCounter,
  resetDashboardStore,
  seedDashboardStore,
} from '../../../test-utils/renderCounter'

// Same mock surface as IssueMissionControl.test.tsx, reduced to stubs that
// never subscribe to the store: the Probe then counts only the cockpit's own
// re-renders. Query results are fixed objects, so their identity is stable.
const queryMocks = vi.hoisted(() => {
  const result = <T,>(data: T) => ({ data, isLoading: false, isError: false, error: null, refetch: () => {} })
  return {
    activityQuery: result({
      issueId: 'PAN-1',
      sections: [{ type: 'work', sessionId: 'agent-pan-1', model: 'claude-opus-5-5', status: 'running', startedAt: '2026-10-19T00:00:00Z', duration: 1 }],
    }),
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
  IssueDetail: ({ agents }: { agents?: Array<{ id: string; status: string }> }) => (
    <div data-testid="issue-detail-agents">{(agents ?? []).map((a) => `${a.id}:${a.status}`).join(',')}</div>
  ),
}))

import { IssueMissionControl } from './IssueMissionControl'

const TIMESTAMP = '2026-10-19T00:00:00.000Z'

function statusChanged(agentId: string, issueId: string, sequence: number): DomainEvent {
  return { type: 'agent.status_changed', sequence, timestamp: TIMESTAMP, payload: { agentId, issueId, status: 'stopped' } } as DomainEvent
}

function renderCockpit() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const counter = createRenderCounter()
  render(
    <QueryClientProvider client={client}>
      <counter.Probe id="cockpit">
        <IssueMissionControl
          issueId="PAN-1"
          title="Cockpit"
          branch="feature/pan-1"
          launcher={<div />}
          agentDock={<div />}
          actionDock={<div />}
          timeline={<div />}
        />
      </counter.Probe>
    </QueryClientProvider>,
  )
  counter.reset()
  return counter
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})))
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
  seedDashboardStore({
    agentsById: {
      'agent-pan-1': { id: 'agent-pan-1', issueId: 'PAN-1', status: 'running', role: 'work' },
      'agent-pan-2': { id: 'agent-pan-2', issueId: 'PAN-2', status: 'running', role: 'work' },
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetDashboardStore()
})

describe('IssueMissionControl agent isolation', () => {
  it('does not re-render when an agent of another issue changes', () => {
    const counter = renderCockpit()

    applyStoreEvents([statusChanged('agent-pan-2', 'PAN-2', 1)])

    expect(counter.count('cockpit')).toBe(0)
  })

  it('re-renders and shows the new status when its own agent changes', () => {
    const counter = renderCockpit()
    expect(screen.getByTestId('issue-detail-agents')).toHaveTextContent('agent-pan-1:running')

    applyStoreEvents([statusChanged('agent-pan-1', 'PAN-1', 1)])

    expect(counter.count('cockpit')).toBeGreaterThanOrEqual(1)
    expect(screen.getByTestId('issue-detail-agents')).toHaveTextContent('agent-pan-1:stopped')
  })
})
