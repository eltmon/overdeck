import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RestartGateSnapshot } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDashboardStore } from '../lib/store';
import { RestartApprovalBanner } from './RestartApprovalBanner';

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

  it('stops asking once the restart is already approved or claimed', () => {
    seed({ ...TWO_PENDING, status: 'approved' });
    renderBanner();
    expect(screen.queryByTestId('restart-approval-banner')).toBeNull();

    seed({ ...TWO_PENDING, status: 'claimed' });
    renderBanner();
    expect(screen.queryByTestId('restart-approval-banner')).toBeNull();
  });
});
