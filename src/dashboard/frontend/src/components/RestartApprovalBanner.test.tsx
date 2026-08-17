import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RestartGateSnapshot } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDashboardStore } from '../lib/store';
import { OUTCOME_NOTICE_MS, RestartApprovalBanner } from './RestartApprovalBanner';

vi.mock('../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'x-overdeck-csrf-token': 'test' })),
}));

function seed(restartGate: RestartGateSnapshot | null) {
  useDashboardStore.setState({ restartGate });
}

function renderBanner() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RestartApprovalBanner />
    </QueryClientProvider>,
  );
}

const TWO_PENDING: RestartGateSnapshot = {
  status: 'pending',
  pending: [
    {
      requesterId: 'deploy:PAN-3724:11',
      kind: 'deploy',
      reason: 'post-merge deploy PAN-3724',
      requestedAt: '2026-08-14T12:00:00.000Z',
    },
    {
      requesterId: 'reload:22',
      kind: 'reload',
      reason: 'pan reload',
      requestedAt: '2026-08-14T12:00:01.000Z',
    },
  ],
};

/** The gate after an approved epoch died with nobody left to restart. */
function prunedUnclaimed(at: string): RestartGateSnapshot {
  return { status: 'idle', pending: [], lastOutcome: { type: 'pruned-unclaimed', at } };
}

/** The whole strip's text — the states split their message across elements. */
function bannerText(): string {
  return screen.getByTestId('restart-approval-banner').textContent ?? '';
}

describe('RestartApprovalBanner', () => {
  beforeEach(() => {
    seed(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    seed(null);
  });

  it('stays hidden when no request is waiting', () => {
    renderBanner();
    expect(screen.queryByTestId('restart-approval-banner')).toBeNull();

    seed({ status: 'idle', pending: [] });
    renderBanner();
    expect(screen.queryByTestId('restart-approval-banner')).toBeNull();
  });

  it('names every waiting requester and approves them with one click (AC-1)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ approved: true, pendingCount: 2 }), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    seed(TWO_PENDING);
    renderBanner();

    expect(screen.getByTestId('restart-approval-banner')).toBeTruthy();
    expect(screen.getByText(/post-merge deploy PAN-3724; pan reload/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/restart-gate/approve', expect.objectContaining({ method: 'POST' }));
    });
  });

  it('names who still has to restart once the approval lands (FR-1)', () => {
    seed({ ...TWO_PENDING, status: 'approved' });
    renderBanner();

    // The click must visibly change something, or approving reads as a no-op.
    expect(bannerText()).toContain('Approved — waiting for deploy:PAN-3724:11, reload:22 to restart…');
    expect(screen.queryByRole('button', { name: 'Restart now' })).toBeNull();
  });

  it('says the restart is under way once a requester claims it (FR-3)', () => {
    seed({ ...TWO_PENDING, status: 'claimed' });
    renderBanner();

    // The WebSocket is about to drop; saying so makes the reconnect expected.
    expect(bannerText()).toContain('Restarting…');
    expect(screen.queryByRole('button', { name: 'Restart now' })).toBeNull();
  });

  it('explains a requester that died without restarting, then clears (FR-2)', () => {
    vi.useFakeTimers();
    try {
      seed(prunedUnclaimed(new Date().toISOString()));
      renderBanner();
      expect(bannerText()).toContain(
        'The requester(s) went away without restarting — nothing was restarted.',
      );

      act(() => {
        vi.advanceTimersByTime(OUTCOME_NOTICE_MS);
      });
      expect(screen.queryByTestId('restart-approval-banner')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('never shows an outcome that is already older than its window', () => {
    // A browser connecting minutes later gets the same projection from the
    // snapshot; the notice is timed from the server's outcome, not the render.
    seed(prunedUnclaimed(new Date(Date.now() - 60_000).toISOString()));
    renderBanner();
    expect(screen.queryByTestId('restart-approval-banner')).toBeNull();
  });
});
