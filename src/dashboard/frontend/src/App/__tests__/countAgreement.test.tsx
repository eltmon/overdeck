/**
 * PAN-5292 WI-E11 (FR-E9) — the top bar and the Home page show the same
 * Needs-you and agents-working counts, because both read the shared selectors.
 *
 * Nothing here mocks a selector. The store, the Flywheel status, the
 * conversations list and the registered projects are seeded once; the expected
 * totals are computed by the pure builders over that same fixture, never typed in.
 */
import { render, screen, waitFor } from '@testing-library/react';
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

vi.mock('../../components/home/HomeComposer', () => ({ HomeComposer: () => null }));

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
