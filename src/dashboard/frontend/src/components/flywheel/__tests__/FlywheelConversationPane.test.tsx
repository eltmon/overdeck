import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FlywheelConversationPane, findFlywheelConversation, resolveFlywheelConfig } from '../FlywheelConversationPane';
import { DialogProvider } from '../../DialogProvider';
import type { Conversation } from '../../CommandDeck/ConversationList';

vi.mock('../../chat/ConversationPanel', () => ({
  ConversationPanel: ({ conversation }: { conversation: Conversation }) => (
    <div data-testid="conversation-panel">{conversation.name}</div>
  ),
}));

vi.mock('../../XTerminal', () => ({
  XTerminal: ({ sessionName }: { sessionName: string }) => (
    <div data-testid="xterminal">{sessionName}</div>
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
    if (url === '/api/flywheel/conversation') {
      return Response.json(flywheelConversation);
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
    if (url === '/api/flywheel/merge-queue') {
      return Response.json([]);
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
      <DialogProvider>
        <FlywheelConversationPane onOpenSettings={onOpenSettings} />
      </DialogProvider>
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
      model: 'claude-opus-4-7',
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
    expect(fetch).toHaveBeenCalledWith('/api/flywheel/conversation');
    expect(fetch).not.toHaveBeenCalledWith('/api/conversations');
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

  it('toggles between Conversation and Terminal views once the orchestrator session exists', async () => {
    renderPane();

    expect(await screen.findByTestId('conversation-panel')).toHaveTextContent('flywheel-orchestrator');
    expect(screen.queryByTestId('xterminal')).not.toBeInTheDocument();

    const conversationTab = screen.getByRole('tab', { name: 'Conversation' });
    const terminalTab = screen.getByRole('tab', { name: 'Terminal' });
    expect(conversationTab).toHaveAttribute('aria-selected', 'true');
    expect(terminalTab).toHaveAttribute('aria-selected', 'false');
    expect(terminalTab).not.toBeDisabled();

    fireEvent.click(terminalTab);

    expect(terminalTab).toHaveAttribute('aria-selected', 'true');
    expect(conversationTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByTestId('xterminal')).toHaveTextContent('flywheel-orchestrator');
    expect(screen.queryByTestId('conversation-panel')).not.toBeInTheDocument();

    fireEvent.click(conversationTab);

    expect(conversationTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('xterminal')).not.toBeInTheDocument();
  });

  it('disables the Terminal toggle when no flywheel-orchestrator session exists yet', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/flywheel/runs?limit=10') return Response.json([]);
      if (url === '/api/flywheel/conversation') return Response.json(null);
      if (url === '/api/settings') return Response.json({ roles: {} });
      if (url === '/api/flywheel/merge-queue') return Response.json([]);
      return Response.json({ error: 'not found' }, { status: 404 });
    }));

    renderPane();

    await waitFor(() => {
      expect(screen.getByText(/No flywheel-orchestrator session yet/)).toBeInTheDocument();
    });
    expect(screen.getByRole('tab', { name: 'Terminal' })).toBeDisabled();
    expect(screen.queryByTestId('xterminal')).not.toBeInTheDocument();
  });

  it('calls flywheel action routes from top-bar controls', async () => {
    const fetchMock = mockFetch();
    renderPane();

    await screen.findByText('RUN-2');
    // In 'running' state only Pause and Open Run Report are visible
    expect(screen.queryByRole('button', { name: /^New Run$/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Pause/i }));
    fireEvent.click(screen.getByRole('button', { name: /Open Run Report/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/flywheel/pause', expect.objectContaining({ method: 'POST' }));
      expect(fetchMock).toHaveBeenCalledWith('/api/flywheel/report/open', expect.objectContaining({ method: 'POST' }));
    });
  });

  it('does not expose active controls or live metadata for completed runs', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/flywheel/runs?limit=10') {
        return Response.json([{ id: 'RUN-2', startedAt: flywheelStatus.startedAt, status: 'complete' }]);
      }
      if (url === '/api/flywheel/runs/RUN-2') {
        return Response.json({
          id: 'RUN-2',
          startedAt: flywheelStatus.startedAt,
          status: 'complete',
          latest: flywheelStatus,
          paths: { latest: '/tmp/latest.json', report: '/tmp/report.md' },
        });
      }
      if (url === '/api/flywheel/conversation') return Response.json(flywheelConversation);
      if (url === '/api/settings') return Response.json({ roles: {} });
      if (url === '/api/flywheel/merge-queue') return Response.json([]);
      return Response.json({ error: 'not found' }, { status: 404 });
    }));

    renderPane();

    expect(await screen.findByText('RUN-2 (complete)')).toBeInTheDocument();
    expect(screen.getByText('Model: claude-opus-4-7')).toBeInTheDocument();
    expect(screen.getByText('Effort: high')).toBeInTheDocument();
    // Completed runs show no active controls — Pause/Resume are not rendered
    expect(screen.queryByRole('button', { name: /Pause/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Resume/i })).not.toBeInTheDocument();
  });
});
