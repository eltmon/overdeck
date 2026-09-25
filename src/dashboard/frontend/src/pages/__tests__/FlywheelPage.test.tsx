import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlywheelDerivedStatus } from '@overdeck/contracts';

vi.mock('../../components/flywheel/FlywheelConversationPane', () => ({
  FlywheelConversationPane: () => <div data-testid="flywheel-conversation-pane" />,
}));
vi.mock('../../components/flywheel/FlywheelOrderBookCard', () => ({ FlywheelOrderBookCard: () => null }));
vi.mock('../../components/flywheel/PendingAutoMergesCard', () => ({ PendingAutoMergesCard: () => null }));
// The card's own test covers its counts; here only its presence in the rail matters.
vi.mock('../../components/flywheel/FlywheelUatBatchesCard', () => ({
  FlywheelUatBatchesCard: () => <section aria-label="UAT batches" />,
}));

import { FlywheelPage } from '../FlywheelPage';
import { flywheelStatus, renderWithQuery, stubFetch } from '../../components/flywheel/__tests__/fixtures';

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
    if (url.startsWith('/api/flywheel/stats')) return Response.json(STATS);
    return undefined;
  });
}

describe('FlywheelPage (PAN-3964 FR-8)', () => {
  afterEach(() => vi.unstubAllGlobals());

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
    expect(screen.getByTestId('flywheel-inflight-count')).toHaveTextContent(`${status.inFlight.length} in flight`);
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

  it('tabs switch between Status, State, and Stats', async () => {
    setup(flywheelStatus());
    renderWithQuery(<FlywheelPage />);
    expect(await screen.findByTestId('flywheel-status-pane')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'state' }));
    expect(await screen.findByText('No flywheel state yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'stats' }));
    expect(screen.getByRole('group', { name: 'Stats window' })).toBeInTheDocument();
    expect(screen.getByTestId('flywheel-conversation-pane')).toBeInTheDocument();
  });
});
