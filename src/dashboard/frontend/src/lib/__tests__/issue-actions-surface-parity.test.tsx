import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ZoneBActionStrip } from '../../components/CommandDeck/ZoneBActionStrip';
import { DialogProvider } from '../../components/DialogProvider';
import DrawerActionBar from '../../components/drawer/DrawerActionBar';
import { GroupedIssueActionMenu } from '../../components/IssueActionMenu/GroupedIssueActionMenu';
import type { IssueActionView, UseIssueActionsResult } from '../../components/IssueActionMenu/useIssueActions';
import { IssueCard } from '../../components/KanbanBoard/cards/KanbanCards';
import { PipelineView } from '../../components/Pipeline/PipelineView';
import { ContextMenuRoot, ContextMenuTrigger } from '../../components/shared/ContextMenu';
import { IssueMissionControl } from '../../components/Stage/cockpit/IssueMissionControl';
import { useDashboardStore } from '../store';
import type { Agent, Issue } from '../../types';
import {
  GROUP_ORDER,
  ISSUE_ACTIONS,
  PROJECT_TREE_CONTEXT_ACTIONS,
  ZONE_B_SESSION_ACTIONS,
  deriveIssueActionPhase,
  getPhasePrimaryActions,
  type IssueActionEntry,
  type IssueActionState,
  type NonIssueActionContext,
  type NonIssueActionEntry,
  type PipelinePhase,
} from '../issueActions';

const hookState = vi.hoisted(() => ({ current: null as unknown }));
const drawerDataState = vi.hoisted(() => ({ current: null as unknown }));
const cockpitQueryMocks = vi.hoisted(() => ({
  activity: { data: { sections: [] } },
  checks: { isLoading: false, data: { summary: { total: 0, passed: 0 }, checkRuns: [] } },
  planning: { data: { prd: '', state: '' }, isLoading: false },
  pr: { data: {} },
  review: { data: undefined },
  costs: { data: { totalCost: 0, totalTokens: 0, byModel: {}, sessions: [] } },
  workspace: { data: null, isLoading: false },
  shipLog: { data: null, isLoading: false },
}));

vi.mock('../../components/IssueActionMenu/useIssueActions', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useIssueActions: () => hookState.current,
  };
});

vi.mock('../../components/drawer/useDrawerData', () => ({
  useDrawerData: () => drawerDataState.current,
  useIssueData: () => drawerDataState.current,
}));

vi.mock('../../components/CommandDeck/ZoneCOverviewTabs/queries', () => ({
  useActivityQuery: () => cockpitQueryMocks.activity,
  useIssueCheckRunsQuery: () => cockpitQueryMocks.checks,
  usePlanningQuery: () => cockpitQueryMocks.planning,
  usePrQuery: () => cockpitQueryMocks.pr,
  useReviewStatusQuery: () => cockpitQueryMocks.review,
  useIssueCostsQuery: () => cockpitQueryMocks.costs,
  useWorkspaceQuery: () => cockpitQueryMocks.workspace,
  useShipLogQuery: () => cockpitQueryMocks.shipLog,
}));

vi.mock('../../components/MergeButton', () => ({
  MergeButton: () => <button type="button">Merge</button>,
}));

vi.mock('../../components/AutoMergeToggle', () => ({
  AutoMergeToggle: () => <span>Auto merge</span>,
}));

vi.mock('../../components/drawer/DrawerArtifactsPanel', () => ({ default: () => <div>Artifacts</div> }));
vi.mock('../../components/CommandDeck/ZoneCOverviewTabs/ActivityTab', () => ({ ActivityTab: () => <div>Activity</div> }));
vi.mock('../../components/CommandDeck/ZoneCOverviewTabs/CostsTab', () => ({ CostsTab: () => <div>Costs</div> }));
vi.mock('../../components/CommandDeck/ZoneCOverviewTabs/DiscussionsTab', () => ({ DiscussionsTab: () => <div>Discussions</div> }));
vi.mock('../../components/CommandDeck/ZoneCOverviewTabs/MarkdownTab', () => ({ MarkdownTab: () => <div>Markdown</div> }));
vi.mock('../../components/CommandDeck/ZoneCOverviewTabs/TasksTab', () => ({ TasksTab: () => <div>Tasks</div> }));
vi.mock('../../components/CommandDeck/ZoneCOverviewTabs/VBriefTab', () => ({ VBriefTab: () => <div>vBRIEF</div> }));
vi.mock('../../components/CommandDeck/ZoneCOverviewTabs/PrDiffTab', () => ({
  statusColor: () => ({ bg: 'transparent', fg: 'currentColor', label: 'pass' }),
}));
vi.mock('../../components/CommandDeck/SessionView/SessionPanel', () => ({ SessionPanel: () => <div>Session</div> }));
vi.mock('../../components/Stage/cockpit/AgentsLane', () => ({ AgentsLane: () => <div>Agents</div> }));
vi.mock('../../components/Stage/cockpit/ChangedFilesView', () => ({ ChangedFilesView: () => <div>Changed files</div> }));
vi.mock('../../components/Stage/cockpit/IssueBlockerSpotlight', () => ({ IssueBlockerSpotlight: () => <div>Blocker</div> }));
vi.mock('../../components/Stage/cockpit/PickupGateCard', () => ({ PickupGateCard: () => <div>Pickup gate</div> }));
vi.mock('../../components/Stage/cockpit/StatusHistoryTab', () => ({ StatusHistoryTab: () => <div>History</div> }));
vi.mock('../../components/Stage/cockpit/TasksRail', () => ({
  TasksRail: () => <div>Task rail</div>,
  useTasksQuery: () => ({ data: { tasks: [] }, isLoading: false, error: null }),
}));

type Surface = 'cockpit' | 'rail' | 'board' | 'drawer' | 'pipeline' | 'zone-b';
type FixtureName = 'unplanned' | 'planned' | 'working' | 'paused' | 'ready_to_merge' | 'merged';
type ActionRegistry = {
  issue: readonly IssueActionEntry[];
  rail: readonly NonIssueActionEntry[];
  zoneB: readonly NonIssueActionEntry[];
};
type SurfaceContext = {
  rail: NonIssueActionContext;
  zoneB: NonIssueActionContext;
};
type SurfaceExpectation = {
  actions: Record<string, boolean>;
  groupOrder: string[];
  sessionExtras: string[];
  pinnedComponents: string[];
  dangerLast: boolean;
};

type StateFixture = {
  name: FixtureName;
  phase: PipelinePhase;
  state: IssueActionState;
  sessionPresence: 'active' | 'suspended';
};

const REGISTRY: ActionRegistry = {
  issue: ISSUE_ACTIONS,
  rail: PROJECT_TREE_CONTEXT_ACTIONS,
  zoneB: ZONE_B_SESSION_ACTIONS,
};

const noop = () => undefined;
const BASE_STATE: IssueActionState = {
  reviewStatus: null,
  agent: null,
  lifecycle: null,
  workspace: { exists: false, path: undefined, mrUrl: null },
  hasPlan: false,
  hasTasks: false,
  hasInference: true,
  hasTranscripts: true,
  hasDiscussions: true,
  issueCanonicalState: 'todo',
  isMerged: false,
  hasPr: false,
  prUrl: null,
  selectedTaskId: 'task-1',
  hasPendingInput: false,
};

const STATE_FIXTURES: readonly StateFixture[] = [
  { name: 'unplanned', phase: 'QUEUED_FOR_PLAN', state: BASE_STATE, sessionPresence: 'active' },
  {
    name: 'planned',
    phase: 'PLANNED_IDLE',
    sessionPresence: 'active',
    state: {
      ...BASE_STATE,
      workspace: { exists: true, path: '/tmp/feature-pan-1610', mrUrl: null },
      hasPlan: true,
      hasTasks: true,
      issueCanonicalState: 'planned',
    },
  },
  {
    name: 'working',
    phase: 'WORK_RUNNING',
    sessionPresence: 'active',
    state: {
      ...BASE_STATE,
      agent: { status: 'running', role: 'work', paused: false, troubled: false },
      workspace: { exists: true, path: '/tmp/feature-pan-1610', mrUrl: null },
      hasPlan: true,
      hasTasks: true,
      issueCanonicalState: 'in_progress',
    },
  },
  {
    name: 'paused',
    phase: 'WORK_RUNNING',
    sessionPresence: 'suspended',
    state: {
      ...BASE_STATE,
      agent: { status: 'running', role: 'work', paused: true, troubled: false },
      lifecycle: { canResumeSession: true },
      workspace: { exists: true, path: '/tmp/feature-pan-1610', mrUrl: null },
      hasPlan: true,
      hasTasks: true,
      issueCanonicalState: 'in_progress',
    },
  },
  {
    name: 'ready_to_merge',
    phase: 'READY_TO_MERGE',
    sessionPresence: 'active',
    state: {
      ...BASE_STATE,
      reviewStatus: { reviewStatus: 'passed', testStatus: 'passed', mergeStatus: 'pending', readyForMerge: true },
      agent: { status: 'stopped', role: 'work', paused: false, troubled: false },
      workspace: { exists: true, path: '/tmp/feature-pan-1610', mrUrl: 'https://example.test/pr/1610' },
      hasPlan: true,
      hasTasks: true,
      hasPr: true,
      prUrl: 'https://example.test/pr/1610',
      issueCanonicalState: 'in_review',
    },
  },
  {
    name: 'merged',
    phase: 'MERGED',
    sessionPresence: 'active',
    state: {
      ...BASE_STATE,
      reviewStatus: { reviewStatus: 'passed', testStatus: 'passed', mergeStatus: 'merged', readyForMerge: true },
      agent: { status: 'stopped', role: 'work', paused: false, troubled: false },
      lifecycle: { canResumeSession: true },
      workspace: { exists: true, path: '/tmp/feature-pan-1610', mrUrl: 'https://example.test/pr/1610' },
      hasPlan: true,
      hasTasks: true,
      hasPr: true,
      prUrl: 'https://example.test/pr/1610',
      isMerged: true,
      issueCanonicalState: 'verifying_on_main',
    },
  },
];

const SURFACES: readonly Surface[] = ['cockpit', 'rail', 'board', 'drawer', 'pipeline', 'zone-b'];

function issueId(key: string) {
  return `issue:${key}`;
}

function nonIssueId(scope: string, key: string) {
  return `${scope}:${key}`;
}

function viewsForState(registry: readonly IssueActionEntry[], state: IssueActionState) {
  return registry.map<IssueActionView>((action) => ({
    action,
    enabled: action.enabledWhen(state),
    disabledReason: action.enabledWhen(state) ? undefined : `${action.label} is gated for this fixture.`,
    isPending: false,
    invoke: noop,
  }));
}

function layoutForState(registry: readonly IssueActionEntry[], state: IssueActionState) {
  const all = viewsForState(registry, state);
  const byKey = new Map(all.map((view) => [view.action.key, view]));
  const phase = deriveIssueActionPhase(state);
  const primary = getPhasePrimaryActions(state, phase)
    .map((action) => byKey.get(action.key))
    .filter((view): view is IssueActionView => !!view);
  const primaryKeys = new Set(primary.map((view) => view.action.key));
  const rest = all.filter((view) => !primaryKeys.has(view.action.key));
  const secondary = rest
    .filter((view) => view.enabled && view.action.kind !== 'destructive' && view.action.group !== 'danger')
    .slice(0, 4);
  const secondaryKeys = new Set(secondary.map((view) => view.action.key));
  const overflow = rest.filter((view) => !secondaryKeys.has(view.action.key));
  return { all, primary, secondary, overflow, phase };
}

function surfaceContexts(sessionPresence: StateFixture['sessionPresence']): SurfaceContext {
  return {
    rail: {
      sessionId: 'agent-pan-1610',
      hasJsonl: true,
      onOpenStateDir: noop,
      onViewJsonl: noop,
    },
    zoneB: {
      sessionId: 'agent-pan-1610',
      issueId: 'PAN-1610',
      sessionType: 'work',
      sessionPresence,
      tmuxSession: 'agent-pan-1610',
      hasJsonl: true,
      roundCount: 2,
      onStopSession: noop,
      onViewTerminal: noop,
      onPauseSession: noop,
      onResumeSession: noop,
      onRestartSession: noop,
      onReplaySession: noop,
      onOpenStateDir: noop,
      onViewState: noop,
      onViewXbrief: noop,
      onCopySessionId: noop,
      onCopyTmuxCommand: noop,
      onExportSessionMetadata: noop,
      onExportRoundHistory: noop,
      onDeepWipe: noop,
    },
  };
}

export function expectedActions(
  registry: ActionRegistry,
  state: IssueActionState,
  surface: Surface,
  context: SurfaceContext,
): SurfaceExpectation {
  if (surface === 'zone-b') {
    const available = registry.zoneB
      .filter((action) => action.ownerSurface === 'ZoneBActionStrip' && action.scope === 'session')
      .filter((action) => action.enabledWhen(context.zoneB));
    return {
      actions: Object.fromEntries(available.map((action) => [nonIssueId(action.scope, action.key), true])),
      groupOrder: ['session', 'danger'],
      sessionExtras: available.map((action) => nonIssueId(action.scope, action.key)),
      pinnedComponents: [],
      dangerLast: available.at(-1)?.key === 'deepWipe',
    };
  }

  const layout = layoutForState(registry.issue, state);
  const enabledPinKeys = surface === 'drawer'
    ? new Set(layout.all.filter((view) => view.action.key === 'viewPr' && view.enabled).map((view) => view.action.key))
    : new Set<string>();
  const grouped = [...layout.all].filter((view) => !enabledPinKeys.has(view.action.key));
  const rendered = layout.all;
  const railExtras = surface === 'rail'
    ? registry.rail
      .filter((action) => action.ownerSurface === 'FeatureItem' && action.scope === 'session-artifact')
      .filter((action) => action.enabledWhen(context.rail))
    : [];
  const normalGroups = GROUP_ORDER
    .filter((group) => group !== 'danger')
    .filter((group) => grouped.some((view) => view.action.group === group));
  const phaseSection = (surface !== 'zone-b')
    && layout.primary.some((view) => view.enabled)
    ? ['phase']
    : [];
  const sessionSection = railExtras.length > 0 ? ['session'] : [];
  const groupOrder = [...phaseSection, ...normalGroups, ...sessionSection, 'danger'];
  const actions = Object.fromEntries([
    ...rendered.map((view) => [issueId(view.action.key), view.enabled] as const),
    ...railExtras.map((action) => [nonIssueId(action.scope, action.key), true] as const),
  ]);

  return {
    actions,
    groupOrder,
    sessionExtras: railExtras.map((action) => nonIssueId(action.scope, action.key)),
    pinnedComponents: [],
    dangerLast: groupOrder.at(-1) === 'danger',
  };
}

function useActionsResult(state: IssueActionState): UseIssueActionsResult {
  const layout = layoutForState(ISSUE_ACTIONS, state);
  return {
    ...layout,
    issue: undefined,
    agent: undefined,
    workspace: undefined,
    lifecycle: undefined,
    state,
    activeDialog: null,
    closeDialog: noop,
    submitDialogAction: noop,
    isActionPending: () => false,
  };
}

function issueFixture(fixture: StateFixture): Issue {
  return {
    id: 'issue-pan-1610',
    identifier: 'PAN-1610',
    title: 'Issue actions parity',
    status: fixture.state.issueCanonicalState === 'todo' ? 'Todo' : 'In Progress',
    state: fixture.state.issueCanonicalState,
    priority: 2,
    labels: fixture.name === 'unplanned' ? ['ready'] : [],
    url: 'https://github.com/eltmon/overdeck/issues/1610',
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
    project: { id: 'overdeck', name: 'Overdeck', color: '#ffffff' },
    hasPlan: fixture.state.hasPlan,
    hasTasks: fixture.state.hasTasks,
    workspacePath: fixture.state.workspace.path,
    pipelineMembership: {
      inPipeline: true,
      bucket: 'in_flight',
      labelDrift: null,
    },
  };
}

function agentFixture(fixture: StateFixture): Agent | undefined {
  if (!fixture.state.agent) return undefined;
  return {
    id: 'agent-pan-1610',
    issueId: 'PAN-1610',
    runtime: 'claude-code',
    model: 'claude-opus-4-8',
    role: fixture.state.agent.role ?? 'work',
    status: fixture.state.agent.status ?? 'stopped',
    startedAt: '2026-07-17T00:00:00.000Z',
    consecutiveFailures: 0,
    killCount: 0,
    paused: fixture.state.agent.paused,
    troubled: fixture.state.agent.troubled,
  };
}

const queryClients: QueryClient[] = [];

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  queryClients.push(queryClient);
  return render(
    <QueryClientProvider client={queryClient}>
      <DialogProvider>{ui}</DialogProvider>
    </QueryClientProvider>,
  );
}

function prepareStore(fixture: StateFixture) {
  const issue = issueFixture(fixture);
  const agent = agentFixture(fixture);
  useDashboardStore.setState({
    drawer: { issueId: null, tab: 'overview' },
    issuesRaw: [issue],
    agentsById: agent ? { [agent.id]: agent } : {},
    reviewStatusByIssueId: fixture.state.reviewStatus
      ? {
          'PAN-1610': {
            issueId: 'PAN-1610',
            updatedAt: '2026-07-17T00:00:00.000Z',
            ...fixture.state.reviewStatus,
          },
        }
      : {},
  } as Parameters<typeof useDashboardStore.setState>[0]);
  return { issue, agent };
}

function renderSurface(surface: Surface, fixture: StateFixture, context: SurfaceContext) {
  const actions = useActionsResult(fixture.state);
  hookState.current = actions;
  const { issue, agent } = prepareStore(fixture);

  if (surface === 'rail') {
    const nonIssueActions = PROJECT_TREE_CONTEXT_ACTIONS
      .filter((action) => action.ownerSurface === 'FeatureItem' && action.scope === 'session-artifact')
      .filter((action) => action.enabledWhen(context.rail))
      .map((action) => ({ action, context: context.rail }));
    render(
      <ContextMenuRoot>
        <ContextMenuTrigger>Open rail actions</ContextMenuTrigger>
        <GroupedIssueActionMenu actions={actions} nonIssueActions={nonIssueActions} />
      </ContextMenuRoot>,
    );
    fireEvent.contextMenu(screen.getByText('Open rail actions'));
  } else if (surface === 'zone-b') {
    renderWithProviders(
      <ZoneBActionStrip
        issueId="PAN-1610"
        onViewTerminal={noop}
        session={{
          sessionId: 'agent-pan-1610',
          type: 'work',
          presence: fixture.sessionPresence,
          tmuxSession: 'agent-pan-1610',
          hasJsonl: true,
          roundMetadata: { roundCount: 2 },
        } as any}
      />,
    );
    fireEvent.click(screen.getByTestId('zone-b-overflow'));
  } else if (surface === 'cockpit') {
    renderWithProviders(
      <IssueMissionControl
        issueId="PAN-1610"
        title="Issue actions parity"
        branch="feature/pan-1610"
        launcher={<div>Launcher</div>}
        agentDock={<div>Agent dock</div>}
        actionDock={<div>Action dock</div>}
        timeline={<div>Timeline</div>}
        onOpenPane={noop}
      />,
    );
    fireEvent.click(screen.getByTestId('issue-action-overflow-button'));
  } else if (surface === 'board') {
    renderWithProviders(
      <IssueCard
        issue={issue}
        workAgent={agent?.role === 'work' ? agent : undefined}
        planningAgent={agent?.role === 'plan' ? agent : undefined}
        specialists={agent && agent.role !== 'work' && agent.role !== 'plan' ? [agent] : []}
        isSelected={false}
        onSelect={noop}
        onPlan={noop}
        planningState={{
          hasPlan: fixture.state.hasPlan,
          hasTasks: fixture.state.hasTasks,
        }}
        workspace={{
          exists: fixture.state.workspace.exists,
          issueId: 'PAN-1610',
          path: fixture.state.workspace.path,
        }}
      />,
    );
    fireEvent.contextMenu(screen.getByTestId('issue-card-PAN-1610'));
  } else if (surface === 'drawer') {
    drawerDataState.current = {
      issue,
      agents: agent ? [agent] : [],
      reviewStatus: fixture.state.reviewStatus,
      tasks: [],
      reviewSpecialists: [],
      verificationGates: [],
      phaseTimeline: [],
      activityRail: [],
      activityFull: [],
    };
    renderWithProviders(<DrawerActionBar />);
    fireEvent.click(screen.getByTestId('issue-action-overflow-button'));
  } else {
    const { container } = renderWithProviders(<PipelineView />);
    const row = container.querySelector(
      '[data-component="issue-row"][data-issue-id="PAN-1610"]',
    );
    if (!(row instanceof HTMLElement)) throw new Error('Missing production pipeline issue row');
    fireEvent.contextMenu(row);
  }

  if (surface !== 'zone-b') {
    fireEvent.click(screen.getByRole('menuitem', { name: /^Danger \(\d+ available\)$/ }));
  }
}

const CONTROL_TEST_IDS = new Set([
  'issue-action-menu',
  'issue-action-overflow-menu',
  'issue-action-overflow-button',
  'issue-action-pin-spacer',
  'issue-action-explain-toggle',
]);

function observeSurface(surface: Surface): SurfaceExpectation {
  if (surface === 'zone-b') {
    const actionKeys = Array.from(document.querySelectorAll<HTMLElement>('[data-action-key]'))
      .map((element) => element.dataset.actionKey)
      .filter((key): key is string => !!key);
    return {
      actions: Object.fromEntries(actionKeys.map((key) => [nonIssueId('session', key), true])),
      groupOrder: ['session', 'danger'],
      sessionExtras: actionKeys.map((key) => nonIssueId('session', key)),
      pinnedComponents: [],
      dangerLast: actionKeys.at(-1) === 'deepWipe',
    };
  }

  const actions: Record<string, boolean> = {};
  for (const element of document.querySelectorAll<HTMLElement>('[data-testid^="issue-action-"]')) {
    const testId = element.dataset.testid;
    if (!testId || CONTROL_TEST_IDS.has(testId)) continue;
    const disabled = testId.match(/^issue-action-disabled-(.+)$/);
    const enabled = testId.match(/^issue-action-(.+)$/);
    const key = disabled?.[1] ?? enabled?.[1];
    if (!key) continue;
    const renderedDisabled = (element instanceof HTMLButtonElement && element.disabled)
      || element.getAttribute('aria-disabled') === 'true'
      || element.hasAttribute('data-disabled');
    const value = disabled ? false : !renderedDisabled;
    const id = issueId(key);
    if (id in actions && actions[id] !== value) throw new Error(`inconsistent gating for ${id}`);
    actions[id] = value;
  }
  const sessionExtras = Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="non-issue-action-"]'))
    .map((element) => nonIssueId('session-artifact', element.dataset.testid!.replace('non-issue-action-', '')));
  for (const id of sessionExtras) actions[id] = true;
  const groupOrder = Array.from(document.querySelectorAll<HTMLElement>('[data-issue-action-section]'))
    .map((element) => element.dataset.issueActionSection)
    .filter((group): group is string => !!group);
  const pinnedComponents = Array.from(document.querySelectorAll<HTMLElement>('[data-issue-action-pinned-component]'))
    .map((element) => element.dataset.issueActionPinnedComponent)
    .filter((key): key is string => !!key);

  return {
    actions,
    groupOrder,
    sessionExtras,
    pinnedComponents,
    dangerLast: groupOrder.at(-1) === 'danger',
  };
}

function compareSurface(expected: SurfaceExpectation, actual: SurfaceExpectation) {
  const expectedIds = Object.keys(expected.actions).sort();
  const actualIds = Object.keys(actual.actions).sort();
  const unexpected = actualIds.filter((id) => !expectedIds.includes(id));
  if (unexpected.length > 0) throw new Error(`out-of-registry menu item: ${unexpected.join(', ')}`);

  const missingExtras = expected.sessionExtras.filter((id) => !actual.sessionExtras.includes(id));
  if (missingExtras.length > 0) throw new Error(`missing session extra: ${missingExtras.join(', ')}`);
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) throw new Error('action identity mismatch');

  for (const id of expectedIds) {
    if (actual.actions[id] !== expected.actions[id]) throw new Error(`gating divergence: ${id}`);
  }
  if (JSON.stringify(actual.groupOrder) !== JSON.stringify(expected.groupOrder)) throw new Error('group-order mutation');
  if (expected.dangerLast !== actual.dangerLast || !actual.dangerLast) throw new Error('danger actions are not last');
  if (JSON.stringify(actual.pinnedComponents.sort()) !== JSON.stringify(expected.pinnedComponents.sort())) {
    throw new Error('pinned component mismatch');
  }
}

const CASES = STATE_FIXTURES.flatMap((fixture) => SURFACES.map((surface) => ({ fixture, surface })));

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method !== 'GET') throw new Error(`Unexpected mutation request: ${method} ${url}`);
    if (url.startsWith('/api/costs/stream')) {
      return Response.json({ events: [], byIssue: {}, count: 0 });
    }
    if (url === '/api/issues/resource-allocated') return Response.json([]);
    if (url.startsWith('/api/session-trees')) return Response.json({ trees: [] });
    if (url.endsWith('/api/dashboard/session')) return Response.json({ csrfToken: 'test-csrf-token' });
    if (url === '/api/settings') return Response.json({ tts: { mutedIssues: [] } });
    if (url === '/api/settings/available-models') return Response.json({});
    if (url === '/api/settings/openrouter/models') return Response.json({ models: [], favorites: [] });
    if (url === '/api/settings/claude-auth') return Response.json({ authenticated: false });
    if (url.startsWith('/api/settings/harness-policy')) return Response.json({ decisions: {} });
    return Response.json({});
  }));
});

afterEach(async () => {
  await Promise.all(queryClients.map((client) => client.cancelQueries()));
  cleanup();
  for (const client of queryClients.splice(0)) client.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('issue action cross-surface parity', () => {
  it.each(CASES)('$fixture.name state matches the $surface oracle', ({ fixture, surface }) => {
    expect(deriveIssueActionPhase(fixture.state)).toBe(fixture.phase);
    const context = surfaceContexts(fixture.sessionPresence);
    const expected = expectedActions(REGISTRY, fixture.state, surface, context);

    renderSurface(surface, fixture, context);
    const actual = observeSurface(surface);

    expect(() => compareSurface(expected, actual)).not.toThrow();
  });

  it('renders merge through the registry on the drawer (no bespoke pin)', () => {
    const fixture = STATE_FIXTURES.find((entry) => entry.name === 'ready_to_merge')!;
    const context = surfaceContexts(fixture.sessionPresence);
    const expected = expectedActions(REGISTRY, fixture.state, 'drawer', context);

    renderSurface('drawer', fixture, context);
    const actual = observeSurface('drawer');

    expect(actual.actions[issueId('viewPr')]).toBe(true);
    expect(actual.actions[issueId('merge')]).toBe(true);
    expect(actual.pinnedComponents).toEqual([]);
    expect(() => compareSurface(expected, actual)).not.toThrow();
  });

  it('rejects every cross-surface drift class', () => {
    const fixture = STATE_FIXTURES.find((entry) => entry.name === 'working')!;
    const expected = expectedActions(REGISTRY, fixture.state, 'rail', surfaceContexts(fixture.sessionPresence));

    expect(() => compareSurface(expected, {
      ...expected,
      actions: { ...expected.actions, 'issue:rogueMenuAction': true },
    })).toThrow(/out-of-registry menu item/);

    const gatedKey = Object.keys(expected.actions)[0]!;
    expect(() => compareSurface(expected, {
      ...expected,
      actions: { ...expected.actions, [gatedKey]: !expected.actions[gatedKey] },
    })).toThrow(/gating divergence/);

    expect(() => compareSurface(expected, {
      ...expected,
      groupOrder: [expected.groupOrder[1]!, expected.groupOrder[0]!, ...expected.groupOrder.slice(2)],
    })).toThrow(/group-order mutation/);

    const missingExtra = expected.sessionExtras[0]!;
    expect(() => compareSurface(expected, {
      ...expected,
      actions: Object.fromEntries(Object.entries(expected.actions).filter(([id]) => id !== missingExtra)),
      sessionExtras: expected.sessionExtras.filter((id) => id !== missingExtra),
    })).toThrow(/missing session extra/);
  });
});
