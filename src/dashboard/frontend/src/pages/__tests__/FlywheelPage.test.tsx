import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlywheelStatus } from '@panctl/contracts';
import { FlywheelPage } from '../FlywheelPage';

const mocks = vi.hoisted(() => ({
  listener: undefined as ((status: FlywheelStatus | null) => void) | undefined,
  unsubscribe: vi.fn(),
  subscribeFlywheelStatus: vi.fn(),
  statusDetails: vi.fn(),
  conversationPane: vi.fn(),
  statePane: vi.fn(),
  statsPanel: vi.fn(),
}));

vi.mock('../../lib/wsTransport', () => ({
  subscribeFlywheelStatus: mocks.subscribeFlywheelStatus,
}));

vi.mock('../../components/flywheel/FlywheelStatusDetails', () => ({
  FlywheelStatusDetails: (props: { status: FlywheelStatus; onNavigateAgent?: (agentId: string) => void; onNavigateIssue?: (issueId: string) => void }) => {
    mocks.statusDetails(props);
    return <div data-testid="status-details">{props.status.runId}</div>;
  },
}));

vi.mock('../../components/flywheel/FlywheelConversationPane', () => ({
  FlywheelConversationPane: (props: { onOpenSettings?: () => void }) => {
    mocks.conversationPane(props);
    return <div data-testid="conversation-pane">conversation</div>;
  },
}));

vi.mock('../../components/flywheel/FlywheelStatePane', () => ({
  FlywheelStatePane: () => {
    mocks.statePane();
    return <div data-testid="state-pane">state</div>;
  },
}));

vi.mock('../../components/flywheel/FlywheelStatsPanel', () => ({
  FlywheelStatsPanel: () => {
    mocks.statsPanel();
    return <div data-testid="stats-panel">stats</div>;
  },
}));

// Isolate FlywheelPage from the UAT batches card (which has its own queries +
// useConfirm/DialogProvider dependency) — same pattern as the other rail panes.
vi.mock('../../components/flywheel/MergeQueueCard', () => ({
  MergeQueueCard: () => <div data-testid="uat-batches-card">uat batches</div>,
}));

function renderFlywheelPage(element: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>);
}

const status: FlywheelStatus = {
  runId: 'RUN-7',
  startedAt: '2026-05-18T12:00:00.000Z',
  elapsedMs: 125000,
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
  suggestions: [],
  system: {
    mainHead: 'cafebabefeed1234',
    ramUsedMb: 1024,
    ramTotalMb: 4096,
    swapUsedMb: 512,
    swapTotalMb: 1024,
    agentsActive: 3,
    agentsCap: 8,
  },
  openQuestions: [],
  ticks: 3,
  lastTickAt: '2026-05-18T12:03:00.000Z',
};

describe('FlywheelPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(null)));
    mocks.listener = undefined;
    mocks.unsubscribe.mockReset();
    mocks.statusDetails.mockReset();
    mocks.conversationPane.mockReset();
    mocks.statePane.mockReset();
    mocks.statsPanel.mockReset();
    mocks.subscribeFlywheelStatus.mockReset();
    mocks.subscribeFlywheelStatus.mockImplementation((listener: (status: FlywheelStatus | null) => void) => {
      mocks.listener = listener;
      return mocks.unsubscribe;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('mounts the Flywheel status subscription and renders the two-pane shell', () => {
    renderFlywheelPage(<FlywheelPage />);

    expect(mocks.subscribeFlywheelStatus).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Flywheel page')).toHaveClass('flex', 'overflow-hidden');
    expect(screen.getByLabelText('Flywheel control rail')).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: 'Resize flywheel panes' })).toBeInTheDocument();
    expect(screen.getByLabelText('Flywheel conversation column')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Flywheel docs' })).toHaveAttribute('href', 'https://github.com/eltmon/panopticon-cli/blob/main/docs/FLYWHEEL.md');
    expect(screen.getByTestId('conversation-pane')).toBeInTheDocument();
  });

  it('shows the empty state when no run is active', () => {
    renderFlywheelPage(<FlywheelPage />);

    expect(screen.getByText(/No active run/)).toBeInTheDocument();
    expect(screen.getByText('pan flywheel start')).toBeInTheDocument();
    expect(screen.queryByTestId('status-details')).not.toBeInTheDocument();
  });

  it('shows a paused message (not "No active run") when the latest run is paused', async () => {
    // No live snapshot (status null), but the latest run is paused.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/flywheel/runs')) return Response.json([{ status: 'paused' }]);
      return Response.json(null);
    }));

    renderFlywheelPage(<FlywheelPage />);

    expect(await screen.findByText(/Run paused/)).toBeInTheDocument();
    expect(screen.getByText('pan flywheel resume')).toBeInTheDocument();
    expect(screen.queryByText(/No active run/)).not.toBeInTheDocument();
  });

  it('does not render a stale snapshot when the latest run is paused (no flash-then-vanish)', async () => {
    // A paused run: /api/flywheel/current is null, but the RPC stream may still
    // replay the frozen snapshot. The page must NOT treat that as a live run —
    // otherwise the header + suggestions flash in and then vanish on the next
    // null. The paused message stays put.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/flywheel/runs')) return Response.json([{ status: 'paused' }]);
      return Response.json(null);
    }));

    renderFlywheelPage(<FlywheelPage />);
    expect(await screen.findByText(/Run paused/)).toBeInTheDocument();

    // Stale snapshot replays through the subscription — must be ignored.
    act(() => {
      mocks.listener?.(status);
    });

    expect(screen.queryByTestId('status-details')).not.toBeInTheDocument();
    expect(screen.getByText(/Run paused/)).toBeInTheDocument();
    expect(screen.queryByText(/running · /)).not.toBeInTheDocument();
  });

  it('loads Flywheel config, posts partial updates, and updates optimistically', async () => {
    let resolvePost: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/flywheel/current') return Response.json(null);
      if (url === '/api/flywheel/config' && init?.method === 'POST') {
        return new Promise<Response>((resolve) => {
          resolvePost = resolve;
        });
      }
      if (url === '/api/flywheel/config') {
        return Response.json({ auto_pickup_backlog: false, require_uat_before_merge: true });
      }
      return Response.json(null);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderFlywheelPage(<FlywheelPage />);

    const autoPickup = await screen.findByRole('switch', { name: 'Auto-pickup' });
    const requireUat = screen.getByRole('switch', { name: 'Require UAT' });
    expect(autoPickup).not.toBeChecked();
    expect(requireUat).toBeChecked();
    expect(autoPickup).toHaveAttribute('title', expect.stringContaining('Off: inventory is restricted'));
    expect(requireUat).toHaveAttribute('title', expect.stringContaining('On: UAT remains required'));

    fireEvent.click(autoPickup);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/flywheel/config', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ auto_pickup_backlog: true }),
    })));
    await waitFor(() => expect(autoPickup).toBeChecked());
    expect(autoPickup).toBeDisabled();
    expect(requireUat).toBeDisabled();

    resolvePost?.(Response.json({ auto_pickup_backlog: true, require_uat_before_merge: true }));
    await waitFor(() => expect(autoPickup).not.toBeDisabled());
  });

  it('reverts Flywheel config toggles and shows an inline error when saving fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/flywheel/current') return Response.json(null);
      if (url === '/api/flywheel/config' && init?.method === 'POST') {
        return new Response('save failed', { status: 500 });
      }
      if (url === '/api/flywheel/config') {
        return Response.json({ auto_pickup_backlog: false, require_uat_before_merge: true });
      }
      return Response.json(null);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderFlywheelPage(<FlywheelPage />);

    const autoPickup = await screen.findByRole('switch', { name: 'Auto-pickup' });
    fireEvent.click(autoPickup);

    await waitFor(() => expect(autoPickup).not.toBeChecked());
    expect(screen.getByText('save failed')).toHaveClass('text-destructive');
  });

  it('renders pending auto-merges with a live countdown and cancels through DELETE', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-18T12:00:00.000Z'));
    const onNavigateIssue = vi.fn();
    let cancelled = false;
    let resolveDelete: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/flywheel/current') return Response.json(null);
      if (url === '/api/flywheel/config') return Response.json({ auto_pickup_backlog: false, require_uat_before_merge: true });
      if (url === '/api/flywheel/auto-merge/pending') {
        return Response.json(cancelled ? [] : [{
          id: 41,
          issueId: 'PAN-1486',
          prUrl: 'https://github.com/eltmon/panopticon-cli/pull/123',
          scheduledMergeAt: '2026-05-18T12:03:42.000Z',
          status: 'pending',
        }]);
      }
      if (url === '/api/flywheel/auto-merge/PAN-1486' && init?.method === 'DELETE') {
        cancelled = true;
        return new Promise<Response>((resolve) => {
          resolveDelete = resolve;
        });
      }
      return Response.json(null);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderFlywheelPage(<FlywheelPage onNavigateIssue={onNavigateIssue} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByLabelText('Pending auto-merges')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'PAN-1486' })).toBeInTheDocument();
    expect(screen.getByText('PR #123')).toBeInTheDocument();
    expect(screen.getByText('auto-merging in 3:42')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'PAN-1486' }));
    expect(onNavigateIssue).toHaveBeenCalledWith('PAN-1486');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByText('auto-merging in 3:41')).toBeInTheDocument();

    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    await act(async () => {
      fireEvent.click(cancelButton);
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/flywheel/auto-merge/PAN-1486', { method: 'DELETE' });
    expect(cancelButton).toBeDisabled();

    await act(async () => {
      resolveDelete?.(Response.json({ issueId: 'PAN-1486' }));
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByLabelText('Pending auto-merges')).not.toBeInTheDocument();
  });

  it('renders a real FlywheelStatus payload from the subscription without console errors', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onNavigateAgent = vi.fn();
    const onNavigateIssue = vi.fn();

    renderFlywheelPage(<FlywheelPage onNavigateAgent={onNavigateAgent} onNavigateIssue={onNavigateIssue} />);

    act(() => {
      mocks.listener?.(status);
    });

    expect(screen.getByTestId('status-details')).toHaveTextContent('RUN-7');
    expect(mocks.statusDetails).toHaveBeenCalledWith(expect.objectContaining({ status, onNavigateAgent, onNavigateIssue }));
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('updates the last tick freshness chip across live, aging, and stalled states', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-18T12:03:20.000Z'));
    vi.mocked(fetch).mockImplementation(async () => Response.json(status));

    renderFlywheelPage(<FlywheelPage />);

    act(() => {
      mocks.listener?.(status);
    });
    expect(screen.getByText('live')).toHaveClass('text-success');

    // Thresholds: live ≤ 1min, warning ≤ 20min, stalled > 20min (aligned with
    // the orchestrator's 20-minute periodic-sweep contract). lastTickAt is
    // 12:03:00, start is 12:03:20 (20s ago → live).

    // → 12:05:00, age 2min → warning.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100_000);
    });
    expect(screen.getByText('last tick 2m ago')).toHaveClass('text-warning');

    // → 12:25:00, age 22min → stalled.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_200_000);
    });
    expect(screen.getByText('stalled — last tick 22m ago')).toHaveClass('text-destructive');
  });

  it('clears stale live status when the subscription emits null', () => {
    renderFlywheelPage(<FlywheelPage />);

    act(() => {
      mocks.listener?.(status);
    });
    expect(screen.getByTestId('status-details')).toHaveTextContent('RUN-7');

    act(() => {
      mocks.listener?.(null);
    });
    expect(screen.getByText(/No active run/)).toBeInTheDocument();
    expect(screen.queryByTestId('status-details')).not.toBeInTheDocument();
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderFlywheelPage(<FlywheelPage />);

    unmount();

    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('defaults to the Status tab and switches to State on tab click', () => {
    renderFlywheelPage(<FlywheelPage />);

    const tabs = screen.getAllByRole('tab');
    const stateTab = screen.getByRole('tab', { name: 'State' });
    const statusTab = screen.getByRole('tab', { name: 'Status' });
    const statsTab = screen.getByRole('tab', { name: 'Stats' });

    expect(tabs.map((tab) => tab.textContent)).toEqual(['Status', 'State', 'Stats']);
    expect(statusTab).toHaveAttribute('aria-selected', 'true');
    expect(stateTab).toHaveAttribute('aria-selected', 'false');
    expect(statsTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByTestId('state-pane')).not.toBeInTheDocument();

    fireEvent.click(stateTab);

    expect(stateTab).toHaveAttribute('aria-selected', 'true');
    expect(statusTab).toHaveAttribute('aria-selected', 'false');
    expect(statsTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByTestId('state-pane')).toBeInTheDocument();
    expect(screen.queryByText(/No active run/)).not.toBeInTheDocument();
  });

  it('renders the Stats tab and switches back to existing panes without losing status data', () => {
    renderFlywheelPage(<FlywheelPage />);

    act(() => {
      mocks.listener?.(status);
    });

    const statsTab = screen.getByRole('tab', { name: 'Stats' });
    const stateTab = screen.getByRole('tab', { name: 'State' });
    const statusTab = screen.getByRole('tab', { name: 'Status' });

    fireEvent.click(statsTab);

    expect(statsTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Flywheel stats' })).toBeInTheDocument();
    expect(screen.getByTestId('stats-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('status-details')).not.toBeInTheDocument();

    fireEvent.click(stateTab);

    expect(stateTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: '