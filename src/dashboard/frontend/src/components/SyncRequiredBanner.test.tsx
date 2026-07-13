import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/wsTransport', () => ({ dashboardMutationJsonHeaders: vi.fn(async () => ({ 'x-overdeck-csrf-token': 'test' })) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SyncRequiredBanner } from './SyncRequiredBanner';

function renderBanner() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><SyncRequiredBanner /></QueryClientProvider>);
}

describe('SyncRequiredBanner', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('offers one-click pan sync and disappears when inputs are current', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ needed: true, reason: 'inputs changed' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ needed: false, reason: 'inputs unchanged' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    renderBanner();

    fireEvent.click(await screen.findByRole('button', { name: 'Sync now' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/system/sync', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect(screen.queryByText('Overdeck setup changed.')).not.toBeInTheDocument());
  });

  it('stays hidden when the sync manifest matches current inputs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ needed: false, reason: 'inputs unchanged' }), { status: 200 })));
    renderBanner();
    await waitFor(() => expect(screen.queryByText('Overdeck setup changed.')).not.toBeInTheDocument());
  });
});
