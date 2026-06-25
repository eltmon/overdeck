import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSnapshot, FeatureRegistryEntry, MemoryObservation, MemoryStatus } from '@overdeck/contracts';
import { INITIAL_READ_MODEL_STATE } from '@overdeck/contracts';

import { HomePage } from './HomePage';
import { useDashboardStore } from '../lib/store';

function makeEntry(overrides: Partial<FeatureRegistryEntry> = {}): FeatureRegistryEntry {
  return {
    featureId: 'feature-1',
    featureName: 'context-distribution',
    description: null,
    owningWorkspaceId: 'feature-pan-1204',
    owningIssueId: 'PAN-1204',
    owningAgentId: 'agent-pan-1204',
    status: 'active',
    createdAt: '2026-05-25T00:00:00.000Z',
    updatedAt: '2026-05-25T00:00:00.000Z',
    tags: ['briefing', 'memory'],
    ...overrides,
  };
}

const memoryStatus: MemoryStatus = {
  name: 'PAN-1204 status',
  headline: 'Home workspace cards are in progress',
  summary: 'The Home page is rendering workspace status rollups from memory.',
  goal: null,
  phase: 'building',
  accomplished: [],
  decided: [],
  open: [],
  nextSteps: ['Verify Home'],
  confidence: 0.75,
  workingSet: [],
  tags: [],
};

function makeAgent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: 'agent-1',
    issueId: 'PAN-1204',
    status: 'running',
    ...overrides,
  };
}

function makeObservation(overrides: Partial<MemoryObservation> = {}): MemoryObservation {
  return {
    id: 'obs-1',
    timestamp: '2026-05-25T00:10:00.000Z',
    projectId: 'overdeck',
    workspaceId: 'feature-pan-1204',
    issueId: 'PAN-1204',
    runId: 'run-1',
    sessionId: 'session-1',
    agentRole: 'work',
    agentHarness: 'claude-code',
    gitBranch: 'feature/pan-1204',
    sourceTranscriptOffset: 1,
    actionStatus: 'Rendering workspace card',
    narrative: 'Narrative',
    summary: 'Summary',
    files: [],
    tags: [],
    tokens: { prompt: 1, completion: 1, total: 2 },
    model: 'stub-model',
    ...overrides,
  };
}

function resetDashboardStore() {
  useDashboardStore.setState({
    ...INITIAL_READ_MODEL_STATE,
    drawer: { issueId: null, tab: 'overview' },
    bootstrapComplete: false,
    snapshotTimestamp: null,
  });
}

/** URL-routed fetch stub for Home. Every Home query gets a valid response by
 *  default (empty project list, empty registry, zero cost); per-test overrides
 *  swap in specific bodies or error Responses. PAN-1969 added the
 *  `command-deck-projects` query, so a catch-all stub no longer suffices. */
function homeFetchStub(overrides: Record<string, unknown> = {}): typeof fetch {
  const routes: Record<string, unknown> = {
    '/api/registry/features': { entries: [] },
    '/api/metrics/summary': { today: { totalCost: 0 } },
    '/api/issues/resource-allocated': [],
    '/api/registered-projects': [],
    ...overrides,
  };
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const match = routes[url];
    if (match instanceof Response) return match;
    if (match !== undefined) return Response.json(match);
    return Response.json({ entries: [] });
  }) as unknown as typeof fetch;
}

function renderHomePage(props: Parameters<typeof HomePage>[0] = {}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={client}>
      <HomePage {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetDashboardStore();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function summaryCard(label: string): HTMLElement {
  const card = screen.getByText(label).closest('div');
  if (!card) throw new Error(`Missing summary card: ${label}`);
  return card;
}

describe('HomePage', () => {
  it('renders header summary cards from live read-model and metrics state', async () => {
    vi.stubGlobal('fetch', homeFetchStub({ '/api/metrics/summary': { today: { totalCost: 12.345 } } }));
    useDashboardStore.setState({
      agentsById: {
        running: makeAgent({ id: 'running', status: 'running' }),
        liveStopped: makeAgent({ id: 'liveStopped', status: 'stopped', hasLiveTmuxSession: true }),
        paused: makeAgent({ id: 'paused', status: 'stopped', paused: true }),
        troubled: makeAgent({ id: 'troubled', status: 'stopped', troubled: true, consecutiveFailures: 2 }),
        failedAgent: makeAgent({ id: 'failedAgent', status: 'failed', consecutiveFailures: 1 }),
        staleStoppedFailure: makeAgent({ id: 'staleStoppedFailure', status: 'stopped', consecutiveFailures: 1 }),
      },
      reviewStatusByIssueId: {
        recentMerge: { issueId: 'PAN-1', mergeStatus: 'merged', updatedAt: '2026-05-25T00:00:00.000Z' },
        oldMerge: { issueId: 'PAN-2', mergeStatus: 'merged', updatedAt: '2026-05-23T00:00:00.000Z' },
        failedVerification: { issueId: 'PAN-3', verificationStatus: 'failed' },
        blocked: {
          issueId: 'PAN-4',
          blockerReasons: [{ type: 'merge_conflict', summary: 'Conflicts', detectedAt: '2026-05-25T00:00:00.000Z' }],
        },
      },
    });

    renderHomePage({ now: new Date('2026-05-25T12:00:00.000Z') });

    expect(summaryCard('Running agents')).toHaveTextContent('2');
    expect(summaryCard('Paused / troubled')).toHaveTextContent('3');
    expect(summaryCard('Merged today')).toHaveTextContent('1');
    expect(summaryCard('Needs verification')).toHaveTextContent('2');
    expect(await screen.findByText('$12.35')).toBeInTheDocument();
  });

  it('renders cost as unavailable when metrics summary is absent', async () => {
    vi.stubGlobal('fetch', homeFetchStub({ '/api/metrics/summary': new Response(null, { status: 500 }) }));

    renderHomePage();

    expect(await screen.findByText('Unavailable')).toBeInTheDocument();
    expect(summaryCard('Cost today')).toHaveTextContent('UTC daily cost summary');
  });

  it('renders workspace status cards from read-model memory state', async () => {
    vi.stubGlobal('fetch', homeFetchStub());
    const onOpenWorkspaceHome = vi.fn();
    useDashboardStore.setState({
      issuesRaw: [{ identifier: 'PAN-1204', title: 'Build Home', description: 'Render Home workspace list' }],
      statusByIssueId: { 'PAN-1204': memoryStatus },
      observationsByIssueId: { 'PAN-1204': [makeObservation({ tags: ['commit'] })] },
      reviewStatusByIssueId: { 'PAN-1204': { issueId: 'PAN-1204', prUrl: 'https://example.com/pr/1' } },
    });

    renderHomePage({ onOpenWorkspaceHome, now: new Date('2026-05-25T00:20:00.000Z') });

    const card = await screen.findByRole('button', { name: /open pan-1204 workspace overview/i });
    expect(within(card).getByText('Home workspace cards are in progress')).toBeInTheDocument();
    expect(within(card).getByText('Building')).toBeInTheDocument();
    expect(within(card).getByText('Rendering workspace card')).toBeInTheDocument();
    expect(within(card).getByText('+0')).toBeInTheDocument();
    expect(within(card).getByText('-0')).toBeInTheDocument();
    expect(within(card).getAllByText('1')).toHaveLength(2);

    fireEvent.click(card);
    expect(onOpenWorkspaceHome).toHaveBeenCalledWith('PAN-1204');
  });

  it('shows a workspace empty state when memory state is absent', async () => {
    vi.stubGlobal('fetch', homeFetchStub());
    useDashboardStore.setState({
      agentsById: { 'agent-stopped': { id: 'agent-stopped', issueId: 'PAN-999', status: 'stopped' } },
    });

    renderHomePage();

    expect(await screen.findByText('No workspace status is available yet.')).toBeInTheDocument();
    expect(screen.getByText(/Workspace cards will appear after memory status/)).toBeInTheDocument();
  });

  it('renders actionable observations in PRD time buckets newest-first', async () => {
    vi.stubGlobal('fetch', homeFetchStub());
    useDashboardStore.setState({
      observationsByIssueId: {
        'PAN-1204': [
          makeObservation({ id: 'ignored', timestamp: '2026-05-25T11:59:00.000Z', actionStatus: null }),
          makeObservation({ id: 'just-now-old', timestamp: '2026-05-25T11:10:00.000Z', actionStatus: 'Older just now', summary: 'Old summary' }),
          makeObservation({ id: 'just-now-new', timestamp: '2026-05-25T11:55:00.000Z', actionStatus: 'Newer just now', summary: 'New summary' }),
          makeObservation({ id: 'today', timestamp: '2026-05-25T09:00:00.000Z', actionStatus: 'Earlier today' }),
          makeObservation({ id: 'yesterday', timestamp: '2026-05-24T09:00:00.000Z', actionStatus: 'Yesterday work' }),
          makeObservation({ id: 'week', timestamp: '2026-05-21T09:00:00.000Z', actionStatus: 'This week work' }),
          makeObservation({ id: 'month', timestamp: '2026-05-10T09:00:00.000Z', actionStatus: 'This month work' }),
          makeObservation({ id: 'older', timestamp: '2026-04-10T09:00:00.000Z', actionStatus: 'Older work' }),
        ],
      },
    });

    renderHomePage({ now: new Date('2026-05-25T12:00:00.000Z') });

    expect(await screen.findByTestId('home-activity-bucket-justNow')).toHaveTextContent('Just Now');
    expect(screen.getByTestId('home-activity-bucket-earlierToday')).toHaveTextContent('Earlier Today');
    expect(screen.getByTestId('home-activity-bucket-yesterday')).toHaveTextContent('Yesterday');
    expect(screen.getByTestId('home-activity-bucket-thisWeek')).toHaveTextContent('This Week');
    expect(screen.getByTestId('home-activity-bucket-thisMonth')).toHaveTextContent('This Month');
    expect(screen.getByTestId('home-activity-bucket-older')).toHaveTextContent('Older');
    expect(screen.queryByText('ignored')).not.toBeInTheDocument();

    const entries = within(screen.getByTestId('home-activity-bucket-justNow')).getAllByRole('listitem');
    expect(entries[0]).toHaveTextContent('Newer just now');
    expect(entries[1]).toHaveTextContent('Older just now');
  });

  it('renders activity observation identity, summary, narrative, files, and tags', async () => {
    vi.stubGlobal('fetch', homeFetchStub());
    useDashboardStore.setState({
      observationsByIssueId: {
        'PAN-1204': [makeObservation({
          id: 'rich-activity',
          issueId: 'PAN-1204',
          workspaceId: 'workspace-3k8n',
          actionStatus: 'Verified Home route',
          summary: 'Rendered Home verification coverage',
          narrative: 'Read observationsByIssueId without parsing JSONL transcripts.',
          files: ['src/dashboard/frontend/src/pages/HomePage.tsx'],
          tags: ['home', 'memory'],
        })],
      },
    });

    renderHomePage({ now: new Date('2026-05-25T00:20:00.000Z') });

    const feed = await screen.findByTestId('home-activity-feed');
    expect(feed).toHaveTextContent('workspace-3k8n · PAN-1204');
    expect(feed).toHaveTextContent('Verified Home route');
    expect(feed).toHaveTextContent('Rendered Home verification coverage');
    expect(feed).toHaveTextContent('Read observationsByIssueId without parsing JSONL transcripts.');
    expect(feed).toHaveTextContent('src/dashboard/frontend/src/pages/HomePage.tsx');
    expect(feed).toHaveTextContent('home');
    expect(feed).toHaveTextContent('memory');
  });

  it('shows an activity empty state when no actionable observations exist', async () => {
    vi.stubGlobal('fetch', homeFetchStub());

    renderHomePage();

    expect(await screen.findByText('No actionable observations yet.')).toBeInTheDocument();
    expect(screen.getByText('Observations are extracted from running work agents — they appear here once an agent makes a change worth recording.')).toBeInTheDocument();
  });

  it('renders Knowledge Registry rows from the dashboard API', async () => {
    vi.stubGlobal('fetch', homeFetchStub({ '/api/registry/features': { entries: [makeEntry()] } }));

    renderHomePage();

    expect(await screen.findByText('context-distribution')).toBeInTheDocument();
    expect(screen.getByText('PAN-1204')).toBeInTheDocument();
    expect(screen.getByText('feature-pan-1204')).toBeInTheDocument();
    expect(screen.getByText('agent-pan-1204')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('briefing, memory')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/registry/features');
  });

  it('points users to registry tagging when no features are registered', async () => {
    vi.stubGlobal('fetch', homeFetchStub());

    renderHomePage();

    expect(await screen.findByText('No features are registered yet.')).toBeInTheDocument();
    expect(screen.getByText('pan registry tag <issueId> <feature>')).toBeInTheDocument();
    expect(screen.getByText(/Automatic classification will populate future entries/)).toBeInTheDocument();
  });

  it('localizes registry loading errors to the registry card', async () => {
    vi.stubGlobal('fetch', homeFetchStub({ '/api/registry/features': new Response(null, { status: 500 }) }));

    renderHomePage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Knowledge Registry could not be loaded. The rest of Home is still available.');
    expect(screen.getByText('System briefing')).toBeInTheDocument();
  });

  it('lists registered projects and opens the project deck on click (PAN-1969)', async () => {
    vi.stubGlobal('fetch', homeFetchStub({
      '/api/registered-projects': [{ key: 'overdeck', name: 'overdeck', path: '/home/eltmon/Projects/overdeck' }],
    }));
    const onSelectProject = vi.fn();

    renderHomePage({ onSelectProject });

    const projectButton = await screen.findByTestId('home-project-overdeck');
    expect(projectButton).toHaveTextContent('overdeck');

    fireEvent.click(projectButton);
    expect(onSelectProject).toHaveBeenCalledWith('overdeck');
  });

  it('shows a no-projects empty state with a new-project CTA (PAN-1969)', async () => {
    vi.stubGlobal('fetch', homeFetchStub());
    const onNewProject = vi.fn();

    renderHomePage({ onNewProject });

    const empty = await screen.findByTestId('home-projects-empty');
    expect(empty).toHaveTextContent('No projects yet.');
    expect(empty).toHaveTextContent('Create your first project to get started.');

    fireEvent.click(screen.getByTestId('home-new-project-empty'));
    expect(onNewProject).toHaveBeenCalled();
  });

  it('localizes project loading errors to the projects section (PAN-1969)', async () => {
    vi.stubGlobal('fetch', homeFetchStub({
      '/api/issues/resource-allocated': new Response(null, { status: 500 }),
    }));

    renderHomePage();

    const section = await screen.findByTestId('home-projects');
    const alert = await within(section).findByRole('alert');
    expect(alert).toHaveTextContent('Projects could not be loaded. The rest of Home is still available.');
  });
});
