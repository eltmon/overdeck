import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ZoneBActionStrip } from '../../components/CommandDeck/ZoneBActionStrip';
import { DialogProvider } from '../../components/DialogProvider';
import { ContextMenuRoot, ContextMenuTrigger } from '../../components/shared/ContextMenu';
import { GroupedIssueActionMenu } from '../../components/IssueActionMenu/GroupedIssueActionMenu';
import { IssueActionMenu } from '../../components/IssueActionMenu/IssueActionMenu';
import type { IssueActionView, UseIssueActionsResult } from '../../components/IssueActionMenu/useIssueActions';
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

vi.mock('../../components/IssueActionMenu/useIssueActions', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useIssueActions: () => hookState.current,
  };
});

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
      onViewJsonl: noop,
      onViewState: noop,
      onViewVbrief: noop,
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
  const pinKeys = surface === 'drawer' ? new Set(['viewPr']) : new Set<string>();
  const grouped = surface === 'rail' || surface === 'pipeline'
    ? layout.all
    : [...layout.secondary, ...layout.overflow].filter((view) => !pinKeys.has(view.action.key));
  const rendered = surface === 'drawer'
    ? layout.all.filter((view) => view.action.key !== 'viewPr' || view.enabled)
    : layout.all;
  const railExtras = surface === 'rail'
    ? registry.rail
      .filter((action) => action.ownerSurface === 'FeatureItem' && action.scope === 'session-artifact')
      .filter((action) => action.enabledWhen(context.rail))
    : [];
  const normalGroups = GROUP_ORDER
    .filter((group) => group !== 'danger')
    .filter((group) => grouped.some((view) => view.action.group === group));
  const phaseSection = surface === 'rail' && layout.primary.some((view) => view.enabled) ? ['phase'] : [];
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
    pinnedComponents: surface === 'drawer' ? ['merge'] : [],
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

function renderSurface(surface: Surface, fixture: StateFixture, context: SurfaceContext) {
  const actions = useActionsResult(fixture.state);
  hookState.current = actions;

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
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <DialogProvider>
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
          />
        </DialogProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByTestId('zone-b-overflow'));
  } else {
    const drawerProps = surface === 'drawer'
      ? { pinRight: ['viewPr'] as const, pinned: [{ key: 'merge', render: <button type="button">Merge</button> }] }
      : {};
    render(
      <IssueActionMenu
        issueId="PAN-1610"
        mode={surface === 'pipeline' ? 'overflow-only' : 'primary-strip'}
        {...drawerProps}
      />,
    );
    fireEvent.click(screen.getByTestId('issue-action-overflow-button'));
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
    const value = disabled ? false : !(element instanceof HTMLButtonElement && element.disabled);
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
});

afterEach(() => {
  cleanup();
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

  it('keeps the drawer merge component pin outside registry menu parity', () => {
    const fixture = STATE_FIXTURES.find((entry) => entry.name === 'ready_to_merge')!;
    const context = surfaceContexts(fixture.sessionPresence);
    const expected = expectedActions(REGISTRY, fixture.state, 'drawer', context);

    renderSurface('drawer', fixture, context);
    const actual = observeSurface('drawer');

    expect(actual.actions[issueId('viewPr')]).toBe(true);
    expect(actual.pinnedComponents).toEqual(['merge']);
    expect(Object.keys(actual.actions)).not.toContain('issue:merge');
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
