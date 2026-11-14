/**
 * PAN-5246 FR-9: the runtime proof that every cockpit inventory section
 * renders on a visible element in the Stage tab. The frame renders the real
 * shared view (IssueDetail, IssueDrawerDetails, IssueDetailTabBodies,
 * IssueBannerSlot, NeedsYouSlot, StatusNarrative, HappenedFeed, StackDrawer,
 * DrawerAgentSession); only heavy leaves are mocked.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WS_METHODS } from '@overdeck/contracts'

const wsTransportMock = vi.hoisted(() => ({
  subscribe: vi.fn(() => vi.fn()),
  request: vi.fn(),
  getAvailableEditors: vi.fn(),
  shellOpenInEditor: vi.fn(),
  dashboardMutationJsonHeaders: vi.fn(async () => ({
    'Content-Type': 'application/json',
    'x-overdeck-csrf-token': 'test-csrf',
  })),
}))

vi.mock('../../../lib/wsTransport', () => ({
  getTransport: () => wsTransportMock,
  dashboardMutationJsonHeaders: wsTransportMock.dashboardMutationJsonHeaders,
}))

vi.mock('../../chat/ConversationPanel', () => ({
  ConversationPanel: ({ agentId }: { agentId: string }) => <div data-testid="conversation-panel">{agentId}</div>,
}))
vi.mock('../../XTerminal', () => ({ XTerminal: () => <div data-testid="xterminal" /> }))
vi.mock('../../skills/SkillOverridesPanel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../skills/SkillOverridesPanel')>()),
  SkillOverridesPanel: () => <div data-testid="skill-overrides-panel" />,
}))
vi.mock('../../TasksPanel', () => ({ TasksPanel: () => <div data-testid="tasks-panel" /> }))
vi.mock('../../drawer/DrawerSecondaryPanels', () => ({
  DrawerPlanPanel: () => <div data-testid="drawer-plan-panel" />,
  DrawerActivityPanel: () => <div data-testid="drawer-tab-panel-activity" />,
}))
vi.mock('../../drawer/DrawerArtifactsPanel', () => ({ default: () => <div data-testid="drawer-artifacts-panel" /> }))
vi.mock('./ChangedFilesView', () => ({ ChangedFilesView: () => <div data-testid="changed-files-view" /> }))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/ActivityTab', () => ({ ActivityTab: () => <div data-testid="activity-tab" /> }))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/DiscussionsTab', () => ({ DiscussionsTab: () => <div data-testid="discussions-tab" /> }))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/CostsTab', () => ({ CostsTab: () => <div data-testid="costs-tab" /> }))
vi.mock('../../backlog/PickupGateControls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../backlog/PickupGateControls')>()),
  PickupGateControls: () => <div data-testid="pickup-gate-controls" />,
}))
vi.mock('../../PanOpenInPicker', () => ({ PanOpenInPicker: () => <div data-testid="pan-open-picker" /> }))
vi.mock('../../CommandDeck/UatEnvironmentPanel', () => ({ UatEnvironmentPanel: () => <div data-testid="uat-environment-panel" /> }))
vi.mock('../../CommandDeck/UatStackStatus', () => ({
  UatStackStatus: () => <div data-testid="uat-stack-status" />,
  getUatStackSummary: () => null,
}))
vi.mock('../../IssueActionMenu/IssueActionMenu', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../IssueActionMenu/IssueActionMenu')>()),
  IssueActionMenu: () => <div data-testid="issue-action-menu" />,
}))
vi.mock('../../IssueActionMenu/useIssueActions', () => ({
  useIssueActions: () => ({ all: [], primary: [], secondary: [], overflow: [], state: { hasPlan: true }, activeDialog: null }),
}))
vi.mock('../../deft/queries', () => ({ useDeftIssueSummary: () => ({ isDeft: false, summary: null, isLoading: false }) }))
vi.mock('../../deft/DeftDecisionsTab', () => ({ DeftDecisionsTab: () => null }))
vi.mock('../../deft/DeftScopeView', () => ({ DeftScopeView: () => null }))
vi.mock('../../deft/DeftScopeDag', () => ({ DeftScopeDag: () => null }))
vi.mock('../../deft/DeftGatesPanel', () => ({ DeftGatesPanel: () => null }))
vi.mock('../../deft/DeftReviewCyclePanel', () => ({ DeftReviewCyclePanel: () => null }))
vi.mock('../../deft/DeftBadges', () => ({ DeftDeliveryChip: () => null }))
vi.mock('../../deft/DeftSubagentRows', () => ({ DeftSubagentRows: () => null }))

import { useDashboardStore } from '../../../lib/store'
import type { PaneType } from '../../../lib/panesStore'
import type { Issue } from '../../../types'
import { DialogProvider } from '../../DialogProvider'
import { resetDrawerIssueSubscriptionForTest } from '../../drawer/useDrawerData'
import { DENSITY_SECTIONS } from '../../issue-view/densitySections'
import { IssueMissionControl } from './IssueMissionControl'

const ISSUE: Issue = {
  id: 'PAN-1661',
  identifier: 'PAN-1661',
  title: 'Mission control',
  status: 'In Progress',
  priority: 3,
  labels: [],
  url: 'https://github.com/eltmon/overdeck/issues/1661',
  createdAt: '2026-06-07T00:00:00.000Z',
  updatedAt: '2026-06-07T00:00:00.000Z',
}

const MARKERS_BY_TAB: Array<{ tab: string; sections: string[] }> = [
  { tab: 'conversation', sections: ['Header bar', 'NeedsYouSlot', 'IssueBlockerSpotlight', 'Pipeline Band', 'Detail Tabs', 'Session tab', 'AgentsLane', 'SessionPanel'] },
  { tab: 'tasks', sections: ['TasksRail / TasksTab'] },
  { tab: 'plan', sections: ['PlanMapCard', 'Plan / Activity / Discussion tabs'] },
  { tab: 'files', sections: ['Changes tab'] },
  { tab: 'artifacts', sections: ['Cost / Artifacts / Ship homes'] },
  { tab: 'activity', sections: ['HappenedFeed', 'Plan / Activity / Discussion tabs'] },
  { tab: 'discussion', sections: ['Plan / Activity / Discussion tabs'] },
  { tab: 'overview', sections: ['StatusNarrative', 'NowPanel', 'CrewStage', 'PickupGateCard', 'Cost / Artifacts / Ship homes', 'StackDrawer', 'UatEnvironmentPanel', 'Awareness rail'] },
]

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/command-deck/activity/')) {
      return Response.json({
        sections: [{ type: 'work', sessionId: 'agent-pan-1661', model: 'sonnet', status: 'running', startedAt: '2026-06-07T00:00:00Z' }],
      })
    }
    if (url.includes('/api/workspaces/') && !url.endsWith('/plan')) {
      return Response.json({ exists: true, issueId: 'PAN-1661', hasDocker: false, path: '/tmp/pan-1661' })
    }
    if (url.endsWith('/plan')) return Response.json(null)
    if (url.endsWith('/api/issues/PAN-1661/costs')) return Response.json({ issueId: 'PAN-1661', totalCost: 0, totalTokens: 0, byModel: {}, sessions: [] })
    if (url.endsWith('/tasks')) return Response.json({ issueId: 'PAN-1661', workspacePath: '/tmp/pan-1661', tasks: [] })
    if (url.endsWith('/api/issues/PAN-1661')) return Response.json(ISSUE)
    if (url.includes('/has-session')) return Response.json({ lifecycle: { canResumeSession: false } })
    return Response.json({})
  })
}

function renderFrame() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <DialogProvider>
        <IssueMissionControl
          issueId="PAN-1661"
          title="Mission control"
          branch="feature/pan-1661"
          projectName="overdeck"
          launcher={<div data-testid="launcher">Launcher</div>}
          agentDock={<div>Agent dock</div>}
          actionDock={<div>Action dock</div>}
          timeline={<div>Timeline</div>}
          onOpenPane={vi.fn() as (pane: PaneType) => void}
        />
      </DialogProvider>
    </QueryClientProvider>,
  )
}

describe('IssueMissionControl sections (PAN-5246)', () => {
  beforeEach(() => {
    resetDrawerIssueSubscriptionForTest()
    vi.stubGlobal('fetch', mockFetch())
    wsTransportMock.subscribe.mockReset()
    wsTransportMock.subscribe.mockReturnValue(vi.fn())
    wsTransportMock.request.mockReset()
    wsTransportMock.request.mockImplementation((connect: (client: Record<string, unknown>) => unknown) => connect({
      [WS_METHODS.getAvailableEditors]: vi.fn(async () => ({ editors: [] })),
      [WS_METHODS.shellOpenInEditor]: vi.fn(async () => ({ success: true })),
    }))
    localStorage.clear()
    window.history.replaceState(null, '', '/')
    useDashboardStore.setState({
      issuesRaw: [ISSUE],
      agentsById: {
        'agent-pan-1661': {
          id: 'agent-pan-1661',
          issueId: 'PAN-1661',
          role: 'work',
          status: 'running',
          runtime: 'claude-code',
          model: 'sonnet',
          startedAt: '2026-06-07T00:00:00.000Z',
          consecutiveFailures: 0,
          killCount: 0,
        },
      },
      derivedIssueStateByIssueId: {
        'PAN-1661': {
          issueId: 'PAN-1661',
          state: 'changes-requested',
          pr: { url: 'https://github.com/eltmon/overdeck/pull/1661', number: 1661, reviewState: 'changes-requested', checks: 'red', mergeable: true },
        },
      },
      backendPanesById: {},
      recentActivity: [],
      detailedActivity: [],
    } as Parameters<typeof useDashboardStore.setState>[0])
  })

  afterEach(() => {
    cleanup()
    resetDrawerIssueSubscriptionForTest()
    vi.unstubAllGlobals()
  })

  it('renders every cockpit inventory marker on a visible element', async () => {
    for (const { tab, sections } of MARKERS_BY_TAB) {
      window.history.replaceState(null, '', `/?tab=${tab}`)
      const { container, unmount } = renderFrame()
      for (const section of sections) {
        await waitFor(() => {
          const el = container.querySelector(`[data-section="${section}"]`)
          expect(el, `${tab}: ${section}`).toBeInTheDocument()
          expect(el?.closest('[hidden]'), `${tab}: ${section} is hidden`).toBeNull()
        })
      }
      unmount()
      resetDrawerIssueSubscriptionForTest()
    }
  })

  it('the marker table covers DENSITY_SECTIONS.cockpit exactly', () => {
    expect(new Set(MARKERS_BY_TAB.flatMap((row) => row.sections))).toEqual(new Set(DENSITY_SECTIONS.cockpit))
  })

  it("the Stage tab renders the drawer's tab entries", () => {
    renderFrame()
    expect(
      within(screen.getByTestId('drawer-tabs')).getAllByRole('tab').map((button) => button.getAttribute('data-testid')),
    ).toEqual([
      'drawer-tab-session',
      'drawer-tab-tasks',
      'drawer-tab-plan',
      'drawer-tab-changes',
      'drawer-tab-activity',
      'drawer-tab-discussion',
      'drawer-tab-skills',
      'drawer-tab-overview',
    ])
  })

  it('the Stage Details tab ends with the launch composition', () => {
    window.history.replaceState(null, '', '/?tab=overview')
    renderFrame()
    expect(screen.getByTestId('drawer-details-footer')).toContainElement(screen.getByTestId('launcher'))
  })
})
