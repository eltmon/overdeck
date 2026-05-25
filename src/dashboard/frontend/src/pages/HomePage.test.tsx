import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureRegistryEntry, MemoryObservation, MemoryStatus } from '@panctl/contracts';
import { INITIAL_READ_MODEL_STATE } from '@panctl/contracts';

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

function makeObservation(overrides: Partial<MemoryObservation> = {}): MemoryObservation {
  return {
    id: 'obs-1',
    timestamp: '2026-05-25T00:10:00.000Z',
    projectId: 'panopticon-cli',
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

describe('HomePage', () => {
  it('renders workspace status cards from read-model memory state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ entries: [] })));
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
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ entries: [] })));
    useDashboardStore.setState({
      agentsById: { 'agent-stopped': { id: 'agent-stopped', issueId: 'PAN-999', status: 'stopped' } },
    });

    renderHomePage();

    expect(await screen.findByText('No workspace status is available yet.')).toBeInTheDocument();
    expect(screen.getByText(/Workspace cards will appear after memory status/)).toBeInTheDocument();
  });

  it('renders Knowledge Registry rows from the dashboard API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ entries: [makeEntry()] })));

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
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ entries: [] })));

    renderHomePage();

    expect(await screen.findByText('No features are registered yet.')).toBeInTheDocument();
    expect(screen.getByText('pan registry tag <issueId> <feature>')).toBeInTheDocument();
    expect(screen.getByText(/Automatic classification will populate future entries/)).toBeInTheDocument();
  });

  it('localizes registry loading errors to the registry card', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));

    renderHomePage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Knowledge Registry could not be loaded. The rest of Home is still available.');
    expect(screen.getByText('System briefing')).toBeInTheDocument();
  });
});
