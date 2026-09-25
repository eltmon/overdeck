import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DialogProvider } from '../../components/DialogProvider';
import { IssueActionContextMenu as GroupedIssueActionMenu } from '../../components/IssueActionMenu';
import { IssueActionMenu } from '../../components/IssueActionMenu';
import { useIssueActions, type IssueActionView } from '../../components/IssueActionMenu/useIssueActions';
import { ContextMenuRoot, ContextMenuTrigger } from '../../components/shared/ContextMenu';
import {
  GROUP_ORDER,
  ISSUE_ACTIONS,
  deriveIssueActionPhase,
  getMenuActions,
  getPhasePrimaryActions,
  type IssueActionEntry,
  type IssueActionKey,
  type IssueActionState,
  type PipelinePhase,
} from '../issueActions';
import { useDashboardStore } from '../store';
import type { Agent, Issue } from '../../types';

export const ISSUE_SCOPED_PAN_VERBS = [
  // PAN-4198 D6: 'plan --auto' (autoPlan), 'start --auto' (startSkipPlanning)
  // and 'wipe' left the registry with their UI entries. `pan plan --auto`,
  // `pan start --auto` and `pan wipe` remain CLI verbs.
  'plan',
  'plan finalize',
  'start',
  'tell',
  'done',
  'review request',
  'review restart',
  'kill',
  'pause',
  'unpause',
  'recover',
  'resume',
  'sync-main',
  'reopen',
  'close',
  'destroy',
  'open',
] as const;

const AUDITED_REGISTRY_KEYS = [
  'plan',
  'autoPlan',
  'watchPlanning',
  'donePlanning',
  'startAgent',
  'startSkipPlanning',
  'tell',
  'doneWork',
  'requestReview',
  'restartReview',
  'stopAgent',
  'pause',
  'unpause',
  'recoverAgent',
  'resumeSession',
  'syncMain',
  'rebuildAndStart',
  'merge',
  'reopen',
  'closeOut',
  'wipe',
  'destroyWorkspace',
  'open',
  'resetIssue',
  'viewPr',
  'cancel',
  'tasks',
  'inference',
  'discussions',
  'transcripts',
  'upload',
  'syncDiscussions',
  'createWorkspace',
  'copySettings',
  'resetSession',
  'completeWorkReset',
  'restartFromPlan',
  'restartAgent',
  'addToOrderBook',
  'reviewTest',
] as const;

export const RETIREMENT_AUDIT = [
  {
    retiredKey: 'autoPlan',
    consumer: 'issue menu Auto-plan',
    successorKeys: ['plan'],
  },
  {
    retiredKey: 'startSkipPlanning',
    consumer: 'issue menu Start without planning',
    successorKeys: ['plan'],
  },
  {
    retiredKey: 'wipe',
    consumer: 'issue menu Wipe',
    successorKeys: ['resetIssue'],
  },
  {
    retiredKey: 'inference',
    consumer: 'issue menu Inference',
    successorKeys: [],
    newHome: 'src/dashboard/frontend/src/components/Stage/panes/DocsPane.tsx',
  },
  {
    retiredKey: 'discussions',
    consumer: 'issue menu Discussions',
    successorKeys: [],
    newHome: 'src/dashboard/frontend/src/components/Stage/cockpit/IssueDigTabs.tsx',
  },
  {
    retiredKey: 'transcripts',
    consumer: 'issue menu Transcripts',
    successorKeys: [],
    newHome: 'src/dashboard/frontend/src/lib/store.ts',
  },
  {
    retiredKey: 'upload',
    consumer: 'issue menu Upload transcript',
    successorKeys: [],
    dropped: 'Hard-disabled since it was added, with no handler behind it.',
  },
  {
    retiredKey: 'syncDiscussions',
    consumer: 'issue menu Sync discussions',
    successorKeys: [],
    dropped: 'Rare enough to be automation-only; POST /api/command-deck/planning/:id/sync-discussions stays.',
  },
  {
    retiredKey: 'copySettings',
    consumer: 'issue menu Copy settings',
    successorKeys: [],
    dropped: 'Rare enough to be automation-only; POST /api/issues/:id/copy-settings stays.',
  },
  {
    retiredKey: 'resetSession',
    consumer: 'issue menu Reset session',
    successorKeys: ['restartAgent'],
  },
  {
    retiredKey: 'completeWorkReset',
    consumer: 'issue menu Complete work reset',
    successorKeys: ['restartAgent'],
  },
  {
    retiredKey: 'restartFromPlan',
    consumer: 'issue menu Restart from plan',
    successorKeys: ['restartAgent'],
  },
  {
    retiredKey: 'reviewTest',
    consumer: 'ReviewVerificationCard',
    successorKeys: ['restartReview'],
  },
  {
    retiredKey: 'reviewTest',
    consumer: 'spotlight Tests failed',
    successorKeys: ['restartReview'],
  },
  {
    retiredKey: 'reviewTest',
    consumer: "drawer legacy 'Review & Test'",
    successorKeys: ['requestReview'],
  },
] as const satisfies ReadonlyArray<{
  retiredKey: string;
  consumer: string;
  /** Live keys that took the work over. Empty when the action moved or was dropped. */
  successorKeys: readonly IssueActionKey[];
  /** Repository-relative file that now owns the behavior (PAN-4198 D7). */
  newHome?: string;
  /** Why the action went away with no replacement (PAN-4198 D7). */
  dropped?: string;
}>;

const DESTRUCTIVE_ACTION_KEYS = [
  'closeOut',
  'resetIssue',
  'destroyWorkspace',
  'cancel',
] as const satisfies readonly IssueActionKey[];

vi.mock('../../components/PanOpenInPicker', () => ({
  PanOpenInPicker: ({ openInCwd }: { openInCwd: string | null }) => <div data-testid="pan-open-picker">Open {openInCwd ?? ''}</div>,
}));

const repositoryRoot = resolve(process.cwd(), '../../..');
const commandFilesDir = resolve(repositoryRoot, 'src/cli/commands');
const commandFiles = new Set(readdirSync(commandFilesDir).filter((entry) => entry.endsWith('.ts')));

function commandFileForPanVerb(panVerb: string) {
  switch (panVerb) {
    case 'plan finalize':
      return 'plan-finalize.ts';
    case 'review request':
      return 'request-review.ts';
    case 'review restart':
      return 'review-restart.ts';
    case 'destroy':
      return 'workspace.ts';
    default:
      return `${panVerb.split(' ')[0]}.ts`;
  }
}

function issue(): Issue {
  return {
    id: 'issue-pan-1331',
    identifier: 'PAN-1331',
    title: 'Restore action surface',
    status: 'In Progress',
    priority: 2,
    labels: [],
    url: 'https://example.test/PAN-1331',
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    project: { id: 'pan', name: 'Overdeck', color: '#fff' },
    hasPlan: true,
    hasTasks: true,
    workspacePath: '/tmp/feature-pan-1331',
  };
}

function agent(): Agent {
  return {
    id: 'agent-pan-1331',
    issueId: 'PAN-1331',
    runtime: 'claude-code',
    model: 'claude-opus-4-7',
    status: 'running',
    startedAt: '2026-05-23T00:00:00.000Z',
    consecutiveFailures: 0,
    killCount: 0,
    role: 'work',
    paused: true,
  };
}

const PHASE_FIXTURES: ReadonlyArray<{ phase: PipelinePhase; state: IssueActionState }> = [
  {
    phase: 'WORK_RUNNING',
    state: {
      derived: { issueId: 'PAN-1331', state: 'working' },
      panes: [{ id: 'pane-work', issue: 'PAN-1331', role: 'work', harness: 'claude-code', model: 'claude-opus-5', state: 'working' }],
      agent: { status: 'running', role: 'work', paused: false },
      lifecycle: null,
      workspace: { exists: true, path: '/tmp/feature-pan-1331', mrUrl: null },
      hasPlan: true,
      hasTasks: true,
      hasInference: true,
      hasTranscripts: true,
      hasDiscussions: true,
      issueCanonicalState: 'in_progress',
      isMerged: false,
      hasPr: false,
      prUrl: null,
      selectedTaskId: 'task-1',
      hasPendingInput: false,
    },
  },
  {
    phase: 'STUCK',
    state: {
      derived: { issueId: 'PAN-1331', state: 'changes-requested', attention: 'stuck', pr: { url: 'https://example.test/pr/1331', number: 1331, reviewState: 'changes-requested', checks: 'red', mergeable: false } },
      agent: { status: 'stuck', role: 'work', paused: true },
      lifecycle: { canResumeSession: true },
      workspace: { exists: true, path: '/tmp/feature-pan-1331', mrUrl: 'https://example.test/pr/1331' },
      hasPlan: true,
      hasTasks: true,
      hasInference: true,
      hasTranscripts: true,
      hasDiscussions: true,
      issueCanonicalState: 'in_review',
      isMerged: false,
      hasPr: true,
      prUrl: 'https://example.test/pr/1331',
      selectedTaskId: 'task-1',
      hasPendingInput: false,
    },
  },
  {
    phase: 'MERGED',
    state: {
      derived: { issueId: 'PAN-1331', state: 'merged', pr: { url: 'https://example.test/pr/1331', number: 1331, reviewState: 'approved', checks: 'green', mergeable: true } },
      agent: { status: 'stopped', role: 'work', paused: false },
      lifecycle: { canResumeSession: true },
      workspace: { exists: true, path: '/tmp/feature-pan-1331', mrUrl: 'https://example.test/pr/1331' },
      hasPlan: true,
      hasTasks: true,
      hasInference: true,
      hasTranscripts: true,
      hasDiscussions: true,
      issueCanonicalState: 'done',
      isMerged: true,
      hasPr: true,
      prUrl: 'https://example.test/pr/1331',
      selectedTaskId: 'task-1',
      hasPendingInput: false,
    },
  },
];

function viewsForState(state: IssueActionState) {
  return ISSUE_ACTIONS.map<IssueActionView>((action) => {
    const enabled = action.enabledWhen(state);
    return {
      action,
      enabled,
      disabledReason: enabled ? undefined : `${action.label} is gated for this fixture.`,
      isPending: false,
      invoke: vi.fn(),
    };
  });
}

function renderGroupedMenu(fixture: { phase: PipelinePhase; state: IssueActionState }) {
  const all = viewsForState(fixture.state);
  const byKey = new Map(all.map((view) => [view.action.key, view]));
  const primary = getPhasePrimaryActions(fixture.state, fixture.phase)
    .map((action) => byKey.get(action.key))
    .filter((view): view is IssueActionView => !!view);

  render(
    <ContextMenuRoot>
      <ContextMenuTrigger>Open grouped menu</ContextMenuTrigger>
      <GroupedIssueActionMenu actions={{ all, primary, phase: fixture.phase }} />
    </ContextMenuRoot>,
  );
  fireEvent.contextMenu(screen.getByText('Open grouped menu'));
  return screen.getByRole('menu');
}

function LiveGroupedMenu() {
  const actions = useIssueActions('PAN-1331');
  return (
    <ContextMenuRoot>
      <ContextMenuTrigger>Open live grouped menu</ContextMenuTrigger>
      <GroupedIssueActionMenu actions={actions} />
    </ContextMenuRoot>
  );
}

function renderLiveGroupedMenu() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DialogProvider>
        <LiveGroupedMenu />
      </DialogProvider>
    </QueryClientProvider>,
  );
  fireEvent.contextMenu(screen.getByText('Open live grouped menu'));
  return screen.getByRole('menu');
}

function renderMenu() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DialogProvider>
        <IssueActionMenu issueId="PAN-1331" mode="primary-strip" />
      </DialogProvider>
    </QueryClientProvider>,
  );
}

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/dashboard/session')) {
      return Response.json({ csrfToken: 'test-csrf-token' });
    }
    if (url.includes('/planning-state')) {
      return Response.json({ hasPlan: true, hasTasks: true, tasksCount: 7, planningComplete: true });
    }
    if (url === '/api/orders') {
      return Response.json({ books: [
        { id: 'active-book', name: 'Active campaign', status: 'running', settings: { laneAConcurrency: 2, posture: 'open' }, items: [], createdAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:00:00.000Z' },
        { id: 'done-book', name: 'Completed campaign', status: 'complete', settings: { laneAConcurrency: 2, posture: 'open' }, items: [], createdAt: '2026-07-17T00:00:00.000Z', updatedAt: '2026-07-17T00:00:00.000Z' },
      ] });
    }
    if (url.includes('/api/workspaces/')) {
      return Response.json({
        exists: true,
        issueId: 'PAN-1331',
        path: '/tmp/feature-pan-1331',
        mrUrl: 'https://example.test/pr/1331',
        hasInference: true,
        hasTranscripts: true,
        hasDiscussions: true,
      });
    }
    if (url.includes('/has-session')) {
      return Response.json({ lifecycle: { canResumeSession: true } });
    }
    return Response.json({ success: true });
  });
}

/**
 * The `beforeEach` store fixture as `useIssueActions` derives it: a running,
 * paused work agent on a ready PR with a workspace.
 */
function hookStateForFixture(): IssueActionState {
  return {
    derived: {
      issueId: 'PAN-1331',
      state: 'ready',
      pr: { url: 'https://example.test/pr/1331', number: 1331, reviewState: 'approved', checks: 'green', mergeable: true },
    },
    panes: [],
    agent: { status: 'running', role: 'work', paused: true },
    lifecycle: null,
    workspace: { exists: true, issueId: 'PAN-1331', path: '/tmp/feature-pan-1331' } as IssueActionState['workspace'],
    hasPlan: true,
    hasTasks: true,
    issueCanonicalState: 'in_progress',
    isMerged: false,
    hasPr: true,
    prUrl: 'https://example.test/pr/1331',
    orderBooksLoaded: true,
    isInActiveOrderBook: false,
  };
}

function registryEntriesForVerb(verb: string) {
  return ISSUE_ACTIONS.filter((action) => action.panVerb === verb);
}

describe('issue action CLI ↔ dashboard parity', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch());
    useDashboardStore.setState({
      issuesRaw: [issue()],
      agentsById: { 'agent-pan-1331': agent() },
      derivedIssueStateByIssueId: {
        'PAN-1331': {
          issueId: 'PAN-1331',
          state: 'ready',
          pr: { url: 'https://example.test/pr/1331', number: 1331, reviewState: 'approved', checks: 'green', mergeable: true },
        },
      },
      backendPanesById: {},
      drawer: { issueId: null, tab: 'overview' },
    } as Parameters<typeof useDashboardStore.setState>[0]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('covers every issue-scoped CLI verb with at least one registry entry', () => {
    for (const verb of ISSUE_SCOPED_PAN_VERBS) {
      expect(registryEntriesForVerb(verb).map((action) => action.key), verb).not.toEqual([]);
    }
  });

  it('does not advertise pan verbs without a backing CLI command file', () => {
    expect(existsSync(commandFilesDir)).toBe(true);

    for (const action of ISSUE_ACTIONS) {
      if (!action.panVerb) continue;
      const commandFile = commandFileForPanVerb(action.panVerb);
      expect(commandFiles.has(commandFile), `${action.key}: ${action.panVerb} → ${commandFile}`).toBe(true);
    }
  });

  it('renders every enabled menu-placed label through the shared drawer action menu surface', () => {
    renderMenu();
    fireEvent.click(screen.getByTestId('issue-action-overflow-button'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Danger' }));

    const menu = screen.getByTestId('issue-action-menu');
    const state = hookStateForFixture();
    const expected = new Set(getMenuActions(state).map((action) => action.key));
    // PAN-4198 (FR-1): the menu is the enabled, menu-placed set — no more, no less.
    for (const action of ISSUE_ACTIONS) {
      if (expected.has(action.key)) expect(menu, action.key).toHaveTextContent(action.label);
      else expect(menu, action.key).not.toHaveTextContent(action.label);
    }
  });

  it('renders the order-book submenu from the shared issue action registry', async () => {
    // PAN-4198 tightened canAddToOrderBook: an order book queues work that has
    // not started, so the issue needs no live agent and a pre-work state.
    useDashboardStore.setState({
      agentsById: {},
      derivedIssueStateByIssueId: { 'PAN-1331': { issueId: 'PAN-1331', state: 'planned' } },
    } as Parameters<typeof useDashboardStore.setState>[0]);
    renderLiveGroupedMenu();

    await screen.findByTestId('issue-action-addToOrderBook');
    await vi.waitFor(() => expect(screen.getByTestId('issue-action-addToOrderBook')).not.toHaveAttribute('data-disabled'));
    fireEvent.click(screen.getByTestId('issue-action-addToOrderBook'));

    expect(screen.getByRole('group', { name: 'Add to order book options' })).toHaveTextContent('Active campaign');
    expect(screen.getByRole('group', { name: 'Add to order book options' })).not.toHaveTextContent('Completed campaign');
    expect(screen.getByText('+ New book…')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Active campaign'));
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/orders/active-book/items', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ item: { issue: 'PAN-1331', lane: 'A' } }),
    })));
  });

  it('keeps client-only dashboard actions explicitly out of CLI parity', () => {
    const clientOnlyActions = ISSUE_ACTIONS.filter((action): action is IssueActionEntry & { panVerb: null } => action.panVerb === null);

    expect(clientOnlyActions.map((action) => action.key)).toEqual(expect.arrayContaining([
      'viewPr',
      'resetIssue',
      'tasks',
      'createWorkspace',
      'restartAgent',
      'addToOrderBook',
      'cancel',
    ]));
  });

  it.each(PHASE_FIXTURES)('preserves grouped-menu parity for $phase', (fixture) => {
    expect(deriveIssueActionPhase(fixture.state)).toBe(fixture.phase);
    const menu = renderGroupedMenu(fixture);
    const menuKeys = new Set(getMenuActions(fixture.state).map((action) => action.key));
    const enabledPrimaryKeys = new Set(
      getPhasePrimaryActions(fixture.state, fixture.phase)
        .filter((action) => action.enabledWhen(fixture.state) && action.placement === 'menu')
        .map((action) => action.key),
    );
    // FR-3/FR-4: a group renders only when it has an enabled, non-primary row.
    const groupsWithRows = GROUP_ORDER.filter((group) => ISSUE_ACTIONS.some((action) => (
      action.group === group && menuKeys.has(action.key) && !enabledPrimaryKeys.has(action.key)
    )));

    const sectionsBeforeDanger = Array.from(menu.querySelectorAll<HTMLElement>('[data-issue-action-section]'))
      .map((section) => section.dataset.issueActionSection)
      .filter((section) => section !== 'phase');
    expect(sectionsBeforeDanger).toEqual(groupsWithRows.filter((group) => group !== 'danger'));

    const dangerDisclosure = screen.getByRole('menuitem', { name: 'Danger' });
    const lastSemanticSection = menu.querySelector<HTMLElement>(
      `[data-issue-action-section="${groupsWithRows.filter((group) => group !== 'danger').at(-1)}"]`,
    );
    expect(lastSemanticSection).not.toBeNull();
    expect(lastSemanticSection!.compareDocumentPosition(dangerDisclosure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(dangerDisclosure).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(dangerDisclosure);
    expect(dangerDisclosure).toHaveAttribute('aria-expanded', 'true');
    const semanticSections = Array.from(menu.querySelectorAll<HTMLElement>('[data-issue-action-section]'))
      .map((section) => section.dataset.issueActionSection)
      .filter((section) => section !== 'phase');
    expect(semanticSections).toEqual(groupsWithRows);

    for (const action of ISSUE_ACTIONS) {
      // FR-1: gated and contextual entries render nowhere.
      if (!menuKeys.has(action.key)) {
        expect(screen.queryAllByTestId(`issue-action-${action.key}`), `${fixture.phase}:${action.key}`).toHaveLength(0);
        expect(screen.queryAllByTestId(`issue-action-disabled-${action.key}`), `${fixture.phase}:${action.key}`).toHaveLength(0);
        continue;
      }

      // FR-3: exactly one row, in the phase section for a primary and in its
      // own group for everything else.
      const rows = screen.getAllByTestId(`issue-action-${action.key}`);
      expect(rows, `${fixture.phase}:${action.key}`).toHaveLength(1);
      const homeSelector = enabledPrimaryKeys.has(action.key) ? 'phase' : action.group;
      const homeSection = menu.querySelector<HTMLElement>(`[data-issue-action-section="${homeSelector}"]`);
      expect(homeSection, `${fixture.phase}:${homeSelector}`).not.toBeNull();
      expect(within(homeSection!).getByTestId(`issue-action-${action.key}`)).toBe(rows[0]);
      expect(rows[0], `${fixture.phase}:${action.key}`).not.toHaveAttribute('data-disabled');
    }
  });

  it('requires an explicit retirement audit for every registry key that disappears', () => {
    const activeKeys = ISSUE_ACTIONS.map((action) => action.key);
    const retiredKeys = [...new Set(RETIREMENT_AUDIT.map((row) => row.retiredKey))];
    const missingActiveKeys = AUDITED_REGISTRY_KEYS.filter((key) => !activeKeys.includes(key as IssueActionKey));

    expect(new Set([...activeKeys, ...retiredKeys])).toEqual(new Set(AUDITED_REGISTRY_KEYS));
    expect(missingActiveKeys).toEqual(retiredKeys);
    expect(activeKeys).not.toContain('reviewTest');

    for (const row of RETIREMENT_AUDIT) {
      const hasSuccessor = row.successorKeys.length > 0;
      const hasNewHome = 'newHome' in row && !!row.newHome;
      const hasDroppedReason = 'dropped' in row && !!row.dropped?.trim();
      expect(
        hasSuccessor || hasNewHome || hasDroppedReason,
        `${row.retiredKey} (${row.consumer}) needs a successor, a new home, or a dropped reason`,
      ).toBe(true);
      for (const successorKey of row.successorKeys) {
        expect(activeKeys, `${row.consumer} → ${successorKey}`).toContain(successorKey);
      }
      if (hasNewHome) {
        expect(existsSync(resolve(repositoryRoot, row.newHome!)), `${row.retiredKey} → ${row.newHome}`).toBe(true);
      }
    }
  });

  it('keeps every destructive registry action behind the shared typed-confirmation gate', async () => {
    expect(ISSUE_ACTIONS.filter((action) => action.kind === 'destructive').map((action) => action.key)).toEqual(DESTRUCTIVE_ACTION_KEYS);
    const fetchMock = vi.mocked(fetch);

    renderLiveGroupedMenu();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/orders'));
    const callsBeforeSelection = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole('menuitem', { name: 'Danger' }));
    fireEvent.click(screen.getByTestId('issue-action-resetIssue'));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirmation text')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset to Todo' })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(callsBeforeSelection);
  });
});
