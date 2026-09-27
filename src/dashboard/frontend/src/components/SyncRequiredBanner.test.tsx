import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/wsTransport', () => ({ dashboardMutationJsonHeaders: vi.fn(async () => ({ 'x-overdeck-csrf-token': 'test' })) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SyncRequiredBanner } from './SyncRequiredBanner';

function renderBanner() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><SyncRequiredBanner /></QueryClientProvider>);
  return client;
}

function statusResponse(overrides: Record<string, unknown>) {
  return new Response(JSON.stringify({
    needed: true,
    reason: 'inputs changed or no manifest',
    banner: true,
    summary: '3 skills and 1 rule changed',
    details: ['sync-sources/rules/a.md'],
    autoSync: { enabled: true, state: 'disabled', lastError: null, lastRunAt: null },
    ...overrides,
  }), { status: 200 });
}

describe('SyncRequiredBanner', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('stays hidden while auto-sync is pending', async () => {
    const fetchMock = vi.fn().mockResolvedValue(statusResponse({
      banner: false,
      autoSync: { enabled: true, state: 'pending', lastError: null, lastRunAt: null },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const client = renderBanner();

    await waitFor(() => expect(client.getQueryState(['sync-status'])?.status).toBe('success'));
    expect(screen.queryByTestId('sync-required-banner')).not.toBeInTheDocument();
  });

  it('names what changed and the error when auto-sync failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(statusResponse({
      autoSync: { enabled: true, state: 'failed', lastError: 'pan sync failed: boom\nstack', lastRunAt: '2026-09-27T00:00:00Z' },
    })));
    renderBanner();

    const banner = await screen.findByTestId('sync-required-banner');
    expect(banner).toHaveTextContent('Auto-sync failed');
    expect(banner).toHaveTextContent('3 skills and 1 rule changed');
    expect(banner).toHaveTextContent('boom');
    expect(banner).not.toHaveTextContent('stack');
    expect(screen.getByRole('button', { name: 'Retry sync' })).toBeInTheDocument();
  });

  it('offers one-click pan sync when auto-sync is off and disappears once current', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(statusResponse({}))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, output: '' }), { status: 200 }))
      .mockResolvedValueOnce(statusResponse({ needed: false, banner: false, summary: null, details: [] }));
    vi.stubGlobal('fetch', fetchMock);
    renderBanner();

    expect(await screen.findByTestId('sync-required-banner')).toHaveTextContent('3 skills and 1 rule changed');
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/system/sync', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect(screen.queryByTestId('sync-required-banner')).not.toBeInTheDocument());
  });
});
