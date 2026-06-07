import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { PaneType } from '../../../lib/panesStore'

const actionInvoke = vi.fn()

vi.mock('../../CommandDeck/ZoneCOverviewTabs/queries', () => ({
  useActivityQuery: () => ({ data: { sections: [{ type: 'work', sessionId: 'agent-pan-1661', model: 'gpt-5.5', status: 'completed', startedAt: '2026-06-07T00:00:00Z', duration: 1 }] } }),
  useIssueCheckRunsQuery: () => ({
    isLoading: false,
    data: {
      issueId: 'PAN-1661',
      pr: { number: 1661, url: 'https://github.com/eltmon/panopticon-cli/pull/1661', headRefName: 'feature/pan-1661', mergeable: 'MERGEABLE', statusCheckRollup: [] },
      checkRuns: [{ id: 1, name: 'lint', status: 'completed', conclusion: 'success', htmlUrl: 'https://github/checks/1' }],
      summary: { total: 1, passed: 1, failed: 0, running: 0, skipped: 0, pending: 0, cancelled: 0 },
    },
  }),
  usePlanningQuery: () => ({ data: { prd: '# PRD', state: '# STATE' }, isLoading: false }),
  usePrQuery: () => ({ data: { pr: { number: 1661, additions: 4, deletions: 1, changedFiles: 2, isDraft: false, state: 'OPEN' } } }),
  useReviewStatusQuery: () => ({
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
  }),
  useIssueCostsQuery: () => ({ data: { totalCost: 1.23, totalTokens: 1000, byModel: {}, sessions: [] } }),
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
  useIssueActions: () => ({
    all: [
      { action: { key: 'plan', label: 'Plan', group: 'planning', kind: 'dialog' }, enabled: true, isPending: false, invoke: actionInvoke },
      { action: { key: 'startAgent', label: 'Start agent', group: 'work', kind: 'dialog' }, enabled: true, isPending: false, invoke: actionInvoke },
      { action: { key: 'reviewTest', label: 'Review & test', group: 'review', kind: 'dialog' }, enabled: true, isPending: false, invoke: actionInvoke },
      { action: { key: 'tell', label: 'Tell agent', group: 'agent', kind: 'dialog' }, enabled: true, isPending: false, invoke: actionInvoke },
      { action: { key: 'wipe', label: 'Wipe', group: 'danger', kind: 'destructive' }, enabled: true, isPending: false, invoke: actionInvoke },
    ],
    state: { hasPlan: true },
    activeDialog: null,
  }),
}))

vi.mock('../../IssueActionMenu/IssueActionMenu', () => ({
  IssueActionDialogHost: () => null,
}))

vi.mock('../../drawer/PhaseTimeline', () => ({ default: () => <div>Phase timeline</div> }))
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
vi.mock('./ReviewVerificationCard', () => ({ ReviewVerificationCard: () => <div>Review card</div> }))
vi.mock('./CodeCard', () => ({ CodeCard: () => <div>Code card</div> }))
vi.mock('./PlanCard', () => ({ PlanCard: () => <div>Plan card</div> }))
vi.mock('./CostCard', () => ({ CostCard: () => <div>Cost card</div> }))
vi.mock('./WorkspaceCard', () => ({ WorkspaceCard: () => <div>Workspace card</div> }))
vi.mock('./AgentActivityCards', () => ({
  AgentCard: () => <div>Agent card</div>,
  ActivityCard: () => <div>Activity card</div>,
}))
vi.mock('./StatusHistoryTab', () => ({ StatusHistoryTab: () => <div>Status history</div> }))
vi.mock('./IssueBlockerSpotlight', () => ({ IssueBlockerSpotlight: () => <div>Blocker spotlight</div> }))
vi.mock('./IssueMetricStrip', () => ({ IssueMetricStrip: () => <div>Metric strip</div> }))

import { IssueMissionControl } from './IssueMissionControl'

function renderMissionControl(extra?: { onOpenPane?: (pane: string) => void }) {
  const onOpenPane = extra?.onOpenPane ?? vi.fn()
  render(
    <IssueMissionControl
      issueId="PAN-1661"
      title="Mission control"
      branch="feature/pan-1661"
      launcher={<div>Launcher</div>}
      agentDock={<div>Agent dock</div>}
      actionDock={<div>Action dock</div>}
      timeline={<div>Timeline</div>}
      onOpenPane={onOpenPane as (pane: PaneType) => void}
    />,
  )
  return { onOpenPane }
}

describe('IssueMissionControl', () => {
  it('renders the mission header, pipeline lane, and top tabs', () => {
    renderMissionControl()

    expect(screen.getByText('Issue Cockpit · Mission Control')).toBeTruthy()
    expect(screen.getByText('PAN-1661')).toBeTruthy()
    expect(screen.getByText('◢ Pipeline · live')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Overview' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /PR & CI/ })).toBeTruthy()
    expect(screen.getByText('Blocker spotlight')).toBeTruthy()
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

  it('shows first-class CI checks from the PR & CI tab', () => {
    renderMissionControl()

    fireEvent.click(screen.getByRole('button', { name: /PR & CI/ }))

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
