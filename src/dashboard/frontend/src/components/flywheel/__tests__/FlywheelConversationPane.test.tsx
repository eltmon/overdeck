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
            harness: 'ohmypi',
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
      model: 'claude-opus-4-8',
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
    // Harness field renders the live orchestrator harness (status?.orchestrator.harness)
    // when a run is active, falling back to config.harness — see FlywheelConversationPane:460.
    expect(screen.getByText('claude-code')).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: /^Pause$/i }));
    // Open Run Report lives in the ⋯ More menu (PAN-1694 v3).
    fireEvent.click(screen.getByRole('button', { name: /^More$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Open Run Report/i }));

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
    expect(screen.getByText('Model: claude-opus-4-8')).toBeInTheDocument();
    expect(screen.getByText('Effort: high')).toBeInTheDocument();
    // Completed runs still show every action button — they are present-but-disabled
    // so operators always see the same affordances regardless of run state.
    // See "Flywheel toolbar regression guard" tests below for the contract this
    // upholds. Pause/Resume are present but disabled here because the run is complete.
    expect(screen.getByRole('button', { name: /Pause/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Resume/i })).toBeDisabled();
  });

  /**
   * REGRESSION GUARD — Flywheel toolbar action buttons.
   *
   * Background: commit a67ee20a9 (2026-05-20, "feat(flywheel): session
   * continuity via claude --resume on flywheel resume") gated nearly every
   * toolbar button behind `runState === <X>` checks. The visible button set
   * collapsed depending on state — operators correctly reported "where are
   * my actions?" because Pause, Resume, Abort, and Write Report disappeared
   * entirely depending on the active run's state. The original test suite
   * silently encoded this regression with `expect(...).not.toBeInTheDocument()`,
   * making it self-reinforcing.
   *
   * Contract going forward (PAN RUN-11 restoration, PAN-1694 v3 layout): the
   * seven actions — Pause, Resume, New Run, Pop out, Write Report, Abort, and
   * Open Run Report — are ALWAYS reachable, never state-gated-away. Pause,
   * Resume, and Abort sit directly in the control bar; New Run, Write Report,
   * Open Run Report, and Pop out live one click into the ⋯ More menu (the v3
   * declutter). Each action's `disabled` prop still reflects whether it is
   * legal in the current run state. The original regression was actions
   * VANISHING based on run state with no way to reach them — a stable,
   * always-present More menu does not reintroduce that.
   *
   * DO NOT re-gate these actions behind run state, and DO NOT assert
   * not-in-document. If an action's home changes, update this guard and
   * docs/flywheel-brief.md in the same PR.
   */
  describe('toolbar action-button regression guard', () => {
    const ALWAYS_VISIBLE_BUTTONS = [
      /^Pause$/i,
      /^Resume$/i,
      /^New Run$/i,
      /^Pop out$/i,
      /^Write Report$/i,
      /^Abort$/i,
      /^Open Run Report$/i,
    ] as const;

    // PAN-1694: New Run / Write Report / Open Run Report / Pop out are reachable
    // via the ⋯ More menu. Opening it makes all seven actions present at once.
    async function openMoreMenu() {
      fireEvent.click(screen.getByRole('button', { name: /^More$/i }));
      await screen.findByRole('menu', { name: /More flywheel actions/i });
    }

    async function expectAllButtonsRendered() {
      await openMoreMenu();
      for (const name of ALWAYS_VISIBLE_BUTTONS) {
        await waitFor(() => {
          expect(screen.getByRole('button', { name })).toBeInTheDocument();
        });
      }
    }

    function stubRunStatus(status: 'running' | 'paused' | 'complete' | 'aborted' | 'none') {
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST') return Response.json({ ok: true });
        if (url === '/api/flywheel/runs?limit=10') {
          return Response.json(status === 'none' ? [] : [{ id: 'RUN-2', startedAt: flywheelStatus.startedAt, status }]);
        }
        if (url === '/api/flywheel/runs/RUN-2') {
          return Response.json({
            id: 'RUN-2',
            startedAt: flywheelStatus.startedAt,
            status,
            latest: flywheelStatus,
            paths: { latest: '/tmp/latest.json', report: '/tmp/report.md' },
          });
        }
        if (url === '/api/flywheel/conversation') return Response.json(flywheelConversation);
        if (url === '/api/settings') return Response.json({ roles: {} });
        if (url === '/api/flywheel/merge-queue') return Response.json([]);
        return Response.json({ error: 'not found' }, { status: 404 });
      }));
    }

    it('renders all seven action buttons when run is RUNNING', async () => {
      stubRunStatus('running');
      renderPane();
      await screen.findByText('RUN-2');
      await expectAllButtonsRendered();

      // Disabled state contract for running:
      expect(screen.getByRole('button', { name: /^Pause$/i })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: /^Resume$/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /^New Run$/i })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: /^Abort$/i })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: /^Write Report$/i })).not.toBeDisabled();
    });

    it('renders all seven action buttons when run is PAUSED', async () => {
      stubRunStatus('paused');
      renderPane();
      await screen.findByText(/RUN-2/);
      await expectAllButtonsRendered();

      expect(screen.getByRole('button', { name: /^Pause$/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /^Resume$/i })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: /^New Run$/i })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: /^Abort$/i })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: /^Write Report$/i })).not.toBeDisabled();
    });

    it('renders all seven action buttons when there is NO active run', async () => {
      stubRunStatus('none');
      renderPane();
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^More$/i })).toBeInTheDocument();
      });
      await expectAllButtonsRendered();

      // With no run, all destructive/active-run-only actions disabled:
      expect(screen.getByRole('button', { name: /^Pause$/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /^Resume$/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /^Abort$/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /^Write Report$/i })).toBeDisabled();
      // New Run remains enabled — that's the whole point of the none state.
      expect(screen.getByRole('button', { name: /^New Run$/i })).not.toBeDisabled();
    });
  });
});
