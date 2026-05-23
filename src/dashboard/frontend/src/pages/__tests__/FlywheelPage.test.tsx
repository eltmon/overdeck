import { act, fireEvent, render, screen } from '@testing-library/react';
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
    render(<FlywheelPage />);

    expect(mocks.subscribeFlywheelStatus).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Flywheel page')).toHaveClass('flex');
    expect(screen.getByLabelText('Flywheel status pane')).toBeInTheDocument();
    expect(screen.getByLabelText('Flywheel conversation column')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Flywheel docs' })).toHaveAttribute('href', 'https://github.com/eltmon/panopticon-cli/blob/main/docs/FLYWHEEL.md');
    expect(screen.getByTestId('conversation-pane')).toBeInTheDocument();
  });

  it('shows the empty state when no run is active', () => {
    render(<FlywheelPage />);

    expect(screen.getByText(/No active run/)).toBeInTheDocument();
    expect(screen.getByText('pan flywheel start')).toBeInTheDocument();
    expect(screen.queryByTestId('status-details')).not.toBeInTheDocument();
  });

  it('renders a real FlywheelStatus payload from the subscription without console errors', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onNavigateAgent = vi.fn();
    const onNavigateIssue = vi.fn();

    render(<FlywheelPage onNavigateAgent={onNavigateAgent} onNavigateIssue={onNavigateIssue} />);

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

    render(<FlywheelPage />);

    act(() => {
      mocks.listener?.(status);
    });
    expect(screen.getByText('live')).toHaveClass('text-success');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(screen.getByText('last tick 35s ago')).toHaveClass('text-warning');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByText('stalled — last tick 1m ago')).toHaveClass('text-destructive');
  });

  it('clears stale live status when the subscription emits null', () => {
    render(<FlywheelPage />);

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
    const { unmount } = render(<FlywheelPage />);

    unmount();

    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('defaults to the Status tab and switches to State on tab click', () => {
    render(<FlywheelPage />);

    const stateTab = screen.getByRole('tab', { name: 'State' });
    const statusTab = screen.getByRole('tab', { name: 'Status' });

    expect(statusTab).toHaveAttribute('aria-selected', 'true');
    expect(stateTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByTestId('state-pane')).not.toBeInTheDocument();

    fireEvent.click(stateTab);

    expect(stateTab).toHaveAttribute('aria-selected', 'true');
    expect(statusTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByTestId('state-pane')).toBeInTheDocument();
    expect(screen.queryByText(/No active run/)).not.toBeInTheDocument();
  });
});
