import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlywheelDerivedStatus } from '@overdeck/contracts';

vi.mock('../../components/flywheel/FlywheelConversationPane', () => ({
  FlywheelConversationPane: () => <div data-testid="flywheel-conversation-pane" />,
}));
vi.mock('../../components/flywheel/FlywheelOrderBookCard', () => ({ FlywheelOrderBookCard: () => null }));
vi.mock('../../components/flywheel/PendingAutoMergesCard', () => ({ PendingAutoMergesCard: () => null }));
// Both have their own tests and their own network; here only their presence
// in the page matters, and an unmocked one leaks fetches past the test body.
vi.mock('../../components/flywheel/FlywheelHeadlineStrip', () => ({
  FlywheelHeadlineStrip: () => <section aria-label="Flywheel headline" />,
}));
// The card's own test covers its counts; here only its presence in the rail matters.
vi.mock('../../components/flywheel/FlywheelUatBatchesCard', () => ({
  FlywheelUatBatchesCard: () => <section aria-label="UAT batches" />,
}));

import { FlywheelPage } from '../FlywheelPage';
import { flywheelStatus, renderWithQuery, stubFetch } from '../../components/flywheel/__tests__/fixtures';
import { consumePendingReveal, requestRevealNeedsYou } from '../../lib/flywheelReveal';

const config = { auto_pickup_backlog: false, require_uat_before_merge: true, merge_train_enabled: true };

// The Stats tab and the headline strip share the ['flywheel','stats',30] query.
const STATS = {
  window: { days: 30, since: '2026-08-24T00:00:00.000Z', until: '2026-09-23T00:00:00.000Z' },
  generatedAt: '2026-09-23T10:00:00.000Z',
  criteria: {
    c1_bugRate: { value: 0.25, count: 3, denominator: 12, status: 'yellow', trend: 'flat', dataSufficient: true },
    c2_p0Bugs: { value: 0, status: 'green', trend: 'flat', dataSufficient: true },
  },
  bugs: [],
};

function setup(status: FlywheelDerivedStatus | 'unreachable') {
  return stubFetch((url, init) => {
    if (url === '/api/flywheel/status') {
      return status === 'unreachable' ? new Response('{}', { status: 503 }) : Response.json(status);
    }
    if (url === '/api/merge-train/config' && init?.method === 'POST') {
      return Response.json({ ...config, ...(JSON.parse(String(init.body)) as object) });
    }
    if (url === '/api/merge-train/config') return Response.json(config);
    if (url === '/api/flywheel/state') return Response.json({ exists: false, path: '.pan/flywheel/state.md', content: null, lastModified: null });
    if (url === '/api/flywheel/report') return Response.json({ exists: false, path: '.pan/flywheel/report.md', content: null, lastModified: null });
    if (url.startsWith('/api/flywheel/stats')) return Response.json(STATS);
    return undefined;
  });
}

describe('FlywheelPage (PAN-3964 FR-8)', () => {
  // The reveal flag is module state: clear it so one test cannot steer the next.
  beforeEach(() => { consumePendingReveal(); });
  afterEach(() => vi.useRealTimers());
  afterEach(() => { vi.unstubAllGlobals(); consumePendingReveal(); });

  it('mounts the UAT batches card in the left rail even when idle (PAN-4199 ac3)', async () => {
    setup(flywheelStatus({ run: 'idle', conversation: null, lastTick: null, freshness: null }));
    renderWithQuery(<FlywheelPage />);
    await screen.findByTestId('flywheel-run-chip');
    expect(screen.getByRole('region', { name: 'UAT batches' })).toBeInTheDocument();
  });

  it.each([
    [flywheelStatus(), 'running · tick 3', 'info'],
    [flywheelStatus({ run: 'paused' }), 'paused', 'warning'],
    [flywheelStatus({ run: 'idle', conversation: null, lastTick: null, freshness: null }), 'idle', 'neutral'],
  ] as const)('header run chip for %#', async (status, label, tone) => {
    setup(status);
    renderWithQuery(<FlywheelPage />);
    const chip = await screen.findByTestId('flywheel-run-chip');
    expect(chip).toHaveTextContent(label);
    expect(chip).toHaveAttribute('data-tone', tone);
    expect(screen.getByTestId('flywheel-inflight-count')).toHaveTextContent(
      status.inFlightSource === 'tick'
        ? `${status.inFlight.filter((row) => row.inTick).length} in flight (loop)`
        : `${status.inFlight.length} feature workspaces`,
    );
  });

  it('shows the retry copy, never idle, when the status read fails', async () => {
    setup('unreachable');
    renderWithQuery(<FlywheelPage />);
    expect(await screen.findByText("Can't reach the server — retrying")).toBeInTheDocument();
    expect(screen.getByTestId('flywheel-run-chip')).toHaveTextContent('unreachable');
    expect(screen.queryByText(/No flywheel running/)).toBeNull();
  });

  it('policy switches POST /api/merge-train/config; merge train is a read-only link', async () => {
    const fetchMock = setup(flywheelStatus());
    renderWithQuery(<FlywheelPage />);
    const autoPickup = await screen.findByRole('switch', { name: 'Auto-pickup' });
    await waitFor(() => expect(autoPickup).toBeEnabled());
    fireEvent.click(autoPickup);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/merge-train/config', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ auto_pickup_backlog: true }),
    })));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Require UAT' })).toBeEnabled());
    fireEvent.click(screen.getByRole('switch', { name: 'Require UAT' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/merge-train/config', expect.objectContaining({
      body: JSON.stringify({ require_uat_before_merge: false }),
    })));
    const mergeTrain = screen.getByTestId('flywheel-merge-train-chip');
    expect(mergeTrain).toHaveTextContent('Merge train: on');
    expect(mergeTrain).toHaveAttribute('href', '/awaiting-merge');
    expect(screen.queryByRole('switch', { name: 'Merge train' })).toBeNull();
  });

  it('the header counts the loop\'s own in-flight ids when a tick named them (PAN-4199 ac3)', async () => {
    const base = flywheelStatus();
    setup(flywheelStatus({
      inFlightSource: 'tick',
      inFlight: [
        { ...base.inFlight[0]!, issueId: 'PAN-1', inTick: true },
        { ...base.inFlight[0]!, issueId: 'PAN-2', inTick: true },
        { ...base.inFlight[0]!, issueId: 'PAN-3', inTick: false },
      ],
    }));
    renderWithQuery(<FlywheelPage />);
    expect(await screen.findByTestId('flywheel-inflight-count')).toHaveTextContent('2 in flight (loop)');
  });

  it('the header counts feature workspaces when no tick named them (PAN-4199 ac4)', async () => {
    const base = flywheelStatus();
    setup(flywheelStatus({
      inFlightSource: 'census',
      inFlight: ['PAN-1', 'PAN-2', 'PAN-3'].map((issueId) => ({ ...base.inFlight[0]!, issueId, inTick: false })),
    }));
    renderWithQuery(<FlywheelPage />);
    expect(await screen.findByTestId('flywheel-inflight-count')).toHaveTextContent('3 feature workspaces');
  });

  it('shows how long the run has been up, and only while it runs (PAN-4199 ac2, ac3)', async () => {
    const now = Date.parse('2026-09-23T10:00:00.000Z');
    vi.setSystemTime(now);
    const base = flywheelStatus();
    setup(flywheelStatus({ conversation: { ...base.conversation!, createdAt: '2026-09-23T08:00:00.000Z' } }));
    const { unmount } = renderWithQuery(<FlywheelPage />);
    expect(await screen.findByTestId('flywheel-elapsed')).toHaveTextContent('running 2h 0m');
    unmount();

    setup(flywheelStatus({ run: 'paused' }));
    renderWithQuery(<FlywheelPage />);
    await screen.findByTestId('flywheel-run-chip');
    expect(screen.queryByTestId('flywheel-elapsed')).toBeNull();
    vi.useRealTimers();
  });

  it('a pending reveal selects the Status tab (PAN-4199 ac4)', async () => {
    setup(flywheelStatus());
    renderWithQuery(<FlywheelPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'state' }));
    expect(await screen.findByText('No flywheel state yet.')).toBeInTheDocument();

    requestRevealNeedsYou();
    await waitFor(() => expect(screen.getByRole('tab', { name: 'status' })).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByTestId('flywheel-status-pane')).toBeInTheDocument();
  });

  it('tabs switch between Status, State, Report, and Stats (PAN-4199 ac3)', async () => {
    setup(flywheelStatus());
    renderWithQuery(<FlywheelPage />);
    expect(await screen.findByTestId('flywheel-status-pane')).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).toEqual(['status', 'state', 'report', 'stats']);
    fireEvent.click(screen.getByRole('tab', { name: 'state' }));
    expect(await screen.findByText('No flywheel state yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'report' }));
    expect(await screen.findByText('No report yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'stats' }));
    expect(screen.getByRole('group', { name: 'Stats window' })).toBeInTheDocument();
    expect(screen.getByTestId('flywheel-conversation-pane')).toBeInTheDocument();
  });
});
