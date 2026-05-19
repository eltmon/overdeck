import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlywheelStatus } from '@panctl/contracts';
import { FlywheelPage } from '../FlywheelPage';

const mocks = vi.hoisted(() => ({
  listener: undefined as ((status: FlywheelStatus | null) => void) | undefined,
  unsubscribe: vi.fn(),
  subscribeFlywheelStatus: vi.fn(),
  statusDetails: vi.fn(),
  conversationPane: vi.fn(),
}));

vi.mock('../../lib/wsTransport', () => ({
  subscribeFlywheelStatus: mocks.subscribeFlywheelStatus,
}));

vi.mock('../../components/flywheel/FlywheelStatusDetails', () => ({
  FlywheelStatusDetails: (props: { status: FlywheelStatus; onNavigateAgent?: (agentId: string) => void }) => {
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
    mocks.subscribeFlywheelStatus.mockReset();
    mocks.subscribeFlywheelStatus.mockImplementation((listener: (status: FlywheelStatus | null) => void) => {
      mocks.listener = listener;
      return mocks.unsubscribe;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mounts the Flywheel status subscription and renders the two-pane shell', () => {
    render(<FlywheelPage />);

    expect(mocks.subscribeFlywheelStatus).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Flywheel page')).toHaveClass('grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]');
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

    render(<FlywheelPage onNavigateAgent={onNavigateAgent} />);

    act(() => {
      mocks.listener?.(status);
    });

    expect(screen.getByTestId('status-details')).toHaveTextContent('RUN-7');
    expect(mocks.statusDetails).toHaveBeenCalledWith(expect.objectContaining({ status, onNavigateAgent }));
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
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
});
