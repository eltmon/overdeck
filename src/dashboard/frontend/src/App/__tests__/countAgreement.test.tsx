/**
 * PAN-5292 WI-E11 (FR-E9) — the top bar and the Home page show the same
 * Needs-you and agents-working counts, because both read the shared selectors.
 *
 * Nothing here mocks a selector. The store, the Flywheel status, the
 * conversations list and the registered projects are seeded once; the expected
 * totals are computed by the pure builders over that same fixture, never typed in.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSnapshot, FlywheelLastTick } from '@overdeck/contracts';
import { INITIAL_READ_MODEL_STATE } from '@overdeck/contracts';

import { selectPendingInputSubjects, useDashboardStore } from '../../lib/store';
import { seedDashboardStore } from '../../test-utils/renderCounter';
import { buildNeedsYouItems } from '../../lib/selectors/needsYou';
import { buildAgentsWorking } from '../../lib/selectors/agentsWorking';
import { buildProjectResolver } from '../../lib/selectors/projectOf';
import type { Decision } from '../../lib/useDecisions';
import { needsYouRows } from '../../components/flywheel/needsYouRows';
import { flywheelStatus } from '../../components/flywheel/__tests__/fixtures';
import { NeedsYouIndicator } from '../../components/flywheel/NeedsYouIndicator';
import { HomePage } from '../../pages/HomePage';
import { AgentsMenu } from '../topbar/AgentsMenu';
import { SimpleHomePage } from '../../components/simple/SimpleHomePage';
import { DialogProvider } from '../../components/DialogProvider';
import { useUiMode } from '../../lib/simple/uiMode';
import type { Issue } from '../../types';

vi.mock('../../components/home/HomeComposer', () => ({ HomeComposer: () => null }));
vi.mock('../../components/home/GetSetUpCard', () => ({ GetSetUpCard: () => null }));

const NOW = '2026-11-14T12:00:00.000Z';

function agent(overrides: Partial<AgentSnapshot> & Pick<AgentSnapshot, 'id'>): AgentSnapshot {
  return {
    runtime: 'claude-code',
    model: 'claude-opus-5-5',
    status: 'running',
    startedAt: '2026-11-14T11:00:00.000Z',
    lastActivity: '2026-11-14T11:50:00.000Z',
    consecutiveFailures: 0,
    killCount: 0,
    ...overrides,
  } as AgentSnapshot;
}

const AGENTS: Record<string, AgentSnapshot> = {
  // Running, with a pending AskUserQuestion: a pending-input item on PAN-1.
  'agent-pan-1': agent({
    id: 'agent-pan-1',
    issueId: 'PAN-1',
    role: 'work',
    pendingInputKinds: ['askUserQuestion'],
    pendingAskUserQuestion: {
      toolUseId: 'toolu_pan_1',
      askedAt: '2026-11-14T11:55:00.000Z',
      questions: [{ question: 'Which schema should the export use?', options: [{ label: 'v1' }, { label: 'v2' }] }],
    },
  }),
  'planning-pan-3': agent({ id: 'planning-pan-3', issueId: 'PAN-3', role: 'plan' }),
  // The same tmux session as the working conversation "fixture": counted once.
  'conv-fixture': agent({ id: 'conv-fixture' }),
  'agent-pan-4': agent({ id: 'agent-pan-4', issueId: 'PAN-4', role: 'work', status: 'stopped' }),
};

const DERIVED = {
  // Folds into PAN-1's pending-input item.
  'PAN-1': { issueId: 'PAN-1', state: 'working' as const, attention: 'needs-you' as const },
  'PAN-2': { issueId: 'PAN-2', state: 'working' as const, attention: 'needs-you' as const },
};

const CONVERSATIONS = [
  {
    id: 1,
    name: 'fixture',
    tmuxSession: 'conv-fixture',
    status: 'active',
    cwd: '/repos/overdeck',
    issueId: null,
    title: 'Fixture conversation',
    createdAt: '2026-11-14T11:30:00.000Z',
    endedAt: null,
    lastAttachedAt: null,
    sessionAlive: true,
    isWorking: true,
  },
];

const PROJECTS = [{ key: 'overdeck', name: 'Overdeck', path: '/repos/overdeck', linearTeam: 'PAN' }];

const base = flywheelStatus();
const LAST_TICK: FlywheelLastTick = {
  ...base.lastTick!,
  needsYou: 'PAN-2 needs a scope decision; decide the release window',
  // One row naming PAN-2 (folds into its issue item) and one with no issue id.
  needsYouItems: [{ text: 'PAN-2 needs a scope decision' }, { text: 'decide the release window' }],
} as FlywheelLastTick;

const ROUTES: Record<string, unknown> = {
  '/api/flywheel/status': { ...base, lastTick: LAST_TICK },
  '/api/conversations': CONVERSATIONS,
  '/api/registered-projects': PROJECTS,
  '/api/conversations/pending-input': [],
  '/api/agent-requests': { requests: [] },
  '/api/fleet/needs-you': { machines: [], unreachable: [] },
  '/api/registry/features': { entries: [] },
  '/api/metrics/summary': { today: { totalCost: 0 } },
  '/api/issues/resource-allocated': [],
};

function summaryCardValue(label: string): string {
  const card = screen.getByText(label).closest('div');
  if (!card) throw new Error(`Missing summary card: ${label}`);
  return card.textContent ?? '';
}

describe('top bar and Home counts agree (PAN-5292 FR-E9)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return url in ROUTES ? Response.json(ROUTES[url]) : new Response('not found', { status: 404 });
    }));
    seedDashboardStore({
      ...INITIAL_READ_MODEL_STATE,
      agentsById: AGENTS,
      derivedIssueStateByIssueId: DERIVED,
    } as Parameters<typeof seedDashboardStore>[0]);
  });

  afterEach(() => {
    useDashboardStore.setState({ ...INITIAL_READ_MODEL_STATE });
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shows the same Needs-you and agents-working numbers in the top bar and on Home', async () => {
    const state = useDashboardStore.getState();
    const subjects = selectPendingInputSubjects(state);
    const projectOf = buildProjectResolver(PROJECTS, CONVERSATIONS);
    // The decision rows useDecisions builds from the same agent subjects; buildNeedsYouItems folds them into (a).
    const decisions = subjects.map((s) => ({ id: s.agentId, source: s.source, label: s.agentId, kinds: s.kinds })) as unknown as Decision[];
    const expectedNeedsYou = buildNeedsYouItems({
      subjects,
      resolution: {
        answeredToolUseIds: new Set(),
        dismissedSubjectIds: new Set(),
        resolvedPlanToolUseIds: new Set(),
        dismissedPlanSubjectIds: new Set(),
      },
      derived: state.derivedIssueStateByIssueId,
      flywheelRows: needsYouRows(LAST_TICK),
      decisions,
      issueTitles: new Map(),
      projectOf,
    });
    const expectedWorking = buildAgentsWorking(Object.values(AGENTS), CONVERSATIONS, projectOf);

    // The fixture covers every source: a pending-input item, an issue-attention item and a Flywheel item.
    expect(new Set(expectedNeedsYou.map((item) => item.kind))).toEqual(new Set(['pending-input', 'issue', 'flywheel']));
    expect(expectedNeedsYou.length).toBeGreaterThanOrEqual(3);
    // Two running agents plus the conv-fixture session, counted once as the conversation.
    expect(expectedWorking.count).toBeGreaterThanOrEqual(2);
    expect(expectedWorking.rows.filter((row) => row.id === 'fixture' || row.id === 'conv-fixture')).toHaveLength(1);

    const N = expectedNeedsYou.length;
    const M = expectedWorking.count;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <NeedsYouIndicator />
        <AgentsMenu />
        <HomePage />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('flywheel-needs-you-indicator')).toHaveTextContent(`Needs you · ${N}`));
    await waitFor(() => expect(screen.getByTestId('agents-menu-trigger')).toHaveTextContent(`${M} agents working`));
    expect(summaryCardValue('Needs you')).toContain(String(N));
    expect(summaryCardValue('Needs you')).toMatch(new RegExp(`^Needs you${N}`));
    expect(summaryCardValue('Agents working')).toMatch(new RegExp(`^Agents working${M}`));
  });
});

// PAN-5371 — Simple Home's headline and Needs-you cards must agree with the
// top bar, using the SAME shared selector, and the displaced Simple reasons
// (start-work, stuck, problems) must render outside the count.
function issueRow(identifier: string, title: string): Issue {
  return {
    id: identifier,
    identifier,
    title,
    status: 'In Progress',
    state: 'in_progress',
    labels: [],
    priority: 2,
    url: `https://github.com/eltmon/overdeck/issues/${identifier.split('-')[1]}`,
  } as Issue;
}

const ISSUES_5371: Issue[] = [
  issueRow('PAN-11', 'Export pipeline needs a schema'),
  issueRow('PAN-12', 'Dashboard flakiness investigation'),
  issueRow('PAN-13', 'Write onboarding docs'),
  issueRow('PAN-14', 'Flaky E2E test investigation'),
  issueRow('PAN-15', 'Review findings on the ingest job'),
];

const AGENTS_5371: Record<string, AgentSnapshot> = {
  'agent-pan-11': agent({
    id: 'agent-pan-11',
    issueId: 'PAN-11',
    role: 'work',
    pendingInputKinds: ['askUserQuestion'],
    pendingAskUserQuestion: {
      toolUseId: 'toolu_pan_11',
      askedAt: '2026-11-14T11:55:00.000Z',
      questions: [{ question: 'Which export format should PAN-11 use?', options: [] }],
    },
  }),
  'agent-pan-14': agent({ id: 'agent-pan-14', issueId: 'PAN-14', role: 'work', status: 'stuck', pendingInputKinds: [] }),
};

const DERIVED_5371 = {
  'PAN-12': { issueId: 'PAN-12', state: 'working' as const, attention: 'needs-you' as const },
  'PAN-13': { issueId: 'PAN-13', state: 'planned' as const },
  'PAN-15': { issueId: 'PAN-15', state: 'changes-requested' as const },
};

const HELPER_CONVERSATION_PENDING_INPUT = {
  name: 'helper',
  title: 'Helper conversation',
  issueId: null,
  pendingAskUserQuestion: {
    toolUseId: 'toolu_helper',
    askedAt: '2026-11-14T11:56:00.000Z',
    questions: [{ question: 'Pick a port?', options: [] }],
  },
};

const base5371 = flywheelStatus();
const LAST_TICK_5371: FlywheelLastTick = {
  ...base5371.lastTick!,
  needsYou: 'decide the release window',
  needsYouItems: [{ text: 'decide the release window' }],
} as FlywheelLastTick;

const ROUTES_5371: Record<string, unknown> = {
  '/api/flywheel/status': { ...base5371, lastTick: LAST_TICK_5371 },
  '/api/conversations': [],
  '/api/registered-projects': [],
  '/api/conversations/pending-input': [HELPER_CONVERSATION_PENDING_INPUT],
  '/api/agent-requests': { requests: [] },
  '/api/fleet/needs-you': { machines: [], unreachable: [] },
  '/api/registry/features': { entries: [] },
  '/api/metrics/summary': { today: { totalCost: 0 } },
  '/api/issues/resource-allocated': [],
};

describe('top bar and Simple Home counts agree (PAN-5371)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    useUiMode.setState({ mode: 'simple', simpleIssueId: null });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return url in ROUTES_5371 ? Response.json(ROUTES_5371[url]) : new Response('not found', { status: 404 });
    }));
    seedDashboardStore({
      ...INITIAL_READ_MODEL_STATE,
      issuesRaw: ISSUES_5371,
      agentsById: AGENTS_5371,
      derivedIssueStateByIssueId: DERIVED_5371,
    } as Parameters<typeof seedDashboardStore>[0]);
  });

  afterEach(() => {
    useDashboardStore.setState({ ...INITIAL_READ_MODEL_STATE });
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shows the same Needs-you count and cards on Simple Home as the top bar', async () => {
    const state = useDashboardStore.getState();
    const subjects = [
      ...selectPendingInputSubjects(state),
      {
        agentId: 'helper',
        source: 'conversation' as const,
        issueId: undefined,
        kinds: ['askUserQuestion'],
        pendingAskUserQuestion: HELPER_CONVERSATION_PENDING_INPUT.pendingAskUserQuestion,
        permissionRequestIds: [],
        conversationTitle: HELPER_CONVERSATION_PENDING_INPUT.title,
        since: HELPER_CONVERSATION_PENDING_INPUT.pendingAskUserQuestion.askedAt,
      },
    ];
    const decisions = subjects.map((s) => ({ id: s.agentId, source: s.source, label: s.agentId, kinds: s.kinds })) as unknown as Decision[];
    const expectedNeedsYou = buildNeedsYouItems({
      subjects,
      resolution: {
        answeredToolUseIds: new Set(),
        dismissedSubjectIds: new Set(),
        resolvedPlanToolUseIds: new Set(),
        dismissedPlanSubjectIds: new Set(),
      },
      derived: state.derivedIssueStateByIssueId,
      flywheelRows: needsYouRows(LAST_TICK_5371),
      decisions,
      issueTitles: new Map(),
      projectOf: buildProjectResolver([], []),
    });

    const expectedKeys = new Set(expectedNeedsYou.map((item) => item.key));
    expect(expectedKeys).toContain('issue:PAN-11');
    expect(expectedKeys).toContain('issue:PAN-12');
    expect(expectedKeys).toContain('conversation:helper');
    expect([...expectedKeys].some((k) => k.startsWith('flywheel:'))).toBe(true);
    expect(expectedKeys.has('issue:PAN-13')).toBe(false);
    expect(expectedKeys.has('issue:PAN-14')).toBe(false);
    expect(expectedKeys.has('issue:PAN-15')).toBe(false);

    const N = expectedNeedsYou.length;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <DialogProvider>
          <NeedsYouIndicator />
          <SimpleHomePage />
        </DialogProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('flywheel-needs-you-indicator')).toHaveTextContent(`Needs you · ${N}`));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(`${N} things need you.`));

    const cards = screen.getAllByTestId('simple-needs-you-card');
    expect(cards).toHaveLength(N);
    expect(new Set(cards.map((c) => c.getAttribute('data-needs-you-key')))).toEqual(expectedKeys);

    const readyToStart = screen.getByTestId('simple-ready-to-start');
    expect(within(readyToStart).getByText(/Write onboarding docs/)).toBeInTheDocument();

    // PAN-12 is a Needs-you card — it must not also appear under Working now.
    expect(screen.getAllByText(/Dashboard flakiness investigation/)).toHaveLength(1);

    const havingTrouble = screen.getByTestId('simple-having-trouble');
    expect(within(havingTrouble).getByText(/Flaky E2E test investigation/)).toBeInTheDocument();
    expect(within(havingTrouble).getByText(/Review findings on the ingest job/)).toBeInTheDocument();

    const flywheelKey = [...expectedKeys].find((k) => k.startsWith('flywheel:'))!;
    const flywheelCard = cards.find((c) => c.getAttribute('data-needs-you-key') === flywheelKey)!;
    expect(within(flywheelCard).getByText('A decision is waiting')).toBeInTheDocument();

    const simpleHomeRoot = container.querySelector('[data-component="simple-home-page"]') as HTMLElement;
    expect(within(simpleHomeRoot).queryByText(/flywheel/i)).toBeNull();
  });
});
