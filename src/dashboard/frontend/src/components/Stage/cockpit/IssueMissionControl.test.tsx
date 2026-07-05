import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PaneType } from '../../../lib/panesStore'

const actionInvoke = vi.fn()

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
  return { activityQuery, issueCheckRunsQuery, planningQuery, prQuery, reviewStatusQuery, issueCostsQuery, workspaceQuery }
})

vi.mock('../../CommandDeck/ZoneCOverviewTabs/queries', () => ({
  useActivityQuery: () => queryMocks.activityQuery,
  useIssueCheckRunsQuery: () => queryMocks.issueCheckRunsQuery,
  usePlanningQuery: () => queryMocks.planningQuery,
  usePrQuery: () => queryMocks.prQuery,
  useReviewStatusQuery: () => queryMocks.reviewStatusQuery,
  useIssueCostsQuery: () => queryMocks.issueCostsQuery,
  useWorkspaceQuery: () => queryMocks.workspaceQuery,
}))

vi.mock('../../../lib/issueActions', () => ({
  ISSUE_ACTIONS: [
    { key: 'plan', label: 'Plan', group: 'planning', kind: 'dialog' },
    { key: 'startAgent', label: 'Start agent', group: 'work', kind: 'dialog' },
    { key: 'reviewTest', label: 'Review & test', group: 'review', kind: 'dialog' },
    { key: 'tell', label: 'Tell agent', group: 'agent', kind: 'dialog' },
    { key: 'wipe', label: 'Wipe', group: 'danger', kind: 'destructive' },
  ],
}))

vi.mock('../../IssueActionMenu/useIssueActions', () => ({
  useIssueActions: () => {
    const all = [
      { action: { key: 'plan', label: 'Plan', group: 'planning', kind: 'dialog' }, enabled: true, isPending: false, invoke: actionInvoke },
      { action: { key: 'startAgent', label: 'Start agent', group: 'work', kind: 'dialog' }, enabled: true, isPending: false, invoke: actionInvoke },
      { action: { key: 'reviewTest', label: 'Review & test', group: 'review', kind: 'dialog' }, enabled: true, isPending: false, invoke: actionInvoke },
      { action: { key: 'tell', label: 'Tell agent', group: 'agent', kind: 'dialog' }, enabled: true, isPending: false, invoke: actionInvoke },
      { action: { key: 'wipe', label: 'Wipe', group: 'danger', kind: 'destructive' }, enabled: true, isPending: false, invoke: actionInvoke },
    ]
    return {
      all,
      primary: all.slice(0, 2),
      secondary: all.slice(2, 4),
      overflow: all.slice(4),
      state: { hasPlan: true, hasBeads: true },
      activeDialog: null,
    }
  },
}))

vi.mock('../../IssueActionMenu/IssueActionMenu', () => ({
  IssueActionDialogHost: () => null,
}))

vi.mock('../../MergeButton', () => ({ MergeButton: () => <div>Merge button</div> }))
vi.mock('../../drawer/DrawerReviewSpecialists', () => ({ default: () => <div>Review specialists</div> }))
vi.mock('../../drawer/DrawerArtifactsPanel', () => ({ default: () => <div>Artifacts panel</div> }))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/ActivityTab', () => ({ ActivityTab: () => <div>Activity tab</div> }))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/BeadsTab', () => ({ BeadsTab: () => <div>Beads tab</div> }))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/CostsTab', () => ({ CostsTab: () => <div>Costs tab</div> }))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/DiscussionsTab', () => ({ DiscussionsTab: () => <div>Discussions tab</div> }))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/MarkdownTab', () => ({ MarkdownTab: ({ body }: { body?: string }) => <div>{body ?? 'Markdown tab'}</div> }))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/PrDiffTab', () => ({
  PrDiffTab: () => <div>PR diff tab</div>,
  statusColor: () => ({ bg: 'transparent', fg: 'currentColor', label: 'pass' }),
}))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/VBriefTab', () => ({ VBriefTab: () => <div>vBRIEF tab</div> }))
vi.mock('../../CommandDeck/SessionView/SessionPanel', () => ({
  SessionPanel: ({ session }: { session: { sessionId: string } }) => <div data-testid="session-panel">{session.sessionId}</div>,
}))
vi.mock('./ReviewVerificationCard', () => ({ ReviewVerificationCard: () => <div>Review card</div> }))
vi.mock('./StatusHistoryTab', () => ({ StatusHistoryTab: () => <div>Status history</div> }))
vi.mock('./IssueBlockerSpotlight', () => ({ IssueBlockerSpotlight: () => <div>Blocker spotlight</div> }))
vi.mock('./AgentsLane', () => ({ AgentsLane: () => <div>Agents lane</div> }))
vi.mock('./BeadsRail', () => ({ BeadsRail: () => <div>Beads rail</div> }))
vi.mock('./PickupGateCard', () => ({ PickupGateCard: () => <div>Pickup gate</div> }))
vi.mock('./ChangedFilesView', () => ({ ChangedFilesView: () => <div>Changed files</div> }))

import { IssueMissionControl } from './IssueMissionControl'

function renderMissionControl(extra?: { onOpenPane?: (pane: string) => void }) {
  const onOpenPane = extra?.onOpenPane ?? vi.fn()
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  render(
    <QueryClientProvider client={queryClient}>
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
  return { onOpenPane }
}

describe('IssueMissionControl', () => {
  it('renders the mission header, issue tree, and persistent top tabs', () => {
    renderMissionControl()

    expect(screen.getByRole('heading', { name: 'Mission control' })).toBeTruthy()
    expect(screen.getAllByText('PAN-1661').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Issue tree')).toBeTruthy()
    expect(screen.getAllByText('Work').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Overview' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /Code/ }).length).toBeGreaterThan(0)
    expect(screen.getByText('Blocker spotlight')).toBeTruthy()
  })

  it('renders the v3 command bar: pipeline progress, gates, and a blocked merge CTA', () => {
    renderMissionControl()

    // 7-segment pipeline progress bar (replaces the legacy lifecycle-date strip)
    expect(screen.getByTestId('cockpit-pipeline-progress')).toBeTruthy()
    expect(screen.getByText('CI/CD')).toBeTruthy()
    // gates pill row
    expect(screen.getByTestId('cockpit-gates')).toBeTruthy()
    expect(screen.getAllByText('Merge-ready').length).toBeGreaterThan(0)
    // primary merge CTA reflects the blocking reason
    expect(screen.getByText(/Merge — blocked by review/)).toBeTruthy()
    // breadcrumb context
    expect(screen.getAllByText('Issues').length).toBeGreaterThan(0)
  })

  it('keeps the Overview faithful to the current cockpit summary', () => {
    renderMissionControl()

    expect(screen.getByText('Blocker spotlight')).toBeTruthy()
    expect(screen.getByText('Review blocked — awaiting the work agent')).toBeTruthy()
    expect(screen.getByText(/Merge — blocked by review/)).toBeTruthy()
  })

  it('moves the launch composition into the Conversation tab', () => {
    renderMissionControl()

    fireEvent.click(screen.getByRole('button', { name: 'Conversation' }))

    expect(screen.getByText('Launcher')).toBeTruthy()
    expect(screen.getByText('Agent dock')).toBeTruthy()
    expect(screen.getByText('Action dock')).toBeTruthy()
  })

  it('keeps tabs visible but unselected when an issue-tree node drives the pane', () => {
    renderMissionControl()

    fireEvent.click(screen.getByRole('button', { name: /Work/ }))

    expect(screen.getByTestId('issue-tree-context-panel')).toBeTruthy()
    expect(screen.getByTestId('session-panel')).toBeTruthy()
    expect(screen.getByText('Issue overview')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Overview' }).getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('button', { name: 'Conversation' }).getAttribute('aria-selected')).toBe('false')

    fireEvent.click(screen.getByRole('button', { name: 'Issue overview' }))
    expect(screen.getByText('Review blocked — awaiting the work agent')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Overview' }))

    expect(screen.getByRole('button', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByTestId('issue-tree-context-panel')).toBeNull()
  })

  it('groups all issue actions in the mega-menu', () => {
    renderMissionControl()

    fireEvent.click(screen.getByRole('button', { name: 'Issue actions' }))

    expect(screen.getByText('Planning')).toBeTruthy()
    expect(screen.getAllByText('Work').length).toBeGreaterThan(0)
    expect(screen.getByText('Review & Test')).toBeTruthy()
    expect(screen.getAllByText('Agent').length).toBeGreaterThan(0)
    expect(screen.getByText('Danger')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Wipe' })).toBeTruthy()
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
