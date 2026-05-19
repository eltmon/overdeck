import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FlywheelConversationPane, findFlywheelConversation, resolveFlywheelConfig } from '../FlywheelConversationPane';
import type { Conversation } from '../../CommandDeck/ConversationList';

vi.mock('../../chat/ConversationPanel', () => ({
  ConversationPanel: ({ conversation }: { conversation: Conversation }) => (
    <div data-testid="conversation-panel">{conversation.name}</div>
  ),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const flywheelStatus = {
  runId: 'RUN-2',
  startedAt: '2026-05-18T12:00:00.000Z',
  elapsedMs: 1000,
  orchestrator: {
    harness: 'claude-code',
    model: 'claude-opus-4-7',
    effort: 'high',
    ctxPercent: 42,
  },
  headline: {
    bugsFixed: 1,
    swarmItemsMerged: 2,
    swarmItemsTotal: 3,
    prsMerged: 4,
    awaitingUat: 5,
  },
  activePipeline: [],
  substrateBugs: [],
  agents: [],
  parked: [],
  system: {
    mainHead: 'abc1234',
    ramUsedMb: 1024,
    ramTotalMb: 4096,
    swapUsedMb: 0,
    swapTotalMb: 1024,
    agentsActive: 1,
    agentsCap: 8,
  },
  openQuestions: [],
  ticks: 1,
  lastTickAt: '2026-05-18T12:00:00.000Z',
};

const flywheelConversation: Conversation = {
  id: 7,
  name: 'flywheel-orchestrator',
  tmuxSession: 'flywheel-orchestrator',
  status: 'active',
  cwd: '/repo',
  issueId: null,
  createdAt: '2026-05-18T12:00:00.000Z',
  endedAt: null,
  lastAttachedAt: null,
  sessionAlive: true,
  title: 'Flywheel',
  model: 'claude-opus-4-7',
  harness: 'claude-code',
  effort: 'high',
};

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function mockFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') {
      return Response.json({ ok: true });
    }
    if (url === '/api/flywheel/runs?limit=10') {
      return Response.json([{ id: 'RUN-2', startedAt: flywheelStatus.startedAt, status: 'running' }]);
    }
    if (url === '/api/flywheel/runs/RUN-2') {
      return Response.json({
        id: 'RUN-2',
        startedAt: flywheelStatus.startedAt,
        status: 'running',
        latest: flywheelStatus,
        paths: { latest: '/tmp/latest.json', report: '/tmp/report.md' },
      });
    }
    if (url === '/api/conversations') {
      return Response.json([flywheelConversation]);
    }
    if (url === '/api/settings') {
      return Response.json({
        roles: {
          flywheel: {
            harness: 'pi',
            model: 'claude-sonnet-4-6',
            effort: 'medium',
            maxAgents: 4,
            scope: 'all-tracked-projects',
          },
        },
      });
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPane(onOpenSettings = vi.fn()) {
  const client = makeClient();
  render(
    <QueryClientProvider client={client}>
      <FlywheelConversationPane onOpenSettings={onOpenSettings} />
    </QueryClientProvider>,
  );
  return client;
}

describe('FlywheelConversationPane helpers', () => {
  it('finds the flywheel orchestrator by conversation name or tmux session', () => {
    expect(findFlywheelConversation([{ ...flywheelConversation, name: 'other' }])).toEqual({
      ...flywheelConversation,
      name: 'other',
    });
    expect(findFlywheelConversation([{ ...flywheelConversation, tmuxSession: 'other' }])).toEqual({
      ...flywheelConversation,
      tmuxSession: 'other',
    });
  });

  it('applies flywheel config defaults', () => {
    expect(resolveFlywheelConfig(undefined)).toMatchObject({
      harness: 'claude-code',
      model: 'opus-4.7',
      effort: 'high',
      maxAgents: 8,
      scope: 'pan-only',
    });
  });
});

describe('FlywheelConversationPane', () => {
  beforeEach(() => {
    mockFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders run metadata and reuses the existing conversation panel', async () => {
    renderPane();

    expect(await screen.findByText('RUN-2')).toBeInTheDocument();
    expect(screen.getByText('Model: claude-opus-4-7')).toBeInTheDocument();
    expect(screen.getByText('Effort: high')).toBeInTheDocument();
    expect(screen.getByText('Context: 42%')).toBeInTheDocument();
    expect(screen.getByTestId('conversation-panel')).toHaveTextContent('flywheel-orchestrator');
  });

  it('shows the current roles.flywheel config and opens settings from the config card', async () => {
    const onOpenSettings = vi.fn();
    renderPane(onOpenSettings);

    expect(await screen.findByText('RUN-2')).toBeInTheDocument();
    expect(screen.getByText('pi')).toBeInTheDocument();
    expect(screen.getByText('claude-sonnet-4-6')).toBeInTheDocument();
    expect(screen.getByText('All tracked projects')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Settings → Roles → Flywheel'));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('calls flywheel action routes from top-bar controls', async () => {
    const fetchMock = mockFetch();
    renderPane();

    await screen.findByText('RUN-2');
    fireEvent.click(screen.getByRole('button', { name: /Start/i }));
    fireEvent.click(screen.getByRole('button', { name: /Pause/i }));
    fireEvent.click(screen.getByRole('button', { name: /New Run/i }));
    fireEvent.click(screen.getByRole('button', { name: /Open Run Report/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/flywheel/start', expect.objectContaining({ method: 'POST' }));
      expect(fetchMock).toHaveBeenCalledWith('/api/flywheel/pause', expect.objectContaining({ method: 'POST' }));
      expect(fetchMock).toHaveBeenCalledWith('/api/flywheel/report/open', expect.objectContaining({ method: 'POST' }));
    });
  });
});
